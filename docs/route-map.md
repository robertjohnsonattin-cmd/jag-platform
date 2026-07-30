# Route map & build status (Phase 7)

> Split out of CLAUDE.md. **Grep/read this before answering "does feature X exist".**

## PHASE 7 — REACT FRONTEND (COMPLETE)

**App directory:** `jag-web/` (at repo root, alongside `jag-api/` and `jag-infra/`)
**Stack:** React 18 + TypeScript + Vite + TailwindCSS + React Query + Keycloak JS adapter
**Deployment:** Static files served by Caddy on VM — `/opt/jag/jag-web/dist`

### Build Order & Status

| Step | Scope | Status |
|---|---|---|
| 1 | Auth shell + sidebar layout (Keycloak SSO, protected routes, nav) | **DONE** |
| 2 | Finance dashboard (net worth, accounts, recent transactions) | **DONE** |
| 3 | GL / Ledger UI (chart of accounts, journal entries, trial balance) | **DONE** |
| 4 | Expenses (submission, approval workflow, receipt upload) | **DONE** |
| 5 | Properties (portfolio, leases, rent payments, maintenance, insurance, tax, inspections, units, documents, financials) | **DONE** |
| 6 | JABCO (payment certs, CRM pipeline integration) | **DONE** |
| 7 | IMS — Inventory & Assets (items, vehicles, movements, stock takes, depreciation, valuation, low stock) | **DONE** |
| 8 | CRM (contacts, pipeline, interactions) | **DONE** |
| 9 | Lifestyle (loyalty programmes, health tracker) | **DONE** |
| 10 | Finance Advanced: Insurance UI + Intercompany UI | **DONE** |
| 11 | JAG Entertainment (BAR + Members Club) | **DONE** |
| 12 | DragonBridge, remaining modules | **DONE** |

### Frontend gap-audit pages (session 26 — backend existed, UI was missing)

| Page / feature | File | Notes |
|---|---|---|
| Accountant Export | `pages/Export.tsx` (nav `/export`) | 7 read-only views (trial balance, GL, expenses, insurance, premiums, claims, intercompany) + per-view CSV (`lib/csv.ts`, RFC-4180 + BOM) |
| Succession (estate) | `pages/Succession.tsx` (nav `/succession`) | Register over `fam_succession_documents`; upload/edit/download; needs `GET /succession/documents/:id` (added) for storage_path |
| Family Registry | `pages/Family.tsx` (nav `/family`) + `api/family.ts` | Card grid over `fam_family_members` (relationship, age, 🛡 emergency-designate, 🔑 platform-access, birthday); add/edit; no DELETE (backend has none). **DocVault linkage:** "📄 N" doc count per card + Documents section in member modal (download via `api.download`) |
| DocVault ↔ Family link | `pages/DocVault.tsx` + `routes/docvault/index.ts` `PATCH /files/:id` | Tag a document to a person: "Belongs to" picker on upload, assign/reassign `<select>` on detail panel, family-member filter in filter bar (backend already filtered/returned `family_member_id`; PATCH added so existing docs can be re-tagged + audit_log) |
| Lifestyle ↔ Family link | `pages/Lifestyle.tsx` + `routes/lifestyle/index.ts` | Tag loyalty programmes + health metrics to a person. Loyalty PATCH extended to set `family_member_id` (nullable to clear → reassignable); tracker is append-only (assign-on-create). "Belongs to" picker on all 3 modals; member filter + assignee shown in both Lifestyle tabs. Family card shows "✈ N"; member modal has Loyalty programmes + Health metrics sections (`pages/Family.tsx`, tracker lazily fetched per member) |
| Ownership cap table (succession) | `pages/Ownership.tsx` + `routes/family/ownership.ts` + migration 017 + net-worth guard | Beneficial-ownership of entities + assets with % shares; By Entity / By Person; per-person estate rollup (entity % × net worth + direct assets). Family modal Estate section. See "Beneficial-ownership cap table" rule above |
| Notification bell | `components/NotificationBell.tsx` + `api/notifications.ts` | Badge (60s poll) + dropdown, mark-read / mark-all-read; mounted in AppShell desktop + mobile |
| Pending-review → Transactions | `components/finance/TransactionsPanel.tsx` | AI `suggested_category`/`confidence` surfaced in review modal; orphaned `fin_pending_review_queue` row closed on PATCH |
| IMS photo 401 fix | `components/AuthedImg.tsx` + `api/client.ts` `objectUrl()` | Auth-gated streaming `<img>` now Bearer-fetched → blob (see implementation rule above) |

### Properties navigation restructure — Phase 3 (session 52, 2026-07-28)

Properties restructure **Phase 3**. Six groups instead of five, and two flat cross-property
views that had no home before. Old ids stay valid — see the alias table below.

| Group | Tabs (in order) |
|---|---|
| Portfolio | Properties · **Units** (new) · Acquisitions (moved out of Leasing) |
| Leasing | Enquiries · Viewings · Applications · **Leases** (new) · Handover (moved in) · Renewals |
| Tenants | Tenant 360 · Doc Expiry |
| Money | Rent · Deposits · Reconciliation |
| Maintenance | Tickets · Scheduled · Contractors |
| Inbox | WhatsApp · Approvals |

| Piece | File | Notes |
|---|---|---|
| Flat unit list | `components/properties/UnitsPanel.tsx` | All units across every property in one screen — its reason to exist is the listing backlog (25 units, most still missing photos/description/rent, previously only visible property-by-property). Filters: property, listing status, "needs listing content only". Reuses `ManageListingModal`, now **exported** from `PropertiesPanel.tsx`, rather than duplicating ~250 lines of listing form; callers outside that file pass the row's own `property_id` and invalidate their own query key in `onChanged` |
| Listing-readiness scoring | `components/properties/UnitsPanel.tsx` → `readiness()` | Scores **photos / description / rent only**. Utilities are deliberately excluded: `wasa_included`, `electricity_included`, `internet_included` all default to `FALSE` in migration 022, so "not included" and "nobody has filled this in" are the same value in the DB. Scoring them would state a guess as a fact — same rule as `UNKNOWN` vs `PENDING` in the Tenant 360 timeline |
| Flat lease list | `components/properties/LeasesPanel.tsx` | Consumes the `GET /properties/leases` that Phase 1a un-shadowed. Read-only portfolio view with property + status filters and a 60-day expiry flag; creating/editing a lease still happens under its property |
| Flat units route | `routes/properties/units-list.ts` → `unitsListRouter` | `GET /properties/units`, mounted in `index.ts` **above** `propRoutes`. Same columns as `GET /:propertyId/units` plus `property_id` / `property_name` / `property_city` / `photo_count` / `lease_end_date`. Distinct from `routes/properties/units.ts` (`unitsRouter`), which is the nested per-property unit CRUD — two routers, two files, similar names |
| Legacy tab aliases | `pages/Properties.tsx` → `LEGACY_TAB_IDS` + `resolveTab()` | Tab ids are a public contract (notification bell, WhatsApp deep links, bookmarks). `?tab=pipeline` → `acquisitions`. Applied at mount **and** in the `?tab=` `useEffect`, so both paths honour the alias |

**Route-shadowing hazard, third instance:** `GET /properties/units` is a single path segment, so
`GET /:id` inside `properties.ts` captures it, fails its UUID parse and returns `422` — exactly how
`GET /properties/leases` stayed dead for six sessions. It is mounted from `index.ts` ahead of
`propRoutes`. Mounting `/units` there is safe alongside the existing `POST /units/alert-stale` and
`/units/:id` (listing) routes further down: `unitsListRouter` declares only `GET '/'`, so everything
else falls through.

**Deviation from the approved plan:** the plan retired the Doc Expiry tab in favour of a Phase 5
landing card. Phase 5 is explicitly droppable, so retiring the tab now would make a working,
deployed portfolio-wide view unreachable. It sits under Tenants (every row it shows is a tenant
document) until that card actually exists.

**Naming collision:** "Units" is now a top-level Properties tab (all units, cross-property), a
sub-tab inside each property's detail pane (that property's units), and unrelated to Inventory's
stock units. "Leases" is likewise both a top-level tab and a property-detail sub-tab.

### Generate Rent Schedule button — Properties → Portfolio → *property* → Leases (session 52, 2026-07-28)

| Piece | File | Notes |
|---|---|---|
| Generate / top-up rent schedule | `components/properties/PropertiesPanel.tsx` → lease action row | First and only UI caller of `tenancyApi.generateRentSchedule()` → `POST /properties/rent-schedule/generate`. Sits beside **Send for Signature** on each lease row in the property-detail **Leases** sub-tab. Idempotent (`ON CONFLICT (lease_id, period_year, period_month) DO NOTHING`), so pressing it again fills gaps instead of duplicating |
| Per-lease period count | same file → `lease-schedule-counts` query | One `GET /properties/rent-schedule?lease_id=` per lease of that property, batched inside a single query key. `GET /rent-schedule` has **no property filter**, which is why it is N requests; lease counts per property are small. The button is **disabled while the count is undefined** — falling back to 0 would offer "Generate" for a lease that already has a schedule |

The button is **amber when the count is 0** and a plain `🗓 {n} periods` badge otherwise. A lease
with no rent schedule produces no WhatsApp reminders, no arrears, and nothing on the dashboard, and
until this button existed there was **no way to create one from the UI at all** — the endpoint's
only other caller is `renewals.ts`, which generates on renewal. `LeasesPanel` (the flat
cross-property list) stays read-only by design; this action lives with the other lease actions.

### Tenant 360 — Properties → Tenants (session 51, 2026-07-28)

Properties restructure **Phase 2**. Replaced the tenants table (whose last column carried ten
buttons, eight of which opened a near-identical modal) with a master-detail pane on the same
pattern as `PropertiesPanel`.

| Piece | File | Notes |
|---|---|---|
| Tenant list + detail shell | `components/properties/TenantsPanel.tsx` | Master-detail: list is a `w-72` sidebar on md+, full-width on mobile until a tenant is picked, then the detail pane takes over with a `← Back` button. Retains only `AddTenantModal` / `EditTenantModal` / `ConfirmDeleteModal`; creating a tenant now selects it. ~1130 → ~330 lines |
| Detail pane | `components/properties/TenantDetail.tsx` | Six tabs — **Overview · Tenancy · Money · Maintenance · Documents · Messages**. Every section keeps the `tenant_id`-filtered query it already had, gated with `enabled: tab === '…'`; the five the timeline reads are also enabled on Overview. Exports `tenantDisplayName()` and `waNumber()` |
| Section loading/error/empty state | `components/properties/TenantSectionState.tsx` | **Session 50, registered 2026-07-28 (was missed).** Shared component for every per-tenant record section. Renders loading, request-failed and genuinely-empty as three *different* things — a failed request shows the error and says it is a fault, an empty section says why it is empty. Collapsing these three into one message is what hid the dead `GET /leases` route for six sessions. Reuse it for any new tenant section |
| Lifecycle timeline | `components/properties/TenantTimeline.tsx` | Enquiry → Viewing → Application → Approved → Deposit → Lease → Handover, **derived, never stored** — this state was previously stated nowhere in the app. Exports `deriveLifecycle()` (pure, unit-testable) + a `Translate` type. `UNKNOWN` is deliberately distinct from `PENDING`: with no phone on file we cannot know whether someone enquired, and saying "not yet" would be a guess stated as fact |
| Deep links | `pages/Properties.tsx` | `?tab=` is now followed via `useEffect`, not only read at mount — `useState` reads its initial value once, so every cross-reference link out of Tenant 360 changed the URL and nothing else. Also fixes the notification bell when Properties is already open. Panels that accept `focusId` (applications, maintenance) get it; the rest just land on the right tab |

**Naming collision:** "Maintenance" is a tab *inside* Tenant 360 (that tenant's reactive tickets),
a top-level Properties tab (all tickets), a separate Properties **Scheduled** Maintenance tab
(preventive), and an Inventory/VMS PM schedule. Four different things.

### Mobile density / navigation cleanup (session 46, 2026-07-24)
Robert flagged Properties (most-fleshed-out module) as hard to use on mobile. Fixed platform-wide, not just Properties — see the three new bullets under "Mobile responsive patterns" above for the reusable rules (`min-w-0` on master-detail list panes, `overflow-x-auto` on tab bars, grouped tabs over ~6 items). Concretely: grouped nav on Properties (17→5 sections), Finance (11→3), HR (9→4); wrapped 21 bare `<table>`s in `overflow-x-auto` (Purchasing, NLCB, JournalEntries, DragonBridge, Inventory); added `overflow-x-auto` to 14 previously-unwrapped tab bars; fixed the `min-w-0` gap on 12 master-detail screens (this was the real bug — Inventory's Items filter row was silently clipped off-screen with no scrollbar, not just "cramped"). Deployed via `./deploy.sh --frontend-only` (commit `9f691a9`). **Note:** `deploy.sh`'s git-snapshot step does `git add -A`, so an unrelated frontend-only deploy can sweep up any stray untracked files sitting in the repo at deploy time — worth a `git status` glance before deploying if you know there's WIP lying around.

### Phase 7 Backend Additions (done during frontend build)

| Addition | File | Notes |
|---|---|---|
| IMS suppliers | `routes/ims/suppliers.ts` | Supplier CRUD |
| IMS stock takes | `routes/ims/stocktakes.ts` | Full stock take lifecycle |
| IMS depreciation | `routes/ims/depreciation.ts` | Straight-line + declining balance |
| IMS vehicle overhaul | `routes/ims/vehicles.ts` | `owner_entity` (flexible), service tracking, STD-13 dual-write |
| VMS maintenance | `routes/ims/vms-maintenance.ts` | Work orders + work order items CRUD; PM schedules (DAYS/KM/HOURS) with mark-done; status machine OPEN→IN_PROGRESS→COMPLETE; mounts under `/vehicles/:id` |
| VMS fuel & costs | `routes/ims/vms-costs.ts` | Fuel logs (litres × price → total_cost_ttd); operating costs (TOLL/PARKING etc.); TCO aggregate (`GET /tco` — maintenance + fuel + operating + depreciation) |
| VMS compliance | `routes/ims/vms-compliance.ts` | Compliance docs vault (MOT/ROADWORTHY/FIRE_EXTINGUISHER etc.); is_expired/is_expiring_soon computed fields; presigned upload/download via MinIO |
| VMS disposal + GL | `routes/ims/vms-disposal.ts` | `GET /vehicles/:id/disposal`; `POST /vehicles/:id/dispose` — marks vehicle DISPOSED, snapshots TCO, posts Dr/Cr GL entry to `jag_family` non-blocking; SALE/WRITE_OFF/TRANSFER types; `vms_disposals` table with `journal_entry_id` writeback |
| Asset disposal | `routes/ims/items.ts` | `POST /ims/items/:id/dispose` — validates `is_asset=true` AND not a vehicle; sets `is_active=false`, writes disposal columns, inserts stock movement; non-blocking `postItemDisposalGlEntry()` to jag_family if GL accounts provided; `disposal_gl_entry_id` writeback; `DisposeItemSchema` Zod validation |
| GL account creation | `routes/finance/gl.ts` | `POST /finance/gl/accounts` already existed; `glApi.createAccount()` added to frontend `api/gl.ts`; `+ Add Account` button + `AddAccountModal` added to `ChartOfAccounts.tsx` |
| GL new entry | `components/ledger/JournalEntries.tsx` | `+ New Entry` button + `NewEntryModal` — entity/date/description/reference, dynamic line items (account picker per entity, Dr/Cr toggle, amount), running balance indicator, saves as DRAFT; `glApi.createEntry()` added to `api/gl.ts` |
| Finance credit cards | `routes/finance/credit-cards.ts` | `fin_credit_cards` CRUD; GET/POST/PATCH/DELETE; `is_active` soft-delete; used by mobile expense form card picker |
| IMS locations POST | `routes/ims/items.ts` | `POST /ims/locations` added |
| Properties insurance | ~~`routes/properties/insurance.ts`~~ — **REMOVED session 28**; property insurance now stored in `fin_insurance_policies` (jag_family) with `insured_asset_ref = property.id`; Properties panel Insurance tab queries Finance Insurance API filtered by `insured_asset_ref` | Consolidated into fin_insurance_policies |
| Properties tax | `routes/properties/property-tax.ts` | Tax records + pay |
| Properties inspections | `routes/properties/inspections.ts` | Inspection log |
| Properties units | `routes/properties/units.ts` | Unit CRUD |
| Properties utility accounts | `routes/properties/utility-accounts.ts` | Account tracking |
| Properties documents | `routes/properties/documents.ts` | MinIO-backed doc store |
| Properties PATCH | `routes/properties/properties.ts` | `PATCH /:id` — edit name/address/valuation |
| Net-worth physical assets | `routes/finance/net-worth.ts` | Cross-DB: IMS items+vehicles + property valuations feed into snapshot |
| File routes | `routes/files/` | MinIO presigned URL helpers |
| Finance GL | `routes/finance/gl.ts` | Chart of accounts + journal entries |
| Finance Expenses | `routes/finance/expenses.ts` | Expense submission + approval workflow |
| Finance Intercompany | `routes/finance/intercompany.ts` | Intercompany charges + eliminations |
| Finance Insurance | `routes/finance/insurance.ts` | Insurance policies + premiums + claims |
| Finance Export | `routes/finance/export.ts` | Read-only accountant export views |
| Finance Reports | `routes/finance/reports.ts` | P&L, balance sheet, cash flow |
| DragonBridge routes | `routes/dragonbridge/` | clients, orders, quotes, shipments, products, pricing-tiers, suppliers, reconciliations, config |
| Entertainment routes | `routes/entertainment/` | supplier-invoices, utilities, reports |
| Club routes | `routes/club/` | members, memberships, tiers, events, credits, chip-float, visitor-log |
| NLCB routes | `routes/nlcb/` | sessions, settlements, games, scratch-games, scratch-consignments, scratch-session, scratch-pack-purchases, billers, expenses, config |
| DocVault routes | `routes/docvault/` | Document management |
| Succession routes | `routes/succession/` | Succession planning |
| Family routes | `routes/family/` | Family module |
| Finance bank statements | `routes/finance/bank-statements.ts` | Upload, queue, list, delete jobs; MinIO storage; `fin_bank_statement_jobs` table; `POST /import` for Path 2 local script |
| Finance credit/debit cards | `routes/finance/credit-cards.ts` | Card CRUD for mobile expense form; `fin_credit_cards` table; used by mobile for card picker on CREDIT_CARD/DEBIT_CARD payment methods |
| Finance document jobs | `routes/finance/document-jobs.ts` | Path 1 cloud upload → REVIEW → approve; writes to loans/investments/insurance on approve; auto-deletes MinIO object |
| Finance /import endpoints | `bank-statements.ts`, `loans.ts`, `investments.ts`, `insurance.ts` | Path 2 direct JSON import from local script; all require `idempotency_key` |
| Finance investment valuations | `routes/finance/investments.ts` | `GET /:id/valuations` — history sorted desc by as_of_date; `POST /:id/valuations` — manual historical backfill; auto-insert valuation row on every PATCH to `fin_investments` (same `withOwnerRLS` callback); table `fin_investment_valuations` (migration 009 jag_family) |
| Finance loan balance history | `routes/finance/loans.ts` | `GET /:id/history`; `POST /:id/history` (manual backfill); auto-insert into `fin_loan_balance_history` on every PATCH; table (migration 010 jag_family) |
| Finance insurance policy history | `routes/finance/insurance.ts` | `GET /policies/:id/history`; `POST /policies/:id/history` (manual backfill); auto-insert into `fin_insurance_policy_history` on every PATCH; table (migration 011 jag_family) |
| Property valuation history | `routes/properties/properties.ts` | `GET /:id/valuation-history`; `POST /:id/valuation-history` (manual backfill); auto-insert into `prop_valuation_history` only when `current_valuation` is in PATCH body; table (migration 012 jag_properties) |
| Internal MinIO audit webhook | `routes/internal/minio-audit.ts` | Receives MinIO `audit_webhook:loki` POSTs; validates `Bearer $MINIO_AUDIT_TOKEN`; logs to Loki via structured logger; mounted at `/internal/minio-audit` (no Keycloak, Docker-network-only) |
| Properties vendor invoices | `routes/properties/vendor-invoices.ts` | **Registered 2026-07-28 — existed since well before, undocumented.** `prop_vendor_invoices` CRUD + approve; `prop_vendor_invoice_allocations` splits one invoice across units (migration 058); `linked_expense_id` bridges to a Finance expense (060); `settlement_journal_entry_id` writes back the GL entry on settlement (061). Mounted at `/:propertyId/vendor-invoices`. **Frontend surface:** only property detail → Invoices tab in `PropertiesPanel.tsx` — there is no top-level Invoices tab. Not to be confused with JABCO's payment certificates or DragonBridge invoices |
| Tenancy leases (flat list) | `routes/properties/leases.ts` | **Session 50 (2026-07-28)** — `GET /properties/leases` with optional `tenant_id`/`property_id`/`unit_id`/`status`. Was previously declared inside `properties.ts` *after* `GET /:id`, so Express matched `/:id` first and every call 422'd — the tenant Leases modal had never worked, it just rendered its empty state. **Rule: a flat `/properties/x` route must be mounted from `index.ts` ahead of `propRoutes`, never declared in `properties.ts` below `GET /:id`.** Tenant columns match `GET /:propertyId/leases` exactly so both feed the same frontend `Lease` type |
| Properties units (flat list) | `routes/properties/units-list.ts` | **Session 52 (2026-07-28)** — `GET /properties/units` with optional `property_id`/`listing_status`/`is_rented`. Same columns as the nested `GET /:propertyId/units` plus `property_id`, `property_name`, `property_city`, `photo_count` and `lease_end_date`. Mounted from `index.ts` ahead of `propRoutes` (single-segment path → would otherwise be captured by `GET /:id` and 422, same bug as `/leases`). **Distinct from `routes/properties/units.ts` (`unitsRouter`)**, which is the nested per-property unit CRUD — two files, two routers, near-identical names. Declares only `GET '/'`, so `POST /units/alert-stale` and `/units/:id/*` (listing router) still reach their handlers |
| Tenancy enquiries | `routes/properties/enquiries.ts` | Prospect enquiry CRUD + WhatsApp reply; stage lifecycle. **Session 51 (2026-07-28):** `GET /properties/enquiries` gained a `phone` filter and a `latest_viewing_at` column. An enquiry predates the tenant record and carries **no `tenant_id`** — the prospect's phone is the only link — so Tenant 360's lifecycle timeline reaches Enquiry/Viewing through it. Matching is on the **last 7 digits** of `prospect_phone` (`right(regexp_replace(…,'\D','','g'),7)`), because numbers are stored however they were typed: real rows include both `18682912786` and `251-6802`. A `phone` shorter than 7 digits matches nothing rather than everything |
| Tenancy viewings | `routes/properties/viewings.ts` | Viewing scheduling, Google Calendar events, status PATCH; `/send-reminders` + `/send-post-viewing-links` batch; public booking router (`/public/book/:slug`) |
| Tenancy applications | `routes/properties/applications.ts` | Application CRUD + decide (APPROVE/REJECT) + generate tenancy agreement PDF + **static PDF form** (`GET /form.pdf`, public, no auth) for prospects without WhatsApp |
| Application form PDF | `src/lib/application-form-pdf.ts` | **Session 53 (2026-07-28)** — generates a downloadable static PDF rental application form. Printable layout with all fields matching the online form. Published at `GET /properties/applications/form.pdf` (public, no auth). Download links added to PropertiesViewingsPanel and PublicApply page for prospects without WhatsApp access |
| Tenancy deposits | `routes/properties/deposits.ts` | Deposit CRUD + receipt PDF + refund workflow |
| Tenancy rent schedule | `routes/properties/rent-schedule.ts` | Schedule CRUD + record payment + `/send-reminders` batch |
| Tenancy handover | `routes/properties/handover.ts` | ENTRY/EXIT checklist CRUD + sign-off endpoints |
| Tenancy maintenance | `routes/properties/maintenance-tickets.ts` | P1–P4 tickets + ticket updates + `/check-sla` batch; contractors CRUD |
| Tenancy renewals | `routes/properties/renewals.ts` | Renewal notices + tenant response + process-renew/vacate; `/send-notices` D-60/D-30/D-14 batch |
| Preventive/scheduled maintenance | `routes/properties/scheduled-maintenance.ts` | **Distinct from `prop_maintenance_tickets`** (reactive/tenant-reported). Recurring planned-upkeep tasks (e.g. "service the AC every 3 months") — CRUD + `POST /:id/complete` which logs to `prop_scheduled_maintenance_log` and auto-advances `next_due_date` by `frequency` (WEEKLY/MONTHLY/QUARTERLY/BIANNUAL/ANNUAL/ONE_TIME). Migration `057_scheduled_maintenance.sql` (jag_properties). Frontend: `PropertiesScheduledMaintenancePanel.tsx`, Properties page `sched_maintenance` tab. Real schedule data loaded via `scripts/load-pm-schedule-api.js` (reads a JSON export from Robert's Google Drive, idempotent, bearer-token auth). Deployed 2026-07-21, NaN-days display bug fixed same window (`d35a617`), data loaded 2026-07-23. |
| Tenancy WhatsApp | `routes/properties/whatsapp-send.ts` | Outbound template send; `routes/internal/whatsapp-webhook.ts` inbound webhook (Meta verify + message store) |
| Tenancy listing | `routes/properties/listing.ts` | Unit listing CRUD + Gemini AI rent suggestion + SMS broadcast + photo upload/confirm/list/delete + listing-info PATCH; `triggerAutoListing()` exported and called by handover.ts on EXIT completion |
| Public rental application | `routes/properties/public-apply.ts` | `publicApplyRouter` at `/api/v1/public/apply` (session 40) — `GET /:token` resolve enquiry+prefill, `POST /:token/upload-url` presigned doc upload, `POST /:token` submit to `prop_applications`+`prop_application_documents`, burns token, bell notification. Token generated by `viewings.ts` send-post-viewing-links (30-day validity, migration 045). Frontend `pages/PublicApply.tsx`, public route (bypasses Keycloak like `/book`) |
| Wet-sign lease upload | `routes/properties/properties.ts` | `POST /:propertyId/leases/:leaseId/upload-signed` (multer+MinIO, marks lease SIGNED) + `GET /:propertyId/leases/:leaseId/signed-pdf` (session 40) — paper workflow for tenants without e-signature: download agreement PDF → print → wet-sign → scan → upload |
| Google Calendar lib | `src/lib/google-calendar.ts` | `getAvailableSlots()` + `createCalendarEvent()` + `deleteCalendarEvent()` + `createAllDayCalendarEvent()` via Google Calendar v3 API (service account); `google-auth-library` npm dep; key read from `/opt/jag/jag-api/google-calendar-key.json` (volume-mounted), falls back to `GOOGLE_SERVICE_ACCOUNT_KEY` base64 env var |
| CRM calendar integration | `routes/crm/crm.ts` + `routes/internal/crm-calendar-backfill.ts` | All-day Google Calendar event created non-blocking when `follow_up_date` set on interaction; `calendar_event_id` stored back via `withTenantRLS` UPDATE; backfill endpoint `POST /internal/crm/backfill-calendar` for historical rows; ✓/⚠ sync indicator in CRM panel |
| WhatsApp lib | `src/lib/whatsapp.ts` | `sendTemplate()` + `sendText()` via Meta Cloud API |
| WA approvals | `routes/properties/wa-approvals.ts` | PENDING approval queue for RENT_FORMAL_DEMAND / RENT_LEGAL_NOTICE / DEPOSIT_RECON; approve-and-send + dismiss endpoints |
| WA inbox | `routes/properties/wa-inbox.ts` | Unified conversation timeline (WA messages + contact log); `prop_contact_log` entries |
| WA inbound media (2026-07-30) | `routes/internal/whatsapp-webhook.ts` + `routes/properties/wa-inbox.ts` | Inbound IMAGE/DOCUMENT/AUDIO messages are downloaded from Meta at webhook-receipt time (`lib/whatsapp.ts` `downloadMedia()`) and stored in MinIO (`BUCKET_DOCUMENTS`, key via `mediaObjectKey(ownerId,'wa-inbound',fromNumber,...)`), object key written into the pre-existing but previously-unused `prop_whatsapp_messages.media_url` column. `GET /properties/wa-inbox/media/:id` streams it back (requireAuth-gated, same pattern as tenant documents). Frontend: `TenantDetail.tsx` Messages tab and `PropertiesWhatsAppPanel.tsx` (main WA inbox) both render an `AuthedImg` thumbnail for IMAGE, an "Open attachment" link for DOCUMENT/AUDIO. Image/document captions are now also captured as `body` (previously discarded for every non-text message type). **Not named "media downloads" or similar elsewhere** — don't confuse with the doc-extraction pipeline (`docs/rules/finance.md`, local-filesystem PDFs only, unrelated system). No migration — `media_url` already existed in the schema, unpopulated. |
| WA outbound media / attach file (2026-07-30) | `lib/whatsapp.ts` (`uploadMedia()`, `sendMedia()`, `mimeToWaMediaType()`) + `routes/properties/wa-inbox.ts` (`POST /wa-inbox/:phone/send-media`) | The reverse of the row above — until this, 868-277-3726 could only send TEXT/TEMPLATE/INTERACTIVE/LIST outbound, no attach-a-file. Three-step Meta flow: multer-buffered upload → `uploadMedia()` (POST to Meta `/media`, returns a `media_id`) → `sendMedia()` references that id in the `/messages` call; the same bytes are also written to MinIO (`mediaObjectKey(ownerId,'wa-outbound',phone,...)`) and the row inserted into `prop_whatsapp_messages` (`direction='OUTBOUND'`, `media_url` set) so it renders in the thread identically to an inbound attachment via the existing `GET /wa-inbox/media/:id`. Subject to Meta's 24-hour customer-service-window rule — same constraint that already applied to free-form `sendText`, now also covers media. Frontend: 📎 button + hidden file input in `PropertiesWhatsAppPanel.tsx` compose row only (`TenantDetail.tsx` Messages tab is read-only, no composer, so nothing to add there). `tenancyApi.sendWaInboxMedia()` in `api/tenancy.ts`. No migration — reuses `media_url`. |
| Delete Application (2026-07-30) | `routes/properties/applications.ts` | `DELETE /properties/applications/:id` — Owner only, hard delete. Previously there was no way to remove an application at all (Approve/Reject only shows while PENDING/UNDER_REVIEW, so an already-APPROVED test/bad row had no exit). Blocked (409) if `tenant_id` is set or a `prop_deposits` row references it; `prop_application_documents` cascades via FK, their MinIO objects are cleaned up explicitly (best-effort). UI: red "Delete Application" link + confirm modal on the application detail pane, always visible regardless of status (server enforces the guards). |
| MinIO lib | `src/lib/minio.ts` | Added `getPresignedGetUrl()` (1h TTL for web display, 7-day TTL for Facebook photo posts) |
| Notifications producer (session 26) | `src/lib/notifications.ts` | `enqueueNotification()` — non-blocking owner-recipient insert into `notification_queue` (jag_core); RLS via `withOwnerRLS(corePool, recipient,...)`; `NOTIFY_OWNER_USER_ID` env (fallback = Robert's id). Wired into expenses `/submit`, maintenance create (P1/P2) + `/check-sla`, enquiries create |
| Notifications endpoints (session 26) | `routes/notifications.ts` | Added `GET /notifications/unread-count` + `PATCH /notifications/read-all` (alongside existing `GET /` + `PATCH /:id/read`) |
| Succession by-id (session 26) | `routes/succession/index.ts` | `GET /succession/documents/:id` — returns full row incl. `storage_path` for download (list view omits it) |

### Vehicle Owner Options (VEHICLE_OWNER_OPTIONS const)
`JAG Holdings`, `JABCO`, `JAG Properties`, `JAG Entertainment`, `JAG Finance`, `Personal — Robert`, `Personal — Brian`, `Personal — Phillip`, `Other`

---
