// GET    /api/v1/ims/vehicles
// POST   /api/v1/ims/vehicles
// PATCH  /api/v1/ims/vehicles/:id
// DELETE /api/v1/ims/vehicles/:id  (Owner only — hard delete if no movements/depreciation)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const imsVehiclesRouter = Router();

const VehicleTypeEnum = z.enum(['CAR','SUV','TRUCK','VAN','EXCAVATOR','COMPACTOR','ROLLER','CRANE','GENERATOR','TRAILER','MOTORCYCLE','OTHER']);
const ConditionEnum   = z.enum(['NEW','GOOD','FAIR','POOR','WRITTEN_OFF']);

const CreateVehicleSchema = z.object({
  // Base item fields
  name:            z.string().min(1).max(200),
  location_id:     z.string().uuid().optional(),          // nullable after migration 012
  unit_value:      z.number().min(0).optional(),
  serial_number:   z.string().max(100).optional(),
  condition:       ConditionEnum.default('GOOD'),
  // Vehicle-specific — owner_entity replaces fleet_type (STD-13 dual-write)
  owner_entity:             z.string().min(1).max(100),   // required free-text
  fleet_type:               z.string().max(50).optional(), // kept for backward compat
  registration_number:      z.string().min(1).max(20),
  make:                     z.string().min(1).max(100),
  model:                    z.string().min(1).max(100),
  year:                     z.number().int().min(1900).max(2100),
  colour:                   z.string().max(50).optional(),
  vehicle_type:             VehicleTypeEnum,
  fuel_type:                z.enum(['PETROL','DIESEL','HYBRID','ELECTRIC','NONE']).default('PETROL'),
  vin:                      z.string().max(50).optional(),
  engine_number:            z.string().max(50).optional(),
  insurance_policy_number:  z.string().max(100).optional(),
  insurance_provider:       z.string().max(100).optional(),
  insurance_expiry:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  registration_expiry:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  purchase_date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  purchase_price:           z.number().min(0).optional(),
  current_mileage_km:       z.number().int().min(0).optional(),
  // Service tracking (migration 012)
  last_service_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  service_interval_days:    z.number().int().min(1).max(3650).default(90),
  // GPS tracker SIM (migration 015)
  sim_number:               z.string().max(20).optional(),
}).strict();

const PatchVehicleSchema = z.object({
  owner_entity:            z.string().min(1).max(100).optional(),
  colour:                  z.string().max(50).optional(),
  condition:               ConditionEnum.optional(),
  current_mileage_km:      z.number().int().min(0).optional(),
  unit_value:              z.number().min(0).optional(),
  insurance_policy_number: z.string().max(100).optional(),
  insurance_provider:      z.string().max(100).optional(),
  insurance_expiry:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  registration_expiry:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Service log — when set, next_service_date is auto-computed
  last_service_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  service_interval_days:   z.number().int().min(1).max(3650).optional(),
  location_id:             z.string().uuid().optional(),
  sim_number:              z.string().max(20).optional(),
}).strict().refine(o => Object.keys(o).length > 0, 'No fields to update');

const VehiclesQuerySchema = z.object({
  owner_entity:        z.string().max(100).optional(),
  registration_number: z.string().max(20).optional(),
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const UUIDParam = z.object({ id: z.string().uuid() });

// ── GET /vehicles ─────────────────────────────────────────────────────────────

imsVehiclesRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = VehiclesQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }

    const { owner_entity, registration_number, page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const client = await commercialPool.connect();
    try {
      const { rows, total } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const conditions: string[] = ['i.is_active = true'];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (owner_entity)        conditions.push(`v.owner_entity = ${push(owner_entity)}`);
        if (registration_number) conditions.push(`v.registration_number = ${push(registration_number)}`);
        const where = conditions.join(' AND ');

        const countResult = await c.query<{ count: string }>(
          `SELECT count(*)
           FROM   ims_vehicles v
           JOIN   ims_items    i ON i.id = v.item_id
           WHERE  ${where}`,
          params,
        );

        const dataResult = await c.query(
          `SELECT v.id, v.owner_entity, v.fleet_type, v.registration_number, v.make, v.model,
                  v.year, v.colour, v.vehicle_type, v.fuel_type,
                  v.vin, v.engine_number,
                  v.insurance_policy_number, v.insurance_provider, v.insurance_expiry,
                  v.registration_expiry, v.purchase_date, v.purchase_price,
                  v.current_mileage_km, v.assigned_to_user_id,
                  v.last_service_date, v.next_service_date, v.service_interval_days,
                  v.sim_number,
                  v.last_modified_at, v.created_at,
                  i.id          AS item_id,
                  i.name        AS item_name,
                  i.sku,
                  i.condition   AS item_condition,
                  i.unit_value  AS current_value,
                  i.serial_number,
                  l.id   AS location_id,
                  l.name AS location_name
           FROM   ims_vehicles v
           JOIN   ims_items    i ON i.id    = v.item_id
           LEFT   JOIN ims_locations l ON l.id = i.location_id
           WHERE  ${where}
           ORDER  BY v.registration_number ASC
           LIMIT  ${push(limit)} OFFSET ${push(offset)}`,
          params,
        );

        return { rows: dataResult.rows, total: Number(countResult.rows[0].count) };
      });

      logger.info({ entity: 'IMS', action: 'VEHICLES_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId, count: rows.length });
      ok(res, { vehicles: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /vehicles ────────────────────────────────────────────────────────────

imsVehiclesRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateVehicleSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const b = parsed.data;
    const { tenantId, userId } = req.rlsCtx;

    // Compute next_service_date if last_service_date provided
    const nextServiceDate = b.last_service_date
      ? computeNextService(b.last_service_date, b.service_interval_days)
      : null;

    const client = await commercialPool.connect();
    try {
      const vehicle = await withTenantRLS(client, req.rlsCtx, async (c) => {
        await c.query('BEGIN');

        const itemResult = await c.query(
          `INSERT INTO ims_items
             (tenant_id, location_id, name, unit_of_measure, quantity_on_hand,
              unit_value, serial_number, condition, is_asset, vat_code,
              last_modified_by)
           VALUES ($1,$2,$3,'each',1,$4,$5,$6,true,'EXEMPT',$7)
           RETURNING id`,
          [tenantId, b.location_id ?? null, b.name, b.unit_value ?? null,
           b.serial_number ?? null, b.condition, userId],
        );
        const itemId: string = itemResult.rows[0].id;

        const vehicleResult = await c.query(
          `INSERT INTO ims_vehicles
             (tenant_id, item_id, owner_entity, fleet_type,
              registration_number, make, model, year,
              colour, vehicle_type, fuel_type, vin, engine_number,
              insurance_policy_number, insurance_provider, insurance_expiry,
              registration_expiry, purchase_date, purchase_price, current_mileage_km,
              last_service_date, next_service_date, service_interval_days,
              sim_number, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
           RETURNING id`,
          [
            tenantId, itemId,
            b.owner_entity,
            b.owner_entity,   // dual-write fleet_type for STD-13 compat
            b.registration_number, b.make, b.model, b.year,
            b.colour ?? null, b.vehicle_type, b.fuel_type,
            b.vin ?? null, b.engine_number ?? null,
            b.insurance_policy_number ?? null, b.insurance_provider ?? null,
            b.insurance_expiry ?? null, b.registration_expiry ?? null,
            b.purchase_date ?? null, b.purchase_price ?? null, b.current_mileage_km ?? null,
            b.last_service_date ?? null, nextServiceDate, b.service_interval_days,
            b.sim_number ?? null, userId,
          ],
        );

        await c.query('COMMIT');
        return { item_id: itemId, vehicle_id: vehicleResult.rows[0].id };
      });

      logger.info({ entity: 'IMS', action: 'VEHICLE_CREATED', user_id: userId, tenant_id: tenantId, item_id: vehicle.item_id });
      ok(res, vehicle, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /vehicles/:id ───────────────────────────────────────────────────────

imsVehiclesRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = PatchVehicleSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const b = bodyP.data;
    const { userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Fetch current service_interval_days to compute next_service_date
        const cur = await c.query<{ service_interval_days: number; item_id: string }>(
          `SELECT service_interval_days, item_id FROM ims_vehicles WHERE id = $1`,
          [idP.data.id],
        );
        if (cur.rows.length === 0) return null;
        const intervalDays = b.service_interval_days ?? cur.rows[0].service_interval_days;

        // Vehicle row updates
        const vCols: string[] = ['last_modified_at = now()'];
        const vParams: unknown[] = [];
        const vPush = (v: unknown) => { vParams.push(v); return `$${vParams.length}`; };

        if (b.owner_entity           !== undefined) { vCols.push(`owner_entity = ${vPush(b.owner_entity)}`); vCols.push(`fleet_type = ${vPush(b.owner_entity)}`); }
        if (b.colour                 !== undefined) vCols.push(`colour = ${vPush(b.colour)}`);
        if (b.insurance_policy_number !== undefined) vCols.push(`insurance_policy_number = ${vPush(b.insurance_policy_number)}`);
        if (b.insurance_provider      !== undefined) vCols.push(`insurance_provider = ${vPush(b.insurance_provider)}`);
        if (b.insurance_expiry        !== undefined) vCols.push(`insurance_expiry = ${vPush(b.insurance_expiry)}`);
        if (b.registration_expiry     !== undefined) vCols.push(`registration_expiry = ${vPush(b.registration_expiry)}`);
        if (b.current_mileage_km      !== undefined) vCols.push(`current_mileage_km = ${vPush(b.current_mileage_km)}`);
        if (b.service_interval_days   !== undefined) vCols.push(`service_interval_days = ${vPush(b.service_interval_days)}`);
        if (b.last_service_date       !== undefined) {
          vCols.push(`last_service_date = ${vPush(b.last_service_date)}`);
          vCols.push(`next_service_date = ${vPush(computeNextService(b.last_service_date, intervalDays))}`);
        }
        if (b.sim_number !== undefined) vCols.push(`sim_number = ${vPush(b.sim_number)}`);

        vParams.push(idP.data.id);
        await c.query(
          `UPDATE ims_vehicles SET ${vCols.join(', ')} WHERE id = $${vParams.length}`,
          vParams,
        );

        // Item row updates (condition, unit_value, colour, location_id)
        const iCols: string[] = ['last_modified_at = now()', `last_modified_by = '${userId}'`];
        const iParams: unknown[] = [];
        const iPush = (v: unknown) => { iParams.push(v); return `$${iParams.length}`; };

        if (b.condition   !== undefined) iCols.push(`condition = ${iPush(b.condition)}`);
        if (b.unit_value  !== undefined) iCols.push(`unit_value = ${iPush(b.unit_value)}`);
        if (b.location_id !== undefined) iCols.push(`location_id = ${iPush(b.location_id)}`);

        if (iCols.length > 2) {
          iParams.push(cur.rows[0].item_id);
          await c.query(
            `UPDATE ims_items SET ${iCols.join(', ')} WHERE id = $${iParams.length}`,
            iParams,
          );
        }

        return { updated: true };
      });

      if (!result) { err(res, 404, 'VEHICLE_NOT_FOUND', 'Vehicle not found.'); return; }
      logger.info({ entity: 'IMS', action: 'VEHICLE_UPDATED', user_id: userId, record_id: idP.data.id });
      ok(res, result);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /vehicles/:id ──────────────────────────────────────────────────────
// Owner only. Hard deletes the vehicle + its base ims_items row if no movements
// or depreciation entries exist for the underlying item.

imsVehiclesRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.rlsCtx.isOwner) { err(res, 403, 'FORBIDDEN', 'This action requires Owner role.'); return; }

    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Vehicle ID must be a valid UUID.'); return; }

    const { id } = idParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      await withTenantRLS(client, req.rlsCtx, async (c) => {
        const vehicle = await c.query(
          `SELECT v.id, v.item_id, i.name FROM ims_vehicles v JOIN ims_items i ON i.id = v.item_id WHERE v.id = $1`,
          [id],
        ).then(r => r.rows[0] ?? null);
        if (!vehicle) throw Object.assign(new Error('Vehicle not found.'), { status: 404, code: 'VEHICLE_NOT_FOUND' });

        const deps = await c.query<{ movements: string; depreciation: string }>(
          `SELECT
             (SELECT count(*) FROM ims_stock_movements         WHERE item_id = $1) AS movements,
             (SELECT count(*) FROM ims_depreciation_schedules WHERE item_id = $1) AS depreciation`,
          [vehicle.item_id],
        ).then(r => r.rows[0]);

        const blocking: Record<string, number> = {};
        for (const [k, v] of Object.entries(deps)) {
          const n = Number(v);
          if (n > 0) blocking[k] = n;
        }
        if (Object.keys(blocking).length > 0) {
          throw Object.assign(
            new Error('Vehicle has dependent records and cannot be deleted.'),
            { status: 409, code: 'DEPENDENCY_EXISTS', blocking },
          );
        }

        await c.query(`DELETE FROM ims_vehicles WHERE id = $1`, [id]);
        await c.query(`DELETE FROM ims_items    WHERE id = $1`, [vehicle.item_id]);
        return vehicle.name as string;
      }).then(async (name) => {
        logger.info({ entity: 'IMS', action: 'VEHICLE_DELETED', user_id: userId, tenant_id: tenantId, record_id: id });
      });

      ok(res, { deleted: true, id });
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; blocking?: Record<string, number>; message: string };
    if (ex.status === 404) { err(res, 404, 'VEHICLE_NOT_FOUND', ex.message); return; }
    if (ex.status === 409) { res.status(409).json({ success: false, data: null, error: ex.message, code: ex.code, blocking: ex.blocking }); return; }
    next(e);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeNextService(lastServiceDate: string, intervalDays: number): string {
  const d = new Date(lastServiceDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + intervalDays);
  return d.toISOString().split('T')[0];
}
