#!/usr/bin/env bash
# JAG Holdings — Weekly backup restore test
#
# Proves the nightly dumps are actually restorable, not just present.
# For each of the 8 databases: restores that day's dump into a throwaway
# <db>_restore_test database, compares table count AND a full row-count
# sum across every table (dynamic, no hardcoded table names — computed via
# query_to_xml/xpath so it survives schema changes) against the live
# database, then drops the test database. Never touches live data.
#
# Runs against the dump files backup-databases.sh already produced earlier
# the same night under /opt/jag/backups/<today>/ — this validates
# restorability itself; transfer-integrity of the off-instance copy is
# already covered separately (pull-backups.ps1 logs scp failures, and a
# manual checksum-verified restore test across all 8 DBs was already run
# by hand on 2026-07-22 to confirm the whole chain end-to-end).
#
# ── FIRST-TIME SETUP ─────────────────────────────────────────────────────
# Install cron (as ubuntu user), Sunday 03:00 UTC — after that night's
# 02:00/02:15/02:30 backup jobs have completed:
#   (crontab -l 2>/dev/null; echo "0 3 * * 0 /opt/jag/jag-infra/scripts/restore-test.sh >> /var/log/jag-restore-test.log 2>&1") | crontab -
#
# ── MANUAL RUN ────────────────────────────────────────────────────────────
#   bash /opt/jag/jag-infra/scripts/restore-test.sh

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────────
DATABASES=(jag_core jag_commercial jag_entertainment jag_family jag_properties traccar documenso keycloak)
BACKUP_ROOT="/opt/jag/backups"
PG_HOST="/var/run/postgresql"
PG_PORT="5432"
PG_USER="postgres"

DATE_DIR=$(date +%Y-%m-%d)
BACKUP_DIR="${BACKUP_ROOT}/${DATE_DIR}"
EXIT_CODE=0

# ── Helpers ────────────────────────────────────────────────────────────────────
log() {
  local action="$1" severity="$2"
  shift 2
  local extra="${*:-}"
  printf '{"timestamp":"%s","entity":"RESTORE_TEST","action":"%s","severity":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$severity" "${extra:+,$extra}"
}

log_db() {
  local action="$1" severity="$2" db="$3"
  shift 3
  local extra="${*:-}"
  printf '{"timestamp":"%s","entity":"RESTORE_TEST","action":"%s","db":"%s","severity":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$db" "$severity" "${extra:+,$extra}"
}

# Sum of exact row counts across every table in a database's public schema.
# Uses query_to_xml/xpath rather than pg_stat_user_tables.n_live_tup because
# n_live_tup is an ANALYZE-derived estimate that's unreliable (often 0)
# immediately after a fresh restore, before autovacuum has run.
sum_rows() {
  local db="$1"
  sudo -u postgres psql --host="$PG_HOST" --port="$PG_PORT" --username="$PG_USER" -d "$db" -tAc "
    SELECT COALESCE(SUM(cnt), 0) FROM (
      SELECT (xpath('/row/c/text()',
        query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')
      ))[1]::text::bigint AS cnt
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ) t;
  " 2>/dev/null
}

table_count() {
  local db="$1"
  sudo -u postgres psql --host="$PG_HOST" --port="$PG_PORT" --username="$PG_USER" -d "$db" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null
}

log "test_start" "INFO" '"databases":'"${#DATABASES[@]}"',"backup_dir":"'"$BACKUP_DIR"'"'

if [[ ! -d "$BACKUP_DIR" ]]; then
  log "test_abort" "ERROR" '"reason":"no backup dir for today - did the 02:00 UTC backup run?","backup_dir":"'"$BACKUP_DIR"'"'
  exit 1
fi

VERIFIED=0
for DB in "${DATABASES[@]}"; do
  DUMP=$(ls -t "${BACKUP_DIR}/${DB}_"*.dump 2>/dev/null | head -1 || true)
  if [[ -z "$DUMP" ]]; then
    log_db "dump_not_found" "ERROR" "$DB"
    EXIT_CODE=1
    continue
  fi

  TEST_DB="${DB}_restore_test"
  sudo -u postgres dropdb --if-exists "$TEST_DB" &>/dev/null
  sudo -u postgres createdb "$TEST_DB" &>/dev/null

  if ! sudo -u postgres pg_restore --host="$PG_HOST" --port="$PG_PORT" --username="$PG_USER" \
      --dbname="$TEST_DB" --no-owner --exit-on-error "$DUMP" &>/dev/null; then
    log_db "restore_fail" "ERROR" "$DB" '"dump":"'"$(basename "$DUMP")"'"'
    EXIT_CODE=1
    sudo -u postgres dropdb --if-exists "$TEST_DB" &>/dev/null
    continue
  fi

  LIVE_TABLES=$(table_count "$DB")
  RESTORED_TABLES=$(table_count "$TEST_DB")
  LIVE_ROWS=$(sum_rows "$DB")
  RESTORED_ROWS=$(sum_rows "$TEST_DB")

  sudo -u postgres dropdb --if-exists "$TEST_DB" &>/dev/null

  # Table count is the reliable signal -- it only changes on a real schema
  # change (migration), so an exact match here proves the dump restored
  # every table cleanly. Row counts are logged for visibility but NOT used
  # as pass/fail on their own: this script compares the dump (taken hours
  # earlier, at 02:00 UTC) against LIVE data that keeps changing right up
  # to the moment this test runs, so busy tables (Traccar GPS pings,
  # Keycloak sessions, Documenso webhook events) will always show a small
  # amount of natural drift even on a perfectly good backup. Only flag it
  # if the restored count is suspiciously far below live (>5% missing),
  # which would indicate real data loss (a truncated dump) rather than
  # normal churn during the test window.
  if [[ -z "$LIVE_TABLES" || "$LIVE_TABLES" != "$RESTORED_TABLES" ]]; then
    log_db "restore_mismatch" "ERROR" "$DB" \
      '"reason":"table_count","live_tables":'"${LIVE_TABLES:-null}"',"restored_tables":'"${RESTORED_TABLES:-null}"
    EXIT_CODE=1
    continue
  fi

  DRIFT_OK=1
  if [[ "$LIVE_ROWS" -gt 0 ]]; then
    # restored < live*0.95  <=>  live - restored > live*0.05  (integer-safe)
    if (( (LIVE_ROWS - RESTORED_ROWS) * 20 > LIVE_ROWS )); then
      DRIFT_OK=0
    fi
  fi

  if [[ "$DRIFT_OK" -eq 1 ]]; then
    log_db "restore_verified" "INFO" "$DB" '"tables":'"$LIVE_TABLES"',"live_rows":'"$LIVE_ROWS"',"restored_rows":'"$RESTORED_ROWS"
    (( VERIFIED++ )) || true
  else
    log_db "restore_mismatch" "ERROR" "$DB" \
      '"reason":"row_count_gap_over_5pct","live_rows":'"$LIVE_ROWS"',"restored_rows":'"$RESTORED_ROWS"
    EXIT_CODE=1
  fi
done

log "test_complete" "$([ $EXIT_CODE -eq 0 ] && echo INFO || echo ERROR)" \
  '"verified":'"$VERIFIED"',"total":'"${#DATABASES[@]}"',"exit_code":'"$EXIT_CODE"

exit $EXIT_CODE
