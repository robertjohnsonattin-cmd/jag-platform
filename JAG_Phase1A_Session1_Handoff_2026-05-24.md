# JAG Holdings — Phase 1A Session 1 Handoff
**Date:** 2026-05-24  
**Prepared for:** Next AI session continuing Phase 1A  
**Status:** Session 1 complete — Session 2 ready to begin

---

## Context Documents to Load

Load all three before starting:
1. `JAG_AI_Context_Summary_v2.1.docx` — platform context, locked decisions, phase plan
2. `JAG_Engineering_Standards_v1.1.docx` — STD-01 through STD-13 (non-negotiable)
3. This handoff document

Memory file `project_jag_holdings.md` is auto-loaded and has the current Phase 1A status table.

---

## What Was Done This Session

### jag-infra/docker-compose.yml (2 fixes)
- Keycloak healthcheck: changed from `/realms/master/.well-known/openid-configuration` → `/health/ready` (Keycloak 26.x API change)
- Removed `depends_on: keycloak: condition: service_healthy` from dispatcher service (dispatcher has its own retry loop; hard dependency caused startup failures)

### jag-event-dispatcher: `failed_at` column (5 migrations)
Added `failed_at TIMESTAMPTZ` column + index to `pending_events` in all 5 databases:

| Migration file | Database | Number |
|---|---|---|
| `migrations/jag_core/20260524000002_pending_events_failed_at.ts` | jag_core | 000002 |
| `migrations/jag_commercial/20260524000002_pending_events_failed_at.ts` | jag_commercial | 000002 |
| `migrations/jag_entertainment/20260524000002_pending_events_failed_at.ts` | jag_entertainment | 000002 |
| `migrations/jag_family/20260524000002_pending_events_failed_at.ts` | jag_family | 000002 |
| `migrations/jag_properties/20260524000003_pending_events_failed_at.ts` | jag_properties | 000003 (002 taken by review queue) |

### jag-event-dispatcher: dispatcher.ts update
In the `if (newRetryCount >= config.maxRetries)` block, before `fireTier1Alert`:
- Writes `failed_at = NOW()` to the permanently failed event (idempotent — only sets if NULL)
- Logs structured JSON at severity ERROR with `action: 'EVENT_PERMANENTLY_FAILED'`

### jag-event-dispatcher: prop_pending_review_queue RLS
`migrations/jag_properties/20260524000004_rls_pending_review_queue.ts`  
Applies RLS to the existing `prop_pending_review_queue` table (created in 000002):
```sql
ALTER TABLE prop_pending_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE prop_pending_review_queue FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON prop_pending_review_queue
  USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
```

### jag-event-dispatcher: jag_core full schema migration
`migrations/jag_core/20260524000003_create_jag_core_schema.ts`  
Creates all jag_core business tables with embedded RLS. Tables created in order:
1. Enums: `notification_channel` (IN_APP, WHATSAPP, EMAIL), `audit_source` (API, SYSTEM, MIGRATION, MANUAL)
2. `tenants` — no RLS (no tenant_id column; referenced by others)
3. `users` — no RLS (no tenant_id; keycloak_id uuid UNIQUE)
4. `roles` — no RLS
5. `i18n_translations` — no RLS; unique on (key, locale)
6. `user_tenant_roles` — ENABLE + FORCE + `tenant_isolation` policy on tenant_id
7. `sessions` — no RLS (Keycloak is the authority)
8. `audit_log` — ENABLE + FORCE + three-clause policy:
   ```sql
   USING (
     current_setting('app.bypass_rls', true) = 'true'   -- Owner role bypass
     OR tenant_id IS NULL                                  -- system events
     OR tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
   )
   ```
9. `notification_queue` — ENABLE + FORCE + `user_isolation` policy on user_id
10. `external_advisor_grants` — ENABLE + FORCE + `tenant_isolation` policy on tenant_id

### jag-api project skeleton
New project at `jag-api/`:
- `package.json` — express, pg, zod, dotenv; ts-node-dev for dev
- `tsconfig.json` — strict: true, ES2022, rootDir: src, outDir: dist
- `.env.example` — 5 DATABASE_URL vars + Keycloak + PORT/NODE_ENV
- `.gitignore` — node_modules/, dist/, .env, *.js.map
- `src/db/index.ts` — 5 named pg.Pool exports (corePool, commercialPool, entertainmentPool, familyPool, propertiesPool) + closePools()
- `src/middleware/rls.ts` — `withTenantRLS()` and `withOwnerRLS()` helper functions

**RLS helper pattern:**
```typescript
// withTenantRLS: for jag_core, jag_commercial, jag_entertainment
// withOwnerRLS: for jag_family, jag_properties
// Both: BEGIN → SET LOCAL session vars → fn(client) → COMMIT (or ROLLBACK on throw)
```

---

## Migration Numbering Convention (CRITICAL)

Each database's migrations live in `jag-event-dispatcher/migrations/<db>/`. Current state:

| Database | 000001 | 000002 | 000003 | 000004 | Next |
|---|---|---|---|---|---|
| jag_core | pending_events | failed_at | **jag_core schema** | — | 000004 |
| jag_commercial | pending_events | failed_at | — | — | 000003 |
| jag_entertainment | pending_events | failed_at | — | — | 000003 |
| jag_family | pending_events | failed_at | — | — | 000003 |
| jag_properties | pending_events | review_queue | failed_at | RLS on review_queue | 000005 |

---

## What Remains: Phase 1A Session 2

### Priority 1 — Remaining schema migrations (4 databases)
These are the main deliverable for Session 2. Each migration must: create all tables from the DBML, embed RLS immediately (ENABLE + FORCE + POLICY in the same migration as CREATE TABLE), and follow the migration numbering above.

**jag_commercial** — migration `000003`:
- Tables (from DBML): check DBML for exact table names; covers IMS inventory, JABCO project management, CRM
- RLS: `tenant_isolation` on tenant_id for all tables that have it
- Entity tag: NOT needed in jag_commercial (entity_tag is an Entertainment concept only)

**jag_entertainment** — migration `000003`:
- Tables: bar sessions, members club, transactions
- CRITICAL: `entity_tag: BAR | MEMBERS_CLUB` column is MANDATORY on every transaction row — this is the sole P&L separation mechanism between the two entities
- RLS: `tenant_isolation` on tenant_id

**jag_family** — migration `000003`:
- Tables: fam_ prefix; personal records, vehicles, lifestyle, docvault
- RLS: `owner_isolation` on owner_id (not tenant_id — family DB uses owner_id)
- Uses `withOwnerRLS()` middleware

**jag_properties** — migration `000005`:
- Tables: prop_ prefix (business tables not yet created — review_queue is the only existing table)
- RLS: `owner_isolation` on owner_id
- OPSEC: `account_reference` column stores PARTIAL reference only (e.g. last 4 digits); full account numbers are NEVER stored

### Priority 2 — Express auth + RLS middleware
The current `withTenantRLS`/`withOwnerRLS` helpers are correct but must be called manually by each route handler. A proper middleware is needed that:
1. Extracts and verifies Keycloak bearer JWT on every request
2. Looks up `users.id` from `jag_core.users` WHERE `keycloak_id = jwt.sub`
3. Determines `tenant_id` and `isOwner` from the JWT roles
4. Attaches `RLSContext` to `req` (extend Express `Request` type)
5. Route handlers then call `withTenantRLS(client, req.rlsCtx, fn)` — no manual context building

**Phase 1B blocker embedded in this:** Until `jag_user_id` and `jag_tenant_id` custom Keycloak mappers are added, the middleware must do a DB lookup at request start to resolve `users.id` and `tenant_id`. This is acceptable for Phase 1A but must be replaced in Phase 1B.

### Deferred (correct to skip)
- bootstrap.sql DDL role separation (jag_app is table owner — FORCE RLS compensates; best practice but not a security gap given NOSUPERUSER)
- Staging environment
- DragonBridge sub-architecture

### Remaining Phase 1A items (after Session 2)
- i18n seed data (en + zh initial translations)
- Keycloak WebAuthn biometric configuration
- Cross-tenant penetration test suite (STD-03)

---

## Open Question for Robert

**Phase 0 status unknown.** Phase 0 = actual deployment on Oracle AMD VM:
1. Run `bootstrap.sql` against PostgreSQL
2. `docker compose up -d`
3. Import `jag_keycloak_realm_v1.json`
4. Configure WAL streaming to Ampere VM
5. Run all migrations via `npx ts-node scripts/migrate.ts`

All artifacts exist in `jag-infra/`. The one gap from the pre-build checklist: **GitHub Actions deploy script was never produced.**

Phase 1A code cannot be tested until Phase 0 is done. Robert needs to confirm: has Phase 0 been executed, or does it need to be done/documented first?

---

## Key RLS Rules (Never Violate)

1. **Fail-closed pattern:** `nullif(current_setting('app.setting_name', true), '')::uuid` — the `true` arg returns `''` when unset (not an error); `nullif` converts `''` to NULL so the USING clause evaluates to false. Never omit `true` from `current_setting`.
2. **Always FORCE:** `jag_app` is table owner. `ENABLE ROW LEVEL SECURITY` alone does not apply to the owner. `FORCE ROW LEVEL SECURITY` is required on every table.
3. **Embed in the same migration:** Never create a table in migration N and add RLS in migration N+1. Tables must never exist without policies.
4. **Tenant vs owner:** jag_core/jag_commercial/jag_entertainment use `app.current_tenant_id`. jag_family/jag_properties use `app.current_owner_id`. `app.current_user_id` is used only for notification_queue.
5. **audit_log is append-only:** No UPDATE or DELETE ever. The append-only constraint must be enforced at the DB role level (no GRANT UPDATE/DELETE to jag_app on audit_log).

---

## File Locations Quick Reference

```
Projects/JAG Holdings/
├── jag-infra/                          # Docker + PostgreSQL infra (PRE-9)
│   ├── docker-compose.yml              # FIXED this session
│   └── postgresql/bootstrap.sql        # Creates jag_app role + 5 databases
├── jag-event-dispatcher/
│   ├── src/dispatcher.ts               # FIXED this session (failed_at + structured log)
│   ├── scripts/migrate.ts              # Migration runner — handles all 5 DBs
│   └── migrations/
│       ├── jag_core/                   # 000001, 000002, 000003 (schema) DONE
│       ├── jag_commercial/             # 000001, 000002 — needs 000003 (schema)
│       ├── jag_entertainment/          # 000001, 000002 — needs 000003 (schema)
│       ├── jag_family/                 # 000001, 000002 — needs 000003 (schema)
│       └── jag_properties/             # 000001–000004 DONE — needs 000005 (schema)
├── jag-api/                            # NEW this session
│   ├── src/db/index.ts                 # 5 connection pools
│   └── src/middleware/rls.ts           # withTenantRLS + withOwnerRLS
└── [DBML files]                        # Source of truth for all table definitions
    ├── jag_core.dbml
    ├── jag_commercial.dbml
    ├── jag_entertainment.dbml
    ├── jag_family.dbml
    └── jag_properties.dbml
```
