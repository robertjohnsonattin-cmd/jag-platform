# JAG Integrated Business Platform — Claude Session Context

**Owner:** Robert Johnson-Attin | Barataria, Trinidad & Tobago
**Architecture:** v1.9 | **Current Phase:** ALL PHASES COMPLETE — in production | **Updated:** 2026-06-15 (session 9)

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

### node-pg numeric types
PostgreSQL `numeric` / `decimal` columns arrive in Node.js as **strings**, not numbers. Always wrap with `parseFloat(String(value ?? 0))` before arithmetic — using `+` on two pg numeric values concatenates strings instead of adding numbers.

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
- **Docker overlayfs bind-mount masking (2026-06-13):** If frontend deploys successfully (files in `/opt/jag/jag-web/dist` on host) but site serves 404, the Caddy container's overlayfs layer is shadowing the bind mount. Fix: `docker compose up -d --force-recreate caddy`. Root cause was the image not having the mount path pre-declared — fixed by adding `RUN mkdir -p /opt/jag/jag-web/dist` to `jag-infra/caddy/Dockerfile`.

### MinIO — critical operational notes

**jag_app MinIO user is a separate IAM user, NOT the root user.** It must be created explicitly after any MinIO data wipe or volume loss:
```bash
MINIO_ROOT_PASSWORD=<pw> MINIO_ROOT_USER=jag_minio_admin \
  mc admin user add jagadmin aVl4SrRl0YtilT55zCNe <secret>
mc admin policy attach jagadmin jag-app-buckets --user aVl4SrRl0YtilT55zCNe
```

**IAM policy** `jag-app-buckets` restricts jag_app to the 4 authorised buckets only. Recreate with:
```bash
MINIO_ROOT_PASSWORD=<pw> JAG_APP_ACCESS_KEY=aVl4SrRl0YtilT55zCNe \
  bash /opt/jag/jag-infra/scripts/setup-minio-policy.sh
```

**SSE-S3 encryption** — all 4 buckets encrypted at rest via `MINIO_KMS_SECRET_KEY` in docker-compose.yml env. Key is `jag-sse-key:Zv/jb8tPW1FkuO6drbKQuKVui0ZxEpTV6zpVYFJ3Zf0=`. If rotated, existing objects cannot be decrypted.

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
| Keycloak admin | `admin` / `JU1BbyB13tWV0MPf3bK89cWZ` (via SSH tunnel to localhost:8080) |
| jag-api client secret | `FIjMqEPT35gr3TRvh6FDdCTnMAX2FAGMjTVHuljqcBU` |
| PG superuser | `postgres` / `PgSuperAdmin2026` |
| jag_app PG user | `fz4liKWoRn0a81GluZxI9pIHEacrBN5F` |
| MinIO root | `jag_minio_admin` / `EsvMOHas4ASnWY9f1M9rTV2rQByRsqAz` (admin only — console + mc) |
| MinIO jag_app | access key `aVl4SrRl0YtilT55zCNe` / secret `gjdzq9IH8IZM0MSlazE8szxH67kz2VYtbWavQe29` (scoped to 4 JAG buckets via `jag-app-buckets` policy) |
| MinIO audit token | stored in VM `.env` as `MINIO_AUDIT_TOKEN` — shared secret for MinIO→jag-api webhook |

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
| Finance bank statements | `routes/finance/bank-statements.ts` | Upload, queue, list, delete jobs; MinIO storage; `fin_bank_statement_jobs` table; `POST /import` for Path 2 local script |
| Finance document jobs | `routes/finance/document-jobs.ts` | Path 1 cloud upload → REVIEW → approve; writes to loans/investments/insurance on approve; auto-deletes MinIO object |
| Finance /import endpoints | `bank-statements.ts`, `loans.ts`, `investments.ts`, `insurance.ts` | Path 2 direct JSON import from local script; all require `idempotency_key` |
| Finance investment valuations | `routes/finance/investments.ts` | `GET /:id/valuations` — history sorted desc by as_of_date; `POST /:id/valuations` — manual historical backfill; auto-insert valuation row on every PATCH to `fin_investments` (same `withOwnerRLS` callback); table `fin_investment_valuations` (migration 009 jag_family) |
| Finance loan balance history | `routes/finance/loans.ts` | `GET /:id/history`; `POST /:id/history` (manual backfill); auto-insert into `fin_loan_balance_history` on every PATCH; table (migration 010 jag_family) |
| Finance insurance policy history | `routes/finance/insurance.ts` | `GET /policies/:id/history`; `POST /policies/:id/history` (manual backfill); auto-insert into `fin_insurance_policy_history` on every PATCH; table (migration 011 jag_family) |
| Property valuation history | `routes/properties/properties.ts` | `GET /:id/valuation-history`; `POST /:id/valuation-history` (manual backfill); auto-insert into `prop_valuation_history` only when `current_valuation` is in PATCH body; table (migration 012 jag_properties) |
| Internal MinIO audit webhook | `routes/internal/minio-audit.ts` | Receives MinIO `audit_webhook:loki` POSTs; validates `Bearer $MINIO_AUDIT_TOKEN`; logs to Loki via structured logger; mounted at `/internal/minio-audit` (no Keycloak, Docker-network-only) |

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
| `008_document_jobs.sql` | ANNUITY added to `fin_investments` investment_type CHECK; `fin_document_jobs` table + RLS policy |
| `009_investment_valuations.sql` | `fin_investment_valuations` append-only table; FK → `fin_investments(id) ON DELETE CASCADE`; indexes on `(investment_id, as_of_date DESC)` and `(owner_id, as_of_date DESC)`; RLS using `NULLIF(current_setting('app.current_owner_id', true), '')::uuid` |
| `010_loan_balance_history.sql` | `fin_loan_balance_history` append-only table; FK → `fin_mortgages_loans(id) ON DELETE CASCADE`; tracks outstanding_balance, interest_rate, monthly_payment; same RLS + index pattern |
| `011_insurance_policy_history.sql` | `fin_insurance_policy_history` append-only table; FK → `fin_insurance_policies(id) ON DELETE CASCADE`; tracks coverage_amount_ttd, premium_amount_ttd, expiry_date; same RLS + index pattern |

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
| `012_valuation_history.sql` | `prop_valuation_history` append-only table; FK → `prop_properties(id) ON DELETE CASCADE`; tracks valuation_ttd; same RLS + index pattern |

### VM Cron Scripts (`jag-infra/scripts/`)

| Script | Schedule (UTC) | Schedule (TT) | Purpose |
|---|---|---|---|
| `backup-databases.sh` | 02:00 | 22:00 prev. day | pg_dump all 5 DBs |
| `fx-rates-sync.sh` | 10:00 | 06:00 | Seed USD + CNY → TTD rates from open.er-api.com |
| `cleanup-stale-statements.sh` | 07:00 | 03:00 | Delete PENDING bank statement jobs + MinIO objects older than 7 days |
| `setup-minio-policy.sh` | one-time | — | Create `jag-app-buckets` IAM policy + attach to jag_app user; re-run after MinIO data wipe |
| `fdw-rotate-password.sh` | manual | — | Resync FDW USER MAPPING passwords after jag_app PG credential rotation |

### Local Extraction Script (`scripts/doc-import/`)
Path 2 local extraction — reads PDFs from local hard drive, Ollama extracts, posts to API. **File never uploaded to cloud.**
- Build: `npm run build` in `scripts/doc-import/`
- Usage: `node dist/extract.js --type <bank-statement|loan|investment|insurance> --file "C:/JAG Filing/..." [--entity <uuid>] [--account <uuid>] [--dry-run]`
- Config: `scripts/doc-import/.env.doc-import` — `KC_USERNAME`, `KC_PASSWORD` (never commit), `JAG_API_URL`, `OLLAMA_URL`, `OLLAMA_MODEL`
- Auth: Keycloak ROPC (password grant) — token cached per run with 30s early-expiry buffer

### Vehicle Owner Options (VEHICLE_OWNER_OPTIONS const)
`JAG Holdings`, `JABCO`, `JAG Properties`, `JAG Entertainment`, `JAG Finance`, `Personal — Robert`, `Personal — Brian`, `Other`

---

## OPEN ITEMS

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
- **Leases (B3)** — PENDING: all leases expired; need monthly rent amounts per unit from Robert to create new leases
- **JAG Plantations / JAG Trading** — future phases; placeholder pages exist in frontend
- ~~**JAG Entertainment UI** — BAR + Members Club frontend not yet built~~ **DONE**
- ~~**DragonBridge UI** — China sourcing / forex frontend not yet built~~ **DONE**
- ~~**JAG Finance advanced** — intercompany eliminations UI, insurance UI not yet built~~ **DONE**
- ~~**Bank Statements UI**~~ — **DONE 2026-06-13**: drag-and-drop batch upload panel in Finance → Bank Statements tab; per-file account assignment; parallel upload; job history with delete; `fin_bank_statement_jobs` table; `routes/finance/bank-statements.ts`
- ~~**MinIO SSE-S3 encryption**~~ — **DONE 2026-06-12**: all 4 buckets encrypted via `MINIO_KMS_SECRET_KEY`
- ~~**MinIO jag_app user creation**~~ — **DONE 2026-06-13**: user `aVl4SrRl0YtilT55zCNe` created (was never provisioned despite env vars being set); `jag-app-buckets` policy attached
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
- For frontend changes: `npm run build` in `jag-web/`, then SCP `dist/` to VM
- **i18n**: never use `t` as an arrow-function parameter name in any component (shadows `useTranslation` `t`); never use translated strings as React list keys
- New modules: build in English first, translate as a batch when complete — missing keys degrade gracefully
- End every session with a handoff note
