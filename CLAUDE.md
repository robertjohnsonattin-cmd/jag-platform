# JAG Integrated Business Platform — Claude Session Context

**Owner:** Robert Johnson-Attin | Barataria, Trinidad & Tobago
**Architecture:** v1.9 | **Current Phase:** ALL PHASES COMPLETE — in production | **Updated:** 2026-06-12

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
| Frontend | React 18 + TypeScript + Vite + TailwindCSS + React Query + Keycloak JS adapter |
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

### node-pg numeric types
PostgreSQL `numeric` / `decimal` columns arrive in Node.js as **strings**, not numbers. Always wrap with `parseFloat(String(value ?? 0))` before arithmetic — using `+` on two pg numeric values concatenates strings instead of adding numbers.

### Dashboard query limits
`jag-web/src/pages/Dashboard.tsx` requests properties with `limit: 100` (backend max is 500 per `PropertiesQuerySchema`). Never raise Dashboard limit above 500 without also raising the backend Zod schema.

### WebAuthn
`KC_WEBAUTHN_RP_ID` is bound at registration and **cannot be changed**. Run `keycloak-webauthn-setup.sh` with `KC_WEBAUTHN_RP_ID=jabco.tt` before any user registers a device on production.

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

**deploy.sh** (repo root) — STD-12 deploy gate script handles both. Flags: `--api-only`, `--frontend-only`, `--skip-typecheck`, `--skip-zap`.
Deploy runs **7 steps**: TypeScript compile → frontend build → VM check → dist upload → health check → ZAP baseline → frontend upload.
Step 6 (ZAP baseline) fires automatically when `ZAP_SCAN_PASSWORD` env var is set; silently skips if unset. Blocks deploy on HIGH-risk findings only.

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

---

## ROBERT'S ACCOUNT

| Field | Value |
|---|---|
| Email | `robertjohnsonattin@gmail.com` |
| Keycloak ID | `e58436eb-bcd9-40c4-95f6-251d77d0b001` |
| jag_core users.id | `95ca3f77-60ba-4a0f-af70-2832b247b525` |
| Role | Owner on JAG_HOLDINGS |
| Token source | `https://auth.jagcorporate.com` (NOT localhost — issuer mismatch) |

---

## KEY CREDENTIALS (VM / LOCAL)

| Resource | Value |
|---|---|
| SSH key | `~/.ssh/jag_oracle2` (jag_oracle does NOT work) |
| Keycloak admin | `admin` / `JU1BbyB13tWV0MPf3bK89cWZ` (via SSH tunnel to localhost:8080) |
| jag-api client secret | `FIjMqEPT35gr3TRvh6FDdCTnMAX2FAGMjTVHuljqcBU` |
| PG superuser | `postgres` / `PgSuperAdmin2026` |
| jag_app PG user | `fz4liKWoRn0a81GluZxI9pIHEacrBN5F` |

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

### Phase 7 Backend Additions (done during frontend build)

| Addition | File | Notes |
|---|---|---|
| IMS suppliers | `routes/ims/suppliers.ts` | Supplier CRUD |
| IMS stock takes | `routes/ims/stocktakes.ts` | Full stock take lifecycle |
| IMS depreciation | `routes/ims/depreciation.ts` | Straight-line + declining balance |
| IMS vehicle overhaul | `routes/ims/vehicles.ts` | `owner_entity` (flexible), service tracking, STD-13 dual-write |
| IMS locations POST | `routes/ims/items.ts` | `POST /ims/locations` added |
| Properties insurance | `routes/properties/insurance.ts` | Policy CRUD |
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

### Phase 7 Migrations (jag_family)

| File | Changes |
|---|---|
| `007_expense_receipt_bucket.sql` | MinIO bucket config for expense receipts |

### Phase 7 Migrations (jag_properties)

| File | Changes |
|---|---|
| `003_insurance.sql` | prop_insurance_policies |
| `004_property_tax.sql` | prop_property_tax |
| `005_inspections.sql` | prop_inspections |
| `006_lease_deposit_refund.sql` | deposit refund fields on prop_lease_agreements |
| `007_utility_accounts.sql` | prop_utility_accounts |
| `008_late_fee_lease.sql` | late_fee_type/value/grace_days on leases |
| `009b_prop_properties_audit_cols.sql` | last_modified_at, last_modified_by audit columns on prop_properties |
| `009_units.sql` | prop_units table (property sub-unit tracking) |
| `010_mortgage_last_modified.sql` | last_modified_at, last_modified_by on mortgage table |
| `011_rent_payment_proof.sql` | proof_photo_url, proof_uploaded_at, proof_uploaded_by on rent payments; receipt token for shareable links |

### Vehicle Owner Options (VEHICLE_OWNER_OPTIONS const)
`JAG Holdings`, `JABCO`, `JAG Properties`, `JAG Entertainment`, `JAG Finance`, `Personal — Robert`, `Personal — Brian`, `Other`

---

## OPEN ITEMS

- ~~**WiPay webhook**~~ — **REMOVED**: WiPay does not issue webhooks to individuals; rents paid directly to personal bank accounts
- ~~**Rent proof workflow**~~ — **DONE**: endpoint `GET /properties/:propertyId/rent-payments/:paymentId/receipt` live in `routes/properties/properties.ts`; frontend copy/WhatsApp share in PropertiesPanel.tsx
- ~~**Migration 009 collision (jag_properties)**~~ — **FIXED 2026-06-12**: renamed to `009b_prop_properties_audit_cols.sql`; production `__migrations` updated; 010 registered
- **Ollama** — deferred; set `DRY_RUN=false` + `ollama pull llama3.2` when ready
- **Data population** — B3 Leases (new leases needed — all expired), A2 Chart of Accounts, A3 FX Rates not yet populated in production
- **JAG Plantations / JAG Trading** — future phases; placeholder pages exist in frontend
- ~~**JAG Entertainment UI** — BAR + Members Club frontend not yet built~~ **DONE**
- ~~**DragonBridge UI** — China sourcing / forex frontend not yet built~~ **DONE**
- ~~**JAG Finance advanced** — intercompany eliminations UI, insurance UI not yet built~~ **DONE**

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
- For API changes: `npm run build:prod` FIRST, then SCP `dist/`, then docker rebuild
- End every session with a handoff note
