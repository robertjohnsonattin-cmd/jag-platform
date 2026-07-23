#!/usr/bin/env bash
# JAG Holdings — FX rates daily sync
#
# Fetches today's exchange rates from open.er-api.com (free, no API key) and
# upserts them into fin_fx_rates via the JAG Finance API.
#
# Rate direction: "how many TTD per 1 unit of foreign currency"
#   e.g. 1 USD = 6.78 TTD  →  rate_to_ttd = 6.78
#
# ── FIRST-TIME SETUP (run once on the VM) ──────────────────────────────────────
#
# 1. Ensure jq is installed:
#      sudo apt-get install -y jq
#
# 2. Add to crontab (runs at 06:00 TT time = 10:00 UTC):
#      (crontab -l 2>/dev/null; echo "0 10 * * * . /opt/jag/jag-infra/.cron-secrets && bash /opt/jag/jag-infra/scripts/fx-rates-sync.sh >> /var/log/jag-fx-sync.log 2>&1") | crontab -
#
# ── MANUAL RUN ─────────────────────────────────────────────────────────────────
#   KC_CRON_CLIENT_SECRET=<jag-cron-service-client-secret> bash /opt/jag/jag-infra/scripts/fx-rates-sync.sh
#
# ── ENV VARS ───────────────────────────────────────────────────────────────────
#   KC_CRON_CLIENT_SECRET — required; secret for the jag-cron-service Keycloak client
#   JAG_API_URL   — optional; defaults to https://api.jagcorporate.com/api/v1
#   CURRENCIES    — optional; space-separated ISO codes; defaults to "USD CNY"

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────────
KC_URL="https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token"
# Uses the jag-cron-service Keycloak client (client_credentials grant) rather than
# ROPC against Robert's real human account — see project_cron_ropc_auth_failures.
KC_CLIENT_ID="jag-cron-service"
KC_CLIENT_SECRET="${KC_CRON_CLIENT_SECRET:?KC_CRON_CLIENT_SECRET env var is required}"

API_BASE="${JAG_API_URL:-https://api.jagcorporate.com/api/v1}"
ER_BASE="https://open.er-api.com/v6/latest"

IFS=' ' read -r -a CURRENCIES <<< "${CURRENCIES:-USD CNY CAD}"

TODAY=$(date +%Y-%m-%d)
EXIT_CODE=0

# ── Helpers ────────────────────────────────────────────────────────────────────
log() {
  local action="$1" severity="$2"
  shift 2
  local extra="${*:-}"
  printf '{"timestamp":"%s","entity":"FX_SYNC","action":"%s","severity":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$severity" "${extra:+,$extra}"
}

# ── Preflight ──────────────────────────────────────────────────────────────────
if ! command -v jq &>/dev/null; then
  log "preflight_fail" "ERROR" '"reason":"jq not found — run: sudo apt-get install -y jq"'
  exit 1
fi

if ! command -v curl &>/dev/null; then
  log "preflight_fail" "ERROR" '"reason":"curl not found"'
  exit 1
fi

log "sync_start" "INFO" "\"date\":\"$TODAY\",\"currencies\":\"${CURRENCIES[*]}\""

# ── Obtain Keycloak token ──────────────────────────────────────────────────────
TOKEN=$(curl -sf --max-time 15 -X POST "$KC_URL" \
  -d "grant_type=client_credentials" \
  -d "client_id=$KC_CLIENT_ID" \
  -d "client_secret=$KC_CLIENT_SECRET" \
  | jq -r '.access_token') || true

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  log "auth_fail" "ERROR" '"reason":"failed to obtain Keycloak token"'
  exit 1
fi

log "auth_ok" "INFO"

# ── Fetch and upsert each currency ────────────────────────────────────────────
for CUR in "${CURRENCIES[@]}"; do
  CUR="${CUR^^}"   # ensure uppercase

  # Fetch: 1 CUR = ? TTD
  ER_RESPONSE=$(curl -sf --max-time 15 "$ER_BASE/$CUR") || true

  if [[ -z "$ER_RESPONSE" ]]; then
    log "fetch_fail" "ERROR" "\"currency\":\"$CUR\",\"reason\":\"no response from open.er-api.com\""
    EXIT_CODE=1
    continue
  fi

  RATE=$(echo "$ER_RESPONSE" | jq -r '.rates.TTD // empty') || true

  if [[ -z "$RATE" || "$RATE" == "null" ]]; then
    log "fetch_fail" "ERROR" "\"currency\":\"$CUR\",\"reason\":\"TTD not in response\""
    EXIT_CODE=1
    continue
  fi

  log "fetch_ok" "INFO" "\"currency\":\"$CUR\",\"rate_to_ttd\":$RATE"

  # POST to JAG Finance API (upserts on currency + rate_date)
  API_RESPONSE=$(curl -sf --max-time 15 -X POST "$API_BASE/finance/fx-rates" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"currency\":\"$CUR\",\"rate_date\":\"$TODAY\",\"rate_to_ttd\":$RATE,\"source\":\"OPEN_ER_API\"}") || true

  if [[ -z "$API_RESPONSE" ]]; then
    log "upsert_fail" "ERROR" "\"currency\":\"$CUR\",\"reason\":\"no response from JAG API\""
    EXIT_CODE=1
    continue
  fi

  SUCCESS=$(echo "$API_RESPONSE" | jq -r '.success // false') || true
  if [[ "$SUCCESS" != "true" ]]; then
    ERR_CODE=$(echo "$API_RESPONSE" | jq -r '.code // "UNKNOWN"')
    log "upsert_fail" "ERROR" "\"currency\":\"$CUR\",\"error_code\":\"$ERR_CODE\""
    EXIT_CODE=1
    continue
  fi

  log "upsert_ok" "INFO" "\"currency\":\"$CUR\",\"rate_to_ttd\":$RATE,\"rate_date\":\"$TODAY\""
done

# ── Summary ───────────────────────────────────────────────────────────────────
TOTAL=${#CURRENCIES[@]}
log "sync_complete" "$([ $EXIT_CODE -eq 0 ] && echo INFO || echo WARN)" \
  "\"currencies_total\":$TOTAL,\"exit_code\":$EXIT_CODE"

exit $EXIT_CODE
