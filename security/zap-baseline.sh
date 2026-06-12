#!/usr/bin/env bash
# JAG ZAP baseline (passive) scan — safe against production.
# Called by deploy.sh (Step 5.5). Blocks deploy on HIGH-risk findings.
#
# Required env:  ZAP_SCAN_PASSWORD — Keycloak password for scan account
# Optional env:  ZAP_SCAN_USER    — Keycloak username (default: Robert's account)
#                ZAP_TARGET       — scan target URL
#                ZAP_CLIENT_SECRET — jag-api client secret

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
REPORT_BASE="baseline-${TIMESTAMP}"
ZAP_IMAGE="ghcr.io/zaproxy/zaproxy:stable"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${GREEN}[zap-baseline]${NC} $*"; }
warn() { echo -e "${YELLOW}[zap-baseline]${NC} $*"; }
fail() { echo -e "${RED}[zap-baseline] FAILED${NC} $*"; exit 1; }

mkdir -p "$REPORT_DIR"

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
  || fail "Keycloak token request failed — check ZAP_SCAN_PASSWORD and network connectivity.")

TOKEN=$(echo "$TOKEN_JSON" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('access_token',''))" \
  || fail "Failed to parse Keycloak token response.")

[[ -n "$TOKEN" ]] || fail "Empty token — check ZAP_SCAN_USER / ZAP_SCAN_PASSWORD / KC connectivity."
info "JWT obtained (${#TOKEN} chars)."

# ── Pull image ────────────────────────────────────────────────────────────────
info "Ensuring ZAP image is current…"
docker pull "$ZAP_IMAGE" -q

# ── Windows path conversion for Docker volume mounts ─────────────────────────
# Git Bash (MINGW) converts container paths like /zap/hooks to Windows paths.
# MSYS_NO_PATHCONV=1 prevents that. cygpath -w gives Docker the Windows host path.
if command -v cygpath > /dev/null 2>&1; then
  REPORT_DIR_D=$(cygpath -w "$REPORT_DIR")
  HOOKS_DIR_D=$(cygpath -w "$SCRIPT_DIR")
else
  REPORT_DIR_D="$REPORT_DIR"
  HOOKS_DIR_D="$SCRIPT_DIR"
fi

# ── Run baseline scan ─────────────────────────────────────────────────────────
info "Running passive scan against $TARGET…"
info "Report → $REPORT_DIR/${REPORT_BASE}.html"

set +e
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$REPORT_DIR_D:/zap/wrk:rw" \
  -v "$HOOKS_DIR_D:/zap/hooks:ro" \
  -e "ZAP_TOKEN=$TOKEN" \
  "$ZAP_IMAGE" \
  zap-baseline.py \
  -t "$TARGET" \
  -r "${REPORT_BASE}.html" \
  -J "${REPORT_BASE}.json" \
  -c /zap/hooks/zap-baseline.conf \
  -l WARN \
  --hook /zap/hooks/zap_auth_hook.py
ZAP_EXIT=$?
set -e

# ── Interpret results ────────────────────────────────────────────────────────
# ZAP exit codes respect zap-baseline.conf classifications.
# We additionally backstop on any HIGH (riskcode 3+) regardless of config.
if [[ $ZAP_EXIT -eq 3 ]]; then
  fail "ZAP failed to start (exit 3). Check Docker logs."
fi

JSON_REPORT="$REPORT_DIR/${REPORT_BASE}.json"
HIGH_COUNT=0
if [[ -f "$JSON_REPORT" ]]; then
  HIGH_COUNT=$(python3 - "$JSON_REPORT" <<'EOF'
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
alerts = [a for s in d.get('site', []) for a in s.get('alerts', [])]
print(sum(1 for a in alerts if int(a.get('riskcode', 0)) >= 3))
EOF
  )
fi

if [[ "$HIGH_COUNT" -gt 0 ]]; then
  echo ""
  echo -e "${RED}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  ZAP BASELINE: HIGH-RISK FINDINGS — DEPLOY BLOCKED  ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════════════╝${NC}"
  echo -e "${RED}High-risk alerts: $HIGH_COUNT${NC}"
  echo -e "${RED}Report: $REPORT_DIR/${REPORT_BASE}.html${NC}"
  echo ""
  exit 2
elif [[ $ZAP_EXIT -eq 2 ]]; then
  echo -e "${RED}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  ZAP BASELINE: FAIL-LEVEL FINDINGS — DEPLOY BLOCKED ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════════════╝${NC}"
  echo -e "${RED}Report: $REPORT_DIR/${REPORT_BASE}.html${NC}"
  exit 2
elif [[ $ZAP_EXIT -eq 1 ]]; then
  warn "Baseline scan: warnings detected — review but not blocking deploy."
  warn "Report: $REPORT_DIR/${REPORT_BASE}.html"
else
  info "Baseline scan PASSED — 0 warnings, 0 failures."
fi

info "Full report: $REPORT_DIR/${REPORT_BASE}.html"
