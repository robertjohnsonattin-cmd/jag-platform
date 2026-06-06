// GET /api/v1/ims/vehicles

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const imsVehiclesRouter = Router();

const VehiclesQuerySchema = z.object({
  fleet_type: z.enum(['JABCO_FLEET', 'PERSONAL_FLEET']).optional(),
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

// ── GET /vehicles ─────────────────────────────────────────────────────────────
//
// Returns the vehicle fleet joined with the base ims_item record.
// fleet_type filter: JABCO_FLEET (construction equipment + trucks) | PERSONAL_FLEET.

imsVehiclesRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = VehiclesQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }

    const { fleet_type, page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const client = await commercialPool.connect();
    try {
      const { rows, total } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const conditions: string[] = ['i.is_active = true'];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (fleet_type) conditions.push(`v.fleet_type = ${push(fleet_type)}`);
        const where = conditions.join(' AND ');

        const countResult = await c.query<{ count: string }>(
          `SELECT count(*)
           FROM   ims_vehicles v
           JOIN   ims_items    i ON i.id = v.item_id
           WHERE  ${where}`,
          params,
        );

        const dataResult = await c.query(
          `SELECT v.id, v.fleet_type, v.registration_number, v.make, v.model,
                  v.year, v.colour, v.vehicle_type, v.fuel_type,
                  v.vin, v.engine_number,
                  v.insurance_policy_number, v.insurance_provider, v.insurance_expiry,
                  v.registration_expiry, v.purchase_date, v.purchase_price,
                  v.current_mileage_km, v.assigned_to_user_id,
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
           JOIN   ims_locations l ON l.id   = i.location_id
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
