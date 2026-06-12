// GET    /api/v1/properties/:propertyId/insurance
// POST   /api/v1/properties/:propertyId/insurance
// DELETE /api/v1/properties/:propertyId/insurance/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const insuranceRouter = Router({ mergeParams: true });

const PropertyParam = z.object({ propertyId: z.string().uuid() });
const RecordParam   = z.object({ propertyId: z.string().uuid(), id: z.string().uuid() });

const PatchInsuranceSchema = z.object({
  insurance_type:    z.enum(['BUILDING','CONTENTS','COMPREHENSIVE','LIABILITY','FLOOD','FIRE','OTHER']).optional(),
  insurer:           z.string().min(1).max(200).optional(),
  policy_number:     z.string().max(100).nullable().optional(),
  premium_amount:    z.number().min(0).nullable().optional(),
  premium_frequency: z.enum(['MONTHLY','QUARTERLY','ANNUAL']).optional(),
  coverage_amount:   z.number().min(0).nullable().optional(),
  start_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  expiry_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  auto_renew:        z.boolean().optional(),
  notes:             z.string().max(2000).nullable().optional(),
}).strict();

const CreateInsuranceSchema = z.object({
  insurance_type:    z.enum(['BUILDING','CONTENTS','COMPREHENSIVE','LIABILITY','FLOOD','FIRE','OTHER']),
  insurer:           z.string().min(1).max(200),
  policy_number:     z.string().max(100).optional(),
  premium_amount:    z.number().min(0).optional(),
  premium_currency:  z.string().length(3).default('TTD'),
  premium_frequency: z.enum(['MONTHLY','QUARTERLY','ANNUAL']).default('ANNUAL'),
  coverage_amount:   z.number().min(0).optional(),
  start_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiry_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  auto_renew:        z.boolean().default(false),
  notes:             z.string().max(2000).optional(),
  idempotency_key:   z.string().uuid(),
}).strict();

// ── GET ───────────────────────────────────────────────────────────────────────

insuranceRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PropertyParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid property ID.'); return; }
    const { propertyId } = parsed.data;

    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT * FROM prop_insurance
           WHERE  property_id = $1
           ORDER  BY expiry_date ASC NULLS LAST, created_at DESC`,
          [propertyId],
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST ──────────────────────────────────────────────────────────────────────

insuranceRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = PropertyParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid property ID.'); return; }

    const bodyParsed = CreateInsuranceSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { propertyId } = paramParsed.data;
    const b = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const record = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const dup = await c.query<{ id: string }>(
          `SELECT id FROM prop_insurance WHERE idempotency_key = $1`, [b.idempotency_key],
        );
        if (dup.rows.length > 0) {
          return c.query(`SELECT * FROM prop_insurance WHERE id = $1`, [dup.rows[0].id]).then(r => r.rows[0]);
        }
        return c.query(
          `INSERT INTO prop_insurance
             (owner_id, property_id, insurance_type, insurer, policy_number,
              premium_amount, premium_currency, premium_frequency, coverage_amount,
              start_date, expiry_date, auto_renew, notes, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING *`,
          [ownerId, propertyId, b.insurance_type, b.insurer, b.policy_number ?? null,
           b.premium_amount ?? null, b.premium_currency, b.premium_frequency,
           b.coverage_amount ?? null, b.start_date ?? null, b.expiry_date ?? null,
           b.auto_renew, b.notes ?? null, b.idempotency_key],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'Properties', action: 'INSURANCE_CREATED', user_id: req.rlsCtx.userId, owner_id: ownerId, record_id: record.id });
      ok(res, record, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH ─────────────────────────────────────────────────────────────────────

insuranceRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = RecordParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid IDs.'); return; }

    const bodyParsed = PatchInsuranceSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    if (Object.keys(bodyParsed.data).length === 0) { err(res, 422, 'VALIDATION_ERROR', 'No fields to update.'); return; }

    const { id } = parsed.data;
    const b = bodyParsed.data;

    const client = await propertiesPool.connect();
    try {
      const record = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const sets: string[] = ['last_modified_at = now()'];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (b.insurance_type    !== undefined) sets.push(`insurance_type = ${push(b.insurance_type)}`);
        if (b.insurer           !== undefined) sets.push(`insurer = ${push(b.insurer)}`);
        if (b.policy_number     !== undefined) sets.push(`policy_number = ${push(b.policy_number)}`);
        if (b.premium_amount    !== undefined) sets.push(`premium_amount = ${push(b.premium_amount)}`);
        if (b.premium_frequency !== undefined) sets.push(`premium_frequency = ${push(b.premium_frequency)}`);
        if (b.coverage_amount   !== undefined) sets.push(`coverage_amount = ${push(b.coverage_amount)}`);
        if (b.start_date        !== undefined) sets.push(`start_date = ${push(b.start_date)}`);
        if (b.expiry_date       !== undefined) sets.push(`expiry_date = ${push(b.expiry_date)}`);
        if (b.auto_renew        !== undefined) sets.push(`auto_renew = ${push(b.auto_renew)}`);
        if (b.notes             !== undefined) sets.push(`notes = ${push(b.notes)}`);

        params.push(id);
        const idxId = params.length;

        const result = await c.query(
          `UPDATE prop_insurance SET ${sets.join(', ')} WHERE id = $${idxId} RETURNING *`,
          params,
        );
        return result.rows[0] ?? null;
      });

      if (!record) { err(res, 404, 'NOT_FOUND', 'Insurance policy not found.'); return; }
      logger.info({ entity: 'Properties', action: 'INSURANCE_UPDATED', user_id: req.rlsCtx.userId, record_id: id });
      ok(res, record);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE ────────────────────────────────────────────────────────────────────

insuranceRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = RecordParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid IDs.'); return; }
    const { id } = parsed.data;

    const client = await propertiesPool.connect();
    try {
      const deleted = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM prop_insurance WHERE id = $1 RETURNING id`, [id]).then(r => r.rows[0] ?? null),
      );
      if (!deleted) { err(res, 404, 'NOT_FOUND', 'Insurance policy not found.'); return; }
      logger.info({ entity: 'Properties', action: 'INSURANCE_DELETED', user_id: req.rlsCtx.userId, record_id: id });
      ok(res, { id });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
