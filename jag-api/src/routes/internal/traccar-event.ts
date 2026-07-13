// Internal webhook — Traccar event forwarder receiver.
//
// Traccar's <entry key='event.forward.url'> POSTs an event payload here whenever
// a device fires an event (geofence enter/exit, overspeed, SOS/alarm, etc.).
// We map the Traccar deviceId back to a JAG vehicle and raise an in-app
// notification (JAG bell) via enqueueNotification().
//
// NOT under /api/v1/ and NOT behind Keycloak. Protected by TRACCAR_EVENT_TOKEN
// (shared secret, Authorization: Bearer ...). Only reachable from inside the
// Docker network (Traccar → jag-api).

import { Router, type Request, type Response } from 'express';
import { commercialPool, corePool } from '../../db/index';
import { withTenantRLS, withOwnerRLS, type RLSContext } from '../../middleware/rls';
import { enqueueNotification } from '../../lib/notifications';
import { logger } from '../../lib/logger';
import { getLatestPositions } from '../../lib/traccar';

export const traccarEventRouter = Router();

const EVENT_TOKEN = process.env['TRACCAR_EVENT_TOKEN'] ?? '';

// IMS is single-tenant (JAG_HOLDINGS) — same constant the frontend uses for IMS.
const IMS_TENANT = '00000000-0000-0000-0001-000000000001';
// jag_core users.id for Robert (also the notification fallback recipient).
const SYSTEM_USER = process.env['NOTIFY_OWNER_USER_ID'] ?? '95ca3f77-60ba-4a0f-af70-2832b247b525';

const SYSTEM_CTX: RLSContext = {
  userId: SYSTEM_USER, tenantId: IMS_TENANT, isOwner: false, ownerId: SYSTEM_USER,
};

// Event types worth surfacing, mapped to a human label + notification tier.
const ALERT_EVENTS: Record<string, { label: string; tier: 1 | 2 | 3 }> = {
  geofenceEnter:   { label: 'entered a geofence',  tier: 1 },
  geofenceExit:    { label: 'left a geofence',     tier: 1 },
  deviceOverspeed: { label: 'is overspeeding',     tier: 1 },
  sos:             { label: 'triggered an SOS',    tier: 1 },
  alarm:           { label: 'raised an alarm',     tier: 1 },
};

interface TraccarForwardPayload {
  event?: { type?: string; deviceId?: number; geofenceId?: number; attributes?: Record<string, unknown> };
  device?: { id?: number; name?: string; uniqueId?: string };
  geofence?: { id?: number; name?: string };
  position?: { latitude?: number; longitude?: number };
}

// ── POST /internal/gps/battery-sync ──────────────────────────────────────────
// Called hourly by gps-battery-monitor.sh cron.
// Fetches latest positions from Traccar, extracts batteryLevel attribute,
// writes a reading for each registered tracker, and fires a low-battery
// notification (≤20%) if the last alert was >8h ago.

const BATTERY_SYNC_TOKEN = process.env['TRACCAR_EVENT_TOKEN'] ?? '';
const LOW_BATTERY_THRESHOLD = 20;

export const batterySyncRouter = Router();

batterySyncRouter.post('/', (req: Request, res: Response): void => {
  if (BATTERY_SYNC_TOKEN) {
    const auth = req.headers['authorization'] ?? '';
    if (auth !== `Bearer ${BATTERY_SYNC_TOKEN}`) { res.status(401).end(); return; }
  }

  res.status(200).json({ ok: true });

  void (async () => {
    try {
      const positions = await getLatestPositions();
      if (positions.length === 0) return;

      // Build a map deviceId → {batteryLevel, charging}
      const batteryMap = new Map<number, { level: number; charging: boolean }>();
      for (const pos of positions) {
        const raw = pos.attributes?.['batteryLevel'];
        if (raw === undefined || raw === null) continue;
        const level = Math.round(Number(raw));
        if (isNaN(level) || level < 0 || level > 100) continue;
        // Traccar reports 'charge' or 'motion' in attributes; some protocols send 'power' > 100 when on external
        const charging = Boolean(pos.attributes?.['charge'] ?? (Number(raw) > 100));
        batteryMap.set(pos.deviceId, { level: Math.min(level, 100), charging });
      }

      if (batteryMap.size === 0) {
        logger.info({ entity: 'GPS_BATTERY', action: 'SYNC_NO_DATA', note: 'No batteryLevel attributes in Traccar positions' });
        return;
      }

      const client = await commercialPool.connect();
      try {
        await withTenantRLS(client, SYSTEM_CTX, async (c) => {
          // Fetch all trackers that have a Traccar device id
          const trackers = await c.query<{
            id: string; traccar_device_id: number; device_serial: string;
            vehicle_id: string | null; registration_number: string | null;
          }>(
            `SELECT t.id, t.traccar_device_id, t.device_serial, t.vehicle_id, v.registration_number
             FROM   gps_trackers t
             LEFT   JOIN ims_vehicles v ON v.id = t.vehicle_id
             WHERE  t.traccar_device_id IS NOT NULL AND t.status != 'RETIRED'`,
          ).then(r => r.rows);

          for (const tracker of trackers) {
            const bat = batteryMap.get(tracker.traccar_device_id);
            if (!bat) continue;

            // Insert reading
            await c.query(
              `INSERT INTO gps_battery_log (tenant_id, tracker_id, traccar_device_id, battery_level, is_charging)
               VALUES ($1, $2, $3, $4, $5)`,
              [IMS_TENANT, tracker.id, tracker.traccar_device_id, bat.level, bat.charging],
            );

            logger.info({
              entity: 'GPS_BATTERY', action: 'READING', device_serial: tracker.device_serial,
              battery_level: bat.level, is_charging: bat.charging,
            });

            // Low battery alert — only if not charging and ≤ threshold
            if (!bat.charging && bat.level <= LOW_BATTERY_THRESHOLD) {
              // Dedup: check last alert within 8h
              const recent = await c.query<{ recorded_at: string }>(
                `SELECT recorded_at FROM gps_battery_log
                 WHERE  tracker_id = $1 AND battery_level <= $2 AND is_charging = false
                   AND  recorded_at > NOW() - INTERVAL '8 hours'
                 ORDER  BY recorded_at DESC LIMIT 2`,
                [tracker.id, LOW_BATTERY_THRESHOLD],
              );
              // If this is the first (just inserted) or second reading ≤ threshold within 8h,
              // only fire on the first crossing (exactly 1 row means we just crossed the threshold)
              if (recent.rows.length === 1) {
                const name = tracker.registration_number ?? tracker.device_serial;
                void enqueueNotification({
                  tier: 1,
                  title: `GPS battery low: ${name}`,
                  body: `${name} GPS tracker battery is at ${bat.level}%. Charge soon to avoid losing tracking.`,
                  payload: {
                    kind: 'GPS_BATTERY_LOW',
                    tracker_id: tracker.id,
                    device_serial: tracker.device_serial,
                    vehicle_id: tracker.vehicle_id,
                    registration_number: tracker.registration_number,
                    battery_level: bat.level,
                  },
                });
              }
            }
          }
        });
      } finally { client.release(); }

      logger.info({ entity: 'GPS_BATTERY', action: 'SYNC_COMPLETE', trackers_checked: batteryMap.size });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.warn({ entity: 'GPS_BATTERY', action: 'SYNC_FAILED', error: errMsg });

      // This route responds 200 before any DB work runs (fire-and-forget for
      // the cron, above), so a failure here was previously invisible outside
      // this WARN log line — 4 straight hourly failures went unnoticed during
      // a transient jag_app credential mismatch on 2026-07-13 until found by
      // chance while investigating an unrelated issue. Surface it to the
      // owner; dedup to one alert per 3h so a sustained outage doesn't spam.
      try {
        const recentAlert = await withOwnerRLS(corePool, SYSTEM_USER, (c) =>
          c.query(
            `SELECT id FROM notification_queue
             WHERE payload->>'kind' = 'GPS_BATTERY_SYNC_FAILED'
               AND created_at > NOW() - INTERVAL '3 hours'
             LIMIT 1`,
          ),
        );
        if (recentAlert.rows.length === 0) {
          void enqueueNotification({
            tier: 1,
            title: 'GPS battery sync failing',
            body: `Hourly GPS battery sync has been failing: ${errMsg}`,
            payload: { kind: 'GPS_BATTERY_SYNC_FAILED', error: errMsg },
          });
        }
      } catch {
        // Dedup check itself failed (e.g. corePool also unreachable) — fire
        // anyway; a duplicate alert beats total silence on a real outage.
        void enqueueNotification({
          tier: 1,
          title: 'GPS battery sync failing',
          body: `Hourly GPS battery sync has been failing: ${errMsg}`,
          payload: { kind: 'GPS_BATTERY_SYNC_FAILED', error: errMsg },
        });
      }
    }
  })();
});

// ── POST /internal/traccar-event ──────────────────────────────────────────────

traccarEventRouter.post('/', (req: Request, res: Response): void => {
  // Validate shared secret
  if (EVENT_TOKEN) {
    const auth = req.headers['authorization'] ?? '';
    if (auth !== `Bearer ${EVENT_TOKEN}`) { res.status(401).end(); return; }
  }

  // Always ack fast; do the lookup + notification fire-and-forget so Traccar's
  // forwarder is never blocked or retried by us.
  res.status(200).end();

  const payload = req.body as TraccarForwardPayload;
  const type = payload.event?.type ?? '';
  const deviceId = payload.event?.deviceId ?? payload.device?.id;
  const mapping = ALERT_EVENTS[type];
  if (!mapping || !deviceId) return;

  void (async () => {
    try {
      // Resolve deviceId → vehicle (single-tenant IMS lookup with explicit ctx)
      const client = await commercialPool.connect();
      let vehicle: { vehicle_id: string | null; registration_number: string | null } | null = null;
      try {
        vehicle = await withTenantRLS(client, SYSTEM_CTX, async (c) =>
          c.query<{ vehicle_id: string | null; registration_number: string | null }>(
            `SELECT t.vehicle_id, v.registration_number
             FROM   gps_trackers t
             LEFT   JOIN ims_vehicles v ON v.id = t.vehicle_id
             WHERE  t.traccar_device_id = $1
             LIMIT  1`,
            [deviceId],
          ).then(r => r.rows[0] ?? null),
        );
      } finally { client.release(); }

      const who = vehicle?.registration_number
        ?? payload.device?.name
        ?? `Device ${deviceId}`;
      const geofenceName = payload.geofence?.name;
      const label = mapping.label;
      const detail = geofenceName && type.startsWith('geofence') ? ` (${geofenceName})` : '';

      void enqueueNotification({
        tier: mapping.tier,
        title: `GPS alert: ${who}`,
        body: `${who} ${label}${detail}.`,
        payload: {
          kind: 'GPS_EVENT',
          event_type: type,
          vehicle_id: vehicle?.vehicle_id ?? null,
          registration_number: vehicle?.registration_number ?? null,
          traccar_device_id: deviceId,
          geofence: geofenceName ?? null,
          position: payload.position ?? null,
        },
      });

      logger.info({ entity: 'TRACCAR_EVENT', action: type, traccar_device_id: deviceId, vehicle_id: vehicle?.vehicle_id ?? null });
    } catch (e) {
      logger.warn({ entity: 'TRACCAR_EVENT', action: 'HANDLE_FAILED', error: e instanceof Error ? e.message : String(e) });
    }
  })();
});
