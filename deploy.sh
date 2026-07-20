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
NO_COMMIT=0
NO_PUSH=0

for arg in "$@"; do
  case $arg in
    --skip-typecheck) SKIP_TYPECHECK=1 ;;
    --skip-frontend)  SKIP_FRONTEND=1 ;;
    --skip-zap)       SKIP_ZAP=1 ;;
    --api-only)       API_ONLY=1; SKIP_FRONTEND=1 ;;
    --frontend-only)  FRONTEND_ONLY=1 ;;
    --no-commit)      NO_COMMIT=1 ;;
    --no-push)        NO_PUSH=1 ;;
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

  # Regression 2026-07-20: this step was missing entirely. The Dockerfile's
  # `COPY prod_modules/node_modules` builds from whatever is already sitting
  # in /opt/jag/jag-api/prod_modules/ on the VM -- a stale, independent copy
  # that nothing else here updates. Adding a new backend dependency (jimp)
  # shipped a dist/ that required it while the container's node_modules
  # didn't have it, causing an immediate crash-loop and a ~1h production
  # outage. Always resync node_modules alongside dist/ so the two can never
  # drift apart again.
  info "Step 4a — Rebuilding prod_modules/ and uploading to VM…"
  ( cd "$SCRIPT_DIR/jag-api" && npm run prod-install ) || fail "prod-install failed."
  $SCP_CMD -r "$SCRIPT_DIR/jag-api/prod_modules/node_modules" "$VM_HOST:/opt/jag/jag-api/prod_modules/" \
    || fail "SCP of prod_modules/node_modules failed."
  info "prod_modules/node_modules uploaded."

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

# ── Step 8: Git snapshot ──────────────────────────────────────────────────────
# Checkpoint the deployed state into git so "deployed" and "saved" always happen
# together. Runs only after a successful deploy. Non-fatal — a commit problem never
# fails the deploy. Disable with --no-commit. Binaries/reports are kept out via .gitignore.
if [[ $NO_COMMIT -eq 0 ]]; then
  info "Step 8/8 — Committing deployed state to git…"
  cd "$SCRIPT_DIR"
  if [[ -n "$(git status --porcelain)" ]]; then
    TARGETS=""
    [[ $FRONTEND_ONLY -eq 1 ]] && TARGETS="frontend"
    [[ $API_ONLY -eq 1 ]]      && TARGETS="api"
    [[ -z "$TARGETS" ]]        && TARGETS="api + frontend"
    if git add -A && git commit -q -m "chore(deploy): production deploy $(date +'%Y-%m-%d %H:%M') ($TARGETS)

Auto-committed by deploy.sh after a successful deploy.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"; then
      info "Saved deploy snapshot: $(git rev-parse --short HEAD)"
    else
      warn "git commit failed — deploy succeeded but the snapshot was not saved."
    fi
  else
    info "No changes to commit."
  fi

  # Push the snapshot off-site so the private GitHub backup stays current. Non-fatal,
  # fails fast (no interactive auth prompt). Disable with --no-push.
  if [[ $NO_PUSH -eq 0 ]]; then
    info "Pushing to off-site backup (origin)…"
    if GIT_TERMINAL_PROMPT=0 git push -q origin HEAD 2>/dev/null; then
      info "Off-site backup updated."
    else
      warn "git push failed — committed locally but NOT backed up off-site (check auth / network)."
    fi
  else
    info "Off-site push SKIPPED (--no-push)."
  fi
else
  info "Step 8/8 — Git snapshot SKIPPED (--no-commit)."
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
