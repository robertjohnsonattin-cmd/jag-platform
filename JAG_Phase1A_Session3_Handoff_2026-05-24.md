# JAG Holdings — Phase 1A Session 3 Handoff
**Date:** 2026-05-24  
**Session:** 3 of Phase 1A  
**Prepared for:** Session 4 AI assistant

---

## What Was Completed This Session

### ✅ Compile verification — both services
- `jag-api`: `npm install && tsc --noEmit` — zero errors, `jose` resolved correctly
- `jag-event-dispatcher`: `npm install && tsc --noEmit` — zero errors across all migrations including new i18n seed

### ✅ i18n seed migration
**File:** `migrations/jag_core/20260524000004_seed_i18n_translations.ts`

9 categories, 130+ translation rows (en + zh):
- Module navigation labels (dashboard, IMS, JABCO, BAR, Members Club, Properties, Family, CRM)
- Common status labels (active, inactive, pending, in_progress, completed, cancelled, draft, expired, revoked)
- Financial alerts: BIR threshold (TTD 1,000,000 / 30% band), personal allowance reminder, WiPay payment received/failed/refunded, mortgage payment due — all `is_machine_translated = false`
- License renewal alerts at 90d / 30d / 7d — `is_machine_translated = false` (compliance)
- Succession document type labels (will, trust, POA, letter of wishes, insurance policy, share certificate) — `is_machine_translated = false` (legal)
- Property maintenance status, priority, and category labels
- Lease status labels
- Members Club chip float session opened/closed/variance alerts — `is_machine_translated = false`
- Bar entity_tag labels (BAR / MEMBERS_CLUB)
- IMS movement type labels
- JABCO project status + variation order status labels

All zh generic UI labels are `is_machine_translated = true` (pending wife's review). All financial/legal/compliance/alert strings are `false` in both locales.

Down migration uses `LIKE` prefix deletes — idempotent.

### ✅ Keycloak WebAuthn Passwordless Runbook
**File:** `JAG_Keycloak_WebAuthn_Runbook.md`

Complete step-by-step setup for:
1. WebAuthn Passwordless Policy (RP ID, ES256, platform attachment, resident key, user verification = required)
2. `JAG Passwordless Browser` authentication flow (Cookie → passkey-or-TOTP sub-flow)
3. Realm browser binding
4. `Webauthn Register Passwordless` required action (default ON for new users)
5. `jag-api` client settings (Standard Flow only, no Direct Access Grants)
6. Manual user provisioning flow (temp password → Face ID enrollment)
7. Validation curl commands
8. Phase 1B: custom mappers `jag_user_id` + `jag_tenant_id` → remove DB lookup in auth.ts
9. Troubleshooting table (RP ID mismatch, wrong flow binding, USER_NOT_PROVISIONED, JWT iss, MacBook separate enrollment)

### ✅ RLS penetration test suite (STD-03)
**Files added:**
- `jag-api/src/__tests__/rls-isolation.test.ts` — 12 integration tests
- `jag-api/package.json` updated: `jest ^29.7.0`, `ts-jest ^29.2.6`, `@types/jest ^29.5.14`
- New scripts: `"test": "jest"`, `"test:rls": "jest --testPathPattern=rls-isolation --verbose"`

**Test coverage (4 describe blocks, 12 tests):**

| Test | Policy |
|------|--------|
| User A reads only tenant A rows | tenant_isolation |
| User B cannot read tenant A rows → empty | tenant_isolation |
| Fail-closed: empty current_tenant_id → 0 rows | tenant_isolation |
| Fail-closed: no SET LOCAL at all → 0 rows | tenant_isolation |
| SET LOCAL does not leak to next transaction | transaction scope |
| Cross-tenant INSERT rejected by WITH CHECK | tenant_isolation |
| Tenant A user sees own + system audit entries | three-clause policy |
| Tenant B user cannot see tenant A audit entries | three-clause policy |
| Owner bypass_rls sees all tenants in audit_log | three-clause policy |
| Owner bypass_rls NOT set when isOwner = false | bypass guard |
| User A sees only own notifications | user_isolation |
| User B cannot read user A notifications | user_isolation |
| withOwnerRLS rolls back on error + connection reusable | error handling |

Tests use fixed UUIDs (`a0000000-*` range). `beforeAll` creates test data; `afterAll` cleans it up. Suite skips gracefully (`describe.skip`) if `DATABASE_URL_CORE` is not set — zero failures in CI without infra.

To run when Phase 0 DB is live:
```bash
DATABASE_URL_CORE=postgresql://jag_app:pw@localhost:5432/jag_core npm run test:rls
```

---

## Current File State

```
jag-api/
  package.json                              ← jose, jest, ts-jest added
  src/
    db/index.ts
    middleware/
      rls.ts                                ← withTenantRLS, withOwnerRLS (unchanged)
      auth.ts                               ← requireAuth() — Session 2
    __tests__/
      rls-isolation.test.ts                 ← NEW Session 3

jag-event-dispatcher/
  migrations/
    jag_core/
      20260524000001_create_pending_events.ts
      20260524000002_pending_events_failed_at.ts
      20260524000003_create_jag_core_schema.ts
      20260524000004_seed_i18n_translations.ts  ← NEW Session 3
    jag_commercial/20260524000003_create_jag_commercial_schema.ts   (Session 2)
    jag_entertainment/20260524000003_create_jag_entertainment_schema.ts (Session 2)
    jag_family/20260524000003_create_jag_family_schema.ts            (Session 2)
    jag_properties/20260524000005_create_jag_properties_schema.ts    (Session 2)

JAG_Keycloak_WebAuthn_Runbook.md   ← NEW Session 3
```

---

## Open Question — Phase 0 Execution Status

**This is the most critical unknown.** Before any migration work is meaningful, the infrastructure must exist:

- [ ] PostgreSQL instance running with 5 databases created?
- [ ] `jag_app` role created with correct ownership and `NOLOGIN` → `LOGIN` config?
- [ ] Each database has `jag_app` as owner?
- [ ] Keycloak instance running?
- [ ] GitHub Actions deploy script produced?
- [ ] Dockerfiles reviewed (jag-event-dispatcher has one; jag-api does not yet)?

If Phase 0 has NOT been executed, Session 4 should produce the Phase 0 infrastructure script as Priority 1 before any other work.

---

## Session 4 — Priority Queue

### Priority 1: Confirm Phase 0 status
Ask Robert: "Has Phase 0 been run? Do the 5 PostgreSQL databases exist? Is Keycloak running?"

If NO → Priority 1 becomes writing the Phase 0 infrastructure script:
- `docker-compose.yml` (PostgreSQL + Keycloak)
- `scripts/phase0_init.sql` (create 5 databases, jag_app role, ownership grants)
- `scripts/phase0_keycloak.sh` (realm import, client creation, initial admin user)

### Priority 2: jag-api Dockerfile
`jag-api` has no Dockerfile. `jag-event-dispatcher` has one. Create `jag-api/Dockerfile` matching the same pattern.

### Priority 3: Role seeding migration
`jag_core 000005` — seed the `roles` table with the 8 platform roles:
- Owner
- Domain Admin
- Operator
- Viewer
- External Advisor
- Auditor
- Emergency Designate
- System

These are currently referenced in the RLS tests as `RLS_TEST_OPERATOR` / `RLS_TEST_OWNER`. After real roles are seeded, the test setup can optionally use real role IDs (though the test-specific roles are fine for isolation purposes).

### Priority 4: jag-api `src/index.ts`
The API service has no entry point. Create:
- `src/index.ts` — Express app setup, `requireAuth()` global middleware, health check route, graceful shutdown
- `src/routes/` directory structure (placeholder routes for each module)

### Priority 5: Phase 1B planning session
Document the Phase 1B upgrade items while Phase 1A is still fresh:
- Custom Keycloak mappers: `jag_user_id`, `jag_tenant_id`
- Auth middleware: remove `resolveUserFromKeycloakId()` DB lookup
- WiPay webhook integration endpoint
- WhatsApp notification channel (Tier 1 — now only has IN_APP)
- Automated role expiry job for External Advisor grants

---

## Phase 1A Completion Checklist

| Item | Status |
|------|--------|
| jag_core business schema (000003) | ✅ Done — Session 1 |
| jag_commercial business schema (000003) | ✅ Done — Session 2 |
| jag_entertainment business schema (000003) | ✅ Done — Session 2 |
| jag_family business schema (000003) | ✅ Done — Session 2 |
| jag_properties business schema (000005) | ✅ Done — Session 2 |
| Auth + RLS middleware (jag-api) | ✅ Done — Session 2 |
| i18n seed en + zh (000004) | ✅ Done — Session 3 |
| Keycloak WebAuthn runbook | ✅ Done — Session 3 |
| STD-03 RLS penetration test suite | ✅ Done — Session 3 |
| Phase 0 infrastructure script | ⏳ Pending — confirm status with Robert |
| Role seeding migration (000005) | ⏳ Pending — Session 4 |
| jag-api Dockerfile | ⏳ Pending — Session 4 |
| jag-api src/index.ts | ⏳ Pending — Session 4 |
| Phase 1B planning doc | ⏳ Pending — Session 4 or 5 |

---

*End of Session 3 Handoff*
