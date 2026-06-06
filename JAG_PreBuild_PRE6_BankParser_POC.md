# JAG Holdings — PRE-6: Bank Statement Parser POC
**Date:** 2026-05-24  
**Status:** ✅ DONE  
**Session scope:** Ollama/Mistral 7B integration, PDF/CSV/TXT text extraction, OPSEC-compliant post-processing, structured JSON output.

---

## What Was Built

**`jag-bank-parser-poc/`** — standalone TypeScript Node.js CLI

```
jag-bank-parser-poc/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── sample/
│   └── README.md            ← How to add test files + sample plain-text format
└── src/
    ├── index.ts             ← CLI entry point
    ├── config.ts            ← env var reader
    ├── types.ts             ← ParsedStatement, ParsedTransaction, Ollama types
    ├── extractText.ts       ← PDF (pdf-parse) / CSV / TXT text extraction
    ├── parseWithLlm.ts      ← Ollama/Mistral API call + prompt
    └── postProcess.ts       ← Date normalisation, OPSEC account masking, amount cleanup
```

---

## How It Works

```
bank_statement.pdf
       │
       ▼
 extractText.ts         PDF → raw text + SHA-256 source hash
       │
       ▼
 parseWithLlm.ts        raw text → Ollama /api/generate (Mistral 7B, format: json)
       │
       ▼
 postProcess.ts         normalise dates, mask account ref to last 4 digits,
                        strip currency symbols, set parsing_confidence
       │
       ▼
 stdout                 ParsedStatement JSON (pipe to file or Phase 1 reconciliation)
```

Progress/errors go to **stderr**; structured JSON goes to **stdout** — safe to redirect:
```bash
npm run parse statement.pdf > parsed.json
```

---

## Setup

### 1. Install Ollama

Download from [ollama.com](https://ollama.com) and install for your OS.

```bash
# Start the Ollama daemon (runs on port 11434)
ollama serve
```

### 2. Pull the model

```bash
ollama pull mistral
# Downloads mistral:latest (~4 GB). One-time download.
```

Verify it works:
```bash
ollama run mistral "Say hello"
```

### 3. Install package

```bash
cd jag-bank-parser-poc
npm install
cp .env.example .env
# .env defaults are fine for local dev — no changes needed unless Ollama is on a different port
```

### 4. Run

```bash
# Parse a PDF
npm run parse sample/statement.pdf

# Parse and save output
npm run parse sample/statement.pdf > parsed.json

# Parse a CSV export
npm run parse sample/rbc_export.csv
```

---

## Output Schema

```json
{
  "account_reference": "****1234",
  "bank_name": "Republic Bank",
  "statement_period_start": "2026-01-01",
  "statement_period_end": "2026-01-31",
  "transactions": [
    {
      "date": "2026-01-05",
      "description": "RENT CREDIT - BARATARIA",
      "reference": "CHQ0012",
      "debit": null,
      "credit": 3500.00,
      "balance": 15950.00,
      "raw_line": "05/01/2026  RENT CREDIT - BARATARIA  CHQ0012  3,500.00  15,950.00"
    }
  ],
  "parsing_confidence": "high",
  "source_hash": "a3f9c2d1...",
  "parsed_at": "2026-05-24T14:32:00.000Z"
}
```

### Field notes

| Field | Notes |
|---|---|
| `account_reference` | Last 4 digits only — OPSEC (STD-04). Never the full account number. |
| `source_hash` | SHA-256 of the raw file bytes. Use in Phase 1 to prevent duplicate imports. |
| `parsing_confidence` | `high` = clean digital PDF; `medium` = ambiguous layout; `low` = scanned/image |
| `debit` / `credit` | Always positive numbers. Debit = money out, credit = money in. |
| `raw_line` | Original text from the statement — kept for audit and dispute resolution. |

---

## Prompt Design

The Mistral prompt uses `format: "json"` mode for reliable structured output. Key decisions:

- **Temperature 0.1** — close to deterministic, avoids hallucination on financial figures
- **`num_predict: 8192`** — enough tokens for a full month statement (~50–100 transactions)
- **Account masking in the prompt** — tells Mistral to extract only last 4 digits, reinforced in `postProcess.ts`
- **TT date formats handled** — DD/MM/YYYY, DD-Mon-YYYY, DD-Mon-YY all normalised in `postProcess.ts` as a safety net
- **`raw_line` requested** — preserves the original text per transaction for audit without needing to re-parse

---

## Known Limitations

| Limitation | Impact | Phase 1 fix |
|---|---|---|
| Single-pass LLM call — no chunking | Statements > 24K chars truncated with warning | Add chunk-merge logic with overlap |
| PDF text extraction fails on scanned/image PDFs | `pdf-parse` extracts text layer only — scanned PDFs return empty string | Add OCR step (Tesseract via `node-tesseract-ocr`) before LLM call |
| No DB integration | Output is JSON to stdout only | Phase 1: reconcile against `prop_rent_payments` by matching credit amounts + dates |
| Mistral accuracy varies by bank format | Some layouts may misplace amounts | Validate with each TT bank and refine prompt; curate few-shot examples |

---

## OPSEC Compliance

`postProcess.ts` enforces the mortgage/account OPSEC rule (non-negotiable STD-04):

- `account_reference` is **always masked to `****<last4>`** regardless of what Mistral returns
- The `source_hash` allows deduplication without storing the raw file content
- `raw_line` stores transaction context but never the full account number row

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `mistral` | Model name (any Ollama-compatible model) |
| `MAX_TEXT_CHARS` | `24000` | Character cap before truncation warning |

No database connection required — this is a pure parsing POC.

---

## Phase 1 Integration Path

In Phase 1, the parser output feeds a reconciliation step:

```typescript
// Phase 1 reconciliation sketch (not built yet)
const statement = JSON.parse(await exec('npm run parse statement.pdf'));
for (const tx of statement.transactions.filter(t => t.credit != null)) {
  // match tx.credit + tx.date against expected rent for each active lease
  // insert into prop_rent_payments if matched, prop_pending_review_queue if not
}
```

The `source_hash` prevents double-importing the same statement file.

---

## Files Changed This Session

| File | Change |
|---|---|
| `jag-bank-parser-poc/` | Entire package — new |

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
| PRE-6 | Bank statement parser POC (Ollama/Mistral 7B) | ✅ DONE |
| PRE-7 | Migrate JABCO domain to Cloudflare Free Tier | ⬅ NEXT |
| PRE-8 | Write DR failover runbook | Pending |
| PRE-9 | Oracle Cloud + Docker setup (Phase 0) | Pending |

---

## What Comes Next — PRE-7

**PRE-7: Migrate JABCO domain to Cloudflare Free Tier**

Move `jabco.tt` DNS to Cloudflare, enabling:
- Cloudflare Authenticated Origin Pull (guide already written — PRE-0B)
- WAF rules for the API subdomain (`api.jabco.tt`)
- Proxied records for `auth.jabco.tt` (Keycloak) and `api.jabco.tt`
- Zero-downtime cutover procedure for the existing JABCO site

PRE-7 likely produces: a step-by-step migration runbook with DNS record table, Cloudflare page rules, and rollback procedure.
