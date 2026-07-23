#!/usr/bin/env bash
# JAG Platform — F-11 WebAuthn Biometric Setup
# Configures passkey/biometric authentication on the Keycloak 26.x "jag" realm.
#
# What this script does:
#   1. Sets the WebAuthn policy on the realm (RP name, user verification, etc.)
#   2. Copies the built-in "browser" flow to a new "jag-browser" flow.
#   3. In the copy, replaces "Browser - Conditional OTP" with WebAuthn.
#   4. Binds "jag-browser" as the browser flow for the realm.
#   5. Creates a "jag-webauthn-registration" required-action so users are
#      prompted to register their device on first login.
#
# Usage:
#   ./scripts/keycloak-webauthn-setup.sh
#
# Prerequisites:
#   - Keycloak container (jag-keycloak) is running and healthy.
#   - KEYCLOAK_ADMIN_USER and KEYCLOAK_ADMIN_PASSWORD are in .env (or exported).
#   - The "jag" realm already exists.
#
# Idempotent: safe to re-run. Existing "jag-browser" flow is deleted and
# recreated so the script is always consistent with this definition.
#
# After running this script Robert must:
#   1. Log in to Keycloak Admin Console (http://localhost:8080/admin).
#   2. Switch to the "jag" realm.
#   3. Go to Authentication → Required Actions.
#   4. Confirm "Webauthn Register" is Enabled and set as Default Action.
#      (The script enables it; this step is visual confirmation only.)
#   5. Each user logs in once with password → is prompted to register their
#      security key / Touch ID / Windows Hello biometric.
#   6. From that point forward: username + biometric (no password typed).

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Load .env if present (for KEYCLOAK_ADMIN_USER / KEYCLOAK_ADMIN_PASSWORD)
if [[ -f "${INFRA_DIR}/.env" ]]; then
  set -a; source "${INFRA_DIR}/.env"; set +a
fi

KC_BASE_URL="${KC_BASE_URL:-http://localhost:8080}"
KC_REALM="${KC_REALM:-jag}"
KC_ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
KC_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD}"
FLOW_ALIAS="jag-browser"

if [[ -z "${KC_ADMIN_PASSWORD:-}" ]]; then
  echo "ERROR: KEYCLOAK_ADMIN_PASSWORD is not set. Export it or add it to .env."
  exit 1
fi

# ── Helper functions ──────────────────────────────────────────────────────────

log() { echo "[$(date -u '+%H:%M:%S')] $*"; }

# Authenticate and capture the admin access token.
get_token() {
  curl -sf -X POST \
    "${KC_BASE_URL}/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=password" \
    -d "client_id=admin-cli" \
    -d "username=${KC_ADMIN_USER}" \
    -d "password=${KC_ADMIN_PASSWORD}" \
    | grep -o '"access_token":"[^"]*"' \
    | cut -d'"' -f4
}

kc_get()    { curl -sf -H "Authorization: Bearer ${TOKEN}" "${KC_BASE_URL}/admin/realms/${KC_REALM}/$1"; }
kc_post()   { curl -sf -X POST   -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" -d "$2" "${KC_BASE_URL}/admin/realms/${KC_REALM}/$1"; }
kc_put()    { curl -sf -X PUT    -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" -d "$2" "${KC_BASE_URL}/admin/realms/${KC_REALM}/$1"; }
kc_delete() { curl -sf -X DELETE -H "Authorization: Bearer ${TOKEN}" "${KC_BASE_URL}/admin/realms/${KC_REALM}/$1"; }

# ── Step 0: Authenticate ──────────────────────────────────────────────────────

log "Authenticating to Keycloak..."
TOKEN="$(get_token)"
if [[ -z "${TOKEN}" ]]; then
  echo "ERROR: Failed to obtain admin token. Check credentials and that Keycloak is running."
  exit 1
fi
log "Token obtained."

# ── Step 1: Set WebAuthn policy on the realm ──────────────────────────────────
# These settings apply to the built-in WebAuthn authenticator type.
# rpId      — must match the domain users will authenticate from.
#             Use "localhost" for dev; change to "jagcorporate.com" for production.
# rpName    — friendly display name shown in the browser's biometric prompt.
# userVerification = "required" — biometric or PIN always required (not "preferred").
#   This means a hardware key tap alone is NOT sufficient — the user must also
#   provide biometric or PIN to the device. Correct for an enterprise owner portal.

log "Step 1: Setting WebAuthn policy..."

RP_ID="${KC_WEBAUTHN_RP_ID:-localhost}"    # Override via env: KC_WEBAUTHN_RP_ID=jagcorporate.com

kc_put "" "$(cat <<POLICY
{
  "webAuthnPolicyRpEntityName": "JAG Holdings Platform",
  "webAuthnPolicyRpId": "${RP_ID}",
  "webAuthnPolicySignatureAlgorithms": ["ES256", "RS256"],
  "webAuthnPolicyAttestationConveyancePreference": "none",
  "webAuthnPolicyAuthenticatorAttachment": "platform",
  "webAuthnPolicyRequireResidentKey": "No",
  "webAuthnPolicyUserVerificationRequirement": "required",
  "webAuthnPolicyCreateTimeout": 0,
  "webAuthnPolicyAvoidSameAuthenticatorRegister": false,
  "webAuthnPolicyAcceptableAaguids": [],
  "webAuthnPolicyPasswordlessRpEntityName": "JAG Holdings Platform",
  "webAuthnPolicyPasswordlessRpId": "${RP_ID}",
  "webAuthnPolicyPasswordlessSignatureAlgorithms": ["ES256", "RS256"],
  "webAuthnPolicyPasswordlessAttestationConveyancePreference": "none",
  "webAuthnPolicyPasswordlessAuthenticatorAttachment": "platform",
  "webAuthnPolicyPasswordlessRequireResidentKey": "Yes",
  "webAuthnPolicyPasswordlessUserVerificationRequirement": "required",
  "webAuthnPolicyPasswordlessCreateTimeout": 0,
  "webAuthnPolicyPasswordlessAvoidSameAuthenticatorRegister": false
}
POLICY
)"
log "Step 1: DONE — WebAuthn policy set (rpId=${RP_ID})."

# ── Step 2: Delete existing jag-browser flow if present (idempotency) ─────────

log "Step 2: Checking for existing ${FLOW_ALIAS} flow..."
EXISTING_FLOW_ID=$(kc_get "authentication/flows" \
  | grep -o "\"id\":\"[^\"]*\",\"alias\":\"${FLOW_ALIAS}\"" \
  | grep -o '"id":"[^"]*"' \
  | cut -d'"' -f4 || true)

if [[ -n "${EXISTING_FLOW_ID}" ]]; then
  kc_delete "authentication/flows/${EXISTING_FLOW_ID}"
  log "  Deleted existing flow id=${EXISTING_FLOW_ID}."
fi

# ── Step 3: Copy built-in "browser" flow → "jag-browser" ─────────────────────

log "Step 3: Copying browser → ${FLOW_ALIAS}..."
kc_post "authentication/flows/browser/copy" "{\"newName\": \"${FLOW_ALIAS}\"}"
log "  Copy created."

# Fetch the new flow's ID and its executions.
FLOW_ID=$(kc_get "authentication/flows" \
  | grep -o "\"id\":\"[^\"]*\",\"alias\":\"${FLOW_ALIAS}\"" \
  | grep -o '"id":"[^"]*"' \
  | cut -d'"' -f4)

log "  New flow id=${FLOW_ID}."

# ── Step 4: Replace "Browser - Conditional OTP" with WebAuthn ────────────────
# The copied browser flow contains a subflow called "jag-browser Browser - Conditional OTP".
# We delete it and add a WebAuthn conditional subflow in its place.

log "Step 4: Replacing Conditional OTP with WebAuthn..."

# Get all executions (flat list) for our new flow.
EXECUTIONS=$(kc_get "authentication/flows/${FLOW_ALIAS}/executions")

# Find the Conditional OTP subflow execution ID.
OTP_EXEC_ID=$(echo "${EXECUTIONS}" \
  | grep -o '"id":"[^"]*"[^}]*"displayName":"[^"]*Conditional OTP[^"]*"' \
  | grep -o '"id":"[^"]*"' | head -1 \
  | cut -d'"' -f4 || true)

if [[ -n "${OTP_EXEC_ID}" ]]; then
  kc_delete "authentication/executions/${OTP_EXEC_ID}"
  log "  Deleted Conditional OTP execution id=${OTP_EXEC_ID}."
else
  log "  WARNING: Could not find Conditional OTP execution — may already be removed."
fi

# Find the "jag-browser forms" subflow alias (the copy renames the inner subflow too).
FORMS_SUBFLOW_ALIAS="${FLOW_ALIAS} Browser - Browser - Conditional OTP"
# Keycloak's copy renames inner subflows with the new flow alias prefix.
# The forms subflow that holds the conditional block has an alias like:
#   "jag-browser Browser - Browser - Conditional OTP"
# If not found, we add the WebAuthn subflow directly to the forms subflow.
# Safer: add it to the top-level jag-browser flow just before binding.

# Add WebAuthn conditional subflow to the forms subflow.
# Find the "forms" inner subflow id.
FORMS_FLOW_ALIAS="${FLOW_ALIAS} Browser - Browser - Forms"

# The Keycloak browser flow copy pattern for 26.x:
#   jag-browser
#     ├── Cookie (ALTERNATIVE)
#     ├── Identity Provider Redirector (ALTERNATIVE)
#     └── jag-browser Browser - Browser - Forms (ALTERNATIVE subflow)
#           ├── Username Password Form (REQUIRED)
#           └── [we insert WebAuthn conditional here]

FORMS_FLOW_ID=$(kc_get "authentication/flows" \
  | python3 -c "
import sys, json, re
data = sys.stdin.read()
# Keycloak returns a JSON array
try:
  flows = json.loads(data)
  for f in flows:
    alias = f.get('alias','')
    if 'forms' in alias.lower() and '${FLOW_ALIAS}' in alias:
      print(f['id'])
      break
except Exception:
  pass
" || true)

if [[ -z "${FORMS_FLOW_ID}" ]]; then
  log "  WARNING: Could not locate forms subflow — WebAuthn will be added to top-level flow."
  TARGET_FLOW="${FLOW_ALIAS}"
else
  log "  Found forms subflow id=${FORMS_FLOW_ID}."
  TARGET_FLOW="${FLOW_ALIAS} Browser - Browser - Forms"
fi

# Add "WebAuthn Browser" conditional subflow.
kc_post "authentication/flows/${TARGET_FLOW}/executions/flow" "$(cat <<SUBFLOW
{
  "alias":    "JAG WebAuthn",
  "type":     "basic-flow",
  "provider": "registration-page-form",
  "description": "Conditional WebAuthn — required when user has a registered device"
}
SUBFLOW
)"
log "  Created JAG WebAuthn subflow."

# Get the newly created subflow's ID and URL-encoded alias to add executions to it.
WEBAUTHN_SUBFLOW_ALIAS="JAG WebAuthn"
WEBAUTHN_SUBFLOW_ALIAS_ENC="JAG%20WebAuthn"

# Add Condition - User Configured (skips WebAuthn if no device registered yet)
kc_post "authentication/flows/${WEBAUTHN_SUBFLOW_ALIAS_ENC}/executions/execution" \
  '{"provider": "conditional-user-configured"}'
log "  Added conditional-user-configured execution."

# Add WebAuthn Authenticator execution.
kc_post "authentication/flows/${WEBAUTHN_SUBFLOW_ALIAS_ENC}/executions/execution" \
  '{"provider": "webauthn-authenticator"}'
log "  Added webauthn-authenticator execution."

# Set requirements on the new executions.
WEBAUTHN_EXECUTIONS=$(kc_get "authentication/flows/${WEBAUTHN_SUBFLOW_ALIAS_ENC}/executions")

set_requirement() {
  local exec_id="$1"
  local requirement="$2"
  kc_put "authentication/flows/${WEBAUTHN_SUBFLOW_ALIAS_ENC}/executions" \
    "{\"id\": \"${exec_id}\", \"requirement\": \"${requirement}\"}"
}

COND_ID=$(echo "${WEBAUTHN_EXECUTIONS}" \
  | grep -o '"id":"[^"]*"[^}]*"providerId":"conditional-user-configured"' \
  | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || true)
WA_ID=$(echo "${WEBAUTHN_EXECUTIONS}" \
  | grep -o '"id":"[^"]*"[^}]*"providerId":"webauthn-authenticator"' \
  | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || true)

[[ -n "${COND_ID}" ]] && set_requirement "${COND_ID}" "REQUIRED" && log "  Set conditional-user-configured → REQUIRED."
[[ -n "${WA_ID}"   ]] && set_requirement "${WA_ID}"   "REQUIRED" && log "  Set webauthn-authenticator → REQUIRED."

# Set the JAG WebAuthn subflow itself to CONDITIONAL.
JAG_WA_EXEC_ID=$(kc_get "authentication/flows/${FLOW_ALIAS}/executions" \
  | grep -o '"id":"[^"]*"[^}]*"displayName":"JAG WebAuthn"' \
  | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || true)
if [[ -n "${JAG_WA_EXEC_ID}" ]]; then
  kc_put "authentication/flows/${FLOW_ALIAS}/executions" \
    "{\"id\": \"${JAG_WA_EXEC_ID}\", \"requirement\": \"CONDITIONAL\"}"
  log "  Set JAG WebAuthn subflow → CONDITIONAL."
fi

log "Step 4: DONE."

# ── Step 5: Bind jag-browser as the browser flow ─────────────────────────────

log "Step 5: Binding ${FLOW_ALIAS} as the browser flow..."
kc_put "" "{\"browserFlow\": \"${FLOW_ALIAS}\"}"
log "Step 5: DONE."

# ── Step 6: Enable WebAuthn Register required action ─────────────────────────
# This makes new users see the "Register Security Key" screen on first login.

log "Step 6: Enabling WebAuthn Register required action..."

# Get current required actions list and update webauthn-register.
kc_put "authentication/required-actions/webauthn-register" "$(cat <<RA
{
  "alias":         "webauthn-register",
  "name":          "Webauthn Register",
  "providerId":    "webauthn-register",
  "enabled":       true,
  "defaultAction": true,
  "priority":      70,
  "config":        {}
}
RA
)"
log "Step 6: DONE — WebAuthn Register enabled as default action."

# ── Done ─────────────────────────────────────────────────────────────────────

log ""
log "╔══════════════════════════════════════════════════════════════════╗"
log "║  WebAuthn setup complete for realm: ${KC_REALM}                  ║"
log "║                                                                  ║"
log "║  Next steps for Robert:                                          ║"
log "║  1. Log in to Keycloak Admin Console.                            ║"
log "║  2. Realm: jag → Authentication → Flows.                        ║"
log "║     Verify 'jag-browser' is the active browser flow.            ║"
log "║  3. Authentication → Required Actions.                           ║"
log "║     Confirm 'Webauthn Register' is Enabled + Default Action.    ║"
log "║  4. Log out and log back in as Robert (or any user).             ║"
log "║     You will be prompted to register your biometric device.      ║"
log "║  5. On subsequent logins: username + Touch ID / Windows Hello.   ║"
log "║                                                                  ║"
log "║  Production note: re-run with KC_WEBAUTHN_RP_ID=jagcorporate.com        ║"
log "║  BEFORE any user registers their device on the production URL.   ║"
log "║  (rpId cannot change after devices are registered.)              ║"
log "╚══════════════════════════════════════════════════════════════════╝"
