# JAG Platform — Keycloak Setup Guide
**PRE-4 | 2026-05-24 | Author: Robert Johnson-Attin via Claude Code**

---

## What This Document Covers

- Importing `jag_keycloak_realm_v1.json` into a fresh Keycloak instance
- Post-import configuration steps (Robert's user, roles, 2FA, client secret)
- Environment variables the API and event dispatcher need from Keycloak
- What to update once the production domain and frontend URL are confirmed

---

## Realm Summary

| Setting | Value |
|---|---|
| Realm name | `jag` |
| Display name | JAG Platform |
| SSL required | External requests only |
| Registration | Disabled — admin-created users only |
| Locales | en (default), zh-CN, es |
| Access token lifespan | 15 minutes (900 s) |
| SSO session idle | 8 hours (28 800 s) |
| SSO session max | 24 hours (86 400 s) |
| Offline session idle | 30 days (2 592 000 s) — for mobile PWA |

### Password Policy

`length(12) and upperCase(1) and lowerCase(1) and digits(1) and specialChars(1) and notUsername() and passwordHistory(5)`

### 2FA

- TOTP (6-digit, 30 s, HMAC-SHA1) — compatible with Google Authenticator, Microsoft Authenticator, FreeOTP
- WebAuthn (ES256, user verification: preferred, RP ID: `jabco.tt`) — hardware keys and biometrics
- **2FA is not enforced at the realm level.** It is set as a required action on Robert's account specifically (see post-import steps). This keeps flexibility for Operator/Viewer accounts.

---

## Roles

Eight realm roles, matching `jag_core.roles`:

| Keycloak role name | Display mapping | Who |
|---|---|---|
| `owner` | Owner | Robert only. Unrestricted across all tenants. |
| `domain_admin` | Domain Admin | Manages a single business entity. |
| `operator` | Operator | Day-to-day ops within assigned tenant. |
| `viewer` | Viewer | Read-only within assigned tenant. |
| `external_advisor` | External Advisor | Time-limited scoped read. Always expires. |
| `auditor` | Auditor | Read-only audit log + financial records. |
| `emergency_designate` | Emergency Designate | Wife. Full read-only on succession activation. |
| `system` | System | Service accounts only — no human users. |

> **Succession rule:** When the Emergency Designate protocol activates, a parallel `owner` grant is added to the wife's Keycloak account. Robert's `owner` role is never revoked or demoted.

---

## Clients

| Client ID | Type | Flow | Purpose |
|---|---|---|---|
| `jag-api` | Confidential | Service account only | API server validates JWTs; system service account for internal operations |
| `jag-web` | Public | Authorization code + PKCE | Web dashboard SPA |
| `jag-mobile` | Public | Authorization code + PKCE | JABCO foreman PWA; `offline_access` scope for site diary offline sync |

**`jag-api` does not issue tokens to users.** Users authenticate via `jag-web` or `jag-mobile` and pass the resulting bearer JWT to the API. The API validates it using the realm's JWKS endpoint.

---

## Prerequisites

- Docker and Docker Compose installed on the Oracle Cloud AMD micro VM
- Port 8080 (Keycloak internal), 8443 (HTTPS) accessible — or proxied behind Caddy/Nginx

---

## Step 1 — Run Keycloak in Docker

Create `docker-compose.yml` (or add to the PRE-9 Compose file):

```yaml
services:
  keycloak:
    image: quay.io/keycloak/keycloak:26.2
    command: start-dev --import-realm
    environment:
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: <strong-temp-password>   # change immediately after first login
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://postgres:5432/keycloak
      KC_DB_USERNAME: keycloak
      KC_DB_PASSWORD: <db-password>
      KC_HOSTNAME: auth.jabco.tt                        # update when domain is confirmed
      KC_PROXY: edge                                    # behind reverse proxy
    volumes:
      - ./jag_keycloak_realm_v1.json:/opt/keycloak/data/import/jag_realm.json
    ports:
      - "8080:8080"
    depends_on:
      - postgres

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: keycloak
      POSTGRES_USER: keycloak
      POSTGRES_PASSWORD: <db-password>
    volumes:
      - keycloak_postgres_data:/var/lib/postgresql/data

volumes:
  keycloak_postgres_data:
```

The `--import-realm` flag causes Keycloak to auto-import any JSON files in `/opt/keycloak/data/import/` on first startup. The `jag` realm will be created automatically.

**For development (no PostgreSQL):** replace `KC_DB` with `KC_DB: dev-mem` and remove the database env vars and `depends_on`. This uses an in-memory H2 database — data is lost on restart, suitable for testing only.

---

## Step 2 — Verify the Import

1. Open `http://localhost:8080` (or your server's address)
2. Log in to the admin console with the `KEYCLOAK_ADMIN` credentials
3. Switch realm to `jag` (top-left dropdown)
4. Confirm: **Realm Settings → General** shows "JAG Platform"
5. Confirm: **Realm roles** shows all 8 roles (`owner`, `domain_admin`, `operator`, `viewer`, `external_advisor`, `auditor`, `emergency_designate`, `system`)
6. Confirm: **Clients** shows `jag-api`, `jag-web`, `jag-mobile`

---

## Step 3 — Create Robert's User

In the admin console, under the `jag` realm:

1. Go to **Users → Add user**
2. Fill in:
   - Username: `robert.johnson-attin` (or your preferred username)
   - Email: `robertjohnsonattin@gmail.com`
   - First name: Robert
   - Last name: Johnson-Attin
   - Email verified: ON
3. Save
4. Go to **Credentials → Set password** — set a strong temporary password, mark as **Temporary** so it forces a change on first login
5. Go to **Role mappings → Assign role** — filter by realm roles and assign `owner`
6. Go to **Required user actions → Add action** — add `CONFIGURE_TOTP`

After Robert logs in for the first time, Keycloak will prompt him to:
- Change the temporary password
- Configure TOTP (scan QR code with Google Authenticator / Microsoft Authenticator)

To also enrol a WebAuthn hardware key, add `webauthn-register` to required user actions after TOTP is set up.

---

## Step 4 — Create the System Service Account User

The `jag-event-dispatcher` fires Tier 1 alerts via `jag_core.notification_queue` using Robert's `user_id`. This UUID comes from `jag_core.users`, not directly from Keycloak.

**After provisioning Robert's Keycloak account:**

1. Note his Keycloak user UUID (visible in the admin console URL when viewing his user: `…/users/<uuid>`)
2. Insert a row into `jag_core.users`:

```sql
INSERT INTO users (keycloak_id, email, display_name, preferred_language, is_active)
VALUES (
  '<keycloak-uuid-from-step-above>',
  'robertjohnsonattin@gmail.com',
  'Robert Johnson-Attin',
  'en',
  true
);
```

3. Note the returned `id` (the `jag_core.users.id`) — this is the `ALERT_USER_ID` for the event dispatcher.

---

## Step 5 — Get the `jag-api` Client Secret

1. In the admin console, go to **Clients → jag-api → Credentials**
2. Copy the **Client secret**
3. Add to the API server's `.env`:

```
KEYCLOAK_REALM_URL=http://localhost:8080/realms/jag
KEYCLOAK_CLIENT_ID=jag-api
KEYCLOAK_CLIENT_SECRET=<copied-from-admin-console>
```

---

## Step 6 — Configure the SMTP Server (Optional at PRE-4)

Email (Tier 2/3 notifications via EMAIL channel) is not needed for the PRE-4 phase. Configure when ready:

**Realm Settings → Email** — enter your SMTP server details.

---

## Environment Variables Summary

Variables the API and event dispatcher need from Keycloak:

| Variable | Where to get it | Used by |
|---|---|---|
| `KEYCLOAK_REALM_URL` | `http://<host>:8080/realms/jag` | API — JWT validation |
| `KEYCLOAK_JWKS_URI` | `http://<host>:8080/realms/jag/protocol/openid-connect/certs` | API — JWKS for signature verification |
| `KEYCLOAK_CLIENT_ID` | `jag-api` (hardcoded) | API — service account token requests |
| `KEYCLOAK_CLIENT_SECRET` | Admin console → Clients → jag-api → Credentials | API |
| `ALERT_USER_ID` | `jag_core.users.id` for Robert (see Step 4) | jag-event-dispatcher |

---

## Redirect URIs — Update When Frontend URL Is Confirmed

The realm JSON uses placeholder redirect URIs:

| Client | Current URIs | Update to |
|---|---|---|
| `jag-web` | `https://app.jabco.tt/*`, `http://localhost:5173/*` | Actual frontend domain once registered |
| `jag-mobile` | `https://app.jabco.tt/*`, `http://localhost:5173/*` | Same |

Update via admin console: **Clients → [client] → Settings → Valid redirect URIs**.

---

## Custom Protocol Mapper — Tenant Context (Phase 1)

In Phase 1, add a custom hardcoded claim mapper to include the user's active `tenant_id` in the JWT. This avoids a DB lookup on every request for the common single-tenant case:

- Mapper type: **Hardcoded claim** (bootstrap) → replaced by **Script mapper** or a custom SPI once tenancy is provisioned
- Token claim name: `jag_tenant_id`
- Added to: `jag-api`, `jag-web`, `jag-mobile`

Document this in the Phase 1 API integration session.

---

## What to Update Before Production Go-Live

- [ ] Change `KC_HOSTNAME` from `auth.jabco.tt` to the actual Keycloak hostname
- [ ] Replace `start-dev` with `start` and configure `KC_HTTPS_*` for TLS
- [ ] Set a production-strong `KEYCLOAK_ADMIN_PASSWORD` and rotate it
- [ ] Configure SMTP for EMAIL notification channel
- [ ] Pin Docker image to a specific patch version (`26.2.x`) for repeatability
- [ ] Restrict Keycloak admin console access to internal network only (firewall rule)
- [ ] Update redirect URIs once frontend domain is confirmed
- [ ] Remove `http://localhost:*` redirect URIs from production clients

---

## PRE-4 Design Decisions

1. **2FA is not realm-default.** Set as a required action on Robert's user only. Other users can optionally enrol later. Avoids blocking service account logins.
2. **`jag-api` has no user flows.** `standardFlowEnabled: false`. Users authenticate via `jag-web` or `jag-mobile`. The API only validates tokens.
3. **`offline_access` scope on `jag-mobile` only.** Refresh tokens survive process restart — required for the foreman PWA's offline-to-online sync flow.
4. **No custom scopes in the JSON.** Standard Keycloak scopes (`profile`, `email`, `roles`) cover Phase 1. The `jag_tenant_id` custom mapper is deferred to Phase 1 to avoid a circular dependency (tenant data doesn't exist yet).
5. **Locales.** `zh-CN` is included from day one for the wife's interface. `es` framework is ready; full content waits for Phase 6 (DragonBridge).
