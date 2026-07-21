# JAG Integrated Business Platform — Claude Session Context

**Owner:** Robert Johnson-Attin | Barataria, Trinidad & Tobago
**Architecture:** v1.9 | **Current Phase:** ALL PHASES COMPLETE — in production | **Updated:** 2026-07-21 (session 44)

---

## PLATFORM STATUS

| Phase | Scope | Status |
|---|---|---|
| 0–5 | Infrastructure, all backend modules, security hardening | **COMPLETE** |
| 6 | Oracle Cloud production deployment, HTTPS auth | **COMPLETE** |
| 7 | React frontend (`jag-web/`) | **COMPLETE** |

**Production endpoints:**
- API: `https://api.jagcorporate.com/health/ready` → `{"status":"ready"}`
- Auth: `https://auth.jagcorporate.com`
- VM SSH: `ssh -i ~/.ssh/jag_oracle2 ubuntu@150.136.151.64`

---

## THREE GOLDEN RULES

1. **Enter Once** — no data entered twice across any module
2. **Same Language** — all inter-module communication uses the same data structures and APIs
3. **You Own Everything** — self-hosted, no vendor lock-in, no SaaS dependency

---

## TECH STACK (ALL LOCKED)

| Component | Choice |
|---|---|
| Database | PostgreSQL 18, five logical DBs, RLS + pgcrypto |
| Backend | Node.js / TypeScript strict mode |
| Containers | Docker + Docker Compose |
| Web server | Caddy + Let's Encrypt + Cloudflare DNS-01 wildcard certs |
| Auth | Keycloak 26.x (self-hosted), realm: `jag`, client: `jag-api` |
| Object storage | MinIO (self-hosted) |
| Frontend | React 18 + TypeScript + Vite + TailwindCSS + React Query + Keycloak JS adapter + react-i18next (en / zh-CN) |
| AI | Ollama on main Windows workstation (NOT Dell Inspiron) |
| Observability | Loki + Grafana, 14-day retention, structured JSON logs |
| Migrations | node-pg-migrate on all five databases |

**Five logical databases:** `jag_core` / `jag_commercial` / `jag_entertainment` / `jag_family` / `jag_properties`

---

## ENGINEERING STANDARDS — APPLY TO ALL CODE (STD-01 through STD-13)

All are **HARD RULES** unless marked ARCHITECTURE. Violations are build defects, not style preferences.

| ID | Rule | Severity |
|---|---|---|
| STD-01 | **Module Isolation** — modules communicate via JAG Holdings API only; never write directly to another module's DB tables | HARD RULE |
| STD-02 | **RLS First** — tenant isolation enforced at PostgreSQL layer; app-layer filtering is second line of defence | HARD RULE |
| STD-03 | **Test First** — write a failing isolation/security test before coding any data-access feature | HARD RULE |
| STD-04 | **Migration First** — every schema change is a versioned node-pg-migrate file; never run raw SQL on production | HARD RULE |
| STD-05 | **API Versioning** — all endpoints at `/api/v1/`; breaking changes require `/api/v2/` | ARCHITECTURE |
| STD-06 | **Error Envelope** — all API responses: `{ success, data, error, code }`; no raw stack traces to clients | ARCHITECTURE |
| STD-07 | **No Secrets in Code** — all credentials in Oracle Vault / env vars; never in code or Compose files | HARD RULE |
| STD-08 | **Structured Logging** — every log event is JSON: `timestamp, entity, action, user_id, tenant_id, severity` | ARCHITECTURE |
| STD-09 | **TypeScript Strict** — `strict: true` in tsconfig.json; no `any` types | ARCHITECTURE |
| STD-10 | **Input Validation** — all API inputs validated with Zod schemas server-side before touching DB | HARD RULE |
| STD-11 | **Idempotent Financial Ops** — all financial writes carry idempotency keys; duplicate delivery never double-posts | HARD RULE |
| STD-12 | **Deploy Gate** — production only via automated deploy script; tests pass + migrations run + Robert sign-off | HARD RULE |
| STD-13 | **Expand-and-Contract Migrations** — columns/tables never renamed or dropped in a single cycle; use 5-step pattern | HARD RULE |

### STD-13 Five-Step Pattern (Expand-and-Contract)

| Step | Migration | Code |
|---|---|---|
| 1 — Expand | ADD new column (old stays) | No change |
| 2 — Dual-write | None | Write to BOTH columns |
| 3 — Backfill | Copy old → new for existing rows | No change |
| 4 — Read switchover | None | Read from new column only |
| 5 — Contract | DROP old column | No change |

---

## CRITICAL IMPLEMENTATION RULES (learned from prior phases)

### PostgreSQL session variables
```sql
-- ALWAYS:
SELECT set_config($1, $2, true)
-- NEVER:
SET LOCAL x = $1  -- PostgreSQL does not allow parameterised SET statements
```

### Keycloak 26 user attributes
Custom attributes **MUST** be declared via `PUT /admin/realms/jag/users/profile` **BEFORE** setting them. KC26 silently drops undeclared attributes (returns HTTP 204 but does NOT persist). The Attributes tab is hidden for admin-only attrs — always use REST API.

### Finance RLS
- `jag_family` uses `withOwnerRLS` (`app.current_owner_id`), not tenant-scoped
- `jag_properties` uses `withOwnerRLS` (`app.current_owner_id`), NOT `withTenantRLS` — `prop_properties` has NO entity/tenant column
- `fin_fx_rates` is a shared reference table — any non-null `current_owner_id` grants access
- `fin_net_worth_snapshots.net_worth_ttd` is a `GENERATED` column — never set it manually
- CONSOLIDATED pseudo-entity UUID: `00000000-0000-0000-0000-000000000000`
- `property_assets_ttd` is populated by cross-DB queries to `commercialPool` (IMS) and `propertiesPool` (Properties)
- Properties snapshot uses ONE `withOwnerRLS` call — all property value attributed to JAG_PROPERTIES entity (`00000000-0000-0000-0001-000000000003`)

### PostgreSQL GUC session-level empty string — CRITICAL
Custom `app.*` GUC parameters revert to `''` (empty string) **not NULL** at session level after a transaction that set them commits. If a pool connection previously ran `withOwnerRLS` (which sets `app.current_owner_id`), the next `withTenantRLS` call on the SAME connection will see `app.current_owner_id = ''`. Then `current_setting('app.current_owner_id', true)::uuid` throws `invalid input syntax for type uuid: ""`.

**Rules:**
1. Always use `NULLIF(current_setting('app.xxx', true), '')::uuid` in RLS policies — never raw `current_setting(...)::uuid`
2. Always use the correct RLS wrapper for each database: `withTenantRLS` for `jag_commercial`/`jag_entertainment`/`jag_core`; `withOwnerRLS` for `jag_family`/`jag_properties`

### Insurance consolidation — single source of truth (session 28)
`fin_insurance_policies` (jag_family) is the **only** insurance table. There is no `prop_insurance` table and no insurance columns on `ims_vehicles`.

- **Linking policies to assets:** `insured_asset_ref UUID` is a soft cross-DB reference (no FK per STD-01). Set to `property.id` for property insurance, `vehicle.id` for vehicle insurance.
- **`insured_asset_type`:** ENUM (`PROPERTY`, `VEHICLE`, `OTHER`) — always set when `insured_asset_ref` is provided.
- **Per-section UI:** Properties Insurance tab and Vehicles 🛡 Insurance tab both query `GET /finance/insurance/policies?insured_asset_ref=<id>`. Finance Insurance shows all policies (no filter).
- **Policy types available:** PROPERTY, VEHICLE, LIABILITY, LIFE, HEALTH, BUSINESS_INTERRUPTION, MARINE, PROFESSIONAL_INDEMNITY, SURETY_BOND, PERFORMANCE_BOND, BUILDING, CONTENTS, FLOOD, FIRE, COMPREHENSIVE, OTHER.
- **`sub_type`:** optional free-text refinement (e.g. "All-risks", "Third-party only", "TWOC").
- **`coverage_amount` and `premium_amount` must be positive** (Zod `.positive()`) — never pass 0; frontend defaults to 1 when blank.
- **Frontend `AddPropertyInsuranceModal`** and **`VehicleInsuranceTab`** both use plain `async/await` (not `useMutation`) to ensure errors surface — `useMutation` with `onError` was silently swallowing errors in this codebase.

### response.ts dual-mode helpers
`ok()` and `err()` in `src/lib/response.ts` support **two calling conventions**:
- Old routes (most of codebase): `ok(res, data, status?)` → sends response directly
- New tenancy routes: `ok(data)` → returns `{success:true, data}` envelope for `res.json(ok(data))`
- Old: `err(res, status, code, message)` → sends response
- New: `err(message, code)` → returns envelope for `res.status(N).json(err('msg','CODE'))`

Detection at runtime: first arg is a `Response` if it has a `.json` function; first arg is a `string` → new-style `err`. Both compile cleanly via TypeScript overloads. When writing new routes, use the **new style** (single-arg `ok` / two-arg `err`) — it is cleaner.

### node-pg numeric types
PostgreSQL `numeric` / `decimal` columns arrive in Node.js as **strings**, not numbers. Always wrap with `parseFloat(String(value ?? 0))` before arithmetic — using `+` on two pg numeric values concatenates strings instead of adding numbers.

### Investment FX conversion rule — CRITICAL
`fin_investments.current_value_ttd` is **always stored in TTD** — never in native currency.

- **DB → display (native):** `nativeValue = ttdValue / rateMap[currency]` (divide)
- **Form entry → DB (save):** `ttd = enteredNativeValue * rateMap[currency]` (multiply)
- **Aggregating totals:** sum `parseFloat(current_value_ttd)` directly — **never** multiply by rateMap again
- `rateMap['TTD'] = 1` so TTD-denominated holdings always pass through unchanged

Violations cause silent inflation: a $5M TTD investment stored correctly in the DB would display/total as ~$33.8M when mistakenly multiplied by the USD rate (6.77).

### IMS valuation — stock vs fixed assets
`GET /ims/valuation` returns two separate sums. The correct SQL (in `routes/ims/items.ts`):
- `total_stock_value` = `SUM(qty * unit_value) WHERE is_asset IS NOT TRUE` — consumable inventory only
- `total_asset_value` = `SUM(qty * unit_value) WHERE is_asset = true` — fixed assets only

Never let items appear in both sums. The previous bug counted `is_asset = true` items in both totals (fixed 2026-06-17).

### GPS vehicle tracking — self-hosted Traccar (sessions 27–29, fully live 2026-06-26)
GPS for the vehicle fleet (TKSTAR units: TK918-4GSA / TK905B-4G / JTK905B-4G, plus a Q8) is delivered by a **self-hosted Traccar** container — NOT a column of lat/lng in jag_commercial. **Traccar is the source of truth** for positions/history/geofences/events; **jag-api is a thin proxy** over Traccar's REST API (`src/lib/traccar.ts`). Devices report **directly** to Traccar over the internet, so a JAG-app outage never stops collection — Traccar's own UI (`traccar.jagcorporate.com`) + the **Traccar Manager** phone app are an independent fallback.
- **TWO PROTOCOLS IN THE FLEET (learned empirically at cutover) — model determines protocol, port, AND uniqueId format:**
  - **TK905B-4G / JTK905B-4G → JT808** (`7e…7e` binary) → Traccar **`jt808`** decoder (container port **5015**), published as **host 5013 → container 5015**. uniqueId = **12-digit ZERO-PADDED** (serial `9590028504` → **`009590028504`**). SMS devices `adminip123456 <ip> 5013`.
  - **TK918-4GSA → watch** (`[SG*serial*len*UD2,…]` text) → Traccar **`watch`** decoder (container port **5093**), published as **host 5023 → container 5093**. uniqueId = **BARE serial** (`9189000796`, NO padding). SMS devices `adminip123456 <ip> 5023`. TK918s give valid fixes + correct clock (better than the TK905B).
  - **Q8 → gt06** (deferred; no SIM yet) — will need a 3rd open port (gt06 default 5023 is currently repurposed for watch).
  - Register the uniqueId in the EXACT format above or Traccar logs `WARN: Unknown device <id>` and stores nothing. JAG links by Traccar's numeric `traccar_device_id`, not the serial string.
  - **Do NOT use Traccar `HUABAO_PORT`/`H02_PORT` env overrides** — they bind-conflict (`Address in use`) and silently leave the host port empty. The working pattern is **host→container port remap in `docker-compose.yml` ports** (`"0.0.0.0:5013:5015"`, `"0.0.0.0:5023:5093"`), no protocol env overrides.
- **ALL trackers are battery-powered + sleep when idle** — they only open a data connection (and get a GPS fix) while **moving** with sky view. An `adminip` SMS alone is often NOT enough to bring a parked unit online. So positions are live while a vehicle is driven and last-known when parked; this is the hardware, not JAG. First-position confirmation requires driving a unit outdoors.
- **Data model:** a tracker is a **reusable asset that moves between vehicles** (disposed-vehicle reassignment + spares), so it's modelled as a registry row (`gps_trackers`, migration 036, tenant RLS) with a changeable `vehicle_id` assignment — never a fixed column on `ims_vehicles`. `traccar_device_id` is Traccar's numeric id, captured after the device first connects. `ims_vehicles.sim_number` is left in place (expand-not-drop).
- **Backend:** `routes/ims/vms-gps.ts` mounted at `/` under `/api/v1/ims` (full paths `/vehicles/:id/gps/*`, `/gps/fleet`, `/gps/trackers`). Per-vehicle gps handlers resolve the ASSIGNED tracker → its `traccar_device_id` → Traccar. Geofence WKT is built server-side (`CIRCLE (lat lng, radius)` — **lat lng order** per Traccar). `routes/internal/traccar-event.ts` (Bearer `TRACCAR_EVENT_TOKEN`, Docker-network-only) receives Traccar's event-forward POSTs, maps deviceId→vehicle via a single-tenant lookup (IMS = JAG_HOLDINGS tenant), and calls `enqueueNotification()` → JAG bell.
- **Frontend:** `components/ims/VehicleGps.tsx` — `VehicleGpsTab` (Leaflet + OSM tiles; live marker w/ 20s `refetchInterval`, history polyline, circle-geofence create/delete, events list; assign-tracker picker when none assigned), `FleetMapModal`, `TrackersModal` (registry). Mounted in `pages/Inventory.tsx` Vehicles tab (📍 GPS modal tab + 🗺 Fleet Map / 📡 GPS Trackers toolbar buttons). Markers use `CircleMarker` (SVG) to dodge Leaflet's broken default-icon assets; Caddy jag-web CSP `img-src` extended for `https://*.tile.openstreetmap.org`. UI is English (matches the untranslated VMS modal) — i18n deferred.
- **Infra (LIVE on VM):** `docker-compose.yml` `traccar` service (own `traccar` DB on native PG, owner `traccar_app`; config via `CONFIG_USE_ENVIRONMENT_VARIABLES`; `LOGGER_CONSOLE=true` → logs to stdout/Loki; ports **`0.0.0.0:5013→5015` (jt808) + `0.0.0.0:5023→5093` (watch)**, 8082 web localhost→Caddy). **Oracle Security List opened TCP 5013 + 5023** (done; verified reachable). Native PG `pg_hba.conf` needed a `host traccar traccar_app 172.16.0.0/12 scram-sha-256` rule (Traccar crashed without it). Env in `/opt/jag/jag-infra/.env`: `TRACCAR_DB_URL/USER/PASSWORD`, `TRACCAR_URL/USER`, `TRACCAR_PASSWORD` (admin acct `robertjohnsonattin@gmail.com`, password `JAGFleet`), `TRACCAR_EVENT_TOKEN`. **AVOID restarting Traccar once devices are connected** — battery units back off and won't reconnect until they next move. **Cutover is a re-point, not a data migration** — devices report to ONE server, so repointing kills the Winnies app; past mytkstar history doesn't migrate. Full procedure: `jag-infra/traccar/RUNBOOK.md`. **Status 2026-06-26 (session 29):** ALL 5 SIM devices live — PDZ 7719/PBH 2854/TDM 9497/PDT 761(spare) reporting; TEF 5411 battery depleted mid-cutover (plugged to charge, will auto-reconnect). TK918s report 1–5s when moving (real-time routes); TK905B (PDZ 7719) reports ~30–60 min heartbeat only — pending `upload123456 30` + `sleep123456 1` + `dormancy123456 3600` SMS after trial runs. **CRITICAL — TRACCAR_PASSWORD sync:** if the Traccar UI admin password is ever changed, MUST also update `TRACCAR_PASSWORD` in `/opt/jag/jag-infra/.env` and run `docker compose up -d --force-recreate api` — a mismatch causes all GPS proxy calls to silently fail with 401. **History tab:** `FitBounds` component in `VehicleGps.tsx` auto-zooms map to route extent on history load; polyline weight 3→5 (commit `487558d`).

### React date inputs — PG DATE/TIMESTAMP values
PostgreSQL `DATE`/`TIMESTAMP` columns may arrive from the API as ISO datetime strings (`'2025-12-31T00:00:00.000Z'`). A browser `<input type="date">` cannot display ISO datetime format — it shows empty placeholder but still submits the full string, failing Zod's `^\d{4}-\d{2}-\d{2}$` regex.

**Always** initialize date-input state by slicing to 10 chars and guard on submit:
```tsx
// CORRECT
const [maturity, setMaturity] = useState(inv.maturity_date ? inv.maturity_date.slice(0, 10) : '')
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// in mutationFn:
maturity_date: (maturity && DATE_RE.test(maturity)) ? maturity : undefined,
```
Apply to every date field: `purchase_date`, `maturity_date`, `expiry_date`, `as_of_date`, etc.

### Displaying date-only values — never `new Date(iso).toLocaleDateString()`
Same underlying PG DATE-as-ISO-string issue as above, but on the *display* side. `new Date('2026-09-30')` parses the string as **UTC midnight**; `.toLocaleDateString()` then renders that instant in the browser's local timezone. Trinidad is UTC-4, so the displayed date silently shifts back one day (shows "29 Sept" for a DB value of "2026-09-30") — no error, easy to miss. Passing an explicit `timeZone` option does **not** fix this — it just makes the same wrong shift deterministic. Found 2026-07-06 in the shared `fmtDate()` helper (`jag-web/src/lib/entities.ts`) plus 10 duplicated local helpers across CRM/DocVault/DragonBridge/Entertainment/Family/Inventory/JABCO/NLCB/Purchasing/Succession — all fixed same session.

**Always** parse the Y/M/D components directly instead of letting `Date()` interpret the string:
```tsx
// WRONG — shifts back a day in Trinidad's timezone
new Date(iso).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' })

// CORRECT
const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
new Date(y, m - 1, d).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' })
```
**Do NOT apply this to real timestamps** (`created_at`, `updated_at`, `paid_at`, `last_modified_at`, event `starts_at`/`ends_at`) — converting a genuine instant to local time via plain `new Date(iso).toLocaleDateString()` is correct there. If one helper is shared between date-only and timestamp fields, split it into two (e.g. `fmtDate` for timestamps, `fmtDateOnly` for date-only) rather than fixing it in place — check the column type in the migration file before deciding which side a field is on. Same fix applies to month/year-only formatters (e.g. depreciation `period_start`/`period_end`) — a value like `'2026-10-01'` shifted back to Sept 30 local would show the wrong *month*, not just the wrong day.

### Mobile responsive patterns (Tailwind)
No separate mobile app — the React + Tailwind stack handles all screen sizes. The shell (AppShell.tsx) is already mobile-aware (hamburger menu, slide-over sidebar). Rules for all new components:

- **Grid layouts on main pages**: always add a mobile breakpoint — `grid-cols-1 sm:grid-cols-3` not bare `grid-cols-3`; `grid-cols-2 sm:grid-cols-3 md:grid-cols-5` for 5-column KPI strips
- **Table wrappers**: use `overflow-x-auto rounded-lg border border-slate-700` not `overflow-hidden` — the horizontal scroll is the correct mobile behaviour; `overflow-hidden` traps wide tables
- **Master-detail layouts** (list sidebar + detail panel): use mobile toggle pattern — list is `${selected ? 'hidden md:flex' : 'flex'} w-full md:w-64`, detail is `${!selected ? 'hidden md:block' : 'block'} flex-1`. Add a `md:hidden` back button at top of detail pane using `t('common.back')` (`← Back` / `返回` — key exists in both locale files)
- **Form grids inside modals**: `grid-cols-2` is fine at modal width (~380px) — do not add breakpoints to modal-internal form field pairs

### Auth-gated streaming assets — cannot be bare `<img src>` / `<a href>` (session 26)
`requireAuth()` is **header-only** (Authorization: Bearer; no cookie/query fallback). Any backend route that **streams bytes** behind `requireAuth()` (e.g. `GET /ims/items/:id/photos/:photoId/download` via `stream.pipe(res)`, or `/files/download`) **cannot** be used as a bare `<img src="/api/v1/...">` or `<a href>` — the browser-native request carries no Bearer header → **401, asset never loads**.
- **Images:** use `<AuthedImg path={...} />` (`jag-web/src/components/AuthedImg.tsx`) — fetches via `api.objectUrl()` (Bearer fetch → blob object URL), renders it, revokes on unmount.
- **Downloads:** use `api.download(path, fileName)` (DocVault, Succession, `filesApi.download()` already do this).
- Both helpers live in `jag-web/src/api/client.ts`. `path` is **BASE-relative** (no `/api/v1` prefix — the helper prepends it). API helpers returning such URLs (e.g. `imsApi.photoDownloadUrl`) must return the BASE-relative path.
- **Exception:** MinIO **presigned GET URLs** (`getPresignedGetUrl()`, e.g. property/unit photos) are self-authenticating and DO work as a bare `<img src>` — leave those alone.
- **Viewing/printing HTML** (not a download, no filename): use `api.openHtml(path)` (session 40) — fetches with the Bearer token, opens a blank tab synchronously on click (avoids the popup blocker), then navigates it to the blob URL. Found broken in the Rent Schedule "Receipt" link (`<a href="/api/v1/...">`) — silently 401'd for months since nothing surfaced the failure to Robert. Same class of bug as the image/download case above; check for it whenever a receipt/report link opens in a new tab.

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

### In-app notifications (session 26)
`notification_queue` (jag_core, user_id RLS) is fed by `enqueueNotification()` in `jag-api/src/lib/notifications.ts` — owner-recipient by default (`NOTIFY_OWNER_USER_ID` env, fallback = Robert's jag_core users.id), **non-blocking** (try/catch + `logger.warn`; always call as `void enqueueNotification(...)`). RLS insert works because `withOwnerRLS(corePool, recipient, ...)` sets `app.current_user_id` = recipient (the `user_isolation` USING clause doubles as the INSERT WITH CHECK under FORCE RLS). **Live producers (4):** expense submit (tier 1), P1/P2 maintenance ticket create (tier 1), maintenance SLA breach in `/check-sla` (tier 1), new tenancy enquiry (tier 2). API: `GET /notifications/unread-count`, `PATCH /notifications/read-all` (plus pre-existing `GET /` + `PATCH /:id/read`). Frontend: `NotificationBell` in AppShell (sidebar desktop + mobile top bar, 60s badge poll). **Deferred producer:** document/bank-statement → REVIEW (set by external Ollama batch `scripts/ollama-batch/index.ts`, no API hook).

### Beneficial-ownership cap table (session 26)
`fam_ownership_stakes` (jag_family, migration 017, owner RLS) records **who beneficially owns what**, with % shares — covers business entities (e.g. BAR+Club registered solely under Zhanghua) AND personally-held assets. One row = a family member owns N% of a `subject_kind` ∈ `ENTITY|PROPERTY|ITEM`:
- `ENTITY` → `subject_id` is an `owner_entity_id` UUID (tenant 001-007 or personal finance entity 008-013).
- `PROPERTY` → `prop_properties.id` (jag_properties, soft ref). `ITEM` → `ims_items.id` (jag_commercial; vehicles are items with `is_asset=true`).
- `subject_label` is denormalized (cross-DB, no FK per STD-01).

Routes: `routes/family/ownership.ts` (mounted **2nd** at `/api/v1/family`, after familyRouter — order is fine, no path overlap). `/ownership` CRUD, `/ownership/subjects` (picker: entities constant + properties + is_asset items, cross-DB like net-worth), `/ownership/allocation` (Σ% per subject → flag ≠100%), `/members/:id/holdings` (rollup).

**Rollup math:** ENTITY stake value = `ownership_percent × latest fin_net_worth_snapshots.net_worth_ttd` for that `owner_entity_id`. PROPERTY/ITEM stake value = `% × current_valuation`/`unit_value`. **So entity values require a fresh net-worth snapshot** — entities with no snapshot attribute 0 until Finance → Net Worth → Take Snapshot is run.

**CRITICAL — net-worth double-count guard:** `routes/finance/net-worth.ts` reads `fam_ownership_stakes` up front and **excludes** any `prop_properties`/`ims_items` row that has a direct PROPERTY/ITEM stake from its entity's physical/property sum (`AND NOT (id = ANY($1::uuid[]))`). A directly-owned asset is attributed to the person, not the entity. **Do not remove this exclusion** or directly-owned assets get counted twice (once under their entity, once under the person). Consolidated total stays correct.

Frontend: `pages/Ownership.tsx` (nav `/ownership`) — By Entity (cap-table editor) + By Person (estate rollup); `api/ownership.ts`. Family member modal has an Estate section (lazy `/holdings`).

### Dashboard query limits
`jag-web/src/pages/Dashboard.tsx` requests properties with `limit: 100` (backend max is 500 per `PropertiesQuerySchema`). Never raise Dashboard limit above 500 without also raising the backend Zod schema.

### WebAuthn
`KC_WEBAUTHN_RP_ID` is bound at registration and **cannot be changed**. Run `keycloak-webauthn-setup.sh` with `KC_WEBAUTHN_RP_ID=jabco.tt` before any user registers a device on production.

### Net Worth Snapshot — stale data behaviour
`POST /finance/net-worth/snapshot` upserts on `(owner_id, owner_entity_id, snapshot_date)` — one row per entity per day. If property valuations are edited **after** a snapshot is taken on the same day, the snapshot will be stale. Fix: `DELETE FROM fin_net_worth_snapshots WHERE snapshot_date = 'YYYY-MM-DD'` then retrigger from Finance → Net Worth → Take Snapshot. This happened 2026-06-11: `JAG Properties Management` and `62 Ariapita Avenue` valuations were cleared at 17:19 but snapshot was already taken at 06:36.

### CRITICAL: jag-api Docker deploy pattern
The Dockerfile copies `dist/` (pre-compiled TypeScript) — **NOT** `src/`. Uploading source changes has zero effect on the running container.

**Correct deploy sequence for API changes:**
1. `npm run build:prod` — compile TypeScript locally
2. `scp -r dist/ ubuntu@150.136.151.64:/opt/jag/jag-api/`
3. `docker compose build api && docker compose up -d api` on VM

**Correct deploy sequence for frontend changes:**
1. `npm run build` — Vite build locally
2. `scp -r dist/ ubuntu@150.136.151.64:/opt/jag/jag-web/`
3. No container rebuild needed — Caddy serves static files directly

**deploy.sh** (repo root) — STD-12 deploy gate script handles both. Flags: `--api-only`, `--frontend-only`, `--skip-typecheck`, `--skip-zap`, `--no-commit`, `--no-push`.
Deploy runs **8 steps**: TypeScript compile → frontend build → VM check → **dist + prod_modules/node_modules upload (as of 2026-07-21, both via tar_upload())** → health check → ZAP baseline → frontend upload → **git snapshot (commit + push to off-site backup)**.
Step 6 (ZAP baseline) fires automatically when `ZAP_SCAN_PASSWORD` env var is set; silently skips if unset. Blocks deploy on HIGH-risk findings only.
Step 8 (added 2026-06-24) auto-commits the deployed state and pushes to the private GitHub backup `robertjohnsonattin-cmd/jag-platform` so "deployed" and "saved off-site" always happen together; non-fatal, disable with `--no-commit`/`--no-push`. **Do NOT `set -a; . .env` before any `docker compose` command** — shell env overrides the `.env` file and silently no-ops config changes (force-recreate + verify instead). See [[feedback-compose-env-precedence]].

**`scp -r` on `prod_modules/node_modules` and `dist/` is unreliable — silently stalls, does not error (found session 44, 2026-07-21):** on a `scp -r` of a directory with hundreds of files (283-package `node_modules`, 692-file compiled `dist/`), the transfer can silently die partway — TCP stays `ESTABLISHED`, no error, no timeout, remote byte count just stops growing. Confirmed twice in one session, ~30-40 min each before being caught (checked via `du -sb` on the remote path at two points in time — flat byte count = dead). A single large file over the same link transfers fine in seconds, so it isn't bandwidth — looks like an idle-connection drop during the per-file negotiation gaps that plain `scp -r` doesn't retry or detect. **Workaround: tar the directory into one archive first, `scp` the single file, extract on the VM.** `tar -czf /tmp/x.tar.gz -C <dir> .` then `scp` then `tar -xzf ... -C <dest>` — a 286MB `node_modules` compressed to ~90MB and transferred in ~6 seconds this way, vs. never finishing as `scp -r`. **Gotcha:** `-C <dir> .` tars the *contents* of `<dir>`, not `<dir>` itself — extracting that into the destination's parent will land packages flat instead of nested under `node_modules/`; extract into the actual target directory (e.g. `-C /opt/jag/jag-api/prod_modules/node_modules/`, pre-created), not one level up. If a `docker compose build` step is already running when a transfer looks stuck, verify with `du -sb <remote path>` twice, ~15-20s apart, before assuming it's just slow — flat byte count means dead, kill it and switch to the tar approach rather than waiting longer.

### Google Calendar service account key
The service account JSON key is stored as a file **not** a base64 env var. Base64 encoding through heredoc + docker-compose env chain caused `invalid_grant: Invalid JWT Signature` (silent corruption).

**File location on VM:** `/opt/jag/jag-api/google-calendar-key.json` (read-only, outside the Docker image)
**docker-compose.yml volume mount:** `- /opt/jag/jag-api/google-calendar-key.json:/opt/jag/jag-api/google-calendar-key.json:ro`
**`getAccessToken()`** reads the file via `fs.readFileSync` first; falls back to `GOOGLE_SERVICE_ACCOUNT_KEY` base64 env var if the file is absent.
**Service account:** `jag-api@gen-lang-client-0812561230.iam.gserviceaccount.com` — calendar shared with this address (Editor permission on `robertjohnsonattin@gmail.com` calendar).
**If key needs rotation:** download new JSON from Google Cloud → SCP to `/opt/jag/jag-api/google-calendar-key.json` on VM → `docker compose up -d api` (no rebuild needed — file is mounted, not baked into image).

### RLS and bare-connection UPDATEs — CRITICAL
Any `UPDATE` on an RLS-protected table run on a pool connection **without** first calling `withTenantRLS` (or `withOwnerRLS`) will silently update 0 rows — no error, no warning. This is the correct RLS behaviour but easy to miss in async `.then()` callbacks that acquire a fresh connection after the original RLS context has closed.

**Rule:** always wrap UPDATE/DELETE on tenant-scoped tables in `withTenantRLS(conn, ctx, ...)` even in fire-and-forget callbacks. Capture `req.rlsCtx` before the async boundary so it's available inside the `.then()`.

**Same bug, public-route flavour (session 36):** any route with no authenticated user at all — e.g. the public tenancy booking page (`/api/v1/public/book/:slug`) — is especially prone to this because there's no `req.rlsCtx` to reuse. If it queries on a bare `pool.connect()` with no owner/tenant context set at all, FORCE RLS returns zero rows for every request, not just some — looks identical to "record not found" from the outside. Since JAG is single-owner for `jag_properties`/`jag_family`, the fix is to scope public routes to the known platform owner (`process.env.NOTIFY_OWNER_USER_ID` fallback constant, same one `lib/notifications.ts` uses) via `withOwnerRLS`, never a raw connection.

### MinIO presigned URLs — public vs internal endpoint — CRITICAL (session 36)
`MINIO_ENDPOINT` (`minio`) is the internal Docker-network hostname — correct for server-side operations (`ensureBucket`, `getObjectStream`, `deleteObject`) but **presigned URLs are handed to the browser**, which cannot resolve `minio` at all. Any presigned PUT/GET built against the internal client fails in the browser with a bare `fetch` "Failed to fetch" (upload) or a broken `<img>` (gallery) — no server-side error, so it's easy to ship without noticing until someone actually uploads through the UI. This had silently affected **every** presigned-URL feature (unit listing photos, VMS compliance docs) since they were built.

**Fix:** `jag-api/src/lib/minio.ts` has a second `presignClient` configured against `MINIO_PUBLIC_ENDPOINT` (`storage.jagcorporate.com`, port 443, SSL) — used only by `getPresignedPutUrl`/`getPresignedGetUrl`. Requires: a Caddy site block reverse-proxying `storage.jagcorporate.com` → `minio:9000` (wildcard cert already covers it, but the DNS **A record** still had to be created separately in Cloudflare — DNS-01 challenge doesn't imply a routable record), `MINIO_API_CORS_ALLOW_ORIGIN=https://jagcorporate.com` on the MinIO container (browser PUT is cross-origin, needs CORS preflight to succeed), and the main site's CSP `img-src`/`connect-src` extended to allow the new subdomain. All three pieces are required together — missing any one produces a different failure mode (CORS error, CSP violation, or plain connection refused) that looks unrelated to the other two.

**CORRECTION (2026-07-08, session 39):** despite the above being written up as done in session 36, **none of the three infra pieces were ever actually deployed** — only the DNS record existed. Git history confirms `storage.jagcorporate.com` never appeared in the Caddyfile at any commit; `.env` had the right values but `docker-compose.yml`'s `api` service never wired `MINIO_PUBLIC_ENDPOINT`/`MINIO_PUBLIC_PORT`/`MINIO_PUBLIC_SSL` into the container at all (so `presignClient` silently fell back to the internal client). This was only discovered when a real user actually opened a listing's photo gallery for the first time since session 36 — broken images fail silently (no console error most people notice), so the gap went unnoticed. **A second, previously-masked bug surfaced once the endpoint was fixed:** the `minio` npm SDK's `presignedUrl()` makes an internal `getBucketRegionAsync()` call to auto-detect the bucket's region, and that call failed with an opaque `S3Error` when routed through Caddy's reverse proxy — causing the whole photo-list endpoint to 500 instead of just serving a broken link. **Fix:** pin `region: 'us-east-1'` (MinIO's own default) explicitly on both the internal `minioClient` and `presignClient` constructors so the SDK never makes that network call at all. All three infra pieces (Caddy block, MinIO CORS, CSP) plus the region pin are now actually deployed and verified end-to-end (`curl` against a freshly-generated presigned URL returned `200 image/jpeg`). **Lesson:** a CLAUDE.md "DONE" entry reflects intent at write-time, not necessarily current VM/repo reality — this was the third such gap found in one session (see also Documenso and WhatsApp entries above). Treat "documented as deployed" with some skepticism; verify against actual git history / live container env when a feature that touches infra wiring hasn't been exercised recently.

### OWASP ZAP security scanning
- Scripts: `security/zap-baseline.sh` (passive, ~5 min, deploy gate) and `security/zap-full-scan.sh` (active, ~60 min, manual)
- Auth hook: `security/zap_auth_hook.py` — injects JWT Bearer token + Cache-Control bypass into every ZAP request
- False-positive config: `security/zap-baseline.conf` — 4 Cloudflare-artefact findings documented as INFO (headers confirmed correct via curl from inside ZAP Docker container)
- Reports saved to `security/reports/` (gitignored)
- To run baseline manually: `ZAP_SCAN_PASSWORD=<keycloak-password> bash security/zap-baseline.sh`
- To run full active scan: `ZAP_SCAN_PASSWORD=<keycloak-password> bash security/zap-full-scan.sh`
- KC client secret for ZAP auth defaulted in scripts — override with `ZAP_CLIENT_SECRET` env var if rotated

### Caddy / frontend
- Caddy Caddyfile already has the `jag-web` block
- `docker-compose.yml` Caddy service has volume mount: `/opt/jag/jag-web/dist:/opt/jag/jag-web/dist:ro`
- If Caddy container needs recreating after docker-compose.yml change: `docker compose up -d --force-recreate caddy`
- **Docker overlayfs bind-mount masking (2026-06-13):** If frontend deploys successfully (files in `/opt/jag/jag-web/dist` on host) but site serves 404, the Caddy container's overlayfs layer is shadowing the bind mount. Fix: `docker compose up -d --force-recreate caddy`. Root cause was the image not having the mount path pre-declared — fixed by adding `RUN mkdir -p /opt/jag/jag-web/dist` to `jag-infra/caddy/Dockerfile`.

### MinIO — critical operational notes

**jag_app MinIO user is a separate IAM user, NOT the root user.** It must be created explicitly after any MinIO data wipe or volume loss:
```bash
MINIO_ROOT_PASSWORD=<pw> MINIO_ROOT_USER=jag_minio_admin \
  mc admin user add jagadmin <jag-app-access-key> <secret>
mc admin policy attach jagadmin jag-app-buckets --user <jag-app-access-key>
```

**IAM policy** `jag-app-buckets` restricts jag_app to the 4 authorised buckets only. Recreate with:
```bash
MINIO_ROOT_PASSWORD=<pw> JAG_APP_ACCESS_KEY=<jag-app-access-key> \
  bash /opt/jag/jag-infra/scripts/setup-minio-policy.sh
```

**SSE-S3 encryption** — all 4 buckets auto-encrypt at rest via `MINIO_KMS_SECRET_KEY` (`/opt/jag/jag-infra/.env`, format `jag-sse-key:<base64>`, value ‹SECRETS VAULT›[^secrets]). **Rotating this key is destructive — two hazards:** (1) existing objects can't be decrypted under a new key → must **re-encrypt** (download all objects plaintext while old key active → swap key → re-upload; buckets auto-encrypt on PUT). (2) the swap **wipes the IAM store** (users/policies are KMS-encrypted) → after rotation, recreate the `jag-app-buckets` policy + `jag_app` user (fresh secret) and update `MINIO_SECRET_KEY` in `.env` + restart api. Root user survives (env-based). Done once on 2026-06-24 (see Secrets hygiene). Force-recreate minio after `.env` change (compose shell-override caveat — see [[feedback-compose-env-precedence]]).

**Audit log** — MinIO sends every file operation (PUT/GET/DELETE) to `http://jag-api:3000/internal/minio-audit` via `audit_webhook:loki`. Secured by `Bearer $MINIO_AUDIT_TOKEN`. Events appear in Grafana/Loki under `entity="MINIO_AUDIT"`. Config survives container restarts (stored in MinIO's internal KV).

**Stale statement cleanup** — VM cron at 07:00 UTC (03:00 TT) runs `cleanup-stale-statements.sh`. Deletes PENDING `fin_bank_statement_jobs` older than 7 days + their MinIO objects. Logs to `/var/log/jag-stmt-cleanup.log`.

### Bank statements — Ollama batch pipeline
- Uploaded via Finance → Bank Statements tab (drag-and-drop, multi-file, per-file account assignment)
- Files stored in `jag-bank-statements` bucket; job record in `fin_bank_statement_jobs` (`jag_family` DB)
- Processed by `scripts/ollama-batch/` via Windows Task Scheduler at 02:00 TT; SSH-tunnels to VM on ports 15432→5432 and 19000→9000
- **`DRY_RUN=true`** in `.env.ollama-batch` — flip to `false` after first real statement is uploaded and reviewed
- Batch deletes MinIO object after COMPLETE/PARTIAL/FAILED; manual delete available via Delete button in UI
- Internal API route: `/internal/minio-audit` — NOT under `/api/v1/`; no Keycloak auth; Docker-network-only

### Financial document extraction — two-path architecture
All financial documents (loan statements, investment portfolios, insurance policies) support two extraction paths:

**Path 1 — Cloud upload (browser):** Finance → Documents tab → drag-and-drop → file stored in `jag-documents` bucket → Ollama batch at 02:00 TT extracts data → job status goes to `REVIEW` → Robert reviews extracted JSON in UI → Approve & Import writes to target table → MinIO object auto-deleted. Table: `fin_document_jobs` (`jag_family`). Route: `routes/finance/document-jobs.ts`.

**Path 2 — Local script (hard drive):** `node dist/extract.js --type <loan|investment|insurance|bank-statement> --file "C:/JAG Filing/..."` from `scripts/doc-import/`. Ollama reads the file locally → POST extracted data to API `/import` endpoint → DB written directly. **File never leaves the local machine.** Uses Keycloak ROPC (username+password grant) for auth; token cached with 30s early-expiry buffer. Env: `scripts/doc-import/.env.doc-import`.

**fin_document_jobs table** (`jag_family`) — tracks Path 1 jobs:
- `doc_type`: `LOAN | INVESTMENT | INSURANCE`
- `status`: `PENDING → PROCESSING → REVIEW → APPROVED | FAILED`
- `extracted_data JSONB` — Ollama output stored here until approved
- `target_record_ids UUID[]` — IDs of records created in target table on approval
- RLS: `owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid`

**Path 2 /import endpoints (idempotency_key required on all):**
- `POST /finance/loans/import` → `fin_mortgages_loans`
- `POST /finance/investments/import` → `fin_investments` (accepts `{ items: [] }` for multi-holding)
- `POST /finance/insurance/policies/import` → `fin_insurance_policies`
- `POST /finance/bank-statements/import` → `fin_transactions` + `fin_pending_review_queue`

**ANNUITY** added as valid `investment_type` to `fin_investments` CHECK constraint (migration 008).

**Ollama prompts** — `scripts/ollama-batch/index.ts` has `DOC_PROMPTS` for `LOAN`, `INVESTMENT`, `INSURANCE`; `scripts/doc-import/src/extract.ts` has matching per-type prompts for the local path.

### docker-compose.yml env-var wiring gap — CRITICAL (found session 39, three separate instances in one day)
Adding a new env var to `.env` does **nothing** on its own — `docker-compose.yml`'s `environment:` block for a service only passes through vars **explicitly listed there** (no `env_file:` directive is used for `api`). Three real features were found completely non-functional in production because this second step was skipped: `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` (WhatsApp sending silently no-op'd for an unknown number of prior sessions despite being documented as "live"), `MINIO_PUBLIC_ENDPOINT`/`MINIO_PUBLIC_PORT`/`MINIO_PUBLIC_SSL` (presigned photo URLs fell back to the unreachable internal MinIO hostname), and `storage.jagcorporate.com` itself never got a Caddy site block at all despite being documented as deployed. **When adding any new env var that code reads via `process.env`, always grep `docker-compose.yml` to confirm it's actually wired into the relevant service's `environment:` block — a value existing in `.env` is not sufficient.** Also: `docker compose restart <service>` does **not** pick up new env values (env vars are baked in at container creation) — always use `docker compose up -d --force-recreate <service>` after an `.env` change, and verify with `docker exec <service> printenv <VAR>` afterward.

### MinIO SDK region auto-detection fails behind a reverse proxy — CRITICAL (found session 39)
The `minio` npm package's `presignedUrl()` (used by `getPresignedGetUrl`/`getPresignedPutUrl`) makes an internal `getBucketRegionAsync()` call to auto-detect the bucket's region unless one is set explicitly. That auto-detect call fails with an opaque `S3Error` when the client is pointed at a hostname reverse-proxied by Caddy (as `presignClient` in `lib/minio.ts` is, against `storage.jagcorporate.com`) — this silently breaks *every* presigned-URL feature at once (photo galleries return empty, uploads fail) with no obvious error pointing at the cause. **Fix:** always pass `region: 'us-east-1'` (or whatever the real bucket region is) explicitly in the `MinioClient` constructor for any client used for presigned URLs, so the SDK never makes that extra network call.

---

## TENANT UUIDs

| Entity | UUID |
|---|---|
| JAG_HOLDINGS | `00000000-0000-0000-0001-000000000001` |
| JABCO | `00000000-0000-0000-0001-000000000002` |
| JAG_PROPERTIES | `00000000-0000-0000-0001-000000000003` |
| JAG_ENTERTAINMENT | `00000000-0000-0000-0001-000000000004` |
| JAG_FINANCE | `00000000-0000-0000-0001-000000000005` |
| DRAGONBRIDGE | `00000000-0000-0000-0001-000000000006` |
| NLCB | `00000000-0000-0000-0001-000000000007` |
| CONSOLIDATED (net worth) | `00000000-0000-0000-0000-000000000000` |
| Personal — Robert | `00000000-0000-0000-0001-000000000008` |
| Isabella Johnson-Attin | `00000000-0000-0000-0001-000000000009` |
| Phillip Ajack Johnson-Attin | `00000000-0000-0000-0001-000000000010` |
| Brian Johnson-Attin | `00000000-0000-0000-0001-000000000011` |
| Zhanghua Chang | `00000000-0000-0000-0001-000000000012` |
| Theresa Johnson-Attin | `00000000-0000-0000-0001-000000000013` |

**Note:** UUIDs 008–013 are personal/family owner entities used in `fin_accounts`, `fin_investments`, `fin_insurance_policies`, and `fin_mortgages_loans` (`owner_entity_id` grouping field only — no FK to tenants table, no RLS tenant scope, `jag_family` DB only).

---

## USER ACCOUNTS

### Robert (Owner)
| Field | Value |
|---|---|
| Email | `robertjohnsonattin@gmail.com` |
| Keycloak ID | `e58436eb-bcd9-40c4-95f6-251d77d0b001` |
| jag_core users.id | `95ca3f77-60ba-4a0f-af70-2832b247b525` |
| Role | Owner on all 7 tenants (JAG_HOLDINGS is default) |
| Keycloak realm roles | `default-roles-jag` |
| Token source | `https://auth.jagcorporate.com` (NOT localhost — issuer mismatch) |

### Wife (Emergency Designate — full read-only)
| Field | Value |
|---|---|
| Email | `zhanghuachang22@gmail.com` |
| Keycloak ID | `7b03b15d-f9e7-4000-8394-7e530d2ce35f` |
| jag_core users.id | `847d5964-302c-4513-b0c9-e54406c43e62` |
| Role | Auditor on JAG_HOLDINGS (auditor portal shows Robert's books) |
| Keycloak realm roles | `default-roles-jag`, `jag_auditor` |

### Brian
| Field | Value |
|---|---|
| Email | `brijohn929@gmail.com` |
| Keycloak ID | `566710e3-258c-4220-984c-bc1729417770` |
| jag_core users.id | `1b9f8e53-8f1e-4eb9-be81-83dc6d3f5670` |
| Role | Staff on NLCB (his own login); seed user `00000000-0000-0000-0002-000000000001` used by X-Act-As flow |
| Keycloak realm roles | `default-roles-jag`, `brian_portal` |
| Default tenant | NLCB (`00000000-0000-0000-0001-000000000007`) per `brian_portal_config` |

---

## KEY CREDENTIALS (VM / LOCAL)

| Resource | Value |
|---|---|
| SSH key | `~/.ssh/jag_oracle2` (jag_oracle does NOT work) |
| Keycloak admin | user `admin` — password ‹SECRETS VAULT›[^secrets] (via SSH tunnel to localhost:8080) |
| jag-api client secret | ‹SECRETS VAULT›[^secrets] |
| PG superuser | user `postgres` — password ‹SECRETS VAULT›[^secrets] |
| jag_app PG user | ‹SECRETS VAULT›[^secrets] |
| MinIO root | user `jag_minio_admin` — password ‹SECRETS VAULT›[^secrets] (admin only — console + mc) |
| MinIO jag_app | access key + secret ‹SECRETS VAULT›[^secrets] (scoped to 4 JAG buckets via `jag-app-buckets` policy) |
| MinIO audit token | stored in VM `.env` as `MINIO_AUDIT_TOKEN` — shared secret for MinIO→jag-api webhook |
| Gemini API key | stored in VM `.env` as `GEMINI_API_KEY` — used by listing.ts suggest-price endpoint |
| Gemini model | `GEMINI_MODEL=gemini-3.5-flash` in VM `.env` — change here to upgrade model without code deploy |
| Documenso owner account | `robertjohnsonattin@gmail.com` — password ‹SECRETS VAULT›[^secrets] (only needed to log into `sign.jagcorporate.com`'s dashboard directly, e.g. to manage the webhook; normal operation never surfaces this to tenants) |
| Documenso API key / webhook secret | stored in VM `.env` as `DOCUMENSO_API_KEY` / `DOCUMENSO_WEBHOOK_SECRET` |
| WhatsApp Cloud API token | stored in VM `.env` as `WHATSAPP_ACCESS_TOKEN` — permanent System User token (Meta Business Suite → System Users → jag-api), never expires |
| WhatsApp phone number 2FA PIN | `868-277-3726`'s Cloud API registration PIN — ‹SECRETS VAULT›[^secrets] (needed only if the number ever needs re-registering) |

[^secrets]: **‹SECRETS VAULT›** — actual credential values are NOT stored in git (scrubbed 2026-06-24). Keep them in a password manager / the VM `/opt/jag/.env` only. Live values for the VM live in `/opt/jag/.env`; for admin creds use your password manager. **Note:** older git history (and several operational scripts) still embed some of these — the only complete remediation is to *rotate* the affected credentials (KC client secret, PG passwords, MinIO keys, keystore password). See OPEN ITEMS → "Secrets hygiene".

---

## ROLE MATRIX

| Role | Access |
|---|---|
| Owner | Full access — all entities, all data (Robert) |
| Domain Admin | Full CRUD within assigned entity |
| Operator / Staff | Scan, log, count, transfer — no delete, no valuations |
| Auditor | Read-only, export only |
| External Advisor | Time-limited scoped read/export, auto-expiry |
| Family Member — Emergency Designate | Full read-only all entities (Wife) |
| Brian | Separate portal — his entities only |
| System | API access only — scheduled jobs, integrations |

---

## BUSINESS ENTITIES

**CRITICAL:** BAR + Members Club = ONE merged module (JAG Entertainment Ops) with mandatory entity tag per transaction. Members Club is a **private social club** — NOT a regulated casino. No AML tags, no Gaming Commission export, no hash-chained audit log.

| Entity | Type | Phase |
|---|---|---|
| JABCO Limited | Civil engineering & contracting | 1B, 2 |
| JAG Properties | Property management | 2 |
| DragonBridge | China sourcing, forex, logistics | 3 |
| JAG Entertainment (BAR + Members Club) | F&B + private social club (merged) | 3 |
| JAG Finance | Consolidated wealth & banking | 1B/4 |
| IMS | Inventory & asset management | 1B+ |
| JAG CRM | Customer relationship management | 1B, 3, 4 |
| JAG Lifestyle | Personal loyalty & rewards tracker | 2–4 |
| JAG DocVault | Document management & e-signatures | 2 |
| JAG Succession Planning | Estate & access planning | 2 |
| Brian's Portal | Isolated family member portal | 3 |
| JAG Holdings | Central financial backbone / SSO | 1B/5 |
| JAG Plantations | Agricultural land | 7 |
| JAG Trading | POS retail | 7 |

---

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
| Tenancy enquiries | `routes/properties/enquiries.ts` | Prospect enquiry CRUD + WhatsApp reply; stage lifecycle |
| Tenancy viewings | `routes/properties/viewings.ts` | Viewing scheduling, Google Calendar events, status PATCH; `/send-reminders` + `/send-post-viewing-links` batch; public booking router (`/public/book/:slug`) |
| Tenancy applications | `routes/properties/applications.ts` | Application CRUD + decide (APPROVE/REJECT) + generate tenancy agreement PDF |
| Tenancy deposits | `routes/properties/deposits.ts` | Deposit CRUD + receipt PDF + refund workflow |
| Tenancy rent schedule | `routes/properties/rent-schedule.ts` | Schedule CRUD + record payment + `/send-reminders` batch |
| Tenancy handover | `routes/properties/handover.ts` | ENTRY/EXIT checklist CRUD + sign-off endpoints |
| Tenancy maintenance | `routes/properties/maintenance-tickets.ts` | P1–P4 tickets + ticket updates + `/check-sla` batch; contractors CRUD |
| Tenancy renewals | `routes/properties/renewals.ts` | Renewal notices + tenant response + process-renew/vacate; `/send-notices` D-60/D-30/D-14 batch |
| Tenancy WhatsApp | `routes/properties/whatsapp-send.ts` | Outbound template send; `routes/internal/whatsapp-webhook.ts` inbound webhook (Meta verify + message store) |
| Tenancy listing | `routes/properties/listing.ts` | Unit listing CRUD + Gemini AI rent suggestion + SMS broadcast + photo upload/confirm/list/delete + listing-info PATCH; `triggerAutoListing()` exported and called by handover.ts on EXIT completion |
| Public rental application | `routes/properties/public-apply.ts` | `publicApplyRouter` at `/api/v1/public/apply` (session 40) — `GET /:token` resolve enquiry+prefill, `POST /:token/upload-url` presigned doc upload, `POST /:token` submit to `prop_applications`+`prop_application_documents`, burns token, bell notification. Token generated by `viewings.ts` send-post-viewing-links (30-day validity, migration 045). Frontend `pages/PublicApply.tsx`, public route (bypasses Keycloak like `/book`) |
| Wet-sign lease upload | `routes/properties/properties.ts` | `POST /:propertyId/leases/:leaseId/upload-signed` (multer+MinIO, marks lease SIGNED) + `GET /:propertyId/leases/:leaseId/signed-pdf` (session 40) — paper workflow for tenants without e-signature: download agreement PDF → print → wet-sign → scan → upload |
| Google Calendar lib | `src/lib/google-calendar.ts` | `getAvailableSlots()` + `createCalendarEvent()` + `deleteCalendarEvent()` + `createAllDayCalendarEvent()` via Google Calendar v3 API (service account); `google-auth-library` npm dep; key read from `/opt/jag/jag-api/google-calendar-key.json` (volume-mounted), falls back to `GOOGLE_SERVICE_ACCOUNT_KEY` base64 env var |
| CRM calendar integration | `routes/crm/crm.ts` + `routes/internal/crm-calendar-backfill.ts` | All-day Google Calendar event created non-blocking when `follow_up_date` set on interaction; `calendar_event_id` stored back via `withTenantRLS` UPDATE; backfill endpoint `POST /internal/crm/backfill-calendar` for historical rows; ✓/⚠ sync indicator in CRM panel |
| WhatsApp lib | `src/lib/whatsapp.ts` | `sendTemplate()` + `sendText()` via Meta Cloud API |
| WA approvals | `routes/properties/wa-approvals.ts` | PENDING approval queue for RENT_FORMAL_DEMAND / RENT_LEGAL_NOTICE / DEPOSIT_RECON; approve-and-send + dismiss endpoints |
| WA inbox | `routes/properties/wa-inbox.ts` | Unified conversation timeline (WA messages + contact log); `prop_contact_log` entries |
| MinIO lib | `src/lib/minio.ts` | Added `getPresignedGetUrl()` (1h TTL for web display, 7-day TTL for Facebook photo posts) |
| Notifications producer (session 26) | `src/lib/notifications.ts` | `enqueueNotification()` — non-blocking owner-recipient insert into `notification_queue` (jag_core); RLS via `withOwnerRLS(corePool, recipient,...)`; `NOTIFY_OWNER_USER_ID` env (fallback = Robert's id). Wired into expenses `/submit`, maintenance create (P1/P2) + `/check-sla`, enquiries create |
| Notifications endpoints (session 26) | `routes/notifications.ts` | Added `GET /notifications/unread-count` + `PATCH /notifications/read-all` (alongside existing `GET /` + `PATCH /:id/read`) |
| Succession by-id (session 26) | `routes/succession/index.ts` | `GET /succession/documents/:id` — returns full row incl. `storage_path` for download (list view omits it) |

### Phase 7 Migrations (jag_commercial)

| File | Changes |
|---|---|
| `009_ims_suppliers_pos.sql` | ims_suppliers, ims_purchase_orders tables |
| `010_ims_stock_takes.sql` | ims_stock_takes, ims_stock_take_lines |
| `011_ims_depreciation.sql` | ims_depreciation_schedules, ims_depreciation_entries |
| `012_vehicles_owner_service.sql` | owner_entity, last_service_date, next_service_date, service_interval_days on ims_vehicles; location_id nullable on ims_items |
| `013_jabco_crm_client_fk.sql` | FK from jabco tables to crm_contacts for client linkage |
| `014_crm_contact_phone2.sql` | Adds phone2 VARCHAR(50) to crm_contacts |
| `015_vehicles_sim_number.sql` | Adds sim_number column to ims_vehicles |
| `016_pipeline_project_status_enums.sql` | pipeline_stage ADD VALUE SUBMITTED/NO_GO; project_status ADD VALUE AWARDED |
| `017_pipeline_tender_fields.sql` | 7 new columns on crm_sales_pipeline (pipeline_type, bid_deadline, source_url, proposal_document_url, submitted_at, linked_project_id) |
| `018_bid_intelligence_log.sql` | jabco_bid_log append-only table; log_type: NO_GO/LOST_BID/RATE_VARIANCE/POST_MORTEM/WON; idempotency_key UNIQUE; RLS |
| `019_boq_margin_columns.sql` | internal_cost_rate, markup_percent, final_bid_rate, work_package_tag on jabco_boq_items |
| `020_vo_time_extension.sql` | time_extension_days INTEGER on jabco_variation_orders |
| `021_project_tasks.sql` | jabco_project_tasks (MOBILIZATION/POST_MORTEM/GENERAL; OPEN/IN_PROGRESS/DONE); RLS |
| `022_punch_incidents_quality.sql` | jabco_punch_list_items (IDENTIFIED→RECTIFIED→VERIFIED), jabco_site_incidents, jabco_quality_inspections; all RLS |
| `023_project_closeout_fields.sql` | handover_document_url TEXT on jabco_projects |
| `028_crm_interaction_calendar_event_id.sql` | `calendar_event_id TEXT` on `crm_interactions` — stores Google Calendar event ID for follow-up date sync |
| `029_vehicle_calendar_service_log.sql` | `cal_service_event_id`, `cal_insurance_event_id`, `cal_registration_event_id TEXT` on `ims_vehicles` (NOTE: `cal_insurance_event_id` was dropped by migration 037 in session 28); `ims_vehicle_service_log` append-only table; RLS tenant policy |
| `030_vms_vehicle_enhancements.sql` | `status` ENUM (ACTIVE/IN_MAINTENANCE/OFF_ROAD/DISPOSED), `dep_expense_account_code`, `acc_dep_account_code`, `disposal_value` on `ims_vehicles`; RLS tenant policy |
| `031_vms_work_orders_pm.sql` | `vms_work_orders` (wo_number seq, wo_type, status machine, totals); `vms_work_order_items` (PART/LABOUR/CONSUMABLE/SUBLET, line_total computed); `vms_pm_schedules` (DAYS/KM/HOURS intervals, last/next due tracking); all RLS |
| `032_vms_fuel_operating_costs.sql` | `vms_fuel_logs` (litres, price_per_litre, total_cost_ttd, full_tank flag); `vms_operating_costs` (TOLL/PARKING/CLEANING/ACCESSORIES/ADMIN/OTHER); both RLS |
| `033_vms_compliance_docs.sql` | `vms_compliance_docs` (doc_type ENUM, doc_number, expiry_date, file_path for MinIO); RLS |
| `034_vms_disposal_gl.sql` | `dep_expense_gl_account_id`, `acc_dep_gl_account_id` on `ims_depreciation_schedules`; `journal_entry_id` on `ims_depreciation_entries`; `vms_disposals` table (disposal_type, cost/dep/nbv snapshot, sale_price_ttd, gain_loss_ttd, tco_snapshot JSONB, journal_entry_id); UNIQUE(vehicle_id); RLS |
| `035_item_disposal_columns.sql` | `disposed_at TIMESTAMPTZ`, `disposal_type VARCHAR(20)` CHECK IN ('SALE','WRITE_OFF','TRANSFER'), `disposal_notes TEXT`, `sale_price_ttd NUMERIC(15,2)`, `buyer_name VARCHAR(200)`, `disposal_gl_entry_id UUID` added to `ims_items`; ran via psql on VM |
| `036_gps_trackers.sql` | `gps_trackers` registry (device_serial, model, protocol, traccar_device_id, sim_phone, status UNASSIGNED/ASSIGNED/RETIRED, vehicle_id soft-ref ON DELETE SET NULL, last_seen_at); tenant RLS; unique(tenant,device_serial); GRANT jag_app. Backs the GPS/Traccar integration — see "GPS vehicle tracking" rule |
| `037_gps_battery_log.sql` | `gps_battery_log` table (tenant_id, tracker_id FK gps_trackers, traccar_device_id, battery_level SMALLINT 0–100, is_charging BOOL, recorded_at); tenant RLS; GRANT jag_app. Populated hourly by `gps-battery-monitor.sh` cron + `POST /internal/gps/battery-sync` |

### Phase 7 Migrations (jag_family)

| File | Changes |
|---|---|
| `007_expense_receipt_bucket.sql` | MinIO bucket config for expense receipts |
| `008_document_jobs.sql` | ANNUITY added to `fin_investments` investment_type CHECK; `fin_document_jobs` table + RLS policy |
| `009_investment_valuations.sql` | `fin_investment_valuations` append-only table; FK → `fin_investments(id) ON DELETE CASCADE`; indexes on `(investment_id, as_of_date DESC)` and `(owner_id, as_of_date DESC)`; RLS using `NULLIF(current_setting('app.current_owner_id', true), '')::uuid` |
| `010_loan_balance_history.sql` | `fin_loan_balance_history` append-only table; FK → `fin_mortgages_loans(id) ON DELETE CASCADE`; tracks outstanding_balance, interest_rate, monthly_payment; same RLS + index pattern |
| `011_insurance_policy_history.sql` | `fin_insurance_policy_history` append-only table; FK → `fin_insurance_policies(id) ON DELETE CASCADE`; tracks coverage_amount_ttd, premium_amount_ttd, expiry_date; same RLS + index pattern |
| `012_credit_cards_categories.sql` | `fin_credit_cards` table (card_name, last_four, card_type, is_active); `card_id UUID` FK column on `fin_expenses`; expense category CHECK constraint expanded; applied via postgres superuser (jag_app not owner of fin_expenses) |
| `013_debit_card_payment_method.sql` | `ALTER TYPE expense_payment_method ADD VALUE 'DEBIT_CARD'` — enum extension for debit card support |
| `016_insurance_calendar_event_id.sql` | `calendar_event_id TEXT` on `fin_insurance_policies` — stores Google Calendar event ID for expiry date |
| `017_ownership_stakes.sql` | `fam_ownership_stakes` beneficial-ownership cap table (family_member_id, subject_kind ENTITY/PROPERTY/ITEM, subject_id, subject_label, ownership_percent CHECK 0-100); owner RLS; unique(member,kind,subject). Owned by postgres, GRANT to jag_app. Applied via psql on VM, registered in `__migrations` |
| `018_insurance_consolidation.sql` | **Session 28** — `ALTER TYPE insurance_policy_type ADD VALUE` for BUILDING, CONTENTS, FLOOD, FIRE, COMPREHENSIVE, SURETY_BOND, PERFORMANCE_BOND; `sub_type VARCHAR(50)` column added to `fin_insurance_policies`; all 4 RLS policies hardened with `NULLIF(..., '')::uuid`. Ran via `sudo -u postgres psql` (ALTER TYPE cannot run inside transaction). `insured_asset_ref UUID` used as soft cross-DB ref to link policies to properties or vehicles |
| `019_expense_linked_record.sql` | **Session 30** — `linked_record_type/id/label` + `fuel_litres/fuel_odometer_km/fuel_type` added to `fin_expenses`; soft cross-DB refs to VEHICLE/INSURANCE_POLICY/PROPERTY/FAMILY_MEMBER; fuel fields enable auto-sync to `vms_fuel_logs` on expense creation |

### Phase 7 Migrations (jag_properties)

| File | Changes |
|---|---|
| `003_insurance.sql` | `prop_insurance` table — **DROPPED by migration 034 (session 28)**; property insurance now in `fin_insurance_policies` with `insured_asset_ref = property.id` |
| `004_property_tax.sql` | prop_property_tax |
| `005_inspections.sql` | prop_inspections |
| `006_lease_deposit_refund.sql` | deposit refund fields on prop_lease_agreements |
| `007_utility_accounts.sql` | prop_utility_accounts |
| `008_late_fee_lease.sql` | late_fee_type/value/grace_days on leases |
| `009b_prop_properties_audit_cols.sql` | last_modified_at, last_modified_by audit columns on prop_properties |
| `009_units.sql` | prop_units table (property sub-unit tracking) |
| `010_mortgage_last_modified.sql` | last_modified_at, last_modified_by on mortgage table |
| `011_rent_payment_proof.sql` | proof_photo_url, proof_uploaded_at, proof_uploaded_by on rent payments; receipt token for shareable links |
| `012_valuation_history.sql` | `prop_valuation_history` append-only table; FK → `prop_properties(id) ON DELETE CASCADE`; tracks valuation_ttd; same RLS + index pattern |
| `013_enquiries.sql` | `prop_enquiries` — prospect enquiry tracking (channel, stage, phone, email) |
| `014_viewings.sql` | `prop_viewings` — scheduled viewings, Google Calendar event ID, status lifecycle |
| `015_applications.sql` | `prop_applications` — tenancy applications with employment/reference/income fields |
| `016_deposits.sql` | `prop_deposits` — security deposits with refund workflow |
| `017_rent_schedule.sql` | `prop_rent_schedule` — generated rent schedule periods, payment recording, reminder tracking |
| `018_handover_checklists.sql` | `prop_handover_checklists` — ENTRY/EXIT checklists with condition items JSONB, meter readings, key issuance |
| `019_maintenance_tickets.sql` | `prop_maintenance_tickets`, `prop_ticket_updates`, `prop_contractors` — P1–P4 tickets, SLA breach flag, update log, contractor directory |
| `020_whatsapp_messages.sql` | `prop_wa_conversations`, `prop_wa_messages` — WhatsApp thread + message store (INBOUND/OUTBOUND) |
| `021_renewal_notices.sql` | `prop_renewal_notices` — lease renewal tracking with D-60/D-30/D-14 notice timestamps |
| `022_unit_enhancements.sql` | `prop_units` additions: `listing_status`, `booking_slug` (unique), rent suggestion columns; `prop_broadcast_contacts` table |
| `023_tenant_phone2.sql` | phone2 on tenants |
| `024_contractor_crm_link.sql` | crm_contact_id FK on prop_contractors |
| `025_maintenance_contractor_assign.sql` | contractor assignment on maintenance tickets |
| `026_wa_pending_approvals.sql` | `prop_wa_pending_approvals` — manual-approve queue for RENT_FORMAL_DEMAND / RENT_LEGAL_NOTICE / DEPOSIT_RECON |
| `027_contact_log.sql` | `prop_contact_log` — call/note log entries in WA inbox timeline |
| `028_rent_schedule_reminder_cols.sql` | reminder tracking columns on rent schedule |
| `029_viewing_1h_reminder_col.sql` | 1h reminder sent flag on prop_viewings |
| `030_unit_stale_alert_col.sql` | stale_alert_sent_at on prop_units for dedup |
| `031_unit_photos.sql` | `listing_description TEXT` on prop_units; `prop_unit_photos` table (owner_id, unit_id FK, object_key, display_order, caption) — MinIO `jag-photos` bucket; RLS |
| `032_inspection_calendar_event_id.sql` | `calendar_event_id TEXT` on `prop_inspections` — stores Google Calendar event ID for inspection_date |
| `034_drop_prop_insurance.sql` | **Session 28** — `DROP TABLE IF EXISTS prop_insurance`; insurance consolidated into `fin_insurance_policies` (jag_family) |
| `043_esignature.sql` | **Session 38** — DocuSeal-era columns (`docuseal_submission_id`, `signature_status`, `signed_pdf_object_key`, `agreement_signed_at`) on `prop_lease_agreements` + `prop_handover_checklists`; DocuSeal itself replaced by Documenso in session 39 (see `044`), these columns left dead/unused |
| `044_documenso_columns.sql` | **Session 39** — adds `documenso_document_id` to `prop_lease_agreements` + `prop_handover_checklists` (additive per STD-13; old `docuseal_submission_id` columns from `043` untouched) |
| `045_enquiry_application_token.sql` | **Session 40** — adds `application_token`/`application_token_expires_at`/`application_submitted_at` to `prop_enquiries`; backs the public `/apply/<token>` Stage-2 rental application form |
| `052_deposit_application_tenant_link.sql` | **Session 44** — adds `application_id` + `tenant_id` (both nullable FK, ON DELETE SET NULL) to `prop_deposits`. Deposits previously only resolved to a tenant via `lease_id -> prop_lease_agreements.tenant_id`, so a deposit taken right after application approval (before any lease existed) neither sent its WhatsApp receipt nor showed under the Tenant record. `tenant_id` is now set immediately when a `lease_id` is given, or backfilled by `create-tenant` (via `application_id`) or by lease creation (see "Tenant record — deposit/lease/application linking" below) |
| `053_application_tenant_link.sql` | **Session 44** — adds `tenant_id` (nullable FK, ON DELETE SET NULL) to `prop_applications`. `create-tenant` only ever read FROM the application to build the tenant row; it never wrote a link back, so the trail from tenant -> originating application dead-ended the moment the tenant existed. Backfilled by `create-tenant` itself now. Ran via `sudo -u postgres psql` (jag_app not owner of `prop_applications`, same as `012_credit_cards_categories.sql`/`fin_expenses`) — migrations are **not** auto-applied on container start; every migration on this project has always been a manual step, confirmed this session after wrongly suspecting otherwise |
| `054_maintenance_ticket_tenant_link.sql` | **Session 44** — adds `tenant_id` (nullable FK, ON DELETE SET NULL) to `prop_maintenance_tickets`. Had a nullable `lease_id` the frontend never actually sends; `tenant_id` resolved from `lease_id` if given, else the unit's active lease, at ticket-creation time. Ran via `sudo -u postgres psql` (same ownership pattern as `053`) |
| `055_handover_tenant_link.sql` | **Session 44** — adds `tenant_id` (nullable FK, ON DELETE SET NULL) to `prop_handover_checklists`. Had an optional `lease_id` (frontend does collect it via a picker) but no general list route existed at all — only `GET /unit/:unitId`. `tenant_id` resolved the same way as `054`; new `GET /properties/handover?tenant_id=` added from scratch. Ran via `sudo -u postgres psql` |

### VM Cron Scripts (`jag-infra/scripts/`)

| Script | Schedule (UTC) | Schedule (TT) | Purpose |
|---|---|---|---|
| `backup-databases.sh` | 02:00 | 22:00 prev. day | pg_dump all 5 DBs |
| `fx-rates-sync.sh` | 10:00 | 06:00 | Seed USD + CNY → TTD rates from open.er-api.com |
| `cleanup-stale-statements.sh` | 07:00 | 03:00 | Delete PENDING bank statement jobs + MinIO objects older than 7 days |
| `rent-reminders.sh` | 07:00 | 03:00 | Send WhatsApp rent reminders for UPCOMING/LATE rent schedule periods (3-day window) |
| `viewing-reminders.sh` | 00:00 * | 20:00 * | Hourly — send WhatsApp viewing reminders for viewings in next 2h |
| `post-viewing-app-link.sh` | 00:30 * | 20:30 * | Hourly (at :30) — send application link to COMPLETED viewings in last 24h |
| `renewal-notices.sh` | 08:00 | 04:00 | Send D-60/D-30/D-14 WhatsApp renewal notices for expiring leases |
| `sla-monitor.sh` | */30 * | every 30 min | Mark open maintenance tickets where SLA hours exceeded; creates BREACH update log |
| `stale-listing-alert.sh` | 09:00 | 05:00 | WhatsApp alert to Robert for units LISTED >14 days without a booked viewing; deduped via `stale_alert_sent_at` on prop_units |
| `gps-battery-monitor.sh` | 0 * * * * | every hour | Poll Traccar positions API for batteryLevel on all non-RETIRED trackers; insert into `gps_battery_log`; fire low-battery JAG notification (≤20%, deduped 8h) |
| `setup-minio-policy.sh` | one-time | — | Create `jag-app-buckets` IAM policy + attach to jag_app user; re-run after MinIO data wipe |
| `fdw-rotate-password.sh` | manual | — | Resync FDW USER MAPPING passwords after jag_app PG credential rotation |

### Local Extraction Script (`scripts/doc-import/`)
Path 2 local extraction — reads PDFs from local hard drive, Ollama extracts, posts to API. **File never uploaded to cloud.**
- Build: `npm install && npm run build` in `scripts/doc-import/` (uses local `npx tsc` — global tsc not required)
- Usage: `node dist/extract.js --type <bank-statement|loan|investment|insurance> --file "C:/JAG Filing/..." [--entity <uuid>] [--account <uuid>] [--dry-run]`
- Config: `scripts/doc-import/.env.doc-import` — `KC_USERNAME`, `KC_PASSWORD` (never commit), `JAG_API_URL`, `OLLAMA_URL`, `OLLAMA_MODEL`
- Auth: Keycloak ROPC (password grant) — token cached per run with 30s early-expiry buffer
- **PDF extraction:** uses `pdf-parse` v1.1.1 — handles FlateDecode-compressed PDFs (e.g. Microsoft Reporting Services output). The old latin1 byte-scan is replaced; raw binary PDFs now decode correctly.
- **TTCD pre-parser (investment type only):** if the PDF matches the Trinidad & Tobago Central Depository (TTCD/TTSE) statement layout (`Closing Balance:` + `Net Movement:` markers), the script bypasses Ollama entirely and parses all holdings programmatically — 100% accuracy, ~2 seconds. Known TTSE tickers hardcoded in `TTSE_TICKERS` array for clean name splitting (add new tickers there when encountered).
- **IBKR pre-parser (investment type only, added 2026-06-16, session 14):** if the input file is a CSV export of an Interactive Brokers **Activity Flex Query → Open Positions (Summary)**, the script bypasses Ollama entirely via `parseIbkrPositions()`. Header matching is normalized (case/space/punctuation-insensitive) to tolerate IBKR's varying column-name conventions.
  - **Required Flex Query field selection** (Performance & Reports → Flex Queries → Create Activity Flex Query → Open Positions, Summary level, output format CSV): Account ID, Symbol, Description, Asset Class, Currency, Quantity, Mark Price, Position Value, Cost Basis Price, Cost Basis Money, Unrealized P/L, Report Date.
  - **Asset class mapping** (`IBKR_ASSET_CLASS_MAP`): `STK→EQUITY`, `ETF→ETF`, `FUND→MUTUAL_FUND`, `BOND→BOND`, `CASH→CASH_EQUIVALENT`. Any other class (`OPT`, `FUT`, `FOP`, `WAR`, `CFD`, etc.) is skipped with a console warning — derivatives aren't tracked in `fin_investments`.
  - **Short/closed positions** (`quantity <= 0`) are skipped with a warning.
  - **FX conversion:** IBKR's `FXRateToBase` converts to the account's own base currency, not TTD, so it's ignored. The script instead calls `GET /finance/fx-rates/:currency/latest` per holding currency and converts `PositionValue`/`FifoPnlUnrealized` into `current_value_ttd`/`unrealised_gain_ttd`. If no TTD rate is on file for that currency, those two fields are left blank — sync first via `POST /finance/fx-rates/sync` or add a manual rate, then backfill via the Investments Update modal.
  - **Not idempotent across reruns:** like the TTCD path this is a plain `INSERT` via `/finance/investments/import` (`idempotency_key` is accepted by the Zod schema but not enforced against the table) — rerunning the same export creates duplicate rows. Use for point-in-time backfill, not a recurring sync. For ongoing valuation updates on holdings already imported, use the Investments panel Update modal (auto-logs to `fin_investment_valuations`).
  - Usage: `node dist/extract.js --type investment --file "C:/path/IBKR_OpenPositions.csv" --entity <uuid> [--dry-run]`
- **Ollama settings:** `num_ctx: 16384` (prevents truncation on longer prompts), timeout 600 s, 2-attempt retry, robust JSON extractor (brace-depth scanner handles prose before/after JSON).
- **Running KC_PASSWORD at runtime (don't store in file):** `$env:KC_PASSWORD = "xxx"; node dist/extract.js ...`

### Vehicle Owner Options (VEHICLE_OWNER_OPTIONS const)
`JAG Holdings`, `JABCO`, `JAG Properties`, `JAG Entertainment`, `JAG Finance`, `Personal — Robert`, `Personal — Brian`, `Personal — Phillip`, `Other`

---

## JAG MOBILE APP (session 17, 2026-06-18)

**App directory:** `jag-mobile/` (at repo root, alongside `jag-api/`, `jag-web/`, `jag-infra/`)
**Package:** `com.jagcorporate.mobile`
**Platform:** Android only (Samsung S24 Ultra — Robert's primary device)
**Release APK:** sideloaded via `adb install -r android/app/build/outputs/apk/release/app-release.apk`

### Stack

| Component | Choice |
|---|---|
| Framework | React Native 0.76.3 / Expo 52 (bare workflow) |
| Routing | expo-router v4 |
| Auth | Keycloak PKCE via `react-native-app-auth` v8; redirect scheme `jagmobile://` |
| Token storage | `expo-secure-store` (Android Keystore hardware-backed encryption) |
| Notifications | `@notifee/react-native` — persistent ongoing notification in Android shade |
| Camera / gallery | `expo-image-picker` for receipt photos |

### Screens

| Route | Purpose |
|---|---|
| `/login` | Keycloak PKCE login; auto-redirects if refresh token exists |
| `/expense-form` | Quick expense entry — amount, currency, category, payment method, payee, card picker, receipt photo; auto-submits on save |
| `/expenses` | Expense list (50 most recent); DRAFT items show Submit button |

**Note:** JAG Mobile has NO VMS, vehicle, or GPS screens. Vehicle management (work orders, fuel logs, compliance, disposal) and GPS tracking are **web-browser-only** (`jagcorporate.com` on phone browser). The independent GPS fallback on mobile is the **Traccar Manager** app (connects directly to `traccar.jagcorporate.com`).

### Auth Pattern
- First login: PKCE browser redirect → tokens stored in SecureStore (`jag_access_token`, `jag_refresh_token`, `jag_id_token`)
- Subsequent opens: silent refresh via `refresh_token` grant — no manual login required
- Notification shown as soon as `jag_refresh_token` exists in SecureStore (no need to wait for full auth check)

### Notification Widget
- Persistent ongoing notification in Android shade (like Money Manager) — channel `jag-quick-entry`
- `+ New Expense` action button opens expense-form directly
- Importance: `DEFAULT` (silent on Samsung One UI — no sound, no vibration)
- `ongoing: true` keeps notification pinned until force-stop or restart
- **After phone restart:** `BootReceiver.kt` restores notification via `BOOT_COMPLETED` broadcast
  - `exported="false"` (security — protected broadcast, external apps can't trigger it)
  - Samsung battery optimization blocks boot receiver for sideloaded apps → set **Settings → Apps → JAG Mobile → Battery → Unrestricted**

### Release Signing
- Keystore: `jag-mobile/android/app/jag-mobile.keystore` (gitignored via `android/.gitignore`)
- Credentials: `jag-mobile/android/signing.properties` (gitignored) — `MYAPP_UPLOAD_STORE_FILE`, `MYAPP_UPLOAD_KEY_ALIAS`, `MYAPP_UPLOAD_STORE_PASSWORD`, `MYAPP_UPLOAD_KEY_PASSWORD`
- `build.gradle` reads `signing.properties` via `Properties.load()` — never stores credentials in code
- Password: ‹SECRETS VAULT›[^secrets] (both store and key password)

### App Icon
- Square + round variants at all mipmap densities (mdpi through xxxhdpi)
- JAG hexagonal logo, white background, logo fills ~96% of icon space
- Source: PowerShell brightness-threshold pixel scan to find tight logo bounds, gray background pixels replaced with white

### Splash Screen
- Dark navy background (`#0f172a`) via `res/values/colors.xml` → `splashscreen_background`
- White silhouette JAG logo (`splashscreen_logo.png`) at all drawable densities

### Build Commands
```powershell
# Debug build
cd jag-mobile && npx expo run:android

# Release build
cd jag-mobile/android && ./gradlew assembleRelease

# Install on connected device
adb install -r app/build/outputs/apk/release/app-release.apk
```

### Key Patterns
- **FX rates:** fetched live from `GET /finance/fx-rates` on expense-form mount; `FALLBACK_FX` used if offline (`TTD:1, USD:6.78, CNY:0.94, EUR:7.35, GBP:8.60`)
- **Card picker:** fetches `GET /finance/credit-cards`; shown only when payment method is `CREDIT_CARD` or `DEBIT_CARD`
- **Receipt photo:** `expo-image-picker` (camera or gallery) → `POST /finance/expenses/:id/receipt` as multipart/form-data
- **Notification icon:** `ic_notification.png` — must be white on transparent (Android requirement); at drawable densities 24/36/48/72/96px

### Security Notes
- `BootReceiver` uses `exported="false"` — BOOT_COMPLETED is a protected broadcast so system still delivers it, but other apps cannot trigger the receiver by component name
- No biometric lock (decided not to add — acceptable for current use)
- All tokens in Android Keystore via expo-secure-store; never in AsyncStorage or plaintext

---

## OPEN ITEMS

- **Tenant record — full tenancy-chain linking — DONE + DEPLOYED 2026-07-21 (session 44)**: see "Tenant record — full tenancy-chain linking" above for full detail. Robert asked "check the same gap" module by module across the whole tenancy flow; the same underlying issue (no durable link back to the tenant, no tenant-scoped query, no Tenant-record UI) recurred independently in all 7 record types checked: **Deposits** (migration 052 — `application_id`/`tenant_id`, no prior FK path at all), **Applications** (migration 053 — `tenant_id`, `create-tenant` never wrote a link back), **Maintenance tickets** (migration 054 — `tenant_id`; had a `lease_id` column the frontend never populates, resolved from unit's active lease instead), **Handover checklists** (migration 055 — `tenant_id`; no general list route existed at all before this), **Leases** (`lease_id NOT NULL` already, just missing query — no migration), **Renewal notices** (same, no migration — plus fixed a real pre-existing bug, a nonexistent `l.rent_amount_ttd` column reference that had likely been 500ing the Renewals panel on every load), **Rent schedule** (same, no migration). `TenantsPanel.tsx` now has 8 per-tenant sections total: Docs, Deposits, Leases, Applications, Maintenance, Renewals, Handover, Rent. Commits `132b197`, `d506a96`, `42ffeeb`, `fe2d7b6`, `f1778bf`, `cc4d2db`, `d8fea4f`.
  - **Also this session — `canvas` npm dependency removed** (jag-api): confirmed zero references anywhere in `src/`/`dist/`/`scripts/` before removing; it shipped Windows-native binaries (`canvas-win32-x64-msvc`, `librsvg-2-2.dll`) into the Linux container's `node_modules` for no reason — same class of risk the `jimp`-over-`sharp` choice was made to avoid (see items.ts photo-normalization comment). Cut `prod_modules/node_modules` 286MB → 250MB, 283 → 256 packages. Commit `cb7a39d`.
  - **Also this session — VM disk audit**: `df -h` fine (194G total, was 27%/now 10% used after cleanup — see below); `docker system df` found **35.64GB reclaimable build cache** (99% of 35.99GB total, zero active) accumulated from repeated `docker compose build api` runs — `docker builder prune -f` reclaimed it, verified images/containers untouched (10/10 active, unaffected) and API still healthy after. Worth an occasional check — this had never been pruned.
  - **Also this session — `scp -r` deploy-transfer reliability lesson**: see "CRITICAL: jag-api Docker deploy pattern" above — `scp -r` on `prod_modules/node_modules`/`dist/` silently stalled twice (~30-40 min each) with zero indication of failure; switched to tar-then-scp-single-file, now the standard approach for those two paths.

- **IMS manufacturer/model_number display + is_asset correction-pass bug + photo lightbox — FIXED + DEPLOYED 2026-07-21**: Robert (working from a separate `digital-os` capture-pipeline project) had populated `manufacturer`/`model_number` on several JABCO items directly via SQL but couldn't see them in the app. Root cause: `GET /items/:id` already returned them (`SELECT i.*`), but the frontend never had them — `Item`/`ItemDetail` types (`jag-web/src/types/ims.ts`) didn't declare the fields, `Inventory.tsx`'s detail-tab field list never rendered them, and `CreateItemSchema`/`PatchItemSchema` (`jag-api/src/routes/ims/items.ts`) couldn't accept them either. Fixed all four layers plus the Add/Edit item modals so the fields are now both visible and editable; added `manufacturerLbl`/`modelNumberLbl` to both locale files. Separately, Robert asked why the Brother printer specifically wasn't flagged `is_asset` — traced to the original capture's manual correction pass (`digital-os/capture/2026-07-19_test/backoffice_corrected.csv`) fixing `is_asset` to `true` on 12 of 13 items but missing this one (all others, including the other printer, were correctly flagged); fixed in prod and in the source CSV. Also added a reusable `PhotoLightbox` component (`jag-web/src/components/PhotoLightbox.tsx`) — click any IMS item/vehicle photo thumbnail to view full-size with prev/next + Escape/arrow-key nav; wired into both `PhotosTab` and `VehiclePhotosTab` in `Inventory.tsx`.
  - **`deploy.sh` never uploaded `prod_modules/node_modules` for the API — only `dist/`.** This is a different, additional gap from the `scp -r` reliability issue documented above (session 44) — even a perfectly reliable transfer was never being attempted for `node_modules` at all. Confirmed while adding the `jimp` photo-normalization dependency for the IMS route above: deploy shipped a `dist/` requiring `jimp` against a VM `node_modules` that didn't have it yet, crash-looping `jag-api` for about an hour before caught via health-check failure + `docker logs`. Fixed: `deploy.sh` Step 4 now always runs `npm run prod-install` and uploads the refreshed `prod_modules/node_modules` alongside `dist/`, using the tar-then-scp-then-extract `tar_upload()` helper (folding in session 44's `scp -r` reliability fix for both paths at once, verified against live `dist/` byte-for-byte before trusting it). Commit `01ccd0a`.

- **Lease agreement PDF/Documenso rendering — FIXED + DEPLOYED 2026-07-13 (session 43)**: Robert noticed the already-signed Hugh Smith test lease (Apt C1) displayed wrong when downloaded, which turned into a live end-to-end re-signing walkthrough that surfaced 5 real bugs, all fixed and deployed same session (builds on the session-42 Documenso completion-pipeline fixes):
  1. **Signed-copy download read the wrong MinIO bucket.** `GET /properties/:id/leases/:id/signed-pdf` (`properties.ts`) was hardcoded to `BUCKET_DOCUMENTS`, but the Documenso webhook stores into `BUCKET_SIGNED_DOCUMENTS`. Fix: try `BUCKET_SIGNED_DOCUMENTS` first, fall back to `BUCKET_DOCUMENTS` (covers the older wet-sign-upload path too, no migration needed).
  2. **Signature/date field boxes overlapped the underline they sat on** — `lease-pdf.ts` `recordField` calls for `SIGNATURE`/`DATE` were only 16pt tall, anchored exactly on the underline's y, so Documenso rendered the signature squashed and the date text struck through the rule. First fix attempt overcorrected and started overlapping the "SIGNED by the LANDLORD" heading instead — needed a second pass adding real headroom (`moveDown(2.4)`, was 1.2) between heading and line, with the field now 34pt tall floating cleanly between the two.
  3. **Documenso DATE field had no timezone/format set**, defaulting to UTC in some auto-picked format — showed 4 hours ahead for Trinidad (UTC-4) signers. Fix: `documenso.ts` `createSigningSubmission` now calls `POST /document/update` with `meta: { timezone: 'America/Port_of_Spain', dateFormat: 'yyyy-MM-dd hh:mm a' }` right after document creation.
  4. **No page-numbering footer existed at all** (checked full git history — never implemented). Added: `bufferPages: true` on the PDFKit constructor, then after all content is drawn, loop `doc.bufferedPageRange()` + `switchToPage(i)` + stamp "Page X of Y" before `doc.end()`.
  5. **The page-numbering footer doubled the page count (12 → 22).** The footer y sits below the page's usable content area (bottom margin 56pt) — PDFKit's `.text()` auto-triggers `addPage()` when writing past that boundary even via `switchToPage` on an already-rendered page, silently inserting a blank page after every real one. Fix: zero `doc.page.margins.bottom` for just that write, restore after. Verified locally (counted `/Type /Page` objects in a generated test PDF: back to 11, matching the original) before deploying.

  **Also surfaced (not a code bug, pre-existing test data):** Hugh Smith's test tenant record shares Robert's own email. Documenso can't distinguish two recipients with the same email — completing the landlord signature silently auto-completed the tenant recipient too (no actual signature captured), so all further tenant-signing attempts 500'd with "Document must be pending for signing." Left as-is since it's test data only; a real lease will never have landlord==tenant email. See [[project-lease-pdf-rendering-fixes]] in Claude's memory for full detail. Commits `a9d5e75`, `91e4bce`, `633004f`, `82ca0a2`.

- **WhatsApp inbound webhook — FIXED + LIVE 2026-07-13 (session 41)**: Inbound WhatsApp had never processed a single message since the feature was built — Meta was never even reaching the endpoint. Root cause was a chain of 5 separate, independent bugs, all now fixed and verified end-to-end with a real message from Robert's phone (created a real enquiry + sent an auto-reply):
  1. **Meta app was unpublished** — "Apps will only be able to receive test webhooks... while the app is unpublished" banner in the App Dashboard. Fixed by completing Privacy Policy URL (new `jag-web/public/privacy.html`, static file, no React routing) + Category, then clicking Publish.
  2. **WABA had zero subscribed apps** — `GET /{waba-id}/subscribed_apps` returned `{data: []}`; app-level webhook config (Callback URL + Verify Token) is separate from telling the WABA to actually route events to that app. Fixed via `POST /{waba-id}/subscribed_apps` (Bearer token).
  3. **Global `express.json()` in `index.ts` ran before the webhook's `express.raw()`** — consumed the body before the route-specific raw parser saw it, so `Hmac.update()` threw `TypeError` on every single inbound call (`SIG_INVALID`-adjacent crash, actually a 500 not a 403). Fixed by moving the whole webhook mount (raw parser + rawBody capture) to before the global `app.use(express.json())`, same pattern already used for the WiPay webhook.
  4. **Signature verified against `WHATSAPP_ACCESS_TOKEN` instead of the Meta App Secret** — `verifyWebhookSignature()` in `lib/whatsapp.ts` used the wrong secret entirely; Meta signs `X-Hub-Signature-256` with the App Dashboard → Settings → Basic → "App secret", not the access token. Every webhook 403'd (`SIG_INVALID`) until this was fixed. New env var `WHATSAPP_APP_SECRET` wired into `docker-compose.yml`'s `api` service (same "must be explicitly listed or `.env` having a value does nothing" gap as prior sessions — see docker-compose env wiring gap note).
  5. **`express.raw()` → `express.json()` chaining left `req.body` empty** even after the signature bug was fixed — `express.json()` can't re-read an already-consumed stream, so the handler processed zero entries despite returning 200. Fixed by parsing the raw Buffer manually (`JSON.parse(buf.toString('utf8'))`) instead of chaining a second parser, same pattern as WiPay. **A 6th, smaller bug surfaced once messages actually parsed:** `prop_whatsapp_messages.message_type` CHECK constraint requires uppercase (`TEXT`/`TEMPLATE`/…) but Meta sends lowercase (`text`) — the INSERT violated the constraint and rolled back the whole inbound transaction (enquiry included). Added `dbMessageType()` normalizer in `whatsapp-webhook.ts`.

  Each fix was verified independently by POSTing a correctly-HMAC-signed synthetic payload directly to the endpoint from inside the container (`docker exec jag-api node -e "..."`, computing the signature with the real `WHATSAPP_APP_SECRET` at each step) and confirming the DB row landed — this is now the standard way to test this endpoint without waiting on Meta's delivery/retry timing, which throttles heavily after a burst of non-200 responses (took Meta ~15+ min to resume real deliveries after the earlier 403 burst even once the fix was live). Test/synthetic rows are always deleted after confirming (raw SQL DELETE on prod requires explicit user confirmation naming the exact rows — asked every time in this session).

  **Also fixed same session:** duplicate-enquiry bug in the same webhook — enquiry lookup only matched via a prior `prop_whatsapp_messages` row linked to an `enquiry_id`, but most enquiries are created by other flows (viewing booked, application submitted) with no such linked message row, so every reply from a prospect who already had an *open* enquiry silently created a new duplicate instead of reusing it. Added a fallback query directly on `prop_enquiries` (most recent row not in `REJECTED`/`WITHDRAWN`/`CONVERTED`) before creating a new one. Verified against real production data (9 pre-existing enquiries for one test number; count stayed at 9 after a new inbound message). The 9 leftover test/duplicate enquiries from earlier simulation sessions were cleaned up (cascade-deleted via `prop_whatsapp_messages`/`prop_applications`/`prop_enquiries`, explicit user confirmation obtained first).

  **Also found + fixed:** `/internal/gps/battery-sync` responds `200 OK` to the cron *before* any DB work runs (fire-and-forget, so cron latency isn't blocked by Traccar/DB round-trips) — this meant a real failure only ever produced a `WARN` log line, invisible to the cron's own "success" log. Found because 4 straight hourly battery-sync failures (23:00–02:00) happened silently during the `jag_app` credential incident below and were only noticed by chance while investigating the WhatsApp fix. Now fires a deduped (1 per 3h) in-app notification on `SYNC_FAILED`, mirroring the existing low-battery alert pattern in the same file (`routes/internal/traccar-event.ts`).

  Full notification pipeline re-verified working end-to-end this session (each tested via a real signed request through the actual endpoint or a direct `enqueueNotification()` call with a realistic payload, confirmed visible in the bell, then cleaned up): GPS low-battery alert, GPS geofence/event alerts, maintenance SLA breach, GPS battery sync-failure (new). Commits `7bc6f1c`, `b72efaf`, `58ddfea`.

- **`jag_app` transient auth failures — RESOLVED, not a real credential problem 2026-07-13 (session 41)**: Mid-session, the API went briefly `not_ready` (`database_unreachable`) right when a routine `docker compose up -d --force-recreate api` picked up a fresh, failing `jag_app` DB auth. Traced to Robert concurrently running a local expense-ingestion pipeline (`Laptop Cleaning Up and Reconciliation/Claude/digital-os/`, `post_expenses.py` — generates `fin_expenses` DRAFT-row SQL, does not connect live; the *apply* step runs `psql -U jag_app` directly on the VM) — that project's own code comments document a known history of a mangled `PGPASSWORD` (stray CRLF from a Windows-edited file). The real password (in `/opt/jag/jag-infra/.env`) was never actually changed; confirmed by testing it directly and by all 5 DB pools authenticating cleanly moments later. **Lesson:** a `docker compose --force-recreate` forces fresh authentication on a previously-fine pool — if credentials are being fiddled with concurrently by another process against the same Postgres instance, a recreate can appear to "break" the API even though nothing is actually wrong; check `docker exec <svc> node -e "new Pool({connectionString:...}).query('SELECT 1')"` per-DB before assuming a real rotation happened.

- ~~**E-signature integration (DocuSeal) — BLOCKED**~~ — **DONE 2026-07-08 (session 39), switched to Documenso**: DocuSeal's free self-hosted edition was confirmed (session 38) to 404 "Pro Edition" on create-submission-from-PDF. Before rebuilding anything, ran a live smoke test against a throwaway self-hosted **Documenso** (AGPL-3.0) instance — create-from-PDF → recipient → field → distribute all worked on the free Community Edition with no license gate, confirmed via a real API token before committing to the rebuild. Replaced end-to-end: `lib/documenso.ts` (was `lib/docuseal.ts`, same `createSigningSubmission()` shape so callers barely changed), `routes/internal/documenso-webhook.ts` (uses a proper `X-Documenso-Secret` header — Documenso supports this, unlike DocuSeal's token-in-URL-path workaround; real trigger name is lowercase `document.completed`, not `DOCUMENT_COMPLETED` as prose docs implied — confirmed via the live Webhooks UI dropdown), migration `044_documenso_columns.sql` (jag_properties, additive — old `docuseal_submission_id` columns left in place, dead/unused). Infra: `documenso` Docker service (own native-PG database + role, same pattern as Traccar), reverse-proxied at the same `sign.jagcorporate.com` subdomain (no DNS change), `DOCUMENSO_DISABLE_TELEMETRY=true`, `NEXT_PUBLIC_DISABLE_SIGNUP=true` set once Robert's owner account existed. **One live-test bug found and fixed post-deploy:** signing URLs were built from `DOCUMENSO_BASE_URL` (internal Docker hostname `documenso:3000`) instead of a public base — added `DOCUMENSO_PUBLIC_BASE_URL=https://sign.jagcorporate.com`, same class of mistake as the MinIO presign issue (see MinIO section below, hit independently while testing photo uploads in the same session). AGPL note: only a **modified** Documenso build triggers the network-source-disclosure clause (confirmed via Documenso's own licensing docs) — calling the stock API/UI from `jag-api` does not, so no obligation here unless a future session forks Documenso's own code. Known CVE history checked: CVE-2024-52271 (HIGH, PDF-layer-flattening/content-spoofing bug, fixed via linked PR, very likely already patched in the `:latest` image pulled) and CVE-2026-13543 (LOW) — no independent third-party security audit found, comparable risk posture to the platform's other self-hosted OSS pieces. See [[project-esignature-documenso]].
- **Printable receipts + wet-sign lease upload — DONE 2026-07-11 (session 40)**: Robert clarified tenancy agreements/receipts are with **Robert Johnson-Attin personally**, not "JAG Properties" (the lease PDF `lib/lease-pdf.ts` already correctly named him — no change needed there). Fixed receipts to match, keeping the JAG Properties brand: rent + deposit receipt HTML (`rent-schedule.ts`/`deposits.ts` `generate*ReceiptHtml`) gained a "Landlord: Robert Johnson-Attin" row + "Received with thanks by Robert Johnson-Attin, Landlord" footer; frontend WhatsApp receipt text (`PropertiesPanel.tsx formatReceipt`) got the same lines; the 2 WhatsApp receipt templates were recreated with the line as `jag_rent_receipt_full_v2` / `jag_onb_deposit_receipt_v2` (originals name-locked on delete — same Meta bug, see below). **Also found and fixed while asked "how do I print for non-WhatsApp tenants":** the Rent Schedule "Receipt" link was a bare `<a href>` to an auth-gated endpoint → silent 401 (browser can't attach the Bearer token); fixed via new `api.openHtml()` helper (fetch with token → blob → open tab). Deposit receipts had a working backend endpoint but **no UI button at all** — added "Print receipt". Added a "Print / PDF" button to the WhatsApp Receipt modal too (client-rendered, since that path has no server HTML endpoint). **New: wet-sign paper workflow** — `POST /properties/:id/leases/:id/upload-signed` (multer + MinIO, marks lease `SIGNED`, sets `signed_pdf_object_key`/`agreement_signed_at` — reuses migration-043 columns, no new migration) + `GET /properties/:id/leases/:id/signed-pdf`; Leases UI gained "⬆ Upload signed" + "✅ Signed copy" download. Full non-WhatsApp workflow: download lease PDF → print → wet-sign → scan → upload signed; rent/deposit receipts print via the fixed buttons. Deployed + committed (`c70de3c`).
- **WhatsApp templates — BUILT + DEPLOYED 2026-07-11 (session 40), awaiting Meta approval**: All **30 templates created** on WABA `1345040596988860` (all PENDING Meta review — new/unverified WABA = slow first review); `jag_adv_new_listing` stayed permanently delete-locked so it's **`jag_adv_new_listing_v2`** in code (and 2 receipt templates hit the same lock later — see entry above, now `_v2`). **All aligning code changes deployed + committed** (`42a69c1`, `9f9330d`, `c70de3c`): new `lib/payment-config.ts`; `sendTemplate` default lang `en`→`en_US`; area-only ads via `prop_properties.city`; payment block from `JAG_BANK_*` env; signing/maps/booking buttons send path/token only; lease-signing WA moved from `sendText`→`jag_onb_lease_ready` template in `properties.ts`; `applications.ts` send-lease-signed template send disabled. Payment/contact env (`JAG_BANK_ACCOUNT_NAME`/`_TYPE`/`_NO`=2503082, `JAG_MANAGER_PHONE`=868-753-2637, `PUBLIC_APPLY_BASE_URL`) added to `.env` + wired into `docker-compose.yml` api block; container force-recreated, health `ready`, env verified. Public `/apply` Stage-2 rental-application form also built + deployed this session (migration `045_enquiry_application_token.sql`, `routes/properties/public-apply.ts`, `pages/PublicApply.tsx`). **Still pending: Meta approval of all templates (then run scratchpad `wa-send-proof.js` delivery test to 18682912787)**. Full detail in [[project-whatsapp-business-registration]]. Original session-40 discovery notes below.
- **WhatsApp templates all missing — (session 40 earlier, superseded by entry above): number confirmed LIVE, but 0 of ~30 code templates existed in Meta**: Tested the full "broadcast enquiry" send path end-to-end (temp enquiry against Apt C1, real enquirer lookup, send restricted to test number `18682912787` only). **The propagation worry from session 39 is RESOLVED** — a `hello_world` probe returned `(#131058) can only be sent from Public Test Numbers`, which proves the number `868-277-3726` is a fully-provisioned production sender (Meta accepts & processes sends; token valid per `debug_token`; env wired; registered). **The real blocker:** every real send fails `(#132001) template ... does not exist`. The code drives ALL notifications through `sendTemplate` (~30 distinct templates), and the production WABA (**`JAG Properties`, WABA id `1345040596988860`**, business_id `2898193900525983`, business verification = **Unverified**) has ONLY the default `hello_world` — none of the JAG templates were ever created (send path was a silent no-op until session 39 wired the env). **Two structural code issues found** (see [[project-whatsapp-business-registration]] memory + the "docker-compose env wiring gap" section): (1) URL-button mismatch — `jag_adv_new_listing`/`jag_enq_auto_reply`/`jag_enq_screening_approved` pass the FULL booking URL as the button var, but Meta only allows static-domain + `{{1}}` suffix → template button must be `https://jagcorporate.com/book/{{1}}` and those 3 call sites must send only the slug; (2) `jag_enq_post_viewing` is sent with 2 params from `enquiries.ts` but 1 from `viewings.ts` (one caller always fails) → split template or unify callers. **Plan (Robert chose "prove with 2-3 first"):** created + submitted 3 proof templates via `POST /{WABA}/message_templates` — `jag_adv_new_listing` (MARKETING, id 1576397840807327, w/ corrected `…/book/{{1}}` button), `jag_rent_receipt_full` (UTILITY, id 1686079415937788), `jag_rent_reminder_d1` (UTILITY, id 1319281970291837). **All 3 stuck PENDING >1h (submitted ~12:09 UTC, still pending 14:04 UTC)** — normal slow first-template review on an unverified/new WABA, NOT rejected. **RESUME TOMORROW:** re-check `GET /{WABA}/message_templates?fields=name,status` (WABA `1345040596988860`); when APPROVED, run the staged delivery test (scratchpad `wa-send-proof.js` logic — send each to `18682912787` with correct params; URL button gets the SLUG ONLY `apt-c1-df2c43d2`, not the full URL) to confirm real delivery; then build the remaining 27 templates + the 2 code fixes + deploy. Full 30-template param spec was extracted this session from every call site. Completing business verification would raise messaging limits & likely speed review. **Do NOT claim WhatsApp notifications work until templates are APPROVED (not just created).** Prior session-39 write-up (below) is preserved for history.
- **WhatsApp Business number never actually sent anything — DONE 2026-07-08 (session 39), delivery pending Meta propagation**: While live-testing Documenso, discovered `docker-compose.yml`'s `api` service had **never** actually passed `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` into the container — only `WHATSAPP_VERIFY_TOKEN` (inbound webhook) was wired. This means every WhatsApp send documented as "live" in prior sessions (rent reminders, viewing reminders, renewal notices, lease signing links) had been silently no-op'ing (`lib/whatsapp.ts` `SEND_SKIP` guard) in production the whole time. Fixed: added both vars to `docker-compose.yml`; generated a real permanent System User access token in Meta Business Suite (Business Settings → System Users → jag-api, assigned to both the JAG Platform app and — was blocked repeatedly by a `developers.facebook.com` account-confirmation checkpoint that kept erroring until Robert confirmed his business email via a link in his inbox, which cleared it); registered the sending number `+1 868-277-3726` with the Cloud API via `POST /{phone_number_id}/register` (one-time step, needed a chosen 2FA PIN — `716042`, saved to password manager) — this specific step was the actual root cause of `(#133010) Account not registered` errors on every send attempt. **Confirmed working on our side:** a direct test send returned `200` with a real Meta message ID and correct `wa_id` match. **Not yet confirmed delivered:** the test recipient's WhatsApp client still shows `868-277-3726` as "not on WhatsApp" — likely normal propagation lag for a freshly-registered Cloud API number (can take hours to become visible in WhatsApp's directory even though the sending API works immediately); no error, no failed-webhook callback, nothing more diagnosable from our side — recheck in a day before treating as a real problem. If a lease is sent for signing before this settles, the tenant gets a working `sign.jagcorporate.com` link either way (Documenso, independent of WhatsApp) — WhatsApp is just the delivery channel for that link. **Also discovered while chasing this:** `storage.jagcorporate.com` (MinIO public presign endpoint) had the exact same "documented as deployed, never actually was" problem — see MinIO section below.
- ~~**Insurance calendar sync button + timezone date-display bug**~~ — **DONE 2026-07-06 (session 37)**: Robert reported insurance expiry-date Google Calendar events "not working." Root cause: the create/PATCH calendar sync (session 35) only fires going forward — pre-existing policies never got an event since there was no backfill sweep. Fix: added a "📅 Sync to Calendar" button to `InsurancePanel.tsx` (Finance → Insurance), calling the existing owner-only `/admin/calendar/backfill` endpoint (already covered vehicles/inspections/all insurance types, just wasn't surfaced outside Inventory → Vehicles). Separately found and fixed the actual reported symptom: the shared `fmtDate()` display helper (`jag-web/src/lib/entities.ts`) — and 10 duplicated local copies across CRM/DocVault/DragonBridge/Entertainment/Family/Inventory/JABCO/NLCB/Purchasing/Succession — showed date-only values one day early in Trinidad's timezone (`new Date('2026-09-30').toLocaleDateString()` parses as UTC midnight, shifts back to Sept 29 local). Nothing was actually broken in the data or the calendar event itself — confirmed directly against the live Google Calendar event and the DB row. See "Displaying date-only values" rule above. Also hit and resolved a concurrent-session git stash false-alarm mid-session (another session was working on the properties/booking feature at the same time) — no data was actually lost, see [[feedback-concurrent-session-shared-workdir]].
- ~~**Fuel logging UX overhaul + Expense↔vehicle two-way sync**~~ — **DONE 2026-07-05 (session 34)**: Web quick fuel-entry redesign (Inventory → Vehicles → Manage → Fuel & Costs) — primary fields are now Date/Odometer/Amount Paid; price/litre pre-fills from the vehicle's last fill-up (editable); litres is always derived (`amount ÷ price`), never typed; fuel type/station/notes moved behind a collapsed "more details" toggle. Fixed a pre-existing display bug where the fuel log table/TS type used wrong field names (`fill_date`/`price_per_litre`/`mileage_km`/`full_tank` vs actual `log_date`/`cost_per_litre_ttd`/`odometer_km`/`is_full_tank`) — Date/Price/Odometer/Full-tank columns had been rendering blank since the tab shipped. **Mobile:** JAG Mobile's `/expense-form` gained a Vehicle picker for category=FUEL (new `jag-mobile/src/api/vehicles.ts`), same prefill/derive-litres pattern. **Two-way sync fixed:** `autoInsertFuelLog()` (expense→fuel log, session 30) had never actually worked — `idempotency_key: 'exp-${expenseId}'` was a string against a `uuid` column, silently failing every insert; fixed to pass the expense ID directly. Also fixed a tenant-mismatch bug in the same function (was using the expense's free-choice `owner_entity_id` as the vehicle's RLS tenant scope instead of `req.rlsCtx.tenantId`). Added the missing reverse direction — `autoInsertFuelExpense()` (new, `routes/ims/vms-costs.ts`) — so logging a fill-up directly on the vehicle tab now also auto-creates a `SUBMITTED` FUEL expense in Finance. Also fixed a 3rd recurrence of the Zod `limit` cap bug (Expenses.tsx's FUEL vehicle picker sent `limit:200` against `ims/vehicles.ts`'s `max(100)`, silently emptying the dropdown). **Not backfilled:** fuel logs/expenses created before this fix were not retroactively synced. See [[project-fuel-logging-sync]].
- ~~**GPS vehicle tracking (Traccar)**~~ — **FULLY LIVE 2026-06-26 (sessions 27–29)**: Traccar deployed + all 5 SIM devices live. Battery monitoring (session 28): `gps_battery_log` table (migration 037), hourly cron (`gps-battery-monitor.sh`), battery bars + sparkline in Trackers modal. **Session 29 ops fixes:** TRACCAR_PASSWORD mismatch (Robert changed Traccar UI password to `JAGFleet` but .env still had old value → all GPS proxy calls returning 401 silently; fixed by updating .env + force-recreating api); TEF 5411 battery died mid-cutover (charging, will auto-reconnect when driven); GPS history route now auto-zooms to extent (`FitBounds` component, commit `487558d`); fuel log field name mismatch fixed in `api/ims.ts` — Zod `.strict()` requires `log_date`/`cost_per_litre_ttd`/`odometer_km`/`is_full_tank`/`idempotency_key`, commit `2edb013`. **Pending:** PDZ 7719 reporting interval config (`upload123456 30` + `sleep123456 1` + `dormancy123456 3600`) deferred after trial runs; Q8 + JTK905B spare need SIMs + 3rd Oracle port (gt06) when provisioned. See [[project-gps-traccar]].
- **Secrets hygiene — ROTATED 2026-06-24 (mostly resolved)**: live credentials were historically committed to git (CLAUDE.md table — scrubbed to ‹SECRETS VAULT›). All 6 truly-exposed secrets were **rotated** on production so the leaked copies (in git history + private repo + script fallbacks) are now **dead/inert**: KC `jag-api` client secret, KC admin password, MinIO root + jag_app keys, PG `postgres` + `jag_app` passwords. New values live only in `/opt/jag/jag-infra/.env` (compose interpolation) + `/opt/jag/jag-infra/.cron-secrets` (chmod 600, sourced by crontab — inline cron secrets removed). FDW user mappings refreshed for the jag_app rotation. Verified end-to-end (5/5 DBs, FDW, auth, file ops, health 200).
  - **`MINIO_KMS_SECRET_KEY` — ROTATED 2026-06-24** via full re-encryption migration (8 objects downloaded plaintext → key swapped → re-uploaded under new key → md5-verified identical). **CRITICAL GOTCHA:** rotating the KMS key **wipes MinIO's IAM store** (users + policies are KMS-encrypted → "failed to decrypt ciphertext" after swap). Recovery: recreate the `jag-app-buckets` policy + `jag_app` user with a fresh secret, update `MINIO_SECRET_KEY` in `.env`, restart api (done). Root user survives (env-based). See MinIO operational notes.
  - **Exceptions (still open):** (a) Mobile **keystore password** — deferred (low urgency; only affects future signed Android builds). (b) Operational-script **hardcoded fallbacks** (`${KC_CLIENT_SECRET:-FIjMq…}` etc.) still hold the **now-dead** old values in git — harmless (cron sources `.cron-secrets` which overrides them); optional cosmetic cleanup. (c) Old git history retains the dead values — no rewrite needed since they're inert.
  - Rollback artifacts on VM (chmod 600): `/opt/jag/.rotation-rollback-*.env`, `/opt/jag/.crontab-backup-*.txt`, `/opt/jag/backups/pre-rotation-*` (pg_dumps), `/opt/jag/reenc-*/minio-raw-backup.tar.gz` (old-key encrypted objects). `scripts/stmt-watcher/.env.stmt-watcher` removed from git + gitignored.
  - **Where the new secrets live:** authoritative copies inside each system (Keycloak/Postgres/MinIO); operational copies in `/opt/jag/jag-infra/.env` + `.cron-secrets` (chmod 600, not git). A labeled vault was exported to Robert's Desktop (`JAG_SECRETS_VAULT_<date>.txt`) on 2026-06-24 for him to paste into Google Password Manager then delete — **no standalone password-manager/secrets-vault system is wired in** (the CLAUDE.md ‹SECRETS VAULT› label points at the VM `.env` + Robert's password manager). See [[project-secrets-and-env]].
- ~~**Frontend gap audit — pending-review consolidation**~~ — **DONE 2026-06-24 (session 26)**: AI `suggested_category`/`confidence` surfaced in TransactionsPanel review modal; orphaned `fin_pending_review_queue` row now closed on category PATCH (was leaking).
- ~~**Frontend gap audit — Accountant Export UI**~~ — **DONE 2026-06-24 (session 26)**: `pages/Export.tsx` (nav `/export`), 7 read-only finance views + per-view CSV (`lib/csv.ts`).
- ~~**Frontend gap audit — Succession (estate) UI**~~ — **DONE 2026-06-24 (session 26)**: `pages/Succession.tsx` (nav `/succession`) over `fam_succession_documents`; `GET /succession/documents/:id` added for storage_path/download.
- ~~**Frontend gap audit — IMS photo 401**~~ — **DONE 2026-06-24 (session 26)**: item/vehicle photos were bare `<img src>` against header-only auth-gated streaming route → 401; new `AuthedImg` + `api.objectUrl()`; `photoDownloadUrl` made BASE-relative (also fixed a double `/api/v1` prefix). See "Auth-gated streaming assets" rule above.
- ~~**Frontend gap audit — In-app notifications**~~ — **DONE 2026-06-24 (session 26)**: `lib/notifications.ts` `enqueueNotification()` + 4 producers (expense submit, P1/P2 ticket, SLA breach, enquiry); `GET /notifications/unread-count` + `PATCH /notifications/read-all`; `NotificationBell` in AppShell. **Deferred:** document→REVIEW producer (external Ollama batch, no API hook); tier 2/3 scheduled digests. Optional ops: set `NOTIFY_OWNER_USER_ID` in VM `/opt/jag/.env` (fallback works).
- ~~**Frontend gap audit — Family registry UI**~~ — **DONE 2026-06-24 (session 26)**: `pages/Family.tsx` (nav `/family`) + `api/family.ts` over existing `fam_family_members` CRUD; card grid + add/edit modal.
- ~~**Registry-as-index — DocVault + loyalty + lifestyle linkage**~~ — **DONE 2026-06-24 (session 26)**: assign documents/loyalty/health-metrics to a person; per-module filters; Family card badges + member-modal sections. DocVault `PATCH /files/:id` + loyalty PATCH `family_member_id` added.
- ~~**Beneficial-ownership cap table (who owns what — succession)**~~ — **DONE 2026-06-24 (session 26)**: `fam_ownership_stakes` (migration 017) + `routes/family/ownership.ts` + `pages/Ownership.tsx`; % shares over entities/properties/items; per-person estate rollup via net-worth; net-worth double-count guard. Covers business-entity ownership (e.g. BAR+Club → Zhanghua). **Follow-ups:** ownership history table, per-owner liabilities, inline assign from Properties/IMS screens.
- ~~**WiPay webhook**~~ — **REMOVED**: WiPay does not issue webhooks to individuals; rents paid directly to personal bank accounts
- ~~**Rent proof workflow**~~ — **DONE**: endpoint `GET /properties/:propertyId/rent-payments/:paymentId/receipt` live in `routes/properties/properties.ts`; frontend copy/WhatsApp share in PropertiesPanel.tsx
- ~~**Migration 009 collision (jag_properties)**~~ — **FIXED 2026-06-12**: renamed to `009b_prop_properties_audit_cols.sql`; production `__migrations` updated; 010 registered
- ~~**FDW DR password gap**~~ — **FIXED 2026-06-12**: `005b_fdw_setup.sql` now uses psql `:'JAG_APP_PASSWORD'` variable substitution (STD-07); `jag-infra/scripts/fdw-rotate-password.sh` added for credential rotation. **Production action required:** run `fdw-rotate-password.sh` once to resync existing USER MAPPINGs on the live VM.
- ~~**user_tenant_roles empty**~~ — **FIXED 2026-06-12**: Robert (Owner/JAG_HOLDINGS), Wife (Auditor/JAG_HOLDINGS), Brian real KC user (Staff/NLCB) all provisioned; pre-existing rows for 6 other tenants confirmed active
- ~~**Wife missing jag_auditor Keycloak role**~~ — **FIXED 2026-06-12**: assigned via admin API; Wife email confirmed `zhanghuachang22@gmail.com`
- ~~**MinIO buckets missing**~~ — **FIXED 2026-06-12**: all 4 buckets created (`jag-bank-statements`, `jag-receipts`, `jag-documents`, `jag-photos`)
- ~~**Grafana + Promtail never started**~~ — **FIXED 2026-06-12**: containers were in `Created` state for 5 days; now running; logs flowing to Loki
- ~~**Oracle boot-volume backup policy**~~ — **DONE 2026-06-12**: Bronze policy applied to jag-primary boot volume; orphan second volume terminated 2026-06-14
- ~~**Boot volume at 47 GB (Oracle default)**~~ — **DONE 2026-06-14**: expanded to 200 GB (Always Free max); partition + filesystem extended online; 180 GB free (8% used)
- ~~**Stale net worth snapshot (11 Jun)**~~ — **FIXED 2026-06-12**: snapshot captured property valuations of `JAG Properties Management` and `62 Ariapita Avenue` before they were cleared; deleted stale rows; fresh snapshot regenerated — consolidated NW now $12,207,370.50 ✓
- ~~**WebAuthn device registration (Robert)**~~ — **CONFIRMED 2026-06-12**: Robert's passkey already registered in Keycloak (`type: "webauthn"` credential exists)
- **WebAuthn device registration (Brian, Wife)** — PENDING; each needs an in-person browser session at `https://auth.jagcorporate.com/realms/jag/account`; no fingerprint reader required — Windows Hello PIN works on any Windows 10/11 machine
- **Ollama vision** — `DRY_RUN=false` ✓; text-PDF extraction working; scanned PDFs use vision model. **Use `llava` not `llama3.2-vision`** — mllama architecture not supported by Ollama 0.30.8 on this machine (error: unknown model architecture 'mllama'). `.env.ollama-batch` already set to `OLLAMA_MODEL_VISION=llava`. Run `ollama pull llava` (~4.7GB) to enable scanned-PDF extraction. Until then, scanned docs land in REVIEW with nulls — fill manually in Finance → Documents.
- ~~**Chart of Accounts (A2)**~~ — **DONE 2026-06-12**: 150 accounts across 7 entities seeded via `migration/coa-populate.js`; GL route fix (23505 error code) committed `621a976`
- ~~**FX Rates (A3)**~~ — **DONE 2026-06-12**: `jag-infra/scripts/fx-rates-sync.sh` seeds rates from open.er-api.com daily at 06:00 TT via VM cron; today's seed: 1 USD = 6.7829 TTD, 1 CNY = 0.9993 TTD
- **JAG Plantations / JAG Trading** — future phases; placeholder pages exist in frontend
- ~~**JAG Entertainment UI** — BAR + Members Club frontend not yet built~~ **DONE**
- ~~**DragonBridge UI** — China sourcing / forex frontend not yet built~~ **DONE**
- ~~**JAG Finance advanced** — intercompany eliminations UI, insurance UI not yet built~~ **DONE**
- ~~**Bank Statements UI**~~ — **DONE 2026-06-13**: drag-and-drop batch upload panel in Finance → Bank Statements tab; per-file account assignment; parallel upload; job history with delete; `fin_bank_statement_jobs` table; `routes/finance/bank-statements.ts`
- ~~**MinIO SSE-S3 encryption**~~ — **DONE 2026-06-12**: all 4 buckets encrypted via `MINIO_KMS_SECRET_KEY`
- ~~**MinIO jag_app user creation**~~ — **DONE 2026-06-13**: user `<jag-app-access-key>` created (was never provisioned despite env vars being set); `jag-app-buckets` policy attached
- ~~**MinIO bucket IAM policy**~~ — **DONE 2026-06-13**: `jag-app-buckets` policy limits jag_app to 4 authorised buckets; `jag-infra/scripts/setup-minio-policy.sh` for re-provisioning
- ~~**MinIO audit log → Loki**~~ — **DONE 2026-06-13**: `audit_webhook:loki` configured in MinIO; `POST /internal/minio-audit` in jag-api logs every file operation to Grafana/Loki under `entity="MINIO_AUDIT"`
- ~~**Auto-expire stale PENDING jobs**~~ — **DONE 2026-06-13**: `jag-infra/scripts/cleanup-stale-statements.sh` runs daily at 07:00 UTC (03:00 TT) via VM cron; deletes PENDING jobs + MinIO objects older than 7 days
- ~~**Financial document extraction (loans, investments, insurance)**~~ — **DONE 2026-06-13**: two-path architecture deployed; `fin_document_jobs` table (migration 008); `routes/finance/document-jobs.ts`; Path 2 `/import` endpoints on loans, investments, insurance, bank-statements; `scripts/doc-import/` local extraction CLI; `scripts/ollama-batch/` extended to process `fin_document_jobs`; Finance → Documents tab in frontend
- ~~**Finance → Documents tab 404 investigation**~~ — **RESOLVED 2026-06-15 (session 9)**: Investigated fully. All `/api/v1/finance/document-jobs/*` endpoints return 401 (correct auth gate) both directly and through Caddy proxy. `fin_document_jobs` table confirmed present. 404 was a transient initial-deployment issue, no longer reproducible. Also found and fixed: migrations 009/010/011 (jag_family) and 012 (jag_properties) were applied via raw psql but not recorded in `__migrations`; inserted missing rows so future `node-pg-migrate up` won't re-apply them.
- ~~**Personal/family entity UUIDs missing from Finance dropdowns**~~ — **DONE 2026-06-14**: added Personal — Robert (008) + Isabella (009), Phillip Ajack (010), Brian (011), Zhanghua Chang (012), Theresa (013) to Accounts, Investments, Insurance, Loans panels; UUIDs registered in `entities.ts` and CLAUDE.md; no migration needed (`owner_entity_id` is a free UUID grouping field in `jag_family` DB)
- ~~**zh-CN.json JSON syntax error**~~ — **FIXED 2026-06-14**: unescaped ASCII double quotes inside `whatsappHint` string on line 967 were silently breaking the Vite build; escaped as `\"`
- ~~**Full frontend i18n (Simplified Chinese)**~~ — **DONE 2026-06-14**: all pages and components translated via react-i18next; language switcher in top-right header; locale files at `jag-web/src/locales/en.json` and `zh-CN.json`; namespace prefixes: `common`, `nav`, `fin`, `prop`, `tenants`, `pipeline`, `inv`, `jabco`, `ent`, `db`, `crm`, `lifestyle`, `ledger`, `expenses`, `dragonbridge`, `brianAdmin`, `brianPortal`, `placeholder`
- ~~**Investment Update modal overhaul**~~ — **DONE 2026-06-15**: Update modal now edits all 12 fields (investment_type, asset_name, institution_name, ticker_symbol, units_held, average_cost_per_unit, current_price, current_value_ttd, unrealised_gain_ttd, maturity_date, last_valued_at, notes); auto-calculation of `current_value_ttd = units × price` with manual override; `fmt()` helper strips pg numeric trailing zeros; `Investment` interface corrected (was using wrong field names `quantity`/`cost_basis_ttd`); `ANNUITY` added to `InvestmentType` union and `INVESTMENT_TYPES` array
- ~~**Investment valuation history**~~ — **DONE 2026-06-15**: `fin_investment_valuations` append-only table (migration 009 jag_family — ran on VM); auto-insert valuation row on every PATCH; History modal in InvestmentsPanel with view + "+ Add Past Entry" backfill form; `GET /:id/valuations` and `POST /:id/valuations` endpoints; `InvestmentValuation` type in `finance.ts`; `getInvestmentValuations` + `addInvestmentValuation` in `finance api`
- ~~**CALYPSO MACRO INDEX FUND validation error**~~ — **FIXED 2026-06-15 (session 9)**: `maturity_date: Invalid` Zod error caused by PG DATE column arriving as ISO datetime string (`'2025-12-31T00:00:00.000Z'`); frontend was initializing `maturity` state with raw value (showing empty in date input but submitting the full ISO string, failing `^\d{4}-\d{2}-\d{2}$`). Fix: slice to 10 chars in `useState` init (same pattern as `valuedDate` for `last_valued_at`); added regex guard before submit. Deployed.
- ~~**6 TTSE stocks investment_type + institution_name**~~ — **DONE 2026-06-15 (session 9)**: corrected via Update modal after CALYPSO fix unblocked it
- ~~**History principle across loans, insurance, properties**~~ — **DONE 2026-06-15 (session 8)**: 3 migrations (010 jag_family, 011 jag_family, 012 jag_properties) ran on VM; backend PATCH auto-insert + GET/POST history endpoints on loans.ts, insurance.ts, properties.ts; types LoanBalanceHistory, InsurancePolicyHistory, PropertyValuationHistory; API client methods; History button + modal in LoansPanel, InsurancePanel, PropertiesPanel. Deployed.
- ~~**Path 2 investment import — Phillip Ajack TTCD statement**~~ — **DONE 2026-06-15 (session 10)**: First live Path 2 import from local hard drive. PDF was FlateDecode-compressed (pdf-parse v1.1.1 added). TTCD programmatic pre-parser written and shipped — 10 TTSE holdings (AHL, AMCL, MASSY, NEL, NFM, PLD, RFHL, SBTT, UCL, WCO) imported to entity Phillip Ajack (00000000-0000-0000-0001-000000000010), total TTD 1,529,126.52. File remained on local desktop.
- ~~**Full commit + deploy (sessions 8–10)**~~ — **DONE 2026-06-15 (session 10)**: commit `e56037c` — 74 files, 7445 insertions; deploy.sh all 7 steps passed; API + frontend live at jagcorporate.com.
- ~~**JAG Property Tenancy Module (full lifecycle)**~~ — **DONE 2026-06-16 (session 11)**: Complete tenancy lifecycle Advertising → Enquiry → Viewing → Application → Lease → Handover → Rent Collection → Maintenance → Renewal/Exit. 12 new backend routes (`applications`, `deposits`, `enquiries`, `handover`, `listing`, `maintenance-tickets`, `renewals`, `rent-schedule`, `viewings`, `whatsapp-send`, `internal/whatsapp-webhook`); 10 new frontend panels; `jag-web/src/api/tenancy.ts`; 10 new jag_properties migrations (013–022); 5 VM cron scripts (rent-reminders, viewing-reminders, renewal-notices, sla-monitor, post-viewing-app-link). `google-auth-library` installed for Google Calendar booking slots. `response.ts` extended with dual-mode overloads (`ok(data)` + `ok(res,data,status)` both valid). `rls.ts` extended with Pool+ownerId overload. Deployed — all 7 deploy steps passed.
- ~~**Mobile responsive UI pass**~~ — **DONE 2026-06-16 (session 12)**: No separate mobile app needed — existing React + Tailwind stack adapted. 16 files changed. Dashboard KPI/net-worth grids now stack on mobile (`sm:`/`lg:` breakpoints). PropertiesPanel master-detail uses mobile stack pattern (list → tap → detail, back button). All data tables across Finance, Ledger, Properties, Expenses now use `overflow-x-auto` for horizontal scroll on mobile. Insurance/NetWorth/Intercompany summary cards stack on mobile. `common.back`/`返回` added to both locale files. Deployed — frontend-only SCP.
- ~~**JAG Commercial Lifecycle (full pipeline)**~~ — **DONE 2026-06-16 (session 13)**: Full bid lifecycle Lead→Win/Loss→Execution→Closeout per `JAG_COMMERCIAL_LIFECYCLE_BUILD_SPEC.md`. **Migrations** (8 files, 016–023): `pipeline_stage` gains SUBMITTED/NO_GO; `project_status` gains AWARDED; 7 new columns on `crm_sales_pipeline` (pipeline_type, bid_deadline, linked_project_id, etc.); `jabco_bid_log` append-only table (log_type incl. WON); BOQ margin columns; VO `time_extension_days`; `jabco_project_tasks`; punch list / site incidents / quality inspections tables; `handover_document_url` on projects. **Backend**: `routes/crm/pipeline.ts` (8 endpoints incl. Go/No-Go, Submit, Win/Loss, intelligence); `routes/jabco/project-tasks.ts`; `routes/jabco/punch-list.ts` (state-gated IDENTIFIED→RECTIFIED→VERIFIED); `routes/jabco/site-incidents.ts`; `routes/jabco/quality-inspections.ts`; `projects.ts` updated (AWARDED status, closeout guard — blocks CLOSED if open punch items or no handover doc, fires `jabco.project_closed` outbox event); `payment-certs.ts` VO approval now rolls `contract_value` + `expected_end_date` in same transaction. **Frontend**: `types/pipeline.ts` + `api/pipeline.ts` (new); `types/jabco.ts` + `api/jabco.ts` extended; CRM page gains "Tender Pipeline" tab (kanban desktop / filtered list mobile; Go/No-Go modal with background intelligence query; Submit + Win/Loss modals); JABCO project detail gains 5 new tabs — Tasks, Punch List, Incidents, Quality, Closeout; BOQ shows margin columns when status=TENDER/AWARDED. **i18n**: `tender` namespace added to both locale files; `jabco` namespace extended with all new keys. Deployed — migrations 016–023 applied to `jag_commercial` on VM; API rebuilt (`docker compose build api`); frontend SCP'd; `api.jagcorporate.com/health/ready` ✓. Commit `60be2f3`.
- ~~**IBKR investment import (3 accounts)**~~ — **DONE 2026-06-17 (session 15)**: Imported positions from 3 Interactive Brokers accounts: U21242678 (Phillip Ajack, entity 010), U2428207 (Personal — Robert, entity 008), U4022018 (Personal — Robert, entity 008). `parseIbkrForexBalances()` added to `scripts/doc-import/src/extract.ts` for Forex Balances CSV section (USD-base accounts have no foreign cash to parse). Phillip's first-batch duplicates (6 rows, wrong TTD values) deleted via SQL; second batch at 04:52:30 kept. USD Cash positions entered manually as CASH_EQUIVALENT. 3 USD Cash DB entries corrected via SQL (`current_value_ttd` had been stored in USD; fixed by multiplying by 6.774869 rate). `jag-web/src/api/finance.ts` `createInvestment` param renamed `cost_basis_ttd` → `average_cost_per_unit` to match Zod schema.
- ~~**InvestmentsPanel FX display bug**~~ — **DONE 2026-06-17 (session 15)**: `AddModal` and `UpdateValueModal` both now accept `rateMap` prop and work in native-currency space — entered values multiplied by rate on save, TTD values divided by rate for display. Portfolio total and unrealized gain now sum `current_value_ttd` directly (no rate multiplication). Removed unused `toTTD` helper.
- ~~**Dashboard investments double-conversion**~~ — **DONE 2026-06-17 (session 15)**: `Dashboard.tsx` line 104 was multiplying `current_value_ttd` (already TTD) by `rateMap[currency]` again. Fixed to `investments.reduce((s, i) => s + parseFloat(i.current_value_ttd ?? '0'), 0)`. Inflated USD holdings ~6.77x — dashboard showed ~$34.6M for investments; correct value is now shown.
- ~~**IMS valuation double-counting fixed assets**~~ — **DONE 2026-06-17 (session 15)**: `routes/ims/items.ts` summary query counted `is_asset = true` items in both `total_stock_value` AND `total_asset_value`. Fixed: `total_stock_value` now filters `AND is_asset IS NOT TRUE`; `total_asset_value` now uses `SUM(qty * unit_value)` (was `SUM(unit_value)` — omitted quantity). API rebuilt and deployed.
- ~~**CRM contact detail fields + entity cross-linking**~~ — **DONE 2026-06-17 (session 16)**: Contacts now store address (line1/line2/city/state/postal), birthday, notes, land/cell phone labels. `GET /crm/contacts/:id` returns full contact + last 20 interactions. `PATCH /crm/companies/:id` + EditCompanyModal for editing company address. PREQUALIFICATION stage added to pipeline kanban; company dropdown prefetch fix (staleTime:60s on `crm-companies-picker`); `contactCount` pluralization fixed (`Number()` cast). CRM contact detail panel (ContactPanel) with call/WhatsApp/email action links; contacts list rewritten as master-detail layout. New `CrmContactPicker` component (`jag-web/src/components/crm/CrmContactPicker.tsx`) — search-as-you-type with linked contact display (📞💬📱✉️). `CrmContactBadge` for inline read-only card display. `crm_contact_id` (cross-DB soft ref, nullable UUID, no FK) wired into: `prop_contractors` (migration 024 jag_properties), `ent_members` (migration 006 jag_entertainment), `db_clients` (migration 027 jag_commercial). All 7 migrations for this + prior session applied to VM. Commit `7d72654`.
- ~~**JAG Mobile Android app**~~ — **DONE 2026-06-18 (session 17)**: React Native 0.76.3 / Expo 52 bare workflow; expo-router v4; Keycloak PKCE auth; expo-secure-store token storage. Screens: `/login`, `/expense-form`, `/expenses`. Persistent notification widget in Android shade (`@notifee/react-native`, ongoing, `+ New Expense` action). BootReceiver.kt restores notification after restart (exported=false, RECEIVE_BOOT_COMPLETED). Release-signed APK installed on Samsung S24 Ultra via adb. App icon: JAG hexagonal logo white-background mipmap icons. Splash: dark navy + white JAG logo. Live FX rates from `GET /finance/fx-rates` with FALLBACK_FX for offline. Credit/debit card picker from `GET /finance/credit-cards`. Receipt camera upload. Submit button for DRAFT expenses in list.
- ~~**Finance credit/debit cards (platform + mobile)**~~ — **DONE 2026-06-18 (session 17)**: `routes/finance/credit-cards.ts` deployed; `fin_credit_cards` table (migration 012 jag_family); `DEBIT_CARD` enum value (migration 013 jag_family); card picker in mobile expense form. Add real cards via Finance → Expenses in web platform (credit-cards tab not yet in web UI — use API or mobile to manage).
- ~~**WhatsApp template gap analysis + approval queue**~~ — **DONE 2026-06-22 (session 18)**: Full WhatsApp coverage audit. 17 new template triggers wired to backend events. `prop_wa_pending_approvals` table + `prop_contact_log` table (migrations 026–027). `routes/properties/wa-approvals.ts` (pending queue + approve-send + dismiss) and `routes/properties/wa-inbox.ts` (unified conversation timeline). PropertiesWhatsAppPanel updated with Inbox + Pending Approvals tabs. Contractor field added to maintenance tickets. Renamed 3 templates to match Meta approved names (`jag_adv_stale_alert`, `jag_mnt_sla_breach`, `jag_onb_lease_ready`). `stale-listing-alert.sh` VM cron added (09:00 UTC, daily). Deployed.
- ~~**Unit photo upload + auto-listing on vacancy**~~ — **DONE 2026-06-22 (session 19)**: `prop_unit_photos` table (migration 031 jag_properties) + `listing_description` on prop_units. 5 new endpoints on listing.ts (GET/POST photos, upload-url presigned PUT, DELETE photo, PATCH listing-info). `getPresignedGetUrl()` added to minio.ts. `triggerAutoListing()` exported from listing.ts — called automatically by handover.ts on EXIT sign-off (idempotent, skips if already LISTED). Manual List+Broadcast also fetches photos for Facebook (7-day presigned GET URLs). Public booking page returns photos. ManageListingModal in PropertiesPanel: photo gallery (3-col, hover-to-delete), description, asking rent, utilities (WASA/Electricity/Internet), AI Suggest Price. Deployed.
- ~~**Gemini AI rent suggestion**~~ — **DONE 2026-06-22 (session 19)**: Replaced Ollama with Gemini (`responseSchema` guarantees structured JSON — no regex parsing). `GEMINI_API_KEY` set on VM `/opt/jag/.env`. `GEMINI_MODEL=gemini-3.5-flash` set on VM (configurable without code change). Returns `{ min, max, recommended, rationale }`. Field name mismatch between backend and frontend fixed in same PR.
- ~~**CRM Google Calendar follow-up sync**~~ — **DONE 2026-06-22 (session 20)**: `WHATSAPP_CALL` and `WHATSAPP_MESSAGE` added as distinct interaction types (VARCHAR — no migration needed). CRM interaction timestamps now display in Trinidad time (UTC-4 / `America/Port_of_Spain`). `createAllDayCalendarEvent()` added to `google-calendar.ts`; called non-blocking on `POST /crm/interactions` when `follow_up_date` set; `calendar_event_id` written back via `withTenantRLS` UPDATE. Migration 028 (`calendar_event_id TEXT` on `crm_interactions`). Backfill endpoint `POST /internal/crm/backfill-calendar`. ✓/⚠ sync indicator in CRM interaction log. Google service account JSON key stored at `/opt/jag/jag-api/google-calendar-key.json` (volume-mounted read-only) — base64 env var approach caused `invalid_grant` due to encoding corruption. All 8 historical interactions backfilled.
- ~~**Tender Pipeline kanban empty**~~ — **FIXED 2026-06-18 (session 22)**: `GET /pipeline` returned `{ pipeline: rows }` but frontend `pipelineApi.list()` typed response as `{ opportunities: [...] }` — key mismatch caused `data?.opportunities` to always be `undefined`, `opps=[]`, kanban never rendered. Fixed: renamed response key to `opportunities`. Commit `12c93c4`.
- ~~**Companies dropdown empty in Add Contact / Edit Contact / New Opportunity modals**~~ — **FIXED 2026-06-18 (session 22)**: `CompaniesQuerySchema` had `limit: max(100)` but all picker queries send `limit: 200` → Zod 422 → React Query error state → empty dropdown. Raised to `max(500)`. Commit `4a18052`.
- ~~**New Opportunity save error (null assigned_to)**~~ — **FIXED 2026-06-18 (session 22)**: `crm_sales_pipeline.assigned_to` is NOT NULL but `pipeline.ts` POST sent `body.assigned_to ?? null` when not provided. Changed to `body.assigned_to ?? userId` to default to current user. Commit `55e9fb9`.
- ~~**Pipeline list Zod limit cap**~~ — **FIXED 2026-06-18 (session 22)**: `PipelineQuerySchema` also had `limit: max(100)`; `TenderPipelineTab` queries `limit: 200` → 422 → `opps=[]`. Raised to `max(500)`. Commit `6e2dedf`.
- ~~**Tenants company field hidden for non-company tenants**~~ — **FIXED 2026-06-18 (session 22)**: `company_name` field was only visible when `is_company=true` checkbox was checked — individuals had no way to add a company/employer name. Restructured Add/Edit tenant modals: first/last name always shown, company field always shown (labelled optional unless `is_company` checked). Commit `422cb5c`.
- ~~**Pipeline advance + delete actions**~~ — **DONE 2026-06-18 (session 22)**: `POST /pipeline/:id/advance` moves PREQUALIFICATION→LEAD; `DELETE /pipeline/:id` removes non-terminal opportunities (WON/LOST/NO_GO protected — part of bid intelligence). `pipelineApi.advance()` + `pipelineApi.delete()` added to frontend client. OppDetail action panel: green "Advance to Lead" button for PREQUALIFICATION; inline "Delete? Yes/No" confirm for editable stages. Commit `4f7b927`.
- ~~**Google Calendar backfill for vehicles, inspections, insurance**~~ — **DONE 2026-06-23 (session 23)**: `POST /api/v1/admin/calendar/backfill` (owner-only) and `POST /internal/calendar/backfill` (Docker-network-only) create calendar events for all records with dates but NULL event IDs. Date columns cast with `::text` to avoid JS Date object coercion (`"Invalid time value"` bug). 6 vehicle events created. UI button on Vehicles tab.
- ~~**Vehicle consolidation — single edit area**~~ — **DONE 2026-06-23 (session 23)**: Vehicles hidden from Items & Assets tab via `is_vehicle` EXISTS subquery flag on `ims_items` list query. `EditVehicleModal` now has `item_name` field at top (calls both `updateVehicle` + `updateItem` on save). `VehicleManageModal` gains **📷 Photos** tab as first tab — reuses item photo API via `vehicle.item_id`. `Personal — Phillip` added to `VEHICLE_OWNER_OPTIONS`.
- ~~**VMS frontend (Vehicle Management System full UI)**~~ — **DONE 2026-06-23 (session 24)**: `VehicleManageModal` (max-w-4xl, 90vh) added to Inventory → Vehicles tab via "Manage ›" button per row. 4 tabs: **Maintenance** (work orders list + expandable line items + add WO + advance status OPEN→IN_PROGRESS→COMPLETE + PM schedule CRUD); **Fuel & Costs** (TCO summary cards + fuel log table + operating costs table, all with add/delete); **Compliance** (expiry-aware doc vault with red/orange alerts + add/delete); **Disposal** (shows existing disposal record with gain/loss + GL posted status, or form for ACTIVE vehicles — SALE/WRITE_OFF/TRANSFER). New types in `types/ims.ts`: `WorkOrder`, `WorkOrderItem`, `PMSchedule`, `FuelLog`, `OperatingCost`, `VehicleTCO`, `ComplianceDoc`, `VehicleDisposal`, `VehicleStatus`. New API methods in `api/ims.ts` for all VMS resources.
- ~~**Asset disposal — all fixed assets (not just vehicles)**~~ — **DONE 2026-06-23 (session 25)**: Migration 035 (`jag_commercial`) adds disposal columns to `ims_items`. `POST /ims/items/:id/dispose` endpoint validates `is_asset=true && !is_vehicle`, sets `is_active=false`, inserts `ims_stock_movements`, posts optional GL entry to `jag_family` via `postItemDisposalGlEntry()` (mirrors VMS pattern). Frontend: `DisposeAssetModal` in `Inventory.tsx` with type/date/notes/sale price/buyer + optional GL account section; "Dispose" button in `ItemDetailPanel` (assets only, not vehicles); "Show disposed" toggle in Items & Assets filter bar; `DISPOSED` badge + disposal banner on disposed items. "Show disposed" toggle also added to Vehicles tab. Disposed vehicles accessible via Manage › → Disposal tab.
- ~~**Ledger Chart of Accounts — Add Account**~~ — **DONE 2026-06-23 (session 25)**: `+ Add Account` button + `AddAccountModal` in `ChartOfAccounts.tsx`; `glApi.createAccount()` added to `api/gl.ts`. Modal: entity dropdown, code, type, name, auto-derived normal balance (DEBIT for Asset/Expense, CREDIT for Revenue/Liability/Equity/Other Income), optional description, allow-direct-posting checkbox.
- ~~**Ledger Journal Entries — New Entry**~~ — **DONE 2026-06-23 (session 25)**: `+ New Entry` button + `NewEntryModal` in `JournalEntries.tsx`; `glApi.createEntry()` added to `api/gl.ts`. Modal: entity, date, description, reference, dynamic line items (account picker filtered by entity, Dr/Cr toggle, amount field), running Dr/Cr totals with "Not balanced" indicator. Saves as DRAFT; click Post in entry detail to commit.
- ~~**Credit/debit cards web UI**~~ — **DONE 2026-06-23 (session 24)**: `CardsPanel.tsx` created (`jag-web/src/components/finance/CardsPanel.tsx`); Finance → Cards tab added (i18n: en "Cards" / zh-CN "银行卡"). Card grid (1→3 col responsive) showing name, masked number, type badge. Add Card modal (card name, type dropdown CREDIT/DEBIT/CHARGE/PREPAID, last-4 digits with `\d{4}` validation). Edit modal. Inline deactivate confirm (soft-delete — existing expenses unaffected). `CreditCard` interface added to `types/finance.ts`; `getCreditCards`/`createCreditCard`/`updateCreditCard`/`deleteCreditCard` added to `api/finance.ts`.
- ~~**Expense cross-module linking + fuel-log auto-sync**~~ — **DONE 2026-06-26 (session 30)**: Migration 018 (jag_family) adds `linked_record_type/id/label` + `fuel_litres/fuel_odometer_km/fuel_type` to `fin_expenses`. Backend: new fields in Create/Update Zod schemas + INSERT/PATCH; non-blocking `autoInsertFuelLog()` fires when category=FUEL + VEHICLE link + litres provided — inserts `vms_fuel_logs` row with `reference_type='EXPENSE'`. Frontend (`pages/Expenses.tsx`): contextual "Link to record" section in New Expense form — FUEL/TRANSPORT shows vehicle picker; INSURANCE shows Vehicle/Policy toggle; MAINTENANCE shows Vehicle/Property toggle; UTILITIES/TAX_PAYMENT shows property picker; PERSONAL_EXPENSE/MEDICAL/EDUCATION/CHARITY shows family member picker. FUEL + vehicle: extra fields for litres, odometer, fuel type (auto-creates fuel log on save). Linked record shown in amber in detail panel. Nav: **Expenses** (top-level nav item, not under Finance).
- ~~**CRM quick-log for Call/WhatsApp/Email**~~ — **DONE 2026-07-01 (session 31)**: `tel:`/`wa.me:`/`mailto:` action links didn't record anything — clicking "Send Email" just handed off to the OS mail client with no `crm_interactions` row created. Added `crmApi.quickLog(contactId, type, subject)` (`api/crm.ts`) — non-blocking `POST /crm/interactions` fired via `onClick` alongside the native link navigation (does not `preventDefault`), `occurred_at` = now, type CALL/WHATSAPP_MESSAGE/EMAIL. Wired into all Call/WhatsApp/Email links in `pages/CRM.tsx` `ContactPanel` AND the reusable `CrmContactBadge`/`CrmContactPicker` (`components/crm/CrmContactPicker.tsx`) used for linked contacts across Properties, IMS, DragonBridge, Entertainment. This only records *intent to contact*, not confirmed delivery — there's no way to know if the email/WhatsApp message was actually sent from the OS-level handoff.
- ~~**HR Payroll finalize was completely broken**~~ — **DONE 2026-07-01 (session 31)**: two pre-existing bugs (from the original session-30 `feat(hr): salary advances and staff loans` commit, never actually exercised end-to-end) made the Payroll tab unusable. (1) `getPayrollEntries` called `GET /hr/payroll/runs/:id/entries`, which doesn't exist on the backend (only the combined `GET /hr/payroll/runs/:id` returning `{ ...run, entries }`) — the entries table was always empty. (2) `finalizePayrollRun` posted an empty body `{}`, but the backend's `FinalizeSchema` requires `pay_date` (no default) — Finalize always 400'd. Fixed in `api/hr.ts` (`getPayrollRun` replaces `getPayrollEntries`; `finalizePayrollRun` now takes `{ pay_date, ...glAccountIds }`) and `pages/HR.tsx` `PayrollTab` (Finalize now opens a dialog to pick the pay date before posting).
- ~~**HR Payroll GL account mapping**~~ — **DONE 2026-07-01 (session 31)**: `postPayrollGlEntry` (`lib/payroll-gl.ts`) silently skips posting to GL unless `salary_expense_account_id` + `salaries_payable_account_id` are supplied — the frontend never collected them. Finalize dialog now has 6 Chart-of-Accounts pickers (Salary Expense* / Salaries Payable* required, NIS Employer Expense / NIS Payable / PAYE Payable / Health Surcharge Payable optional — blank ones are skipped leg-by-leg), filtered by `account_type` (EXPENSE / LIABILITY) from `glApi.getAccounts({ owner_entity_id })`. Selection is cached in `localStorage` per entity (`hr-payroll-gl-accounts-${entityId}`) since payroll posts to the same accounts every month. An amber warning shows if the two required accounts aren't picked, but does not block Finalize (some may intentionally skip GL posting).
- ~~**HR Payroll — no way to enter actual pay per employee**~~ — **DONE 2026-07-01 (session 31)**: the payroll entries table was read-only; there was no UI for the backend's existing `PATCH /hr/payroll/runs/:id/entries/:entryId` (base_salary_ttd override, overtime hours/rate, bonus, other allowances/deductions, unpaid leave days, INCLUDED/EXCLUDED status, notes). Added an "Edit pay" link per employee row (DRAFT runs only) opening a form over all of those fields; save calls the PATCH then automatically re-runs `POST /runs/:id/calculate` so NIS/PAYE/Health Surcharge/Net Pay refresh immediately without a separate Calculate click. `types/hr.ts` `HrPayrollEntry` extended with `base_salary_ttd`, `unpaid_leave_days`, `deduction_items`, `department_name`, `pay_frequency` (all already returned by the backend, just untyped before); removed unused/incorrect `gross_salary_ttd` field.
- ~~**HR Attendance — no clock in/out**~~ — **DONE 2026-07-01 (session 31)**: `hr_time_entries.clock_in`/`clock_out`/`break_minutes` columns existed in the backend (migration 045) but had zero frontend UI — the only entry method was manually typing total hours. Added a "Time Clock" card to `AttendanceTab` (`pages/HR.tsx`): shows today's status (not clocked in / clocked in at HH:MM / worked Xh with times) for the selected timesheet's employee; Clock In stamps `clock_in = now()`; Clock Out takes an editable break-minutes value, computes `hours_worked = (clock_out − clock_in − break) `, and PATCHes the entry. Disabled if today falls outside the selected timesheet's week (prevents cross-week punches). "today" is computed in Trinidad time (`todayTT()` helper, `Intl.DateTimeFormat` with `America/Port_of_Spain`), not UTC — matters near midnight TT. Entries table gained Clock In/Clock Out columns.
- ~~**`common.noRecords` i18n key never existed**~~ — **DONE 2026-07-01 (session 31)**: dozens of `t('common.noRecords')` calls across the app (HR and others) rendered the literal string `common.noRecords` instead of translated text — the key was defined under `propertiesPanel.noRecords`, not `common.noRecords`. Added `"noRecords": "No records found"` / `"未找到记录"` to the `common` namespace in both locale files, fixing every empty-list state that used this key app-wide.
- **Leases (B3)** — PENDING: all leases expired; need monthly rent amounts per unit from Robert to create new leases (moved from above, still outstanding)
- **Unit listing content** — IN PROGRESS: 25 units all VACANT; Apt C1 (45 Eleventh Street) fully listed 2026-07-06 as the first real end-to-end listing (photos, description, rent, utilities, public booking link) — see "Tenancy listing pipeline" below for the infra work this uncovered. Remaining 24 units still need photos/descriptions/rent/utilities filled in manually via Properties → Units → Listing button.
- ~~**Tenancy listing pipeline — presign/RLS/frontend gaps**~~ — **DONE 2026-07-06 (session 36)**: First real attempt to list a unit (Apt C1) surfaced that most of the public-facing listing pipeline had never actually worked end-to-end. See "Tenancy listing pipeline" implementation notes below for full detail. Fixed: MinIO presigned URLs pointed at the internal Docker hostname (unreachable from browsers) — added a public presign client against `storage.jagcorporate.com`; public booking API ran on a bare DB connection with no RLS owner context (silently returned zero rows) — scoped to platform owner; **no frontend page existed at all** for `/book/:slug` (only the backend route) — built `pages/PublicBooking.tsx` with a route split in `App.tsx` that bypasses Keycloak's `login-required` entirely for `/book/*`; units-list query was missing `listing_status`/`listing_description`/`rent_amount`/utility columns entirely (badge + modal always showed blank/Vacant regardless of saved data); `rent_amount` column referenced by the Asking Rent field never existed (migration 038); AI suggest-price query referenced a non-existent `l.rent_amount_ttd` column (real column is `l.monthly_rent`). Added: photo reorder (‹/› buttons, `display_order` swap) + per-photo caption/label field, both via a combined `PATCH /properties/units/:id/photos/:photoId`; photo lightbox with zoom + prev/next on the public page; pre-viewing screening questionnaire (migration 039, `prop_enquiries.screening_answers` JSONB) covering employment/income/adults/children/pets/smoker/move-in date/reason for moving/background-check consent/eviction history/references, shown in the Enquiries detail panel; unit floor area renamed sqm→sqft (migration 040, `prop_units.floor_area_sqft`, backfilled — Unit-level only, Property-level acquisition form still uses sqm intentionally); viewing hours set to 7:30am–5:30pm via `GOOGLE_CALENDAR_WORK_START/END` env vars; Open Graph tags + JAG logo (`jag-web/public/jag-logo.png`, reused from the mobile app icon) added to `index.html` so shared booking links show branded previews in WhatsApp/Facebook. New skill `.claude/skills/prep-listing-photos` captures the HEIC→JPEG + EXIF-orientation-aware downscaling workflow for future listing photos. Commit `4ed7f1a`. **Correction (session 39):** the MinIO presign-client piece of this entry was never actually deployed despite being written up as done here — see the MinIO section correction above.
- **Property occupancy status misleading for multi-unit buildings — DONE 2026-07-08 (session 39)**: `prop_properties.is_rented` is a single boolean flipped `true` the moment *any* lease is created on the property — for a multi-unit building (e.g. 45 Eleventh Street, 4 units) this showed a blanket "Rented" badge even with only 1 of 4 units actually occupied. Root cause went deeper: creating a lease for a specific unit had only ever set the *property's* flag, never the *unit's own* `prop_units.is_rented` — so `properties.ts`'s lease-create/delete routes now also sync the specific unit's flag (existing Marcus Ramkissoon lease backfilled manually, one-row UPDATE). Added a derived `occupancy_status: 'VACANT' | 'PARTIALLY_RENTED' | 'RENTED'` (`occupancyStatus()` helper in `properties.ts`) computed from actual unit occupancy counts when the property has units, falling back to the plain flag otherwise; surfaced in both the property list badge and detail-header badge (`occupancyBadge()` in `PropertiesPanel.tsx`) as e.g. "Partially Rented (1/4)". New i18n key `propertiesPanel.partiallyRented` (en + zh-CN).
- **Money Manager reconciliation import** — PENDING: `scripts/mm-import/` not yet built; all-source reconciliation (MM Excel + second Excel report + bank PDFs/CSVs) → single clean import into fin_transactions; 54 existing Scotia rows will be enriched not duplicated; RBC eSavings (`ffa985f6`, last4 3841, $53,755.57 TTD opening balance) and RBC Rewards Visa Platinum (`077b8014`, last4 0512) accounts already created in JAG; Cash account still needs creating; second Excel report contents TBD

---

## i18n ARCHITECTURE (react-i18next)

**Language switcher:** top-right header — toggles between `en` and `zh-CN`.
**Locale files:** `jag-web/src/locales/en.json` and `jag-web/src/locales/zh-CN.json` (~1900 lines each).
**Hook:** `const { t } = useTranslation()` inside every component function. Import: `import { useTranslation } from 'react-i18next'`.
**Database content** (names, notes, descriptions from API) is never translated — only UI chrome strings.

### Translation workflow for new modules
1. Build the feature in English first (hardcoded strings) — test fully
2. Translate as a batch when complete: wire `useTranslation`, add keys to both locale files, deploy
3. Missing keys degrade gracefully — show the key name in English, never crash

### CRITICAL: variable shadowing
Any arrow-function parameter named `t` will shadow the `useTranslation` `t` function and cause silent bugs or TypeScript errors. **Never use `t` as a parameter name in new components.** Use `item`, `opt`, `vt`, `mt`, `tag`, etc. instead.

```tsx
// WRONG — t parameter shadows useTranslation t
items.map(t => <option key={t.id}>{t.name}</option>)

// CORRECT
items.map(item => <option key={item.id}>{item.name}</option>)
```

### React key stability
Never use a translated string as a React list key. Use a stable English/enum key alongside the translated label:
```tsx
// WRONG — key changes with language
[['Unit Value', fmtMoney(x)]].map(([label, value]) => <div key={label}>)

// CORRECT — stable key
[['unitValue', t('inv.unitValue'), fmtMoney(x)]].map(([key, label, value]) => <div key={key}>)
```

### Namespace prefix map
| Prefix | Page / scope |
|---|---|
| `common` | Shared across all pages (save, cancel, loading, etc.) |
| `nav` | Sidebar navigation |
| `fin` | Finance page |
| `prop` | Properties page |
| `tenants` | Tenants panel |
| `pipeline` | Acquisition pipeline |
| `inv` | Inventory & Assets page |
| `jabco` | JABCO page |
| `ent` | Entertainment page (BAR + Members Club) |
| `db` | DragonBridge page |
| `crm` | CRM page |
| `lifestyle` | Lifestyle page |
| `ledger` | Ledger page |
| `expenses` | Expenses page |
| `brianAdmin` | Brian admin portal |
| `brianPortal` | Brian user portal |
| `placeholder` | Coming soon pages |
| `tenancy` | Tenancy lifecycle panels (enquiries, viewings, applications, deposits, rent, handover, maintenance, renewals, WhatsApp) |
| `tender` | JABCO Tender Pipeline tab in CRM page (opportunity stages, Go/No-Go, Win/Loss, bid intelligence) |
| `notifications` | Notification bell (title, mark-all-read, relative-time) — session 26 |
| `family` | Family Registry page (relationship + language labels, fields, summary chips) — session 26 |
| `exportPage` | Accountant Export page (tab/column labels) — session 26 |
| `ownership` | Ownership cap-table page (By Entity / By Person, stake editor, estate rollup) — session 26 |

---

## LOCKED ARCHITECTURE DECISIONS (do not re-propose)

- PostgreSQL 18, five logical DBs, cross-DB via `postgres_fdw` in JAG Holdings only
- Docker + Docker Compose
- Caddy + Let's Encrypt + Cloudflare DNS-01 (NOT Duck DNS)
- Keycloak 26.x, realm `jag`, client `jag-api`, mappers `jag_user_id` + `jag_tenant_id`
- Finance Option B — accounts scoped per entity via `owner_entity_id`
- Ollama on main Windows workstation only (NOT Dell Inspiron)
- Succession activation — parallel Co-Owner to wife's account; Robert's Owner account is NEVER programmatically demoted
- Offline-critical: BAR cash logging, JABCO site diary, IMS barcode scanning
- STD-13 Expand-and-Contract for all destructive schema changes
- `jag-web/` served as Caddy static files — NOT a separate Docker container

---

## WHAT CLAUDE MUST DO EVERY SESSION

- Apply STD-01 through STD-13 to every line of code
- Never re-propose locked architecture decisions
- Write node-pg-migrate files for every schema change — never raw SQL on production
- Use `SELECT set_config($1, $2, true)` for PG session variables — NEVER `SET LOCAL x = $1`
- Declare new Keycloak attributes in User Profile schema before setting them
- Include idempotency keys on all financial write endpoints
- Write `pending_events` outbox entries within the same transaction as financial events
- Scope all DB queries with correct owner/tenant — no cross-DB queries without `postgres_fdw` through JAG Holdings
- Use Keycloak JWT claims for role — never trust application-layer role claims alone
- Add `last_modified_at` + `last_modified_by` to all shared master record tables
- For API changes: `npm run build:prod` FIRST, then SCP `dist/`, then docker rebuild. If new npm packages were added, also run `node scripts/prod-install.js` and re-SCP `prod_modules/` — the Dockerfile copies `prod_modules/node_modules` not the host's `node_modules`
- For frontend changes: `npm run build` in `jag-web/`, then SCP `dist/` to VM
- **i18n**: never use `t` as an arrow-function parameter name in any component (shadows `useTranslation` `t`); never use translated strings as React list keys
- New modules: build in English first, translate as a batch when complete — missing keys degrade gracefully
- End every session with a handoff note
