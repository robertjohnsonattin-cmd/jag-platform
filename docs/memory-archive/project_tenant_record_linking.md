---
name: project-tenant-record-linking
description: "All 7 tenancy record types (deposits/applications/maintenance/handover/leases/renewals/rent-schedule) now link back to the tenant and surface on the Tenant record (migrations 052-055, session 44)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 027c2389-f741-4d43-b175-fa4ecfc5bac6
  modified: 2026-07-21T13:42:31.556Z
---

Robert asked why a deposit taken right after application approval (before a lease existed) wasn't sending its receipt or showing under the Tenant record. That one question turned into a full sweep — he then asked "check the same gap" module by module across the whole tenancy flow. The same underlying issue (no durable link back to the tenant, no tenant-scoped query, no Tenant-record UI) recurred independently in **7 of 7** record types checked, split into two flavors:

**No FK path to the tenant at all (needed a migration + creation-time resolve):**
- **Deposits** — no `tenant_id`/`application_id`, only resolved via `lease_id`, so a deposit taken before any lease existed skipped both the Tenant-record display and the WhatsApp receipt send.
- **Applications** — `create-tenant` only ever read FROM the application, never wrote a link back.
- **Maintenance tickets** — had a nullable `lease_id` column, but the **frontend never actually sends it** (checked `PropertiesMaintenancePanel.tsx` directly — zero references). Had to resolve `tenant_id` from the unit's active lease instead, since `unit_id` is the field that's actually reliable.
- **Handover checklists** — had an optional `lease_id` the frontend *does* collect (unlike maintenance), but no general list route existed at all — only `GET /unit/:unitId`.

**`lease_id NOT NULL` already — data link intact, just missing a query + UI (no migration needed):**
- **Leases** — every route nested under `/:propertyId/leases`, no tenant-scoped query.
- **Renewal notices** — list route took zero query params. Also had a real live bug found in the same pass: a query referenced a nonexistent `l.rent_amount_ttd` column (real column is `monthly_rent`) — meaning the Renewals panel had likely been 500ing on every load, undetected.
- **Rent schedule** — list route already had `lease_id`/`unit_id`/`status`/`year` filters, just not `tenant_id`.

**Why:** none of these were designed wrong in isolation — each was built independently across different sessions without a "does this link back to the tenant, is there a tenant-scoped query, is there a UI surface" checklist. The gap only became visible once Robert actually tried to trace records back to a tenant, and checking systematically (rather than waiting for each to surface on its own) found the other 5 before they became separate incidents.

**How to apply:** fixed all 7 (migrations 052/053/054/055 for the FK-less ones; query+UI only for the other 3). `TenantsPanel.tsx` now has 8 per-tenant sections: Docs, Deposits, Leases, Applications, Maintenance, Renewals, Handover, Rent. Full detail in CLAUDE.md under "Tenant record — full tenancy-chain linking (session 44)". **When any new record type touches the tenancy flow, check the same three things up front, and don't trust a `lease_id`/`tenant_id` column exists just because the schema has one — verify the frontend actually populates it** (maintenance tickets' column existed but was dead weight; that's the one case in this sweep where trusting the schema would have produced a fix that silently didn't work).

Commits: `132b197`, `d506a96`, `42ffeeb`, `fe2d7b6`, `f1778bf`, `cc4d2db`, `d8fea4f` (feature, migrations 052-055), `15bc5e8`, `32daea1` (docs). See also [[feedback-deploy-scp-sequence]] and [[feedback-migration-runner]] for the deploy/migration mechanics hit while shipping this.
