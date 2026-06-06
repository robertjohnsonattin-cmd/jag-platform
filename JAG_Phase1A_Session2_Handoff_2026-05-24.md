# JAG Holdings — Phase 1A Session 2 Handoff
**Date:** 2026-05-24  
**Session:** 2 of Phase 1A  
**Prepared for:** Session 3 AI assistant

---

## What Was Completed This Session

### Priority 1 — Business Schema Migrations ✅ DONE

All four remaining business schema migrations written. Files exist at:

| Migration | Path | Tables |
|-----------|------|--------|
| `jag_commercial 000003` | `migrations/jag_commercial/20260524000003_create_jag_commercial_schema.ts` | 21 tables: IMS (9), JABCO (8), CRM (4) |
| `jag_entertainment 000003` | `migrations/jag_entertainment/20260524000003_create_jag_entertainment_schema.ts` | 7 tables |
| `jag_family 000003` | `migrations/jag_family/20260524000003_create_jag_family_schema.ts` | 8 tables |
| `jag_properties 000005` | `migrations/jag_properties/20260524000005_create_jag_properties_schema.ts` | 7 tables |

All follow `jag_core` migration style: column object syntax, `pgm.addConstraint()` for FKs, `pgm.sql()` for RLS blocks. STD-02 (RLS same migration as CREATE TABLE) satisfied on every qualifying table.

### Priority 2 — Express Auth + RLS Middleware ✅ DONE

**New file:** `jag-api/src/middleware/auth.ts`

Implements `requireAuth()` Express middleware:
1. Extracts Bearer token from `Authorization` header
2. Verifies JWT against Keycloak JWKS endpoint (`KEYCLOAK_URL/realms/KEYCLOAK_REALM/protocol/openid-connect/certs`)
3. Resolves `keycloak_id` (JWT `sub`) → `users.id` + `tenant_id` + `role_name` via single DB query on `jag_core` (joins `users` + `user_tenant_roles` + `roles`)
4. Sets `isOwner = (roleName === 'Owner')`
5. Attaches `RLSContext` to `req.rlsCtx`

`X-Tenant-ID` request header: optional. Clients with multi-tenant users send this to specify which tenant context. Without it, the Owner role is preferred (covers Robert's normal usage).

**`jose` added to `package.json`:** `"jose": "^5.10.0"` — dual-package (ESM+CJS), handles JWKS caching internally.

**Phase 1B note embedded in file:** Once custom Keycloak mappers add `jag_user_id` and `jag_tenant_id` to JWT claims, the `resolveUserFromKeycloakId()` DB lookup is removed and claims are read directly from the JWT.

**Existing file unchanged:** `jag-api/src/middleware/rls.ts` — `withTenantRLS()` and `withOwnerRLS()` already implemented.

---

## Current File State

```
jag-api/
  package.json                        ← jose ^5.10.0 added
  src/
    db/index.ts                       ← 5 pool exports (unchanged)
    middleware/
      rls.ts                          ← withTenantRLS, withOwnerRLS (unchanged)
      auth.ts                         ← NEW — requireAuth() middleware

jag-event-dispatcher/
  migrations/
    jag_core/
      20260524000001_create_pending_events.ts
      20260524000002_pending_events_failed_at.ts
      20260524000003_create_jag_core_schema.ts
    jag_commercial/
      20260524000001_create_pending_events.ts
      20260524000002_pending_events_failed_at.ts
      20260524000003_create_jag_commercial_schema.ts  ← NEW Session 2
    jag_entertainment/
      20260524000001_create_pending_events.ts
      20260524000002_pending_events_failed_at.ts
      20260524000003_create_jag_entertainment_schema.ts  ← NEW Session 2
    jag_family/
      20260524000001_create_pending_events.ts
      20260524000002_pending_events_failed_at.ts
      20260524000003_create_jag_family_schema.ts  ← NEW Session 2
    jag_properties/
      20260524000001_create_pending_events.ts
      20260524000002_create_pending_review_queue.ts
      20260524000003_pending_events_failed_at.ts
      20260524000004_rls_pending_review_queue.ts
      20260524000005_create_jag_properties_schema.ts  ← NEW Session 2
```

---

## Critical Design Decisions (Non-Negotiable)

### RLS
- Every table has ENABLE + FORCE + POLICY in the same migration (`pgm.sql()` block) — STD-02
- Tenant-scoped DBs (jag_core, jag_commercial, jag_entertainment): `app.current_tenant_id`
- Owner-scoped DBs (jag_family, jag_properties): `app.current_owner_id`
- Fail-closed pattern: `nullif(current_setting('app.current_tenant_id', true), '')::uuid`
- `ims_item_tags` has NO RLS (junction table, no tenant_id column — governed by parent ims_items)

### Migrations
- `jag_properties 000005` must NOT touch `pending_review_status` enum or `prop_pending_review_queue` table (created in 000002)
- Self-referential FKs added after `createTable`: `ims_categories.parent_category_id`, `jabco_project_gantt.predecessor_id`
- Cross-DB references are logical only (UUID stored, no DB-level FK)

### entity_tag Enum (jag_entertainment)
- `BAR | MEMBERS_CLUB` on every `ent_bar_transactions` row — mandatory, NOT NULL
- This is the sole P&L separation mechanism between the two entities

### OPSEC
- `prop_mortgage_register.account_reference` stores PARTIAL reference only (e.g. last 4 digits)
- Full account numbers are NEVER stored in the platform

### Auth Middleware
- `isOwner` derived from DB `roles.name = 'Owner'` — DB is source of truth, not JWT claims alone
- `ownerId` = `userId` for all users (owner-scoped DBs use `users.id` as the owner key)
- Error codes: `MISSING_TOKEN` (401), `INVALID_TOKEN` (401), `USER_NOT_PROVISIONED` (403)

---

## Session 3 — Priority Work

### Priority 1: `npm install` + TypeScript compile check
```bash
cd jag-api && npm install
npx tsc --noEmit
```
Verify `jose` resolves and `auth.ts` compiles clean against the augmented Express `Request` type.

### Priority 2: i18n Seed Data
Create `migrations/jag_core/20260524000004_seed_i18n_translations.ts`

Initial `en` + `zh` translations for:
- Financial alert strings (BIR threshold, WiPay webhook events)
- License renewal alerts (ent_license_renewals)
- Succession document labels (fam_succession_documents)
- Property maintenance status labels
- Navigation/module names (IMS, JABCO, BAR, PROPERTIES, FAMILY)

Rules:
- `is_machine_translated = false` for all financial, legal, compliance, and alert strings
- `is_machine_translated = true` is allowed for generic UI labels
- Key pattern: `module.semantic_id` e.g. `finance.bir_threshold_alert`

### Priority 3: Keycloak WebAuthn Biometric Configuration
- Document Keycloak realm settings for WebAuthn passwordless flow
- Authentication flow: WebAuthn Authenticator → OTP fallback
- Required for Robert's primary login path (iPhone Face ID)

### Priority 4: Cross-Tenant Penetration Test Suite (STD-03)
Create `jag-api/src/__tests__/rls-isolation.test.ts`

Tests to cover:
- Tenant A cannot read Tenant B's rows (all tenant-scoped tables)
- Owner cannot leak data via missing RLS variable
- `ims_item_tags` inaccessible without parent `ims_items` RLS context
- `withOwnerRLS` rejects wrong `owner_id`
- `withTenantRLS` without `BEGIN` fails cleanly (SET LOCAL outside transaction)

### Open Question: Phase 0 Execution Status
Has the Phase 0 deployment been executed? Specifically:
- PostgreSQL instance running with 5 DBs created?
- `jag_app` role created?
- GitHub Actions deploy script ever produced?
- Keycloak instance running?

If Phase 0 is not done, Session 3 should produce the Phase 0 infrastructure script before any migration work continues.

---

## Key Env Vars (jag-api)

| Var | Purpose |
|-----|---------|
| `DATABASE_URL_CORE` | jag_core pool |
| `DATABASE_URL_COMMERCIAL` | jag_commercial pool |
| `DATABASE_URL_ENTERTAINMENT` | jag_entertainment pool |
| `DATABASE_URL_FAMILY` | jag_family pool |
| `DATABASE_URL_PROPERTIES` | jag_properties pool |
| `KEYCLOAK_URL` | e.g. `https://auth.jagholdings.com` |
| `KEYCLOAK_REALM` | e.g. `jag-platform` |
| `KEYCLOAK_CLIENT_ID` | `jag-api` (informational — not used by `jose` JWKS verify) |
| `PORT` | API port (default 3000) |

---

## How to Use the Middleware in Route Handlers

```typescript
// jag-api/src/routes/ims.ts (example)
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { withTenantRLS } from '../middleware/rls';
import { commercialPool } from '../db';

const router = Router();
router.use(requireAuth());

router.get('/items', async (req, res) => {
  const client = await commercialPool.connect();
  try {
    const result = await withTenantRLS(client, req.rlsCtx, (c) =>
      c.query('SELECT * FROM ims_items ORDER BY created_at DESC'),
    );
    res.json(result.rows);
  } finally {
    client.release();
  }
});

// For jag_family / jag_properties — same pattern, different pool + withOwnerRLS
import { withOwnerRLS } from '../middleware/rls';
import { familyPool } from '../db';

router.get('/family-members', async (req, res) => {
  const client = await familyPool.connect();
  try {
    const result = await withOwnerRLS(client, req.rlsCtx, (c) =>
      c.query('SELECT * FROM fam_family_members ORDER BY created_at ASC'),
    );
    res.json(result.rows);
  } finally {
    client.release();
  }
});
```

---

*End of Session 2 Handoff*
