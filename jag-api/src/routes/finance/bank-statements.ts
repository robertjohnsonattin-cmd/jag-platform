// POST   /api/v1/finance/bank-statements/upload    — upload a statement file, enqueue job
// GET    /api/v1/finance/bank-statements            — list jobs (newest first)
// GET    /api/v1/finance/bank-statements/:id        — job detail + status
// POST   /api/v1/finance/bank-statements/:id/requeue — requeue a FAILED job

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

// ── POST /bank-statements/:id/requeue ─────────────────────────────────────────
// Resets a FAILED job back to PENDING so the next batch run picks it up.

bankStatementsRouter.post('/:id/requeue', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE fin_bank_statement_jobs
           SET status = 'PENDING', started_at = NULL, completed_at = NULL,
               error_detail = NULL, rows_parsed = 0, rows_imported = 0,
               rows_skipped = 0, updated_at = now()
           WHERE id = $1 AND status = 'FAILED'
           RETURNING *`,
          [parsed.data.id],
        ).then(r => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Job not found or not in FAILED status.'); return; }
      logger.info({ entity: 'FINANCE', action: 'BANK_STATEMENT_REQUEUED', user_id: ownerId, record_id: row.id });
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
