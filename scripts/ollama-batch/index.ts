#!/usr/bin/env node
/**
 * JAG Ollama Batch Processor
 *
 * Runs natively on the main workstation (not inside Docker) via Windows Task Scheduler at 02:00.
 * Connects directly to native PostgreSQL and MinIO; calls Ollama at localhost:11434.
 *
 * What it does per run:
 *   1. Claims PENDING bank statement jobs from jag_family (FOR UPDATE SKIP LOCKED)
 *   2. Downloads each file from MinIO
 *   3. Extracts text content (CSV → raw, PDF → best-effort text extraction)
 *   4. Sends to Ollama with a structured prompt to identify and categorize transactions
 *   5. Inserts parsed rows into fin_transactions (is_pending_review = true)
 *   6. Inserts each row into fin_pending_review_queue with suggested_category + confidence
 *   7. Updates job status: COMPLETE / PARTIAL / FAILED
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
  dbUrl:       env('DATABASE_URL_FAMILY'),
  ownerId:     env('OWNER_ID'),
  ollama:      env('OLLAMA_URL', 'http://localhost:11434'),
  model:       env('OLLAMA_MODEL', 'llama3.2'),
  batchLimit:  parseInt(env('BATCH_LIMIT', '10'), 10),
  dryRun:      env('DRY_RUN', 'false') === 'true',
  minio: {
    endpoint:  env('MINIO_ENDPOINT', 'localhost'),
    port:      parseInt(env('MINIO_PORT', '9000'), 10),
    useSSL:    env('MINIO_USE_SSL', 'false') === 'true',
    accessKey: env('MINIO_ACCESS_KEY'),
    secretKey: env('MINIO_SECRET_KEY'),
    bucket:    env('MINIO_BUCKET_STATEMENTS', 'jag-bank-statements'),
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

async function downloadObject(objectKey: string): Promise<Buffer> {
  const stream = await minio.getObject(CONFIG.minio.bucket, objectKey);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function deleteObject(objectKey: string): Promise<void> {
  try {
    await minio.removeObject(CONFIG.minio.bucket, objectKey);
    console.log(`  Deleted from MinIO: ${objectKey}`);
  } catch (e) {
    console.warn(`  [warn] MinIO delete failed for ${objectKey}: ${(e as Error).message}`);
  }
}

// ── Text extraction ───────────────────────────────────────────────────────────

function extractText(buf: Buffer, mimeType: string, fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();

  if (ext === '.csv' || ext === '.txt') {
    return buf.toString('utf8');
  }

  if (ext === '.pdf') {
    // Naive PDF text extraction: pull readable ASCII runs from the binary.
    // Good enough for digital PDFs from most banks (text layer intact).
    // For scanned PDFs an OCR step would be needed — out of scope here.
    const raw = buf.toString('latin1');
    const runs = raw.match(/[\x20-\x7E\r\n\t]{4,}/g) ?? [];
    return runs.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 40_000);
  }

  return buf.toString('utf8', 0, Math.min(buf.length, 40_000));
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
    const buf = await downloadObject(job.storage_path);
    console.log(`  Downloaded ${buf.length} bytes`);

    // Extract text
    const text = extractText(buf, job.mime_type, job.file_name);
    console.log(`  Extracted ${text.length} chars of text`);

    // Call Ollama
    console.log(`  Calling Ollama (${CONFIG.model}) …`);
    const transactions = await callOllama(text);
    console.log(`  Ollama returned ${transactions.length} transactions`);

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
    await deleteObject(job.storage_path);
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
      await deleteObject(job.storage_path);
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

  if (!jobs.length) {
    console.log('No PENDING jobs found. Nothing to do.');
    await pool.end();
    return;
  }

  console.log(`\nClaimed ${jobs.length} job(s)`);

  for (const job of jobs) {
    await processJob(job);
  }

  console.log(`\n========================================`);
  console.log(`Batch complete. Processed ${jobs.length} job(s).`);
  console.log(`========================================\n`);

  await pool.end();
}

main().catch((e) => {
  console.error('Fatal batch error:', e);
  process.exit(1);
});
