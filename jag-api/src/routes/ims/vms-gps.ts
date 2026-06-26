// VMS Increment 3 — GPS tracking (Traccar integration)
//
// Traccar is the source of truth for positions/history/geofences/events.
// These routes are a thin proxy: resolve the tracker currently ASSIGNED to a
// vehicle (gps_trackers registry) → its traccar_device_id → call Traccar.
//
// Per-vehicle:
//   GET    /api/v1/ims/vehicles/:id/gps/current
//   GET    /api/v1/ims/vehicles/:id/gps/history?from&to
//   GET    /api/v1/ims/vehicles/:id/gps/events?from&to
//   GET    /api/v1/ims/vehicles/:id/gps/geofences
//   POST   /api/v1/ims/vehicles/:id/gps/geofences
//   DELETE /api/v1/ims/vehicles/:id/gps/geofences/:gfid
// Fleet:
//   GET    /api/v1/ims/gps/fleet
// Tracker registry:
//   GET    /api/v1/ims/gps/trackers
//   POST   /api/v1/ims/gps/trackers
//   PATCH  /api/v1/ims/gps/trackers/:tid
//   DELETE /api/v1/ims/gps/trackers/:tid

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import type { PoolClient } from 'pg';
import {
  getLatestPosition,
  getLatestPositions,
  getHistory,
  getEvents,
  getGeofences,
  createGeofence,
  deleteGeofence,
  linkGeofence,
} from '../../lib/traccar';
import { enqueueNotification } from '../../lib/notifications';

export const vmsGpsRouter = Router();

// ── Zod schemas ─────────────────────────────────────────────────────────────────

const VehicleParam   = z.object({ id: z.string().uuid() });
const GeofenceParams = z.object({ id: z.string().uuid(), gfid: z.coerce.number().int().positive() });
const TrackerParam   = z.object({ tid: z.string().uuid() });

const WindowQuery = z.object({
  from: z.string().datetime().optional(),
  to:   z.string().datetime().optional(),
});

const CreateGeofenceSchema = z.object({
  name:     z.string().min(1).max(100),
  type:     z.enum(['circle', 'polygon']),
  center:   z.object({ lat: z.number(), lng: z.number() }).optional(),
  radius_m: z.number().positive().max(1_000_000).optional(),
  points:   z.array(z.object({ lat: z.number(), lng: z.number() })).min(3).max(200).optional(),
}).strict();

const CreateTrackerSchema = z.object({
  device_serial:     z.string().min(1).max(50),
  model:             z.string().max(50).optional(),
  protocol:          z.string().max(30).optional(),
  traccar_device_id: z.number().int().positive().optional(),
  sim_phone:         z.string().max(30).optional(),
  vehicle_id:        z.string().uuid().optional(),
  notes:             z.string().max(5000).optional(),
}).strict();

const PatchTrackerSchema = z.object({
  model:             z.string().max(50).optional(),
  protocol:          z.string().max(30).optional(),
  traccar_device_id: z.number().int().positive().nullable().optional(),
  sim_phone:         z.string().max(30).nullable().optional(),
  vehicle_id:        z.string().uuid().nullable().optional(),     // null = unassign
  status:            z.enum(['UNASSIGNED', 'ASSIGNED', 'RETIRED']).optional(),
  notes:             z.string().max(5000).optional(),
}).strict().refine(o => Object.keys(o).length > 0, 'No fields to update');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Resolve the Traccar device id for the tracker currently assigned to a vehicle.
// Throws 404 NO_TRACKER if none assigned, 409 TRACKER_NOT_REGISTERED if assigned
// but not yet linked to a Traccar device.
async function resolveDeviceId(c: PoolClient, vehicleId: string): Promise<number> {
  const r = await c.query<{ traccar_device_id: number | null }>(
    `SELECT traccar_device_id FROM gps_trackers
     WHERE vehicle_id = $1 AND status = 'ASSIGNED'
     ORDER BY last_modified_at DESC LIMIT 1`,
    [vehicleId],
  );
  if (r.rows.length === 0) {
    throw Object.assign(new Error('No GPS tracker is assigned to this vehicle.'), { status: 404, code: 'NO_TRACKER' });
  }
  const id = r.rows[0].traccar_device_id;
  if (id === null) {
    throw Object.assign(new Error('Assigned tracker is not yet registered in Traccar.'), { status: 409, code: 'TRACKER_NOT_REGISTERED' });
  }
  return id;
}

// Default to the last 24h when a window is not supplied.
function windowOrDefault(from?: string, to?: string): { from: string; to: string } {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 24 * 3600 * 1000);
  return { from: fromDate.toISOString(), to: toDate.toISOString() };
}

// Build a Traccar WKT area string from the request body (lat lon order, per Traccar).
function buildWkt(b: z.infer<typeof CreateGeofenceSchema>): string {
  if (b.type === 'circle') {
    if (!b.center || b.radius_m === undefined) {
      throw Object.assign(new Error('circle requires center and radius_m.'), { status: 422, code: 'VALIDATION_ERROR' });
    }
    return `CIRCLE (${b.center.lat} ${b.center.lng}, ${b.radius_m})`;
  }
  if (!b.points || b.points.length < 3) {
    throw Object.assign(new Error('polygon requires at least 3 points.'), { status: 422, code: 'VALIDATION_ERROR' });
  }
  const ring = [...b.points, b.points[0]]; // close the ring
  return `POLYGON ((${ring.map(p => `${p.lat} ${p.lng}`).join(', ')}))`;
}

function handleKnownError(res: Response, e: unknown, next: NextFunction): void {
  const ex = e as { status?: number; code?: string; message: string };
  if (ex.status && ex.code) { res.status(ex.status).json(err(ex.message, ex.code)); return; }
  next(e);
}

// ── GET /vehicles/:id/gps/current ─────────────────────────────────────────────

vmsGpsRouter.get('/vehicles/:id/gps/current', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const p = VehicleParam.safeParse(req.params);
    if (!p.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }

    const client = await commercialPool.connect();
    let deviceId: number;
    try {
      deviceId = await withTenantRLS(client, req.rlsCtx, (c) => resolveDeviceId(c, p.data.id));
    } finally { client.release(); }

    const position = await getLatestPosition(deviceId);
    res.json(ok({ position }));
  } catch (e) { handleKnownError(res, e, next); }
});

// ── GET /vehicles/:id/gps/history ─────────────────────────────────────────────

vmsGpsRouter.get('/vehicles/:id/gps/history', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const p = VehicleParam.safeParse(req.params);
    if (!p.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }
    const q = WindowQuery.safeParse(req.query);
    if (!q.success) { res.status(422).json(err('Invalid from/to (expect ISO datetime).', 'VALIDATION_ERROR')); return; }

    const client = await commercialPool.connect();
    let deviceId: number;
    try {
      deviceId = await withTenantRLS(client, req.rlsCtx, (c) => resolveDeviceId(c, p.data.id));
    } finally { client.release(); }

    const { from, to } = windowOrDefault(q.data.from, q.data.to);
    const points = await getHistory(deviceId, from, to);
    res.json(ok({ from, to, count: points.length, points }));
  } catch (e) { handleKnownError(res, e, next); }
});

// ── GET /vehicles/:id/gps/events ──────────────────────────────────────────────

vmsGpsRouter.get('/vehicles/:id/gps/events', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const p = VehicleParam.safeParse(req.params);
    if (!p.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }
    const q = WindowQuery.safeParse(req.query);
    if (!q.success) { res.status(422).json(err('Invalid from/to (expect ISO datetime).', 'VALIDATION_ERROR')); return; }

    const client = await commercialPool.connect();
    let deviceId: number;
    try {
      deviceId = await withTenantRLS(client, req.rlsCtx, (c) => resolveDeviceId(c, p.data.id));
    } finally { client.release(); }

    const { from, to } = windowOrDefault(q.data.from, q.data.to);
    const events = await getEvents(deviceId, from, to);
    res.json(ok({ from, to, events }));
  } catch (e) { handleKnownError(res, e, next); }
});

// ── GET /vehicles/:id/gps/geofences ───────────────────────────────────────────

vmsGpsRouter.get('/vehicles/:id/gps/geofences', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const p = VehicleParam.safeParse(req.params);
    if (!p.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }

    const client = await commercialPool.connect();
    let deviceId: number;
    try {
      deviceId = await withTenantRLS(client, req.rlsCtx, (c) => resolveDeviceId(c, p.data.id));
    } finally { client.release(); }

    const geofences = await getGeofences(deviceId);
    res.json(ok({ geofences }));
  } catch (e) { handleKnownError(res, e, next); }
});

// ── POST /vehicles/:id/gps/geofences ──────────────────────────────────────────

vmsGpsRouter.post('/vehicles/:id/gps/geofences', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const p = VehicleParam.safeParse(req.params);
    if (!p.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }
    const b = CreateGeofenceSchema.safeParse(req.body);
    if (!b.success) { res.status(422).json(err('Request body validation failed.', 'VALIDATION_ERROR')); return; }

    const client = await commercialPool.connect();
    let deviceId: number;
    try {
      deviceId = await withTenantRLS(client, req.rlsCtx, (c) => resolveDeviceId(c, p.data.id));
    } finally { client.release(); }

    const wkt = buildWkt(b.data);
    const gf = await createGeofence(b.data.name, wkt);
    await linkGeofence(deviceId, gf.id);

    logger.info({ entity: 'VMS', action: 'GEOFENCE_CREATED', user_id: req.rlsCtx.userId, vehicle_id: p.data.id, geofence_id: gf.id });
    res.status(201).json(ok({ geofence: gf }));
  } catch (e) { handleKnownError(res, e, next); }
});

// ── DELETE /vehicles/:id/gps/geofences/:gfid ──────────────────────────────────

vmsGpsRouter.delete('/vehicles/:id/gps/geofences/:gfid', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const p = GeofenceParams.safeParse(req.params);
    if (!p.success) { res.status(422).json(err('Invalid path parameters.', 'VALIDATION_ERROR')); return; }

    // Confirm the vehicle has a tracker (authorisation gate) before touching Traccar
    const client = await commercialPool.connect();
    try {
      await withTenantRLS(client, req.rlsCtx, (c) => resolveDeviceId(c, p.data.id));
    } finally { client.release(); }

    await deleteGeofence(p.data.gfid);
    logger.info({ entity: 'VMS', action: 'GEOFENCE_DELETED', user_id: req.rlsCtx.userId, vehicle_id: p.data.id, geofence_id: p.data.gfid });
    res.json(ok({ deleted: true, id: p.data.gfid }));
  } catch (e) { handleKnownError(res, e, next); }
});

// ── GET /gps/fleet ────────────────────────────────────────────────────────────
// Latest position for every vehicle that has an ASSIGNED + registered tracker.

vmsGpsRouter.get('/gps/fleet', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    let trackers: Array<{ traccar_device_id: number; vehicle_id: string; registration_number: string; make: string; model: string; item_name: string }>;
    try {
      trackers = await withTenantRLS(client, req.rlsCtx, async (c) =>
        c.query(
          `SELECT t.traccar_device_id, t.vehicle_id,
                  v.registration_number, v.make, v.model, i.name AS item_name
           FROM   gps_trackers t
           JOIN   ims_vehicles v ON v.id = t.vehicle_id
           JOIN   ims_items    i ON i.id = v.item_id
           WHERE  t.status = 'ASSIGNED' AND t.traccar_device_id IS NOT NULL`,
        ).then(r => r.rows),
      );
    } finally { client.release(); }

    // One call to Traccar for all latest positions, then join by deviceId
    const positions = await getLatestPositions().catch(() => []);
    const byDevice = new Map(positions.map(pos => [pos.deviceId, pos]));

    const fleet = trackers.map(t => {
      const pos = byDevice.get(t.traccar_device_id);
      return {
        vehicle_id: t.vehicle_id,
        registration_number: t.registration_number,
        make: t.make,
        model: t.model,
        item_name: t.item_name,
        traccar_device_id: t.traccar_device_id,
        position: pos
          ? {
              latitude: pos.latitude,
              longitude: pos.longitude,
              speed_kmh: Math.round(pos.speed * 1.852 * 10) / 10,
              course: pos.course,
              fix_time: pos.fixTime,
            }
          : null,
      };
    });

    res.json(ok({ fleet }));
  } catch (e) { handleKnownError(res, e, next); }
});

// ── GET /gps/trackers ─────────────────────────────────────────────────────────

vmsGpsRouter.get('/gps/trackers', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, async (c) =>
        c.query(
          `SELECT t.id, t.device_serial, t.model, t.protocol, t.traccar_device_id,
                  t.sim_phone, t.status, t.vehicle_id, t.notes,
                  t.last_seen_at, t.last_modified_at, t.created_at,
                  v.registration_number AS vehicle_registration,
                  i.name AS vehicle_name
           FROM   gps_trackers t
           LEFT   JOIN ims_vehicles v ON v.id = t.vehicle_id
           LEFT   JOIN ims_items    i ON i.id = v.item_id
           ORDER  BY t.status, t.device_serial`,
        ).then(r => r.rows),
      );
      res.json(ok({ trackers: rows }));
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /gps/trackers ────────────────────────────────────────────────────────

vmsGpsRouter.post('/gps/trackers', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const b = CreateTrackerSchema.safeParse(req.body);
    if (!b.success) { res.status(422).json(err('Request body validation failed.', 'VALIDATION_ERROR')); return; }

    const d = b.data;
    const { tenantId, userId } = req.rlsCtx;
    const status = d.vehicle_id ? 'ASSIGNED' : 'UNASSIGNED';

    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        if (d.vehicle_id) {
          const veh = await c.query(`SELECT id FROM ims_vehicles WHERE id = $1`, [d.vehicle_id]);
          if (veh.rows.length === 0) throw Object.assign(new Error('Vehicle not found.'), { status: 404, code: 'VEHICLE_NOT_FOUND' });
        }
        return c.query(
          `INSERT INTO gps_trackers
             (tenant_id, device_serial, model, protocol, traccar_device_id,
              sim_phone, status, vehicle_id, notes, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            tenantId, d.device_serial, d.model ?? null, d.protocol ?? null,
            d.traccar_device_id ?? null, d.sim_phone ?? null, status,
            d.vehicle_id ?? null, d.notes ?? null, userId,
          ],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'VMS', action: 'TRACKER_CREATED', user_id: userId, tenant_id: tenantId, record_id: row.id });
      res.status(201).json(ok(row));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string; constraint?: string };
    if (ex.code === '23505' || ex.constraint === 'idx_gps_trackers_serial') {
      res.status(409).json(err('A tracker with this serial already exists.', 'DUPLICATE_SERIAL')); return;
    }
    if (ex.status && ex.code) { res.status(ex.status).json(err(ex.message, ex.code)); return; }
    next(e);
  }
});

// ── PATCH /gps/trackers/:tid ──────────────────────────────────────────────────
// Assign/unassign vehicle, register traccar device id, edit SIM/notes, retire.

vmsGpsRouter.patch('/gps/trackers/:tid', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const pp = TrackerParam.safeParse(req.params);
    if (!pp.success) { res.status(422).json(err('Tracker id must be a valid UUID.', 'VALIDATION_ERROR')); return; }
    const bp = PatchTrackerSchema.safeParse(req.body);
    if (!bp.success) { res.status(422).json(err('Request body validation failed.', 'VALIDATION_ERROR')); return; }

    const b = bp.data;
    const { tid } = pp.data;
    const { userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      await withTenantRLS(client, req.rlsCtx, async (c) => {
        const cols: string[] = ['last_modified_at = now()', `last_modified_by = '${userId}'`];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (b.model             !== undefined) cols.push(`model = ${push(b.model)}`);
        if (b.protocol          !== undefined) cols.push(`protocol = ${push(b.protocol)}`);
        if (b.traccar_device_id !== undefined) cols.push(`traccar_device_id = ${push(b.traccar_device_id)}`);
        if (b.sim_phone         !== undefined) cols.push(`sim_phone = ${push(b.sim_phone)}`);
        if (b.notes             !== undefined) cols.push(`notes = ${push(b.notes)}`);

        // Vehicle (re)assignment drives status unless an explicit status is given.
        if (b.vehicle_id !== undefined) {
          if (b.vehicle_id === null) {
            cols.push(`vehicle_id = NULL`);
            if (b.status === undefined) cols.push(`status = 'UNASSIGNED'`);
          } else {
            const veh = await c.query(`SELECT id FROM ims_vehicles WHERE id = $1`, [b.vehicle_id]);
            if (veh.rows.length === 0) throw Object.assign(new Error('Vehicle not found.'), { status: 404, code: 'VEHICLE_NOT_FOUND' });
            // Guard: one ASSIGNED tracker per vehicle
            const clash = await c.query(
              `SELECT id FROM gps_trackers WHERE vehicle_id = $1 AND status = 'ASSIGNED' AND id <> $2`,
              [b.vehicle_id, tid],
            );
            if (clash.rows.length > 0) throw Object.assign(new Error('Vehicle already has an assigned tracker.'), { status: 409, code: 'VEHICLE_HAS_TRACKER' });
            cols.push(`vehicle_id = ${push(b.vehicle_id)}`);
            if (b.status === undefined) cols.push(`status = 'ASSIGNED'`);
          }
        }
        if (b.status !== undefined) cols.push(`status = ${push(b.status)}`);

        params.push(tid);
        const upd = await c.query(
          `UPDATE gps_trackers SET ${cols.join(', ')} WHERE id = $${params.length}`,
          params,
        );
        if (upd.rowCount === 0) throw Object.assign(new Error('Tracker not found.'), { status: 404, code: 'NOT_FOUND' });
      });

      logger.info({ entity: 'VMS', action: 'TRACKER_UPDATED', user_id: userId, record_id: tid });
      res.json(ok({ updated: true }));
    } finally { client.release(); }
  } catch (e) { handleKnownError(res, e, next); }
});

// ── GET /gps/trackers/:tid/battery ───────────────────────────────────────────
// Returns last 168 readings (≈7 days at hourly) plus discharge stats.

vmsGpsRouter.get('/gps/trackers/:tid/battery', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const pp = TrackerParam.safeParse(req.params);
    if (!pp.success) { res.status(422).json(err('Tracker id must be a valid UUID.', 'VALIDATION_ERROR')); return; }

    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, async (c) =>
        c.query<{ battery_level: number; is_charging: boolean; recorded_at: string }>(
          `SELECT battery_level, is_charging, recorded_at
           FROM   gps_battery_log
           WHERE  tracker_id = $1
           ORDER  BY recorded_at DESC
           LIMIT  168`,
          [pp.data.tid],
        ).then(r => r.rows),
      );

      // Calculate discharge rate and estimated hours remaining using the most recent
      // non-charging window (we don't want charging periods skewing the rate).
      const nonCharging = rows.filter(r => !r.is_charging);
      let discharge_pct_per_hour: number | null = null;
      let estimated_hours_remaining: number | null = null;

      if (nonCharging.length >= 2) {
        const newest = nonCharging[0];
        // Find the furthest reading that isn't a charging session and is <= 24h old
        // to get a representative window
        const cutoff = new Date(new Date(newest.recorded_at).getTime() - 24 * 3600 * 1000);
        const window = nonCharging.filter(r => new Date(r.recorded_at) >= cutoff);
        if (window.length >= 2) {
          const oldest = window[window.length - 1];
          const hoursDiff = (new Date(newest.recorded_at).getTime() - new Date(oldest.recorded_at).getTime()) / 3_600_000;
          const pctDiff = oldest.battery_level - newest.battery_level;
          if (hoursDiff > 0 && pctDiff > 0) {
            discharge_pct_per_hour = Math.round((pctDiff / hoursDiff) * 100) / 100;
            estimated_hours_remaining = Math.round(newest.battery_level / discharge_pct_per_hour);
          }
        }
      }

      const latest = rows[0] ?? null;
      res.json(ok({
        tracker_id: pp.data.tid,
        latest_level: latest?.battery_level ?? null,
        is_charging: latest?.is_charging ?? null,
        last_recorded_at: latest?.recorded_at ?? null,
        discharge_pct_per_hour,
        estimated_hours_remaining,
        readings: rows,
      }));
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /gps/trackers/:tid ─────────────────────────────────────────────────

vmsGpsRouter.delete('/gps/trackers/:tid', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const pp = TrackerParam.safeParse(req.params);
    if (!pp.success) { res.status(422).json(err('Tracker id must be a valid UUID.', 'VALIDATION_ERROR')); return; }

    const { tid } = pp.data;
    const { userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      await withTenantRLS(client, req.rlsCtx, async (c) => {
        const del = await c.query(`DELETE FROM gps_trackers WHERE id = $1`, [tid]);
        if (del.rowCount === 0) throw Object.assign(new Error('Tracker not found.'), { status: 404, code: 'NOT_FOUND' });
      });
      logger.info({ entity: 'VMS', action: 'TRACKER_DELETED', user_id: userId, record_id: tid });
      res.json(ok({ deleted: true, id: tid }));
    } finally { client.release(); }
  } catch (e) { handleKnownError(res, e, next); }
});
