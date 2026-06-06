// GET   /api/v1/nlcb/settlements          — list settlements
// POST  /api/v1/nlcb/settlements          — generate weekly settlement (idempotency)
// PATCH /api/v1/nlcb/settlements/:id/pay  — mark as paid (idempotency)
//
// Net owed to NLCB = total_sales - total_payouts - total_commission
// Positive = Brian pays NLCB. Negative = NLCB owes Brian (rare).

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const nlcbSettlementsRouter = Router();
nlcbSettlementsRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateSettlementSchema = z.object({
  week_start:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'week_start must be YYYY-MM-DD'),
  week_end:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'week_end must be YYYY-MM-DD'),
  notes:           z.string().max(500).optional(),
  idempotency_key: z.string().uuid(),
}).strict();

const PaySettlementSchema = z.object({
  paid_amount:      z.number().positive(),
  reference_number: z.string().max(100).optional(),
  notes:            z.string().max(500).optional(),
  idempotency_key:  z.string().uuid(),
}).strict();

// ── GET /nlcb/settlements ─────────────────────────────────────────────────────

nlcbSettlementsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, week_start, week_end,
                  total_sales, total_payouts, total_commission, total_draw_cashing_commission,
                  total_scratch_winnings_paid, total_scratch_cashing_commission,
                  total_bill_collections, total_bill_fees,
                  net_owed, status, paid_at, paid_amount, reference_number, created_at
           FROM nlcb_weekly_settlements
           ORDER BY week_start DESC`,
        ).then((r) => r.rows),
      );
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /nlcb/settlements ────────────────────────────────────────────────────
// Aggregates all closed sessions within the week range.
// Idempotency: same week_start → same result returned without re-inserting.

nlcbSettlementsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateSettlementSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const { week_start, week_end, notes, idempotency_key } = parsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Idempotency check
        const existing = await c.query(
          `SELECT id, week_start, week_end, total_sales, total_payouts, total_commission, net_owed, status
           FROM nlcb_weekly_settlements WHERE idempotency_key = $1`,
          [idempotency_key],
        );
        if (existing.rows.length > 0) return existing.rows[0];

        // Aggregate all three revenue streams from closed sessions in range.
        // Draw tickets, scratch tickets, and bill payments are summed separately
        // so the settlement breakdown is fully auditable.
        const [drawRes, scratchRes, billRes] = await Promise.all([
          // Draw: gross sales, commission earned, booth payouts + cashing commission
          c.query(
            `SELECT
               COALESCE(SUM(s.gross_sales), 0)                                              AS total_sales,
               COALESCE(SUM(s.commission_amount), 0)                                        AS total_commission,
               COALESCE(SUM(CASE WHEN p.is_large_win = false THEN p.payout_amount   ELSE 0 END), 0) AS total_payouts,
               COALESCE(SUM(CASE WHEN p.is_large_win = false THEN p.cashing_commission_amount ELSE 0 END), 0) AS total_draw_cashing_commission
             FROM nlcb_daily_sessions ds
             LEFT JOIN nlcb_sales   s ON s.session_id = ds.id
             LEFT JOIN nlcb_payouts p ON p.session_id = ds.id
             WHERE ds.tenant_id = $1
               AND ds.session_date BETWEEN $2 AND $3
               AND ds.status = 'CLOSED'`,
            [tenantId, week_start, week_end],
          ),
          // Scratch presold: packs paid upfront, not in settlement.
          // NLCB reimburses booth winnings + cashing commission.
          c.query(
            `SELECT
               COALESCE(SUM(CASE WHEN sw.is_large_win = false THEN sw.amount ELSE 0 END), 0)                        AS total_scratch_winnings_paid,
               COALESCE(SUM(CASE WHEN sw.is_large_win = false THEN sw.cashing_commission_amount ELSE 0 END), 0)      AS total_scratch_cashing_commission
             FROM nlcb_daily_sessions ds
             LEFT JOIN nlcb_scratch_winnings sw ON sw.session_id = ds.id
             WHERE ds.tenant_id = $1
               AND ds.session_date BETWEEN $2 AND $3
               AND ds.status = 'CLOSED'`,
            [tenantId, week_start, week_end],
          ),
          c.query(
            `SELECT
               COALESCE(SUM(bp.amount_collected), 0) AS total_bill_collections,
               COALESCE(SUM(bp.flat_fee), 0)         AS total_bill_fees
             FROM nlcb_daily_sessions ds
             LEFT JOIN nlcb_bill_payments bp ON bp.session_id = ds.id
             WHERE ds.tenant_id = $1
               AND ds.session_date BETWEEN $2 AND $3
               AND ds.status = 'CLOSED'`,
            [tenantId, week_start, week_end],
          ),
        ]);

        const total_sales                     = Number(drawRes.rows[0].total_sales);
        const total_commission                = Number(drawRes.rows[0].total_commission);
        const total_payouts                   = Number(drawRes.rows[0].total_payouts);
        const total_draw_cashing_commission   = Number(drawRes.rows[0].total_draw_cashing_commission);
        const total_scratch_winnings_paid     = Number(scratchRes.rows[0].total_scratch_winnings_paid);
        const total_scratch_cashing_commission = Number(scratchRes.rows[0].total_scratch_cashing_commission);
        const total_bill_collections          = Number(billRes.rows[0].total_bill_collections);
        const total_bill_fees                 = Number(billRes.rows[0].total_bill_fees);

        const net_owed = parseFloat((
          (total_sales - total_payouts - total_commission - total_draw_cashing_commission)
          - (total_scratch_winnings_paid + total_scratch_cashing_commission)
          + (total_bill_collections - total_bill_fees)
        ).toFixed(2));

        return c.query(
          `INSERT INTO nlcb_weekly_settlements
             (tenant_id, week_start, week_end,
              total_sales, total_payouts, total_commission, total_draw_cashing_commission,
              total_scratch_winnings_paid, total_scratch_cashing_commission,
              total_bill_collections, total_bill_fees,
              net_owed, notes, idempotency_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING id, week_start, week_end,
                     total_sales, total_payouts, total_commission, total_draw_cashing_commission,
                     total_scratch_winnings_paid, total_scratch_cashing_commission,
                     total_bill_collections, total_bill_fees,
                     net_owed, status, created_at`,
          [tenantId, week_start, week_end,
           total_sales, total_payouts, total_commission, total_draw_cashing_commission,
           total_scratch_winnings_paid, total_scratch_cashing_commission,
           total_bill_collections, total_bill_fees,
           net_owed, notes ?? null, idempotency_key, userId],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'NLCB', action: 'SETTLEMENT_CREATED', settlement_id: row.id, user_id: userId, tenant_id: tenantId, net_owed: row.net_owed });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error && (e as NodeJS.ErrnoException).code === '23505') {
      err(res, 409, 'SETTLEMENT_EXISTS', 'A settlement already exists for this week.');
      return;
    }
    next(e);
  }
});

// ── PATCH /nlcb/settlements/:id/pay ──────────────────────────────────────────

nlcbSettlementsRouter.patch('/:id/pay', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid settlement id.'); return; }

  const bodyParsed = PaySettlementSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const { paid_amount, reference_number, notes, idempotency_key } = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Idempotency: if this key already paid this settlement, return current state
        const settlementRes = await c.query(
          `SELECT id, status, net_owed, paid_amount, paid_at, reference_number
           FROM nlcb_weekly_settlements WHERE id = $1`,
          [id],
        );
        if (settlementRes.rows.length === 0) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });

        const settlement = settlementRes.rows[0];
        if (settlement.status === 'PAID') return settlement;

        return c.query(
          `UPDATE nlcb_weekly_settlements
           SET status = 'PAID', paid_at = now(), paid_amount = $1,
               reference_number = $2, notes = COALESCE($3, notes)
           WHERE id = $4
           RETURNING id, week_start, week_end, net_owed, status, paid_at, paid_amount, reference_number`,
          [paid_amount, reference_number ?? null, notes ?? null, id],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'NLCB', action: 'SETTLEMENT_PAID', settlement_id: id, user_id: userId, tenant_id: tenantId, amount: paid_amount });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Settlement not found.'); return; }
    next(e);
  }
});
