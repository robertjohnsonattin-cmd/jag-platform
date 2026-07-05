// VMS Increment 2 — Fuel Logs, Operating Costs, TCO Analytics
//
// GET    /api/v1/ims/vehicles/:id/fuel-logs
// POST   /api/v1/ims/vehicles/:id/fuel-logs
// DELETE /api/v1/ims/vehicles/:id/fuel-logs/:fid      (Owner only)
// GET    /api/v1/ims/vehicles/:id/operating-costs
// POST   /api/v1/ims/vehicles/:id/operating-costs
// DELETE /api/v1/ims/vehicles/:id/operating-costs/:cid (Owner only)
// GET    /api/v1/ims/vehicles/:id/tco

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS, withOwnerRLS, type RLSContext } from '../../middleware/rls';
import { commercialPool, familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const vmsCostsRouter = Router();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const UUIDParam  = z.object({ id: z.string().uuid() });
const FuelParams = z.object({ id: z.string().uuid(), fid: z.string().uuid() });
const CostParams = z.object({ id: z.string().uuid(), cid: z.string().uuid() });

const FUEL_TYPES  = ['PETROL', 'DIESEL', 'CNG', 'ELECTRIC'] as const;
const COST_TYPES  = ['TOLL', 'INSURANCE_PREMIUM', 'REGISTRATION_FEE', 'TYRE', 'WASH', 'INSPECTION_FEE', 'PARKING', 'MISC'] as const;

const CreateFuelLogSchema = z.object({
  log_date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  litres:             z.number().positive(),
  cost_per_litre_ttd: z.number().min(0),
  odometer_km:        z.number().int().min(0).optional(),
  fuel_type:          z.enum(FUEL_TYPES).default('PETROL'),
  station_name:       z.string().max(200).optional(),
  is_full_tank:       z.boolean().default(true),
  reference_type:     z.string().max(50).optional(),
  reference_id:       z.string().uuid().optional(),
  notes:              z.string().max(5000).optional(),
  idempotency_key:    z.string().uuid(),
}).strict();

const CreateOperatingCostSchema = z.object({
  cost_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cost_type:       z.enum(COST_TYPES),
  amount_ttd:      z.number().min(0),
  description:     z.string().max(500).optional(),
  vendor_name:     z.string().max(200).optional(),
  reference_type:  z.string().max(50).optional(),
  reference_id:    z.string().uuid().optional(),
  notes:           z.string().max(5000).optional(),
  idempotency_key: z.string().uuid(),
}).strict();

// ── GET /vehicles/:id/fuel-logs ───────────────────────────────────────────────
// Returns logs with computed km/L efficiency using a window function.
// Efficiency is only computed for full-tank fills; partial fills show null.

vmsCostsRouter.get('/:id/fuel-logs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }

    const vehicleId = idP.data.id;

    const client = await commercialPool.connect();
    try {
      const { rows, summary } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const dataRes = await c.query(
          `SELECT f.id, f.log_date, f.odometer_km, f.litres, f.cost_per_litre_ttd, f.total_cost_ttd,
                  f.fuel_type, f.station_name, f.is_full_tank,
                  f.reference_type, f.reference_id, f.notes, f.created_at,
                  CASE
                    WHEN f.is_full_tank AND f.odometer_km IS NOT NULL
                         AND prev.odometer_km IS NOT NULL AND f.litres > 0
                    THEN ROUND((f.odometer_km - prev.odometer_km)::numeric / f.litres, 2)
                  END AS km_per_litre
           FROM vms_fuel_logs f
           LEFT JOIN LATERAL (
             SELECT p.odometer_km
             FROM vms_fuel_logs p
             WHERE p.vehicle_id = $1
               AND p.is_full_tank = true
               AND (p.log_date, p.created_at) < (f.log_date, f.created_at)
             ORDER BY p.log_date DESC, p.created_at DESC
             LIMIT 1
           ) prev ON true
           WHERE f.vehicle_id = $1
           ORDER BY f.log_date DESC, f.created_at DESC`,
          [vehicleId],
        );

        const sumRes = await c.query<{ total_cost: string; total_litres: string; count: string }>(
          `SELECT COALESCE(SUM(total_cost_ttd), 0) AS total_cost,
                  COALESCE(SUM(litres), 0)        AS total_litres,
                  count(*)                         AS count
           FROM vms_fuel_logs WHERE vehicle_id = $1`,
          [vehicleId],
        );
        const s = sumRes.rows[0];

        return {
          rows: dataRes.rows,
          summary: {
            total_cost_ttd: parseFloat(String(s.total_cost)),
            total_litres:   parseFloat(String(s.total_litres)),
            count:          Number(s.count),
          },
        };
      });

      res.json(ok({ fuel_logs: rows, summary }));
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /vehicles/:id/fuel-logs ──────────────────────────────────────────────

vmsCostsRouter.post('/:id/fuel-logs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP   = UUIDParam.safeParse(req.params);
    if (!idP.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }
    const bodyP = CreateFuelLogSchema.safeParse(req.body);
    if (!bodyP.success) { res.status(422).json(err('Request body validation failed.', 'VALIDATION_ERROR')); return; }

    const b         = bodyP.data;
    const vehicleId = idP.data.id;
    const { tenantId, userId } = req.rlsCtx;

    const total = parseFloat(String(b.litres)) * parseFloat(String(b.cost_per_litre_ttd));

    const client = await commercialPool.connect();
    try {
      const { row, vehicleLabel } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const veh = await c.query(
          `SELECT id, registration_number, make, model FROM ims_vehicles WHERE id = $1`, [vehicleId],
        );
        if (veh.rows.length === 0) throw Object.assign(new Error('Vehicle not found.'), { status: 404, code: 'VEHICLE_NOT_FOUND' });
        const v = veh.rows[0];
        const label = `${v.registration_number ?? ''} — ${v.make ?? ''} ${v.model ?? ''}`.trim();

        // Update vehicle odometer if this fill has a higher reading
        if (b.odometer_km !== undefined) {
          await c.query(
            `UPDATE ims_vehicles SET current_mileage_km = GREATEST(COALESCE(current_mileage_km, 0), $1), last_modified_at = now() WHERE id = $2`,
            [b.odometer_km, vehicleId],
          );
        }

        const inserted = await c.query(
          `INSERT INTO vms_fuel_logs
             (tenant_id, vehicle_id, log_date, odometer_km, litres,
              cost_per_litre_ttd, total_cost_ttd, fuel_type, station_name, is_full_tank,
              reference_type, reference_id, notes, idempotency_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING *`,
          [
            tenantId, vehicleId, b.log_date,
            b.odometer_km ?? null, b.litres,
            b.cost_per_litre_ttd, total,
            b.fuel_type, b.station_name ?? null, b.is_full_tank,
            b.reference_type ?? null, b.reference_id ?? null,
            b.notes ?? null, b.idempotency_key, userId,
          ],
        );
        return { row: inserted.rows[0], vehicleLabel: label };
      });

      logger.info({ entity: 'VMS', action: 'FUEL_LOG_CREATED', user_id: userId, tenant_id: tenantId, record_id: row.id });

      // Auto-sync to Finance/Expenses — only for fresh manual entries (not backfills
      // already tagged with a reference, e.g. ones created from the Expenses page).
      if (!b.reference_type) {
        void autoInsertFuelExpense({
          ownerEntityId: tenantId,
          vehicleId,
          vehicleLabel,
          fuelLogId:     row.id,
          logDate:       b.log_date,
          totalCostTtd:  total,
          litres:        b.litres,
          odometerKm:    b.odometer_km,
          fuelType:      b.fuel_type,
          stationName:   b.station_name,
          rlsCtx:        req.rlsCtx,
        });
      }

      res.status(201).json(ok(row));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    if ((ex as { code?: string }).code === '23505') { res.status(409).json(err('Duplicate idempotency_key.', 'CONFLICT')); return; }
    next(e);
  }
});

// ── Auto-expense helper ────────────────────────────────────────────────────────
// Mirrors the reverse sync in finance/expenses.ts (autoInsertFuelLog) so a fill-up
// logged directly on the vehicle's Fuel & Costs tab also lands in Finance/Expenses.
// Fire-and-forget — a failure here must never block the fuel log write itself.

async function autoInsertFuelExpense(opts: {
  ownerEntityId: string;
  vehicleId:     string;
  vehicleLabel:  string;
  fuelLogId:     string;
  logDate:       string;
  totalCostTtd:  number;
  litres:        number;
  odometerKm?:   number;
  fuelType:      string;
  stationName?:  string;
  rlsCtx:        RLSContext;
}): Promise<void> {
  const { ownerEntityId, vehicleId, vehicleLabel, fuelLogId, logDate,
          totalCostTtd, litres, odometerKm, fuelType, stationName, rlsCtx } = opts;
  const client = await familyPool.connect();
  try {
    await withOwnerRLS(client, rlsCtx, (c) =>
      c.query(
        `INSERT INTO fin_expenses
           (owner_id, owner_entity_id, submitted_by, expense_date, description, payee_name,
            amount, currency, amount_ttd, payment_method, category, status, submitted_at,
            idempotency_key, linked_record_type, linked_record_id, linked_record_label,
            fuel_litres, fuel_odometer_km, fuel_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'TTD',$7,'CASH','FUEL','SUBMITTED',now(),
                 $8,'VEHICLE',$9,$10,$11,$12,$13)`,
        [rlsCtx.ownerId, ownerEntityId, rlsCtx.userId, logDate,
         `Fuel — ${vehicleLabel}`, stationName ?? null, totalCostTtd,
         fuelLogId, vehicleId, vehicleLabel, litres, odometerKm ?? null, fuelType],
      ),
    );
    logger.info({ entity: 'FINANCE', action: 'FUEL_EXPENSE_AUTO_CREATED', vehicle_id: vehicleId, fuel_log_id: fuelLogId });
  } catch (e) {
    logger.warn({ entity: 'FINANCE', action: 'FUEL_EXPENSE_AUTO_CREATE_FAILED', fuel_log_id: fuelLogId, error: String(e) });
  } finally {
    client.release();
  }
}

// ── DELETE /vehicles/:id/fuel-logs/:fid ───────────────────────────────────────

vmsCostsRouter.delete('/:id/fuel-logs/:fid', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.rlsCtx.isOwner) { res.status(403).json(err('This action requires Owner role.', 'FORBIDDEN')); return; }

    const paramsP = FuelParams.safeParse(req.params);
    if (!paramsP.success) { res.status(422).json(err('Invalid path parameters.', 'VALIDATION_ERROR')); return; }

    const { id: vehicleId, fid } = paramsP.data;
    const { userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      await withTenantRLS(client, req.rlsCtx, async (c) => {
        const del = await c.query(
          `DELETE FROM vms_fuel_logs WHERE id = $1 AND vehicle_id = $2`,
          [fid, vehicleId],
        );
        if (del.rowCount === 0) throw Object.assign(new Error('Fuel log not found.'), { status: 404, code: 'NOT_FOUND' });
      });

      logger.info({ entity: 'VMS', action: 'FUEL_LOG_DELETED', user_id: userId, record_id: fid });
      res.json(ok({ deleted: true, id: fid }));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    next(e);
  }
});

// ── GET /vehicles/:id/operating-costs ─────────────────────────────────────────

vmsCostsRouter.get('/:id/operating-costs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }

    const vehicleId = idP.data.id;

    const client = await commercialPool.connect();
    try {
      const { rows, summary } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const dataRes = await c.query(
          `SELECT id, cost_date, cost_type, amount_ttd, description,
                  vendor_name, reference_type, reference_id, notes, created_at
           FROM vms_operating_costs
           WHERE vehicle_id = $1
           ORDER BY cost_date DESC, created_at DESC`,
          [vehicleId],
        );

        const totalRes = await c.query<{ total: string }>(
          `SELECT COALESCE(SUM(amount_ttd), 0) AS total FROM vms_operating_costs WHERE vehicle_id = $1`,
          [vehicleId],
        );

        const byTypeRes = await c.query<{ cost_type: string; total: string }>(
          `SELECT cost_type, COALESCE(SUM(amount_ttd), 0)::text AS total
           FROM vms_operating_costs WHERE vehicle_id = $1
           GROUP BY cost_type ORDER BY cost_type`,
          [vehicleId],
        );

        return {
          rows: dataRes.rows,
          summary: {
            total_ttd: parseFloat(String(totalRes.rows[0].total)),
            by_type: byTypeRes.rows.map(r => ({
              cost_type: r.cost_type,
              total_ttd: parseFloat(String(r.total)),
            })),
          },
        };
      });

      res.json(ok({ operating_costs: rows, summary }));
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /vehicles/:id/operating-costs ────────────────────────────────────────

vmsCostsRouter.post('/:id/operating-costs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP   = UUIDParam.safeParse(req.params);
    if (!idP.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }
    const bodyP = CreateOperatingCostSchema.safeParse(req.body);
    if (!bodyP.success) { res.status(422).json(err('Request body validation failed.', 'VALIDATION_ERROR')); return; }

    const b         = bodyP.data;
    const vehicleId = idP.data.id;
    const { tenantId, userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const veh = await c.query(`SELECT id FROM ims_vehicles WHERE id = $1`, [vehicleId]);
        if (veh.rows.length === 0) throw Object.assign(new Error('Vehicle not found.'), { status: 404, code: 'VEHICLE_NOT_FOUND' });

        return c.query(
          `INSERT INTO vms_operating_costs
             (tenant_id, vehicle_id, cost_date, cost_type, amount_ttd,
              description, vendor_name, reference_type, reference_id, notes,
              idempotency_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING *`,
          [
            tenantId, vehicleId, b.cost_date, b.cost_type, b.amount_ttd,
            b.description ?? null, b.vendor_name ?? null,
            b.reference_type ?? null, b.reference_id ?? null,
            b.notes ?? null, b.idempotency_key, userId,
          ],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'VMS', action: 'OPERATING_COST_CREATED', user_id: userId, tenant_id: tenantId, record_id: row.id });
      res.status(201).json(ok(row));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    if ((ex as { code?: string }).code === '23505') { res.status(409).json(err('Duplicate idempotency_key.', 'CONFLICT')); return; }
    next(e);
  }
});

// ── DELETE /vehicles/:id/operating-costs/:cid ─────────────────────────────────

vmsCostsRouter.delete('/:id/operating-costs/:cid', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.rlsCtx.isOwner) { res.status(403).json(err('This action requires Owner role.', 'FORBIDDEN')); return; }

    const paramsP = CostParams.safeParse(req.params);
    if (!paramsP.success) { res.status(422).json(err('Invalid path parameters.', 'VALIDATION_ERROR')); return; }

    const { id: vehicleId, cid } = paramsP.data;
    const { userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      await withTenantRLS(client, req.rlsCtx, async (c) => {
        const del = await c.query(
          `DELETE FROM vms_operating_costs WHERE id = $1 AND vehicle_id = $2`,
          [cid, vehicleId],
        );
        if (del.rowCount === 0) throw Object.assign(new Error('Operating cost not found.'), { status: 404, code: 'NOT_FOUND' });
      });

      logger.info({ entity: 'VMS', action: 'OPERATING_COST_DELETED', user_id: userId, record_id: cid });
      res.json(ok({ deleted: true, id: cid }));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    next(e);
  }
});

// ── GET /vehicles/:id/tco ─────────────────────────────────────────────────────
// Total Cost of Ownership: purchase + maintenance + fuel + operating + depreciation.

vmsCostsRouter.get('/:id/tco', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }

    const vehicleId = idP.data.id;

    const client = await commercialPool.connect();
    try {
      const tco = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const vehRes = await c.query<{
          purchase_price: string | null; purchase_date: string | null;
          current_mileage_km: number | null; created_at: string;
          unit_value: string | null; registration_number: string; make: string; model: string;
        }>(
          `SELECT v.purchase_price, v.purchase_date, v.current_mileage_km, v.created_at,
                  i.unit_value, v.registration_number, v.make, v.model
           FROM ims_vehicles v
           JOIN ims_items i ON i.id = v.item_id
           WHERE v.id = $1`,
          [vehicleId],
        );
        if (vehRes.rows.length === 0) throw Object.assign(new Error('Vehicle not found.'), { status: 404, code: 'VEHICLE_NOT_FOUND' });

        const veh = vehRes.rows[0];

        const maintRes = await c.query<{ total: string }>(
          `SELECT COALESCE(SUM(total_cost_ttd), 0)::text AS total
           FROM vms_work_orders WHERE vehicle_id = $1 AND status = 'COMPLETE'`,
          [vehicleId],
        );

        const fuelRes = await c.query<{ total: string; total_litres: string }>(
          `SELECT COALESCE(SUM(total_cost_ttd), 0)::text AS total,
                  COALESCE(SUM(litres), 0)::text AS total_litres
           FROM vms_fuel_logs WHERE vehicle_id = $1`,
          [vehicleId],
        );

        const opRes = await c.query<{ total: string }>(
          `SELECT COALESCE(SUM(amount_ttd), 0)::text AS total
           FROM vms_operating_costs WHERE vehicle_id = $1`,
          [vehicleId],
        );

        const deprRes = await c.query<{ total: string; net_book_value: string | null }>(
          `SELECT COALESCE(SUM(de.depreciation_amount), 0)::text AS total,
                  (SELECT net_book_value FROM ims_depreciation_entries de2
                   JOIN ims_depreciation_schedules ds2 ON ds2.id = de2.schedule_id
                   JOIN ims_vehicles v2 ON v2.item_id = ds2.item_id
                   WHERE v2.id = $1
                   ORDER BY de2.period_end DESC LIMIT 1)::text AS net_book_value
           FROM ims_depreciation_entries de
           JOIN ims_depreciation_schedules ds ON ds.id = de.schedule_id
           JOIN ims_vehicles v ON v.item_id = ds.item_id
           WHERE v.id = $1`,
          [vehicleId],
        );

        const purchasePrice = parseFloat(String(veh.purchase_price ?? veh.unit_value ?? 0));
        const maintenance   = parseFloat(String(maintRes.rows[0].total));
        const fuel          = parseFloat(String(fuelRes.rows[0].total));
        const operating     = parseFloat(String(opRes.rows[0].total));
        const depreciation  = parseFloat(String(deprRes.rows[0].total));
        const grandTotal    = purchasePrice + maintenance + fuel + operating;

        // Months in service
        const since = veh.purchase_date ? new Date(veh.purchase_date) : new Date(veh.created_at);
        const monthsInService = Math.max(1,
          Math.floor((Date.now() - since.getTime()) / (30.44 * 24 * 3600 * 1000)),
        );

        const km = veh.current_mileage_km;

        return {
          vehicle: { registration_number: veh.registration_number, make: veh.make, model: veh.model },
          purchase_price_ttd:    purchasePrice,
          total_maintenance_ttd: maintenance,
          total_fuel_ttd:        fuel,
          total_fuel_litres:     parseFloat(String(fuelRes.rows[0].total_litres)),
          total_operating_ttd:   operating,
          total_depreciation_ttd: depreciation,
          net_book_value_ttd:    deprRes.rows[0].net_book_value ? parseFloat(String(deprRes.rows[0].net_book_value)) : null,
          grand_total_ttd:       grandTotal,
          months_in_service:     monthsInService,
          cost_per_month_ttd:    parseFloat((grandTotal / monthsInService).toFixed(2)),
          current_mileage_km:    km,
          cost_per_km_ttd:       km && km > 0 ? parseFloat((grandTotal / km).toFixed(4)) : null,
        };
      });

      res.json(ok(tco));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    next(e);
  }
});
