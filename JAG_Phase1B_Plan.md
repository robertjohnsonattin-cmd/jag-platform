# JAG Holdings Platform — Phase 1B Plan
**Status: Pre-start | Depends on Phase 1A complete (✅)**
*Confidential — Internal use only*

---

## Phase 1B Overview

Phase 1B builds the first real API endpoints on top of the Phase 1A foundation. At the end of Phase 1B, authenticated users can perform core JABCO, IMS, and Properties operations through the API. Entertainment and Family endpoints follow in Phase 1C.

**Scope:** ~30 endpoints (from the 140-endpoint OpenAPI contract). Build in dependency order — auth → core user/tenant → IMS → JABCO → Properties.

**Hard dependencies that must land first:**
- Custom Keycloak mappers (see Section 1 below)
- `jag_core 000005` role seed migration applied ✅

---

## Section 1 — Blockers: Custom Keycloak Mappers

The current auth middleware (`src/middleware/auth.ts`) resolves Keycloak `sub` → internal `user_id` and `tenant_id` via a DB lookup on every request. This works but adds ~5ms latency and a DB round-trip to every authenticated call.

Two custom mappers must be added to the Keycloak `jag-api` client before Phase 1B routes go live:

### 1a. `jag_user_id` mapper
- **Type:** User Attribute → Token Claim
- **User attribute key:** `jag_user_id`
- **Claim name in JWT:** `jag_user_id`
- **Claim type:** String (UUID)
- **Added to:** Access Token, ID Token
- **Set when:** User is provisioned in `jag_core.users`. The UUID from `users.id` is written back to Keycloak as a user attribute.

### 1b. `jag_tenant_id` mapper
- **Type:** User Attribute → Token Claim  
- **User attribute key:** `jag_tenant_id`
- **Claim name in JWT:** `jag_tenant_id`
- **Claim type:** String (UUID)
- **Added to:** Access Token only
- **Note:** Multi-tenant users (Domain Admins who manage several tenants) use the `X-Tenant-ID` request header to override. The claim provides the default/primary tenant.

### Auth middleware update (after mappers are live)

Replace `resolveUserFromKeycloakId()` DB lookup with direct JWT claim extraction:

```typescript
// Phase 1B: after mappers are live, replace resolveUserFromKeycloakId() with:
const userId   = payload['jag_user_id'] as string;
const tenantId = (req.headers['x-tenant-id'] as string) ?? payload['jag_tenant_id'] as string;
```

The existing fallback function can remain for a migration period; remove it entirely at Phase 2.

### Provisioning flow (required for mappers to work)

When a new user logs in for the first time via Keycloak:
1. API `POST /auth/first-login` (or Keycloak event listener) creates `jag_core.users` row
2. Returns the new `users.id`
3. API writes `users.id` back to Keycloak user attribute `jag_user_id` via Keycloak Admin REST API
4. Future tokens carry the claim automatically

Until this flow is built, the current DB-lookup fallback in auth middleware continues to work.

---

## Section 2 — Endpoint Build Order

Build in this order. Each group depends on the one before.

### Group 1 — Bootstrap (build first, no auth required)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health/live` | Liveness probe ✅ **done** |
| GET | `/health/ready` | Readiness probe ✅ **done** |
| POST | `/auth/sync-user` | Upsert `jag_core.users` row on first login; write `jag_user_id` back to Keycloak |

### Group 2 — Core (authenticated; foundation for all data modules)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/me` | Return current user profile + tenant memberships |
| GET | `/tenants` | List tenants the caller has access to |
| GET | `/notifications` | User's notification queue (owner sees all; RLS: user_id) |
| PATCH | `/notifications/:id/read` | Mark notification read |

### Group 3 — IMS (JABCO daily use; OFFLINE-CRITICAL)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/ims/locations` | List all locations for tenant |
| GET | `/ims/categories` | Category tree |
| GET | `/ims/items` | Paginated item list (filter by location, category, tag) |
| GET | `/ims/items/:id` | Item detail |
| POST | `/ims/items` | Create item |
| PATCH | `/ims/items/:id` | Update item (condition, location, quantity) |
| GET | `/ims/movements` | Movement history |
| POST | `/ims/movements` | Record movement — **idempotency_key required** (STD-11) |
| GET | `/ims/vehicles` | Vehicle fleet list |

### Group 4 — JABCO Construction PM
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/jabco/projects` | Project list |
| POST | `/jabco/projects` | Create project — **idempotency_key required** |
| GET | `/jabco/projects/:id` | Project detail + BOQ summary |
| GET | `/jabco/projects/:id/boq` | Full BOQ |
| POST | `/jabco/projects/:id/boq` | Add BOQ line item |
| POST | `/jabco/projects/:id/site-diary` | Submit site diary entry — **idempotency_key + offline sync** |
| GET | `/jabco/projects/:id/site-diary` | List diary entries |
| POST | `/jabco/projects/:id/variation-orders` | Create VO — **idempotency_key required** |
| POST | `/jabco/projects/:id/progress-claims` | Submit progress claim — **idempotency_key required** |

### Group 5 — Properties (includes WiPay webhook)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/properties` | Property portfolio |
| GET | `/properties/:id` | Property detail |
| GET | `/properties/:id/leases` | Active leases |
| GET | `/properties/:id/rent-payments` | Payment history |
| POST | `/properties/:id/rent-payments` | Record manual payment |
| GET | `/properties/review-queue` | WiPay pending review items |
| PATCH | `/properties/review-queue/:id` | Resolve/dismiss review item |
| POST | `/webhooks/wipay` | WiPay payment webhook — **HMAC `X-WiPay-Signature` auth; no Bearer JWT** |

### Group 6 — CRM (lower urgency)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/crm/companies` | Company list |
| POST | `/crm/companies` | Create company |
| GET | `/crm/contacts` | Contact list |
| POST | `/crm/interactions` | Log interaction |

---

## Section 3 — Cross-Cutting Concerns

### 3a. Zod validation (STD-06)
Every request body validated with Zod before the handler runs. Return `422` with field-level errors on validation failure. Pattern:

```typescript
import { z } from 'zod';
const CreateItemSchema = z.object({
  sku:         z.string().min(1).max(50),
  name:        z.string().min(1).max(200),
  category_id: z.string().uuid(),
  location_id: z.string().uuid(),
  unit:        z.string().min(1),
});
```

### 3b. Audit logging
Every mutating endpoint (`POST`, `PATCH`, `DELETE`) writes an `audit_log` row inside the same transaction as the business write. Use `withTenantRLS` for tenant-scoped tables; the audit row inherits the same transaction's RLS context.

```typescript
await client.query(`
  INSERT INTO audit_log (tenant_id, user_id, entity, action, record_id, new_values, source)
  VALUES ($1, $2, $3, $4, $5, $6, 'API')
`, [ctx.tenantId, ctx.userId, 'InventoryItem', 'CREATE', newId, JSON.stringify(body)]);
```

### 3c. Idempotency (STD-11)
All financial and operational writes that carry `idempotency_key`:
- Client generates UUID before sending
- API does `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`
- If `RETURNING` is empty → duplicate → return `200` with original record, not `201`
- Never return `409` for duplicate idempotency keys (WiPay webhook contract removed this per PRE-5)

### 3d. WiPay webhook
- Auth: HMAC-SHA256 of raw request body, verified against `X-WiPay-Signature: sha256=<hex>`
- **No Bearer JWT on this endpoint**
- Non-success payment OR unmatched success → INSERT into `prop_pending_review_queue` → return `202`
- Success + matched → mark rent payment `status = PAID`, write audit row → return `200`
- See `jag_api_contract_v1.yaml` `POST /webhooks/wipay` for full state machine

### 3e. Offline sync (JABCO site diary + IMS movements)
- Client holds entries locally (idempotency_key generated offline)
- On reconnect, POST each entry in order
- API must accept out-of-order delivery; `idempotency_key` prevents duplicates
- Response: `201` on first insert, `200` on duplicate (no error)

---

## Section 4 — Router File Structure

```
jag-api/src/
  routes/
    auth.ts          # POST /auth/sync-user
    me.ts            # GET /me
    tenants.ts       # GET /tenants
    notifications.ts # GET /notifications, PATCH /notifications/:id/read
    ims/
      index.ts       # mounts all IMS sub-routes
      items.ts
      movements.ts
      vehicles.ts
    jabco/
      index.ts
      projects.ts
      site-diary.ts
      boq.ts
      claims.ts
    properties/
      index.ts
      properties.ts
      leases.ts
      rent-payments.ts
      review-queue.ts
    crm/
      index.ts
      companies.ts
      contacts.ts
    webhooks/
      wipay.ts       # HMAC auth — no requireAuth() middleware
```

---

## Section 5 — Testing Approach

- **Integration tests** for every endpoint (not unit tests — RLS is DB-enforced, mocking the pool defeats the purpose)
- Each test file mirrors its route file: `src/__tests__/ims/items.test.ts`
- Use the same superuser-pool pattern from `rls-isolation.test.ts` for fixture setup
- Test matrix per endpoint: happy path, invalid auth (401), wrong tenant (403 or 0 rows), validation failure (422), duplicate idempotency_key (200 not 201)
- WiPay webhook tests: valid HMAC, tampered HMAC (400), non-success payment (202 + review queue row)

---

## Section 6 — Phase 1B Definition of Done

- [ ] `jag_tenant_id` and `jag_user_id` Keycloak mappers configured and tested
- [ ] Provisioning flow: first-login → `users` row → attribute written back to Keycloak
- [ ] All Group 1–5 endpoints built, Zod-validated, audit-logged
- [ ] Idempotency enforced on all financial/operational writes
- [ ] WiPay webhook HMAC verification working; review queue populated on non-success
- [ ] Integration tests written and passing for all endpoints
- [ ] `npm run build` succeeds cleanly (no TypeScript errors)
- [ ] `jag-api` Docker image builds and passes healthcheck (`/health/ready`)
- [ ] `docker compose up` brings all 4 services up healthy: Keycloak, dispatcher, MinIO, jag-api
- [ ] Auth middleware updated to read `jag_user_id`/`jag_tenant_id` from JWT claims (DB lookup removed or gated behind feature flag)

---

## Section 7 — Phase 1B Blockers Summary

| Blocker | Owner | Notes |
|---------|-------|-------|
| `jag_tenant_id` Keycloak mapper | Robert (Admin Console) | Needs Keycloak Admin access |
| `jag_user_id` Keycloak mapper | Robert (Admin Console) | Needs Keycloak Admin access |
| Keycloak Admin REST API credentials in `jag-api` env | Robert | For writing `jag_user_id` attribute on first login |
| `jag_migrator` role created in PostgreSQL | Robert (server) | Required for RLS pen-test suite `DATABASE_URL_*_SUPER` vars |
| `ALERT_USER_ID` in `jag-infra/.env` | Robert (after first login) | Set to `jag_core.users.id` for Robert's account |

---

*JAG Holdings Platform | Phase 1B Pre-Start Plan*
*Confidential — Internal use only*
