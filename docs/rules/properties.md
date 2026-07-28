# Properties / tenancy rules

> Split out of CLAUDE.md. Read this before touching leases, tenants, receipts, or the tenancy chain.

### Landlord identity on tenant-facing documents (session 40)
Tenancy agreements and receipts are legally with **Robert Johnson-Attin personally**, not "JAG Properties" as an entity — the lease PDF (`lib/lease-pdf.ts`) has always named him as Landlord. Receipts (rent + deposit, both PDF/HTML and WhatsApp text/templates) must show a "Landlord: Robert Johnson-Attin" line — the JAG Properties brand/logo can stay as the header, but the legal party must be named. Any new tenant-facing document (new receipt type, new template) should follow this pattern from the start.

### Tenant record — full tenancy-chain linking (session 44)
Robert asked why a deposit taken right after application approval (before a lease existed) wasn't sending its receipt or showing under the Tenant record. That one question turned into a systematic sweep — asked "check the same gap" module by module across the whole tenancy flow — and the same underlying gap recurred independently in **seven** record types, each needing a slightly different fix depending on whether the data link existed at all:

**No `tenant_id`, no reliable FK path at all (needed a migration + creation-time resolve):**
- **Deposits (`prop_deposits`)** — only resolved to a tenant via `lease_id -> prop_lease_agreements.tenant_id`, so a deposit recorded before a lease existed couldn't send its WhatsApp receipt (`deposits.ts` only looked up an ACTIVE lease's phone) or appear anywhere on the Tenant record. **Fix (migration 052):** added `application_id` + `tenant_id`. `POST /properties/deposits` now accepts `application_id`, resolves the WhatsApp recipient from the application's `full_name`/`phone` first (available immediately on APPROVED, no lease needed) falling back to an active lease, and sets `tenant_id` immediately if `lease_id` is given. Frontend deposit form gained a "From Approved Application" picker.
- **Applications (`prop_applications`)** — `create-tenant` only ever read FROM the application, never wrote a link back, so the trail dead-ended the moment the tenant existed. **Fix (migration 053):** added `tenant_id`, backfilled by `create-tenant`; `GET /properties/applications` gained a `tenant_id` filter.
- **Maintenance tickets (`prop_maintenance_tickets`)** — had a nullable `lease_id` but the **frontend form never actually sends it** (`PropertiesMaintenancePanel.tsx` has zero `lease_id` references), so relying on it the way deposits was fixed wouldn't have worked. **Fix (migration 054):** added `tenant_id`, resolved from `lease_id` if given, else from the unit's active lease at ticket-creation time — `unit_id` is the reliable field (required unless the ticket is building-wide with no unit).
- **Handover checklists (`prop_handover_checklists`)** — had an optional `lease_id` that the frontend *does* collect via a picker (unlike maintenance tickets), but it's optional, and **no general list route existed at all** — only `GET /unit/:unitId`. **Fix (migration 055):** added `tenant_id`, resolved the same way as maintenance tickets (`lease_id` if given, else unit's active lease); added `GET /properties/handover?tenant_id=` from scratch.

**`lease_id NOT NULL` already — data link intact, just missing a query + UI (no migration needed):**
- **Leases (`prop_lease_agreements`)** — every route was nested under `/:propertyId/leases` — no way to query "this tenant's leases" without already knowing the property. **Fix:** new `GET /properties/leases?tenant_id=`.
- **Renewal notices (`prop_renewal_notices`)** — `GET /properties/renewals` took no query params at all. **Fix:** added `tenant_id` filter (join through `lease_id`). **Bonus bug found in the same query:** it referenced a nonexistent `l.rent_amount_ttd` column (real column is `monthly_rent`) — same recurring typo already documented once in `listing.ts` — meaning the Renewals panel had likely been 500ing on every load. Fixed the column name in the backend query and the two frontend reads that used it.
- **Rent schedule (`prop_rent_schedule`)** — list route already supported `lease_id`/`unit_id`/`status`/`year` filters, just not `tenant_id`. **Fix:** added `tenant_id` filter (join through `lease_id`).

**Backfill on lease creation:** `POST /:propertyId/leases` now backfills `tenant_id` (and `lease_id` where relevant) onto any pre-existing deposit, maintenance ticket, or handover checklist on that unit with `tenant_id IS NULL` — covers records created the old way, before a lease was on file.

**Frontend:** `TenantsPanel.tsx` gained eight per-tenant buttons/modals total — **Docs, Deposits, Leases, Applications, Maintenance, Renewals, Handover, Rent** — same modal pattern each time (fetch by `tenant_id`, status-color badge, print-receipt/download link where applicable).

**Pattern worth remembering:** when a new soft-linked record type is added to the tenancy flow, check three things up front rather than finding them one at a time — (1) does it carry a durable FK back to the tenant (or a *reliable* chain to reach one — a nullable, frontend-uncollected `lease_id` doesn't count), (2) is there an API query scoped by that FK, (3) is there a Tenant-record UI surface for it. This recurred independently in 7 of 7 record types checked.

### Flat `/properties/*` routes must be mounted from index.ts (session 50)
`routes/properties/properties.ts` declares `GET /:id`. Express matches router layers in
registration order, so **any flat route declared in that file below `GET /:id` is dead** —
the request is captured by `/:id`, fails `UUIDParam.safeParse`, and returns
`422 VALIDATION_ERROR`. This is not theoretical: session 44's `GET /properties/leases` was
added at the bottom of `properties.ts` and never worked once. The frontend's `api.get`
throws on `!res.ok`, React Query's `data` goes undefined, the `= []` default renders, and
the user sees "No leases on file for this tenant." — a broken endpoint wearing an empty
state's clothes.

**Rule:** a new flat `/properties/x` route goes in its own file and is mounted in
`routes/properties/index.ts` above `propertiesRouter.use('/', propRoutes)`, alongside the
tenancy routers. The comment there already says this; obey it. `review-queue`, `arrears`
and `lease-expiry` are safe only because they happen to sit above `GET /:id` in the file.

**Corollary for UI:** never render the same message for "loading", "request failed" and
"genuinely empty". `components/properties/TenantSectionState.tsx` is the shared component
for this — an error shows the error, an empty section says *why* it is empty.

### Tenant links must not be routed through the lease (session 50)
Migrations 052–055 gave deposits/tickets/handover a `tenant_id`, but the resolution paths
all assumed a lease or an application existed. With the portfolio between tenancies (every
unit VACANT, all leases EXPIRED) the unit-`ACTIVE`-lease lookup resolved to null for every
record, so real deposits sat unattached and invisible on the tenant record. Deposits and
maintenance tickets now accept an explicit `tenant_id` from the form (resolution order:
explicit → `lease_id` → `application_id` → unit's most relevant lease, ACTIVE preferred
then most recently started). Migration `063` backfilled the historical rows.

**When adding any tenancy record type: give the form a way to name the tenant directly.**
Deriving it from a lease is a convenience, never the only path.

### Rent has one source of truth: `prop_rent_schedule` (session 50)
`prop_rent_payments` and `prop_rent_schedule` were two parallel rent systems with separate
record-payment endpoints and separate receipt numbering, neither writing to the other —
rent recorded in Tenancy Ops → Rent did not move the Dashboard arrears figure, which reads
`prop_rent_payments`. Consolidating onto `prop_rent_schedule` under STD-13. Until the
contract step drops `prop_rent_payments`, treat `prop_rent_schedule` as authoritative and
do not add new readers of `prop_rent_payments`.

### Phone is the join key for anything that predates the tenant record (session 51)
`prop_enquiries` and `prop_viewings` carry **no `tenant_id`** — they exist before a tenant
record does, and nothing back-fills a link when the tenant is finally created. The
prospect's phone number is the only join available.

Phones are stored in whatever format they arrived in: `prop_enquiries.prospect_phone` holds
both `18682912786` and `251-6802` in real data, and tenants are typed by hand as
`+1-868-…`. **Never match phone numbers with `=`.** `GET /properties/enquiries?phone=`
compares the last 7 digits of each side
(`right(regexp_replace(prospect_phone,'\D','','g'), 7)`) — 7 is the T&T local subscriber
number, specific enough to identify a person and short enough to survive a missing country
or area code. A shorter input matches nothing rather than everything.

WhatsApp is the other direction of the same problem: `prop_whatsapp_messages` stores the
E.164 digits Meta sent (`18682912786`) and `GET /wa-inbox/:phone` matches
`from_number`/`to_number` **exactly**, so a tenant phone must be normalised before it is
used as a thread key — see `waNumber()` in `components/properties/TenantDetail.tsx`
(7 digits → prefix `1868`, 10 → prefix `1`, 11 already E.164). Without it every tenant's
Messages tab renders an empty thread that looks like "no messages" rather than "wrong key".
That empty state deliberately prints the number it searched, so a future mismatch is
diagnosable instead of silent.

### Lifecycle state is derived, and "unknown" is not "not yet" (session 51)
Nothing in the schema records where a tenant sits between enquiry and handover.
`deriveLifecycle()` in `components/properties/TenantTimeline.tsx` computes it from records
the detail pane has already fetched — it adds no queries and stores nothing, so it cannot
drift from the data.

It distinguishes four step states, and the fourth is the point: `UNKNOWN` means the
evidence is unreachable (no phone on file, so we cannot tell whether this person enquired),
which is **not** the same as `PENDING` ("hasn't happened yet"). Collapsing the two would
state a guess as a fact — the same failure as rendering loading, failed and empty with one
shared message, which is what hid the dead `GET /leases` route for six sessions.
