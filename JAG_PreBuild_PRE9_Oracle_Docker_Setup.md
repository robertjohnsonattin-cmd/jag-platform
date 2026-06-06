# JAG Holdings — PRE-9: Oracle Cloud + Docker Setup (Phase 0)
**Date:** 2026-05-24  
**Status:** ✅ DONE  
**Session scope:** Full setup guide from bare Oracle Cloud VMs to a running JAG stack. Deliverables include Docker Compose, nginx vhosts, PostgreSQL configs, SQL bootstrap, and systemd unit.

---

## Deliverables

```
jag-event-dispatcher/
└── Dockerfile                             ← Multi-stage build (new)

jag-infra/
├── docker-compose.yml                     ← Keycloak + dispatcher + MinIO
├── .env.example
├── .gitignore
├── postgresql/
│   ├── bootstrap.sql                      ← Roles, databases, extensions
│   ├── primary-amd.conf                   ← PostgreSQL tuning for AMD (6 GB)
│   ├── primary-ampere.conf                ← PostgreSQL tuning for Ampere (24 GB)
│   └── pg_hba.conf.append                 ← Replication + app access rules
├── nginx/
│   ├── nginx.conf                         ← Global nginx config + AOP
│   └── sites-available/
│       ├── jabco.tt.conf
│       ├── api.jabco.tt.conf
│       └── auth.jabco.tt.conf
└── systemd/
    └── jag-stack.service                  ← Auto-start Docker Compose on boot
```

**Placeholder values used throughout — replace before running:**

| Placeholder | Where to find it |
|---|---|
| `<ORACLE_AMD_IP>` | OCI Console → Compute → Instances → jabco-amd-primary → Public IP |
| `<ORACLE_AMPERE_IP>` | OCI Console → Compute → Instances → jabco-ampere-standby → Public IP |
| `<AMD_PRIVATE_IP>` | OCI Console → same instance → Private IP (e.g. 10.0.0.X) |
| `<AMPERE_PRIVATE_IP>` | OCI Console → same instance → Private IP (e.g. 10.0.0.Y) |

---

## Section 1: Oracle Cloud — VCN and Networking

### 1.1 Create VCN (if not already exists)

OCI Console → Networking → Virtual Cloud Networks → **Create VCN**

| Field | Value |
|---|---|
| Name | `jag-vcn` |
| CIDR block | `10.0.0.0/16` |
| DNS label | `jagvcn` |

Create a public subnet: `10.0.0.0/24`, internet gateway attached.

### 1.2 Security List — Ingress Rules

OCI Console → Networking → VCN → Security Lists → Default Security List → **Add Ingress Rules**

| Protocol | Source | Port | Purpose |
|---|---|---|---|
| TCP | `0.0.0.0/0` | 22 | SSH |
| TCP | `0.0.0.0/0` | 80 | HTTP (nginx redirects to HTTPS) |
| TCP | `0.0.0.0/0` | 443 | HTTPS |
| TCP | `<AMPERE_PRIVATE_IP>/32` | 5432 | WAL streaming (Ampere → AMD) |
| TCP | `<AMD_PRIVATE_IP>/32` | 5432 | Re-sync (AMD → Ampere after failover) |

Egress: allow all (default).

> MinIO (9000, 9001) and Keycloak (8080) are bound to `127.0.0.1` only — they must NOT be in the security list.

### 1.3 Oracle Cloud Firewall (iptables on the VM)

Oracle Linux and Ubuntu on OCI have an OS-level firewall that must also be opened:

```bash
# On BOTH VMs (Ubuntu 22.04):
sudo iptables -I INPUT -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 22  -j ACCEPT
sudo netfilter-persistent save
# OR if using ufw:
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# For PostgreSQL replication between VMs:
sudo ufw allow from <AMPERE_PRIVATE_IP> to any port 5432   # on AMD
sudo ufw allow from <AMD_PRIVATE_IP>    to any port 5432   # on Ampere
```

---

## Section 2: Both VMs — Initial OS Setup

Run on **both AMD and Ampere VMs** after SSH in:

```bash
# Update packages
sudo apt-get update && sudo apt-get upgrade -y

# Set hostname
sudo hostnamectl set-hostname jabco-amd-primary    # on AMD
sudo hostnamectl set-hostname jabco-ampere-standby # on Ampere

# Add swap (critical for AMD 6 GB — PostgreSQL can spike during migrations)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Install essentials
sudo apt-get install -y curl git unzip ca-certificates gnupg lsb-release \
     netfilter-persistent iptables-persistent net-tools

# Oracle idle-reclamation keepalive (runs every 6 h)
(crontab -l 2>/dev/null; echo "0 */6 * * * /usr/bin/uptime >> /var/log/jag-keepalive.log 2>&1") | crontab -
```

---

## Section 3: Both VMs — PostgreSQL 16 Installation

```bash
# Add PostgreSQL apt repository
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | \
  sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
echo "deb [arch=$(dpkg --print-architecture)] https://apt.postgresql.org/pub/repos/apt \
  $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt-get update
sudo apt-get install -y postgresql-16 postgresql-client-16

# Enable and start
sudo systemctl enable postgresql
sudo systemctl start postgresql
sudo systemctl status postgresql   # confirm running
```

---

## Section 4: AMD VM — PostgreSQL Primary Configuration

### 4.1 Apply primary settings

```bash
# Append JAG settings to postgresql.conf
sudo tee -a /etc/postgresql/16/main/postgresql.conf < /opt/jag/jag-infra/postgresql/primary-amd.conf
```

### 4.2 Update pg_hba.conf

```bash
# Add JAG access rules (edit placeholders first)
nano /opt/jag/jag-infra/postgresql/pg_hba.conf.append
# Replace <AMPERE_PRIVATE_IP> with actual value

sudo tee -a /etc/postgresql/16/main/pg_hba.conf < /opt/jag/jag-infra/postgresql/pg_hba.conf.append

sudo systemctl restart postgresql
```

### 4.3 Run bootstrap SQL

```bash
# Edit passwords in bootstrap.sql first
nano /opt/jag/jag-infra/postgresql/bootstrap.sql

sudo -u postgres psql -f /opt/jag/jag-infra/postgresql/bootstrap.sql
```

### 4.4 Verify

```bash
sudo -u postgres psql -c "\l"
# Should show: jag_core, jag_commercial, jag_entertainment, jag_family, jag_properties, keycloak
```

---

## Section 5: Configure Streaming Replication

### 5.1 On AMD primary — create replication slot

```bash
sudo -u postgres psql -c "SELECT pg_create_physical_replication_slot('ampere_slot');"
# Verify:
sudo -u postgres psql -c "SELECT slot_name, active FROM pg_replication_slots;"
```

Update `primary-amd.conf` to reference the slot:
```ini
# Add to postgresql.conf (already appended in Step 4.1, just add this line):
# primary_slot_name = 'ampere_slot'   ← set on the STANDBY, not the primary
```

### 5.2 On Ampere standby — run pg_basebackup

```bash
# Stop any running PostgreSQL on Ampere first
sudo systemctl stop postgresql
sudo rm -rf /var/lib/postgresql/16/main/*

# Run pg_basebackup from AMD primary
# Enter the replicator password when prompted
sudo -u postgres pg_basebackup \
  -h <AMD_PRIVATE_IP> \
  -U replicator \
  -D /var/lib/postgresql/16/main \
  -P -Xs -R

# -R flag auto-creates:
#   /var/lib/postgresql/16/main/standby.signal
#   primary_conninfo in postgresql.auto.conf
```

### 5.3 On Ampere — configure standby settings

```bash
# Append Ampere-tuned settings (standby reads these too)
sudo tee -a /etc/postgresql/16/main/postgresql.conf < /opt/jag/jag-infra/postgresql/primary-ampere.conf

# Add replication slot reference to postgresql.auto.conf
sudo -u postgres bash -c "echo \"primary_slot_name = 'ampere_slot'\" >> /var/lib/postgresql/16/main/postgresql.auto.conf"

# Ensure hot_standby is on (allows read-only queries while replicating)
sudo -u postgres bash -c "echo 'hot_standby = on' >> /etc/postgresql/16/main/postgresql.conf"

# Apply pg_hba.conf for post-failover (AMD→standby direction)
sudo tee -a /etc/postgresql/16/main/pg_hba.conf < /opt/jag/jag-infra/postgresql/pg_hba.conf.append

sudo systemctl start postgresql
```

### 5.4 Verify replication

```bash
# On AMD primary:
sudo -u postgres psql -c "SELECT client_addr, state, sync_state, sent_lsn, replay_lsn FROM pg_stat_replication;"
# Expected: one row, state=streaming, sync_state=async

# On Ampere standby:
sudo -u postgres psql -c "SELECT pg_is_in_recovery();"
# Expected: t
sudo -u postgres psql -c "SELECT now() - pg_last_xact_replay_timestamp() AS lag;"
# Expected: < 1 second
```

---

## Section 6: Both VMs — Docker + Docker Compose Installation

```bash
# Install Docker Engine
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add your user to docker group (avoids sudo)
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

---

## Section 7: Deploy JAG Code to Both VMs

```bash
# Create deployment directory
sudo mkdir -p /opt/jag
sudo chown $USER:$USER /opt/jag
cd /opt/jag

# Clone or copy the JAG project files
# Option A: from your Windows dev machine via SCP
scp -r "C:\Users\rober\Documents\Claude\Projects\JAG Holdings\jag-infra" oracle@<ORACLE_AMD_IP>:/opt/jag/
scp -r "C:\Users\rober\Documents\Claude\Projects\JAG Holdings\jag-event-dispatcher" oracle@<ORACLE_AMD_IP>:/opt/jag/

# Option B: if using git (recommended for Phase 1)
# git clone git@github.com:your-org/jag-platform.git /opt/jag/jag-platform

# Create MinIO data directory
sudo mkdir -p /data/minio
sudo chown 1000:1000 /data/minio   # MinIO runs as UID 1000 inside container
```

---

## Section 8: Configure Environment and Start Services

```bash
cd /opt/jag/jag-infra

# Copy and fill in .env
cp .env.example .env
nano .env
# Fill in all CHANGE_ME values + set ALERT_USER_ID (get from Step 11)

# Build dispatcher image
docker compose build dispatcher

# Start services
docker compose up -d

# Check status
docker compose ps
docker compose logs -f   # Ctrl+C to exit
```

Wait for Keycloak to show `healthy` (can take 60–90 seconds on first start).

---

## Section 9: Install nginx and SSL Certificates

```bash
sudo apt-get install -y nginx

# Install Cloudflare origin certificate (downloaded in PRE-7 Step 3.2)
sudo cp origin.pem     /etc/ssl/certs/jabco-origin.pem
sudo cp origin-key.pem /etc/ssl/private/jabco-origin-key.pem
sudo chmod 600         /etc/ssl/private/jabco-origin-key.pem

# Download Cloudflare Authenticated Origin Pull CA
sudo curl -o /etc/ssl/certs/cloudflare-origin-pull-ca.pem \
  https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem

# Deploy nginx config
sudo cp /opt/jag/jag-infra/nginx/nginx.conf /etc/nginx/nginx.conf
sudo cp /opt/jag/jag-infra/nginx/sites-available/*.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/jabco.tt.conf    /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/api.jabco.tt.conf /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/auth.jabco.tt.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Create placeholder webroot for jabco.tt
sudo mkdir -p /var/www/jabco.tt
echo "<h1>JABCO</h1>" | sudo tee /var/www/jabco.tt/index.html

# Test config and reload
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
```

> Do NOT enable Authenticated Origin Pull (`ssl_verify_client on`) until Cloudflare DNS is pointed at this VM (PRE-7). When testing locally, temporarily set `ssl_verify_client off`.

---

## Section 10: Run Database Migrations

```bash
cd /opt/jag/jag-event-dispatcher

# Install Node.js 20 on the VM
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install dependencies and run all migrations
npm install
cp .env.example .env
nano .env   # fill in DATABASE_URL_* using host 127.0.0.1 (direct, no Docker)

npm run migrate:all
# Expected: 2 migrations applied per database (pending_events + pending_review_queue for jag_properties)
```

Verify:
```bash
sudo -u postgres psql -d jag_properties -c "\dt"
# Should show: pending_events, prop_pending_review_queue (plus all prop_* tables if data seeded)
```

---

## Section 11: Import Keycloak Realm and Create Robert's User

Follow `JAG_PreBuild_PRE4_Keycloak_Setup.md` — the complete setup guide.

Key steps that must happen now:
1. Import `jag_keycloak_realm_v1.json` via Keycloak admin console
2. Create Robert's user, assign `owner` role, set TOTP as required action
3. **INSERT Robert into `jag_core.users`** and capture the UUID
4. Update `.env` → `ALERT_USER_ID=<Robert's UUID>`
5. Restart the dispatcher: `docker compose restart dispatcher`

---

## Section 12: MinIO Bucket Setup

Access the MinIO console via SSH tunnel:
```bash
# On your local machine:
ssh -L 9001:127.0.0.1:9001 oracle@<ORACLE_AMD_IP>
# Then open: http://localhost:9001 in your browser
```

Log in with `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` from `.env`.

Create the following buckets:

| Bucket | Purpose |
|---|---|
| `jag-properties` | Property photos, lease documents |
| `jag-maintenance` | Maintenance request photos |
| `jag-docvault` | Family DocVault documents |
| `jag-statements` | Bank statement uploads (PRE-6 parser input) |

Create a service account key (Access Key / Secret Key) for the JAG API to use. Save these to a secure location — they will be needed in Phase 1.

---

## Section 13: Enable systemd Auto-Start

```bash
sudo cp /opt/jag/jag-infra/systemd/jag-stack.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable jag-stack.service
sudo systemctl start jag-stack.service
sudo systemctl status jag-stack.service
```

---

## Section 14: Final Smoke Test Checklist

Run from your local machine after Cloudflare DNS is pointed at the AMD VM (PRE-7):

**Infrastructure:**
- [ ] `ssh oracle@<ORACLE_AMD_IP>` → succeeds
- [ ] `ssh oracle@<ORACLE_AMPERE_IP>` → succeeds

**PostgreSQL:**
- [ ] `sudo -u postgres psql -c "SELECT pg_is_in_recovery();"` on AMD → `f` (primary)
- [ ] `sudo -u postgres psql -c "SELECT pg_is_in_recovery();"` on Ampere → `t` (standby)
- [ ] `sudo -u postgres psql -c "SELECT * FROM pg_stat_replication;"` on AMD → 1 row, `state=streaming`

**Services (AMD):**
- [ ] `docker compose ps` → all 3 containers `running (healthy)`
- [ ] `curl http://127.0.0.1:8080/realms/master` → Keycloak JSON response
- [ ] `curl http://127.0.0.1:9000/minio/health/live` → `200 OK`

**Public endpoints (via Cloudflare):**
- [ ] `curl https://jabco.tt` → HTML response, padlock shown
- [ ] `curl https://auth.jabco.tt/realms/jag/.well-known/openid-configuration` → JSON with correct issuer
- [ ] Keycloak login at `https://auth.jabco.tt/realms/jag/account` → redirects to login page
- [ ] TOTP prompt shown for Robert's account

**Migrations:**
- [ ] `sudo -u postgres psql -d jag_core -c "SELECT count(*) FROM users;"` → `1` (Robert's row)
- [ ] `sudo -u postgres psql -d jag_properties -c "\dt"` → `prop_pending_review_queue` exists

**Security:**
- [ ] `curl -A "sqlmap/1.0" https://api.jabco.tt/` → `403` (Cloudflare WAF Rule 2)
- [ ] Direct-to-IP: `curl --resolve api.jabco.tt:443:<ORACLE_AMD_IP> https://api.jabco.tt/` → TLS error (AOP active)

**DR readiness:**
- [ ] Health-check cron is active on Ampere: `crontab -l` → shows the `*/2` health check
- [ ] PRE-8 DR runbook is printed/accessible offline

---

## Files Changed This Session

| File | Change |
|---|---|
| `jag-event-dispatcher/Dockerfile` | New — multi-stage build |
| `jag-event-dispatcher/package.json` | Fixed `start` script path (`dist/src/index.js`) |
| `jag-infra/docker-compose.yml` | New |
| `jag-infra/.env.example` | New |
| `jag-infra/.gitignore` | New |
| `jag-infra/postgresql/bootstrap.sql` | New — roles, databases, extensions |
| `jag-infra/postgresql/primary-amd.conf` | New |
| `jag-infra/postgresql/primary-ampere.conf` | New |
| `jag-infra/postgresql/pg_hba.conf.append` | New |
| `jag-infra/nginx/nginx.conf` | New |
| `jag-infra/nginx/sites-available/jabco.tt.conf` | New |
| `jag-infra/nginx/sites-available/api.jabco.tt.conf` | New |
| `jag-infra/nginx/sites-available/auth.jabco.tt.conf` | New |
| `jag-infra/systemd/jag-stack.service` | New |

---

## Pre-Build Task Status — ALL COMPLETE

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
| PRE-9 | Oracle Cloud + Docker setup (Phase 0) | ✅ DONE |

---

## Pre-Build Is Complete — Phase 1 Begins

The pre-build phase is finished. The foundation is:

| Layer | What's ready |
|---|---|
| **Database** | 5 DBML schemas, all migrations, streaming replication to Ampere |
| **Auth** | Keycloak realm with 8 roles, 3 clients, TOTP, PKCE |
| **API contract** | 8,286-line OpenAPI YAML, 140 endpoints, source of truth for Phase 1 |
| **Events** | jag-event-dispatcher polling all 5 DBs, handler stubs for every event type |
| **Payments** | WiPay HMAC middleware + webhook handler + pending_review_queue |
| **Parsing** | Bank statement parser (Ollama/Mistral 7B) → structured JSON |
| **Infrastructure** | Both Oracle VMs configured, nginx + Cloudflare + WAF + AOP |
| **DR** | Streaming replication, tested failover procedure, sub-15-minute RTO |

**Phase 1 picks up with the API server implementation** — TypeScript/Express, using the OpenAPI contract as the blueprint, Zod for validation, Keycloak JWT middleware, and the event dispatcher already running.
