# Keycloak WebAuthn Passwordless — Setup Runbook
**Platform:** JAG Holdings  
**Realm:** `jag-platform`  
**Target:** Robert's iPhone Face ID as primary login path; TOTP as fallback  
**Keycloak version:** 24+  

---

## Overview

Keycloak 24 ships two distinct WebAuthn policies:

| Policy | Purpose |
|--------|---------|
| **WebAuthn Policy** | Second factor (2FA) — adds biometric on top of password |
| **WebAuthn Passwordless Policy** | First factor — replaces password entirely |

We want **Passwordless** — Robert types his username, iPhone presents Face ID, done. TOTP (Authenticator app) is the sole fallback for when Face ID is unavailable (locked device, new device, etc.).

---

## Step 1 — Configure the WebAuthn Passwordless Policy

**Admin Console → Realm: jag-platform → Authentication → WebAuthn Passwordless Policy**

| Setting | Value | Reason |
|---------|-------|--------|
| Relying Party Entity Name | `JAG Holdings` | Shown on device during registration |
| Relying Party ID | `jagholdings.com` (or `localhost` for dev) | Must match the origin domain exactly — mismatches cause auth failure |
| Signature Algorithms | `ES256` | Supported by iPhone Secure Enclave (Face ID) |
| Attestation Conveyance | `none` | Broadest device support; no server-side attestation verification required |
| Authenticator Attachment | `platform` | Forces on-device biometric (Face ID / Touch ID); rejects security keys |
| Require Resident Key | `Yes` | Required for passwordless (passkey stored on device, not server-side credential) |
| User Verification Requirement | `required` | Enforces biometric check — user must verify, not just presence tap |
| Acceptable AAGUIDs | *(leave empty)* | Allow all authenticator models |

> **Dev vs Prod:** Set Relying Party ID to `localhost` during local development. Change to `jagholdings.com` before first production deployment. This value is baked into registered credentials — changing it invalidates all enrolled devices.

---

## Step 2 — Create the WebAuthn Passwordless Authentication Flow

Keycloak's default Browser flow is password-first. We create a new flow.

**Admin Console → Authentication → Flows → Create flow**

### 2a. Create the top-level flow

- **Name:** `JAG Passwordless Browser`  
- **Description:** `WebAuthn passkey first; TOTP fallback`  
- **Flow Type:** `basic`

### 2b. Add sub-flows and executors

Add the following in order. Use **Add step** and **Add sub-flow** buttons:

```
JAG Passwordless Browser
│
├── [REQUIRED] Cookie                           ← auto-login from active session
│
├── [REQUIRED] JAG Passkey or TOTP              ← sub-flow (Alternative)
│   ├── [ALTERNATIVE] Username Form             ← collect username first
│   ├── [ALTERNATIVE] JAG Passkey Sub-flow      ← nested sub-flow
│   │   └── [REQUIRED] WebAuthn Passwordless Authenticator
│   └── [ALTERNATIVE] JAG TOTP Sub-flow         ← nested sub-flow (fallback)
│       ├── [REQUIRED] Username Password Form
│       └── [REQUIRED] OTP Form
│
└── [REQUIRED] Deny Access                      ← fail-closed if nothing matched
```

**Precise steps in the Admin UI:**

1. Add executor → **Cookie** → set to ALTERNATIVE  
2. Add sub-flow → **Name:** `JAG Passkey or TOTP` → set parent to REQUIRED  
3. Inside `JAG Passkey or TOTP`:
   - Add executor → **Username Form** → REQUIRED  
   - Add sub-flow → **Name:** `JAG Passkey Sub-flow` → ALTERNATIVE  
   - Add sub-flow → **Name:** `JAG TOTP Sub-flow` → ALTERNATIVE  
4. Inside `JAG Passkey Sub-flow`:
   - Add executor → **WebAuthn Passwordless Authenticator** → REQUIRED  
5. Inside `JAG TOTP Sub-flow`:
   - Add executor → **Username Password Form** → REQUIRED  
   - Add executor → **OTP Form** → REQUIRED  

> The `Username Form` at the `JAG Passkey or TOTP` level lets Keycloak identify the user before the passkey assertion — required for conditional UI (passkey auto-fill in Safari).

---

## Step 3 — Bind the Flow to the Realm Browser Binding

**Admin Console → Authentication → Bindings tab**

| Binding | Value |
|---------|-------|
| Browser Flow | `JAG Passwordless Browser` |

Leave all other bindings at default.

---

## Step 4 — Required Action: WebAuthn Passwordless Register

**Admin Console → Authentication → Required Actions**

| Action | Enabled | Default Action |
|--------|---------|---------------|
| Webauthn Register Passwordless | ✅ ON | ✅ ON |

Setting **Default Action = ON** means every new user is prompted to register a passkey on their first login. Robert will be prompted to add Face ID on his first post-deployment sign-in.

---

## Step 5 — Client Configuration for jag-api

**Admin Console → Clients → jag-api → Settings**

| Setting | Value |
|---------|-------|
| Client Authentication | On |
| Standard Flow | On |
| Direct Access Grants | Off (OPSEC — no username/password grant) |
| Valid Redirect URIs | `https://jagholdings.com/*` (prod) / `http://localhost:3000/*` (dev) |
| Web Origins | `https://jagholdings.com` (prod) / `http://localhost:3000` (dev) |

**Admin Console → Clients → jag-api → Credentials**

- Generate and save the **Client Secret** → add to `KEYCLOAK_CLIENT_SECRET` env var (jag-api does not currently use it for JWT verify, but needed for token introspection if added in Phase 1B)

---

## Step 6 — User Provisioning (Phase 1A Manual)

Until a self-registration or HR sync flow is built, users are created manually.

**Admin Console → Users → Add User**

1. Create user with Robert's email — set **Username** = email address  
2. Save → **Credentials tab** → set temporary password (used only to bootstrap — Face ID replaces it after first login)  
3. **Required User Actions** → ensure `Webauthn Register Passwordless` is listed  

On first login Robert will:
- Enter username  
- Enter temporary password (the TOTP sub-flow fires here since no passkey is registered yet)  
- Be prompted to register Face ID  
- All subsequent logins: username → Face ID only

> After Face ID is registered, disable the TOTP sub-flow for Robert's user if he explicitly requests it, or leave it as his recovery path.

---

## Step 7 — Validate the Flow

```bash
# 1. Open the Keycloak account console in Safari on iPhone
open "http://localhost:8080/realms/jag-platform/account"

# 2. Sign in with temporary credentials → complete WebAuthn registration
# 3. Sign out → sign in again → should prompt Face ID directly
# 4. Confirm JWT is issued and verify the jag-api accepts it:

curl -s -X POST \
  "http://localhost:8080/realms/jag-platform/protocol/openid-connect/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=jag-api" \
  -d "client_secret=<CLIENT_SECRET>" \
  -d "code=<AUTH_CODE>" \
  -d "redirect_uri=http://localhost:3000/callback" \
  | jq '{access_token: .access_token[0:50], expires_in: .expires_in}'

# 5. Test jag-api auth middleware with the token:
curl -s -H "Authorization: Bearer <ACCESS_TOKEN>" \
  http://localhost:3000/health | jq .
```

---

## Phase 1B — Custom Keycloak Mappers

Once the above is working, add two **Protocol Mappers** to the `jag-api` client:

| Mapper | Claim name | Source |
|--------|-----------|--------|
| JAG User ID | `jag_user_id` | User attribute (set at provision time to `jag_core.users.id`) |
| JAG Tenant ID | `jag_tenant_id` | User attribute (set at provision time to active `tenant_id`) |

After these mappers are live, update `jag-api/src/middleware/auth.ts`:
- Read `payload.jag_user_id` and `payload.jag_tenant_id` directly from the JWT
- Remove the `resolveUserFromKeycloakId()` DB lookup entirely
- Mark the Phase 1B comment as resolved

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `InvalidStateError` on passkey assertion | Relying Party ID mismatch | Ensure KEYCLOAK_URL domain matches RP ID exactly |
| Face ID not triggered (password shown instead) | Wrong flow bound | Re-check Bindings → Browser Flow |
| `USER_NOT_PROVISIONED` (403) from jag-api | User in Keycloak but not in `jag_core.users` | Run the manual user provisioning SQL (see Phase 0 runbook) |
| JWT `iss` mismatch in jag-api logs | KEYCLOAK_URL env var trailing slash | Remove trailing slash: `http://localhost:8080` not `http://localhost:8080/` |
| Passkey works on iPhone but not MacBook | Authenticator attachment set to `platform` | Expected — MacBook Touch ID uses a different RP binding; enroll separately |
