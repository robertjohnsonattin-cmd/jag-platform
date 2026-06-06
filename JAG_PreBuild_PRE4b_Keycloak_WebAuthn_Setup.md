# JAG Platform — Keycloak WebAuthn / MFA Setup Guide
**Phase 1A | PRE-4b | Companion to jag_keycloak_realm_v1.json**

---

## What Was Configured

The realm JSON (`jag_keycloak_realm_v1.json`) now contains a complete MFA authentication flow. This guide covers what to verify after realm import, and the manual steps required in the Admin Console.

### What the realm JSON adds (Phase 1A)

| Element | Description |
|---------|-------------|
| `mfa_required` realm role | Marker role assigned to owner and domain_admin users. The MFA flow gates on this role. |
| `jag-browser-mfa` flow | Custom top-level browser flow replacing the Keycloak default. |
| `jag-browser-mfa-forms` sub-flow | Username + Password form, then conditional MFA step. |
| `jag-conditional-mfa` sub-flow | Fires only when user has `mfa_required` role. |
| `jag-mfa-options` sub-flow | WebAuthn biometric (preferred, ALTERNATIVE) or TOTP app (ALTERNATIVE). |
| `jag-mfa-role-condition` authenticator config | Configures `Condition - User Role` to check for `mfa_required`. |
| `"browserFlow": "jag-browser-mfa"` | Binds the custom flow as the realm's active browser login flow. |

### MFA behaviour summary

| Role | Login experience |
|------|-----------------|
| `owner` + `mfa_required` | Password → WebAuthn biometric OR TOTP code (must have at least one enrolled) |
| `domain_admin` + `mfa_required` | Password → WebAuthn biometric OR TOTP code |
| `operator`, `viewer`, `auditor`, `system` | Password only (no second factor required) |

WebAuthn biometric is presented first (fingerprint or Face ID via `webauthn-authenticator`). TOTP app is the fallback. Both are `ALTERNATIVE` — user uses whichever they have enrolled.

---

## Step 1 — Import or verify realm after import

After realm import, verify in Keycloak Admin Console:

1. **Authentication → Flows**: confirm `jag-browser-mfa` exists and is listed as the active browser flow.
2. **Authentication → Required Actions**: confirm `Webauthn Register` and `Webauthn Register Passwordless` are enabled (not default — do not force all users to register).
3. **Realm Settings → Policies → WebAuthn Policy**:
   - RP Entity Name: `JAG Platform`
   - RP ID: `jabco.tt` (change to your JAG Holdings domain before Phase 2)
   - User Verification: `preferred`
4. **Realm Settings → Policies → WebAuthn Passwordless Policy**: Authenticator Attachment = `platform` (device biometric only).

> **Note on realm import**: Keycloak may not always import custom auth flows via realm JSON in older versions. If `jag-browser-mfa` does not appear, follow Step 2 to create it manually in the Admin Console.

---

## Step 2 — Manual flow creation (if realm import did not create the flow)

If the flow is missing after import, create it manually:

### 2a. Create the top-level flow

1. Go to **Authentication → Flows → Create flow**.
2. Alias: `jag-browser-mfa` | Type: `Basic Flow` | Description: as above.
3. Add executions in this order:

| Step | Provider | Requirement | Notes |
|------|----------|-------------|-------|
| 1 | Cookie | ALTERNATIVE | Standard session cookie check |
| 2 | Identity Provider Redirector | ALTERNATIVE | Social/IdP logins |
| 3 | `jag-browser-mfa-forms` (sub-flow) | ALTERNATIVE | See 2b |

### 2b. Create `jag-browser-mfa-forms` sub-flow

Inside the forms sub-flow, add:

| Step | Provider | Requirement |
|------|----------|-------------|
| 1 | Username Password Form | REQUIRED |
| 2 | `jag-conditional-mfa` (sub-flow) | CONDITIONAL |

### 2c. Create `jag-conditional-mfa` sub-flow

Inside the conditional sub-flow, add:

| Step | Provider | Requirement | Config |
|------|----------|-------------|--------|
| 1 | Condition - User Role | REQUIRED | Condition: `mfa_required` realm role, Negate: OFF |
| 2 | `jag-mfa-options` (sub-flow) | REQUIRED | |

### 2d. Create `jag-mfa-options` sub-flow

| Step | Provider | Requirement | Notes |
|------|----------|-------------|-------|
| 1 | WebAuthn Authenticator | ALTERNATIVE | Biometric second factor |
| 2 | OTP Form | ALTERNATIVE | TOTP app fallback |

### 2e. Bind the flow

1. **Authentication → Bindings** (or Realm Settings → Authentication in older UI).
2. Set **Browser Flow** = `jag-browser-mfa`.
3. Save.

---

## Step 3 — Create the Owner user account

1. **Users → Add user**.
2. Username: `robert` | Email: `robertjohnsonattin@gmail.com` | Enabled: ON.
3. **Credentials tab**: Set a strong initial password. Require password update on next login = ON.
4. **Role Mappings**: Assign realm roles: `owner` AND `mfa_required`.

> Do NOT assign `mfa_required` to operator or viewer users. The role is a manual gate — it is only given to users who must complete 2FA.

---

## Step 4 — Enrol TOTP (required before WebAuthn)

TOTP must be enrolled before WebAuthn (WebAuthn registration UI requires an authenticated session, which requires a working second factor to already exist).

1. Log in to the JAG web app as `robert` (or use the Keycloak Account Console at `/auth/realms/jag/account`).
2. On first login, the `Configure OTP` required action fires automatically (if enabled as default action for the user, or triggered manually via Admin Console → Users → Required Actions → Add CONFIGURE_TOTP).
3. Scan the QR code with an authenticator app (Microsoft Authenticator recommended — supports push + TOTP).
4. Complete OTP setup. Session is now active.

---

## Step 5 — Enrol WebAuthn biometric (Owner device)

After TOTP is enrolled and you have an active session:

1. Go to **Account Console** → `jabco.tt/auth/realms/jag/account` → **Security → Signing in**.
2. Under **Two-factor authentication**, click **Set up** next to **Security Key (WebAuthn)**.
3. Your browser/OS prompts for biometric (fingerprint, Face ID, Windows Hello) or hardware key (YubiKey).
4. Complete registration. Label the device (e.g. "MacBook Pro Touch ID", "YubiKey 5C NFC").
5. Repeat for each device you want registered (e.g. main workstation + mobile phone).

From this point, login flow for `robert`:
- Enter password → browser prompts for biometric → access granted.
- If biometric device not present → fallback to TOTP app code.

---

## Step 6 — Enrol Domain Admin users (when created)

For each Domain Admin user:
1. Create user in Admin Console.
2. Assign roles: `domain_admin` AND `mfa_required`.
3. Send one-time password reset link (Admin Console → Users → Credentials → Send Reset Email).
4. User completes: password set → TOTP enrolment → (optional) WebAuthn device registration.

---

## Step 7 — Verify MFA enforcement

Test that MFA is correctly gating privileged accounts:

```bash
# Should succeed: owner with correct password + MFA
# Test via browser — enter correct credentials, confirm MFA prompt appears

# Should fail: operator without mfa_required role should NOT see MFA prompt
# Create a test operator user WITHOUT mfa_required, confirm login is password-only

# Should fail: attempting to skip MFA as owner (close MFA prompt without completing)
# Confirm session is denied
```

These are manual browser tests. Automated pen-test coverage is in the cross-tenant test suite (next Phase 1A item).

---

## WebAuthn RP ID — Domain migration note

Current RP ID: `jabco.tt`

WebAuthn credentials are **bound to the RP ID domain**. Credentials registered on `jabco.tt` will NOT work on `jagholdings.tt` (or any other domain). This means:

- **Before Phase 2**: Register the JAG Holdings domain per the architecture decision.
- **Update `webAuthnPolicyRpId` and `webAuthnPolicyPasswordlessRpId`** in the realm JSON to the new domain.
- **All owner and domain_admin users must re-enrol WebAuthn** after the domain change.
- TOTP credentials are NOT affected (TOTP is domain-independent).

Plan for domain migration: update realm JSON, import, notify all MFA users to re-register.

---

## Summary checklist

- [ ] Realm imported with `jag-browser-mfa` flow present
- [ ] Browser flow binding set to `jag-browser-mfa`
- [ ] `webauthn-register` and `webauthn-register-passwordless` required actions enabled
- [ ] `mfa_required` role exists in realm
- [ ] Owner user created with `owner` + `mfa_required` roles
- [ ] Owner TOTP enrolled (Microsoft Authenticator or Google Authenticator)
- [ ] Owner WebAuthn biometric enrolled on primary workstation
- [ ] Owner WebAuthn biometric enrolled on mobile device (optional but recommended)
- [ ] Operator test user created WITHOUT `mfa_required` — confirmed password-only login
- [ ] Owner login test: password → WebAuthn prompt → access granted
- [ ] Owner login fallback test: password → WebAuthn unavailable → TOTP prompt → access granted
- [ ] RP ID noted for domain migration at Phase 2 start

---

*JAG Holdings Platform | Phase 1A | PRE-4b | Keycloak WebAuthn/MFA Setup*
*Confidential — Internal use only*
