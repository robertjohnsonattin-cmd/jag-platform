#!/usr/bin/env bash
# JAG Finance — Insurance renewal alert monitor
#
# Runs daily. Finds active insurance policies entering their renewal_alert_days
# window (standard, Tier 2) or within 7 days of / past expiry (urgent, Tier 1)
# and fires a JAG bell notification for each, once per expiry cycle. The cycle
# resets automatically when the policy is renewed (PATCH changes expiry_date).
#
# ── SETUP (run once) ──────────────────────────────────────────────────────────
#   (crontab -l 2>/dev/null; echo "0 8 * * * KC_PASSWORD=<pw> bash /opt/jag/jag-infra/scripts/insurance-renewal-alerts.sh >> /var/log/jag-insurance-renewals.log 2>&1") | crontab -
#
# ── MANUAL RUN ───────────────────────────────────────────────────────────────
#   KC_PASSWORD=<keycloak-password> bash /opt/jag/jag-infra/scripts/insurance-renewal-alerts.sh

set -euo pipefail

KC_URL="https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token"
KC_CLIENT_ID="jag-api"
KC_CLIENT_SECRET="${KC_CLIENT_SECRET:-FIjMqEPT35gr3TRvh6FDdCTnMAX2FAGMjTVHuljqcBU}"
KC_USERNAME="${KC_USERNAME:-robertjohnsonattin@gmail.com}"
KC_PASSWORD="${KC_PASSWORD:?KC_PASSWORD is required}"
API_BASE="${JAG_API_URL:-https://api.jagcorporate.com/api/v1}"

log() {
  local action="$1" severity="$2"; shift 2
  printf '{"timestamp":"%s","entity":"INSURANCE_RENEWALS","action":"%s","severity":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$severity" "${*:+,$*}"
}

command -v jq &>/dev/null || { log "preflight_fail" "ERROR" '"reason":"jq not found"'; exit 1; }

TOKEN=$(curl -sf --max-time 15 -X POST "$KC_URL" \
  -d "grant_type=password&client_id=$KC_CLIENT_ID&client_secret=$KC_CLIENT_SECRET&username=$KC_USERNAME&password=$KC_PASSWORD" \
  | jq -r '.access_token') || true

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  log "auth_fail" "ERROR" '"reason":"failed to obtain token"'
  exit 1
fi

RESPONSE=$(curl -sf --max-time 30 -X POST "$API_BASE/finance/insurance/policies/check-renewals" \
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
  log "check_fail" "ERROR" "\"error\":\"$ERR\""
  exit 1
fi

STANDARD=$(echo "$RESPONSE" | jq -r '.data.standard_sent // 0')
URGENT=$(echo "$RESPONSE" | jq -r '.data.urgent_sent // 0')
SEV="INFO"
[[ "$URGENT" -gt 0 ]] && SEV="WARN"
log "complete" "$SEV" "\"standard_sent\":$STANDARD,\"urgent_sent\":$URGENT"
