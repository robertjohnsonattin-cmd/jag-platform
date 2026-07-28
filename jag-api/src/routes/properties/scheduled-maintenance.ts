// GET    /api/v1/properties/scheduled-maintenance          — list tasks
// POST   /api/v1/properties/scheduled-maintenance          — create task
// GET    /api/v1/properties/scheduled-maintenance/:id      — get task + completion log
// PATCH  /api/v1/properties/scheduled-maintenance/:id      — update task
// DELETE /api/v1/properties/scheduled-maintenance/:id
// POST   /api/v1/properties/scheduled-maintenance/:id/complete — log completion, advance next_due_date

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const scheduledMaintenanceRouter = Router();

const IdParam = z.object({ id: z.string().uuid() });

const FrequencyEnum   = z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL', 'ONE_TIME']);
const StatusEnum      = z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']);
const PriorityEnum    = z.enum(['LOW', 'MED', 'HIGH']);
const ResponsibleEnum = z.enum(['IN_HOUSE', 'CONTRACTOR', 'TENANT', 'OFFICE']);

function advanceDueDate(from: string, frequency: z.infer<typeof FrequencyEnum>): string {
  const d = new Date(`${from}T00:00:00`);
  switch (frequency) {
    case 'WEEKLY':    d.setDate(d.getDate() + 7); break;
    case 'MONTHLY':   d.setMonth(d.getMonth() + 1); break;
    case 'QUARTERLY': d.setMonth(d.getMonth() + 3); break;
    case 'BIANNUAL':  d.setMonth(d.getMonth() + 6); break;
    case 'ANNUAL':    d.setFullYear(d.getFullYear() + 1); break;
    case 'ONE_TIME':  break;
  }
  return d.toISOString().slice(0, 10);
}

const CreateSchema = z.object({
  property_id:             z.string().uuid(),
  unit_id:                 z.string().uuid().nullable().optional(),
  title:                   z.string().min(1).max(200),
  description:             z.string().max(5000).nullable().optional(),
  frequency:                FrequencyEnum,
  next_due_date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assigned_contractor_id:   z.string().uuid().nullable().optional(),
  estimated_cost_ttd:       z.number().positive().nullable().optional(),
  notes:                    z.string().max(5000).nullable().optional(),
  category:                 z.string().max(30).nullable().optional(),
  priority:                 PriorityEnum.nullable().optional(),
  responsible:              ResponsibleEnum.nullable().optional(),
  trade:                    z.string().max(50).nullable().optional(),
  est_hours:                z.number().positive().max(999).nullable().optional(),
}).strict();

const PatchSchema = z.object({
  title:                   z.string().min(1).max(200).optional(),
  description:             z.string().max(5000).nullable().optional(),
  frequency:                FrequencyEnum.optional(),
  next_due_date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  assigned_contractor_id:   z.string().uuid().nullable().optional(),
  estimated_cost_ttd:       z.number().positive().nullable().optional(),
  status:                   StatusEnum.optional(),
  notes:                    z.string().max(5000).nullable().optional(),
  category:                 z.string().max(30).nullable().optional(),
  priority:                 PriorityEnum.nullable().optional(),
  responsible:              ResponsibleEnum.nullable().optional(),
  trade:                    z.string().max(50).nullable().optional(),
  est_hours:                z.number().positive().max(999).nullable().optional(),
}).strict();

const CompleteSchema = z.object({
  completed_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  actual_cost_ttd:  z.number().positive().nullable().optional(),
  completed_by:     z.string().max(200).nullable().optional(),
  notes:            z.string().max(5000).nullable().optional(),
}).strict();

// ── GET / — list ────────────────────────────────────────────────────────────
scheduledMaintenanceRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const QuerySchema = z.object({
      property_id: z.string().uuid().optional(),
      unit_id:     z.string().uuid().optional(),
      status:      StatusEnum.optional(),
    });
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { property_id, unit_id, status } = parsed.data;

    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (property_id) { params.push(property_id); conditions.push(`sm.property_id = $${params.length}`); }
        if (unit_id)     { params.push(unit_id);     conditions.push(`sm.unit_id = $${params.length}`); }
        if (status)      { params.push(status);      conditions.push(`sm.status = $${params.length}`); }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        return c.query(
          `SELECT sm.*, p.name AS property_name, u.unit_number, ct.name AS contractor_name, ct.trade AS contractor_trade
           FROM prop_scheduled_maintenance sm
           JOIN prop_properties p ON p.id = sm.property_id
           LEFT JOIN prop_units u ON u.id = sm.unit_id
           LEFT JOIN prop_contractors ct ON ct.id = sm.assigned_contractor_id
           ${where}
           ORDER BY sm.next_due_date ASC`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /occurrences — project forward task occurrences within a date range ──
// Registered before GET /:id so "occurrences" is never swallowed as an :id param.
scheduledMaintenanceRouter.get('/occurrences', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const QuerySchema = z.object({
      from:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      property_id: z.string().uuid().optional(),
    });
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'from/to (YYYY-MM-DD) are required.'); return; }
    const { from, to, property_id } = parsed.data;
    if (from > to) { err(res, 422, 'VALIDATION_ERROR', '"from" must not be after "to".'); return; }

    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        // "from" is not referenced in the SQL (occurrences before "from" are still
        // fetched here and filtered client-side in the projection loop below, since
        // an overdue task's next_due_date may be well before "from"). Only bind
        // params actually used in the query text -- an unused $N leaves Postgres
        // unable to infer its type ("could not determine data type of parameter $1").
        const conditions: string[] = [`sm.status = 'ACTIVE'`, `sm.next_due_date <= $1`];
        const params: unknown[] = [to];
        if (property_id) { params.push(property_id); conditions.push(`sm.property_id = $${params.length}`); }

        return c.query(
          `SELECT sm.id, sm.title, sm.frequency, sm.next_due_date::text AS next_due_date,
                  sm.category, sm.priority, sm.responsible, sm.trade, sm.est_hours, sm.notes,
                  p.name AS property_name, u.unit_number, ct.name AS contractor_name
           FROM prop_scheduled_maintenance sm
           JOIN prop_properties p ON p.id = sm.property_id
           LEFT JOIN prop_units u ON u.id = sm.unit_id
           LEFT JOIN prop_contractors ct ON ct.id = sm.assigned_contractor_id
           WHERE ${conditions.join(' AND ')}`,
          params,
        ).then(r => r.rows);
      });

      // Project forward: for each task, advance next_due_date by its frequency
      // while <= "to", collecting every occurrence that falls within [from, to].
      // ONE_TIME tasks contribute at most their single next_due_date.
      type Occ = { occurrence_date: string; [key: string]: unknown };
      const occurrences: Occ[] = [];
      for (const row of rows as Array<Record<string, unknown>>) {
        const frequency = row['frequency'] as z.infer<typeof FrequencyEnum>;
        let date = row['next_due_date'] as string;
        const guardLimit = 200; // safety valve against a runaway loop
        let iterations = 0;
        while (date <= to && iterations < guardLimit) {
          if (date >= from) {
            const { next_due_date: _next_due_date, ...rest } = row;
            occurrences.push({ ...rest, occurrence_date: date });
          }
          if (frequency === 'ONE_TIME') break;
          date = advanceDueDate(date, frequency);
          iterations++;
        }
      }
      occurrences.sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date));

      ok(res, occurrences);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /:id — detail + completion log ───────────────────────────────────────
scheduledMaintenanceRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid task ID.'); return; }

    const client = await propertiesPool.connect();
    try {
      const result = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const task = await c.query(
          `SELECT sm.*, p.name AS property_name, u.unit_number, ct.name AS contractor_name, ct.trade AS contractor_trade
           FROM prop_scheduled_maintenance sm
           JOIN prop_properties p ON p.id = sm.property_id
           LEFT JOIN prop_units u ON u.id = sm.unit_id
           LEFT JOIN prop_contractors ct ON ct.id = sm.assigned_contractor_id
           WHERE sm.id = $1`,
          [parsed.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!task) return null;

        const log = await c.query(
          `SELECT * FROM prop_scheduled_maintenance_log
           WHERE scheduled_maintenance_id = $1 ORDER BY completed_date DESC`,
          [parsed.data.id],
        ).then(r => r.rows);

        return { ...task, completion_log: log };
      });

      if (!result) { err(res, 404, 'NOT_FOUND', 'Scheduled maintenance task not found.'); return; }
      ok(res, result);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST / — create ───────────────────────────────────────────────────────────
scheduledMaintenanceRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const bodyParsed = CreateSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const task = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO prop_scheduled_maintenance
             (owner_id, property_id, unit_id, title, description, frequency,
              next_due_date, assigned_contractor_id, estimated_cost_ttd, notes,
              category, priority, responsible, trade, est_hours)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [ownerId, b.property_id, b.unit_id ?? null, b.title, b.description ?? null, b.frequency,
           b.next_due_date, b.assigned_contractor_id ?? null, b.estimated_cost_ttd ?? null, b.notes ?? null,
           b.category ?? null, b.priority ?? null, b.responsible ?? null, b.trade ?? null, b.est_hours ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'PROPERTIES', action: 'SCHEDULED_MAINTENANCE_CREATED', record_id: task.id, user_id: ownerId });
      ok(res, task, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /:id — update ───────────────────────────────────────────────────────
scheduledMaintenanceRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = IdParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid task ID.'); return; }
    const bodyParsed = PatchSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (b.title                   !== undefined) sets.push(`title = ${push(b.title)}`);
    if (b.description             !== undefined) sets.push(`description = ${push(b.description)}`);
    if (b.frequency               !== undefined) sets.push(`frequency = ${push(b.frequency)}`);
    if (b.next_due_date           !== undefined) sets.push(`next_due_date = ${push(b.next_due_date)}`);
    if (b.assigned_contractor_id  !== undefined) sets.push(`assigned_contractor_id = ${push(b.assigned_contractor_id)}`);
    if (b.estimated_cost_ttd      !== undefined) sets.push(`estimated_cost_ttd = ${push(b.estimated_cost_ttd)}`);
    if (b.status                  !== undefined) sets.push(`status = ${push(b.status)}`);
    if (b.notes                   !== undefined) sets.push(`notes = ${push(b.notes)}`);
    if (b.category                !== undefined) sets.push(`category = ${push(b.category)}`);
    if (b.priority                !== undefined) sets.push(`priority = ${push(b.priority)}`);
    if (b.responsible             !== undefined) sets.push(`responsible = ${push(b.responsible)}`);
    if (b.trade                   !== undefined) sets.push(`trade = ${push(b.trade)}`);
    if (b.est_hours               !== undefined) sets.push(`est_hours = ${push(b.est_hours)}`);
    sets.push(`updated_at = NOW()`);

    if (sets.length === 1) { err(res, 422, 'VALIDATION_ERROR', 'No fields to update.'); return; }

    params.push(idParsed.data.id);
    const idIdx = params.length;

    const client = await propertiesPool.connect();
    try {
      const task = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE prop_scheduled_maintenance SET ${sets.join(', ')} WHERE id = $${idIdx} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null),
      );
      if (!task) { err(res, 404, 'NOT_FOUND', 'Scheduled maintenance task not found.'); return; }
      logger.info({ entity: 'PROPERTIES', action: 'SCHEDULED_MAINTENANCE_UPDATED', record_id: task.id, user_id: ownerId });
      ok(res, task);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /:id ────────────────────────────────────────────────────────────────
scheduledMaintenanceRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid task ID.'); return; }
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const deleted = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM prop_scheduled_maintenance WHERE id = $1 RETURNING id`, [parsed.data.id])
          .then(r => r.rows[0] ?? null),
      );
      if (!deleted) { err(res, 404, 'NOT_FOUND', 'Scheduled maintenance task not found.'); return; }
      logger.info({ entity: 'PROPERTIES', action: 'SCHEDULED_MAINTENANCE_DELETED', record_id: parsed.data.id, user_id: ownerId });
      ok(res, { id: parsed.data.id });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /:id/complete — log completion, advance next_due_date ───────────────
scheduledMaintenanceRouter.post('/:id/complete', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = IdParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid task ID.'); return; }
    const bodyParsed = CompleteSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const result = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const task = await c.query(
          `SELECT id, frequency, status FROM prop_scheduled_maintenance WHERE id = $1`,
          [idParsed.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!task) return null;

        await c.query(
          `INSERT INTO prop_scheduled_maintenance_log
             (owner_id, scheduled_maintenance_id, completed_date, actual_cost_ttd, completed_by, notes)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [ownerId, task.id, b.completed_date, b.actual_cost_ttd ?? null, b.completed_by ?? null, b.notes ?? null],
        );

        const isOneTime = task.frequency === 'ONE_TIME';
        const nextDue = isOneTime ? null : advanceDueDate(b.completed_date, task.frequency);

        return c.query(
          `UPDATE prop_scheduled_maintenance
           SET last_done_date = $1,
               next_due_date  = COALESCE($2, next_due_date),
               status         = CASE WHEN $3 THEN 'COMPLETED' ELSE status END,
               updated_at     = NOW()
           WHERE id = $4 RETURNING *`,
          [b.completed_date, nextDue, isOneTime, task.id],
        ).then(r => r.rows[0]);
      });

      if (!result) { err(res, 404, 'NOT_FOUND', 'Scheduled maintenance task not found.'); return; }
      logger.info({ entity: 'PROPERTIES', action: 'SCHEDULED_MAINTENANCE_COMPLETED', record_id: result.id, user_id: ownerId });
      ok(res, result);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
