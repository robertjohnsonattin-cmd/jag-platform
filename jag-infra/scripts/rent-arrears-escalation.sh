#!/usr/bin/env bash
# JAG Properties — Arrears escalation queue (D+7 and D+14)
#
# Runs daily at 09:30 UTC (05:30 TT). Finds rent periods that are 7 or 14 days
# overdue and drafts jag_rent_formal_demand / jag_rent_legal_notice into
# prop_wa_pending_approvals for Robert to review and approve in the platform
# before the message is sent to tenants.
#
# ── SETUP (run once) ──────────────────────────────────────────────────────────
#   (crontab -l 2>/dev/null; echo "30 9 * * * KC_PASSWORD=<pw> bash /opt/jag/jag-infra/scripts/rent-arrears-escalation.sh >> /var/log/jag-arrears.log 2>&1") | crontab -
#
# ── MANUAL RUN ───────────────────────────────────────────────────────────────
#   KC_PASSWORD=<keycloak-password> bash /opt/jag/jag-infra/scripts/rent-arrears-escalation.sh

set -euo pipefail

KC_URL="https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token"
KC_CLIENT_ID="jag-api"
KC_CLIENT_SECRET="${KC_CLIENT_SECRET:-FIjMqEPT35gr3TRvh6FDdCTnMAX2FAGMjTVHuljqcBU}"
KC_USERNAME="${KC_USERNAME:-robertjohnsonattin@gmail.com}"
KC_PASSWORD="${KC_PASSWORD:?KC_PASSWORD is required}"
API_BASE="${JAG_API_URL:-https://api.jagcorporate.com/api/v1}"

log() {
  local action="$1" severity="$2"; shift 2
  printf '{"timestamp":"%s","entity":"ARREARS_ESCALATION","action":"%s","severity":"%s"%s}\n' \
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

RESPONSE=$(curl -sf --max-time 30 -X POST "$API_BASE/properties/rent-schedule/queue-arrears-escalation" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}') || true

if [[ -z "$RESPONSE" ]]; then
  log "api_fail" "ERROR" '"reason":"no response from API"'
  exit 1
fi

QUEUED=$(echo "$RESPONSE" | jq -r '.data.queued // 0')
SEV="INFO"
[[ "$QUEUED" -gt 0 ]] && SEV="WARN"
log "complete" "$SEV" "\"queued\":$QUEUED"
