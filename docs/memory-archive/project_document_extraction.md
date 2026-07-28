---
name: project-document-extraction
description: "Two-path financial document extraction (loans, investments, insurance) — updated 2026-06-15 session 10 with TTCD pre-parser and pdf-parse."
metadata: 
  node_type: memory
  type: project
  originSessionId: bd318439-e1c0-4014-bc9f-1650757781f8
---

Financial documents (loan statements, investment portfolios, insurance policies) are extracted via one of two paths. The actual PDFs live in Robert's local filing system — the cloud is never a permanent store.

**Why:** Robert wants a local hard-drive filing system as the source of truth for PDFs. Cloud storage is used only as a transient buffer if uploading from the browser.

**How to apply:** Never treat MinIO as a document archive for these files. MinIO object is always deleted after extraction, either automatically (Path 1) or it's never uploaded (Path 2).

---

## Path 1 — Browser upload (cloud transient)

1. Finance → Documents tab → drag-and-drop file
2. File stored in `jag-documents` MinIO bucket (transient)
3. `fin_document_jobs` record created (status: PENDING)
4. `scripts/ollama-batch/` runs at 02:00 TT → downloads from MinIO, Ollama extracts JSON, sets status REVIEW, deletes MinIO object
5. UI shows extracted data for human review (ReviewCard component)
6. Robert selects entity + clicks "Approve & Import"
7. API writes to target table; status → APPROVED; `target_record_ids` populated

**API:** `routes/finance/document-jobs.ts`
- `POST /finance/document-jobs/upload` — multer memoryStorage, 20 MB limit, PDF/CSV/TXT
- `GET /finance/document-jobs` — list with status/type filter
- `POST /finance/document-jobs/:id/approve` — writes extracted_data to target table
- `DELETE /finance/document-jobs/:id` — removes job + MinIO object (terminal states only)

## Path 2 — Local script (file never leaves machine)

```
cd scripts/doc-import
node dist/extract.js --type <loan|investment|insurance|bank-statement> --file "C:/JAG Filing/..." [--entity <uuid>] [--dry-run]
```

Script reads file from local disk → (TTCD pre-parser OR Ollama) → POST to API `/import` endpoint → DB written. File never uploaded.

**Env:** `scripts/doc-import/.env.doc-import` (gitignored — never commit KC_PASSWORD)
- `KC_USERNAME`, `KC_PASSWORD` — Robert's Keycloak credentials
- `JAG_API_URL=https://api.jagcorporate.com`
- `OLLAMA_URL`, `OLLAMA_MODEL=llama3.2`
- `DEFAULT_OWNER_ENTITY_ID=00000000-0000-0000-0001-000000000001`
- **Pass KC_PASSWORD at runtime:** `$env:KC_PASSWORD = "xxx"; node dist/extract.js ...`

**Auth:** Keycloak ROPC (password grant) — token cached with 30s early-expiry buffer

**PDF extraction (2026-06-15):** uses `pdf-parse` v1.1.1 — correctly decompresses FlateDecode streams. The old latin1 byte-scan is gone.

**TTCD programmatic pre-parser (investment type only):**
For Trinidad & Tobago Central Depository (TTCD/TTSE) depository statements, the script detects the format by looking for `Closing Balance:` + `Net Movement:` markers and bypasses Ollama entirely. Programmatic extraction of all holdings is 100% accurate and takes ~2 seconds.

Format the TTCD parser handles:
```
{TICKER}{COMPANY NAME}    ← concatenated, no space
Net Movement:
Price TTD: {price}Value TTD:
Closing Balance:
{net_movement}            ← usually 0
{closing_units}           ← units_held
{value_ttd}
Opening Balance{units}
```

Known TTSE tickers are hardcoded in `TTSE_TICKERS` array in `extract.ts` for correct ticker/name splitting. Add new tickers there as they appear.

**Ollama settings (non-TTCD documents):** `num_ctx: 16384`, timeout 600 s, 2-attempt retry, brace-depth JSON extractor.

**First live import (2026-06-15):** Phillip Ajack TTCD statement — 10 TTSE holdings, TTD 1,529,126.52 total, entity `00000000-0000-0000-0001-000000000010`.

**Import endpoints (all require idempotency_key):**
- `POST /finance/loans/import` → `fin_mortgages_loans`
- `POST /finance/investments/import` → `fin_investments` (body: `{ items: [] }`, supports multi-holding)
- `POST /finance/insurance/policies/import` → `fin_insurance_policies`
- `POST /finance/bank-statements/import` → `fin_transactions` + `fin_pending_review_queue`

## fin_document_jobs table (jag_family, migration 008)

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| owner_id | UUID NOT NULL | RLS key |
| doc_type | TEXT | LOAN / INVESTMENT / INSURANCE |
| status | TEXT | PENDING → PROCESSING → REVIEW → APPROVED / FAILED |
| file_name | VARCHAR(300) | |
| storage_path | VARCHAR(500) | MinIO key |
| mime_type | VARCHAR(100) | |
| extracted_data | JSONB | Ollama output |
| target_record_ids | UUID[] | IDs written on approve |
| idempotency_key | TEXT UNIQUE | |
| error_detail | TEXT | |
| started_at / completed_at | TIMESTAMPTZ | |

RLS: `owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid`

## ANNUITY investment type

Added to `fin_investments.investment_type` CHECK constraint in migration 008. Valid values now: `EQUITY, BOND, MUTUAL_FUND, ETF, UNIT_TRUST, REAL_ESTATE, PRIVATE_EQUITY, CASH_EQUIVALENT, ANNUITY, OTHER`.

Note: `ANNUITY` is in `InvestmentType` union and `INVESTMENT_TYPES` array in frontend (added session 9) — appears in create/update dropdowns.
