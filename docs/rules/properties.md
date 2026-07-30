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

**Third instance, session 52:** `GET /properties/units` hit the same trap by construction and
was mounted correctly from the start (`routes/properties/units-list.ts`). Two things that make
this one safe to copy: mounting `propertiesRouter.use('/units', unitsListRouter)` above
`propRoutes` does **not** break the pre-existing `POST /units/alert-stale` or `/units/:id`
listing routes registered further down, because the new router declares only `GET '/'` and
everything else falls through; and multi-segment paths like `/units/:id/photos` were never at
risk from `/:id` in the first place — only single-segment ones are.

### "A row exists" is not "the thing happened" (session 52)
Robert opened Tenant 360 and saw a **13 July handover that has not happened**. The lifecycle
timeline marked the step DONE because a `prop_handover_checklists` row existed, and labelled it
with that row's `created_at` — i.e. the day the checklist was *drafted*, rendered as the day the
tenant took possession. The table has had `completed_at`, `tenant_signed_at` and
`manager_signed_at` since migration 018; the timeline read none of them.

The same defect sat one step earlier and nobody had hit it yet: `latest_viewing_at` is
`max(v.scheduled_at)` over **all** `prop_viewings` rows regardless of `status`, so a viewing
booked for next week — or one already `CANCELLED` / `NO_SHOW` — marked Viewing as done.
`enquiries.ts` now also returns `completed_viewing_at` (`status = 'COMPLETED'` only); they are not
interchangeable, and anything asserting a viewing *happened* must read the completed one.

**Rule:** before a derived step claims something is done, find the column that records
*completion* and read that. If the table has no such column, the step cannot be marked done —
show the draft/booking with a label that says so ("checklist started 13 Jul", "booked 4 Aug")
rather than a bare date, because a bare date under a step reads as the date it completed. Same
family as `UNKNOWN` vs `PENDING` and the utilities-scoring rule below: the timeline is only worth
having if every mark on it is evidence, not inference.

### Do not score a field whose "unset" is indistinguishable from its default (session 52)
`UnitsPanel`'s listing-readiness column scores photos, description and rent — not utilities.
`wasa_included`, `electricity_included` and `internet_included` are `BOOLEAN DEFAULT FALSE`
(migration 022), so "this unit does not include WASA" and "nobody has filled this in yet" are
the same stored value. A ✗ there would look like a fact and be a guess. Same rule as the
Tenant 360 timeline's `UNKNOWN` vs `PENDING`. Before adding a field to any completeness or
readiness score, check whether its schema can actually represent "not answered".

### Properties tab ids are a public contract (session 52)
`?tab=` on `/properties` is consumed by the notification bell, WhatsApp deep links and
whatever Robert has bookmarked. Renaming a tab id without an alias silently drops every one
of those callers onto the default tab — a failure with no error message. `pages/Properties.tsx`
carries `LEGACY_TAB_IDS` + `resolveTab()`; add an entry there whenever an id changes, and note
that it must be applied both at mount **and** inside the `?tab=` `useEffect`, since a deep link
can arrive while the page is already open.

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

### Creating a lease does NOT create its rent schedule (session 52)
`prop_rent_schedule` rows are only ever written by `generateRentSchedule()`, and nothing
calls it on lease creation. Its callers are `renewals.ts` (on renewal) and — since session
52 — the **Generate Rent Schedule** button on the lease row in property detail → Leases.
Before that button existed there was no UI path at all, and a signed, active, ACTIVE-status
lease with an empty schedule looked completely normal from every screen while silently
producing no reminders, no arrears and no dashboard figure. **When a lease is created by
any route, check the schedule exists.** The generator is idempotent
(`ON CONFLICT (lease_id, period_year, period_month) DO NOTHING`), so re-running it is the
cheap way to be sure. Note also that `GET /properties/rent-schedule` filters by
`lease_id` / `unit_id` / `tenant_id` / `status` / `year` but **not by property** — a
per-property view has to fan out per lease.

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

### Two intake paths into prop_property_tenants, only one links the application (session 2026-07-30)
`POST /applications/:id/create-tenant` creates a tenant and backfills `prop_applications.tenant_id`.
`POST /properties/tenants` (the "+ Add Tenant" button, `tenants-mortgage.ts`) is a second, fully
independent path into the same table that never looked at `prop_applications` — so a tenant added
by hand for someone who already has a real, approved application on file showed up with "0
applications" and a Tenant 360 timeline permanently stuck on Application/Approved, exactly the
"row exists is not the thing happened" failure mode, just inverted: the thing *had* happened and
the row *didn't* exist where the derivation looked. **Fixed:** `POST /properties/tenants` now
searches `prop_applications` for an unlinked row matching the new tenant's phone (last-7-digit
match — same rule as the enquiries `?phone=` filter below, since phone formats are inconsistent
across intake paths) and links it on create. This only fixes new tenants; a one-time backfill was
needed for tenants already added before the fix. **When adding any second way to create a record
that another flow already links elsewhere, check whether the new path needs the same linking —
this is the third time in this file a soft-linked record type has skipped its link (see the
application/tenant-chain sweep above).**

### resolveOwnerContext() picks the wrong "Owner" if a stale test account exists (session 2026-07-30)
Cron jobs (`jag-cron-service` client) and the auditor portal (Wife's login) both authenticate as
someone other than Robert, then need to borrow his real owner scope — `middleware/auth.ts`'s
`resolveOwnerContext()` does this by picking "the first active user with an active Owner role,
ordered by `created_at`". A leftover test fixture, `testuser@jag.test`, was still `is_active =
true` with an active Owner role and had been created ~90 seconds before Robert's real account —
so every cron-authenticated request (`send-reminders`, `send-reminders-d1`, `send-missed-d1`,
`queue-arrears-escalation`, and anything else on that path) was silently scoped to an owner_id
that owns nothing. No errors anywhere: the SQL was valid, just scoped to the wrong tenant, so
every batch endpoint returned `{sent: 0}` and looked like it was working. **This is not something
`docs/rules/db-rls.md` catches** — RLS did exactly what it was told; the bug was upstream, in
which identity got handed to RLS. **Fix:** deactivate stray test users the moment they're found
(`UPDATE users SET is_active = false`), and restart `jag-api` — `ownerContextCache` has a 5-minute
TTL and won't self-correct faster than that. **There must only ever be one `is_active = true` user
with an active Owner role in `jag_core`** — if a second one is ever created (test fixture, a
future co-owner before succession activation, anything), this function silently breaks for every
cron job and the auditor portal simultaneously, with no error to signal it.

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
