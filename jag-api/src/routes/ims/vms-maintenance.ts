// VMS Increment 1 — Work Orders and Preventive Maintenance Schedules
//
// GET    /api/v1/ims/vehicles/:id/work-orders
// POST   /api/v1/ims/vehicles/:id/work-orders
// GET    /api/v1/ims/vehicles/:id/work-orders/:wid
// PATCH  /api/v1/ims/vehicles/:id/work-orders/:wid
// POST   /api/v1/ims/vehicles/:id/work-orders/:wid/items
// DELETE /api/v1/ims/vehicles/:id/work-orders/:wid/items/:iid
// GET    /api/v1/ims/vehicles/:id/pm-schedules
// POST   /api/v1/ims/vehicles/:id/pm-schedules
// PATCH  /api/v1/ims/vehicles/:id/pm-schedules/:sid

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { createAllDayCalendarEvent, deleteCalendarEvent } from '../../lib/google-calendar';

export const vmsMaintenanceRouter = Router();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const UUIDParam  = z.object({ id:  z.string().uuid() });
const WOParams   = z.object({ id:  z.string().uuid(), wid: z.string().uuid() });
const WOItemParams = z.object({ id: z.string().uuid(), wid: z.string().uuid(), iid: z.string().uuid() });
const PMParams   = z.object({ id:  z.string().uuid(), sid: z.string().uuid() });

const WO_STATUSES = ['OPEN', 'IN_PROGRESS', 'AWAITING_PARTS', 'COMPLETE', 'CANCELLED'] as const;
const WO_TYPES    = ['PREVENTIVE', 'CORRECTIVE', 'EMERGENCY'] as const;
const ITEM_TYPES  = ['PARTS', 'LABOUR', 'MISC'] as const;
const PM_TRIGGERS = ['DATE', 'MILEAGE', 'ENGINE_HOURS'] as const;

const CreateWoSchema = z.object({
  wo_type:               z.enum(WO_TYPES),
  description:           z.string().min(1).max(5000),
  pm_schedule_id:        z.string().uuid().optional(),
  scheduled_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vendor_name:           z.string().max(200).optional(),
  vendor_ref:            z.string().max(100).optional(),
  odometer_at_service:   z.number().int().min(0).optional(),
  engine_hours_at_service: z.number().min(0).optional(),
  reference_type:        z.string().max(50).optional(),
  reference_id:          z.string().uuid().optional(),
  notes:                 z.string().max(5000).optional(),
  idempotency_key:       z.string().uuid(),
}).strict();

const PatchWoSchema = z.object({
  status:                z.enum(WO_STATUSES).optional(),
  description:           z.string().min(1).max(5000).optional(),
  scheduled_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vendor_name:           z.string().max(200).optional(),
  vendor_ref:            z.string().max(100).optional(),
  odometer_at_service:   z.number().int().min(0).optional(),
  engine_hours_at_service: z.number().min(0).optional(),
  reference_type:        z.string().max(50).optional(),
  reference_id:          z.string().uuid().optional(),
  notes:                 z.string().max(5000).optional(),
}).strict().refine(o => Object.keys(o).length > 0, 'No fields to update');

const CreateWoItemSchema = z.object({
  item_type:     z.enum(ITEM_TYPES),
  description:   z.string().min(1).max(500),
  qty:           z.number().positive().default(1),
  unit_cost_ttd: z.number().min(0),
  ims_item_id:   z.string().uuid().optional(),
}).strict();

const CreatePmSchema = z.object({
  schedule_name: z.string().min(1).max(200),
  trigger_type:  z.enum(PM_TRIGGERS),
  interval_days:  z.number().int().min(1).optional(),
  interval_km:    z.number().int().min(1).optional(),
  interval_hours: z.number().min(0.1).optional(),
  last_done_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  last_done_km:    z.number().int().min(0).optional(),
  last_done_hours: z.number().min(0).optional(),
  notes:          z.string().max(5000).optional(),
}).strict().superRefine((val, ctx) => {
  if (val.trigger_type === 'DATE'         && !val.interval_days)  ctx.addIssue({ code: 'custom', message: 'interval_days required when trigger_type is DATE' });
  if (val.trigger_type === 'MILEAGE'      && !val.interval_km)    ctx.addIssue({ code: 'custom', message: 'interval_km required when trigger_type is MILEAGE' });
  if (val.trigger_type === 'ENGINE_HOURS' && !val.interval_hours) ctx.addIssue({ code: 'custom', message: 'interval_hours required when trigger_type is ENGINE_HOURS' });
});

const PatchPmSchema = z.object({
  schedule_name:  z.string().min(1).max(200).optional(),
  interval_days:  z.number().int().min(1).optional(),
  interval_km:    z.number().int().min(1).optional(),
  interval_hours: z.number().min(0.1).optional(),
  last_done_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  last_done_km:    z.number().int().min(0).optional(),
  last_done_hours: z.number().min(0).optional(),
  is_active:      z.boolean().optional(),
  notes:          z.string().max(5000).optional(),
}).strict().refine(o => Object.keys(o).length > 0, 'No fields to update');

// ── Helpers ───────────────────────────────────────────────────────────────────

interface PmRow {
  trigger_type:   string;
  interval_days:  number | null;
  interval_km:    number | null;
  interval_hours: string | null;
}

function computePmNext(pm: PmRow, lastDate: string | null, lastKm: number | null, lastHours: number | null) {
  let nextDate:  string | null = null;
  let nextKm:    number | null = null;
  let nextHours: number | null = null;

  if (pm.trigger_type === 'DATE' && pm.interval_days && lastDate) {
    const d = new Date(lastDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + pm.interval_days);
    nextDate = d.toISOString().split('T')[0];
  }
  if (pm.trigger_type === 'MILEAGE' && pm.interval_km !== null && lastKm !== null) {
    nextKm = lastKm + pm.interval_km;
  }
  if (pm.trigger_type === 'ENGINE_HOURS' && pm.interval_hours !== null && lastHours !== null) {
    nextHours = parseFloat(String(pm.interval_hours)) + lastHours;
  }
  return { nextDate, nextKm, nextHours };
}

function isOverdue(
  triggerType: string,
  nextDate: string | null,
  nextKm: number | null,
  nextHours: number | null,
  currentKm: number | null,
  currentHours: number | null,
): boolean {
  const today = new Date().toISOString().split('T')[0];
  if (triggerType === 'DATE'         && nextDate)  return today > nextDate;
  if (triggerType === 'MILEAGE'      && nextKm !== null   && currentKm !== null)    return currentKm >= nextKm;
  if (triggerType === 'ENGINE_HOURS' && nextHours !== null && currentHours !== null) return currentHours >= parseFloat(String(nextHours));
  return false;
}

async function recomputeWoTotals(c: import('pg').PoolClient, woId: string): Promise<void> {
  await c.query(
    `UPDATE vms_work_orders SET
       total_parts_cost_ttd  = COALESCE((SELECT SUM(total_ttd) FROM vms_work_order_items WHERE work_order_id = $1 AND item_type = 'PARTS'), 0),
       total_labour_cost_ttd = COALESCE((SELECT SUM(total_ttd) FROM vms_work_order_items WHERE work_order_id = $1 AND item_type = 'LABOUR'), 0),
       total_cost_ttd        = COALESCE((SELECT SUM(total_ttd) FROM vms_work_order_items WHERE work_order_id = $1), 0),
       last_modified_at = now()
     WHERE id = $1`,
    [woId],
  );
}

// ── GET /vehicles/:id/work-orders ─────────────────────────────────────────────

vmsMaintenanceRouter.get('/:id/work-orders', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }

    const { status, wo_type } = req.query as { status?: string; wo_type?: string };
    const vehicleId = idP.data.id;

    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const conditions: string[] = ['vehicle_id = $1'];
        const params: unknown[] = [vehicleId];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (status)  conditions.push(`status = ${push(status)}`);
        if (wo_type) conditions.push(`wo_type = ${push(wo_type)}`);

        return c.query(
          `SELECT id, wo_number, wo_type, status, description,
                  scheduled_date, started_at, completed_at,
                  vendor_name, vendor_ref,
                  odometer_at_service, engine_hours_at_service,
                  total_parts_cost_ttd, total_labour_cost_ttd, total_cost_ttd,
                  reference_type, reference_id,
                  pm_schedule_id, notes, last_modified_at, created_at
           FROM vms_work_orders
           WHERE ${conditions.join(' AND ')}
           ORDER BY created_at DESC`,
          params,
        ).then(r => r.rows);
      });

      ok(res, { work_orders: rows });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /vehicles/:id/work-orders ────────────────────────────────────────────

vmsMaintenanceRouter.post('/:id/work-orders', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }
    const bodyP = CreateWoSchema.safeParse(req.body);
    if (!bodyP.success) { res.status(422).json(err('Request body validation failed.', 'VALIDATION_ERROR')); return; }

    const b = bodyP.data;
    const vehicleId = idP.data.id;
    const { tenantId, userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const wo = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Check vehicle exists and get current status
        const vehRes = await c.query<{ status: string }>(
          `SELECT status FROM ims_vehicles WHERE id = $1`,
          [vehicleId],
        );
        if (vehRes.rows.length === 0) throw Object.assign(new Error('Vehicle not found.'), { status: 404, code: 'VEHICLE_NOT_FOUND' });

        // Generate sequential WO number within this tenant+year
        const year = new Date().getFullYear();
        const cntRes = await c.query<{ count: string }>(
          `SELECT count(*) FROM vms_work_orders WHERE tenant_id = $1 AND wo_number LIKE $2`,
          [tenantId, `WO-${year}-%`],
        );
        const seq = Number(cntRes.rows[0].count) + 1;
        const wo_number = `WO-${year}-${String(seq).padStart(4, '0')}`;

        const woRes = await c.query(
          `INSERT INTO vms_work_orders
             (tenant_id, vehicle_id, pm_schedule_id, wo_number, wo_type,
              description, scheduled_date, vendor_name, vendor_ref,
              odometer_at_service, engine_hours_at_service,
              reference_type, reference_id, notes,
              idempotency_key, created_by, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
           RETURNING *`,
          [
            tenantId, vehicleId,
            b.pm_schedule_id ?? null,
            wo_number, b.wo_type, b.description,
            b.scheduled_date ?? null,
            b.vendor_name ?? null, b.vendor_ref ?? null,
            b.odometer_at_service ?? null, b.engine_hours_at_service ?? null,
            b.reference_type ?? null, b.reference_id ?? null,
            b.notes ?? null,
            b.idempotency_key, userId,
          ],
        );

        // Auto-set vehicle to IN_MAINTENANCE for corrective/emergency work
        if (b.wo_type !== 'PREVENTIVE' && vehRes.rows[0].status === 'ACTIVE') {
          await c.query(
            `UPDATE ims_vehicles SET status = 'IN_MAINTENANCE', last_modified_at = now() WHERE id = $1`,
            [vehicleId],
          );
        }

        return woRes.rows[0];
      });

      logger.info({ entity: 'VMS', action: 'WORK_ORDER_CREATED', user_id: userId, tenant_id: tenantId, record_id: wo.id, wo_number: wo.wo_number });
      res.status(201).json(ok(wo));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string; constraint?: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    // STD-11 idempotency: duplicate key → return 409
    if ((ex as { code?: string }).code === '23505') { res.status(409).json(err('Duplicate idempotency_key or WO number.', 'CONFLICT')); return; }
    next(e);
  }
});

// ── GET /vehicles/:id/work-orders/:wid ────────────────────────────────────────

vmsMaintenanceRouter.get('/:id/work-orders/:wid', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramsP = WOParams.safeParse(req.params);
    if (!paramsP.success) { res.status(422).json(err('Invalid path parameters.', 'VALIDATION_ERROR')); return; }

    const { id: vehicleId, wid } = paramsP.data;

    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const woRes = await c.query(
          `SELECT * FROM vms_work_orders WHERE id = $1 AND vehicle_id = $2`,
          [wid, vehicleId],
        );
        if (woRes.rows.length === 0) return null;

        const itemsRes = await c.query(
          `SELECT * FROM vms_work_order_items WHERE work_order_id = $1 ORDER BY created_at`,
          [wid],
        );

        return { ...woRes.rows[0], items: itemsRes.rows };
      });

      if (!result) { res.status(404).json(err('Work order not found.', 'WORK_ORDER_NOT_FOUND')); return; }
      res.json(ok(result));
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /vehicles/:id/work-orders/:wid ─────────────────────────────────────

vmsMaintenanceRouter.patch('/:id/work-orders/:wid', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramsP = WOParams.safeParse(req.params);
    if (!paramsP.success) { res.status(422).json(err('Invalid path parameters.', 'VALIDATION_ERROR')); return; }
    const bodyP = PatchWoSchema.safeParse(req.body);
    if (!bodyP.success) { res.status(422).json(err('Request body validation failed.', 'VALIDATION_ERROR')); return; }

    const b = bodyP.data;
    const { id: vehicleId, wid } = paramsP.data;
    const { userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const { updated, calEvent } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const woRes = await c.query<{
          status: string; wo_type: string; pm_schedule_id: string | null;
          odometer_at_service: number | null; engine_hours_at_service: string | null;
        }>(
          `SELECT status, wo_type, pm_schedule_id, odometer_at_service, engine_hours_at_service
           FROM vms_work_orders WHERE id = $1 AND vehicle_id = $2`,
          [wid, vehicleId],
        );
        if (woRes.rows.length === 0) throw Object.assign(new Error('Work order not found.'), { status: 404, code: 'WORK_ORDER_NOT_FOUND' });

        const current = woRes.rows[0];
        const newStatus = b.status ?? current.status;

        if (['COMPLETE', 'CANCELLED'].includes(current.status) && b.status !== undefined) {
          throw Object.assign(new Error('Work order is already in a terminal status.'), { status: 422, code: 'TERMINAL_STATUS' });
        }

        // Build UPDATE cols for vms_work_orders
        const cols: string[] = ['last_modified_at = now()', `last_modified_by = '${userId}'`];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (b.status                !== undefined) cols.push(`status = ${push(b.status)}`);
        if (b.description           !== undefined) cols.push(`description = ${push(b.description)}`);
        if (b.scheduled_date        !== undefined) cols.push(`scheduled_date = ${push(b.scheduled_date)}`);
        if (b.vendor_name           !== undefined) cols.push(`vendor_name = ${push(b.vendor_name)}`);
        if (b.vendor_ref            !== undefined) cols.push(`vendor_ref = ${push(b.vendor_ref)}`);
        if (b.odometer_at_service   !== undefined) cols.push(`odometer_at_service = ${push(b.odometer_at_service)}`);
        if (b.engine_hours_at_service !== undefined) cols.push(`engine_hours_at_service = ${push(b.engine_hours_at_service)}`);
        if (b.reference_type        !== undefined) cols.push(`reference_type = ${push(b.reference_type)}`);
        if (b.reference_id          !== undefined) cols.push(`reference_id = ${push(b.reference_id)}`);
        if (b.notes                 !== undefined) cols.push(`notes = ${push(b.notes)}`);

        // Timestamp transitions
        if (b.status === 'IN_PROGRESS' && current.status === 'OPEN') {
          cols.push(`started_at = ${push(new Date().toISOString())}`);
        }
        if (b.status === 'COMPLETE') {
          cols.push(`completed_at = ${push(new Date().toISOString())}`);
        }

        params.push(wid);
        await c.query(
          `UPDATE vms_work_orders SET ${cols.join(', ')} WHERE id = $${params.length}`,
          params,
        );

        // Status-driven side effects
        let calEvent: { nextServiceDate: string; vehicleLabel: string; calServiceEventId: string | null } | null = null;

        if (b.status === 'IN_PROGRESS' && current.status === 'OPEN' && current.wo_type !== 'PREVENTIVE') {
          // Activate IN_MAINTENANCE on vehicle
          await c.query(
            `UPDATE ims_vehicles SET status = 'IN_MAINTENANCE', last_modified_at = now() WHERE id = $1 AND status = 'ACTIVE'`,
            [vehicleId],
          );
        }

        if (b.status === 'COMPLETE' || b.status === 'CANCELLED') {
          // Recompute vehicle status: ACTIVE if no other open WOs remain
          await c.query(
            `UPDATE ims_vehicles SET status = 'ACTIVE', last_modified_at = now()
             WHERE id = $1
               AND status = 'IN_MAINTENANCE'
               AND NOT EXISTS (
                 SELECT 1 FROM vms_work_orders
                 WHERE vehicle_id = $1
                   AND id <> $2
                   AND status NOT IN ('COMPLETE','CANCELLED')
               )`,
            [vehicleId, wid],
          );
        }

        if (b.status === 'COMPLETE') {
          // Recompute totals from items
          await recomputeWoTotals(c, wid);

          const finalOdometer = b.odometer_at_service ?? current.odometer_at_service;
          const finalEngineHours = b.engine_hours_at_service !== undefined
            ? b.engine_hours_at_service
            : (current.engine_hours_at_service !== null ? parseFloat(String(current.engine_hours_at_service)) : null);
          const serviceDate = new Date().toISOString().split('T')[0];

          // Fetch vehicle data for service log + calendar
          const vehRes = await c.query<{
            service_interval_days: number; make: string; model: string;
            registration_number: string; owner_entity: string;
            cal_service_event_id: string | null;
          }>(
            `SELECT service_interval_days, make, model, registration_number, owner_entity, cal_service_event_id
             FROM ims_vehicles WHERE id = $1`,
            [vehicleId],
          );
          const veh = vehRes.rows[0];

          // Compute next service date
          const nd = new Date(serviceDate + 'T00:00:00Z');
          nd.setUTCDate(nd.getUTCDate() + veh.service_interval_days);
          const nextServiceDate = nd.toISOString().split('T')[0];

          // Update vehicle service data
          const vUpdCols: string[] = [
            'last_service_date = $1', 'next_service_date = $2', 'last_modified_at = now()',
          ];
          const vUpdParams: unknown[] = [serviceDate, nextServiceDate];
          const vPush = (v: unknown) => { vUpdParams.push(v); return `$${vUpdParams.length}`; };
          if (finalOdometer !== null)    vUpdCols.push(`current_mileage_km = ${vPush(finalOdometer)}`);
          if (finalEngineHours !== null) vUpdCols.push(`engine_hours = ${vPush(finalEngineHours)}`);
          vUpdParams.push(vehicleId);
          await c.query(
            `UPDATE ims_vehicles SET ${vUpdCols.join(', ')} WHERE id = $${vUpdParams.length}`,
            vUpdParams,
          );

          // Insert service log entry
          await c.query(
            `INSERT INTO ims_vehicle_service_log
               (vehicle_id, tenant_id, service_date, mileage_km, service_type,
                description, next_service_date, last_modified_by)
             SELECT $1, tenant_id, $2, $3, 'OTHER', $4, $5, $6
             FROM ims_vehicles WHERE id = $1`,
            [vehicleId, serviceDate, finalOdometer, `WO ${wid}`, nextServiceDate, userId],
          );

          // Update linked PM schedule if present
          const pmId = current.pm_schedule_id;
          if (pmId) {
            const pmRes = await c.query<PmRow>(
              `SELECT trigger_type, interval_days, interval_km, interval_hours
               FROM vms_pm_schedules WHERE id = $1`,
              [pmId],
            );
            if (pmRes.rows.length > 0) {
              const pm = pmRes.rows[0];
              const { nextDate, nextKm, nextHours } = computePmNext(
                pm, serviceDate, finalOdometer, finalEngineHours,
              );
              await c.query(
                `UPDATE vms_pm_schedules SET
                   last_done_date  = $1, last_done_km = $2, last_done_hours = $3,
                   next_due_date   = $4, next_due_km  = $5, next_due_hours  = $6,
                   is_overdue      = false, last_modified_at = now()
                 WHERE id = $7`,
                [serviceDate, finalOdometer, finalEngineHours, nextDate, nextKm, nextHours, pmId],
              );
            }
          }

          calEvent = {
            nextServiceDate,
            vehicleLabel: `${veh.registration_number} — ${veh.make} ${veh.model}`,
            calServiceEventId: veh.cal_service_event_id,
          };
        }

        return { updated: true, calEvent };
      });

      if (!updated) { res.status(404).json(err('Work order not found.', 'WORK_ORDER_NOT_FOUND')); return; }
      logger.info({ entity: 'VMS', action: 'WORK_ORDER_UPDATED', user_id: userId, record_id: wid, status: b.status });

      // Non-blocking: replace service calendar event on completion
      if (calEvent) {
        const ce = calEvent;
        const rlsCtx = req.rlsCtx;
        void (async () => {
          try {
            if (ce.calServiceEventId) {
              try { await deleteCalendarEvent(ce.calServiceEventId); } catch { /* stale */ }
            }
            const evId = await createAllDayCalendarEvent({
              title: `Vehicle Service Due: ${ce.vehicleLabel}`,
              description: `Service completed via work order. Next due: ${ce.nextServiceDate}`,
              date: ce.nextServiceDate,
            });
            const c2 = await commercialPool.connect();
            try {
              await withTenantRLS(c2, rlsCtx, async (c) => {
                await c.query(
                  `UPDATE ims_vehicles SET cal_service_event_id = $1, last_modified_at = now() WHERE id = $2`,
                  [evId, vehicleId],
                );
              });
            } finally { c2.release(); }
          } catch (calErr) {
            logger.warn({ entity: 'VMS', action: 'WO_CAL_UPDATE_ERROR', error_message: (calErr as Error).message });
          }
        })();
      }

      res.json(ok({ updated: true }));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    if (ex.status === 422) { res.status(422).json(err(ex.message, ex.code ?? 'VALIDATION_ERROR')); return; }
    next(e);
  }
});

// ── POST /vehicles/:id/work-orders/:wid/items ─────────────────────────────────

vmsMaintenanceRouter.post('/:id/work-orders/:wid/items', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramsP = WOParams.safeParse(req.params);
    if (!paramsP.success) { res.status(422).json(err('Invalid path parameters.', 'VALIDATION_ERROR')); return; }
    const bodyP = CreateWoItemSchema.safeParse(req.body);
    if (!bodyP.success) { res.status(422).json(err('Request body validation failed.', 'VALIDATION_ERROR')); return; }

    const b = bodyP.data;
    const { id: vehicleId, wid } = paramsP.data;
    const { tenantId, userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const item = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Ensure WO exists and is editable
        const woRes = await c.query<{ status: string; tenant_id: string }>(
          `SELECT status, tenant_id FROM vms_work_orders WHERE id = $1 AND vehicle_id = $2`,
          [wid, vehicleId],
        );
        if (woRes.rows.length === 0) throw Object.assign(new Error('Work order not found.'), { status: 404, code: 'WORK_ORDER_NOT_FOUND' });
        if (['COMPLETE', 'CANCELLED'].includes(woRes.rows[0].status)) {
          throw Object.assign(new Error('Cannot add items to a terminal work order.'), { status: 422, code: 'TERMINAL_STATUS' });
        }

        const total = parseFloat(String(b.qty)) * parseFloat(String(b.unit_cost_ttd));

        const itemRes = await c.query(
          `INSERT INTO vms_work_order_items
             (work_order_id, tenant_id, item_type, description, qty, unit_cost_ttd, total_ttd, ims_item_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING *`,
          [wid, tenantId, b.item_type, b.description, b.qty, b.unit_cost_ttd, total, b.ims_item_id ?? null],
        );

        await recomputeWoTotals(c, wid);
        return itemRes.rows[0];
      });

      logger.info({ entity: 'VMS', action: 'WO_ITEM_ADDED', user_id: userId, record_id: wid });
      res.status(201).json(ok(item));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    if (ex.status === 422) { res.status(422).json(err(ex.message, ex.code ?? 'VALIDATION_ERROR')); return; }
    next(e);
  }
});

// ── DELETE /vehicles/:id/work-orders/:wid/items/:iid ──────────────────────────

vmsMaintenanceRouter.delete('/:id/work-orders/:wid/items/:iid', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramsP = WOItemParams.safeParse(req.params);
    if (!paramsP.success) { res.status(422).json(err('Invalid path parameters.', 'VALIDATION_ERROR')); return; }

    const { id: vehicleId, wid, iid } = paramsP.data;
    const { userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      await withTenantRLS(client, req.rlsCtx, async (c) => {
        const woRes = await c.query<{ status: string }>(
          `SELECT status FROM vms_work_orders WHERE id = $1 AND vehicle_id = $2`,
          [wid, vehicleId],
        );
        if (woRes.rows.length === 0) throw Object.assign(new Error('Work order not found.'), { status: 404, code: 'WORK_ORDER_NOT_FOUND' });
        if (['COMPLETE', 'CANCELLED'].includes(woRes.rows[0].status)) {
          throw Object.assign(new Error('Cannot remove items from a terminal work order.'), { status: 422, code: 'TERMINAL_STATUS' });
        }

        const del = await c.query(
          `DELETE FROM vms_work_order_items WHERE id = $1 AND work_order_id = $2`,
          [iid, wid],
        );
        if (del.rowCount === 0) throw Object.assign(new Error('Item not found.'), { status: 404, code: 'ITEM_NOT_FOUND' });

        await recomputeWoTotals(c, wid);
      });

      logger.info({ entity: 'VMS', action: 'WO_ITEM_DELETED', user_id: userId, record_id: iid });
      res.json(ok({ deleted: true, id: iid }));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    if (ex.status === 422) { res.status(422).json(err(ex.message, ex.code ?? 'VALIDATION_ERROR')); return; }
    next(e);
  }
});

// ── GET /vehicles/:id/pm-schedules ────────────────────────────────────────────

vmsMaintenanceRouter.get('/:id/pm-schedules', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }

    const vehicleId = idP.data.id;

    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Fetch current vehicle meters to calculate live overdue state
        const vehRes = await c.query<{ current_mileage_km: number | null; engine_hours: string | null }>(
          `SELECT current_mileage_km, engine_hours FROM ims_vehicles WHERE id = $1`,
          [vehicleId],
        );
        const currentKm    = vehRes.rows[0]?.current_mileage_km ?? null;
        const currentHours = vehRes.rows[0]?.engine_hours ? parseFloat(String(vehRes.rows[0].engine_hours)) : null;

        const pmRes = await c.query(
          `SELECT * FROM vms_pm_schedules WHERE vehicle_id = $1 ORDER BY schedule_name`,
          [vehicleId],
        );

        return pmRes.rows.map((row) => ({
          ...row,
          is_overdue: isOverdue(
            row.trigger_type as string,
            row.next_due_date as string | null,
            row.next_due_km as number | null,
            row.next_due_hours as number | null,
            currentKm,
            currentHours,
          ),
        }));
      });

      res.json(ok({ pm_schedules: rows }));
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /vehicles/:id/pm-schedules ───────────────────────────────────────────

vmsMaintenanceRouter.post('/:id/pm-schedules', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }
    const bodyP = CreatePmSchema.safeParse(req.body);
    if (!bodyP.success) { res.status(422).json(err('Request body validation failed.', 'VALIDATION_ERROR')); return; }

    const b = bodyP.data;
    const vehicleId = idP.data.id;
    const { tenantId, userId } = req.rlsCtx;

    // Compute initial next-due thresholds if last_done values provided
    const pmBase: PmRow = {
      trigger_type:   b.trigger_type,
      interval_days:  b.interval_days  ?? null,
      interval_km:    b.interval_km    ?? null,
      interval_hours: b.interval_hours ? String(b.interval_hours) : null,
    };
    const { nextDate, nextKm, nextHours } = computePmNext(
      pmBase,
      b.last_done_date  ?? null,
      b.last_done_km    ?? null,
      b.last_done_hours ?? null,
    );

    const client = await commercialPool.connect();
    try {
      const pm = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const vehCheck = await c.query(`SELECT id FROM ims_vehicles WHERE id = $1`, [vehicleId]);
        if (vehCheck.rows.length === 0) throw Object.assign(new Error('Vehicle not found.'), { status: 404, code: 'VEHICLE_NOT_FOUND' });

        return c.query(
          `INSERT INTO vms_pm_schedules
             (tenant_id, vehicle_id, schedule_name, trigger_type,
              interval_days, interval_km, interval_hours,
              last_done_date, last_done_km, last_done_hours,
              next_due_date,  next_due_km,  next_due_hours,
              notes, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING *`,
          [
            tenantId, vehicleId, b.schedule_name, b.trigger_type,
            b.interval_days ?? null, b.interval_km ?? null, b.interval_hours ?? null,
            b.last_done_date ?? null, b.last_done_km ?? null, b.last_done_hours ?? null,
            nextDate, nextKm, nextHours,
            b.notes ?? null, userId,
          ],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'VMS', action: 'PM_SCHEDULE_CREATED', user_id: userId, tenant_id: tenantId, record_id: pm.id });
      res.status(201).json(ok(pm));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    next(e);
  }
});

// ── PATCH /vehicles/:id/pm-schedules/:sid ─────────────────────────────────────

vmsMaintenanceRouter.patch('/:id/pm-schedules/:sid', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramsP = PMParams.safeParse(req.params);
    if (!paramsP.success) { res.status(422).json(err('Invalid path parameters.', 'VALIDATION_ERROR')); return; }
    const bodyP = PatchPmSchema.safeParse(req.body);
    if (!bodyP.success) { res.status(422).json(err('Request body validation failed.', 'VALIDATION_ERROR')); return; }

    const b = bodyP.data;
    const { id: vehicleId, sid } = paramsP.data;
    const { userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      await withTenantRLS(client, req.rlsCtx, async (c) => {
        const cur = await c.query<PmRow & {
          last_done_date: string | null; last_done_km: number | null; last_done_hours: string | null;
        }>(
          `SELECT trigger_type, interval_days, interval_km, interval_hours,
                  last_done_date, last_done_km, last_done_hours
           FROM vms_pm_schedules WHERE id = $1 AND vehicle_id = $2`,
          [sid, vehicleId],
        );
        if (cur.rows.length === 0) throw Object.assign(new Error('PM schedule not found.'), { status: 404, code: 'PM_NOT_FOUND' });

        const cv = cur.rows[0];

        const cols: string[] = ['last_modified_at = now()', `last_modified_by = '${userId}'`];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (b.schedule_name  !== undefined) cols.push(`schedule_name = ${push(b.schedule_name)}`);
        if (b.interval_days  !== undefined) cols.push(`interval_days = ${push(b.interval_days)}`);
        if (b.interval_km    !== undefined) cols.push(`interval_km = ${push(b.interval_km)}`);
        if (b.interval_hours !== undefined) cols.push(`interval_hours = ${push(b.interval_hours)}`);
        if (b.notes          !== undefined) cols.push(`notes = ${push(b.notes)}`);
        if (b.is_active      !== undefined) cols.push(`is_active = ${push(b.is_active)}`);

        // Recompute next-due when last_done values change
        const lastDate  = b.last_done_date  !== undefined ? b.last_done_date  : cv.last_done_date;
        const lastKm    = b.last_done_km    !== undefined ? b.last_done_km    : cv.last_done_km;
        const lastHours = b.last_done_hours !== undefined ? b.last_done_hours : (cv.last_done_hours ? parseFloat(String(cv.last_done_hours)) : null);
        const lastDoneChanged = b.last_done_date !== undefined || b.last_done_km !== undefined || b.last_done_hours !== undefined;

        if (b.last_done_date  !== undefined) cols.push(`last_done_date = ${push(b.last_done_date)}`);
        if (b.last_done_km    !== undefined) cols.push(`last_done_km = ${push(b.last_done_km)}`);
        if (b.last_done_hours !== undefined) cols.push(`last_done_hours = ${push(b.last_done_hours)}`);

        if (lastDoneChanged) {
          const mergedPm: PmRow = {
            trigger_type:   cv.trigger_type,
            interval_days:  b.interval_days  ?? cv.interval_days,
            interval_km:    b.interval_km    ?? cv.interval_km,
            interval_hours: b.interval_hours ? String(b.interval_hours) : cv.interval_hours,
          };
          const { nextDate, nextKm, nextHours } = computePmNext(mergedPm, lastDate, lastKm, typeof lastHours === 'number' ? lastHours : null);
          cols.push(`next_due_date = ${push(nextDate)}`);
          cols.push(`next_due_km = ${push(nextKm)}`);
          cols.push(`next_due_hours = ${push(nextHours)}`);
          cols.push(`is_overdue = false`);
        }

        params.push(sid);
        await c.query(
          `UPDATE vms_pm_schedules SET ${cols.join(', ')} WHERE id = $${params.length}`,
          params,
        );
      });

      logger.info({ entity: 'VMS', action: 'PM_SCHEDULE_UPDATED', user_id: userId, record_id: sid });
      res.json(ok({ updated: true }));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    next(e);
  }
});
