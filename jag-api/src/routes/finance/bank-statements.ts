// POST   /api/v1/finance/bank-statements/upload    — Path 1: upload file, enqueue job
// POST   /api/v1/finance/bank-statements/import    — Path 2: direct JSON transaction array from local script
// GET    /api/v1/finance/bank-statements            — list jobs (newest first)
// GET    /api/v1/finance/bank-statements/:id        — job detail + status
// DELETE /api/v1/finance/bank-statements/:id        — delete job record + MinIO object (terminal states only)

import path from 'path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { minioClient, ensureBucket, statementObjectKey, BUCKET_STATEMENTS } from '../../lib/minio';

export const bankStatementsRouter = Router();

// Memory storage — buffer held in req.file.buffer, then streamed to MinIO.
// No local disk dependency inside the container.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },  // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.csv', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, CSV, and TXT files are accepted.'));
    }
  },
});

const UUIDParam = z.object({ id: z.string().uuid() });

const JobQuerySchema = z.object({
  account_id: z.string().uuid().optional(),
  status:     z.enum(['PENDING','PROCESSING','COMPLETE','FAILED','PARTIAL']).optional(),
  limit:      z.coerce.number().int().min(1).max(100).default(50),
  offset:     z.coerce.number().int().min(0).default(0),
}).strict();

const UploadBodySchema = z.object({
  account_id:      z.string().uuid(),
  idempotency_key: z.string().min(1).max(200),
}).strict();

// ── POST /bank-statements/import (Path 2 — direct JSON from local script) ────
// Accepts pre-extracted transaction array; no file upload, no MinIO, no job record.
// Creates fin_transactions + fin_pending_review_queue entries directly.

const ImportTransactionSchema = z.object({
  account_id:          z.string().uuid(),
  transaction_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount:              z.number(),
  currency:            z.string().length(3).default('TTD'),
  description:         z.string().min(1).max(500),
  merchant_name:       z.string().max(200).nullable().optional(),
  reference_number:    z.string().max(100).nullable().optional(),
  suggested_category:  z.string().max(50).optional(),
  confidence:          z.number().min(0).max(1).optional(),
  idempotency_key:     z.string().min(1).max(200),
});

const ImportTransactionsSchema = z.object({
  transactions: z.array(ImportTransactionSchema).min(1).max(500),
}).strict();

bankStatementsRouter.post('/import', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ImportTransactionsSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'transactions array is required (at least 1 item).'); return; }
    const { transactions } = parsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    let imported = 0;
    let skipped  = 0;
    try {
      for (const tx of transactions) {
        const result = await withOwnerRLS(client, req.rlsCtx, async (c) => {
          // Verify account belongs to owner
          const acct = await c.query(
            `SELECT id FROM fin_accounts WHERE id = $1 AND is_active = true`,
            [tx.account_id],
          );
          if (!acct.rows.length) throw Object.assign(new Error(`Account ${tx.account_id} not found.`), { statusCode: 404, code: 'NOT_FOUND' });

          const txRes = await c.query(
            `INSERT INTO fin_transactions
               (owner_id, account_id, transaction_date, amount, currency,
                amount_ttd, description, merchant_name, reference_number,
                category, is_pending_review, idempotency_key)
             VALUES ($1,$2,$3,$4,$5,$4,$6,$7,$8,'UNCLASSIFIED',true,$9)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING id`,
            [
              ownerId, tx.account_id, tx.transaction_date, tx.amount, tx.currency,
              tx.description, tx.merchant_name ?? null, tx.reference_number ?? null,
              tx.idempotency_key,
            ],
          );
          if (!txRes.rows.length) return null;
          const txId = txRes.rows[0].id as string;

          await c.query(
            `INSERT INTO fin_pending_review_queue
               (owner_id, transaction_id, suggested_category, confidence)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT DO NOTHING`,
            [ownerId, txId, tx.suggested_category ?? 'UNCLASSIFIED', tx.confidence ?? 0.5],
          );
          return txId;
        });
        if (result) { imported++; } else { skipped++; }
      }

      logger.info({ entity: 'FINANCE', action: 'BANK_STMT_IMPORTED', user_id: ownerId, imported, skipped, source: 'LOCAL_SCRIPT' });
      ok(res, { imported, skipped }, 201);
    } catch (e: unknown) {
      const typed = e as { statusCode?: number; code?: string; message?: string };
      if (typed.statusCode) { err(res, typed.statusCode, typed.code ?? 'ERROR', typed.message ?? 'Error'); return; }
      next(e);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /bank-statements/upload ─────────────────────────────────────────────

bankStatementsRouter.post(
  '/upload',
  upload.single('statement'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) { err(res, 422, 'VALIDATION_ERROR', 'No file uploaded. Field name must be "statement".'); return; }

      const parsed = UploadBodySchema.safeParse(req.body);
      if (!parsed.success) {
        err(res, 422, 'VALIDATION_ERROR', 'account_id and idempotency_key are required.');
        return;
      }
      const { account_id, idempotency_key } = parsed.data;
      const { ownerId } = req.rlsCtx;

      const mimeType  = req.file.mimetype || 'application/octet-stream';
      const objectKey = statementObjectKey(ownerId, req.file.originalname);

      // Upload to MinIO before touching the DB — if MinIO fails the request fails
      // cleanly with no orphaned DB record.
      await ensureBucket(BUCKET_STATEMENTS);
      await minioClient.putObject(
        BUCKET_STATEMENTS,
        objectKey,
        req.file.buffer,
        req.file.size,
        { 'Content-Type': mimeType },
      );
      logger.info({ entity: 'MINIO', action: 'OBJECT_PUT', bucket: BUCKET_STATEMENTS, key: objectKey });

      const storagePath = objectKey;

      const client = await familyPool.connect();
      try {
        const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
          // Verify the account belongs to this owner (RLS enforces this via the SELECT)
          const acct = await c.query(
            `SELECT id FROM fin_accounts WHERE id = $1 AND is_active = true`,
            [account_id],
          );
          if (acct.rows.length === 0) {
            throw Object.assign(new Error('Account not found or inactive.'), { statusCode: 404, code: 'NOT_FOUND' });
          }

          return c.query(
            `INSERT INTO fin_bank_statement_jobs
               (owner_id, account_id, status, file_name, storage_path, mime_type, idempotency_key)
             VALUES ($1,$2,'PENDING',$3,$4,$5,$6)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [ownerId, account_id, req.file!.originalname, storagePath, mimeType, idempotency_key],
          ).then(r => r.rows[0] ?? null);
        });

        if (!rec) {
          // idempotency conflict — return the existing job
          const existing = await withOwnerRLS(client, req.rlsCtx, (c) =>
            c.query(`SELECT * FROM fin_bank_statement_jobs WHERE idempotency_key = $1`, [idempotency_key])
              .then(r => r.rows[0]),
          );
          ok(res, existing, 200);
          return;
        }

        logger.info({ entity: 'FINANCE', action: 'BANK_STATEMENT_UPLOADED', user_id: ownerId, record_id: rec.id, file_name: req.file!.originalname });
        ok(res, rec, 201);
      } catch (e: unknown) {
        const typed = e as { statusCode?: number; code?: string; message?: string };
        if (typed.statusCode) { err(res, typed.statusCode, typed.code ?? 'ERROR', typed.message ?? 'Error'); return; }
        next(e);
      } finally { client.release(); }
    } catch (e) { next(e); }
  },
);

// ── GET /bank-statements ──────────────────────────────────────────────────────

bankStatementsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = JobQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { account_id, status, limit, offset } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (account_id) where.push(`account_id = ${push(account_id)}`);
        if (status)     where.push(`status = ${push(status)}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        params.push(limit, offset);
        return c.query(
          `SELECT id, account_id, status, file_name, mime_type, statement_from, statement_to,
                  rows_parsed, rows_imported, rows_skipped, error_detail,
                  started_at, completed_at, created_at, updated_at
           FROM   fin_bank_statement_jobs ${clause}
           ORDER  BY created_at DESC
           LIMIT  $${params.length - 1} OFFSET $${params.length}`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /bank-statements/:id ──────────────────────────────────────────────────

bankStatementsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }

    const client = await familyPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fin_bank_statement_jobs WHERE id = $1`, [parsed.data.id])
          .then(r => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Job not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /bank-statements/:id/retry ──────────────────────────────────────────
// Resets a FAILED job back to PENDING so the next batch run can pick it up.
// Returns 409 if the MinIO object no longer exists (file must be re-uploaded).

bankStatementsRouter.post('/:id/retry', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const job = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fin_bank_statement_jobs WHERE id = $1`, [parsed.data.id])
          .then(r => r.rows[0] ?? null),
      );
      if (!job) { err(res, 404, 'NOT_FOUND', 'Job not found.'); return; }
      if (job.status !== 'FAILED' && job.status !== 'PROCESSING') {
        err(res, 409, 'CONFLICT', `Only FAILED or stuck PROCESSING jobs can be retried. Current status: ${job.status}.`);
        return;
      }

      // Confirm the source file still exists in MinIO before resetting
      try {
        await minioClient.statObject(BUCKET_STATEMENTS, job.storage_path);
      } catch {
        err(res, 409, 'FILE_MISSING', 'The original file is no longer in storage. Please re-upload the statement.');
        return;
      }

      const updated = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE fin_bank_statement_jobs
           SET status = 'PENDING', error_detail = NULL,
               started_at = NULL, completed_at = NULL,
               rows_parsed = NULL, rows_imported = NULL, rows_skipped = NULL,
               updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [parsed.data.id],
        ).then(r => r.rows[0]),
      );

      logger.info({ entity: 'FINANCE', action: 'BANK_STATEMENT_RETRY', user_id: ownerId, record_id: parsed.data.id });
      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /bank-statements/:id ───────────────────────────────────────────────
// Deletes the MinIO object and the job record.
// Only allowed for terminal states: COMPLETE, PARTIAL, FAILED.
// Transactions already imported are NOT deleted.

bankStatementsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const job = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fin_bank_statement_jobs WHERE id = $1`, [parsed.data.id])
          .then(r => r.rows[0] ?? null),
      );
      if (!job) { err(res, 404, 'NOT_FOUND', 'Job not found.'); return; }

      const terminal = ['COMPLETE', 'PARTIAL', 'FAILED'];
      if (!terminal.includes(job.status)) {
        err(res, 409, 'CONFLICT', `Cannot delete a job in ${job.status} status. Wait for it to finish.`);
        return;
      }

      // Delete MinIO object — log failure but don't block the record deletion
      try {
        await minioClient.removeObject(BUCKET_STATEMENTS, job.storage_path);
        logger.info({ entity: 'MINIO', action: 'OBJECT_DELETED', bucket: BUCKET_STATEMENTS, key: job.storage_path });
      } catch (minioErr) {
        logger.warn({ entity: 'MINIO', action: 'OBJECT_DELETE_FAILED', key: job.storage_path, error: (minioErr as Error).message });
      }

      await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM fin_bank_statement_jobs WHERE id = $1`, [parsed.data.id]),
      );

      logger.info({ entity: 'FINANCE', action: 'BANK_STATEMENT_DELETED', user_id: ownerId, record_id: parsed.data.id });
      ok(res, { deleted: true });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
