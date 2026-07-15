#!/bin/bash
# Documenso completion reconciliation sweep — runs every 15 min via cron.
# Catches any lease/handover-checklist Documenso submission that shows as
# COMPLETED on Documenso's side but never got its signed PDF stored (e.g. an
# API redeploy landing in the webhook's fire-and-forget window — see
# jag-api/src/lib/documenso-completion.ts for the full explanation).
#
# Cron entry (add to /etc/cron.d/jag or the JAG crontab):
#   */15 * * * * root bash /opt/jag/jag-infra/scripts/documenso-reconcile.sh >> /var/log/jag-documenso-reconcile.log 2>&1

set -euo pipefail

SCRIPT="documenso-reconcile"
API_URL="http://localhost:3000"

# Load shared secrets (DOCUMENSO_RECONCILE_TOKEN lives here)
if [ -f /opt/jag/jag-infra/.cron-secrets ]; then
  # shellcheck disable=SC1091
  source /opt/jag/jag-infra/.cron-secrets
fi

TOKEN="${DOCUMENSO_RECONCILE_TOKEN:-}"

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $SCRIPT: starting sweep"

HTTP_STATUS=$(curl -s -o /tmp/documenso-reconcile-response.json -w "%{http_code}" \
  -X POST "${API_URL}/internal/documenso-reconcile" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  --connect-timeout 10 \
  --max-time 60 \
  -d '{}')

if [ "$HTTP_STATUS" = "200" ]; then
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $SCRIPT: sweep complete (HTTP 200) — $(cat /tmp/documenso-reconcile-response.json)"
else
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $SCRIPT: sweep FAILED (HTTP ${HTTP_STATUS})" >&2
  cat /tmp/documenso-reconcile-response.json >&2 || true
  exit 1
fi
