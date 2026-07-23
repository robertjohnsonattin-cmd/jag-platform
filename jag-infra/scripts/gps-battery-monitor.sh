#!/bin/bash
# GPS battery monitor — runs hourly via cron.
# Polls Traccar for latest position of every registered tracker,
# extracts batteryLevel, writes to gps_battery_log, and fires
# a low-battery notification when level drops to ≤20%.
#
# Cron entry (add to /etc/cron.d/jag or the JAG crontab):
#   0 * * * * root bash /opt/jag/jag-infra/scripts/gps-battery-monitor.sh >> /var/log/jag-gps-battery.log 2>&1

set -euo pipefail

SCRIPT="gps-battery-monitor"
LOG_FILE="/var/log/jag-gps-battery.log"
API_URL="http://localhost:3000"

# Load shared secrets (TRACCAR_EVENT_TOKEN lives here)
if [ -f /opt/jag/jag-infra/.cron-secrets ]; then
  # shellcheck disable=SC1091
  source /opt/jag/jag-infra/.cron-secrets
fi

TOKEN="${TRACCAR_EVENT_TOKEN:-}"

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $SCRIPT: starting battery sync"

HTTP_STATUS=$(curl -s -o /tmp/gps-battery-response.json -w "%{http_code}" \
  -X POST "${API_URL}/internal/gps/battery-sync" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  --connect-timeout 10 \
  --max-time 30 \
  -d '{}')

if [ "$HTTP_STATUS" = "200" ]; then
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $SCRIPT: sync complete (HTTP 200)"
else
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $SCRIPT: sync FAILED (HTTP ${HTTP_STATUS})" >&2
  cat /tmp/gps-battery-response.json >&2 || true
  exit 1
fi
