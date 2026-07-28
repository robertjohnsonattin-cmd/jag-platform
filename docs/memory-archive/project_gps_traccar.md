---
name: project-gps-traccar
description: "GPS vehicle tracking via self-hosted Traccar — architecture, fleet, battery monitoring, cron ops"
metadata: 
  node_type: memory
  type: project
  originSessionId: c0d224b4-5bdc-4a22-983f-f18a7a1ab188
---

GPS for the vehicle fleet is delivered by a **self-hosted Traccar** container (golden rule: you own everything), NOT lat/lng columns in jag_commercial. **Traccar = source of truth** (positions/history/geofences/events); **jag-api is a thin proxy** (`jag-api/src/lib/traccar.ts` + `routes/ims/vms-gps.ts`). Devices report directly to Traccar over the internet → a JAG-app outage never stops collection; Traccar's own UI (`traccar.jagcorporate.com`) + the **Traccar Manager** phone app are an independent fallback.

**Why Traccar over alternatives:** devices are TKSTAR-family (TK918-4GSA/TK905B-4G/JTK905B-4G; one Q8). They report to ONE server only (no dual-server), so keeping Winnies AND adding ours is impossible → full cutover. No added cost: SIM top-up ($10/3mo) unchanged, Traccar free, runs on the existing Always-Free VM.

**CUTOVER LEARNINGS (2026-06-25, learned the hard way):** (1) **TWO protocols by model** — TK905B/JTK905B = **JT808** (`jt808` decoder, container 5015, **host 5013→5015**, uniqueId 12-digit ZERO-PADDED e.g. `009590028504`); TK918-4GSA = **watch** (`[SG*serial*…]` text, `watch` decoder, container 5093, **host 5023→5093**, uniqueId = **BARE serial** e.g. `9189000796`). Q8=gt06 (deferred, needs a 3rd port). Wrong format → `WARN: Unknown device`, nothing stored. (2) **Don't** use Traccar `HUABAO_PORT`/`H02_PORT` env overrides — bind-conflict, silently leave host port empty (external shows closed). Use host→container port remap in compose `ports:` instead. (3) Native PG needs `host traccar traccar_app 172.16.0.0/12 scram-sha-256` in pg_hba.conf or Traccar crash-loops. (4) **ALL trackers battery-powered + sleep** — only connect/fix while MOVING; an `adminip` SMS alone won't reliably wake a parked unit. (5) **Don't restart Traccar once devices are connected** — they back off and won't reconnect until they next move. (6) TK918s report every 1–5 seconds when moving (real-time route quality); TK905B (PDZ 7719) defaults to ~30–60 min heartbeat only → sparse dots. To fix PDZ: `upload123456 30`, `sleep123456 1`, `dormancy123456 3600`. (7) TEF 5411 battery died mid-cutover (brief adminip ok, brief data frames, then offline) — plugged in to charge 2026-06-26, will auto-reconnect when charged.

**Engine icon on PDZ 7719 (JT808 protocol):** The engine/ignition icon in Traccar is triggered by the JT808 protocol's ignition status field, which PDZ 7719's TK905B reports via its internal accelerometer/vibration sensor — NOT from a hardwired ACC connection. The device is fully battery-powered. No extra battery drain from this field; it's just a protocol feature.

**Data model — trackers are reusable assets that move between vehicles** (disposed-vehicle reassignment + spares): `gps_trackers` registry (migration 036, jag_commercial, tenant RLS) with a changeable `vehicle_id` assignment, NOT a fixed column on `ims_vehicles`. `traccar_device_id` = Traccar's numeric id, captured after first connect. Per-vehicle gps routes resolve the ASSIGNED tracker → its traccar_device_id → Traccar. Geofence WKT built server-side as `CIRCLE (lat lng, radius)` (lat-lng order per Traccar). `routes/internal/traccar-event.ts` (Bearer `TRACCAR_EVENT_TOKEN`) receives Traccar event-forwards → maps deviceId→vehicle → `enqueueNotification()` → JAG bell.

**Frontend:** `jag-web/src/components/ims/VehicleGps.tsx` (Leaflet + OSM tiles, react-leaflet v5 for React 19; `CircleMarker` to avoid broken default-icon assets) — 📍 GPS modal tab + 🗺 Fleet Map + 📡 GPS Trackers in Inventory Vehicles tab. Caddy jag-web CSP img-src extended for `*.tile.openstreetmap.org`. History tab uses `FitBounds` component to auto-zoom to route extent; polyline weight 5. UI English (matches untranslated VMS modal).

**Traccar admin password:** `JAGFleet` (set by Robert in UI 2026-06-25; stored in VM `.env` as `TRACCAR_PASSWORD`). Do NOT change in Traccar UI without also updating `.env` + force-recreating api container — the 401 breaks all GPS proxy calls silently.

**Battery monitoring (session 28, 2026-06-26):**
- `gps_battery_log` table (migration `037_gps_battery_log.sql`, jag_commercial, tenant RLS) — `tracker_id FK`, `traccar_device_id`, `battery_level SMALLINT 0–100`, `is_charging BOOL`, `recorded_at`
- `POST /internal/gps/battery-sync` (`batterySyncRouter`) — fetches Traccar `/api/positions`, reads `attributes.batteryLevel` (native in watch protocol), inserts one row per tracker that has a reading; fires tier-1 `enqueueNotification` on first ≤20% crossing in 8h window
- `GET /gps/trackers/:tid/battery` — returns 168 readings (7 days), `discharge_pct_per_hour`, `estimated_hours_remaining` (from non-charging readings in last 24h)
- `gps-battery-monitor.sh` cron — runs hourly (`0 * * * *` in ubuntu crontab), POSTs to `http://localhost:3000/internal/gps/battery-sync`, logs to `/var/log/jag-gps-battery.log`
- Frontend `BatteryBar` (colour-coded: green >50%, amber 20–50%, red ≤20%, blue charging) + `BatteryDetailPanel` (SVG sparkline, discharge rate, recommended upload interval SMS) in GPS Trackers modal
- **TK918 watch protocol DOES include `batteryLevel` in Traccar position attributes** — confirmed 100% on TEF 5411 when active
- **Cron ops fix:** `TRACCAR_EVENT_TOKEN` must be in `.cron-secrets` (not just `.env`) — cron script sources `.cron-secrets`, not `.env`. Add with: `grep TRACCAR_EVENT_TOKEN /opt/jag/jag-infra/.env >> /opt/jag/jag-infra/.cron-secrets`
- **Log file:** create with ubuntu ownership so cron can write: `sudo touch /var/log/jag-gps-battery.log && sudo chown ubuntu:ubuntu /var/log/jag-gps-battery.log`
- **psql without password on VM:** use `sudo -u postgres psql -d jag_commercial` (peer auth, no password); `sudo -u postgres psql -h 127.0.0.1` requires the postgres superuser password

**Status (LIVE 2026-06-26, battery monitoring deployed):**
- PDZ 7719 (TK905B, jt808, id=1, padded `009590028504`) — REPORTING, ~30–60 min interval; pending config tune
- TEF 5411 (TK918, watch, id=2, bare `9189000802`) — battery was at 100% when active 2026-06-26
- PBH 2854 (TK918, watch, id=3, bare `9189001515`) — REPORTING, 79% battery
- TDM 9497 (TK918, watch, id=4, bare `9189000796`) — REPORTING, 95% battery
- PDT 761 spare (TK918, watch, id=5, bare `9189001437`) — unassigned (PDT 761 disposed), 96% battery
- JTK905B spare (no SIM, serial `9590000693`) — registered unassigned; port 5013, padded `009590000693` when provisioned
- Q8 spare (no SIM, serial `15300556238`) — registered unassigned; needs gt06 port (3rd Oracle port) when provisioned

**Pending config (after more trial runs):** PDZ 7719 SMS: `upload123456 30` + `sleep123456 1` + `dormancy123456 3600`.

**Battery-sync silent failure fixed (session 41, 2026-07-13):** `/internal/gps/battery-sync` responds `200 OK` to the cron before any DB work runs (fire-and-forget so cron latency isn't blocked by Traccar/DB round-trips). This meant a real failure only ever produced a `WARN` log line — the cron's own `/var/log/jag-gps-battery.log` said "sync complete (HTTP 200)" every hour regardless. 4 straight hourly failures (23:00–02:00) during a transient `jag_app` credential mismatch went completely unnoticed until found by chance while investigating an unrelated WhatsApp webhook fix. Now fires a deduped (1 per 3h) tier-1 in-app notification on `SYNC_FAILED`, mirroring the existing low-battery alert's `enqueueNotification` pattern in the same file. Verified both this new alert and the existing low-battery + geofence/event alerts by calling `enqueueNotification()` directly (low-battery) or POSTing a real signed event through the actual endpoint (geofence — see [[feedback-webhook-signature-testing-pattern]]) and confirming the bell showed it correctly, then cleaning up the test rows.

Full cutover procedure: `jag-infra/traccar/RUNBOOK.md`. Relates to [[feedback-notification-producer]], [[feedback-compose-env-precedence]], [[feedback-cron-secrets-pattern]], [[feedback-webhook-signature-testing-pattern]].
