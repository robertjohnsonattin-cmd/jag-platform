#!/usr/bin/env bash
# Renders backup-alerts.yml.template -> backup-alerts.yml, substituting the
# real GRAFANA_ALERT_WEBHOOK_TOKEN from .env. Run on the VM after deploying
# a new/changed template, then force-recreate grafana to pick it up:
#   bash /opt/jag/jag-infra/scripts/render-grafana-alerts.sh
#   cd /opt/jag/jag-infra && docker compose up -d --force-recreate grafana
#
# The rendered file is NOT committed to git (contains the real secret) —
# only the .template is tracked. Same convention as .env.example vs .env.

set -euo pipefail

INFRA_DIR="/opt/jag/jag-infra"
TEMPLATE="${INFRA_DIR}/grafana/provisioning/alerting/backup-alerts.yml.template"
OUTPUT="${INFRA_DIR}/grafana/provisioning/alerting/backup-alerts.yml"

set -a
source "${INFRA_DIR}/.env" >/dev/null 2>&1
set +a

if [[ -z "${GRAFANA_ALERT_WEBHOOK_TOKEN:-}" ]]; then
  echo "ERROR: GRAFANA_ALERT_WEBHOOK_TOKEN not set in ${INFRA_DIR}/.env" >&2
  exit 1
fi

sed "s|__GRAFANA_ALERT_WEBHOOK_TOKEN__|${GRAFANA_ALERT_WEBHOOK_TOKEN}|g" "$TEMPLATE" > "$OUTPUT"
# 644, not 600 -- the grafana container reads this via a bind mount as its
# own (non-root) UID, not the host "ubuntu" owner, so owner-only 600 caused
# a "permission denied" provisioning failure the first time this was tried.
# The containing directory is only reachable via the VM/Docker anyway.
chmod 644 "$OUTPUT"
echo "Rendered ${OUTPUT}"
