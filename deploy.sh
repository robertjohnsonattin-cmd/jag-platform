#!/usr/bin/env bash
# STD-12 deploy gate — JAG Holdings production deploy
# Usage: ./deploy.sh [--skip-typecheck] [--skip-frontend] [--skip-zap] [--api-only] [--frontend-only]
# Env:   ZAP_SCAN_PASSWORD — set to enable ZAP baseline scan (Step 6)
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
VM_HOST="ubuntu@150.136.151.64"
VM_SSH_KEY="${SSH_KEY:-$HOME/.ssh/jag_oracle2}"
VM_API_SRC="/opt/jag/jag-api/src"
VM_INFRA_DIR="/opt/jag/jag-infra"
VM_WEB_DIST="/opt/jag/jag-web/dist"
HEALTH_URL="https://api.jagcorporate.com/health/ready"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Flags ─────────────────────────────────────────────────────────────────────
SKIP_TYPECHECK=0
SKIP_FRONTEND=0
SKIP_ZAP=0
API_ONLY=0
FRONTEND_ONLY=0

for arg in "$@"; do
  case $arg in
    --skip-typecheck) SKIP_TYPECHECK=1 ;;
    --skip-frontend)  SKIP_FRONTEND=1 ;;
    --skip-zap)       SKIP_ZAP=1 ;;
    --api-only)       API_ONLY=1; SKIP_FRONTEND=1 ;;
    --frontend-only)  FRONTEND_ONLY=1 ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()    { echo -e "${YELLOW}[deploy]${NC} $*"; }
fail()    { echo -e "${RED}[deploy] FAILED${NC} $*"; exit 1; }

SSH_CMD="ssh -i $VM_SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10"
SCP_CMD="scp -i $VM_SSH_KEY -o StrictHostKeyChecking=no"

check_ssh() {
  info "Checking VM connectivity…"
  $SSH_CMD "$VM_HOST" "echo ok" > /dev/null 2>&1 || fail "Cannot reach VM. Check VPN / SSH key ($VM_SSH_KEY)."
  info "VM reachable."
}

# ── Robert sign-off ───────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}┌─────────────────────────────────────────────────────┐${NC}"
echo -e "${YELLOW}│  JAG Holdings — Production Deploy (STD-12)          │${NC}"
echo -e "${YELLOW}│  Target: $HEALTH_URL  │${NC}"
echo -e "${YELLOW}└─────────────────────────────────────────────────────┘${NC}"
echo ""

if [[ $FRONTEND_ONLY -eq 0 ]]; then
  read -r -p "Deploy API to production? Type YES to confirm: " confirm
  [[ "$confirm" == "YES" ]] || fail "Deploy aborted — type YES exactly to proceed."
fi

echo ""

# ── Step 1: TypeScript type check ─────────────────────────────────────────────
if [[ $FRONTEND_ONLY -eq 0 && $SKIP_TYPECHECK -eq 0 ]]; then
  info "Step 1/7 — Compiling TypeScript (jag-api)…"
  cd "$SCRIPT_DIR/jag-api"
  npm run build:prod || fail "TypeScript compilation failed. Fix errors before deploying."
  info "Compilation complete."
else
  info "Step 1/7 — TypeScript check SKIPPED."
fi

# ── Step 2: Build frontend ────────────────────────────────────────────────────
if [[ $SKIP_FRONTEND -eq 0 ]]; then
  info "Step 2/7 — Building React frontend (jag-web)…"
  cd "$SCRIPT_DIR/jag-web"
  npm run build || fail "Frontend build failed."
  info "Frontend build complete."
else
  info "Step 2/7 — Frontend build SKIPPED."
fi

# ── Step 3: Check VM ──────────────────────────────────────────────────────────
info "Step 3/7 — Checking VM connectivity…"
check_ssh

# ── Step 4: Deploy API source ─────────────────────────────────────────────────
if [[ $FRONTEND_ONLY -eq 0 ]]; then
  info "Step 4/7 — Uploading compiled dist/ to VM…"
  # The Dockerfile copies dist/ (pre-built on host) — never src/
  $SCP_CMD -r "$SCRIPT_DIR/jag-api/dist/." "$VM_HOST:/opt/jag/jag-api/dist/" || fail "SCP of dist/ failed."
  info "dist/ uploaded."

  info "Step 4b — Rebuilding and restarting API container…"
  $SSH_CMD "$VM_HOST" "
    set -e
    cd $VM_INFRA_DIR
    docker compose build api
    docker compose up -d api
    echo 'Container restarted.'
  " || fail "Docker rebuild/restart failed on VM."

  info "Waiting for API to come up (15 s)…"
  sleep 15

  info "Step 5/7 — Health check: $HEALTH_URL"
  for i in 1 2 3 4 5; do
    STATUS=$($SSH_CMD "$VM_HOST" "curl -sf -o /dev/null -w '%{http_code}' '$HEALTH_URL'" 2>/dev/null || echo "000")
    if [[ "$STATUS" == "200" ]]; then
      info "Health check passed (HTTP 200)."
      break
    fi
    warn "Attempt $i: HTTP $STATUS — waiting 10 s…"
    sleep 10
    [[ $i -eq 5 ]] && fail "Health check did not pass after 5 attempts. Check container logs: ssh -i $VM_SSH_KEY $VM_HOST 'docker logs jag-api'"
  done
else
  info "Steps 4-5 — API deploy SKIPPED (--frontend-only)."
fi

# ── Step 6: ZAP baseline scan ─────────────────────────────────────────────────
if [[ $SKIP_ZAP -eq 0 && $FRONTEND_ONLY -eq 0 ]]; then
  if [[ -z "${ZAP_SCAN_PASSWORD:-}" ]]; then
    warn "Step 6/7 — ZAP baseline SKIPPED (ZAP_SCAN_PASSWORD not set). Set it to enable security gate."
  else
    info "Step 6/7 — Running ZAP baseline scan…"
    bash "$SCRIPT_DIR/security/zap-baseline.sh" \
      || fail "ZAP baseline found HIGH-risk issues. Fix before deploying. See security/reports/ for the HTML report."
  fi
else
  info "Step 6/7 — ZAP baseline SKIPPED."
fi

# ── Step 7: Deploy frontend ───────────────────────────────────────────────────
if [[ $SKIP_FRONTEND -eq 0 ]]; then
  info "Step 7/7 — Uploading frontend dist to VM…"
  # Clear old dist and upload fresh build
  $SSH_CMD "$VM_HOST" "find ${VM_WEB_DIST:?} -mindepth 1 -delete 2>/dev/null; mkdir -p $VM_WEB_DIST"
  $SCP_CMD -r "$SCRIPT_DIR/jag-web/dist/." "$VM_HOST:$VM_WEB_DIST/" || fail "SCP of frontend dist failed."
  info "Frontend deployed to $VM_WEB_DIST."
else
  info "Step 7/7 — Frontend upload SKIPPED."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}┌─────────────────────────────────────────────────────┐${NC}"
echo -e "${GREEN}│  Deploy complete!                                   │${NC}"
[[ $FRONTEND_ONLY -eq 0 ]] && \
echo -e "${GREEN}│  API:  $HEALTH_URL     │${NC}"
[[ $SKIP_FRONTEND -eq 0 ]] && \
echo -e "${GREEN}│  Web:  https://jagcorporate.com                     │${NC}"
echo -e "${GREEN}└─────────────────────────────────────────────────────┘${NC}"
echo ""
