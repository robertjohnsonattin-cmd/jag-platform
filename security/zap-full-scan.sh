#!/usr/bin/env bash
# JAG ZAP full ACTIVE scan — sends real attack payloads to every endpoint.
# Run manually or on a schedule (e.g. weekly cron). NOT a deploy gate.
#
# ⚠ WARNING: Active scans mutate data. Run during a maintenance window or
#   against a snapshot/restore-able environment. Always review findings
#   before treating them as false positives.
#
# Required env:  ZAP_SCAN_PASSWORD — Keycloak password for scan account
# Optional env:  ZAP_SCAN_USER    — Keycloak username (default: Robert's account)
#                ZAP_TARGET       — scan target URL
#                ZAP_CLIENT_SECRET — jag-api client secret
#
# Usage:
#   ZAP_SCAN_PASSWORD=<pass> ./security/zap-full-scan.sh
#   ZAP_SCAN_PASSWORD=<pass> ZAP_TARGET=https://api.jagcorporate.com ./security/zap-full-scan.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${ZAP_TARGET:-https://api.jagcorporate.com}"
KC_URL="https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token"
KC_CLIENT="jag-api"
KC_CLIENT_SECRET="${ZAP_CLIENT_SECRET:-FIjMqEPT35gr3TRvh6FDdCTnMAX2FAGMjTVHuljqcBU}"
KC_USER="${ZAP_SCAN_USER:-robertjohnsonattin@gmail.com}"
KC_PASS="${ZAP_SCAN_PASSWORD:?ZAP_SCAN_PASSWORD env var is required}"
REPORT_DIR="$SCRIPT_DIR/reports"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
REPORT_BASE="full-scan-${TIMESTAMP}"
ZAP_IMAGE="ghcr.io/zaproxy/zaproxy:stable"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${GREEN}[zap-full]${NC} $*"; }
warn() { echo -e "${YELLOW}[zap-full]${NC} $*"; }
fail() { echo -e "${RED}[zap-full] FAILED${NC} $*"; exit 1; }

mkdir -p "$REPORT_DIR"

# ── Warning prompt ────────────────────────────────────────────────────────────
echo ""
echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║  JAG ZAP FULL ACTIVE SCAN                                  ║${NC}"
echo -e "${RED}║  Target: $TARGET${NC}"
echo -e "${RED}║  This scan sends REAL attack payloads and may write data.  ║${NC}"
echo -e "${RED}║  Estimated duration: 30–90 minutes.                        ║${NC}"
echo -e "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
read -r -p "Proceed with full active scan? Type YES to confirm: " confirm
[[ "$confirm" == "YES" ]] || { echo "Scan aborted."; exit 0; }
echo ""

# ── Preflight ─────────────────────────────────────────────────────────────────
info "Checking Docker…"
docker info > /dev/null 2>&1 || fail "Docker is not running. Start Docker Desktop and retry."

# ── Fetch JWT ─────────────────────────────────────────────────────────────────
info "Fetching JWT from Keycloak…"
TOKEN_JSON=$(curl -sf --ssl-no-revoke -X POST "$KC_URL" \
  --data-urlencode "client_id=$KC_CLIENT" \
  --data-urlencode "client_secret=$KC_CLIENT_SECRET" \
  --data-urlencode "grant_type=password" \
  --data-urlencode "username=$KC_USER" \
  --data-urlencode "password=$KC_PASS" \
  || fail "Keycloak token request failed — check ZAP_SCAN_PASSWORD and network.")

TOKEN=$(echo "$TOKEN_JSON" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('access_token',''))" \
  || fail "Failed to parse Keycloak token response.")

[[ -n "$TOKEN" ]] || fail "Empty token — check ZAP_SCAN_USER / ZAP_SCAN_PASSWORD."
info "JWT obtained (${#TOKEN} chars)."

# ── Pull image ────────────────────────────────────────────────────────────────
info "Ensuring ZAP image is current…"
docker pull "$ZAP_IMAGE" -q

# ── Windows path conversion for Docker volume mounts ─────────────────────────
if command -v cygpath > /dev/null 2>&1; then
  REPORT_DIR_D=$(cygpath -w "$REPORT_DIR")
  HOOKS_DIR_D=$(cygpath -w "$SCRIPT_DIR")
else
  REPORT_DIR_D="$REPORT_DIR"
  HOOKS_DIR_D="$SCRIPT_DIR"
fi

# ── Run full scan ─────────────────────────────────────────────────────────────
info "Starting full active scan against $TARGET…"
info "This will take 30–90 minutes."
info "HTML report → $REPORT_DIR/${REPORT_BASE}.html"
info "JSON report → $REPORT_DIR/${REPORT_BASE}.json"
echo ""

set +e
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$REPORT_DIR_D:/zap/wrk:rw" \
  -v "$HOOKS_DIR_D:/zap/hooks:ro" \
  -e "ZAP_TOKEN=$TOKEN" \
  "$ZAP_IMAGE" \
  zap-full-scan.py \
  -t "$TARGET" \
  -r "${REPORT_BASE}.html" \
  -J "${REPORT_BASE}.json" \
  -l WARN \
  -d \
  --hook /zap/hooks/zap_auth_hook.py
ZAP_EXIT=$?
set -e

# ── Results ───────────────────────────────────────────────────────────────────
echo ""
case $ZAP_EXIT in
  0)
    echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  Full scan PASSED — no issues found.  ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
    ;;
  1)
    warn "Full scan completed: WARNINGS detected."
    warn "Review HTML report for details."
    ;;
  2)
    echo -e "${RED}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  Full scan: HIGH-RISK FINDINGS DETECTED          ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════╝${NC}"
    ;;
  3)
    fail "ZAP failed to start (exit 3). Check Docker logs."
    ;;
  *)
    fail "ZAP exited with unexpected code $ZAP_EXIT."
    ;;
esac

echo ""
info "HTML report: $REPORT_DIR/${REPORT_BASE}.html"
info "JSON report: $REPORT_DIR/${REPORT_BASE}.json"

# Exit with ZAP code so callers can act on HIGH findings
exit $ZAP_EXIT
