# JAG Holdings — PRE-5: WiPay Sandbox POC
**Date:** 2026-05-24  
**Status:** ✅ DONE  
**Session scope:** HMAC verification middleware, webhook handler, pending_review_queue decision + migration, sandbox test harness.

---

## Decision Locked This Session

### pending_review_queue → 202 Accepted (Option B confirmed)

WiPay non-success payments (`failed`, `pending`, `refunded`) and success payments that cannot be matched to an active lease are now inserted into `prop_pending_review_queue` and return **202 Accepted**.

**Why:** A `422` tells WiPay their webhook call was broken — they may stop retrying permanently and the event is lost. A `202` gives WiPay an ACK, they stop retrying cleanly, and Robert reviews the queue at his discretion. This aligns with the never-lose-an-event principle established in PRE-3.

**API contract updated:** `jag_api_contract_v1.yaml` — 409/422 removed from `POST /webhooks/wipay`; 202 added with correct description.

---

## What Was Built

### 1. DBML Schema Update — `jag_properties.dbml`

Added `pending_review_status` enum (`PENDING | RESOLVED | DISMISSED`) and `prop_pending_review_queue` table.

### 2. Migration — `jag-event-dispatcher/migrations/jag_properties/20260524000002_create_pending_review_queue.ts`

Creates the `prop_pending_review_queue` table in `jag_properties`. Run with:

```bash
npm run migrate:properties   # from jag-event-dispatcher/
```

### 3. `jag-wipay-poc/` — TypeScript Express package

```
jag-wipay-poc/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── src/
│   ├── index.ts                         ← Express server + raw body capture
│   ├── config.ts                        ← env var reader
│   ├── db.ts                            ← pg.Pool for jag_properties
│   ├── types.ts                         ← WiPayWebhookPayload, ApiResponse
│   ├── middleware/
│   │   └── verifyWiPaySignature.ts      ← HMAC-SHA256 middleware (production-ready)
│   └── routes/
│       └── webhooks.ts                  ← Full webhook handler
└── scripts/
    └── send-test-webhook.ts             ← 6-scenario test harness
```

---

## How to Run the POC

### Prerequisites
- Node.js ≥ 20
- PostgreSQL running with `jag_properties` database created
- Migrations run: `pending_events` (PRE-3) and `pending_review_queue` (PRE-5)
- An active lease row in `prop_lease_agreements` with a known UUID (for scenario 1)
- Robert's `jag_core.users.id` UUID (from PRE-4 Step 4)

### Setup

```bash
cd jag-wipay-poc
npm install
cp .env.example .env
# Edit .env: fill in DATABASE_URL_PROPERTIES, WIPAY_WEBHOOK_SECRET, OWNER_ID
```

### Start the server

```bash
npm run dev
# [jag-wipay-poc] Listening on port 3000
```

### Run all test scenarios

```bash
# In a second terminal:
TEST_LEASE_ID=<uuid-of-active-lease> npm run test-webhook
```

---

## Webhook Handler Logic

```
POST /webhooks/wipay
Headers: X-WiPay-Signature: sha256=<hex>
         Idempotency-Key: <uuid>
Body: WiPayWebhookPayload
```

| Condition | Response |
|---|---|
| Missing/bad HMAC | 401 INVALID_SIGNATURE |
| Missing required field | 400 VALIDATION_ERROR |
| Missing Idempotency-Key | 400 VALIDATION_ERROR |
| Duplicate idempotency key (already in rent_payments or review_queue) | 200 — no re-processing |
| `status !== 'success'` | INSERT prop_pending_review_queue → **202** |
| `status === 'success'` + no `metadata.lease_id` | INSERT prop_pending_review_queue → **202** |
| `status === 'success'` + lease not found/not active | INSERT prop_pending_review_queue → **202** |
| `status === 'success'` + valid active lease | INSERT prop_rent_payments + pending_events → **200** |

The happy path (200) is atomic: `prop_rent_payments` and `pending_events` are inserted in a single `BEGIN/COMMIT` transaction. If either insert fails, both roll back.

---

## HMAC Middleware Notes (Production-Ready)

`verifyWiPaySignature.ts` is production-ready and can be copied directly into the Phase 1 API server.

- Raw body captured via `express.json({ verify: ... })` callback — body parsing and HMAC verification share a single pass
- Comparison uses `timingSafeEqual` to prevent timing attacks
- Rejects anything that doesn't start with `sha256=`
- If `rawBody` is missing (non-JSON request), returns 400 before attempting HMAC

---

## Phase 0 Lease Correlation (Temporary)

During Phase 0/sandbox, the webhook handler resolves `wipay_reference → lease_id` via `metadata.lease_id` in the WiPay payload. The test harness populates this in `metadata`.

**In Phase 1,** replace this with a `prop_wipay_payment_orders` lookup table:
- When the tenant initiates payment, your API creates a payment order with WiPay and stores `{ wipay_reference, lease_id, initiated_at, status }` locally
- The webhook handler looks up `wipay_reference` in that table instead of reading from `metadata`

This is a `TODO Phase 1` — clearly marked in `webhooks.ts` with an explanatory comment.

---

## Test Harness Scenarios

| # | Scenario | Expected |
|---|---|---|
| 1 | Valid success, correct lease_id | 200 — row in prop_rent_payments + pending_events |
| 2 | Same idempotency key as #1 | 200 — no duplicate insert |
| 3 | Bad HMAC signature | 401 INVALID_SIGNATURE |
| 4 | Missing `wipay_reference` | 400 VALIDATION_ERROR |
| 5 | `status: 'failed'` | 202 — row in prop_pending_review_queue |
| 6 | Success, no lease_id in metadata | 202 — row in prop_pending_review_queue |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL_PROPERTIES` | ✅ | PostgreSQL connection string for jag_properties |
| `WIPAY_WEBHOOK_SECRET` | ✅ | Shared HMAC secret from WiPay sandbox dashboard |
| `OWNER_ID` | ✅ | Robert's UUID from `jag_core.users.id` (PRE-4 Step 4) |
| `PORT` | Optional | Express port (default: 3000) |

---

## Integrating into Phase 1 API Server

Copy these files into your Phase 1 Express app:

1. `src/middleware/verifyWiPaySignature.ts` → no changes needed
2. `src/routes/webhooks.ts` → replace the `metadata.lease_id` lookup with `prop_wipay_payment_orders` table query
3. Wire up in your app entry point — exactly as shown in `src/index.ts`

The `rawBody` capture via `express.json({ verify })` must be registered **globally** (before any route middleware), not per-route. The HMAC middleware runs after it reads `req.rawBody`.

---

## Files Changed This Session

| File | Change |
|---|---|
| `jag_properties.dbml` | Added `pending_review_status` enum + `prop_pending_review_queue` table |
| `jag_api_contract_v1.yaml` | Updated `POST /webhooks/wipay` — 409/422 removed, 202 added; description updated |
| `jag-event-dispatcher/migrations/jag_properties/20260524000002_create_pending_review_queue.ts` | New migration |
| `jag-wipay-poc/` | Entire package — new |

---

## Pre-Build Task Status (Updated)

| ID | Task | Status |
|----|------|--------|
| PRE-0A | WAL target decision | ✅ LOCKED |
| PRE-0B | Cloudflare Authenticated Origin Pull guide | ✅ DONE |
| PRE-1 | ERD/DBML — all 5 databases | ✅ DONE |
| PRE-2 | OpenAPI YAML contract | ✅ DONE |
| PRE-3 | Outbox migrations + jag-event-dispatcher | ✅ DONE |
| PRE-4 | Keycloak realm + clients + roles | ✅ DONE |
| PRE-5 | WiPay sandbox POC | ✅ DONE |
| PRE-6 | Bank statement parser POC (Ollama/Mistral 7B) | ⬅ NEXT |
| PRE-7 | Migrate JABCO domain to Cloudflare Free Tier | Pending |
| PRE-8 | Write DR failover runbook | Pending |
| PRE-9 | Oracle Cloud + Docker setup (Phase 0) | Pending |

---

## What Comes Next — PRE-6

**PRE-6: Bank statement parser POC (Ollama/Mistral 7B)**

Goal: extract structured transactions from scanned/exported bank statements (PDF or CSV) using a locally-hosted Mistral 7B model via Ollama. Likely produces:
- A Node.js script that calls Ollama's local API
- Parsing logic to extract: date, description, debit/credit, balance
- Output mapped to a structured JSON format aligned with the platform's financial data model
