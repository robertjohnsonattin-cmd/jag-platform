#!/usr/bin/env bash
# JAG Holdings — Oracle Ampere VM Bootstrap
#
# Run ONCE as root (or with sudo) immediately after provisioning the VM.
# Idempotent — safe to re-run if interrupted.
#
# Usage:
#   sudo ./bootstrap-vm.sh
#
# What this does:
#   1. System update + essential packages
#   2. Docker Engine + Docker Compose plugin
#   3. PostgreSQL 17 (native, not Docker)
#   4. JAG databases, roles, and extensions (via bootstrap.sql)
#   5. PostgreSQL tuning for 4 OCPU / 24 GB Ampere
#   6. Data directories for Loki, Grafana, MinIO
#   7. UFW firewall (ports 22, 80, 443 only)
#   8. Systemd service so Docker stack starts on reboot

set -euo pipefail

PG_VERSION=17
JAG_INFRA_DIR="/opt/jag/jag-infra"
LOG="/var/log/jag-bootstrap.log"

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo "[$(date -u '+%H:%M:%S')] $*" | tee -a "${LOG}"; }
ok()  { echo "  ✓ $*" | tee -a "${LOG}"; }
sep() { echo "" | tee -a "${LOG}"; echo "──────────────────────────────────────────" | tee -a "${LOG}"; }

mkdir -p "$(dirname "${LOG}")"
log "JAG VM Bootstrap starting — PG ${PG_VERSION}"
sep

# ── 1. System update ──────────────────────────────────────────────────────────

log "Step 1: System update"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -yq
DEBIAN_FRONTEND=noninteractive apt-get install -yq \
  curl wget gnupg ca-certificates lsb-release \
  git rsync unzip jq ufw \
  apt-transport-https software-properties-common
ok "System packages installed"
sep

# ── 2. Docker Engine ──────────────────────────────────────────────────────────

log "Step 2: Docker Engine"

if command -v docker &>/dev/null; then
  ok "Docker already installed ($(docker --version))"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -yq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  # Allow ubuntu user to run docker without sudo
  usermod -aG docker ubuntu

  systemctl enable docker
  systemctl start docker
  ok "Docker installed ($(docker --version))"
fi
sep

# ── 3. PostgreSQL ─────────────────────────────────────────────────────────────

log "Step 3: PostgreSQL ${PG_VERSION}"

if pg_isready -U postgres &>/dev/null 2>&1; then
  ok "PostgreSQL already running"
else
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /etc/apt/keyrings/pgdg.gpg
  echo "deb [signed-by=/etc/apt/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt \
    $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list

  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -yq \
    "postgresql-${PG_VERSION}" "postgresql-client-${PG_VERSION}"

  systemctl enable postgresql
  systemctl start postgresql
  ok "PostgreSQL ${PG_VERSION} installed"
fi
sep

# ── 4. JAG databases and roles ────────────────────────────────────────────────

log "Step 4: JAG databases and roles"

PG_CONF_DIR="/etc/postgresql/${PG_VERSION}/main"
PSQL="sudo -u postgres psql -v ON_ERROR_STOP=1"

# Check if already bootstrapped (jag_core exists)
if sudo -u postgres psql -lqt 2>/dev/null | cut -d\| -f1 | grep -qw jag_core; then
  ok "JAG databases already exist — skipping bootstrap.sql"
else
  if [[ -f "${JAG_INFRA_DIR}/postgresql/bootstrap.sql" ]]; then
    log "  Running bootstrap.sql..."
    ${PSQL} -f "${JAG_INFRA_DIR}/postgresql/bootstrap.sql" >> "${LOG}" 2>&1
    ok "bootstrap.sql applied"
  else
    log "  WARNING: ${JAG_INFRA_DIR}/postgresql/bootstrap.sql not found."
    log "  Copy your project to /opt/jag first, then re-run this script."
    log "  Skipping database creation — run manually: sudo -u postgres psql -f bootstrap.sql"
  fi
fi
sep

# ── 5. PostgreSQL tuning (Ampere 4 OCPU / 24 GB) ─────────────────────────────

log "Step 5: PostgreSQL tuning"

PG_CONF="${PG_CONF_DIR}/postgresql.conf"
PG_HBA="${PG_CONF_DIR}/pg_hba.conf"

# Apply Ampere-tuned settings only if not already applied
if ! grep -q "JAG-tuned" "${PG_CONF}"; then
  cat >> "${PG_CONF}" << 'EOF'

# ── JAG-tuned: Ampere 4 OCPU / 24 GB ────────────────────────────────────────
max_connections = 200

# Memory
shared_buffers = 6144MB
effective_cache_size = 18432MB
work_mem = 64MB
maintenance_work_mem = 1024MB
wal_buffers = 64MB

# Checkpoint
checkpoint_completion_target = 0.9
min_wal_size = 256MB
max_wal_size = 4GB

# Parallelism
max_worker_processes = 4
max_parallel_workers_per_gather = 2
max_parallel_workers = 4
max_parallel_maintenance_workers = 2

# Logging
log_destination = 'stderr'
logging_collector = on
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d.log'
log_rotation_age = 1d
log_rotation_size = 100MB
log_min_duration_statement = 500
log_checkpoints = on
log_lock_waits = on

# Security
password_encryption = scram-sha-256
EOF
  ok "PostgreSQL tuning applied"
else
  ok "PostgreSQL tuning already applied"
fi

# Append pg_hba.conf entries (application + Docker bridge access)
if ! grep -q "jag_app.*host.docker.internal" "${PG_HBA}" 2>/dev/null && \
   ! grep -q "172.16.0.0" "${PG_HBA}" 2>/dev/null; then
  cat >> "${PG_HBA}" << 'EOF'

# JAG application connections
host  jag_core           jag_app       127.0.0.1/32      scram-sha-256
host  jag_commercial     jag_app       127.0.0.1/32      scram-sha-256
host  jag_entertainment  jag_app       127.0.0.1/32      scram-sha-256
host  jag_family         jag_app       127.0.0.1/32      scram-sha-256
host  jag_properties     jag_app       127.0.0.1/32      scram-sha-256
host  keycloak           keycloak_user 127.0.0.1/32      scram-sha-256

# Docker bridge network (host.docker.internal → 172.17.0.1 default)
host  all                jag_app       172.16.0.0/12     scram-sha-256
host  keycloak           keycloak_user 172.16.0.0/12     scram-sha-256
EOF
  ok "pg_hba.conf entries added"
  systemctl reload postgresql
  ok "PostgreSQL reloaded"
else
  ok "pg_hba.conf already configured"
fi
sep

# ── 6. Data directories ───────────────────────────────────────────────────────

log "Step 6: Data directories"

for dir in /data/loki /data/grafana /data/minio /data/caddy/data /data/caddy/config; do
  if [[ ! -d "${dir}" ]]; then
    mkdir -p "${dir}"
    ok "Created ${dir}"
  else
    ok "${dir} already exists"
  fi
done

# Grafana needs a writable directory owned by UID 472 (grafana container user)
chown -R 472:472 /data/grafana 2>/dev/null || true
sep

# ── 7. UFW firewall ───────────────────────────────────────────────────────────

log "Step 7: UFW firewall"

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (Caddy ACME + redirect)'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
ok "UFW enabled: 22, 80, 443 open. All other ingress blocked."
ufw status numbered | tee -a "${LOG}"
sep

# ── 8. Systemd service for Docker stack ──────────────────────────────────────

log "Step 8: Systemd service"

if [[ -f "${JAG_INFRA_DIR}/systemd/jag-stack.service" ]]; then
  cp "${JAG_INFRA_DIR}/systemd/jag-stack.service" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable jag-stack.service
  ok "jag-stack.service enabled (starts on reboot)"
else
  log "  WARNING: ${JAG_INFRA_DIR}/systemd/jag-stack.service not found."
  log "  Copy your project to /opt/jag first, then run:"
  log "    sudo cp jag-infra/systemd/jag-stack.service /etc/systemd/system/"
  log "    sudo systemctl enable jag-stack.service"
fi
sep

# ── Done ─────────────────────────────────────────────────────────────────────

log "Bootstrap COMPLETE"
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  JAG VM Bootstrap complete                               ║"
echo "║                                                          ║"
echo "║  Next steps:                                             ║"
echo "║  1. Copy project to /opt/jag (if not already done)      ║"
echo "║  2. Fill in /opt/jag/jag-infra/.env                     ║"
echo "║  3. cd /opt/jag/jag-infra && ./scripts/deploy.sh        ║"
echo "║       --env=production                                   ║"
echo "║                                                          ║"
echo "║  Full log: /var/log/jag-bootstrap.log                   ║"
echo "╚══════════════════════════════════════════════════════════╝"
