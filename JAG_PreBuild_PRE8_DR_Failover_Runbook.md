# JAG Holdings — PRE-8: DR Failover Runbook
**Date:** 2026-05-24  
**Status:** ✅ DONE  
**Session scope:** Full DR runbook — detection, failover procedure, DNS cutover, service restart, re-sync, permanent role swap guidance, and Keycloak admin reset for incapacitation scenario (added PRE-10 session).

---

## DR Architecture

```
┌─────────────────────────────────┐         ┌─────────────────────────────────┐
│   Oracle AMD micro VM           │         │   Oracle Ampere VM              │
│   1 OCPU · 6 GB RAM             │         │   4 OCPU · 24 GB RAM            │
│                                 │         │                                 │
│   PostgreSQL 16 (PRIMARY)       │──WAL───▶│   PostgreSQL 16 (HOT STANDBY)  │
│     jag_core                    │         │     jag_core                    │
│     jag_commercial              │         │     jag_commercial              │
│     jag_entertainment           │         │     jag_entertainment           │
│     jag_family                  │         │     jag_family                  │
│     jag_properties              │         │     jag_properties              │
│     keycloak (DB)               │         │     keycloak (DB)               │
│                                 │         │                                 │
│   Keycloak 26.x (Docker)        │         │   Keycloak 26.x (Docker)        │
│   jag-event-dispatcher          │         │   jag-event-dispatcher          │
│   JAG API server (Phase 1)      │         │   JAG API server (Phase 1)      │
│   nginx                         │         │   nginx                         │
└─────────────────────────────────┘         └─────────────────────────────────┘
         ▲                                           ▲
         │ Cloudflare proxied (PRE-7)                │  (A records updated during failover)
         └──────── api.jabco.tt ────────────────────┘
                   auth.jabco.tt
                   jabco.tt
```

**Key assumptions (confirmed in PRE-0A):**
- All 5 JAG databases + Keycloak DB share a single PostgreSQL 16 cluster on each VM (port 5432)
- Streaming replication is asynchronous by default (see RPO note in Section 1.3)
- Keycloak and all JAG services are containerised (Docker Compose) on both VMs
- Cloudflare manages DNS (PRE-7) — DNS update is near-instant (< 1 min)

**IP address placeholders — fill in before printing this runbook:**

| Placeholder | Value |
|---|---|
| `<ORACLE_AMD_IP>` | AMD primary VM public IP |
| `<ORACLE_AMPERE_IP>` | Ampere standby VM public IP |
| `<REPLICATION_USER>` | PostgreSQL replication user (e.g. `replicator`) |

---

## 1.1 RTO / RPO Targets

| Metric | Target | Notes |
|---|---|---|
| **RPO** (data loss) | < 1 second | Async streaming; last committed txn on AMD may not reach Ampere. For zero RPO, set `synchronous_commit = remote_apply` in postgresql.conf — performance trade-off. |
| **RTO** (time to restore) | < 15 minutes | Manual procedure. Breaks down: detection 2–5 min, decision 1 min, promotion 30 s, DNS update 1 min, service restart 2–3 min, verification 2 min. |

---

## 1.2 When to Failover vs When to Wait

**Failover immediately if:**
- AMD VM is unreachable via SSH AND the public API is down for > 5 minutes
- Oracle Cloud dashboard shows AMD VM is in TERMINATED or STOPPED state
- PostgreSQL on AMD is unresponsive and cannot be restarted within 10 minutes

**Wait and diagnose if:**
- API is slow but still responding (could be load, not VM failure)
- SSH works but PostgreSQL is in recovery — wait up to 10 minutes for it to self-recover
- Oracle Cloud shows AMD VM as PROVISIONING — may recover on its own

**Never failover for:**
- A single application error (500s) — this is likely a bug, not a DB failure
- Network blip < 2 minutes — transient Oracle Cloud routing issues are common

---

## 1.3 Replication Mode Note

The Ampere standby operates in **asynchronous streaming** by default. This means:
- AMD commits transactions without waiting for Ampere to confirm receipt
- Lag is typically < 1 second under normal load
- In a sudden AMD crash, the last few committed transactions may not have reached Ampere

To switch to **synchronous replication** (RPO = 0, RTO unchanged, ~5–10% write latency cost):
```sql
-- On AMD primary, add to postgresql.conf:
synchronous_standby_names = 'ampere'
synchronous_commit = remote_apply
```
And in Ampere's `postgresql.conf` / `recovery.conf`:
```
primary_conninfo = '... application_name=ampere'
```
Recommendation: use async for Phase 0 (low traffic), upgrade to sync in Phase 1 when WiPay rent payments are live.

---

## Section 2: Detection — Health Check Script

Run this on the Ampere VM (or any external host) as a cron job or manual check:

**`/opt/jag/health-check.sh`** (create on Ampere VM):
```bash
#!/bin/bash
# JAG primary health check — run on Ampere VM
# Cron: */2 * * * * /opt/jag/health-check.sh >> /var/log/jag-health.log 2>&1

AMD_IP="<ORACLE_AMD_IP>"
TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M:%S UTC')

# Check 1: PostgreSQL primary reachability
if ! pg_isready -h "$AMD_IP" -p 5432 -U postgres -q; then
  echo "[$TIMESTAMP] ALERT: Primary PostgreSQL unreachable at $AMD_IP"
fi

# Check 2: API health endpoint
if ! curl -sf --max-time 10 https://api.jabco.tt/health > /dev/null; then
  echo "[$TIMESTAMP] ALERT: api.jabco.tt/health returned non-200 or timed out"
fi

# Check 3: Replication lag (run on Ampere standby)
LAG=$(psql -U postgres -t -c "SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::int;" 2>/dev/null | tr -d ' ')
if [ -n "$LAG" ] && [ "$LAG" -gt 60 ]; then
  echo "[$TIMESTAMP] WARNING: Replication lag is ${LAG}s — investigate primary"
fi
```

```bash
chmod +x /opt/jag/health-check.sh
# Add to crontab:
echo "*/2 * * * * /opt/jag/health-check.sh >> /var/log/jag-health.log 2>&1" | crontab -
```

---

## Section 3: Unplanned Failover Procedure

**Use this when the AMD VM is down and not recovering.**  
Steps must be executed in order. Estimated total time: 10–15 minutes.

---

### Step 3.1 — Confirm Primary is Down

```bash
# From Ampere VM or your laptop:
ssh oracle@<ORACLE_AMD_IP> "echo ok"          # Should time out
pg_isready -h <ORACLE_AMD_IP> -p 5432         # Should fail
curl -sf https://api.jabco.tt/health           # Should fail or return 502/504
```

Check Oracle Cloud dashboard: **Compute → Instances → jabco-amd-primary** — confirm state.

---

### Step 3.2 — Check Standby Replication State

```bash
# SSH into Ampere VM
ssh oracle@<ORACLE_AMPERE_IP>

# Confirm Ampere is in standby mode (not yet a primary)
sudo -u postgres psql -c "SELECT pg_is_in_recovery();"
# Expected: t (true)

# Check how far behind (replication lag at time of AMD failure)
sudo -u postgres psql -c "SELECT now() - pg_last_xact_replay_timestamp() AS lag;"
# If AMD crashed recently, lag should be < a few seconds
```

---

### Step 3.3 — Promote Ampere to Primary

```bash
# On Ampere VM:
sudo -u postgres pg_ctl promote -D /var/lib/postgresql/16/main
# Output: waiting for server to promote... server promoted

# Verify promotion
sudo -u postgres psql -c "SELECT pg_is_in_recovery();"
# Expected: f (false) — Ampere is now primary
```

> PostgreSQL 16 promotion is near-instant for a hot standby. The `standby.signal` file is removed automatically.

---

### Step 3.4 — Update Cloudflare DNS

Log in to [dash.cloudflare.com](https://dash.cloudflare.com) → your jabco.tt zone → DNS.

Update all four A records from `<ORACLE_AMD_IP>` to `<ORACLE_AMPERE_IP>`:

| Record | Old Value | New Value |
|---|---|---|
| `jabco.tt` | `<ORACLE_AMD_IP>` | `<ORACLE_AMPERE_IP>` |
| `api.jabco.tt` | `<ORACLE_AMD_IP>` | `<ORACLE_AMPERE_IP>` |
| `auth.jabco.tt` | `<ORACLE_AMD_IP>` | `<ORACLE_AMPERE_IP>` |
| `www.jabco.tt` | `<ORACLE_AMD_IP>` (if A record) | `<ORACLE_AMPERE_IP>` |

Cloudflare propagates proxied record changes in < 1 minute globally. No TTL wait.

---

### Step 3.5 — Start Services on Ampere

All JAG services should be pre-installed on the Ampere VM (configured in PRE-9). Start them:

```bash
# On Ampere VM:
cd /opt/jag

# 1. Keycloak — points to local PostgreSQL (now promoted primary)
docker compose -f docker-compose.keycloak.yml up -d

# Wait for Keycloak to be healthy
docker compose -f docker-compose.keycloak.yml ps
# Wait until: keycloak  running (healthy)

# 2. JAG event dispatcher
docker compose -f docker-compose.dispatcher.yml up -d

# 3. JAG API server (Phase 1)
docker compose -f docker-compose.api.yml up -d

# 4. nginx (if not already running)
sudo systemctl start nginx
```

> If services were already configured to auto-start on boot (via Docker restart policies), they may already be running. Check with `docker ps` first.

---

### Step 3.6 — Verify Restored Service

```bash
# API health
curl https://api.jabco.tt/health
# Expected: {"status":"ok","service":"..."}

# Keycloak OIDC discovery
curl https://auth.jabco.tt/realms/jag/.well-known/openid-configuration | head -5
# Expected: valid JSON with issuer = https://auth.jabco.tt/realms/jag

# Database write test
sudo -u postgres psql -d jag_core -c "SELECT count(*) FROM users;"
# Expected: row count (not an error)

# Event dispatcher logs
docker logs jag-event-dispatcher --tail 20
# Expected: [dispatcher] polling jag_core... no pending events (or events being processed)
```

---

### Step 3.7 — Record the Failover

Document in your ops log:
- Date/time AMD went down
- Date/time Ampere was promoted
- Estimated data loss (replication lag from Step 3.2)
- Any `pending_events` rows that need reprocessing

---

## Section 4: Planned Failover (Graceful Switchover)

Use this for maintenance or when you want to switch primaries without data loss.

### Step 4.1 — On AMD primary, stop write traffic

```bash
# Stop JAG API and dispatcher (stop new writes)
ssh oracle@<ORACLE_AMD_IP> "cd /opt/jag && docker compose -f docker-compose.api.yml stop && docker compose -f docker-compose.dispatcher.yml stop"
```

### Step 4.2 — Wait for Ampere to catch up fully

```bash
# On Ampere:
sudo -u postgres psql -c "SELECT now() - pg_last_xact_replay_timestamp() AS lag;"
# Wait until lag < 1 second (or 0)

# Confirm no pending WAL on AMD:
# On AMD:
sudo -u postgres psql -c "SELECT pg_current_wal_lsn();"
# On Ampere:
sudo -u postgres psql -c "SELECT pg_last_wal_replay_lsn();"
# Both should match
```

### Step 4.3 — Stop PostgreSQL on AMD gracefully

```bash
# On AMD:
sudo systemctl stop postgresql
```

### Step 4.4 — Promote Ampere

```bash
# On Ampere:
sudo -u postgres pg_ctl promote -D /var/lib/postgresql/16/main
```

### Steps 4.5–4.7

Follow Steps 3.4, 3.5, 3.6 (DNS update, start services, verify).

---

## Section 5: Re-Establishing Replication After AMD Recovers

After failover, Ampere is the primary. When the AMD VM comes back online, make it the **new standby** (replication roles are permanently swapped — see Note below).

---

### Step 5.1 — Stop PostgreSQL on AMD (if it self-started)

```bash
ssh oracle@<ORACLE_AMD_IP>
sudo systemctl stop postgresql
```

### Step 5.2 — Wipe AMD's data directory

```bash
# On AMD:
sudo rm -rf /var/lib/postgresql/16/main/*
```

> This is irreversible. Confirm Ampere is running and healthy before proceeding.

### Step 5.3 — Re-sync AMD from Ampere using pg_basebackup

```bash
# On AMD (re-syncs from Ampere as new primary):
sudo -u postgres pg_basebackup \
  -h <ORACLE_AMPERE_IP> \
  -U <REPLICATION_USER> \
  -D /var/lib/postgresql/16/main \
  -P \          # show progress
  -Xs \         # stream WAL during backup
  -R            # auto-create standby.signal + primary_conninfo

# -R automatically writes:
#   standby.signal file
#   primary_conninfo in postgresql.auto.conf pointing to Ampere
```

Duration: depends on database size. For a fresh JAG installation, < 5 minutes.

### Step 5.4 — Start PostgreSQL on AMD as standby

```bash
# On AMD:
sudo systemctl start postgresql

# Verify AMD is in standby mode
sudo -u postgres psql -c "SELECT pg_is_in_recovery();"
# Expected: t (true)
```

### Step 5.5 — Verify replication on Ampere

```bash
# On Ampere (now primary):
sudo -u postgres psql -c "SELECT client_addr, state, sent_lsn, replay_lsn, sync_state FROM pg_stat_replication;"
# Expected: one row showing AMD's IP, state=streaming, sync_state=async
```

---

## Permanent Role Swap Recommendation

After the first failover and re-sync:

| VM | Resources | Recommended role |
|---|---|---|
| Ampere | 4 OCPU · 24 GB RAM | **Permanent primary** |
| AMD | 1 OCPU · 6 GB RAM | **Permanent standby** |

The Ampere VM has significantly more resources. After failover it makes more sense to keep Ampere as primary and AMD as the warm standby — not switch back. Update this runbook and PRE-9 Docker Compose files to reflect the new permanent primary.

---

## Section 6: Oracle Always Free — Idle Reclamation Warning

Oracle Cloud **will reclaim Always Free instances that remain idle for 7+ consecutive days**. Both VMs must have regular activity:

**Mitigation:**
```bash
# Cron on both VMs — runs a lightweight DB query every 6 hours
# 0 */6 * * * sudo -u postgres psql -c "SELECT 1;" > /dev/null 2>&1
```

Or configure the jag-event-dispatcher polling (which runs every 5 s) as activity on the AMD primary. The Ampere standby needs its own activity source — the health-check cron (Section 2) counts.

Also ensure both VMs have the "Live Migrate" policy set correctly in Oracle Cloud Console under the instance's Availability configuration — set to **Restore instance** on infrastructure maintenance.

---

## Section 7: Quick-Reference Card

Print or save this card for use during an incident:

```
┌─────────────────────────────────────────────────────────────────┐
│ JAG HOLDINGS — FAILOVER QUICK REFERENCE                         │
├─────────────────────────────────────────────────────────────────┤
│ AMD DOWN?                                                       │
│   1. ssh oracle@<ORACLE_AMPERE_IP>                              │
│   2. sudo -u postgres pg_ctl promote -D /var/lib/postgresql/16/main │
│   3. Cloudflare DNS: change all 4 A records to <ORACLE_AMPERE_IP>│
│   4. docker compose up -d  (keycloak → dispatcher → api)       │
│   5. curl https://api.jabco.tt/health  → {"status":"ok"}       │
├─────────────────────────────────────────────────────────────────┤
│ AMD RECOVERED? (re-sync as new standby)                         │
│   1. Stop postgres on AMD                                       │
│   2. rm -rf /var/lib/postgresql/16/main/*                       │
│   3. pg_basebackup -h <ORACLE_AMPERE_IP> -U <REPLICATION_USER> │
│         -D /var/lib/postgresql/16/main -P -Xs -R               │
│   4. Start postgres on AMD                                      │
│   5. SELECT pg_is_in_recovery(); → t                           │
├─────────────────────────────────────────────────────────────────┤
│ RTO: ~10–15 min  │  RPO: < 1 sec async / 0 sync               │
└─────────────────────────────────────────────────────────────────┘
```

---

---

## Section 8: Keycloak Admin Reset — Incapacitation Scenario

This section covers emergency Keycloak access when Robert is incapacitated and cannot perform admin operations himself. It is part of the succession protocol defined in the Master Architecture.

**Who this is for:** Wife (primary designee), or brother as backup.  
**Prerequisite:** The sealed envelope — stored physically, renewed annually. Contains:
- Keycloak admin username and password
- SSH private key for Oracle AMD VM (or Ampere if failover occurred)
- Path to `.env` file on the server: `/opt/jag/jag-infra/.env`
- This runbook (printed copy)

---

### Scenario A — Standard access (sealed envelope credentials work)

1. Open a browser → `https://auth.jabco.tt/auth/admin`
2. Log in with the admin username and password from the sealed envelope
3. Navigate to **Realm: jag** (top-left dropdown — do not stay in `master` realm)

**To grant emergency_designate role to wife's account:**
- Users → search for wife's username → Role mapping → Assign role → `emergency_designate`

**To reset any user's password:**
- Users → select user → **Credentials** tab → **Reset password** → set temporary password → user must change on next login

**To remove TOTP from a user (if they are locked out):**
- Users → select user → **Required actions** tab → remove `Configure OTP` from required actions
- Users → select user → **Credentials** tab → delete any existing OTP credential

**Never do:**
- Never delete Robert's user account
- Never remove Robert's `owner` role
- Never change Robert's username or email (Keycloak uses these as identity anchors)

---

### Scenario B — Keycloak admin password unknown or rejected

The admin credentials may have expired or the sealed envelope is out of date. Use SSH to reset from the server.

```bash
# 1. SSH into the Oracle VM (use key from sealed envelope)
ssh -i sealed-envelope-key.pem oracle@<ORACLE_AMD_IP>
# If AMD is down, use: oracle@<ORACLE_AMPERE_IP>

# 2. Check that Keycloak is running
docker ps | grep keycloak
# If not running, skip to Scenario D first

# 3. Stop Keycloak
cd /opt/jag/jag-infra
docker compose stop keycloak

# 4. Restart with bootstrap admin override (Keycloak 26.x)
# This creates a TEMPORARY admin user that can reset the main admin
KC_BOOTSTRAP_ADMIN_USERNAME=emergency_admin \
KC_BOOTSTRAP_ADMIN_PASSWORD=ChangeMe_TempAdmin999! \
docker compose run --rm -e KC_BOOTSTRAP_ADMIN_USERNAME=emergency_admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=ChangeMe_TempAdmin999! keycloak start

# 5. In a separate terminal — log in to admin console with emergency_admin
# https://auth.jabco.tt/auth/admin
# Username: emergency_admin   Password: ChangeMe_TempAdmin999!

# 6. In admin console: Users → find the main admin account → Credentials → Reset password

# 7. Stop the bootstrap container (Ctrl+C in first terminal)

# 8. Restart Keycloak normally
docker compose up -d keycloak

# 9. Log in with the newly reset admin password and verify access
```

> The bootstrap admin created in step 4 is **temporary** — it disappears when Keycloak is restarted normally in step 8. Update the sealed envelope with the new admin password before sealing.

---

### Scenario C — Keycloak container is down (service restart)

```bash
ssh -i sealed-envelope-key.pem oracle@<ORACLE_AMD_IP>

# Check status
docker compose -f /opt/jag/jag-infra/docker-compose.yml ps

# Check logs for error reason
docker logs jag-keycloak --tail 50

# Restart
docker compose -f /opt/jag/jag-infra/docker-compose.yml restart keycloak

# Wait ~90 seconds for Keycloak to start, then verify:
curl -sf https://auth.jabco.tt/realms/jag/.well-known/openid-configuration | head -3
# Expected: JSON with "issuer": "https://auth.jabco.tt/realms/jag"
```

Common failure causes:
- PostgreSQL not running → `sudo systemctl start postgresql` first
- Port 8080 already in use → `sudo lsof -i :8080` to identify the process
- Out of memory (AMD VM 6 GB) → `free -h` to check; may need to restart dispatcher or minio first

---

### Scenario D — Full infrastructure down (AMD VM crashed, need Keycloak on Ampere)

1. Follow **PRE-8 Section 3** (promote Ampere to primary)
2. Follow **PRE-8 Section 3.4** (update Cloudflare DNS to Ampere IP)
3. Follow **PRE-8 Section 3.5** (start services on Ampere — includes Keycloak)
4. Verify Keycloak is accessible at `https://auth.jabco.tt/auth/admin`
5. The `keycloak` database was replicated to Ampere via WAL streaming — all users, roles, and realm config are intact

---

### Sealed Envelope — Annual Renewal Checklist

Renew every January. Replace envelope contents with:

- [ ] Current Keycloak admin username and password (test login before sealing)
- [ ] Current SSH private key for both Oracle VMs (`oracle@<AMD_IP>` and `oracle@<AMPERE_IP>`)
- [ ] Current path to `.env` file and a printed copy of the passwords block
- [ ] Current printed copy of this runbook (Sections 3 and 8)
- [ ] Emergency contact: who to call for IT help (name + number)
- [ ] Date of this envelope: _______________

Seal the envelope, sign across the seal, and store in the same location as the succession credential envelope.

---

## Files Changed This Session

| File | Change |
|---|---|
| `JAG_PreBuild_PRE8_DR_Failover_Runbook.md` | New — this runbook |

---

## Pre-Build Task Status (Updated)

| ID | Task | Status |
|----|------|--------|
| PRE-0A | WAL target decision | ✅ LOCKED |
| PRE-0B | Cloudflare Authenticated Origin Pull guide | ✅ DONE |
| PRE-1 | ERD/DBML — all 5 databases | ✅ DONE |
| PRE-2 | OpenAPI YAML contract | ✅ DONE |
| PRE-3 | Outbox migrations + jag-event-dispatcher | ✅ DONE |
| PRE-4 | Keycloak realm + clients + roles | ✅ DONE |
| PRE-5 | WiPay sandbox POC | ✅ DONE |
| PRE-6 | Bank statement parser POC (Ollama/Mistral 7B) | ✅ DONE |
| PRE-7 | Migrate JABCO domain to Cloudflare Free Tier | ✅ DONE |
| PRE-8 | Write DR failover runbook | ✅ DONE |
| PRE-9 | Oracle Cloud + Docker setup (Phase 0) | ⬅ NEXT |

---

## What Comes Next — PRE-9

**PRE-9: Oracle Cloud + Docker setup (Phase 0)**

The final pre-build task. Brings both Oracle VMs from bare metal to a running JAG stack:

- Oracle Cloud compute provisioning checklist (networking, security lists, VCN)
- PostgreSQL 16 installation + hardening on both VMs
- Streaming replication configuration (primary_conninfo, pg_hba.conf, replication user)
- Docker + Docker Compose installation
- Docker Compose files for: Keycloak, jag-event-dispatcher, nginx (with Authenticated Origin Pull config)
- Run all migrations (`npm run migrate:all` from jag-event-dispatcher)
- MinIO setup for object storage
- Systemd service units for auto-restart on reboot
- Final smoke test checklist confirming full stack is live
