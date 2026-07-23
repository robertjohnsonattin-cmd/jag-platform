#!/usr/bin/env bash
# JAG Holdings — secrets + Keycloak realm config nightly backup
#
# Backs up the two things a full DB+MinIO restore still wouldn't cover:
#   1. The live .env files that hold every credential the stack runs on
#      (Postgres, MinIO, Keycloak, WhatsApp, Gemini, Documenso, etc.)
#   2. The Keycloak realm config (clients, roles, flows, WebAuthn policy,
#      mappers) via a partial-export — NOT user accounts/credentials,
#      those already live in the keycloak DB dump backup-databases.sh takes.
#
# Output lands in the same dated dir the other two backup scripts use:
#   /opt/jag/backups/YYYY-MM-DD/secrets/
# and is bundled into a single 0600 tar so nothing sensitive sits around
# as loose files even briefly. The tar is NOT uploaded to MinIO (unlike
# the DB dumps) — secrets should not live in the same storage system they
# unlock. It's picked up by the off-instance pull script only.
#
# ── FIRST-TIME SETUP ─────────────────────────────────────────────────────
# Reuses KEYCLOAK_ADMIN_USER / KEYCLOAK_ADMIN_PASSWORD already in
# /opt/jag/jag-infra/.env — no additional setup needed.
#
# Install cron (as ubuntu user):
#   (crontab -l 2>/dev/null; echo "30 2 * * * /opt/jag/jag-infra/scripts/backup-secrets.sh >> /var/log/jag-secrets-backup.log 2>&1") | crontab -
#
# ── MANUAL RUN ────────────────────────────────────────────────────────────
#   bash /opt/jag/jag-infra/scripts/backup-secrets.sh
#
# ── RESTORE ────────────────────────────────────────────────────────────────
#   tar -xzf secrets.tar.gz -C /tmp/restore
#   # .env files: copy back to their original paths
#   # keycloak-realm-export.json: Admin Console -> Realm settings -> Action -> Partial import
#   #   (or POST it to /admin/realms/jag/partialImport)

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────────
BACKUP_ROOT="/opt/jag/backups"
KEYCLOAK_CONTAINER="jag-keycloak"
KEYCLOAK_REALM="jag"
LOCAL_RETAIN_DAYS=7

DATE_DIR=$(date +%Y-%m-%d)
BACKUP_DIR="${BACKUP_ROOT}/${DATE_DIR}/secrets"
EXIT_CODE=0

# Files to back up as-is (source path -> name in the bundle)
declare -A ENV_FILES=(
  ["/opt/jag/jag-infra/.env"]="jag-infra.env"
  ["/opt/jag/.env"]="opt-jag.env"
  ["/opt/jag/jag-infra/.cron-secrets"]="cron-secrets.env"
  ["/opt/jag/jag-api/google-calendar-key.json"]="google-calendar-key.json"
)

# ── Helpers ────────────────────────────────────────────────────────────────────
log() {
  local action="$1" severity="$2"
  shift 2
  local extra="${*:-}"
  printf '{"timestamp":"%s","entity":"SECRETS_BACKUP","action":"%s","severity":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$severity" "${extra:+,$extra}"
}

# ── Setup ──────────────────────────────────────────────────────────────────────
rm -rf "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
log "backup_start" "INFO" '"backup_dir":"'"$BACKUP_DIR"'"'

# ── Copy .env / secret files ────────────────────────────────────────────────────
COPIED=0
for SRC in "${!ENV_FILES[@]}"; do
  DEST_NAME="${ENV_FILES[$SRC]}"
  if [[ -f "$SRC" ]]; then
    cp "$SRC" "${BACKUP_DIR}/${DEST_NAME}"
    (( COPIED++ )) || true
  else
    log "file_missing" "WARN" '"file":"'"$SRC"'"'
  fi
done
log "env_files_copied" "INFO" '"copied":'"$COPIED"',"expected":'"${#ENV_FILES[@]}"

# ── Keycloak realm partial-export (config only, no user credentials) ──────────
if [[ -f /opt/jag/jag-infra/.env ]]; then
  set -a
  source /opt/jag/jag-infra/.env >/dev/null 2>&1
  set +a
fi

if [[ -n "${KEYCLOAK_ADMIN_USER:-}" && -n "${KEYCLOAK_ADMIN_PASSWORD:-}" ]]; then
  KC_CONFIG="/tmp/kcadm-backup-$$.config"
  if docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh config credentials \
      --server http://localhost:8080 --realm master \
      --user "$KEYCLOAK_ADMIN_USER" --password "$KEYCLOAK_ADMIN_PASSWORD" \
      --config "$KC_CONFIG" &>/dev/null; then
    if docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh create \
        "realms/${KEYCLOAK_REALM}/partial-export?exportClients=true&exportGroupsAndRoles=true" \
        -r "$KEYCLOAK_REALM" --config "$KC_CONFIG" -o \
        > "${BACKUP_DIR}/keycloak-realm-export.json" 2>/dev/null; then
      log "keycloak_export_done" "INFO" '"realm":"'"$KEYCLOAK_REALM"'"'
    else
      log "keycloak_export_fail" "ERROR" '"reason":"partial-export call failed"'
      EXIT_CODE=1
    fi
  else
    log "keycloak_export_fail" "ERROR" '"reason":"admin login failed"'
    EXIT_CODE=1
  fi
  docker exec "$KEYCLOAK_CONTAINER" rm -f "$KC_CONFIG" &>/dev/null || true
else
  log "keycloak_export_skip" "WARN" '"reason":"KEYCLOAK_ADMIN_USER/PASSWORD not found in .env"'
  EXIT_CODE=1
fi

# ── Bundle into a single 0600 tar, remove the loose copies ────────────────────
TAR_PATH="${BACKUP_ROOT}/${DATE_DIR}/secrets.tar.gz"
if [[ -n "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]]; then
  tar -czf "$TAR_PATH" -C "$BACKUP_ROOT/${DATE_DIR}" secrets
  chmod 600 "$TAR_PATH"
  rm -rf "$BACKUP_DIR"
  SIZE=$(du -sh "$TAR_PATH" | cut -f1)
  log "bundle_done" "INFO" '"file":"secrets.tar.gz","size":"'"$SIZE"'"'
else
  log "bundle_skip" "WARN" '"reason":"nothing was collected"'
  EXIT_CODE=1
fi

# ── Prune bundles older than LOCAL_RETAIN_DAYS ──────────────────────────────────
CUTOFF_EPOCH=$(date -d "-${LOCAL_RETAIN_DAYS} days" +%s)
PRUNED=0
for f in "${BACKUP_ROOT}"/*/secrets.tar.gz; do
  [[ -f "$f" ]] || continue
  DIR_DATE=$(basename "$(dirname "$f")")
  DIR_EPOCH=$(date -d "$DIR_DATE" +%s 2>/dev/null || true)
  if [[ -n "$DIR_EPOCH" && "$DIR_EPOCH" -lt "$CUTOFF_EPOCH" ]]; then
    rm -f "$f"
    (( PRUNED++ )) || true
  fi
done
log "prune_done" "INFO" '"pruned":'"$PRUNED"',"retain_days":'"$LOCAL_RETAIN_DAYS"

# ── Summary ───────────────────────────────────────────────────────────────────
log "backup_complete" "$([ $EXIT_CODE -eq 0 ] && echo INFO || echo WARN)" '"exit_code":'"$EXIT_CODE"

exit $EXIT_CODE
