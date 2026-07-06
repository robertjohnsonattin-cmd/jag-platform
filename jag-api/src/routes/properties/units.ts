// GET   /api/v1/properties/:propertyId/units
// POST  /api/v1/properties/:propertyId/units
// PATCH /api/v1/properties/:propertyId/units/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const unitsRouter = Router({ mergeParams: true });

const PropertyParam = z.object({ propertyId: z.string().uuid() });
const RecordParam   = z.object({ propertyId: z.string().uuid(), id: z.string().uuid() });

const CreateUnitSchema = z.object({
  unit_number:     z.string().min(1).max(50),
  floor:           z.number().int().optional(),
  bedrooms:        z.number().int().min(0).optional(),
  bathrooms:       z.number().min(0).optional(),
  floor_area_sqft: z.number().positive().optional(),
  notes:           z.string().max(2000).optional(),
}).strict();

const PatchUnitSchema = z.object({
  unit_number:     z.string().min(1).max(50).optional(),
  floor:           z.number().int().nullable().optional(),
  bedrooms:        z.number().int().min(0).nullable().optional(),
  bathrooms:       z.number().min(0).nullable().optional(),
  floor_area_sqft: z.number().positive().nullable().optional(),
  is_rented:       z.boolean().optional(),
  notes:           z.string().max(2000).nullable().optional(),
}).strict();

async function auditLog(ownerId: string, entity: string, action: string, recordId: string, newValues: unknown): Promise<void> {
  const client = await corePool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', ownerId]);
    await client.query(
      `INSERT INTO audit_log (user_id, entity, action, record_id, new_values, source)
       VALUES ($1, $2, $3, $4, $5, 'API')`,
      [ownerId, entity, action, recordId, JSON.stringify(newValues)],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    logger.warn({ entity: 'PROPERTIES', action: 'AUDIT_LOG_FAILED', error_message: (e as Error).message });
  } finally { client.release(); }
}

// ── GET ───────────────────────────────────────────────────────────────────────

unitsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PropertyParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const result = await c.query(
          `SELECT u.id, u.unit_number, u.floor, u.bedrooms, u.bathrooms,
                  u.floor_area_sqft, u.is_rented, u.notes, u.created_at,
                  u.listing_status, u.listing_description, u.rent_amount,
                  u.wasa_included, u.electricity_included, u.internet_included,
                  u.suggested_rent_recommended_ttd, u.booking_slug,
                  la.id         AS lease_id,
                  la.monthly_rent,
                  la.currency,
                  pt.first_name AS tenant_first_name,
                  pt.last_name  AS tenant_last_name,
                  pt.company_name,
                  pt.is_company,
                  pt.phone      AS tenant_phone
           FROM   prop_units u
           LEFT JOIN prop_lease_agreements la
             ON la.unit_id = u.id AND la.status = 'ACTIVE'
           LEFT JOIN prop_property_tenants pt ON pt.id = la.tenant_id
           WHERE  u.property_id = $1
           ORDER  BY u.floor NULLS LAST, u.unit_number`,
          [parsed.data.propertyId],
        );
        return result.rows;
      });

      logger.info({ entity: 'PROPERTIES', action: 'UNITS_LIST', user_id: req.rlsCtx.userId, count: rows.length });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST ──────────────────────────────────────────────────────────────────────

unitsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = PropertyParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const bodyParsed = CreateUnitSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { propertyId } = paramParsed.data;
    const b = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const unit = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const prop = await c.query(`SELECT id FROM prop_properties WHERE id = $1 AND is_active = true`, [propertyId]);
        if (prop.rows.length === 0) throw Object.assign(new Error('Property not found.'), { status: 404, code: 'PROPERTY_NOT_FOUND' });

        const result = await c.query(
          `INSERT INTO prop_units
             (owner_id, property_id, unit_number, floor, bedrooms, bathrooms, floor_area_sqft, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING *`,
          [ownerId, propertyId, b.unit_number, b.floor ?? null, b.bedrooms ?? null,
           b.bathrooms ?? null, b.floor_area_sqft ?? null, b.notes ?? null],
        );
        return result.rows[0];
      });

      logger.info({ entity: 'PROPERTIES', action: 'UNIT_CREATED', user_id: ownerId, record_id: unit.id });
      await auditLog(ownerId, 'Unit', 'CREATE', unit.id, { property_id: propertyId, unit_number: b.unit_number });
      ok(res, unit, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH ─────────────────────────────────────────────────────────────────────

unitsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = RecordParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid path parameters.'); return; }

    const bodyParsed = PatchUnitSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    if (Object.keys(bodyParsed.data).length === 0) { err(res, 422, 'VALIDATION_ERROR', 'No fields to update.'); return; }

    const { propertyId, id } = paramParsed.data;
    const b = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const unit = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const sets: string[] = ['last_modified_at = now()', `last_modified_by = '${ownerId}'`];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (b.unit_number    !== undefined) sets.push(`unit_number = ${push(b.unit_number)}`);
        if (b.floor          !== undefined) sets.push(`floor = ${push(b.floor)}`);
        if (b.bedrooms       !== undefined) sets.push(`bedrooms = ${push(b.bedrooms)}`);
        if (b.bathrooms      !== undefined) sets.push(`bathrooms = ${push(b.bathrooms)}`);
        if (b.floor_area_sqft !== undefined) sets.push(`floor_area_sqft = ${push(b.floor_area_sqft)}`);
        if (b.is_rented      !== undefined) sets.push(`is_rented = ${push(b.is_rented)}`);
        if (b.notes          !== undefined) sets.push(`notes = ${push(b.notes)}`);

        params.push(id, propertyId);
        const idxId = params.length - 1;
        const idxProp = params.length;

        const result = await c.query(
          `UPDATE prop_units SET ${sets.join(', ')} WHERE id = $${idxId} AND property_id = $${idxProp} RETURNING *`,
          params,
        );
        return result.rows[0] ?? null;
      });

      if (!unit) { err(res, 404, 'UNIT_NOT_FOUND', 'Unit not found.'); return; }
      logger.info({ entity: 'PROPERTIES', action: 'UNIT_UPDATED', user_id: ownerId, record_id: id });
      ok(res, unit);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
