#!/usr/bin/env bash
# Usage: ./scripts/set-user-tenant.sh <keycloak-user-uuid> <tenant-uuid>
#
# Sets the jag_tenant_id attribute on a Keycloak user.
# Run this once per user after creating them in Keycloak.
#
# Example:
#   ./scripts/set-user-tenant.sh 7b5c9330-... 00000000-0000-0000-0001-000000000001
#
# Tenant UUIDs (from jag_core.tenants):
#   JAG_HOLDINGS      00000000-0000-0000-0001-000000000001
#   JABCO             00000000-0000-0000-0001-000000000002
#   JAG_PROPERTIES    00000000-0000-0000-0001-000000000003
#   JAG_ENTERTAINMENT 00000000-0000-0000-0001-000000000004
#   JAG_FINANCE       00000000-0000-0000-0001-000000000005
#   DRAGONBRIDGE      00000000-0000-0000-0001-000000000006
#   NLCB              00000000-0000-0000-0001-000000000007

set -euo pipefail

USER_ID="${1:?Usage: $0 <keycloak-user-uuid> <tenant-uuid>}"
TENANT_ID="${2:?Usage: $0 <keycloak-user-uuid> <tenant-uuid>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
[[ -f "${INFRA_DIR}/.env" ]] && { set -a; source "${INFRA_DIR}/.env"; set +a; }

KC_BASE_URL="${KC_BASE_URL:-http://localhost:8080}"
KC_REALM="${KC_REALM:-jag}"
KC_ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
KC_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:?KEYCLOAK_ADMIN_PASSWORD not set}"

TOKEN=$(curl -sf -X POST \
  "${KC_BASE_URL}/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=admin-cli&username=${KC_ADMIN_USER}&password=${KC_ADMIN_PASSWORD}" \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

# Fetch current user, merge attribute, PUT back
USER_JSON=$(curl -sf \
  "${KC_BASE_URL}/admin/realms/${KC_REALM}/users/${USER_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

USERNAME=$(echo "${USER_JSON}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('username','?'))")

UPDATED=$(echo "${USER_JSON}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
d.setdefault('attributes', {})['jag_tenant_id'] = ['${TENANT_ID}']
print(json.dumps(d))
")

HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  "${KC_BASE_URL}/admin/realms/${KC_REALM}/users/${USER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${UPDATED}")

if [[ "${HTTP}" == "204" ]]; then
  echo "✓ Set jag_tenant_id=${TENANT_ID} on user ${USERNAME} (${USER_ID})"
else
  echo "ERROR: HTTP ${HTTP}"
  exit 1
fi
