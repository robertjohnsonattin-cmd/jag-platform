#!/usr/bin/env bash
# JAG Properties — Maintenance SLA monitor
#
# Runs every 30 minutes. Finds OPEN/ASSIGNED/IN_PROGRESS tickets that have
# breached their SLA deadline (P1=2h, P2=24h, P3=120h) and:
#   1. Sets sla_breached=true in the database (via API)
#   2. Sends a WhatsApp alert to the property manager
#
# ── SETUP (run once) ──────────────────────────────────────────────────────────
#   (crontab -l 2>/dev/null; echo "*/30 * * * * KC_PASSWORD=<pw> bash /opt/jag/jag-infra/scripts/sla-monitor.sh >> /var/log/jag-sla-monitor.log 2>&1") | crontab -
#
# ── MANUAL RUN ───────────────────────────────────────────────────────────────
#   KC_PASSWORD=<keycloak-password> bash /opt/jag/jag-infra/scripts/sla-monitor.sh

set -euo pipefail

KC_URL="https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token"
KC_CLIENT_ID="jag-api"
KC_CLIENT_SECRET="${KC_CLIENT_SECRET:-FIjMqEPT35gr3TRvh6FDdCTnMAX2FAGMjTVHuljqcBU}"
KC_USERNAME="${KC_USERNAME:-robertjohnsonattin@gmail.com}"
KC_PASSWORD="${KC_PASSWORD:?KC_PASSWORD is required}"
API_BASE="${JAG_API_URL:-https://api.jagcorporate.com/api/v1}"

log() {
  local action="$1" severity="$2"; shift 2
  printf '{"timestamp":"%s","entity":"SLA_MONITOR","action":"%s","severity":"%s"%s}\n' \
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

RESPONSE=$(curl -sf --max-time 30 -X POST "$API_BASE/properties/maintenance/check-sla" \
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

BREACHED=$(echo "$RESPONSE" | jq -r '.data.newly_breached // 0')
TOTAL=$(echo "$RESPONSE" | jq -r '.data.total_breached // 0')
SEV="INFO"
[[ "$TOTAL" -gt 0 ]] && SEV="WARN"
log "complete" "$SEV" "\"newly_breached\":$BREACHED,\"total_breached\":$TOTAL"
