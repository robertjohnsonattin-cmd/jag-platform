// GET    /api/v1/ims/depreciation/schedules
// POST   /api/v1/ims/depreciation/schedules
// GET    /api/v1/ims/depreciation/schedules/:id
// GET    /api/v1/ims/depreciation/schedules/:id/entries
// POST   /api/v1/ims/depreciation/schedules/:id/post   — post next period's entry

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const imsDepreciationRouter = Router();

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateScheduleSchema = z.object({
  item_id:              z.string().uuid(),
  method:               z.enum(['STRAIGHT_LINE', 'DECLINING_BALANCE']).default('STRAIGHT_LINE'),
  useful_life_years:    z.number().min(0.5).max(100),
  residual_value:       z.number().min(0).default(0),
  depreciation_start:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cost_at_start:        z.number().min(0.01),
  notes:                z.string().max(2000).optional(),
}).strict();

const PostEntrySchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:        z.string().max(500).optional(),
}).strict();

// ── GET /depreciation/schedules ───────────────────────────────────────────────

imsDepreciationRouter.get('/depreciation/schedules', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT ds.id, ds.item_id, ds.method, ds.useful_life_years, ds.residual_value,
                  ds.depreciation_start, ds.cost_at_start, ds.is_active, ds.notes,
                  ds.last_modified_at, ds.created_at,
                  i.name AS item_name, i.sku, i.condition,
                  COALESCE(SUM(de.depreciation_amount), 0)                AS accumulated_depreciation,
                  ds.cost_at_start - COALESCE(SUM(de.depreciation_amount), 0) AS net_book_value,
                  MAX(de.period_end)                                       AS last_posted_period
           FROM   ims_depreciation_schedules ds
           JOIN   ims_items i ON i.id = ds.item_id
           LEFT JOIN ims_depreciation_entries de ON de.schedule_id = ds.id
           WHERE  ds.is_active = true
           GROUP  BY ds.id, i.name, i.sku, i.condition
           ORDER  BY i.name ASC`,
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /depreciation/schedules ──────────────────────────────────────────────

imsDepreciationRouter.post('/depreciation/schedules', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateScheduleSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = parsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const item = await c.query('SELECT id, is_asset FROM ims_items WHERE id = $1', [body.item_id]);
        if (item.rows.length === 0) throw Object.assign(new Error('Item not found.'), { code: 'ITEM_NOT_FOUND', status: 404 });
        if (!item.rows[0].is_asset) throw Object.assign(new Error('Depreciation schedules can only be created for capital assets.'), { code: 'NOT_AN_ASSET', status: 422 });

        return c.query<{ id: string }>(
          `INSERT INTO ims_depreciation_schedules
             (tenant_id, item_id, method, useful_life_years, residual_value,
              depreciation_start, cost_at_start, notes, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [tenantId, body.item_id, body.method, body.useful_life_years, body.residual_value,
           body.depreciation_start, body.cost_at_start, body.notes ?? null, userId],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'IMS', action: 'DEP_SCHEDULE_CREATED', user_id: userId, tenant_id: tenantId, record_id: row.id });
      ok(res, { id: row.id }, 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    const cast = e as { code?: string; status?: number; message?: string };
    if (cast.code === 'ITEM_NOT_FOUND') { err(res, 404, cast.code, cast.message ?? ''); return; }
    if (cast.code === 'NOT_AN_ASSET')   { err(res, 422, cast.code, cast.message ?? ''); return; }
    next(e);
  }
});

// ── GET /depreciation/schedules/:id/entries ───────────────────────────────────

imsDepreciationRouter.get('/depreciation/schedules/:id/entries', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid schedule ID.'); return; }

    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, period_start, period_end, depreciation_amount,
                  accumulated_depreciation, net_book_value, notes, created_at
           FROM   ims_depreciation_entries
           WHERE  schedule_id = $1
           ORDER  BY period_start ASC`,
          [parsed.data.id],
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /depreciation/schedules/:id/post ─────────────────────────────────────
// Calculates and posts one depreciation entry for the given period.
// Straight-line: (cost - residual) / useful_life_months per period.
// Declining balance: net_book_value * (1 / useful_life_years) * 2 per year, prorated.

imsDepreciationRouter.post('/depreciation/schedules/:id/post', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed   = UUIDParam.safeParse(req.params);
    const bodyParsed = PostEntrySchema.safeParse(req.body);
    if (!idParsed.success)   { err(res, 422, 'VALIDATION_ERROR', 'Invalid schedule ID.'); return; }
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = idParsed.data;
    const { period_start, period_end, notes } = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const entry = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const schedRes = await c.query(
          `SELECT ds.*, COALESCE(SUM(de.depreciation_amount), 0) AS accumulated
           FROM   ims_depreciation_schedules ds
           LEFT JOIN ims_depreciation_entries de ON de.schedule_id = ds.id
           WHERE  ds.id = $1
           GROUP  BY ds.id`,
          [id],
        );
        if (schedRes.rows.length === 0) throw Object.assign(new Error('Schedule not found.'), { code: 'NOT_FOUND', status: 404 });

        const sched = schedRes.rows[0] as {
          method: string; cost_at_start: string; residual_value: string;
          useful_life_years: string; accumulated: string; item_id: string;
        };

        const costAtStart    = Number(sched.cost_at_start);
        const residual       = Number(sched.residual_value);
        const usefulLifeYrs  = Number(sched.useful_life_years);
        const accumulated    = Number(sched.accumulated);
        const nbv            = costAtStart - accumulated;

        // Period length in days → fraction of year
        const pStart = new Date(period_start);
        const pEnd   = new Date(period_end);
        const daysDiff = (pEnd.getTime() - pStart.getTime()) / (1000 * 60 * 60 * 24) + 1;
        const yearFraction = daysDiff / 365.25;

        let depAmount: number;
        if (sched.method === 'STRAIGHT_LINE') {
          const annualDep = (costAtStart - residual) / usefulLifeYrs;
          depAmount = annualDep * yearFraction;
        } else {
          // Double-declining balance
          const rate = (2 / usefulLifeYrs) * yearFraction;
          depAmount = nbv * rate;
        }

        // Never depreciate below residual value
        const maxDep = Math.max(0, nbv - residual);
        depAmount = Math.min(depAmount, maxDep);
        depAmount = Math.round(depAmount * 100) / 100;

        const newAccumulated = accumulated + depAmount;
        const newNBV         = costAtStart - newAccumulated;

        const entryRow = await c.query(
          `INSERT INTO ims_depreciation_entries
             (tenant_id, schedule_id, item_id, period_start, period_end,
              depreciation_amount, accumulated_depreciation, net_book_value, notes, posted_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id, depreciation_amount, accumulated_depreciation, net_book_value`,
          [tenantId, id, sched.item_id, period_start, period_end,
           depAmount, newAccumulated, newNBV, notes ?? null, userId],
        ).then(r => r.rows[0]);

        // Update item current value to NBV
        await c.query(
          `UPDATE ims_items SET unit_value = $1, last_modified_by = $2,
           last_modified_at = now(), updated_at = now() WHERE id = $3`,
          [newNBV, userId, sched.item_id],
        );

        return entryRow;
      });

      logger.info({ entity: 'IMS', action: 'DEP_ENTRY_POSTED', user_id: userId, tenant_id: tenantId, schedule_id: id });
      ok(res, entry, 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    const cast = e as { code?: string; status?: number; message?: string };
    if (cast.code === 'NOT_FOUND') { err(res, 404, cast.code, cast.message ?? ''); return; }
    next(e);
  }
});
