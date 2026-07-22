#!/usr/bin/env bash
# JAG Properties — Viewing reminder sender (24h and 1h)
#
# Runs every hour. Sends:
#   - jag_enq_viewing_reminder_24h — when viewing is 23–25h away (first run that falls in window)
#   - jag_enq_viewing_reminder_1h  — when viewing is 45–90 min away
# Each reminder uses a separate timestamp column so both can fire for the same viewing.
#
# ── SETUP (run once) ──────────────────────────────────────────────────────────
#   (crontab -l 2>/dev/null; echo "0 * * * * . /opt/jag/jag-infra/.cron-secrets && bash /opt/jag/jag-infra/scripts/viewing-reminders.sh >> /var/log/jag-viewing-reminders.log 2>&1") | crontab -
#
# ── MANUAL RUN ───────────────────────────────────────────────────────────────
#   KC_CRON_CLIENT_SECRET=<jag-cron-service-client-secret> bash /opt/jag/jag-infra/scripts/viewing-reminders.sh

set -euo pipefail

KC_URL="https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token"
# Uses the jag-cron-service Keycloak client (client_credentials grant) rather than
# ROPC against Robert's real human account — see project_cron_ropc_auth_failures.
KC_CLIENT_ID="jag-cron-service"
KC_CLIENT_SECRET="${KC_CRON_CLIENT_SECRET:?KC_CRON_CLIENT_SECRET is required}"
API_BASE="${JAG_API_URL:-https://api.jagcorporate.com/api/v1}"

log() {
  local action="$1" severity="$2"; shift 2
  printf '{"timestamp":"%s","entity":"VIEWING_REMINDERS","action":"%s","severity":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$severity" "${*:+,$*}"
}

command -v jq &>/dev/null || { log "preflight_fail" "ERROR" '"reason":"jq not found"'; exit 1; }

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

R24=$(api_post "properties/viewings/send-reminders")
SENT24=$(echo "$R24" | jq -r '.data.sent // 0')
log "24h_complete" "INFO" "\"sent\":$SENT24"

R1=$(api_post "properties/viewings/send-reminders-1h")
SENT1=$(echo "$R1" | jq -r '.data.sent // 0')
log "1h_complete" "INFO" "\"sent\":$SENT1"

log "complete" "INFO" "\"24h_sent\":$SENT24,\"1h_sent\":$SENT1"
