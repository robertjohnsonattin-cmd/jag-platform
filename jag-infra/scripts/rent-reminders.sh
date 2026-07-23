#!/usr/bin/env bash
# JAG Properties — Rent reminder sender (D-5 and D-1)
#
# Runs daily at 07:00 UTC (03:00 TT). Sends:
#   - jag_rent_reminder_d5  — 5 days before due date (UPCOMING periods)
#   - jag_rent_reminder_d1  — 1 day before due date  (UPCOMING or REMINDER_SENT)
# Each endpoint deduplicates via timestamp columns so duplicates are never sent.
#
# ── SETUP (run once) ──────────────────────────────────────────────────────────
#   (crontab -l 2>/dev/null; echo "0 7 * * * . /opt/jag/jag-infra/.cron-secrets && bash /opt/jag/jag-infra/scripts/rent-reminders.sh >> /var/log/jag-rent-reminders.log 2>&1") | crontab -
#
# ── MANUAL RUN ───────────────────────────────────────────────────────────────
#   KC_CRON_CLIENT_SECRET=<jag-cron-service-client-secret> bash /opt/jag/jag-infra/scripts/rent-reminders.sh

set -euo pipefail

KC_URL="https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token"
# Uses the jag-cron-service Keycloak client (client_credentials grant) rather than
# ROPC against Robert's real human account — see project_cron_ropc_auth_failures.
KC_CLIENT_ID="jag-cron-service"
KC_CLIENT_SECRET="${KC_CRON_CLIENT_SECRET:?KC_CRON_CLIENT_SECRET is required}"
API_BASE="${JAG_API_URL:-https://api.jagcorporate.com/api/v1}"

log() {
  local action="$1" severity="$2"; shift 2
  printf '{"timestamp":"%s","entity":"RENT_REMINDERS","action":"%s","severity":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$severity" "${*:+,$*}"
}

command -v jq &>/dev/null || { log "preflight_fail" "ERROR" '"reason":"jq not found"'; exit 1; }

log "start" "INFO"

TOKEN=$(curl -sf --max-time 15 -X POST "$KC_URL" \
  -d "grant_type=client_credentials&client_id=$KC_CLIENT_ID&client_secret=$KC_CLIENT_SECRET" \
  | jq -r '.access_token') || true

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  log "auth_fail" "ERROR" '"reason":"failed to obtain token"'
  exit 1
fi

api_post() {
  local endpoint="$1"
  curl -sf --max-time 30 -X POST "$API_BASE/$endpoint" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}' || echo '{}'
}

# D-5 reminders (jag_rent_reminder_d5)
R5=$(api_post "properties/rent-schedule/send-reminders")
SENT5=$(echo "$R5" | jq -r '.data.sent // 0')
log "d5_complete" "INFO" "\"sent\":$SENT5"

# D-1 reminders (jag_rent_reminder_d1)
R1=$(api_post "properties/rent-schedule/send-reminders-d1")
SENT1=$(echo "$R1" | jq -r '.data.sent // 0')
log "d1_complete" "INFO" "\"sent\":$SENT1"

log "complete" "INFO" "\"d5_sent\":$SENT5,\"d1_sent\":$SENT1"
