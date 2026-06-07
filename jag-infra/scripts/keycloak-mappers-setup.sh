#!/usr/bin/env bash
# JAG Platform — F-07 Keycloak Custom Claim Mappers
#
# Adds two protocol mappers to the "jag-api" client in the "jag" realm:
#
#   jag_user_id   — Keycloak user's own UUID (from the built-in "sub" / user id).
#                   Added to both the access token and the ID token.
#                   The JAG API reads this to resolve the jag_core.users row.
#
#   jag_tenant_id — User attribute "jag_tenant_id" set on each Keycloak user.
#                   Holds the UUID of the user's active (default) tenant.
#                   Set this attribute when you create / onboard each user.
#                   The JAG API sets app.current_tenant_id from this claim.
#
# Usage:
#   ./scripts/keycloak-mappers-setup.sh
#
# Idempotent: existing mappers with the same names are deleted before re-creation.
#
# After running this script:
#   1. Open Keycloak Admin Console → realm "jag" → Clients → jag-api
#      → Client scopes → jag-api-dedicated → Mappers tab.
#      Verify both mappers appear.
#   2. For each user, set the "jag_tenant_id" user attribute:
#      Users → [select user] → Attributes tab
#      Key: jag_tenant_id   Value: <UUID from jag_core.tenants>
#   3. After setting the attribute, the claim will appear in the user's
#      access token automatically on next login.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${INFRA_DIR}/.env" ]]; then
  set -a; source "${INFRA_DIR}/.env"; set +a
fi

KC_BASE_URL="${KC_BASE_URL:-http://localhost:8080}"
KC_REALM="${KC_REALM:-jag}"
KC_ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
KC_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD}"
CLIENT_ID_NAME="${KEYCLOAK_CLIENT_ID:-jag-api}"   # client clientId (not UUID)

if [[ -z "${KC_ADMIN_PASSWORD:-}" ]]; then
  echo "ERROR: KEYCLOAK_ADMIN_PASSWORD is not set."
  exit 1
fi

log() { echo "[$(date -u '+%H:%M:%S')] $*"; }

# ── Auth ──────────────────────────────────────────────────────────────────────

log "Authenticating..."
TOKEN=$(curl -sf -X POST \
  "${KC_BASE_URL}/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=admin-cli&username=${KC_ADMIN_USER}&password=${KC_ADMIN_PASSWORD}" \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
[[ -z "${TOKEN}" ]] && { echo "ERROR: auth failed"; exit 1; }
log "Token OK."

kc_get()    { curl -sf -H "Authorization: Bearer ${TOKEN}" "${KC_BASE_URL}/admin/realms/${KC_REALM}/$1"; }
kc_post()   { curl -sf -X POST   -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
               -d "$2" "${KC_BASE_URL}/admin/realms/${KC_REALM}/$1"; }
kc_put()    { curl -sf -X PUT    -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
               -d "$2" "${KC_BASE_URL}/admin/realms/${KC_REALM}/$1"; }
kc_delete() { curl -sf -X DELETE -H "Authorization: Bearer ${TOKEN}" "${KC_BASE_URL}/admin/realms/${KC_REALM}/$1"; }

# ── Resolve the client's internal UUID ───────────────────────────────────────

log "Resolving client UUID for clientId=${CLIENT_ID_NAME}..."
CLIENT_UUID=$(kc_get "clients?clientId=${CLIENT_ID_NAME}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id']) if d else sys.exit(1)")
log "  Client UUID=${CLIENT_UUID}"

# ── Helper: delete mapper by name if exists (idempotency) ────────────────────

delete_mapper_if_exists() {
  local name="$1"
  local mapper_id
  mapper_id=$(kc_get "clients/${CLIENT_UUID}/protocol-mappers/models" \
    | python3 -c "
import sys, json
mappers = json.load(sys.stdin)
for m in mappers:
    if m.get('name') == '${name}':
        print(m['id'])
        break
" || true)
  if [[ -n "${mapper_id}" ]]; then
    kc_delete "clients/${CLIENT_UUID}/protocol-mappers/models/${mapper_id}"
    log "  Deleted existing mapper '${name}' (id=${mapper_id})."
  fi
}

# ── Step 0b: Declare jag_tenant_id in the User Profile schema ────────────────
# Keycloak 26 silently drops unknown attributes unless they are declared here.
# We merge jag_tenant_id into the existing profile, preserving all built-in attrs.

log "User Profile: declaring jag_tenant_id attribute..."
CURRENT_PROFILE=$(kc_get "users/profile")
UPDATED_PROFILE=$(echo "${CURRENT_PROFILE}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
attrs = d.get('attributes', [])
if not any(a.get('name') == 'jag_tenant_id' for a in attrs):
    attrs.append({
        'name': 'jag_tenant_id',
        'displayName': 'JAG Default Tenant ID',
        'validations': {},
        'permissions': {'view': ['admin'], 'edit': ['admin']},
        'multivalued': False,
        'annotations': {'inputType': 'text'}
    })
d['attributes'] = attrs
print(json.dumps(d))
")
kc_put "users/profile" "${UPDATED_PROFILE}"
log "  User Profile updated — jag_tenant_id declared."

# ── Mapper 1: jag_user_id ─────────────────────────────────────────────────────
# Maps the Keycloak user's own UUID (same as the "sub" claim) to a custom claim
# named "jag_user_id". We use the built-in "hardcoded-claim" mapper type with
# userinfo.token.claim=true so the API can always find it in the access token.
#
# Why not just use "sub"? The JAG API middleware currently reads jag_user_id
# by explicit claim name to avoid any accidental coupling to Keycloak's subject
# format (which could theoretically change on realm migration).

log "Mapper 1: jag_user_id"
delete_mapper_if_exists "jag_user_id"

kc_post "clients/${CLIENT_UUID}/protocol-mappers/models" "$(cat <<JSON
{
  "name":           "jag_user_id",
  "protocol":       "openid-connect",
  "protocolMapper": "oidc-usermodel-property-mapper",
  "consentRequired": false,
  "config": {
    "userinfo.token.claim": "true",
    "user.attribute":       "id",
    "id.token.claim":       "true",
    "access.token.claim":   "true",
    "claim.name":           "jag_user_id",
    "jsonType.label":       "String"
  }
}
JSON
)"
log "  Created jag_user_id mapper (maps Keycloak user id → claim jag_user_id)."

# ── Mapper 2: jag_tenant_id ───────────────────────────────────────────────────
# Maps the user attribute "jag_tenant_id" to a JWT claim.
# You set this attribute on each user in Keycloak Admin Console:
#   Users → [user] → Attributes → Key: jag_tenant_id  Value: <tenant UUID>
#
# For Robert (owner), set jag_tenant_id = the JAG_HOLDINGS tenant UUID.
# For staff with a single tenant (e.g. JABCO operator), set to that tenant UUID.
# For Brian (multi-tenant), set to his most-used tenant; the API can accept an
# X-Tenant-ID header to override for a specific request.

log "Mapper 2: jag_tenant_id"
delete_mapper_if_exists "jag_tenant_id"

kc_post "clients/${CLIENT_UUID}/protocol-mappers/models" "$(cat <<JSON
{
  "name":           "jag_tenant_id",
  "protocol":       "openid-connect",
  "protocolMapper": "oidc-usermodel-attribute-mapper",
  "consentRequired": false,
  "config": {
    "userinfo.token.claim": "true",
    "user.attribute":       "jag_tenant_id",
    "id.token.claim":       "true",
    "access.token.claim":   "true",
    "claim.name":           "jag_tenant_id",
    "jsonType.label":       "String"
  }
}
JSON
)"
log "  Created jag_tenant_id mapper (maps user attribute jag_tenant_id → claim jag_tenant_id)."

# ── Done ─────────────────────────────────────────────────────────────────────

log ""
log "╔════════════════════════════════════════════════════════════════════╗"
log "║  F-07 complete — both mappers created on client '${CLIENT_ID_NAME}'  ║"
log "║                                                                    ║"
log "║  Next: set jag_tenant_id user attribute for each user.             ║"
log "║                                                                    ║"
log "║  Keycloak Admin → realm jag → Users → [user] → Attributes:        ║"
log "║    Key:   jag_tenant_id                                            ║"
log "║    Value: <UUID from jag_core.tenants for that user's tenant>      ║"
log "║                                                                    ║"
log "║  Quick-check (after user logs in — paste into jwt.io):             ║"
log "║    jag_user_id   should equal the Keycloak user UUID               ║"
log "║    jag_tenant_id should equal the tenant UUID you set              ║"
log "╚════════════════════════════════════════════════════════════════════╝"
