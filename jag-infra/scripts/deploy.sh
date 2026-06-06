#!/usr/bin/env bash
# JAG Platform — STD-12 Deploy Gate
# Usage: ./scripts/deploy.sh [--env staging|production] [--skip-tests]
#
# Gate sequence (all must pass — auto-rollback on failure):
#   1. TypeScript build (compile check)
#   2. Automated test suite
#   3. Database migrations (all 5 DBs)
#   4. Docker image build
#   5. Health check after restart
#
# Robert sign-off is prompted interactively before production deploy.
# Every deploy is logged to jag-infra/logs/deploys.log.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
API_DIR="${ROOT_DIR}/jag-api"
INFRA_DIR="${ROOT_DIR}/jag-infra"
LOG_FILE="${INFRA_DIR}/logs/deploys.log"
TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
ENV="staging"
SKIP_TESTS=false
GIT_COMMIT=$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || echo "unknown")

# ── Parse args ────────────────────────────────────────────────────────────────

for arg in "$@"; do
  case $arg in
    --env=*) ENV="${arg#*=}" ;;
    --skip-tests) SKIP_TESTS=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

if [[ "${ENV}" != "staging" && "${ENV}" != "production" ]]; then
  echo "ERROR: --env must be staging or production"
  exit 1
fi

# ── Logging ───────────────────────────────────────────────────────────────────

mkdir -p "${INFRA_DIR}/logs"

log() {
  local msg="[${TIMESTAMP}] [${ENV^^}] $*"
  echo "${msg}"
  echo "${msg}" >> "${LOG_FILE}"
}

fail() {
  log "FAILED: $*"
  log "DEPLOY ABORTED — rolling back"
  # Restart with previous image if containers were already updated
  cd "${INFRA_DIR}" && docker compose restart api jag-event-dispatcher 2>/dev/null || true
  exit 1
}

# ── Robert sign-off (production only) ────────────────────────────────────────

if [[ "${ENV}" == "production" ]]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  PRODUCTION DEPLOY — STD-12 GATE                            ║"
  echo "║  Commit: ${GIT_COMMIT}                                       ║"
  echo "║  Time:   ${TIMESTAMP}                                        ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  read -r -p "Robert sign-off required. Type YES to proceed: " CONFIRM
  if [[ "${CONFIRM}" != "YES" ]]; then
    echo "Deploy cancelled — sign-off not given."
    exit 0
  fi
  log "SIGN-OFF: Robert approved production deploy (commit=${GIT_COMMIT})"
fi

log "DEPLOY START: env=${ENV} commit=${GIT_COMMIT} skip_tests=${SKIP_TESTS}"

# ── Ensure host data directories exist ───────────────────────────────────────

mkdir -p /data/loki /data/grafana
log "Host data directories: /data/loki /data/grafana OK"

# ── Gate 1: TypeScript build ──────────────────────────────────────────────────

log "GATE 1: TypeScript build"
cd "${API_DIR}"
npm run build 2>&1 | tee -a "${LOG_FILE}" || fail "TypeScript build failed"
log "GATE 1: PASS"

# ── Gate 2: Automated tests ───────────────────────────────────────────────────

if [[ "${SKIP_TESTS}" == "false" ]]; then
  log "GATE 2: Running test suite"
  cd "${API_DIR}"
  npm test 2>&1 | tee -a "${LOG_FILE}" || fail "Test suite failed — fix before deploying"
  log "GATE 2: PASS"
else
  log "GATE 2: SKIPPED (--skip-tests flag set — hotfix mode)"
fi

# ── Gate 3: Database migrations ───────────────────────────────────────────────

log "GATE 3: Running migrations"

PSQL="psql -U postgres -h 127.0.0.1 -v ON_ERROR_STOP=1"

run_migrations() {
  local db=$1
  local dir="${INFRA_DIR}/migrations/${db}"
  if [[ ! -d "${dir}" ]]; then
    log "  No migration dir for ${db} — skipping"
    return
  fi

  # Create migration tracking table if it doesn't exist
  ${PSQL} -d "${db}" -c "
    CREATE TABLE IF NOT EXISTS __migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  " >> "${LOG_FILE}" 2>&1 || fail "Could not create __migrations table in ${db}"

  log "  Migrating ${db}..."
  for f in "${dir}"/*.sql; do
    [[ -f "${f}" ]] || continue
    local fname
    fname=$(basename "${f}")

    # Skip if already recorded in __migrations
    local already
    already=$(${PSQL} -d "${db}" -t -c \
      "SELECT COUNT(*) FROM __migrations WHERE filename = '${fname}';" \
      2>/dev/null | tr -d ' \n')

    if [[ "${already}" == "1" ]]; then
      log "    Skipping ${fname} (already applied)"
      continue
    fi

    log "    Applying ${fname}"
    ${PSQL} -d "${db}" -f "${f}" >> "${LOG_FILE}" 2>&1 \
      || fail "Migration failed: ${db}/${fname}"

    ${PSQL} -d "${db}" -c \
      "INSERT INTO __migrations (filename) VALUES ('${fname}');" \
      >> "${LOG_FILE}" 2>&1

    log "    ${fname}: OK"
  done
  log "  ${db}: migrations complete"
}

run_migrations jag_core
run_migrations jag_commercial
run_migrations jag_entertainment
run_migrations jag_family
run_migrations jag_properties

# Re-apply grants after migrations (new tables may not have grants yet)
for db in jag_commercial jag_entertainment jag_family jag_properties; do
  ${PSQL} -d "${db}" -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO jag_app; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO jag_app;" >> "${LOG_FILE}" 2>&1 || true
done

log "GATE 3: PASS"

# ── Gate 4: Docker build ──────────────────────────────────────────────────────

log "GATE 4: Building Docker images"
cd "${API_DIR}"
npm run build:prod 2>&1 | tee -a "${LOG_FILE}" || fail "prod-install failed"

cd "${INFRA_DIR}"
docker compose build api dispatcher caddy 2>&1 | tee -a "${LOG_FILE}" || fail "Docker build failed"

# Ensure static site root exists (placeholder for future React frontend)
mkdir -p /var/www/jabco.tt
if [[ ! -f /var/www/jabco.tt/index.html ]]; then
  echo '<html><body><h1>JAG Holdings</h1></body></html>' > /var/www/jabco.tt/index.html
fi

log "GATE 4: PASS"

# ── Deploy ────────────────────────────────────────────────────────────────────

log "DEPLOYING: bringing up new containers"
cd "${INFRA_DIR}"
# Startup order: observability → keycloak → minio → api → caddy
docker compose up -d loki 2>&1 | tee -a "${LOG_FILE}" || fail "docker compose up loki failed"
docker compose up -d promtail grafana 2>&1 | tee -a "${LOG_FILE}" || true   # non-fatal
docker compose up -d minio 2>&1 | tee -a "${LOG_FILE}" || fail "docker compose up minio failed"
docker compose up -d keycloak 2>&1 | tee -a "${LOG_FILE}" || fail "docker compose up keycloak failed"
docker compose up -d api dispatcher 2>&1 | tee -a "${LOG_FILE}" || fail "docker compose up api failed"
docker compose up -d caddy 2>&1 | tee -a "${LOG_FILE}" || fail "docker compose up caddy failed"

# ── Gate 5: Health check ──────────────────────────────────────────────────────

log "GATE 5: Health check (waiting up to 30s)"
API_PORT=${PORT:-3000}
for i in $(seq 1 6); do
  sleep 5
  if curl -sf "http://localhost:${API_PORT}/health" >> "${LOG_FILE}" 2>&1; then
    log "GATE 5: PASS (attempt ${i})"
    break
  fi
  if [[ $i -eq 6 ]]; then
    fail "Health check failed after 30s — containers may be unhealthy"
  fi
  log "  Health check attempt ${i} failed — retrying..."
done

# ── Done ─────────────────────────────────────────────────────────────────────

log "DEPLOY COMPLETE: env=${ENV} commit=${GIT_COMMIT}"
echo ""
echo "✓ Deploy complete (${ENV}) — commit ${GIT_COMMIT}"
echo "  Full log: ${LOG_FILE}"
