// GET    /api/v1/ims/depreciation/schedules
// POST   /api/v1/ims/depreciation/schedules
// PATCH  /api/v1/ims/depreciation/schedules/:id/gl-accounts  — link GL accounts
// GET    /api/v1/ims/depreciation/schedules/:id/entries
// POST   /api/v1/ims/depreciation/schedules/:id/post         — post next period's entry + auto-GL

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS, withOwnerRLS, type RLSContext } from '../../middleware/rls';
import { commercialPool, familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const imsDepreciationRouter = Router();

const UUIDParam = z.object({ id: z.string().uuid() });

// Maps ims_vehicles.owner_entity (free-text) → owner_entity_id UUID for GL posting.
// 'Other' has no mapping → GL posting skipped.
const OWNER_ENTITY_MAP: Record<string, string> = {
  'JAG Holdings':      '00000000-0000-0000-0001-000000000001',
  'JABCO':             '00000000-0000-0000-0001-000000000002',
  'JAG Properties':    '00000000-0000-0000-0001-000000000003',
  'JAG Entertainment': '00000000-0000-0000-0001-000000000004',
  'JAG Finance':       '00000000-0000-0000-0001-000000000005',
  'Personal — Robert': '00000000-0000-0000-0001-000000000008',
  'Personal — Brian':  '00000000-0000-0000-0001-000000000011',
};

const CreateScheduleSchema = z.object({
  item_id:                   z.string().uuid(),
  method:                    z.enum(['STRAIGHT_LINE', 'DECLINING_BALANCE']).default('STRAIGHT_LINE'),
  useful_life_years:         z.number().min(0.5).max(100),
  residual_value:            z.number().min(0).default(0),
  depreciation_start:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cost_at_start:             z.number().min(0.01),
  notes:                     z.string().max(2000).optional(),
  dep_expense_gl_account_id: z.string().uuid().optional(),
  acc_dep_gl_account_id:     z.string().uuid().optional(),
}).strict();

const PatchGlAccountsSchema = z.object({
  dep_expense_gl_account_id: z.string().uuid().nullable(),
  acc_dep_gl_account_id:     z.string().uuid().nullable(),
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
                  ds.dep_expense_gl_account_id, ds.acc_dep_gl_account_id,
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
              depreciation_start, cost_at_start, notes, last_modified_by,
              dep_expense_gl_account_id, acc_dep_gl_account_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [tenantId, body.item_id, body.method, body.useful_life_years, body.residual_value,
           body.depreciation_start, body.cost_at_start, body.notes ?? null, userId,
           body.dep_expense_gl_account_id ?? null, body.acc_dep_gl_account_id ?? null],
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

// ── PATCH /depreciation/schedules/:id/gl-accounts ────────────────────────────
// Links (or clears) GL accounts on an existing schedule.

imsDepreciationRouter.patch('/depreciation/schedules/:id/gl-accounts', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP   = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid schedule ID.'); return; }
    const bodyP = PatchGlAccountsSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = idP.data;
    const { dep_expense_gl_account_id, acc_dep_gl_account_id } = bodyP.data;
    const { userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      await withTenantRLS(client, req.rlsCtx, async (c) => {
        const upd = await c.query(
          `UPDATE ims_depreciation_schedules
           SET dep_expense_gl_account_id = $1,
               acc_dep_gl_account_id     = $2,
               last_modified_by          = $3,
               last_modified_at          = now()
           WHERE id = $4`,
          [dep_expense_gl_account_id, acc_dep_gl_account_id, userId, id],
        );
        if (upd.rowCount === 0) throw Object.assign(new Error('Schedule not found.'), { code: 'NOT_FOUND', status: 404 });
      });

      logger.info({ entity: 'IMS', action: 'DEP_SCHEDULE_GL_UPDATED', user_id: userId, schedule_id: id });
      ok(res, { updated: true });
    } finally { client.release(); }
  } catch (e: unknown) {
    const cast = e as { code?: string; status?: number; message?: string };
    if (cast.code === 'NOT_FOUND') { err(res, 404, cast.code, cast.message ?? ''); return; }
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
                  accumulated_depreciation, net_book_value, journal_entry_id,
                  notes, created_at
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
// If the schedule has GL accounts set AND the vehicle has a mappable owner_entity,
// also auto-posts a balanced JE to fin_journal_entries (jag_family DB) non-blocking.

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
      const { entry, sched } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const schedRes = await c.query(
          `SELECT ds.*,
                  COALESCE(SUM(de.depreciation_amount), 0) AS accumulated,
                  i.name AS item_name,
                  v.owner_entity
           FROM   ims_depreciation_schedules ds
           JOIN   ims_items i ON i.id = ds.item_id
           LEFT JOIN ims_vehicles v ON v.item_id = ds.item_id
           LEFT JOIN ims_depreciation_entries de ON de.schedule_id = ds.id
           WHERE  ds.id = $1
           GROUP  BY ds.id, i.name, v.owner_entity`,
          [id],
        );
        if (schedRes.rows.length === 0) throw Object.assign(new Error('Schedule not found.'), { code: 'NOT_FOUND', status: 404 });

        const sched = schedRes.rows[0] as {
          method: string; cost_at_start: string; residual_value: string;
          useful_life_years: string; accumulated: string; item_id: string;
          item_name: string; owner_entity: string | null;
          dep_expense_gl_account_id: string | null;
          acc_dep_gl_account_id: string | null;
        };

        const costAtStart   = Number(sched.cost_at_start);
        const residual      = Number(sched.residual_value);
        const usefulLifeYrs = Number(sched.useful_life_years);
        const accumulated   = Number(sched.accumulated);
        const nbv           = costAtStart - accumulated;

        const pStart      = new Date(period_start);
        const pEnd        = new Date(period_end);
        const daysDiff    = (pEnd.getTime() - pStart.getTime()) / (1000 * 60 * 60 * 24) + 1;
        const yearFraction = daysDiff / 365.25;

        let depAmount: number;
        if (sched.method === 'STRAIGHT_LINE') {
          depAmount = ((costAtStart - residual) / usefulLifeYrs) * yearFraction;
        } else {
          depAmount = nbv * (2 / usefulLifeYrs) * yearFraction;
        }

        const maxDep  = Math.max(0, nbv - residual);
        depAmount     = Math.min(Math.round(Math.min(depAmount, maxDep) * 100) / 100, maxDep);

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

        await c.query(
          `UPDATE ims_items SET unit_value = $1, last_modified_by = $2,
           last_modified_at = now(), updated_at = now() WHERE id = $3`,
          [newNBV, userId, sched.item_id],
        );

        return { entry: entryRow, sched };
      });

      logger.info({ entity: 'IMS', action: 'DEP_ENTRY_POSTED', user_id: userId, tenant_id: tenantId, schedule_id: id, entry_id: entry.id });

      // Non-blocking GL posting — fires after response is sent.
      // Requires both GL accounts set on schedule and a mappable owner_entity.
      const ownerEntityId = sched.owner_entity ? OWNER_ENTITY_MAP[sched.owner_entity] : undefined;
      if (sched.dep_expense_gl_account_id && sched.acc_dep_gl_account_id && ownerEntityId) {
        void postDepreciationGlEntry({
          entryId:             entry.id,
          depAmount:           parseFloat(String(entry.depreciation_amount)),
          ownerEntityId,
          rlsCtx:              req.rlsCtx,
          itemName:            sched.item_name,
          periodStart:         period_start,
          periodEnd:           period_end,
          depExpenseAccountId: sched.dep_expense_gl_account_id,
          accDepAccountId:     sched.acc_dep_gl_account_id,
        });
      }

      ok(res, entry, 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    const cast = e as { code?: string; status?: number; message?: string };
    if (cast.code === 'NOT_FOUND') { err(res, 404, cast.code, cast.message ?? ''); return; }
    next(e);
  }
});

// ── GL posting helper ─────────────────────────────────────────────────────────
// Posts a balanced 2-line JE to jag_family (fin_journal_entries) then writes
// the resulting journal_entry_id back to ims_depreciation_entries.
// All failures are caught and logged — never propagates to the caller.

interface DepGlPostArgs {
  entryId:             string;
  depAmount:           number;
  ownerEntityId:       string;
  rlsCtx:              RLSContext;
  itemName:            string;
  periodStart:         string;
  periodEnd:           string;
  depExpenseAccountId: string;
  accDepAccountId:     string;
}

async function postDepreciationGlEntry(args: DepGlPostArgs): Promise<void> {
  const {
    entryId, depAmount, ownerEntityId, rlsCtx,
    itemName, periodStart, periodEnd,
    depExpenseAccountId, accDepAccountId,
  } = args;
  const { ownerId, userId, tenantId } = rlsCtx;

  const familyClient = await familyPool.connect();
  try {
    const jeId = await withOwnerRLS(familyClient, rlsCtx, async (c) => {
      const description = `Vehicle depreciation — ${itemName} — ${periodStart} to ${periodEnd}`;
      const amountStr   = depAmount.toFixed(2);

      // Insert as POSTED directly (system-generated, balanced, no manual review needed)
      const je = await c.query(
        `INSERT INTO fin_journal_entries
           (owner_id, owner_entity_id, entry_date, description,
            status, source, source_id, currency,
            total_debit_ttd, total_credit_ttd,
            idempotency_key, posted_at, posted_by)
         VALUES ($1,$2,$3,$4,'POSTED','VEHICLE_DEPRECIATION',$5,'TTD',$6,$7,$8,now(),$9)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [ownerId, ownerEntityId, periodEnd, description,
         entryId, amountStr, amountStr,
         `dep_entry_${entryId}`, userId],
      );
      if (je.rows.length === 0) return null; // idempotency: already posted

      const jeId = je.rows[0].id as string;

      // Line 1: Dr. Depreciation Expense
      await c.query(
        `INSERT INTO fin_journal_entry_lines
           (owner_id, journal_entry_id, gl_account_id, line_number,
            description, debit_ttd, credit_ttd, currency)
         VALUES ($1,$2,$3,1,$4,$5,0,'TTD')`,
        [ownerId, jeId, depExpenseAccountId, description, amountStr],
      );
      // Line 2: Cr. Accumulated Depreciation
      await c.query(
        `INSERT INTO fin_journal_entry_lines
           (owner_id, journal_entry_id, gl_account_id, line_number,
            description, debit_ttd, credit_ttd, currency)
         VALUES ($1,$2,$3,2,$4,0,$5,'TTD')`,
        [ownerId, jeId, accDepAccountId, description, amountStr],
      );

      return jeId;
    });

    if (!jeId) return;

    // Write JE reference back onto the depreciation entry (best-effort)
    const updateClient = await commercialPool.connect();
    try {
      await withTenantRLS(updateClient, rlsCtx, (c) =>
        c.query(
          `UPDATE ims_depreciation_entries SET journal_entry_id = $1 WHERE id = $2`,
          [jeId, entryId],
        ),
      );
    } finally { updateClient.release(); }

    logger.info({ entity: 'VMS', action: 'DEP_GL_POSTED', entry_id: entryId, journal_entry_id: jeId, tenant_id: tenantId, user_id: userId });
  } catch (e: unknown) {
    logger.warn({ entity: 'VMS', action: 'DEP_GL_POST_FAILED', entry_id: entryId, error: (e as Error).message });
  } finally {
    familyClient.release();
  }
}
