// GET  /api/v1/nlcb/scratch-pack-purchases      — list purchases (stock summary per game)
// POST /api/v1/nlcb/scratch-pack-purchases      — record a pack delivery from NLCB (paid on receipt)
// GET  /api/v1/nlcb/scratch-pack-purchases/:id  — detail with sales drawn against it
//
// Commission is locked in at purchase: commission_amount = total_face_value × rate/100
// purchase_price = total_face_value − commission_amount  (cash paid to NLCB at delivery)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const nlcbScratchPackPurchasesRouter = Router();
nlcbScratchPackPurchasesRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const CreatePurchaseSchema = z.object({
  game_id:          z.string().uuid(),
  purchase_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'purchase_date must be YYYY-MM-DD'),
  packs_purchased:  z.number().int().positive(),
  tickets_per_pack: z.number().int().positive().default(50),
  delivery_ref:     z.string().max(100).optional(),
  notes:            z.string().max(500).optional(),
}).strict();

// ── GET /nlcb/scratch-pack-purchases ─────────────────────────────────────────

nlcbScratchPackPurchasesRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT p.id, p.game_id, sg.name AS game_name, sg.denomination,
                  p.purchase_date, p.packs_purchased, p.tickets_per_pack, p.total_tickets,
                  p.total_face_value, p.commission_rate, p.commission_amount, p.purchase_price,
                  p.delivery_ref, p.created_at,
                  COALESCE(SUM(ss.tickets_sold), 0)                      AS tickets_sold,
                  p.total_tickets - COALESCE(SUM(ss.tickets_sold), 0)    AS tickets_remaining
           FROM nlcb_scratch_pack_purchases p
           JOIN nlcb_scratch_games sg ON sg.id = p.game_id
           LEFT JOIN nlcb_scratch_sales ss ON ss.pack_purchase_id = p.id
           GROUP BY p.id, sg.name, sg.denomination
           ORDER BY p.purchase_date DESC`,
        ).then((r) => r.rows),
      );
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /nlcb/scratch-pack-purchases ────────────────────────────────────────

nlcbScratchPackPurchasesRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreatePurchaseSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const { game_id, purchase_date, packs_purchased, tickets_per_pack, delivery_ref, notes } = parsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const gameRes = await c.query(
          `SELECT denomination, commission_rate FROM nlcb_scratch_games WHERE id = $1 AND is_active = true`,
          [game_id],
        );
        if (gameRes.rows.length === 0) throw Object.assign(new Error('GAME_NOT_FOUND'), {});

        const denomination     = Number(gameRes.rows[0].denomination);
        const commission_rate  = Number(gameRes.rows[0].commission_rate);
        const total_face_value = parseFloat((packs_purchased * tickets_per_pack * denomination).toFixed(2));
        const commission_amount = parseFloat((total_face_value * commission_rate / 100).toFixed(2));
        const purchase_price   = parseFloat((total_face_value - commission_amount).toFixed(2));

        return c.query(
          `INSERT INTO nlcb_scratch_pack_purchases
             (tenant_id, game_id, purchase_date, packs_purchased, tickets_per_pack,
              face_value_per_ticket, total_face_value, commission_rate, commission_amount,
              purchase_price, delivery_ref, received_by, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING id, game_id, purchase_date, packs_purchased, tickets_per_pack,
                     total_tickets, total_face_value, commission_rate, commission_amount,
                     purchase_price, created_at`,
          [tenantId, game_id, purchase_date, packs_purchased, tickets_per_pack,
           denomination, total_face_value, commission_rate, commission_amount,
           purchase_price, delivery_ref ?? null, userId, notes ?? null],
        ).then((r) => r.rows[0]);
      });

      logger.info({
        entity: 'NLCB', action: 'SCRATCH_PACKS_PURCHASED', purchase_id: row.id,
        user_id: userId, tenant_id: tenantId,
        total_face_value: row.total_face_value, purchase_price: row.purchase_price,
      });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'GAME_NOT_FOUND') {
      err(res, 404, 'GAME_NOT_FOUND', 'Scratch game not found or inactive.'); return;
    }
    next(e);
  }
});

// ── GET /nlcb/scratch-pack-purchases/:id ─────────────────────────────────────

nlcbScratchPackPurchasesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid purchase id.'); return; }

  const { id } = paramParsed.data;

  try {
    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const purchaseRes = await c.query(
          `SELECT p.id, p.game_id, sg.name AS game_name, sg.denomination,
                  p.purchase_date, p.packs_purchased, p.tickets_per_pack, p.total_tickets,
                  p.total_face_value, p.commission_rate, p.commission_amount, p.purchase_price,
                  p.delivery_ref, p.notes, p.created_at
           FROM nlcb_scratch_pack_purchases p
           JOIN nlcb_scratch_games sg ON sg.id = p.game_id
           WHERE p.id = $1`,
          [id],
        );
        if (purchaseRes.rows.length === 0) return null;

        const salesRes = await c.query(
          `SELECT ss.id, ss.session_id, ds.session_date, ss.tickets_sold, ss.gross_value, ss.created_at
           FROM nlcb_scratch_sales ss
           JOIN nlcb_daily_sessions ds ON ds.id = ss.session_id
           WHERE ss.pack_purchase_id = $1
           ORDER BY ss.created_at`,
          [id],
        );

        const purchase     = purchaseRes.rows[0];
        const sales        = salesRes.rows;
        const tickets_sold = sales.reduce((s, r) => s + Number(r.tickets_sold), 0);

        return {
          ...purchase,
          sales,
          summary: {
            tickets_sold,
            tickets_remaining: Number(purchase.total_tickets) - tickets_sold,
            gross_value_sold:  sales.reduce((s, r) => s + Number(r.gross_value), 0),
          },
        };
      });

      if (!result) { err(res, 404, 'NOT_FOUND', 'Pack purchase not found.'); return; }
      ok(res, result);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});
