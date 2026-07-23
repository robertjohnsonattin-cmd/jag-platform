#!/usr/bin/env bash
# JAG Properties — Stale listing alert to owner
#
# Runs daily at 08:00 UTC (04:00 TT). Finds units that have been LISTED for
# more than STALE_DAYS (default 14) without a viewing booked and sends
# jag_adv_stale_alert to the owner's WhatsApp. Re-alerts at most once per
# 7 days per unit (server-side dedup via stale_alert_sent_at column).
#
# ── SETUP (run once) ──────────────────────────────────────────────────────────
#   (crontab -l 2>/dev/null; echo "0 8 * * * . /opt/jag/jag-infra/.cron-secrets && bash /opt/jag/jag-infra/scripts/stale-listing-alert.sh >> /var/log/jag-stale-listings.log 2>&1") | crontab -
#
# ── MANUAL RUN ───────────────────────────────────────────────────────────────
#   KC_CRON_CLIENT_SECRET=<jag-cron-service-client-secret> bash /opt/jag/jag-infra/scripts/stale-listing-alert.sh

set -euo pipefail

KC_URL="https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token"
# Uses the jag-cron-service Keycloak client (client_credentials grant) rather than
# ROPC against Robert's real human account — see project_cron_ropc_auth_failures.
KC_CLIENT_ID="jag-cron-service"
KC_CLIENT_SECRET="${KC_CRON_CLIENT_SECRET:?KC_CRON_CLIENT_SECRET is required}"
API_BASE="${JAG_API_URL:-https://api.jagcorporate.com/api/v1}"
STALE_DAYS="${STALE_DAYS:-14}"

log() {
  local action="$1" severity="$2"; shift 2
  printf '{"timestamp":"%s","entity":"STALE_LISTING","action":"%s","severity":"%s"%s}\n' \
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

# Uses /units/:id/alert-stale but there's a global batch endpoint under listingRouter
# The batch route is POST /properties/units/alert-stale (no :id — matches all owned units)
RESPONSE=$(curl -sf --max-time 60 -X POST "$API_BASE/properties/units/alert-stale" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"stale_days\":$STALE_DAYS}") || true

if [[ -z "$RESPONSE" ]]; then
  log "api_fail" "ERROR" '"reason":"no response from API"'
  exit 1
fi

ALERTED=$(echo "$RESPONSE" | jq -r '.data.alerted // 0')
SEV="INFO"
[[ "$ALERTED" -gt 0 ]] && SEV="WARN"
log "complete" "$SEV" "\"alerted\":$ALERTED"
