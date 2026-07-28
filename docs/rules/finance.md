# Finance module rules

> Split out of CLAUDE.md. Read this before touching investments, insurance, net worth, or document extraction.

### Insurance consolidation — single source of truth (session 28)
`fin_insurance_policies` (jag_family) is the **only** insurance table. There is no `prop_insurance` table and no insurance columns on `ims_vehicles`.

- **Linking policies to assets:** `insured_asset_ref UUID` is a soft cross-DB reference (no FK per STD-01). Set to `property.id` for property insurance, `vehicle.id` for vehicle insurance.
- **`insured_asset_type`:** ENUM (`PROPERTY`, `VEHICLE`, `OTHER`) — always set when `insured_asset_ref` is provided.
- **Per-section UI:** Properties Insurance tab and Vehicles 🛡 Insurance tab both query `GET /finance/insurance/policies?insured_asset_ref=<id>`. Finance Insurance shows all policies (no filter).
- **Policy types available:** PROPERTY, VEHICLE, LIABILITY, LIFE, HEALTH, BUSINESS_INTERRUPTION, MARINE, PROFESSIONAL_INDEMNITY, SURETY_BOND, PERFORMANCE_BOND, BUILDING, CONTENTS, FLOOD, FIRE, COMPREHENSIVE, OTHER.
- **`sub_type`:** optional free-text refinement (e.g. "All-risks", "Third-party only", "TWOC").
- **`coverage_amount` and `premium_amount` must be positive** (Zod `.positive()`) — never pass 0; frontend defaults to 1 when blank.
- **Frontend `AddPropertyInsuranceModal`** and **`VehicleInsuranceTab`** both use plain `async/await` (not `useMutation`) to ensure errors surface — `useMutation` with `onError` was silently swallowing errors in this codebase.

### Investment FX conversion rule — CRITICAL
`fin_investments.current_value_ttd` is **always stored in TTD** — never in native currency.

- **DB → display (native):** `nativeValue = ttdValue / rateMap[currency]` (divide)
- **Form entry → DB (save):** `ttd = enteredNativeValue * rateMap[currency]` (multiply)
- **Aggregating totals:** sum `parseFloat(current_value_ttd)` directly — **never** multiply by rateMap again
- `rateMap['TTD'] = 1` so TTD-denominated holdings always pass through unchanged

Violations cause silent inflation: a $5M TTD investment stored correctly in the DB would display/total as ~$33.8M when mistakenly multiplied by the USD rate (6.77).

### Net Worth Snapshot — stale data behaviour
`POST /finance/net-worth/snapshot` upserts on `(owner_id, owner_entity_id, snapshot_date)` — one row per entity per day. If property valuations are edited **after** a snapshot is taken on the same day, the snapshot will be stale. Fix: `DELETE FROM fin_net_worth_snapshots WHERE snapshot_date = 'YYYY-MM-DD'` then retrigger from Finance → Net Worth → Take Snapshot. This happened 2026-06-11: `JAG Properties Management` and `62 Ariapita Avenue` valuations were cleared at 17:19 but snapshot was already taken at 06:36.

### Beneficial-ownership cap table (session 26)
`fam_ownership_stakes` (jag_family, migration 017, owner RLS) records **who beneficially owns what**, with % shares — covers business entities (e.g. BAR+Club registered solely under Zhanghua) AND personally-held assets. One row = a family member owns N% of a `subject_kind` ∈ `ENTITY|PROPERTY|ITEM`:
- `ENTITY` → `subject_id` is an `owner_entity_id` UUID (tenant 001-007 or personal finance entity 008-013).
- `PROPERTY` → `prop_properties.id` (jag_properties, soft ref). `ITEM` → `ims_items.id` (jag_commercial; vehicles are items with `is_asset=true`).
- `subject_label` is denormalized (cross-DB, no FK per STD-01).

Routes: `routes/family/ownership.ts` (mounted **2nd** at `/api/v1/family`, after familyRouter — order is fine, no path overlap). `/ownership` CRUD, `/ownership/subjects` (picker: entities constant + properties + is_asset items, cross-DB like net-worth), `/ownership/allocation` (Σ% per subject → flag ≠100%), `/members/:id/holdings` (rollup).

**Rollup math:** ENTITY stake value = `ownership_percent × latest fin_net_worth_snapshots.net_worth_ttd` for that `owner_entity_id`. PROPERTY/ITEM stake value = `% × current_valuation`/`unit_value`. **So entity values require a fresh net-worth snapshot** — entities with no snapshot attribute 0 until Finance → Net Worth → Take Snapshot is run.

**CRITICAL — net-worth double-count guard:** `routes/finance/net-worth.ts` reads `fam_ownership_stakes` up front and **excludes** any `prop_properties`/`ims_items` row that has a direct PROPERTY/ITEM stake from its entity's physical/property sum (`AND NOT (id = ANY($1::uuid[]))`). A directly-owned asset is attributed to the person, not the entity. **Do not remove this exclusion** or directly-owned assets get counted twice (once under their entity, once under the person). Consolidated total stays correct.

Frontend: `pages/Ownership.tsx` (nav `/ownership`) — By Entity (cap-table editor) + By Person (estate rollup); `api/ownership.ts`. Family member modal has an Estate section (lazy `/holdings`).

### IMS valuation — stock vs fixed assets
`GET /ims/valuation` returns two separate sums. The correct SQL (in `routes/ims/items.ts`):
- `total_stock_value` = `SUM(qty * unit_value) WHERE is_asset IS NOT TRUE` — consumable inventory only
- `total_asset_value` = `SUM(qty * unit_value) WHERE is_asset = true` — fixed assets only

Never let items appear in both sums. The previous bug counted `is_asset = true` items in both totals (fixed 2026-06-17).

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
