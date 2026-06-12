#!/usr/bin/env bash
# JAG Holdings — PostgreSQL nightly backup
#
# Dumps all 5 logical databases using pg_dump (custom format, level-9 compression).
# Stores dumps locally under /opt/jag/backups/YYYY-MM-DD/, then uploads to MinIO
# bucket jag-backups. Prunes local backups older than LOCAL_RETAIN_DAYS (7) and
# MinIO backups older than MINIO_RETAIN_DAYS (30).
#
# Runs via peer auth as the postgres OS user — no password required.
# All log lines are structured JSON (STD-08) for Loki ingestion.
#
# ── FIRST-TIME SETUP (run once on the VM) ──────────────────────────────────────
#
# 1. Install the MinIO client (ARM64 build for Oracle Ampere):
#      curl -sSL https://dl.min.io/client/mc/release/linux-arm64/mc \
#        -o /usr/local/bin/mc && chmod +x /usr/local/bin/mc
#
# 2. Configure the 'jag' alias (source .env or paste values directly):
#      source /opt/jag/jag-infra/.env
#      mc alias set jag http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
#
# 3. Create the backup bucket:
#      mc mb jag/jag-backups
#
# 4. Install cron (as ubuntu user):
#      (crontab -l 2>/dev/null; echo "0 2 * * * /opt/jag/jag-infra/scripts/backup-databases.sh >> /var/log/jag-backup.log 2>&1") | crontab -
#
# ── RESTORE ────────────────────────────────────────────────────────────────────
#
# From local file:
#   pg_restore --host=localhost --username=postgres --dbname=jag_core \
#     --clean --if-exists /opt/jag/backups/YYYY-MM-DD/jag_core_YYYY-MM-DD_HHMMSS.dump
#
# From MinIO:
#   mc cp jag/jag-backups/jag_core_YYYY-MM-DD_HHMMSS.dump /tmp/restore.dump
#   sudo -u postgres pg_restore --dbname=jag_core --clean --if-exists /tmp/restore.dump
#
# ── MANUAL RUN ─────────────────────────────────────────────────────────────────
#   bash /opt/jag/jag-infra/scripts/backup-databases.sh

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────────
DATABASES=(jag_core jag_commercial jag_entertainment jag_family jag_properties)
PG_HOST="localhost"
PG_PORT="5432"
PG_USER="postgres"
BACKUP_ROOT="/opt/jag/backups"
MINIO_ALIAS="jag"
MINIO_BUCKET="jag-backups"
LOCAL_RETAIN_DAYS=7
MINIO_RETAIN_DAYS=30

TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
DATE_DIR=$(date +%Y-%m-%d)
BACKUP_DIR="${BACKUP_ROOT}/${DATE_DIR}"
EXIT_CODE=0

# ── Helpers ────────────────────────────────────────────────────────────────────
log() {
  local action="$1" severity="$2"
  shift 2
  local extra="${*:-}"
  printf '{"timestamp":"%s","entity":"BACKUP","action":"%s","severity":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$severity" "${extra:+,$extra}"
}

log_db() {
  local action="$1" severity="$2" db="$3"
  shift 3
  local extra="${*:-}"
  printf '{"timestamp":"%s","entity":"BACKUP","action":"%s","db":"%s","severity":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$db" "$severity" "${extra:+,$extra}"
}

# ── Preflight checks ───────────────────────────────────────────────────────────
if ! command -v pg_dump &>/dev/null; then
  log "preflight_fail" "ERROR" '"reason":"pg_dump not found"'
  exit 1
fi

if ! command -v mc &>/dev/null; then
  log "preflight_fail" "ERROR" '"reason":"mc (MinIO client) not found — see setup instructions in script header"'
  exit 1
fi

if ! mc alias ls "$MINIO_ALIAS" &>/dev/null; then
  log "preflight_fail" "ERROR" '"reason":"MinIO alias '"'"'jag'"'"' not configured — run: mc alias set jag http://localhost:9000 <user> <pass>"'
  exit 1
fi

mkdir -p "$BACKUP_DIR"
log "backup_start" "INFO" '"databases":5,"backup_dir":"'"$BACKUP_DIR"'"'

# ── Dump each database ─────────────────────────────────────────────────────────
declare -A DUMP_FILES
for DB in "${DATABASES[@]}"; do
  FILENAME="${DB}_${TIMESTAMP}.dump"
  FILEPATH="${BACKUP_DIR}/${FILENAME}"
  DUMP_FILES[$DB]="$FILEPATH"

  log_db "dump_start" "INFO" "$DB"

  if sudo -u postgres pg_dump \
      --host="$PG_HOST" \
      --port="$PG_PORT" \
      --username="$PG_USER" \
      --format=custom \
      --compress=9 \
      --file="$FILEPATH" \
      "$DB"; then
    SIZE=$(du -sh "$FILEPATH" | cut -f1)
    log_db "dump_done" "INFO" "$DB" '"file":"'"$FILENAME"'","size":"'"$SIZE"'"'
  else
    log_db "dump_fail" "ERROR" "$DB" '"file":"'"$FILENAME"'"'
    EXIT_CODE=1
    unset "DUMP_FILES[$DB]"
  fi
done

# ── Upload successful dumps to MinIO ───────────────────────────────────────────
for DB in "${!DUMP_FILES[@]}"; do
  FILEPATH="${DUMP_FILES[$DB]}"
  FILENAME=$(basename "$FILEPATH")

  if mc cp "$FILEPATH" "${MINIO_ALIAS}/${MINIO_BUCKET}/${FILENAME}" &>/dev/null; then
    log_db "upload_done" "INFO" "$DB" '"bucket":"'"$MINIO_BUCKET"'","file":"'"$FILENAME"'"'
  else
    log_db "upload_fail" "WARN" "$DB" '"bucket":"'"$MINIO_BUCKET"'","file":"'"$FILENAME"'"'
    EXIT_CODE=1
  fi
done

# ── Prune local backups older than LOCAL_RETAIN_DAYS ──────────────────────────
PRUNED_LOCAL=0
while IFS= read -r -d '' f; do
  rm -f "$f"
  (( PRUNED_LOCAL++ )) || true
done < <(find "$BACKUP_ROOT" -name "*.dump" -mtime +"$LOCAL_RETAIN_DAYS" -print0 2>/dev/null)

# Remove empty date directories
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -empty -delete 2>/dev/null || true
log "prune_local_done" "INFO" '"pruned":'"$PRUNED_LOCAL"',"retain_days":'"$LOCAL_RETAIN_DAYS"

# ── Prune MinIO backups older than MINIO_RETAIN_DAYS ──────────────────────────
CUTOFF_EPOCH=$(date -d "-${MINIO_RETAIN_DAYS} days" +%s)
PRUNED_MINIO=0
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  FILE_DATE=$(echo "$line" | awk '{print $1}')
  FILE_NAME=$(echo "$line" | awk '{print $5}')
  [[ -z "$FILE_NAME" || -z "$FILE_DATE" ]] && continue
  FILE_EPOCH=$(date -d "$FILE_DATE" +%s 2>/dev/null || true)
  if [[ -n "$FILE_EPOCH" && "$FILE_EPOCH" -lt "$CUTOFF_EPOCH" ]]; then
    mc rm "${MINIO_ALIAS}/${MINIO_BUCKET}/${FILE_NAME}" &>/dev/null && (( PRUNED_MINIO++ )) || true
  fi
done < <(mc ls "${MINIO_ALIAS}/${MINIO_BUCKET}" 2>/dev/null || true)

log "prune_minio_done" "INFO" '"pruned":'"$PRUNED_MINIO"',"retain_days":'"$MINIO_RETAIN_DAYS"

# ── Summary ───────────────────────────────────────────────────────────────────
DUMPED=${#DUMP_FILES[@]}
log "backup_complete" "$([ $EXIT_CODE -eq 0 ] && echo INFO || echo WARN)" \
  '"databases_dumped":'"$DUMPED"',"databases_total":5,"exit_code":'"$EXIT_CODE"

exit $EXIT_CODE
