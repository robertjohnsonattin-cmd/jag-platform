// GET   /api/v1/nlcb/scratch-consignments      — list deliveries (stock summary)
// POST  /api/v1/nlcb/scratch-consignments      — record a book delivery from NLCB
// GET   /api/v1/nlcb/scratch-consignments/:id  — consignment detail with sales pulled against it
// PATCH /api/v1/nlcb/scratch-consignments/:id/close — mark consignment as closed

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const nlcbScratchConsignmentsRouter = Router();
nlcbScratchConsignmentsRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateConsignmentSchema = z.object({
  game_id:          z.string().uuid(),
  delivery_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'delivery_date must be YYYY-MM-DD'),
  books_received:   z.number().int().positive(),
  tickets_per_book: z.number().int().positive().default(50),
  delivery_ref:     z.string().max(100).optional(),
  notes:            z.string().max(500).optional(),
}).strict();

// ── GET /nlcb/scratch-consignments ───────────────────────────────────────────

nlcbScratchConsignmentsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const status = req.query.status as string | undefined;

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (status) conditions.push(`c.status = ${push(status)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT c.id, c.game_id, sg.name AS game_name, sg.denomination,
                  c.delivery_date, c.books_received, c.tickets_per_book, c.total_tickets,
                  c.delivery_ref, c.status, c.created_at,
                  COALESCE(SUM(ss.tickets_sold), 0)  AS tickets_sold,
                  c.total_tickets - COALESCE(SUM(ss.tickets_sold), 0) AS tickets_remaining
           FROM nlcb_scratch_consignments c
           JOIN nlcb_scratch_games sg ON sg.id = c.game_id
           LEFT JOIN nlcb_scratch_sales ss ON ss.consignment_id = c.id
           ${where}
           GROUP BY c.id, sg.name, sg.denomination
           ORDER BY c.delivery_date DESC`,
          params,
        ).then((r) => r.rows);
      });
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /nlcb/scratch-consignments ──────────────────────────────────────────

nlcbScratchConsignmentsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateConsignmentSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const { game_id, delivery_date, books_received, tickets_per_book, delivery_ref, notes } = parsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const gameRes = await c.query(
          `SELECT id FROM nlcb_scratch_games WHERE id = $1 AND is_active = true`,
          [game_id],
        );
        if (gameRes.rows.length === 0) throw Object.assign(new Error('GAME_NOT_FOUND'), { code: 'GAME_NOT_FOUND' });

        return c.query(
          `INSERT INTO nlcb_scratch_consignments
             (tenant_id, game_id, delivery_date, books_received, tickets_per_book, delivery_ref, received_by, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, game_id, delivery_date, books_received, tickets_per_book, total_tickets, status, created_at`,
          [tenantId, game_id, delivery_date, books_received, tickets_per_book, delivery_ref ?? null, userId, notes ?? null],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'NLCB', action: 'CONSIGNMENT_RECEIVED', consignment_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'GAME_NOT_FOUND') { err(res, 404, 'GAME_NOT_FOUND', 'Scratch game not found or inactive.'); return; }
    next(e);
  }
});

// ── GET /nlcb/scratch-consignments/:id ───────────────────────────────────────

nlcbScratchConsignmentsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid consignment id.'); return; }

  const { id } = paramParsed.data;

  try {
    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const consRes = await c.query(
          `SELECT c.id, c.game_id, sg.name AS game_name, sg.denomination,
                  c.delivery_date, c.books_received, c.tickets_per_book, c.total_tickets,
                  c.delivery_ref, c.status, c.notes, c.created_at
           FROM nlcb_scratch_consignments c
           JOIN nlcb_scratch_games sg ON sg.id = c.game_id
           WHERE c.id = $1`,
          [id],
        );
        if (consRes.rows.length === 0) return null;

        const salesRes = await c.query(
          `SELECT ss.id, ss.session_id, ds.session_date, ss.tickets_sold, ss.gross_value,
                  ss.commission_rate, ss.commission_amount, ss.created_at
           FROM nlcb_scratch_sales ss
           JOIN nlcb_daily_sessions ds ON ds.id = ss.session_id
           WHERE ss.consignment_id = $1
           ORDER BY ss.created_at`,
          [id],
        );

        const consignment  = consRes.rows[0];
        const sales        = salesRes.rows;
        const tickets_sold = sales.reduce((s, r) => s + Number(r.tickets_sold), 0);

        return {
          ...consignment,
          sales,
          summary: {
            tickets_sold,
            tickets_remaining: Number(consignment.total_tickets) - tickets_sold,
            gross_value_sold:  sales.reduce((s, r) => s + Number(r.gross_value), 0),
          },
        };
      });

      if (!result) { err(res, 404, 'NOT_FOUND', 'Consignment not found.'); return; }
      ok(res, result);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── PATCH /nlcb/scratch-consignments/:id/close ───────────────────────────────

nlcbScratchConsignmentsRouter.patch('/:id/close', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid consignment id.'); return; }

  const { id } = paramParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const res2 = await c.query(
          `UPDATE nlcb_scratch_consignments SET status = 'CLOSED' WHERE id = $1
           RETURNING id, status`,
          [id],
        );
        return res2.rows[0] ?? null;
      });
      if (!row) { err(res, 404, 'NOT_FOUND', 'Consignment not found.'); return; }
      logger.info({ entity: 'NLCB', action: 'CONSIGNMENT_CLOSED', consignment_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});
