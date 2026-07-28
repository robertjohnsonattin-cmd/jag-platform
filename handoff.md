# Session Handoff — Properties module restructure & repair (session 50)

> Supersedes the previous handoff (context/token reduction + clinical-data purge), which was
> complete and whose durable content — the measured 231.6k → 47.7k result and its caveats — is
> committed in `docs/CHANGELOG.md` at `f1f17f8`. Nothing from it is pending.

## 1. Metadata

| | |
|---|---|
| **Date** | 2026-07-28 (session 50) |
| **Project path** | `C:\Users\rober\Documents\Claude\Projects\JAG Holdings` |
| **Git branch** | `main`, HEAD `f1f17f8`. **Nothing committed this session** — 16 files changed, sitting uncommitted in the working tree |
| **Context estimate** | Long. Full plan-mode exploration of the Properties module, several large reads (`PropertiesPanel.tsx` is 3,654 lines), a Docker migration test cycle. No compaction yet; likely approaching it |
| **Approved plan** | `C:\Users\rober\.claude\plans\validated-giggling-dahl.md` — authoritative spec for Phases 2–5, read it first |
| **Design reference** | https://claude.ai/code/artifact/416374ad-a12b-45ad-a51e-9825c8b63a53 — published artifact: diagnosis, proposed IA, Tenant 360 wireframe |

## 2. Current Objective

Robert reported the Properties module felt "disjointed and bloated": a deposit paid by tenant
Ashanti Charles showed under Tenancy Ops but her tenant record showed nothing under Leases,
Applications or Maintenance, and property *acquisition* sat under *Leasing* where it doesn't belong.
The layout complaint is real but secondary — three underlying defects made the module behave
inconsistently regardless of tab arrangement. The work is a five-phase repair-then-restructure:
fix the data links, rebuild the tenant view, restructure navigation, consolidate the duplicated
rent system, add the landing view.

**Phase 1 is complete and building clean. Phases 2–5 not started.**

## 3. Decisions Made & Rationale

**The lease was the hub of the entire data model — that is the root cause.** Deposits, maintenance
tickets and handover checklists all resolved `tenant_id` *through* a lease. With the portfolio
between tenancies (25 units vacant, all leases expired) that chain resolved to null for every
record. Decision: every tenancy record form must be able to name a tenant **directly**; deriving
from a lease is a convenience, never the only path.

**`GET /properties/leases` was dead code, not an empty result.** Declared in `properties.ts` *after*
`GET /:id`; Express matches in registration order, so every call was captured by `/:id`, failed
`UUIDParam.safeParse` and returned 422. The frontend throws on non-2xx → `data` undefined → `= []`
default → "No leases on file for this tenant." Session 44 added that endpoint to close exactly this
gap and **it never once worked**. Decision: flat `/properties/x` routes live in their own file,
mounted from `index.ts` above `propRoutes`.

**Loading / failed / genuinely-empty must never share a message.** This is what hid the leases bug
for six sessions. Built as a shared component (`TenantSectionState.tsx`) specifically so Phase 2
reuses it rather than re-deriving it.

**Rent consolidates onto `prop_rent_schedule`** — Robert's choice when asked. Two parallel rent
systems existed: `prop_rent_payments` (property detail → Payments, `GET /arrears`,
`/financial-summary`, and the **main Dashboard** arrears widget) and `prop_rent_schedule` (Tenancy
Ops → Rent, all WhatsApp reminder batches, Reconciliation). Separate record-payment endpoints,
separate receipt numbering, neither writes to the other — so rent recorded in the Rent tab does not
move the Dashboard arrears figure. `prop_rent_schedule` is already a functional superset. STD-13
expand-and-contract; **contract step deferred to a later deploy**. Do not add readers of
`prop_rent_payments`.

**Build the Properties landing view** — Robert's choice when asked. Mostly wiring endpoints that
already exist (`getArrears`, `getLeaseExpiry` already feed `pages/Dashboard.tsx`).

**Tenant 360 uses master-detail, not a nested route** — mirrors the proven pattern at
`PropertiesPanel.tsx:3296-3370`, already mobile-tested in session 46. Avoids a second navigation
mechanism.

**`UPDATE … FROM LATERAL (…)` cannot reference the update target in PostgreSQL.** The first draft of
migration 063 used it and failed with `invalid reference to FROM-clause entry for table "d"`. Caught
by running it against a throwaway `postgres:18` container with a fixture mirroring Ashanti's
situation. Rewritten with a temp `DISTINCT ON` view. **Do this again for the Phase 4 rent migrations
— it is cheap and it caught a production-breaking error.** Container was removed after use.

**Documentation had real gaps, now closed.** Six `jag_properties` migrations existed on disk but not
in `docs/migrations.md` (056, 058–062). Behind 058/060/061 is an entire undocumented **vendor
invoices** feature — 801-line `vendor-invoices.ts`, `prop_vendor_invoices`, per-unit allocations,
Finance-expense bridge, GL settlement writeback — reachable only via property detail → Invoices.

## 4. Active & Critical Files

**New (untracked)**
- `jag-api/src/routes/properties/leases.ts` — complete, typechecks. Flat lease list, all filters optional.
- `jag-web/src/components/properties/TenantSectionState.tsx` — complete. Shared loading/error/empty component; **reuse in Tenant 360**.
- `jag-infra/migrations/jag_properties/063_tenancy_link_backfill.sql` — complete, validated against real PostgreSQL. **Not yet applied to production.**

**Modified — backend**
- `jag-api/src/routes/properties/index.ts` — `leasesRouter` mounted above `propRoutes`. Done.
- `jag-api/src/routes/properties/properties.ts` — shadowed `GET /leases` removed, warning comment left in its place. Done.
- `jag-api/src/routes/properties/deposits.ts` — optional `tenant_id`; resolution order tenant → lease → application. Done.
- `jag-api/src/routes/properties/maintenance-tickets.ts` — optional `tenant_id`; unit lookup falls back ACTIVE → most-recent lease. Done.
- `jag-api/src/routes/properties/applications.ts` — added `u.property_id` to both list queries so the deposit form can preselect a property. Done.

**Modified — frontend**
- `jag-web/src/api/properties.ts` — added `listLeases(params?)` for Phase 3; **written but not yet consumed anywhere**.
- `jag-web/src/components/properties/PropertiesDepositsPanel.tsx` — raw "Unit ID (UUID)" text box replaced with property→unit cascade + tenant picker; save guarded. Done.
- `jag-web/src/components/properties/PropertiesMaintenancePanel.tsx` — tenant picker added to create-ticket modal. Done.
- `jag-web/src/components/properties/TenantsPanel.tsx` — all 8 sections use `TenantSectionState`. **Will be largely rewritten by Phase 2**; the 8 modals at roughly lines 309–953 are the ~600 lines being replaced.

**Modified — docs**
`docs/migrations.md`, `docs/route-map.md`, `docs/rules/properties.md` — Phase 1 registered, plus the
six backfilled migration entries and the vendor-invoices route entry.

**Reference only, unmodified, central to remaining phases**
- `jag-web/src/pages/Properties.tsx` — the `GROUPS` const is rewritten in Phase 3.
- `jag-web/src/components/properties/PropertiesPanel.tsx` — master-detail pattern at 3296, detail tabs at 2427; Phase 5 collapses 12 sub-tabs → 6.
- `jag-api/src/routes/properties/rent-schedule.ts` and the rent-payments routes in `properties.ts` — Phase 4 targets.

## 5. Immediate Next Steps

**Open question Robert has not yet answered: deploy Phase 1 now, or continue into Phase 2?**
Resolve that before anything else.

1. Get Robert's answer on deploy-vs-continue. Phase 1 is independently deployable and fixes the
   problem he originally reported.
2. If deploying Phase 1: `npm run build:prod` in `jag-api/` → tar-then-scp `dist/` (never `scp -r`,
   it stalls silently) → apply migration 063 manually via `sudo -u postgres psql -d jag_properties`
   → hand-register it in `__migrations` → `npm run build` in `jag-web/`, scp `dist/`.
   **Run `git status` before `./deploy.sh`** — step 8 does `git add -A`.
3. Verify Phase 1: `curl` `/api/v1/properties/leases?tenant_id=<uuid>` must return **200**, not 422
   — assert on status, not on array length. Then confirm Ashanti Charles's deposit appears on her
   tenant record.
4. Phase 2 — Tenant 360. Master-detail conversion; tabs Overview / Tenancy / Money / Maintenance /
   Documents / Messages; status line plus lifecycle timeline (Enquiry → Viewing → Application →
   Approved → Deposit → Lease → Handover), which is the genuinely new element — that state is
   currently stated nowhere in the app.
5. Phase 3 — navigation restructure. **Trap:** a new `GET /properties/units` must be registered
   before `propRoutes` in `index.ts` or it will be shadowed by `/:id` exactly like `/leases` was.
6. Phase 4 — rent consolidation. Validate migrations 064/065 in a throwaway `postgres:18` container
   first. The backfill must aggregate multiple `prop_rent_payments` rows per period (schedule has
   `UNIQUE (lease_id, period_year, period_month)`) and log collisions rather than fail.
7. Phase 5 — landing view + property detail collapse. Largest, least valuable, droppable.
8. Finish docs registration (task #10, still open): new panels into `docs/route-map.md`, session
   narrative into `docs/CHANGELOG.md`, update the "Leases (B3)" item in CLAUDE.md OPEN ITEMS.

## 6. Key Patterns & Constraints

Established or confirmed this session:

- Flat `/properties/x` routes go in their own file, mounted in `index.ts` **above** `propRoutes`.
  Never declare one in `properties.ts` below `GET /:id`.
- New routes use the new-style envelope helpers — `res.json(ok(data))` /
  `res.status(N).json(err(msg, code))`, not the old `ok(res, data)` form. `withOwnerRLS(pool, ownerId, cb)`
  is the convenience overload the flat tenancy routers use.
- Never render one message for loading, error and empty. Use `TenantSectionState`.
- Migrations are **always applied manually** — nothing auto-applies on container start. Raw-psql ones
  must be hand-registered in `__migrations`. `prop_applications` and `prop_maintenance_tickets` are
  not owned by `jag_app`, so they need `sudo -u postgres psql`.
- Validate non-trivial migrations against a throwaway `postgres:18` Docker container before deploy.
  On Git Bash, `docker exec … -f /tmp/x.sql` needs `MSYS_NO_PATHCONV=1` or the path is mangled.
  UUID literals in fixtures must be valid hex — `…0000u1` is rejected.
- Build gate is `npx tsc -b` (not `--noEmit`; `-b` catches filename-casing mismatches) in **both**
  `jag-api/` and `jag-web/`, plus `npm run build` in `jag-web/`.
- i18n: English first, translate as a batch at the end. Never name an arrow-function param `t`; never
  use a translated string as a React key. New keys in `jag-web/src/locales/en.json`, then mirrored to
  `zh-CN.json`.
- Documentation registration is not optional and not deferred to end of session — register the moment
  a file is created, and grep the whole migrations table for skipped numbers. This session found six.

Explicit user constraints from this session:

- Robert asked for the whole thing planned before implementation, and approved the five-phase plan.
- Do not spawn subagents — the harness config forbids it unless explicitly requested.
- Do not commit or push unless asked. **This is why 16 changed files are uncommitted.**

## 7. Resumption Instruction

Read `handoff.md` and `C:\Users\rober\.claude\plans\validated-giggling-dahl.md` in the JAG Holdings
project root before touching anything. Phase 1 of the Properties module repair is complete,
typechecks clean in both `jag-api/` and `jag-web/`, and is sitting **uncommitted** on `main` across
16 files — protect it from another session's git operations. Your immediate action: ask Robert
whether to deploy Phase 1 now (it independently fixes the missing-deposit problem he reported) or to
continue straight into Phase 2, the Tenant 360 detail pane. Do not re-investigate the root cause —
the shadowed `GET /leases` route and the lease-as-hub data model are diagnosed, fixed and documented
in `docs/rules/properties.md`.
