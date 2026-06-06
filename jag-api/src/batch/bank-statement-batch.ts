/**
 * JAG Finance — Bank Statement Batch Processor
 *
 * Runs nightly at 2am (Windows Task Scheduler or cron on Oracle VM).
 * Picks up all PENDING fin_bank_statement_jobs, extracts text, calls Ollama,
 * inserts fin_transactions, flags low-confidence items to fin_pending_review_queue.
 *
 * Run:  npx ts-node src/batch/bank-statement-batch.ts
 * Or:   node dist/batch/bank-statement-batch.js   (after tsc build)
 *
 * Required env:
 *   DATABASE_URL_FAMILY   — jag_family connection string (with jag_app credentials)
 *   BATCH_OWNER_ID        — UUID of the system owner (Robert's users.id in jag_core)
 *   OLLAMA_URL            — default http://localhost:11434
 *   OLLAMA_MODEL          — default mistral
 *
 * Confidence threshold: >= 0.85 → auto-import as UNCLASSIFIED (AI sets category suggestion).
 *                       <  0.85 → import as UNCLASSIFIED + add to pending_review_queue.
 */

import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { extractText } from '../lib/extractor/extract';
import { parseWithOllama, postProcess } from '../lib/extractor/parse';

const CONFIDENCE_THRESHOLD = 0.85;

// fin_pending_review_queue confidence scores map from 'high'|'medium'|'low'
const CONFIDENCE_SCORE: Record<string, number> = {
  high: 0.92,
  medium: 0.70,
  low: 0.40,
};

const familyPool = new Pool({
  connectionString: process.env['DATABASE_URL_FAMILY'],
});

const OWNER_ID = process.env['BATCH_OWNER_ID'];

async function main(): Promise<void> {
  if (!OWNER_ID) throw new Error('BATCH_OWNER_ID env var is required.');

  console.log(`[batch] Starting bank statement batch — ${new Date().toISOString()}`);

  const client = await familyPool.connect();
  try {
    // Set RLS context for the batch owner
    await client.query('SELECT set_config($1,$2,true)', ['app.current_owner_id', OWNER_ID]);

    // Claim PENDING jobs atomically — mark as PROCESSING so concurrent runs skip them
    const { rows: jobs } = await client.query<{
      id: string; account_id: string; storage_path: string;
      file_name: string; idempotency_key: string;
    }>(
      `UPDATE fin_bank_statement_jobs
       SET    status = 'PROCESSING', started_at = now(), updated_at = now()
       WHERE  status = 'PENDING' AND owner_id = $1
       RETURNING id, account_id, storage_path, file_name, idempotency_key`,
      [OWNER_ID],
    );

    if (jobs.length === 0) {
      console.log('[batch] No pending jobs. Exiting.');
      return;
    }

    console.log(`[batch] ${jobs.length} job(s) to process.`);

    for (const job of jobs) {
      await processJob(client, job);
    }
  } finally {
    client.release();
    await familyPool.end();
  }

  console.log(`[batch] Done — ${new Date().toISOString()}`);
}

async function processJob(
  client: PoolClient,
  job: { id: string; account_id: string; storage_path: string; file_name: string; idempotency_key: string },
): Promise<void> {
  console.log(`[batch] Processing job ${job.id} — ${job.file_name}`);

  let rowsParsed = 0;
  let rowsImported = 0;
  let rowsSkipped = 0;

  try {
    // 1. Extract text from file
    const extracted = await extractText(job.storage_path);
    console.log(`[batch] Extracted ${extracted.text.length} chars from ${extracted.format}`);

    // 2. Call Ollama
    const raw = await parseWithOllama(extracted.text);
    const statement = postProcess(raw, extracted.sourceHash);

    console.log(`[batch] Parsed ${statement.transactions.length} transactions — confidence: ${statement.parsing_confidence}`);

    const confidenceScore = CONFIDENCE_SCORE[statement.parsing_confidence] ?? 0.5;
    const needsReview = confidenceScore < CONFIDENCE_THRESHOLD;

    rowsParsed = statement.transactions.length;

    // Update job with period dates
    await client.query(
      `UPDATE fin_bank_statement_jobs
       SET statement_from = $1, statement_to = $2, updated_at = now()
       WHERE id = $3`,
      [statement.statement_period_start, statement.statement_period_end, job.id],
    );

    // 3. Insert transactions
    for (const tx of statement.transactions) {
      // amount: credit = positive, debit = negative (matches fin_transactions convention)
      const amount = tx.credit != null
        ? tx.credit
        : tx.debit != null ? -tx.debit : 0;

      // Idempotency key: job_id + raw_line hash — prevents double-import on re-run
      const txIdempotencyKey = `${job.idempotency_key}:${tx.date}:${tx.raw_line.slice(0, 80)}`;

      let txId: string | null = null;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO fin_transactions
             (owner_id, account_id, transaction_date, amount, currency,
              description, reference_number, is_pending_review, idempotency_key)
           VALUES ($1,$2,$3,$4,'TTD',$5,$6,$7,$8)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id`,
          [
            OWNER_ID, job.account_id, tx.date, amount,
            tx.description, tx.reference, needsReview,
            txIdempotencyKey,
          ],
        );

        if (rows.length > 0) {
          txId = rows[0].id;
          rowsImported++;
        } else {
          rowsSkipped++;  // already imported (duplicate idempotency key)
        }
      } catch (txErr) {
        console.warn(`[batch] Skipping transaction (insert error): ${String(txErr)}`);
        rowsSkipped++;
        continue;
      }

      // 4. Add to pending review queue if below confidence threshold
      if (needsReview && txId) {
        await client.query(
          `INSERT INTO fin_pending_review_queue
             (owner_id, transaction_id, job_id, suggested_category, confidence)
           VALUES ($1,$2,$3,NULL,$4)
           ON CONFLICT DO NOTHING`,
          [OWNER_ID, txId, job.id, confidenceScore],
        );
      }
    }

    // 5. Mark job COMPLETE
    await client.query(
      `UPDATE fin_bank_statement_jobs
       SET status = 'COMPLETE', completed_at = now(),
           rows_parsed = $1, rows_imported = $2, rows_skipped = $3,
           updated_at = now()
       WHERE id = $4`,
      [rowsParsed, rowsImported, rowsSkipped, job.id],
    );

    console.log(`[batch] Job ${job.id} complete — imported: ${rowsImported}, skipped: ${rowsSkipped}, review: ${needsReview}`);

  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[batch] Job ${job.id} FAILED: ${detail}`);

    await client.query(
      `UPDATE fin_bank_statement_jobs
       SET status = 'FAILED', completed_at = now(), error_detail = $1,
           rows_parsed = $2, rows_imported = $3, rows_skipped = $4,
           updated_at = now()
       WHERE id = $5`,
      [detail.slice(0, 2000), rowsParsed, rowsImported, rowsSkipped, job.id],
    );
  }
}

main().catch((err: unknown) => {
  console.error('[batch] Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
