// GET   /api/v1/properties/:propertyId/inspections
// POST  /api/v1/properties/:propertyId/inspections
// PATCH /api/v1/properties/:propertyId/inspections/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const inspectionsRouter = Router({ mergeParams: true });

const PropertyParam = z.object({ propertyId: z.string().uuid() });
const RecordParam   = z.object({ propertyId: z.string().uuid(), id: z.string().uuid() });

const PatchInspectionSchema = z.object({
  inspection_type:  z.enum(['MOVE_IN','MOVE_OUT','PERIODIC','PRE_TENANCY','MAINTENANCE','VALUATION']).optional(),
  inspection_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  inspector_name:   z.string().max(200).nullable().optional(),
  condition_rating: z.enum(['EXCELLENT','GOOD','FAIR','POOR']).nullable().optional(),
  notes:            z.string().max(5000).nullable().optional(),
  next_due_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict();

const CreateInspectionSchema = z.object({
  inspection_type:  z.enum(['MOVE_IN','MOVE_OUT','PERIODIC','PRE_TENANCY','MAINTENANCE','VALUATION']),
  inspection_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inspector_name:   z.string().max(200).optional(),
  condition_rating: z.enum(['EXCELLENT','GOOD','FAIR','POOR']).optional(),
  notes:            z.string().max(5000).optional(),
  next_due_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  idempotency_key:  z.string().uuid(),
}).strict();

// ── GET ───────────────────────────────────────────────────────────────────────

inspectionsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PropertyParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid property ID.'); return; }

    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT * FROM prop_inspections
           WHERE  property_id = $1
           ORDER  BY inspection_date DESC`,
          [parsed.data.propertyId],
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST ──────────────────────────────────────────────────────────────────────

inspectionsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = PropertyParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid property ID.'); return; }

    const bodyParsed = CreateInspectionSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { propertyId } = paramParsed.data;
    const b = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const record = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const dup = await c.query<{ id: string }>(
          `SELECT id FROM prop_inspections WHERE idempotency_key = $1`, [b.idempotency_key],
        );
        if (dup.rows.length > 0) {
          return c.query(`SELECT * FROM prop_inspections WHERE id = $1`, [dup.rows[0].id]).then(r => r.rows[0]);
        }
        return c.query(
          `INSERT INTO prop_inspections
             (owner_id, property_id, inspection_type, inspection_date,
              inspector_name, condition_rating, notes, next_due_date, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING *`,
          [ownerId, propertyId, b.inspection_type, b.inspection_date,
           b.inspector_name ?? null, b.condition_rating ?? null,
           b.notes ?? null, b.next_due_date ?? null, b.idempotency_key],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'Properties', action: 'INSPECTION_CREATED', user_id: req.rlsCtx.userId, owner_id: ownerId, record_id: record.id });
      ok(res, record, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH ─────────────────────────────────────────────────────────────────────

inspectionsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = RecordParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid IDs.'); return; }

    const bodyParsed = PatchInspectionSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    if (Object.keys(bodyParsed.data).length === 0) { err(res, 422, 'VALIDATION_ERROR', 'No fields to update.'); return; }

    const { propertyId, id } = paramParsed.data;
    const b = bodyParsed.data;

    const client = await propertiesPool.connect();
    try {
      const record = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const sets: string[] = ['last_modified_at = now()'];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (b.inspection_type  !== undefined) sets.push(`inspection_type = ${push(b.inspection_type)}`);
        if (b.inspection_date  !== undefined) sets.push(`inspection_date = ${push(b.inspection_date)}`);
        if (b.inspector_name   !== undefined) sets.push(`inspector_name = ${push(b.inspector_name)}`);
        if (b.condition_rating !== undefined) sets.push(`condition_rating = ${push(b.condition_rating)}`);
        if (b.notes            !== undefined) sets.push(`notes = ${push(b.notes)}`);
        if (b.next_due_date    !== undefined) sets.push(`next_due_date = ${push(b.next_due_date)}`);

        params.push(id, propertyId);
        const idxId   = params.length - 1;
        const idxProp = params.length;

        const result = await c.query(
          `UPDATE prop_inspections SET ${sets.join(', ')} WHERE id = $${idxId} AND property_id = $${idxProp} RETURNING *`,
          params,
        );
        return result.rows[0] ?? null;
      });

      if (!record) { err(res, 404, 'NOT_FOUND', 'Inspection not found.'); return; }
      logger.info({ entity: 'Properties', action: 'INSPECTION_UPDATED', user_id: req.rlsCtx.userId, record_id: id });
      ok(res, record);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
