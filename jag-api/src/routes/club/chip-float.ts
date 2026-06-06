// GET   /api/v1/club/chip-float       — list floats (most recent first)
// POST  /api/v1/club/chip-float       — open today's float (one per day, idempotent)
// GET   /api/v1/club/chip-float/:id   — float detail
// PATCH /api/v1/club/chip-float/:id/close — close float, record counts, compute variances

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { entertainmentPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const clubChipFloatRouter = Router();
clubChipFloatRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const OpenFloatSchema = z.object({
  float_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  opening_cash:   z.number().min(0),
  opening_chips:  z.number().min(0),
  notes:          z.string().max(500).optional(),
}).strict();

const CloseFloatSchema = z.object({
  closing_cash:  z.number().min(0),
  closing_chips: z.number().min(0),
  notes:         z.string().max(500).optional(),
}).strict();

// ── GET /club/chip-float ──────────────────────────────────────────────────────

clubChipFloatRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await entertainmentPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, float_date, status, opening_cash, opening_chips,
                  closing_cash, closing_chips, cash_in_ttd,
                  cash_variance, chips_variance,
                  opened_by, closed_by, opened_at, closed_at, notes
           FROM   ent_chip_float
           ORDER  BY float_date DESC
           LIMIT  90`,
          [],
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /club/chip-float ─────────────────────────────────────────────────────

clubChipFloatRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = OpenFloatSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await entertainmentPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query(
          `SELECT id FROM ent_chip_float WHERE tenant_id = $1 AND float_date = $2`,
          [tenantId, d.float_date],
        );
        if (existing.rows.length > 0) throw Object.assign(new Error('FLOAT_EXISTS'), { code: 'FLOAT_EXISTS' });

        return c.query(
          `INSERT INTO ent_chip_float
             (tenant_id, float_date, opening_cash, opening_chips, opened_by, notes)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id, float_date, status, opening_cash, opening_chips,
                     opened_by, opened_at, notes`,
          [tenantId, d.float_date, d.opening_cash, d.opening_chips, userId, d.notes ?? null],
        ).then(r => r.rows[0]);
      });
      logger.info({ entity: 'CLUB', action: 'CHIP_FLOAT_OPENED', record_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'FLOAT_EXISTS') {
      err(res, 409, 'FLOAT_EXISTS', 'A float has already been opened for this date.'); return;
    }
    next(e);
  }
});

// ── GET /club/chip-float/:id ──────────────────────────────────────────────────

clubChipFloatRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid id.'); return; }
  const { id } = paramParsed.data;

  try {
    const client = await entertainmentPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, float_date, status,
                  opening_cash, opening_chips,
                  closing_cash, closing_chips, cash_in_ttd,
                  cash_variance, chips_variance,
                  opened_by, closed_by, opened_at, closed_at, notes
           FROM   ent_chip_float WHERE id = $1`,
          [id],
        ).then(r => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Float not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /club/chip-float/:id/close ─────────────────────────────────────────
// Closes the float. Computes:
//   cash_in_ttd:   sum of CASH payments on CLUB-tagged tabs on float_date
//   cash_variance: closing_cash − (opening_cash + cash_in_ttd)
//   chips_variance: closing_chips − opening_chips

clubChipFloatRouter.patch('/:id/close', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid id.'); return; }

  const bodyParsed = CloseFloatSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const d = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await entertainmentPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const floatRes = await c.query(
          `SELECT id, status, float_date, opening_cash, opening_chips
           FROM ent_chip_float WHERE id = $1`,
          [id],
        );
        if (floatRes.rows.length === 0) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
        const float = floatRes.rows[0];
        if (float.status === 'CLOSED') throw Object.assign(new Error('ALREADY_CLOSED'), { code: 'ALREADY_CLOSED' });

        // Sum CASH payments on CLUB tabs for this float's date
        const cashInRes = await c.query(
          `SELECT COALESCE(SUM(tp.amount), 0)::numeric AS cash_in
           FROM   ent_tab_payments tp
           JOIN   ent_tabs t ON t.id = tp.tab_id
           WHERE  tp.method = 'CASH'
             AND  t.venue = 'CLUB'
             AND  t.tenant_id = $1
             AND  tp.created_at::date = $2`,
          [tenantId, float.float_date],
        );
        const cashIn = Number(cashInRes.rows[0].cash_in);

        const openingCash  = Number(float.opening_cash);
        const openingChips = Number(float.opening_chips);
        const cashVariance  = Math.round((d.closing_cash - (openingCash + cashIn)) * 100) / 100;
        const chipsVariance = Math.round((d.closing_chips - openingChips) * 100) / 100;

        return c.query(
          `UPDATE ent_chip_float
           SET    status = 'CLOSED',
                  closing_cash   = $1,
                  closing_chips  = $2,
                  cash_in_ttd    = $3,
                  cash_variance  = $4,
                  chips_variance = $5,
                  closed_by      = $6,
                  closed_at      = now(),
                  updated_at     = now(),
                  notes = COALESCE($7, notes)
           WHERE  id = $8
           RETURNING id, float_date, status,
                     opening_cash, opening_chips,
                     closing_cash, closing_chips, cash_in_ttd,
                     cash_variance, chips_variance,
                     opened_by, closed_by, opened_at, closed_at, notes`,
          [d.closing_cash, d.closing_chips, cashIn,
           cashVariance, chipsVariance, userId,
           d.notes ?? null, id],
        ).then(r => r.rows[0]);
      });
      logger.info({ entity: 'CLUB', action: 'CHIP_FLOAT_CLOSED', record_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally { client.release(); }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'NOT_FOUND')      { err(res, 404, 'NOT_FOUND', 'Float not found.'); return; }
      if (e.message === 'ALREADY_CLOSED') { err(res, 409, 'ALREADY_CLOSED', 'Float is already closed.'); return; }
    }
    next(e);
  }
});
