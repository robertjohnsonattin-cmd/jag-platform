// GET    /api/v1/ims/stock-takes
// POST   /api/v1/ims/stock-takes
// GET    /api/v1/ims/stock-takes/:id
// PATCH  /api/v1/ims/stock-takes/:id/count   — record counted quantities
// POST   /api/v1/ims/stock-takes/:id/finalise — post ADJUSTMENT movements for variances

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const imsStockTakesRouter = Router();

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateStockTakeSchema = z.object({
  location_id: z.string().uuid().optional(),
  notes:       z.string().max(2000).optional(),
}).strict();

const CountLinesSchema = z.object({
  lines: z.array(z.object({
    line_id:     z.string().uuid(),
    counted_qty: z.number().min(0),
    notes:       z.string().max(500).optional(),
  }).strict()).min(1),
}).strict();

const FinaliseSchema = z.object({
  idempotency_key: z.string().uuid(),
  notes:           z.string().max(500).optional(),
}).strict();

// ── GET /stock-takes ──────────────────────────────────────────────────────────

imsStockTakesRouter.get('/stock-takes', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT st.id, st.reference, st.status, st.location_id, st.notes,
                  st.finalised_at, st.last_modified_at, st.created_at,
                  l.name  AS location_name,
                  COUNT(stl.id)::int                                      AS line_count,
                  COUNT(stl.id) FILTER (WHERE stl.counted_qty IS NOT NULL)::int AS counted_count,
                  COUNT(stl.id) FILTER (WHERE stl.variance <> 0)::int     AS variance_count
           FROM   ims_stock_takes st
           LEFT JOIN ims_locations        l   ON l.id   = st.location_id
           LEFT JOIN ims_stock_take_lines stl ON stl.stock_take_id = st.id
           GROUP  BY st.id, l.name
           ORDER  BY st.created_at DESC
           LIMIT  50`,
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /stock-takes/:id ──────────────────────────────────────────────────────

imsStockTakesRouter.get('/stock-takes/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid stock take ID.'); return; }

    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const [stRes, linesRes] = await Promise.all([
          c.query(
            `SELECT st.*, l.name AS location_name
             FROM   ims_stock_takes st
             LEFT JOIN ims_locations l ON l.id = st.location_id
             WHERE  st.id = $1`,
            [parsed.data.id],
          ),
          c.query(
            `SELECT stl.id, stl.item_id, stl.expected_qty, stl.counted_qty,
                    stl.variance, stl.notes, stl.counted_at,
                    i.name AS item_name, i.sku, i.unit_of_measure,
                    l.code AS location_code, l.name AS location_name
             FROM   ims_stock_take_lines stl
             JOIN   ims_items     i ON i.id = stl.item_id
             JOIN   ims_locations l ON l.id = i.location_id
             WHERE  stl.stock_take_id = $1
             ORDER  BY i.name ASC`,
            [parsed.data.id],
          ),
        ]);
        if (stRes.rows.length === 0) return null;
        return { ...stRes.rows[0], lines: linesRes.rows };
      });

      if (!result) { err(res, 404, 'STOCK_TAKE_NOT_FOUND', 'Stock take not found.'); return; }
      ok(res, result);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /stock-takes ─────────────────────────────────────────────────────────
// Creates a stock take and snapshots current quantities for all active items
// (optionally filtered to a specific location).

imsStockTakesRouter.post('/stock-takes', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateStockTakeSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { location_id, notes } = parsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const st = await withTenantRLS(client, req.rlsCtx, async (c) => {
        await c.query('BEGIN');
        try {
          const ref = `ST-${new Date().getFullYear()}-${String(await c.query('SELECT nextval($1)::int AS n', ['ims_st_seq']).then(r => r.rows[0].n)).padStart(4, '0')}`;

          const stRow = await c.query<{ id: string }>(
            `INSERT INTO ims_stock_takes (tenant_id, reference, location_id, notes, last_modified_by)
             VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [tenantId, ref, location_id ?? null, notes ?? null, userId],
          ).then(r => r.rows[0]);

          // Snapshot all active items (filtered by location if provided)
          const items = await c.query(
            `SELECT id, quantity_on_hand
             FROM   ims_items
             WHERE  is_active = true
               ${location_id ? 'AND location_id = $1' : ''}`,
            location_id ? [location_id] : [],
          );

          for (const item of items.rows) {
            await c.query(
              `INSERT INTO ims_stock_take_lines (tenant_id, stock_take_id, item_id, expected_qty)
               VALUES ($1,$2,$3,$4)`,
              [tenantId, stRow.id, item.id, item.quantity_on_hand],
            );
          }

          await c.query('COMMIT');
          return { id: stRow.id, reference: ref, line_count: items.rows.length };
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      });

      logger.info({ entity: 'IMS', action: 'STOCK_TAKE_CREATED', user_id: userId, tenant_id: tenantId, record_id: st.id });
      ok(res, st, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /stock-takes/:id/count ──────────────────────────────────────────────
// Record counted quantities for one or more lines.

imsStockTakesRouter.patch('/stock-takes/:id/count', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed   = UUIDParam.safeParse(req.params);
    const bodyParsed = CountLinesSchema.safeParse(req.body);
    if (!idParsed.success)   { err(res, 422, 'VALIDATION_ERROR', 'Invalid stock take ID.'); return; }
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id }  = idParsed.data;
    const { lines } = bodyParsed.data;
    const { userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      await withTenantRLS(client, req.rlsCtx, async (c) => {
        const st = await c.query('SELECT status FROM ims_stock_takes WHERE id = $1', [id]);
        if (st.rows.length === 0) throw Object.assign(new Error('Stock take not found.'), { code: 'NOT_FOUND', status: 404 });

        const status = st.rows[0].status as string;
        if (status === 'FINALISED' || status === 'CANCELLED') {
          throw Object.assign(new Error(`Cannot count lines on a ${status} stock take.`), { code: 'INVALID_STATE', status: 409 });
        }

        for (const line of lines) {
          await c.query(
            `UPDATE ims_stock_take_lines
             SET counted_qty = $1, notes = COALESCE($2, notes), counted_at = now(), updated_at = now()
             WHERE id = $3 AND stock_take_id = $4`,
            [line.counted_qty, line.notes ?? null, line.line_id, id],
          );
        }

        // Advance status from OPEN → COUNTING on first count
        if (status === 'OPEN') {
          await c.query(
            `UPDATE ims_stock_takes SET status = 'COUNTING', last_modified_by = $1,
             last_modified_at = now(), updated_at = now() WHERE id = $2`,
            [userId, id],
          );
        }
      });

      logger.info({ entity: 'IMS', action: 'STOCK_TAKE_COUNTED', user_id: userId, record_id: id, lines: lines.length });
      ok(res, { updated: lines.length });
    } finally { client.release(); }
  } catch (e: unknown) {
    const cast = e as { code?: string; status?: number; message?: string };
    if (cast.code === 'NOT_FOUND')    { err(res, 404, cast.code, cast.message ?? ''); return; }
    if (cast.code === 'INVALID_STATE') { err(res, 409, cast.code, cast.message ?? ''); return; }
    next(e);
  }
});

// ── POST /stock-takes/:id/finalise ────────────────────────────────────────────
// Posts ADJUSTMENT movements for all lines with non-zero variance and marks
// the stock take FINALISED. Uncounted lines are skipped (no adjustment posted).

imsStockTakesRouter.post('/stock-takes/:id/finalise', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed   = UUIDParam.safeParse(req.params);
    const bodyParsed = FinaliseSchema.safeParse(req.body);
    if (!idParsed.success)   { err(res, 422, 'VALIDATION_ERROR', 'Invalid stock take ID.'); return; }
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'idempotency_key is required.'); return; }

    const { id } = idParsed.data;
    const { idempotency_key, notes } = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        await c.query('BEGIN');
        try {
          // Idempotency: check if any adjustment for this take was already posted
          const existing = await c.query(
            `SELECT id FROM ims_stock_movements WHERE idempotency_key = $1 LIMIT 1`,
            [idempotency_key],
          );
          if (existing.rows.length > 0) {
            await c.query('ROLLBACK');
            return { already_processed: true, adjustments: 0 };
          }

          const st = await c.query('SELECT status FROM ims_stock_takes WHERE id = $1', [id]);
          if (st.rows.length === 0) throw Object.assign(new Error('Stock take not found.'), { code: 'NOT_FOUND', status: 404 });

          const status = st.rows[0].status as string;
          if (status === 'FINALISED' || status === 'CANCELLED') {
            throw Object.assign(new Error(`Stock take is already ${status}.`), { code: 'INVALID_STATE', status: 409 });
          }

          // Fetch lines with variances that have been counted
          const lines = await c.query(
            `SELECT stl.item_id, stl.variance, i.location_id
             FROM   ims_stock_take_lines stl
             JOIN   ims_items i ON i.id = stl.item_id
             WHERE  stl.stock_take_id = $1
               AND  stl.counted_qty IS NOT NULL
               AND  stl.variance <> 0`,
            [id],
          );

          let adjustments = 0;
          for (const line of lines.rows) {
            await c.query(
              `INSERT INTO ims_stock_movements
                 (tenant_id, item_id, from_location_id, to_location_id, quantity,
                  movement_type, reference_type, reference_id, notes, performed_by, idempotency_key)
               VALUES ($1,$2,$3,$4,$5,'ADJUSTMENT','STOCK_TAKE',$6,$7,$8,$9)`,
              [
                tenantId, line.item_id,
                line.variance < 0 ? line.location_id : null,
                line.variance > 0 ? line.location_id : null,
                Math.abs(line.variance),
                id,
                notes ?? `Stock take ${id} finalisation`,
                userId,
                idempotency_key,
              ],
            );

            await c.query(
              `UPDATE ims_items
               SET quantity_on_hand = quantity_on_hand + $1,
                   last_modified_at = now(), last_modified_by = $2, updated_at = now()
               WHERE id = $3`,
              [line.variance, userId, line.item_id],
            );

            adjustments++;
          }

          await c.query(
            `UPDATE ims_stock_takes
             SET status = 'FINALISED', finalised_at = now(),
                 last_modified_by = $1, last_modified_at = now(), updated_at = now()
             WHERE id = $2`,
            [userId, id],
          );

          await c.query('COMMIT');
          return { already_processed: false, adjustments };
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      });

      logger.info({ entity: 'IMS', action: 'STOCK_TAKE_FINALISED', user_id: userId, tenant_id: tenantId, record_id: id, adjustments: result.adjustments });
      ok(res, result);
    } finally { client.release(); }
  } catch (e: unknown) {
    const cast = e as { code?: string; status?: number; message?: string };
    if (cast.code === 'NOT_FOUND')    { err(res, 404, cast.code, cast.message ?? ''); return; }
    if (cast.code === 'INVALID_STATE') { err(res, 409, cast.code, cast.message ?? ''); return; }
    next(e);
  }
});
