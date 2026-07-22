#!/usr/bin/env bash
# JAG Holdings — MinIO bucket nightly backup
#
# Mirrors all 5 tenant-facing file buckets (photos, documents, receipts,
# bank statements, signed documents) into the same dated backup directory
# that backup-databases.sh uses (/opt/jag/backups/YYYY-MM-DD/minio-buckets/),
# so a single local dir + a single off-instance pull covers both DB dumps
# and actual files.
#
# This does NOT protect against MinIO-level data loss on its own — the
# buckets AND this mirror both live on the same Oracle instance. It exists
# purely to feed the off-instance pull script (pull-backups.ps1), which is
# the actual off-instance copy.
#
# Uses `mc mirror` (not `mc cp`) so deletions/updates in the source bucket
# are reflected locally too — this is a point-in-time snapshot, not an
# ever-growing archive. All log lines are structured JSON (STD-08).
#
# ── FIRST-TIME SETUP ─────────────────────────────────────────────────────
# Reuses the same 'jag' mc alias backup-databases.sh already depends on —
# no additional setup needed if that script is already working.
#
# Install cron (as ubuntu user):
#   (crontab -l 2>/dev/null; echo "15 2 * * * /opt/jag/jag-infra/scripts/backup-minio-buckets.sh >> /var/log/jag-minio-backup.log 2>&1") | crontab -
#
# ── MANUAL RUN ────────────────────────────────────────────────────────────
#   bash /opt/jag/jag-infra/scripts/backup-minio-buckets.sh

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────────
BUCKETS=(jag-photos jag-documents jag-receipts jag-bank-statements jag-signed-documents)
BACKUP_ROOT="/opt/jag/backups"
MINIO_ALIAS="jag"
LOCAL_RETAIN_DAYS=7

DATE_DIR=$(date +%Y-%m-%d)
BACKUP_DIR="${BACKUP_ROOT}/${DATE_DIR}/minio-buckets"
EXIT_CODE=0

# ── Helpers ────────────────────────────────────────────────────────────────────
log() {
  local action="$1" severity="$2"
  shift 2
  local extra="${*:-}"
  printf '{"timestamp":"%s","entity":"MINIO_BACKUP","action":"%s","severity":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$severity" "${extra:+,$extra}"
}

log_bucket() {
  local action="$1" severity="$2" bucket="$3"
  shift 3
  local extra="${*:-}"
  printf '{"timestamp":"%s","entity":"MINIO_BACKUP","action":"%s","bucket":"%s","severity":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$bucket" "$severity" "${extra:+,$extra}"
}

# ── Preflight checks ───────────────────────────────────────────────────────────
if ! command -v mc &>/dev/null; then
  log "preflight_fail" "ERROR" '"reason":"mc (MinIO client) not found"'
  exit 1
fi

if ! mc alias ls "$MINIO_ALIAS" &>/dev/null; then
  log "preflight_fail" "ERROR" '"reason":"MinIO alias '"'"'jag'"'"' not configured"'
  exit 1
fi

mkdir -p "$BACKUP_DIR"
log "backup_start" "INFO" '"buckets":'"${#BUCKETS[@]}"',"backup_dir":"'"$BACKUP_DIR"'"'

# ── Mirror each bucket ──────────────────────────────────────────────────────────
for BUCKET in "${BUCKETS[@]}"; do
  DEST="${BACKUP_DIR}/${BUCKET}"
  mkdir -p "$DEST"

  log_bucket "mirror_start" "INFO" "$BUCKET"

  if mc mirror --quiet --remove "${MINIO_ALIAS}/${BUCKET}" "$DEST" &>/dev/null; then
    COUNT=$(find "$DEST" -type f | wc -l)
    SIZE=$(du -sh "$DEST" 2>/dev/null | cut -f1)
    log_bucket "mirror_done" "INFO" "$BUCKET" '"files":'"$COUNT"',"size":"'"$SIZE"'"'
  else
    log_bucket "mirror_fail" "ERROR" "$BUCKET"
    EXIT_CODE=1
  fi
done

# ── Prune local mirrors older than LOCAL_RETAIN_DAYS ───────────────────────────
# Prune by parsing the YYYY-MM-DD from the parent dir NAME, not mtime — mtime
# is unreliable here since mirroring today's files bumps the parent dir's mtime,
# and this must only remove the minio-buckets/ subdir, never the sibling *.dump
# files that backup-databases.sh's own (separate, file-level) pruning owns.
CUTOFF_EPOCH=$(date -d "-${LOCAL_RETAIN_DAYS} days" +%s)
PRUNED_DIRS=0
for d in "${BACKUP_ROOT}"/*/minio-buckets; do
  [[ -d "$d" ]] || continue
  DIR_DATE=$(basename "$(dirname "$d")")
  DIR_EPOCH=$(date -d "$DIR_DATE" +%s 2>/dev/null || true)
  if [[ -n "$DIR_EPOCH" && "$DIR_EPOCH" -lt "$CUTOFF_EPOCH" ]]; then
    rm -rf "$d"
    (( PRUNED_DIRS++ )) || true
  fi
done

log "prune_done" "INFO" '"pruned_dirs":'"$PRUNED_DIRS"',"retain_days":'"$LOCAL_RETAIN_DAYS"

# ── Summary ───────────────────────────────────────────────────────────────────
log "backup_complete" "$([ $EXIT_CODE -eq 0 ] && echo INFO || echo WARN)" \
  '"buckets_total":'"${#BUCKETS[@]}"',"exit_code":'"$EXIT_CODE"

exit $EXIT_CODE
