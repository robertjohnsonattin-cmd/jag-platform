// GET  /api/v1/properties/:propertyId/maintenance
// POST /api/v1/properties/:propertyId/maintenance
// PATCH /api/v1/properties/:propertyId/maintenance/:requestId

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const maintenanceRouter = Router({ mergeParams: true });

const PropertyParam = z.object({ propertyId: z.string().uuid() });
const RequestParam  = z.object({ propertyId: z.string().uuid(), requestId: z.string().uuid() });

const CategoryEnum = z.enum(['PLUMBING','ELECTRICAL','STRUCTURAL','HVAC','APPLIANCE','PEST_CONTROL','SECURITY','GARDEN','PAINTING','ROOFING','OTHER']);
const PriorityEnum = z.enum(['LOW','MEDIUM','HIGH','URGENT']);
const StatusEnum   = z.enum(['OPEN','ASSIGNED','IN_PROGRESS','AWAITING_PARTS','COMPLETED','CLOSED','CANNOT_REPRODUCE']);

const CreateMaintenanceSchema = z.object({
  category:              CategoryEnum,
  description:           z.string().min(1),
  priority:              PriorityEnum.default('MEDIUM'),
  reported_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lease_id:              z.string().uuid().optional(),
  reported_by_tenant_id: z.string().uuid().optional(),
  assigned_to:           z.string().max(200).optional(),
  estimated_cost:        z.number().positive().optional(),
  scheduled_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  idempotency_key:       z.string().uuid(),
}).strict();

const PatchMaintenanceSchema = z.object({
  status:           StatusEnum.optional(),
  assigned_to:      z.string().max(200).nullable().optional(),
  actual_cost:      z.number().positive().nullable().optional(),
  completed_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  completion_notes: z.string().max(2000).nullable().optional(),
  priority:         PriorityEnum.optional(),
}).strict().refine(o => Object.keys(o).length > 0, { message: 'At least one field required.' });

async function auditLog(ownerId: string, action: string, recordId: string, vals: unknown): Promise<void> {
  const client = await corePool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', ownerId]);
    await client.query(
      `INSERT INTO audit_log (user_id, entity, action, record_id, new_values, source) VALUES ($1,'MaintenanceRequest',$2,$3,$4,'API')`,
      [ownerId, action, recordId, JSON.stringify(vals)],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); } finally { client.release(); }
}

// ── GET maintenance list ──────────────────────────────────────────────────────

maintenanceRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PropertyParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, category, description, priority, status, assigned_to,
                  estimated_cost, actual_cost, reported_date, scheduled_date, completed_date,
                  completion_notes, last_modified_at, created_at
           FROM   prop_maintenance_requests
           WHERE  property_id = $1
           ORDER  BY CASE priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
                     created_at DESC`,
          [parsed.data.propertyId],
        ).then(r => r.rows),
      );

      logger.info({ entity: 'PROPERTIES', action: 'MAINTENANCE_LIST', user_id: req.rlsCtx.userId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST maintenance request ──────────────────────────────────────────────────

maintenanceRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = PropertyParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const bodyParsed = CreateMaintenanceSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;
    const { propertyId } = paramParsed.data;

    const client = await propertiesPool.connect();
    try {
      const { record, created } = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM prop_maintenance_requests WHERE idempotency_key = $1`, [body.idempotency_key],
        );
        if (existing.rows.length > 0) {
          const dup = await c.query(`SELECT * FROM prop_maintenance_requests WHERE id = $1`, [existing.rows[0].id]);
          return { record: dup.rows[0], created: false };
        }

        const result = await c.query(
          `INSERT INTO prop_maintenance_requests
             (owner_id, property_id, lease_id, reported_by_tenant_id, category, description,
              priority, reported_date, assigned_to, estimated_cost, scheduled_date, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING *`,
          [ownerId, propertyId, body.lease_id ?? null, body.reported_by_tenant_id ?? null,
           body.category, body.description, body.priority, body.reported_date,
           body.assigned_to ?? null, body.estimated_cost ?? null,
           body.scheduled_date ?? null, body.idempotency_key],
        );
        return { record: result.rows[0], created: true };
      });

      logger.info({ entity: 'PROPERTIES', action: created ? 'MAINTENANCE_CREATED' : 'MAINTENANCE_DUPLICATE', user_id: ownerId, record_id: record.id });
      if (created) await auditLog(ownerId, 'CREATE', record.id, { ...body, property_id: propertyId });
      ok(res, record, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH maintenance request ─────────────────────────────────────────────────

maintenanceRouter.patch('/:requestId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = RequestParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID in path.'); return; }

    const bodyParsed = PatchMaintenanceSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { requestId } = paramParsed.data;
    const body = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const setCols: string[] = ['last_modified_at = now()', 'updated_at = now()'];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

    if (body.status           !== undefined) setCols.push(`status           = ${push(body.status)}`);
    if (body.assigned_to      !== undefined) setCols.push(`assigned_to      = ${push(body.assigned_to)}`);
    if (body.actual_cost      !== undefined) setCols.push(`actual_cost      = ${push(body.actual_cost)}`);
    if (body.completed_date   !== undefined) setCols.push(`completed_date   = ${push(body.completed_date)}`);
    if (body.completion_notes !== undefined) setCols.push(`completion_notes = ${push(body.completion_notes)}`);
    if (body.priority         !== undefined) setCols.push(`priority         = ${push(body.priority)}`);

    params.push(requestId);

    const client = await propertiesPool.connect();
    try {
      const updated = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE prop_maintenance_requests SET ${setCols.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null),
      );

      if (!updated) { err(res, 404, 'REQUEST_NOT_FOUND', 'Maintenance request not found.'); return; }

      logger.info({ entity: 'PROPERTIES', action: 'MAINTENANCE_UPDATED', user_id: ownerId, record_id: requestId });
      await auditLog(ownerId, 'UPDATE', requestId, body);
      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
