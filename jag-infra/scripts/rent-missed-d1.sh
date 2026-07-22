#!/usr/bin/env bash
# JAG Properties — Missed payment D+1 notice
#
# Runs daily at 09:00 UTC (05:00 TT). Finds rent periods where due_date was
# yesterday and no payment was recorded, sends jag_rent_missed_d1 template.
# Updates missed_d1_sent_at to prevent duplicate sends.
#
# ── SETUP (run once) ──────────────────────────────────────────────────────────
#   (crontab -l 2>/dev/null; echo "0 9 * * * . /opt/jag/jag-infra/.cron-secrets && bash /opt/jag/jag-infra/scripts/rent-missed-d1.sh >> /var/log/jag-rent-missed.log 2>&1") | crontab -
#
# ── MANUAL RUN ───────────────────────────────────────────────────────────────
#   KC_CRON_CLIENT_SECRET=<jag-cron-service-client-secret> bash /opt/jag/jag-infra/scripts/rent-missed-d1.sh

set -euo pipefail

KC_URL="https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token"
# Uses the jag-cron-service Keycloak client (client_credentials grant) rather than
# ROPC against Robert's real human account — see project_cron_ropc_auth_failures.
KC_CLIENT_ID="jag-cron-service"
KC_CLIENT_SECRET="${KC_CRON_CLIENT_SECRET:?KC_CRON_CLIENT_SECRET is required}"
API_BASE="${JAG_API_URL:-https://api.jagcorporate.com/api/v1}"

log() {
  local action="$1" severity="$2"; shift 2
  printf '{"timestamp":"%s","entity":"RENT_MISSED_D1","action":"%s","severity":"%s"%s}\n' \
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

RESPONSE=$(curl -sf --max-time 30 -X POST "$API_BASE/properties/rent-schedule/send-missed-d1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}') || true

if [[ -z "$RESPONSE" ]]; then
  log "api_fail" "ERROR" '"reason":"no response from API"'
  exit 1
fi

SENT=$(echo "$RESPONSE" | jq -r '.data.sent // 0')
log "complete" "INFO" "\"sent\":$SENT"
