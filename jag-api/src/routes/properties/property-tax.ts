// GET   /api/v1/properties/:propertyId/tax
// POST  /api/v1/properties/:propertyId/tax
// PATCH /api/v1/properties/:propertyId/tax/:id
// PATCH /api/v1/properties/:propertyId/tax/:id/pay

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const propertyTaxRouter = Router({ mergeParams: true });

const PropertyParam = z.object({ propertyId: z.string().uuid() });
const RecordParam   = z.object({ propertyId: z.string().uuid(), id: z.string().uuid() });

const CreateTaxSchema = z.object({
  tax_year:          z.number().int().min(1990).max(2100),
  assessment_value:  z.number().min(0).optional(),
  tax_amount:        z.number().min(0),
  currency:          z.string().length(3).default('TTD'),
  due_date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:             z.string().max(2000).optional(),
  idempotency_key:   z.string().uuid(),
}).strict();

const EditTaxSchema = z.object({
  tax_year:         z.number().int().min(1990).max(2100).optional(),
  assessment_value: z.number().min(0).nullable().optional(),
  tax_amount:       z.number().min(0).optional(),
  due_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes:            z.string().max(2000).nullable().optional(),
}).strict();

const PayTaxSchema = z.object({
  paid_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_reference: z.string().max(200).optional(),
}).strict();

// ── GET ───────────────────────────────────────────────────────────────────────

propertyTaxRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PropertyParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid property ID.'); return; }

    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT * FROM prop_property_tax
           WHERE  property_id = $1
           ORDER  BY tax_year DESC`,
          [parsed.data.propertyId],
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST ──────────────────────────────────────────────────────────────────────

propertyTaxRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = PropertyParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid property ID.'); return; }

    const bodyParsed = CreateTaxSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { propertyId } = paramParsed.data;
    const b = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const record = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const dup = await c.query<{ id: string }>(
          `SELECT id FROM prop_property_tax WHERE idempotency_key = $1`, [b.idempotency_key],
        );
        if (dup.rows.length > 0) {
          return c.query(`SELECT * FROM prop_property_tax WHERE id = $1`, [dup.rows[0].id]).then(r => r.rows[0]);
        }
        return c.query(
          `INSERT INTO prop_property_tax
             (owner_id, property_id, tax_year, assessment_value, tax_amount,
              currency, due_date, notes, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING *`,
          [ownerId, propertyId, b.tax_year, b.assessment_value ?? null,
           b.tax_amount, b.currency, b.due_date ?? null, b.notes ?? null, b.idempotency_key],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'Properties', action: 'TAX_CREATED', user_id: req.rlsCtx.userId, owner_id: ownerId });
      ok(res, record, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /:id ────────────────────────────────────────────────────────────────

propertyTaxRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = RecordParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid IDs.'); return; }

    const bodyParsed = EditTaxSchema.safeParse(req.body);
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

        if (b.tax_year         !== undefined) sets.push(`tax_year = ${push(b.tax_year)}`);
        if (b.assessment_value !== undefined) sets.push(`assessment_value = ${push(b.assessment_value)}`);
        if (b.tax_amount       !== undefined) sets.push(`tax_amount = ${push(b.tax_amount)}`);
        if (b.due_date         !== undefined) sets.push(`due_date = ${push(b.due_date)}`);
        if (b.notes            !== undefined) sets.push(`notes = ${push(b.notes)}`);

        params.push(id, propertyId);
        const idxId   = params.length - 1;
        const idxProp = params.length;

        const result = await c.query(
          `UPDATE prop_property_tax SET ${sets.join(', ')} WHERE id = $${idxId} AND property_id = $${idxProp} RETURNING *`,
          params,
        );
        return result.rows[0] ?? null;
      });

      if (!record) { err(res, 404, 'NOT_FOUND', 'Tax record not found.'); return; }
      logger.info({ entity: 'Properties', action: 'TAX_UPDATED', user_id: req.rlsCtx.userId, record_id: id });
      ok(res, record);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /:id/pay ────────────────────────────────────────────────────────────

propertyTaxRouter.patch('/:id/pay', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = RecordParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid IDs.'); return; }

    const bodyParsed = PayTaxSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = paramParsed.data;
    const { paid_date, payment_reference } = bodyParsed.data;

    const client = await propertiesPool.connect();
    try {
      const updated = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE prop_property_tax
           SET paid_date = $1, payment_reference = $2, updated_at = now()
           WHERE id = $3
           RETURNING *`,
          [paid_date, payment_reference ?? null, id],
        ).then(r => r.rows[0] ?? null),
      );
      if (!updated) { err(res, 404, 'NOT_FOUND', 'Tax record not found.'); return; }
      logger.info({ entity: 'Properties', action: 'TAX_PAID', user_id: req.rlsCtx.userId, record_id: id });
      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
