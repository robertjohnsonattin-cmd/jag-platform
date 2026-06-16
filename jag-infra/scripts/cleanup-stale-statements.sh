#!/usr/bin/env bash
# JAG Holdings — Stale bank statement job cleanup
#
# Finds fin_bank_statement_jobs rows in PENDING status older than STALE_DAYS (default 7).
# For each: deletes the MinIO object, then removes the job record.
# Transactions already imported by a previous run are NOT affected.
#
# ── FIRST-TIME SETUP (run once on the VM) ──────────────────────────────────────
#
# 1. Add to crontab (runs at 03:00 TT = 07:00 UTC, after the 02:00 Ollama batch):
#      (crontab -l 2>/dev/null; echo "0 7 * * * PG_SUPER_PASSWORD=<pw> MINIO_ROOT_PASSWORD=<pw> bash /opt/jag/jag-infra/scripts/cleanup-stale-statements.sh >> /var/log/jag-stmt-cleanup.log 2>&1") | crontab -
#
# ── MANUAL RUN ─────────────────────────────────────────────────────────────────
#   PG_SUPER_PASSWORD=<pw> MINIO_ROOT_PASSWORD=<pw> bash cleanup-stale-statements.sh
#
# ── ENV VARS ───────────────────────────────────────────────────────────────────
#   PG_SUPER_PASSWORD    — required; postgres superuser password (bypasses RLS)
#   MINIO_ROOT_PASSWORD  — required; MinIO root password (to delete objects)
#   STALE_DAYS           — optional; default 7
#   MINIO_ROOT_USER      — optional; default jag_minio_admin
#   MINIO_ENDPOINT       — optional; default http://localhost:9000
#   MINIO_BUCKET         — optional; default jag-bank-statements
#   DRY_RUN              — optional; set to "true" to log without deleting

set -euo pipefail

STALE_DAYS="${STALE_DAYS:-7}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-jag_minio_admin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD env var is required}"
PG_SUPER_PASSWORD="${PG_SUPER_PASSWORD:?PG_SUPER_PASSWORD env var is required}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
MINIO_BUCKET="${MINIO_BUCKET:-jag-bank-statements}"
DRY_RUN="${DRY_RUN:-false}"
MC_ALIAS="jagcleanup"

log() {
  local action="$1" severity="$2"
  shift 2
  local extra="${*:-}"
  printf '{"timestamp":"%s","entity":"STMT_CLEANUP","action":"%s","severity":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$severity" "${extra:+,$extra}"
}

# ── Preflight ──────────────────────────────────────────────────────────────────
for cmd in mc psql; do
  if ! command -v "$cmd" &>/dev/null; then
    log "preflight_fail" "ERROR" "\"reason\":\"$cmd not found\""
    exit 1
  fi
done

log "cleanup_start" "INFO" "\"stale_days\":$STALE_DAYS,\"dry_run\":$DRY_RUN"

# ── Configure mc alias ─────────────────────────────────────────────────────────
mc alias set "$MC_ALIAS" "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" \
  --api S3v4 -q

# ── Query stale PENDING jobs ───────────────────────────────────────────────────
# Use postgres superuser to bypass RLS — this is a maintenance script, not a
# user-initiated action. The UUID regex guard below prevents SQL injection.
STALE_JOBS=$(PGPASSWORD="$PG_SUPER_PASSWORD" psql \
  -U postgres -d jag_family -t -A -F'|' \
  -c "SELECT id, storage_path FROM fin_bank_statement_jobs \
      WHERE status = 'PENDING' \
        AND created_at < NOW() - INTERVAL '$STALE_DAYS days' \
      ORDER BY created_at") || {
  log "query_fail" "ERROR" '"reason":"psql query failed"'
  exit 1
}

if [[ -z "$STALE_JOBS" ]]; then
  log "cleanup_complete" "INFO" '"stale_found":0,"cleaned":0'
  exit 0
fi

FOUND=0
CLEANED=0
FAILED=0

while IFS='|' read -r job_id storage_path; do
  [[ -z "$job_id" ]] && continue
  FOUND=$((FOUND + 1))

  # Guard: UUID must match expected format to prevent any injection risk
  if [[ ! "$job_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    log "invalid_uuid" "ERROR" "\"job_id\":\"$job_id\""
    FAILED=$((FAILED + 1))
    continue
  fi

  log "stale_found" "INFO" "\"job_id\":\"$job_id\",\"storage_path\":\"$storage_path\""

  if [[ "$DRY_RUN" == "true" ]]; then
    log "dry_run_skip" "INFO" "\"job_id\":\"$job_id\""
    continue
  fi

  # Delete MinIO object (non-fatal — object may have been removed already)
  if mc rm "$MC_ALIAS/$MINIO_BUCKET/$storage_path" &>/dev/null; then
    log "minio_deleted" "INFO" "\"job_id\":\"$job_id\",\"storage_path\":\"$storage_path\""
  else
    log "minio_not_found" "WARN" "\"job_id\":\"$job_id\",\"storage_path\":\"$storage_path\""
  fi

  # Delete the job record — status guard ensures we never delete a job that raced
  # to PROCESSING between the SELECT above and this DELETE.
  DELETED_ID=$(PGPASSWORD="$PG_SUPER_PASSWORD" psql \
    -U postgres -d jag_family -t -A \
    -c "DELETE FROM fin_bank_statement_jobs \
        WHERE id = '$job_id' AND status = 'PENDING' \
        RETURNING id") || {
    log "db_delete_fail" "ERROR" "\"job_id\":\"$job_id\""
    FAILED=$((FAILED + 1))
    continue
  }

  if [[ -n "$DELETED_ID" ]]; then
    log "job_deleted" "INFO" "\"job_id\":\"$job_id\""
    CLEANED=$((CLEANED + 1))
  else
    log "job_skip" "WARN" "\"job_id\":\"$job_id\",\"reason\":\"status changed before delete\""
  fi

done <<< "$STALE_JOBS"

SEVERITY="INFO"
[[ $FAILED -gt 0 ]] && SEVERITY="WARN"

log "cleanup_complete" "$SEVERITY" \
  "\"stale_found\":$FOUND,\"cleaned\":$CLEANED,\"failed\":$FAILED,\"dry_run\":$DRY_RUN"

exit $((FAILED > 0 ? 1 : 0))
