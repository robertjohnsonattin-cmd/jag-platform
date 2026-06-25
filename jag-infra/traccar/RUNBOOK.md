# Traccar GPS — deployment & device cutover runbook

Self-hosted Traccar is the source of truth for vehicle GPS. jag-api proxies it; the
JAG VMS shows a GPS tab + Fleet Map; geofence/overspeed/SOS events flow into the JAG
notification bell. Traccar's own UI (`traccar.jagcorporate.com`) + the **Traccar Manager**
phone app are an independent fallback if the JAG app is down.

Devices report **directly** to Traccar, so a JAG-app outage never stops collection.

---

## 1. Provision the Traccar database (native PostgreSQL on the VM)

Traccar runs its own schema migrations on first boot — just give it an empty DB + owner.

```bash
sudo -u postgres psql -h 127.0.0.1 <<'SQL'
CREATE USER traccar_app WITH PASSWORD '<choose-strong-pw>';
CREATE DATABASE traccar OWNER traccar_app;
SQL
```

## 2. Add env vars to /opt/jag/jag-infra/.env

```
# Traccar DB (native PG)
TRACCAR_DB_URL=jdbc:postgresql://host.docker.internal:5432/traccar
TRACCAR_DB_USER=traccar_app
TRACCAR_DB_PASSWORD=<the password from step 1>

# jag-api → Traccar REST (admin account created in step 5)
TRACCAR_URL=http://traccar:8082
TRACCAR_USER=<traccar admin email>
TRACCAR_PASSWORD=<traccar admin password>

# Shared secret: Traccar event-forward → jag-api internal webhook
TRACCAR_EVENT_TOKEN=<generate: openssl rand -hex 24>
```

> ⚠ Do NOT `set -a; . .env` before `docker compose` — shell env overrides the .env file and
> silently no-ops changes. Use `docker compose up -d --force-recreate` and verify with
> `docker compose exec traccar printenv | grep DATABASE`. (See feedback-compose-env-precedence.)

## 3. Open the device ports (the easy-to-forget step)

The trackers connect from the internet, so **both** protocol ports must be reachable:

- **Oracle Cloud → Security List** (VCN subnet): add ingress rules — TCP **5013** and **5023**, source `0.0.0.0/0`.
- **VM firewall**: `sudo ufw allow 5013/tcp && sudo ufw allow 5023/tcp`

(8082 stays localhost — it's reached via Caddy, not opened directly.)

## 4. DNS for the Traccar UI

Add a Cloudflare DNS record `traccar.jagcorporate.com` → the VM IP (proxied or DNS-only;
the wildcard cert already covers it). The Caddyfile block is already in place.

## 5. Start Traccar + create the admin account

```bash
cd /opt/jag/jag-infra
docker compose up -d traccar
docker compose logs -f traccar   # wait for "Started ... ServerManager"
```

First-run admin: open `https://traccar.jagcorporate.com`, register the **first** account
(it becomes admin). Put that email/password into `.env` as `TRACCAR_USER`/`TRACCAR_PASSWORD`,
then recreate the API so it can call Traccar:

```bash
docker compose up -d --force-recreate api
```

## 6. Repoint each device (per-tracker, by SMS)

Defaults: SMS password `123456`. From any phone, SMS the tracker's SIM:

```
adminip123456 150.136.151.64 5013        # tkstar units (TK918/TK905/JTK905)
adminip123456 150.136.151.64 5023        # the Q8 (gt06)
```

Expect reply `adminip ok`. Optionally set the report interval: `upload123456 30` (seconds).
Then watch Traccar pick it up:

```bash
docker compose logs -f traccar | grep -i "id:"   # device announces its id on connect
```

In the Traccar UI, add each device (Settings → Devices) using the **uniqueId** it reported
(usually the printed serial). Note Traccar's numeric **device id** for the next step.

## 7. Register trackers in JAG + assign to vehicles

In the JAG web app: **Inventory → Vehicles → 📡 GPS Trackers**. For each device, Add tracker
(serial, model, protocol, SIM, **Traccar device id**), then assign it to its vehicle. Reference fleet:

| SIM (TEL)      | Plate    | Device ID  | Model      | Protocol | Assign |
|----------------|----------|------------|------------|----------|--------|
| 1-868-373-1246 | PDZ 7719 | 9590028504 | TK905B-4G  | tkstar   | PDZ 7719 |
| 1-868-264-4856 | (PDT 761 disposed) | 9189001437 | TK918-4GSA | tkstar | leave unassigned → replacement |
| 1-868-269-0364 | TEF 5411 | 9189000802 | TK918-4GSA | tkstar   | TEF 5411 |
| 1-868-295-5734 | PBH 2854 | 9189001515 | TK918-4GSA | tkstar   | PBH 2854 |
| 1-868-296-3319 | TDM 9497 | 9189000796 | TK918-4GSA | tkstar   | TDM 9497 |
| (no SIM)       | —        | 9590000693 | TK905-4G   | tkstar   | spare (UNASSIGNED) |
| (no SIM)       | —        | 15300556238| Q8         | gt06     | spare (UNASSIGNED) |

> The printed device ID is *usually* the Traccar uniqueId, but confirm against the
> first-connect log / `imei123456` SMS. The two no-SIM spares are registered now and
> repointed + assigned later when wired into a vehicle.

## 8. Verify end-to-end

1. Traccar UI shows each repointed device **online** with a live position.
2. JAG → Vehicle → **📍 GPS** tab → live marker moves; History shows yesterday's route.
3. Draw a geofence; drive across it → JAG **notification bell** shows the alert
   (`docker compose logs api | grep TRACCAR_EVENT` confirms the webhook fired).
4. **Fallback test:** `docker compose stop api` → Traccar UI / Traccar Manager app still
   show live tracking (independent collection). `docker compose start api` to restore.

## Rollback (revert a device to the Winnies app)

SMS the device its original server: `adminip123456 <mytkstar host> <port>`. Devices report
to one server at a time, so this disconnects it from Traccar.
