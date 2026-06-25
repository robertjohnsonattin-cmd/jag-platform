// Traccar REST client — thin proxy to the self-hosted Traccar server.
//
// Traccar is the source of truth for positions, history, geofences and events.
// jag-api never stores raw position streams; it reads them on demand from here.
//
// Auth: HTTP Basic (admin email + password). Configured via env:
//   TRACCAR_URL       e.g. http://traccar:8082   (Docker-network internal)
//   TRACCAR_USER      Traccar admin email
//   TRACCAR_PASSWORD  Traccar admin password
//
// Speeds returned by Traccar are in KNOTS; helpers below expose km/h.

import { logger } from './logger';

const KNOTS_TO_KMH = 1.852;

export interface TraccarDevice {
  id: number;
  name: string;
  uniqueId: string;            // the IMEI / serial the device announces
  status: string;              // 'online' | 'offline' | 'unknown'
  lastUpdate: string | null;
  positionId: number;
}

export interface TraccarPosition {
  id: number;
  deviceId: number;
  latitude: number;
  longitude: number;
  speed: number;               // knots (raw from Traccar)
  course: number;              // bearing degrees
  altitude: number;
  fixTime: string;
  deviceTime: string;
  serverTime: string;
  attributes: Record<string, unknown>;
}

export interface TraccarEvent {
  id: number;
  type: string;                // geofenceEnter | geofenceExit | deviceOverspeed | sos | ...
  eventTime: string;
  deviceId: number;
  geofenceId?: number;
  attributes: Record<string, unknown>;
}

export interface TraccarGeofence {
  id: number;
  name: string;
  description?: string;
  area: string;                // WKT — CIRCLE / POLYGON
}

// Position shape normalised for our API (speed in km/h)
export interface NormalisedPosition {
  latitude: number;
  longitude: number;
  speed_kmh: number;
  course: number;
  altitude: number;
  fix_time: string;
  device_id: number;
  attributes: Record<string, unknown>;
}

export function traccarConfigured(): boolean {
  return Boolean(process.env['TRACCAR_URL'] && process.env['TRACCAR_USER'] && process.env['TRACCAR_PASSWORD']);
}

function authHeader(): string {
  const user = process.env['TRACCAR_USER'] ?? '';
  const pass = process.env['TRACCAR_PASSWORD'] ?? '';
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function traccarFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = process.env['TRACCAR_URL'];
  if (!traccarConfigured()) {
    throw Object.assign(new Error('Traccar is not configured.'), { status: 503, code: 'TRACCAR_UNCONFIGURED' });
  }
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authHeader(),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.error({ entity: 'TRACCAR', action: 'API_ERROR', path, status: res.status, body: body.slice(0, 500) });
    throw Object.assign(new Error(`Traccar API error ${res.status}`), { status: 502, code: 'TRACCAR_API_ERROR' });
  }
  // DELETE endpoints return 204 with no body
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export function normalisePosition(p: TraccarPosition): NormalisedPosition {
  return {
    latitude: p.latitude,
    longitude: p.longitude,
    speed_kmh: Math.round(p.speed * KNOTS_TO_KMH * 10) / 10,
    course: p.course,
    altitude: p.altitude,
    fix_time: p.fixTime,
    device_id: p.deviceId,
    attributes: p.attributes ?? {},
  };
}

// ── Devices & positions ─────────────────────────────────────────────────────────

export function getDevices(): Promise<TraccarDevice[]> {
  return traccarFetch<TraccarDevice[]>('/api/devices');
}

// Latest position for every device the admin can see (used by the fleet map)
export function getLatestPositions(): Promise<TraccarPosition[]> {
  return traccarFetch<TraccarPosition[]>('/api/positions');
}

// Latest position for a single device
export async function getLatestPosition(deviceId: number): Promise<NormalisedPosition | null> {
  const all = await getLatestPositions();
  const p = all.find(x => x.deviceId === deviceId);
  return p ? normalisePosition(p) : null;
}

// Position history (trip replay) for a device within a window
export async function getHistory(deviceId: number, from: string, to: string): Promise<NormalisedPosition[]> {
  const qs = `deviceId=${deviceId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const rows = await traccarFetch<TraccarPosition[]>(`/api/positions?${qs}`);
  return rows.map(normalisePosition);
}

// Events (geofence crossings, overspeed, SOS, etc.) for a device within a window
export function getEvents(deviceId: number, from: string, to: string): Promise<TraccarEvent[]> {
  const qs = `deviceId=${deviceId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return traccarFetch<TraccarEvent[]>(`/api/reports/events?${qs}`);
}

// ── Geofences ─────────────────────────────────────────────────────────────────

// Geofences linked to a specific device (Traccar filters by ?deviceId=)
export function getGeofences(deviceId?: number): Promise<TraccarGeofence[]> {
  const qs = deviceId ? `?deviceId=${deviceId}` : '';
  return traccarFetch<TraccarGeofence[]>(`/api/geofences${qs}`);
}

export function createGeofence(name: string, area: string, description?: string): Promise<TraccarGeofence> {
  return traccarFetch<TraccarGeofence>('/api/geofences', {
    method: 'POST',
    body: JSON.stringify({ name, area, description: description ?? '' }),
  });
}

export function deleteGeofence(geofenceId: number): Promise<void> {
  return traccarFetch<void>(`/api/geofences/${geofenceId}`, { method: 'DELETE' });
}

// Link / unlink a geofence to a device so Traccar evaluates crossings + fires events
export function linkGeofence(deviceId: number, geofenceId: number): Promise<void> {
  return traccarFetch<void>('/api/permissions', {
    method: 'POST',
    body: JSON.stringify({ deviceId, geofenceId }),
  });
}
