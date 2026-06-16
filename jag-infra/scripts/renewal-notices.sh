#!/usr/bin/env bash
# JAG Properties — Lease renewal notice sender
#
# Runs daily at 08:00 UTC (04:00 TT). Checks all active leases and sends
# WhatsApp renewal notice templates at D-60, D-30, and D-14 milestones.
# Server-side tracks which notices have been sent to prevent duplicates.
# Also creates prop_renewal_notices rows if they don't exist yet.
#
# ── SETUP (run once) ──────────────────────────────────────────────────────────
#   (crontab -l 2>/dev/null; echo "0 8 * * * KC_PASSWORD=<pw> bash /opt/jag/jag-infra/scripts/renewal-notices.sh >> /var/log/jag-renewal-notices.log 2>&1") | crontab -
#
# ── MANUAL RUN ───────────────────────────────────────────────────────────────
#   KC_PASSWORD=<keycloak-password> bash /opt/jag/jag-infra/scripts/renewal-notices.sh

set -euo pipefail

KC_URL="https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token"
KC_CLIENT_ID="jag-api"
KC_CLIENT_SECRET="${KC_CLIENT_SECRET:-FIjMqEPT35gr3TRvh6FDdCTnMAX2FAGMjTVHuljqcBU}"
KC_USERNAME="${KC_USERNAME:-robertjohnsonattin@gmail.com}"
KC_PASSWORD="${KC_PASSWORD:?KC_PASSWORD is required}"
API_BASE="${JAG_API_URL:-https://api.jagcorporate.com/api/v1}"

log() {
  local action="$1" severity="$2"; shift 2
  printf '{"timestamp":"%s","entity":"RENEWAL_NOTICES","action":"%s","severity":"%s"%s}\n' \
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

RESPONSE=$(curl -sf --max-time 60 -X POST "$API_BASE/properties/renewals/send-notices" \
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

D60=$(echo "$RESPONSE" | jq -r '.data.d60_sent // 0')
D30=$(echo "$RESPONSE" | jq -r '.data.d30_sent // 0')
D14=$(echo "$RESPONSE" | jq -r '.data.d14_sent // 0')
log "complete" "INFO" "\"d60_sent\":$D60,\"d30_sent\":$D30,\"d14_sent\":$D14"
