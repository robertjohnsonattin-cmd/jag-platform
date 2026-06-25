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
import { commercialPool } from '../../db/index';
import { withTenantRLS, type RLSContext } from '../../middleware/rls';
import { enqueueNotification } from '../../lib/notifications';
import { logger } from '../../lib/logger';

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
