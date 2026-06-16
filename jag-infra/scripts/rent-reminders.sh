#!/usr/bin/env bash
# JAG Properties — Rent reminder sender
#
# Runs daily at 07:00 UTC (03:00 TT). Finds all rent schedule periods that
# are UPCOMING within the next 3 days or are LATE and sends WhatsApp reminders
# via the JAG API batch endpoint. Reminder timestamps are updated server-side
# so duplicates are never sent.
#
# ── SETUP (run once) ──────────────────────────────────────────────────────────
#   (crontab -l 2>/dev/null; echo "0 7 * * * KC_PASSWORD=<pw> bash /opt/jag/jag-infra/scripts/rent-reminders.sh >> /var/log/jag-rent-reminders.log 2>&1") | crontab -
#
# ── MANUAL RUN ───────────────────────────────────────────────────────────────
#   KC_PASSWORD=<keycloak-password> bash /opt/jag/jag-infra/scripts/rent-reminders.sh
#
# ── ENV VARS ─────────────────────────────────────────────────────────────────
#   KC_PASSWORD       — required
#   KC_USERNAME       — optional; defaults to robertjohnsonattin@gmail.com
#   KC_CLIENT_SECRET  — optional; defaults to jag-api secret
#   JAG_API_URL       — optional; defaults to https://api.jagcorporate.com/api/v1

set -euo pipefail

KC_URL="https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token"
KC_CLIENT_ID="jag-api"
KC_CLIENT_SECRET="${KC_CLIENT_SECRET:-FIjMqEPT35gr3TRvh6FDdCTnMAX2FAGMjTVHuljqcBU}"
KC_USERNAME="${KC_USERNAME:-robertjohnsonattin@gmail.com}"
KC_PASSWORD="${KC_PASSWORD:?KC_PASSWORD is required}"
API_BASE="${JAG_API_URL:-https://api.jagcorporate.com/api/v1}"

log() {
  local action="$1" severity="$2"; shift 2
  printf '{"timestamp":"%s","entity":"RENT_REMINDERS","action":"%s","severity":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$severity" "${*:+,$*}"
}

command -v jq &>/dev/null || { log "preflight_fail" "ERROR" '"reason":"jq not found"'; exit 1; }

log "start" "INFO"

TOKEN=$(curl -sf --max-time 15 -X POST "$KC_URL" \
  -d "grant_type=password&client_id=$KC_CLIENT_ID&client_secret=$KC_CLIENT_SECRET&username=$KC_USERNAME&password=$KC_PASSWORD" \
  | jq -r '.access_token') || true

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  log "auth_fail" "ERROR" '"reason":"failed to obtain token"'
  exit 1
fi

RESPONSE=$(curl -sf --max-time 30 -X POST "$API_BASE/properties/rent-schedule/send-reminders" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}') || true

if [[ -z "$RESPONSE" ]]; then
  log "api_fail" "ERROR" '"reason":"no response from API"'
  exit 1
fi

SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')
if [[ "$SUCCESS" != "true" ]]; then
  ERR=$(echo "$RESPONSE" | jq -r '.error // "unknown"')
  log "send_fail" "ERROR" "\"error\":\"$ERR\""
  exit 1
fi

SENT=$(echo "$RESPONSE" | jq -r '.data.sent // 0')
log "complete" "INFO" "\"sent\":$SENT"
