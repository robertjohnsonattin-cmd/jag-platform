#!/usr/bin/env node
/**
 * JAG Ollama Batch Processor
 *
 * Runs natively on the main workstation (not inside Docker) via Windows Task Scheduler at 02:00.
 * Connects directly to native PostgreSQL and MinIO; calls Ollama at localhost:11434.
 *
 * What it does per run:
 *   Bank statement jobs (fin_bank_statement_jobs):
 *   1. Claims PENDING jobs (FOR UPDATE SKIP LOCKED)
 *   2. Downloads file from MinIO
 *   3. Extracts text (CSV → raw, PDF → best-effort text extraction)
 *   4. Sends to Ollama with transaction extraction prompt
 *   5. Inserts parsed rows into fin_transactions (is_pending_review = true)
 *   6. Inserts each row into fin_pending_review_queue with suggested_category + confidence
 *   7. Updates job: COMPLETE / PARTIAL / FAILED; deletes MinIO object
 *
 *   Document jobs (fin_document_jobs — LOAN / INVESTMENT / INSURANCE):
 *   1. Claims PENDING jobs (FOR UPDATE SKIP LOCKED)
 *   2. Downloads file from MinIO
 *   3. Extracts text
 *   4. Sends to Ollama with per-type extraction prompt
 *   5. Stores extracted_data JSONB on job record; sets status → REVIEW
 *   6. Deletes MinIO object (file no longer needed — data is in extracted_data)
 *   Robert reviews + approves in the Finance → Documents tab in the web UI.
 *
 * Config (env vars or .env.ollama-batch in this directory):
 *   DATABASE_URL_FAMILY   postgres://jag_app:...@localhost:5432/jag_family
 *   OWNER_ID              Robert's jag_core.users.id
 *   MINIO_ENDPOINT        localhost
 *   MINIO_PORT            9000
 *   MINIO_USE_SSL         false
 *   MINIO_ACCESS_KEY      jag_minio_admin
 *   MINIO_SECRET_KEY      minio123
 *   MINIO_BUCKET_STATEMENTS jag-bank-statements
 *   OLLAMA_URL            http://localhost:11434
 *   OLLAMA_MODEL          llama3.2          (or any model you have pulled)
 *   BATCH_LIMIT           10                (jobs per run)
 *   DRY_RUN               false             (set true to parse without writing)
 */

import * as fs from 'fs';
import * as path from 'path';
import { Pool, type PoolClient } from 'pg';
import { Client as MinioClient } from 'minio';

// ── Config ────────────────────────────────────────────────────────────────────

function loadEnv(): void {
  const envFile = path.resolve(__dirname, '..', '.env.ollama-batch');
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const CONFIG = {
  dbUrl:        env('DATABASE_URL_FAMILY'),
  ownerId:      env('OWNER_ID'),
  ollama:       env('OLLAMA_URL', 'http://localhost:11434'),
  model:        env('OLLAMA_MODEL', 'llama3.2'),
  modelVision:  env('OLLAMA_MODEL_VISION', 'llama3.2-vision'),
  batchLimit:   parseInt(env('BATCH_LIMIT', '10'), 10),
  dryRun:       env('DRY_RUN', 'false') === 'true',
  minio: {
    endpoint:       env('MINIO_ENDPOINT', 'localhost'),
    port:           parseInt(env('MINIO_PORT', '9000'), 10),
    useSSL:         env('MINIO_USE_SSL', 'false') === 'true',
    accessKey:      env('MINIO_ACCESS_KEY'),
    secretKey:      env('MINIO_SECRET_KEY'),
    bucketStmts:    env('MINIO_BUCKET_STATEMENTS', 'jag-bank-statements'),
    bucketDocuments: env('MINIO_BUCKET_DOCUMENTS', 'jag-documents'),
  },
};

// ── Clients ───────────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: CONFIG.dbUrl });


const minio = new MinioClient({
  endPoint:  CONFIG.minio.endpoint,
  port:      CONFIG.minio.port,
  useSSL:    CONFIG.minio.useSSL,
  accessKey: CONFIG.minio.accessKey,
  secretKey: CONFIG.minio.secretKey,
});

// ── Document job types ────────────────────────────────────────────────────────

interface DocumentJob {
  id:           string;
  owner_id:     string;
  doc_type:     'LOAN' | 'INVESTMENT' | 'INSURANCE';
  file_name:    string;
  storage_path: string;
  mime_type:    string;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface StatementJob {
  id:         string;
  owner_id:   string;
  account_id: string;
  file_name:  string;
  storage_path: string;
  mime_type:  string;
}

interface ParsedTransaction {
  transaction_date: string;   // YYYY-MM-DD
  amount:           number;   // positive = credit, negative = debit
  currency:         string;
  description:      string;
  merchant_name:    string | null;
  reference_number: string | null;
  suggested_category: string;
  confidence:       number;   // 0.0–1.0
}

// ── RLS helper ────────────────────────────────────────────────────────────────

async function withOwner<T>(client: PoolClient, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', CONFIG.ownerId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', CONFIG.ownerId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

// ── MinIO helpers ─────────────────────────────────────────────────────────────

async function downloadObject(bucket: string, objectKey: string): Promise<Buffer> {
  const stream = await minio.getObject(bucket, objectKey);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function deleteObject(bucket: string, objectKey: string): Promise<void> {
  try {
    await minio.removeObject(bucket, objectKey);
    console.log(`  Deleted from MinIO: ${objectKey}`);
  } catch (e) {
    console.warn(`  [warn] MinIO delete failed for ${objectKey}: ${(e as Error).message}`);
  }
}

// ── Text / image extraction ───────────────────────────────────────────────────
//
// Digital PDFs: pdf-parse extracts text layer directly (fast)
// Scanned PDFs: pdfjs-dist renders pages to PNG → sent directly to llama3.2-vision
//
// Both bank-statement jobs and document jobs go through the same pipeline.

// Calls the vision model with one or more page images and a prompt.
async function callOllamaVision(prompt: string, images: Buffer[]): Promise<string> {
  const base64 = images.map(img => img.toString('base64'));
  const body = JSON.stringify({
    model:   CONFIG.modelVision,
    prompt,
    images:  base64,
    stream:  false,
    options: { temperature: 0.1, num_predict: 4096 },
  });

  const res = await fetch(`${CONFIG.ollama}/api/generate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal:  AbortSignal.timeout(300_000),
  });

  if (!res.ok) throw new Error(`Ollama vision HTTP ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as { response: string };
  return data.response.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
}

async function pdfToImages(buf: Buffer): Promise<Buffer[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfjsLib = require('pdfjs-dist') as typeof import('pdfjs-dist');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createCanvas } = require('canvas') as typeof import('canvas');

  // pdfjs-dist 3.x: empty workerSrc = fake worker (runs in-process, no Worker thread needed)
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const images: Buffer[] = [];
  // Cap at 5 pages — JPEG keeps each page ~200KB base64 (~1.3MB total), well within Ollama limits
  const numPages = Math.min(pdf.numPages, 5);

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 }); // 1.5x: good quality, manageable size
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');

    // Node.js canvas polyfill — cast through unknown to satisfy pdfjs-dist's browser-typed API
    await page.render({
      canvasContext: ctx as unknown,
      viewport,
    } as Parameters<typeof page.render>[0]).promise;

    // JPEG at q=85: ~5× smaller than PNG, still plenty of detail for vision model OCR
    images.push((canvas as unknown as { toBuffer(fmt: string, cfg: object): Buffer })
      .toBuffer('image/jpeg', { quality: 85 }));
  }
  return images;
}

// Returns { text, scanned }. When scanned=true the PDF has no extractable text layer;
// the caller should use pdfToImages() + callOllamaVision() instead.
async function extractText(
  buf: Buffer, _mimeType: string, fileName: string,
): Promise<{ text: string; scanned: boolean }> {
  const ext = path.extname(fileName).toLowerCase();

  if (ext === '.csv' || ext === '.txt') {
    return { text: buf.toString('utf8'), scanned: false };
  }

  if (ext === '.pdf') {
    // ── Tier 1: pdf-parse ────────────────────────────────────────────────────
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParseModule = require('pdf-parse');
      // pdf-parse exports the function as default OR as the module itself depending on version
      const pdfParse = (typeof pdfParseModule === 'function' ? pdfParseModule : pdfParseModule.default) as
        (buf: Buffer) => Promise<{ text: string }>;
      const { text } = await pdfParse(buf);
      const trimmed = text.trim();
      // Quality heuristic: count runs of 3+ alphanumeric chars as readable content
      const readable = (trimmed.match(/[a-zA-Z0-9]{3,}/g) ?? []).join('').length;
      if (readable >= 100) {
        console.log(`  pdf-parse: ${trimmed.length} chars (${readable} readable) ✓`);
        return { text: trimmed.slice(0, 40_000), scanned: false };
      }
      console.log(`  pdf-parse: poor quality (${readable} readable chars < 100) → vision model`);
    } catch (e) {
      console.warn(`  pdf-parse failed: ${(e as Error).message} → vision model`);
    }

    // ── Scanned PDF — caller will use pdfToImages + vision model ─────────────
    return { text: '', scanned: true };
  }

  return { text: buf.toString('utf8', 0, Math.min(buf.length, 40_000)), scanned: false };
}

// ── Ollama call ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a financial data extraction assistant for a Caribbean family office.
Extract all bank transactions from the statement text provided and return them as a JSON array.

Each transaction object must have:
  transaction_date   string  YYYY-MM-DD
  amount             number  positive=credit, negative=debit (in the statement currency)
  currency           string  ISO 4217 (e.g. TTD, USD)
  description        string  raw description from statement
  merchant_name      string|null  cleaned merchant/payee name, null if unknown
  reference_number   string|null  cheque number, ref code, or null
  suggested_category string  one of: SALARY, DIVIDEND, RENTAL_INCOME, INTEREST_INCOME,
                             TRANSFER_IN, OPERATING_EXPENSE, PAYROLL, TAX_PAYMENT,
                             LOAN_REPAYMENT, INVESTMENT_PURCHASE, INVESTMENT_SALE,
                             TRANSFER_OUT, PERSONAL_EXPENSE, UTILITIES, INSURANCE,
                             ENTERTAINMENT, TRAVEL, MEDICAL, EDUCATION, CHARITY, UNCLASSIFIED
  confidence         number  0.0–1.0 how confident you are in the category

Return ONLY the JSON array with no markdown fences, no commentary, no extra text.
If no transactions are found return an empty array [].`;

async function callOllama(statementText: string): Promise<ParsedTransaction[]> {
  const body = JSON.stringify({
    model:  CONFIG.model,
    prompt: `${SYSTEM_PROMPT}\n\n---STATEMENT---\n${statementText.slice(0, 30_000)}`,
    stream: false,
    options: { temperature: 0.1, num_predict: 8192 },
  });

  const res = await fetch(`${CONFIG.ollama}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(300_000), // 5 min — large statements can be slow
  });

  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { response: string };
  const raw = data.response.trim();

  // Strip markdown fences if the model wrapped them anyway
  const json = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Ollama returned non-JSON response: ${raw.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Ollama returned non-array: ${raw.slice(0, 200)}`);
  }

  // Validate and coerce each row
  const transactions: ParsedTransaction[] = [];
  for (const row of parsed) {
    if (typeof row !== 'object' || !row) continue;
    const r = row as Record<string, unknown>;
    if (!r['transaction_date'] || typeof r['amount'] !== 'number') continue;
    transactions.push({
      transaction_date: String(r['transaction_date']),
      amount:           Number(r['amount']),
      currency:         String(r['currency'] ?? 'TTD'),
      description:      String(r['description'] ?? ''),
      merchant_name:    r['merchant_name'] ? String(r['merchant_name']) : null,
      reference_number: r['reference_number'] ? String(r['reference_number']) : null,
      suggested_category: String(r['suggested_category'] ?? 'UNCLASSIFIED'),
      confidence:        Number(r['confidence'] ?? 0.5),
    });
  }
  return transactions;
}

// ── DB writes ─────────────────────────────────────────────────────────────────

async function writeTransactions(
  client: PoolClient,
  job: StatementJob,
  rows: ParsedTransaction[],
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped  = 0;

  for (const row of rows) {
    try {
      const idem = `ollama-batch:${job.id}:${row.transaction_date}:${row.amount}:${row.description.slice(0, 50)}`;

      const txResult = await client.query(
        `INSERT INTO fin_transactions
           (owner_id, account_id, transaction_date, amount, currency,
            amount_ttd, description, merchant_name, reference_number,
            category, is_pending_review, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$4,$6,$7,$8,'UNCLASSIFIED',true,$9)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [
          job.owner_id, job.account_id, row.transaction_date,
          row.amount, row.currency,
          row.description, row.merchant_name ?? null,
          row.reference_number ?? null, idem,
        ],
      );

      if (!txResult.rows.length) { skipped++; continue; }
      const txId = txResult.rows[0].id as string;

      await client.query(
        `INSERT INTO fin_pending_review_queue
           (owner_id, transaction_id, job_id, suggested_category, confidence)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [job.owner_id, txId, job.id, row.suggested_category, Math.min(1, Math.max(0, row.confidence))],
      );

      imported++;
    } catch (e) {
      console.warn(`  [skip] row insert failed: ${(e as Error).message}`);
      skipped++;
    }
  }

  return { imported, skipped };
}

// ── Job processor ─────────────────────────────────────────────────────────────

async function processJob(job: StatementJob): Promise<void> {
  const client = await pool.connect();
  console.log(`\n[job ${job.id}] ${job.file_name}`);

  try {
    // Mark PROCESSING
    await withOwner(client, (c) =>
      c.query(
        `UPDATE fin_bank_statement_jobs SET status = 'PROCESSING', started_at = now(), updated_at = now() WHERE id = $1`,
        [job.id],
      )
    );

    // Download from MinIO
    console.log(`  Downloading ${job.storage_path} …`);
    const buf = await downloadObject(CONFIG.minio.bucketStmts, job.storage_path);
    console.log(`  Downloaded ${buf.length} bytes`);

    // Extract text — or detect scanned PDF
    const { text, scanned } = await extractText(buf, job.mime_type, job.file_name);

    // Call Ollama — vision model for scanned PDFs, text model otherwise
    let transactions: ParsedTransaction[];
    if (scanned) {
      console.log(`  Scanned PDF — rendering to images for ${CONFIG.modelVision} …`);
      const images = await pdfToImages(buf);
      console.log(`  Rendered ${images.length} page(s)`);
      const visionPrompt = `${SYSTEM_PROMPT}\n\nExtract all transactions from the bank statement image(s). Return ONLY the JSON array.`;
      const raw = await callOllamaVision(visionPrompt, images);
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { parsed = []; }
      if (!Array.isArray(parsed)) parsed = [];
      transactions = (parsed as Record<string, unknown>[]).filter(
        r => r && r['transaction_date'] && typeof r['amount'] === 'number'
      ).map(r => ({
        transaction_date:   String(r['transaction_date']),
        amount:             Number(r['amount']),
        currency:           String(r['currency'] ?? 'TTD'),
        description:        String(r['description'] ?? ''),
        merchant_name:      r['merchant_name'] ? String(r['merchant_name']) : null,
        reference_number:   r['reference_number'] ? String(r['reference_number']) : null,
        suggested_category: String(r['suggested_category'] ?? 'UNCLASSIFIED'),
        confidence:         Number(r['confidence'] ?? 0.5),
      }));
      console.log(`  Vision model returned ${transactions.length} transactions`);
    } else {
      console.log(`  Extracted ${text.length} chars — calling Ollama (${CONFIG.model}) …`);
      transactions = await callOllama(text);
      console.log(`  Ollama returned ${transactions.length} transactions`);
    }

    if (CONFIG.dryRun) {
      console.log('  DRY RUN — skipping DB writes and MinIO delete');
      console.log('  Sample:', JSON.stringify(transactions.slice(0, 2), null, 2));
      await withOwner(client, (c) =>
        c.query(
          `UPDATE fin_bank_statement_jobs SET status = 'PENDING', updated_at = now() WHERE id = $1`,
          [job.id],
        )
      );
      return;
    }

    // Write transactions
    const { imported, skipped } = await withOwner(client, (c) =>
      writeTransactions(c, job, transactions)
    );
    console.log(`  Imported ${imported}, skipped ${skipped}`);

    // Update job to COMPLETE or PARTIAL
    const status = imported > 0 ? (skipped > 0 ? 'PARTIAL' : 'COMPLETE') : 'FAILED';
    await withOwner(client, (c) =>
      c.query(
        `UPDATE fin_bank_statement_jobs
         SET status = $2, completed_at = now(), updated_at = now(),
             rows_parsed = $3, rows_imported = $4, rows_skipped = $5
         WHERE id = $1`,
        [job.id, status, transactions.length, imported, skipped],
      )
    );
    console.log(`  Job → ${status}`);

    // Auto-delete source file — transactions are in the DB, original file no longer needed
    await deleteObject(CONFIG.minio.bucketStmts, job.storage_path);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error(`  [error] ${msg}`);
    try {
      await withOwner(client, (c) =>
        c.query(
          `UPDATE fin_bank_statement_jobs
           SET status = 'FAILED', error_detail = $2, updated_at = now()
           WHERE id = $1`,
          [job.id, msg.slice(0, 2000)],
        )
      );
      // Also delete on failure — no point keeping the file if processing failed
      await deleteObject(CONFIG.minio.bucketStmts, job.storage_path);
    } catch { /* ignore secondary failure */ }
  } finally {
    client.release();
  }
}

// ── Document job prompts ──────────────────────────────────────────────────────

const DOC_PROMPTS: Record<DocumentJob['doc_type'], string> = {
  LOAN: `You are a financial data extraction assistant for a Caribbean family office.
Extract loan or mortgage details from the document text and return a single JSON object.

Return ONLY the JSON object — no markdown fences, no commentary.

Required fields (use null if not found):
{
  "lender_name":            string,
  "loan_type":              "MORTGAGE" | "CAR_LOAN" | "PERSONAL_LOAN" | "BUSINESS_LOAN" | "OVERDRAFT" | "OTHER",
  "original_principal":     number,
  "outstanding_balance":    number,
  "currency":               string,  // ISO 4217, e.g. "TTD", "USD"
  "interest_rate":          number,  // annual %, e.g. 6.5
  "interest_type":          "FIXED" | "VARIABLE",
  "monthly_payment":        number | null,
  "start_date":             "YYYY-MM-DD" | null,
  "maturity_date":          "YYYY-MM-DD" | null,
  "collateral_description": string | null
}`,

  INVESTMENT: `You are a financial data extraction assistant for a Caribbean family office.
Extract investment portfolio details from the statement and return a JSON object.

Return ONLY the JSON object — no markdown fences, no commentary.

{
  "institution_name": string,
  "as_of_date":       "YYYY-MM-DD" | null,
  "holdings": [
    {
      "asset_name":      string,
      "investment_type": "EQUITY" | "BOND" | "MUTUAL_FUND" | "ETF" | "UNIT_TRUST" | "ANNUITY" | "CASH_EQUIVALENT" | "OTHER",
      "ticker_symbol":   string | null,
      "units_held":      number,
      "current_price":   number | null,
      "currency":        string,
      "current_value_ttd": number | null,
      "purchase_date":   "YYYY-MM-DD" | null,
      "maturity_date":   "YYYY-MM-DD" | null
    }
  ]
}

If the statement shows a single fund or asset with no breakdown, return holdings with one item.`,

  INSURANCE: `You are a financial data extraction assistant for a Caribbean family office.
Extract insurance policy details from the document and return a single JSON object.

Return ONLY the JSON object — no markdown fences, no commentary.

{
  "policy_number":      string,
  "insurer_name":       string,
  "broker_name":        string | null,
  "policy_type":        "PROPERTY" | "VEHICLE" | "LIABILITY" | "LIFE" | "HEALTH" | "BUSINESS_INTERRUPTION" | "MARINE" | "PROFESSIONAL_INDEMNITY" | "OTHER",
  "insured_asset_type": "VEHICLE" | "PROPERTY" | "BUSINESS" | "PERSON" | "OTHER",
  "coverage_amount":    number,
  "currency":           string,
  "premium_amount":     number,
  "premium_frequency":  "MONTHLY" | "QUARTERLY" | "SEMI_ANNUAL" | "ANNUAL" | "ONE_OFF",
  "start_date":         "YYYY-MM-DD",
  "expiry_date":        "YYYY-MM-DD"
}`,
};

// Shared JSON parser for document extraction responses (text and vision paths).
function parseOllamaDocJson(raw: string, docType: DocumentJob['doc_type']): unknown {
  try { return JSON.parse(raw); } catch { /* fall through */ }

  const objMatch = raw.match(/\{[\s\S]*\}/);
  const arrMatch = raw.match(/\[[\s\S]*\]/);
  const jsonStr  = objMatch?.[0] ?? arrMatch?.[0];
  if (jsonStr) { try { return JSON.parse(jsonStr); } catch { /* fall through */ } }

  // Return a minimal stub so the job lands in REVIEW rather than FAILED.
  // Robert can fill in the details manually before approving.
  console.warn(`  [warn] Ollama non-JSON response — returning minimal stub for manual review`);
  console.warn(`  Raw (first 300): ${raw.slice(0, 300)}`);
  const stubs: Record<DocumentJob['doc_type'], unknown> = {
    LOAN:       { lender_name: null, loan_type: 'OTHER', original_principal: 0, outstanding_balance: 0, currency: 'TTD', interest_rate: 0, interest_type: 'FIXED', monthly_payment: null, start_date: null, maturity_date: null, collateral_description: null },
    INVESTMENT: { institution_name: null, as_of_date: null, holdings: [] },
    INSURANCE:  { policy_number: null, insurer_name: null, broker_name: null, policy_type: 'OTHER', insured_asset_type: 'OTHER', coverage_amount: 0, currency: 'TTD', premium_amount: 0, premium_frequency: 'ANNUAL', start_date: null, expiry_date: null },
  };
  return stubs[docType];
}

async function callOllamaForDocument(docType: DocumentJob['doc_type'], text: string): Promise<unknown> {
  const prompt = DOC_PROMPTS[docType];
  const body = JSON.stringify({
    model:  CONFIG.model,
    prompt: `${prompt}\n\n---DOCUMENT---\n${text.slice(0, 30_000)}`,
    stream: false,
    options: { temperature: 0.1, num_predict: 4096 },
  });

  const res = await fetch(`${CONFIG.ollama}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as { response: string };
  const raw  = data.response.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  return parseOllamaDocJson(raw, docType);
}

// ── Document job processor ────────────────────────────────────────────────────

async function processDocumentJob(job: DocumentJob): Promise<void> {
  const client = await pool.connect();
  console.log(`\n[doc-job ${job.id}] ${job.doc_type} — ${job.file_name}`);

  try {
    await withOwner(client, (c) =>
      c.query(
        `UPDATE fin_document_jobs SET status = 'PROCESSING', started_at = now(), updated_at = now() WHERE id = $1`,
        [job.id],
      )
    );

    console.log(`  Downloading ${job.storage_path} …`);
    const buf = await downloadObject(CONFIG.minio.bucketDocuments, job.storage_path);
    console.log(`  Downloaded ${buf.length} bytes`);

    // Try text extraction first (fast). Fall back to llava vision if text is empty/garbled.
    const { text, scanned } = await extractText(buf, job.mime_type, job.file_name);

    let extracted: unknown;
    if (!scanned && text.trim().length > 0) {
      console.log(`  Extracted ${text.length} chars — calling Ollama (${CONFIG.model}) for ${job.doc_type} …`);
      extracted = await callOllamaForDocument(job.doc_type, text);
    } else {
      console.log(`  Text extraction empty/failed — using vision model (${CONFIG.modelVision}) …`);
      const images = await pdfToImages(buf);
      console.log(`  Rendered ${images.length} page(s)`);
      const visionPrompt = `${DOC_PROMPTS[job.doc_type]}\n\nExtract the data from the document image(s). Return ONLY the JSON object.`;
      const raw = await callOllamaVision(visionPrompt, images);
      extracted = parseOllamaDocJson(raw, job.doc_type);
    }
    console.log(`  Extracted:`, JSON.stringify(extracted, null, 2).slice(0, 400));

    if (CONFIG.dryRun) {
      console.log('  DRY RUN — skipping DB write and MinIO delete');
      await withOwner(client, (c) =>
        c.query(`UPDATE fin_document_jobs SET status = 'PENDING', updated_at = now() WHERE id = $1`, [job.id])
      );
      return;
    }

    await withOwner(client, (c) =>
      c.query(
        `UPDATE fin_document_jobs
         SET status = 'REVIEW', extracted_data = $2, completed_at = now(), updated_at = now()
         WHERE id = $1`,
        [job.id, JSON.stringify(extracted)],
      )
    );
    console.log(`  Job → REVIEW (awaiting Robert's approval in Finance → Documents)`);

    await deleteObject(CONFIG.minio.bucketDocuments, job.storage_path);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error(`  [error] ${msg}`);
    try {
      await withOwner(client, (c) =>
        c.query(
          `UPDATE fin_document_jobs SET status = 'FAILED', error_detail = $2, updated_at = now() WHERE id = $1`,
          [job.id, msg.slice(0, 2000)],
        )
      );
      await deleteObject(CONFIG.minio.bucketDocuments, job.storage_path);
    } catch { /* ignore secondary failure */ }
  } finally {
    client.release();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`\n========================================`);
  console.log(`JAG Ollama Batch  ${startedAt}`);
  console.log(`Model:   ${CONFIG.model}`);
  console.log(`Limit:   ${CONFIG.batchLimit} jobs`);
  console.log(`DryRun:  ${CONFIG.dryRun}`);
  console.log(`========================================`);

  // Claim PENDING jobs
  const client = await pool.connect();
  let jobs: StatementJob[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', CONFIG.ownerId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id',  CONFIG.ownerId]);
    const { rows } = await client.query<StatementJob>(
      `SELECT id, owner_id, account_id, file_name, storage_path, mime_type
       FROM fin_bank_statement_jobs
       WHERE status = 'PENDING'
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [CONFIG.batchLimit],
    );
    jobs = rows;
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  if (jobs.length) {
    console.log(`\nClaimed ${jobs.length} statement job(s)`);
    for (const job of jobs) {
      await processJob(job);
    }
  }

  // ── Document jobs (LOAN / INVESTMENT / INSURANCE) ──────────────────────────
  const docClient = await pool.connect();
  let docJobs: DocumentJob[] = [];
  try {
    await docClient.query('BEGIN');
    await docClient.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', CONFIG.ownerId]);
    await docClient.query('SELECT set_config($1, $2, true)', ['app.current_user_id',  CONFIG.ownerId]);
    const { rows } = await docClient.query<DocumentJob>(
      `SELECT id, owner_id, doc_type, file_name, storage_path, mime_type
       FROM fin_document_jobs
       WHERE status = 'PENDING'
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [CONFIG.batchLimit],
    );
    docJobs = rows;
    await docClient.query('COMMIT');
  } catch (e) {
    await docClient.query('ROLLBACK');
    throw e;
  } finally {
    docClient.release();
  }

  if (docJobs.length) {
    console.log(`\nClaimed ${docJobs.length} document job(s)`);
    for (const job of docJobs) {
      await processDocumentJob(job);
    }
  }

  const total = jobs.length + docJobs.length;
  if (!total) {
    console.log('No PENDING jobs found. Nothing to do.');
  } else {
    console.log(`\n========================================`);
    console.log(`Batch complete. Processed ${total} job(s) total.`);
    console.log(`========================================\n`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error('Fatal batch error:', e);
  process.exit(1);
});
