// Document import job tracker — Path 1 (cloud upload → MinIO → Ollama batch → review → approve)
//
// POST   /api/v1/finance/document-jobs/upload         — upload file, enqueue extraction job
// POST   /api/v1/finance/document-jobs/trigger        — signal workstation to run batch now
// GET    /api/v1/finance/document-jobs/trigger/status — workstation polls this every 2 min
// POST   /api/v1/finance/document-jobs/trigger/clear  — workstation calls after batch completes
// GET    /api/v1/finance/document-jobs                — list jobs (newest first)
// GET    /api/v1/finance/document-jobs/:id            — job detail + extracted data
// POST   /api/v1/finance/document-jobs/:id/approve    — write extracted_data to target table
// DELETE /api/v1/finance/document-jobs/:id            — delete job + MinIO object (terminal states)
//
// doc_type LOAN      → fin_mortgages_loans
// doc_type INVESTMENT → fin_investments (one or more holdings per statement)
// doc_type INSURANCE → fin_insurance_policies

import path from 'path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import {
  minioClient, ensureBucket, mediaObjectKey, BUCKET_DOCUMENTS,
} from '../../lib/minio';

export const documentJobsRouter = Router();

// ── SSE push trigger ──────────────────────────────────────────────────────────
// When user clicks "Process Now", the API pushes a trigger event to the
// workstation via SSE. Zero polling — the workstation connects once on login
// and receives the event instantly.
const sseClients = new Set<Response>();
let triggeredAt: Date | null = null;

// GET /listen — workstation connects here on startup and holds the connection
documentJobsRouter.get('/listen', (req: Request, res: Response): void => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  logger.info({ entity: 'FINANCE', action: 'SSE_CONNECTED', user_id: req.rlsCtx.ownerId, clients: sseClients.size });

  // Heartbeat every 30s keeps the connection alive through proxies/load balancers
  const heartbeat = setInterval(() => {
    res.write('event: heartbeat\ndata: {}\n\n');
  }, 30_000);

  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(heartbeat);
    logger.info({ entity: 'FINANCE', action: 'SSE_DISCONNECTED', clients: sseClients.size });
  });
});

// POST /trigger — UI calls this when user clicks "Process Now"
documentJobsRouter.post('/trigger', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    triggeredAt = new Date();
    logger.info({ entity: 'FINANCE', action: 'BATCH_TRIGGER_SET', user_id: req.rlsCtx.ownerId, sse_clients: sseClients.size });

    // Push instantly to all connected workstation listeners
    const payload = JSON.stringify({ triggered_at: triggeredAt });
    for (const client of sseClients) {
      client.write(`event: trigger\ndata: ${payload}\n\n`);
    }

    ok(res, { triggered: true, triggered_at: triggeredAt, sse_clients: sseClients.size });
  } catch (e) { next(e); }
});

// GET /trigger/status — kept for UI polling fallback
documentJobsRouter.get('/trigger/status', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    ok(res, { pending: triggeredAt !== null, triggered_at: triggeredAt ?? null });
  } catch (e) { next(e); }
});

// POST /trigger/clear — workstation calls after batch completes
documentJobsRouter.post('/trigger/clear', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    triggeredAt = null;
    logger.info({ entity: 'FINANCE', action: 'BATCH_TRIGGER_CLEARED', user_id: req.rlsCtx.ownerId });
    ok(res, { cleared: true });
  } catch (e) { next(e); }
});

const DOC_TYPES = ['LOAN', 'INVESTMENT', 'INSURANCE'] as const;
type DocType = typeof DOC_TYPES[number];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.pdf', '.csv', '.txt'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, CSV, and TXT files are accepted.'));
    }
  },
});

const UUIDParam = z.object({ id: z.string().uuid() });

const JobQuerySchema = z.object({
  doc_type: z.enum(DOC_TYPES).optional(),
  status:   z.enum(['PENDING','PROCESSING','REVIEW','APPROVED','FAILED']).optional(),
  limit:    z.coerce.number().int().min(1).max(100).default(50),
  offset:   z.coerce.number().int().min(0).default(0),
}).strict();

const UploadBodySchema = z.object({
  doc_type:        z.enum(DOC_TYPES),
  idempotency_key: z.string().min(1).max(200),
}).strict();

// ── Approve body schemas per doc_type ─────────────────────────────────────────
// The approve endpoint takes owner_entity_id (required) plus optional overrides
// that are merged over the Ollama-extracted data before writing to the DB.

const ApproveLoanSchema = z.object({
  owner_entity_id: z.string().uuid(),
  account_id:      z.string().uuid().optional(),
  overrides: z.object({
    lender_name:            z.string().max(200).optional(),
    loan_type:              z.enum(['MORTGAGE','CAR_LOAN','PERSONAL_LOAN','BUSINESS_LOAN','OVERDRAFT','OTHER']).optional(),
    original_principal:     z.number().positive().optional(),
    outstanding_balance:    z.number().min(0).optional(),
    currency:               z.string().length(3).optional(),
    interest_rate:          z.number().min(0).max(100).optional(),
    interest_type:          z.enum(['FIXED','VARIABLE']).optional(),
    monthly_payment:        z.number().positive().optional(),
    start_date:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    maturity_date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    collateral_description: z.string().max(500).optional(),
    notes:                  z.string().max(2000).optional(),
  }).optional(),
}).strict();

const ApproveInvestmentSchema = z.object({
  owner_entity_id: z.string().uuid(),
  account_id:      z.string().uuid().optional(),
  overrides: z.object({
    holdings: z.array(z.object({
      asset_name:            z.string().max(200).optional(),
      investment_type:       z.enum(['EQUITY','BOND','MUTUAL_FUND','ETF','UNIT_TRUST','REAL_ESTATE','PRIVATE_EQUITY','CASH_EQUIVALENT','ANNUITY','OTHER']).optional(),
      ticker_symbol:         z.string().max(20).optional(),
      units_held:            z.number().min(0).optional(),
      average_cost_per_unit: z.number().positive().optional(),
      current_price:         z.number().positive().optional(),
      currency:              z.string().length(3).optional(),
      current_value_ttd:     z.number().optional(),
      purchase_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      maturity_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      notes:                 z.string().max(2000).optional(),
    })).optional(),
  }).optional(),
}).strict();

const ApproveInsuranceSchema = z.object({
  owner_entity_id: z.string().uuid(),
  overrides: z.object({
    policy_number:      z.string().max(100).optional(),
    insurer_name:       z.string().max(200).optional(),
    broker_name:        z.string().max(200).optional(),
    policy_type:        z.enum(['PROPERTY','VEHICLE','LIABILITY','LIFE','HEALTH','BUSINESS_INTERRUPTION','MARINE','PROFESSIONAL_INDEMNITY','OTHER']).optional(),
    insured_asset_type: z.enum(['VEHICLE','PROPERTY','BUSINESS','PERSON','OTHER']).optional(),
    coverage_amount:    z.number().positive().optional(),
    coverage_amount_ttd: z.number().positive().optional(),
    currency:           z.string().length(3).optional(),
    premium_amount:     z.number().positive().optional(),
    premium_amount_ttd: z.number().positive().optional(),
    premium_frequency:  z.enum(['MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL','ONE_OFF']).optional(),
    start_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    expiry_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    renewal_alert_days: z.number().int().min(7).max(365).optional(),
    notes:              z.string().optional(),
  }).optional(),
}).strict();

// ── POST /document-jobs/upload ────────────────────────────────────────────────

documentJobsRouter.post(
  '/upload',
  upload.single('document'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        err(res, 422, 'VALIDATION_ERROR', 'No file uploaded. Field name must be "document".');
        return;
      }

      const parsed = UploadBodySchema.safeParse(req.body);
      if (!parsed.success) {
        err(res, 422, 'VALIDATION_ERROR', 'doc_type and idempotency_key are required.');
        return;
      }
      const { doc_type, idempotency_key } = parsed.data;
      const { ownerId } = req.rlsCtx;

      const mimeType  = req.file.mimetype || 'application/octet-stream';
      const objectKey = mediaObjectKey(ownerId, `doc-jobs/${doc_type.toLowerCase()}`, 'upload', req.file.originalname);

      await ensureBucket(BUCKET_DOCUMENTS);
      await minioClient.putObject(
        BUCKET_DOCUMENTS,
        objectKey,
        req.file.buffer,
        req.file.size,
        { 'Content-Type': mimeType },
      );
      logger.info({ entity: 'MINIO', action: 'OBJECT_PUT', bucket: BUCKET_DOCUMENTS, key: objectKey });

      const client = await familyPool.connect();
      try {
        const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
          return c.query(
            `INSERT INTO fin_document_jobs
               (owner_id, doc_type, status, file_name, storage_path, mime_type, idempotency_key)
             VALUES ($1,$2,'PENDING',$3,$4,$5,$6)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [ownerId, doc_type, req.file!.originalname, objectKey, mimeType, idempotency_key],
          ).then(r => r.rows[0] ?? null);
        });

        if (!rec) {
          const existing = await withOwnerRLS(client, req.rlsCtx, (c) =>
            c.query(`SELECT * FROM fin_document_jobs WHERE idempotency_key = $1`, [idempotency_key])
              .then(r => r.rows[0]),
          );
          ok(res, existing, 200);
          return;
        }

        logger.info({ entity: 'FINANCE', action: 'DOCUMENT_JOB_CREATED', user_id: ownerId, record_id: rec.id, doc_type, file_name: req.file!.originalname });
        ok(res, rec, 201);
      } catch (e) { next(e); } finally { client.release(); }
    } catch (e) { next(e); }
  },
);

// ── GET /document-jobs ────────────────────────────────────────────────────────

documentJobsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = JobQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { doc_type, status, limit, offset } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (doc_type) where.push(`doc_type = ${push(doc_type)}`);
        if (status)   where.push(`status = ${push(status)}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        params.push(limit, offset);
        return c.query(
          `SELECT id, doc_type, status, file_name, mime_type, extracted_data,
                  target_record_ids, error_detail, started_at, completed_at, created_at, updated_at
           FROM   fin_document_jobs ${clause}
           ORDER  BY created_at DESC
           LIMIT  $${params.length - 1} OFFSET $${params.length}`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /document-jobs/:id ────────────────────────────────────────────────────

documentJobsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }

    const client = await familyPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fin_document_jobs WHERE id = $1`, [parsed.data.id])
          .then(r => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Job not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /document-jobs/:id/approve ──────────────────────────────────────────
// Merges override fields over extracted_data and writes to the target table.
// Returns the created record(s) and marks the job APPROVED.

documentJobsRouter.post('/:id/approve', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = UUIDParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }
    const { id } = paramParsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const job = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fin_document_jobs WHERE id = $1`, [id])
          .then(r => r.rows[0] ?? null),
      );
      if (!job) { err(res, 404, 'NOT_FOUND', 'Job not found.'); return; }
      if (job.status !== 'REVIEW') {
        err(res, 409, 'CONFLICT', `Job is in ${job.status} status — can only approve REVIEW jobs.`);
        return;
      }
      if (!job.extracted_data) {
        err(res, 409, 'CONFLICT', 'No extracted data on this job yet.');
        return;
      }

      const docType: DocType = job.doc_type;
      let createdIds: string[] = [];

      if (docType === 'LOAN') {
        const bodyParsed = ApproveLoanSchema.safeParse(req.body);
        if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'owner_entity_id is required.'); return; }
        const { owner_entity_id, account_id, overrides } = bodyParsed.data;
        const ex = job.extracted_data as Record<string, unknown>;
        const d = { ...ex, ...(overrides ?? {}) } as Record<string, unknown>;

        const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
          c.query(
            `INSERT INTO fin_mortgages_loans
               (owner_id, owner_entity_id, account_id, loan_type, lender_name,
                original_principal, outstanding_balance, currency, interest_rate,
                interest_type, monthly_payment, start_date, maturity_date,
                collateral_description, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             RETURNING id`,
            [
              ownerId, owner_entity_id, account_id ?? null,
              d['loan_type'] ?? 'OTHER',
              d['lender_name'] ?? 'Unknown',
              d['original_principal'] ?? 0,
              d['outstanding_balance'] ?? 0,
              d['currency'] ?? 'TTD',
              d['interest_rate'] ?? 0,
              d['interest_type'] ?? 'FIXED',
              d['monthly_payment'] ?? null,
              d['start_date'] ?? null,
              d['maturity_date'] ?? null,
              d['collateral_description'] ?? null,
              d['notes'] ?? null,
            ],
          ).then(r => r.rows[0]),
        );
        createdIds = [rec.id as string];
        logger.info({ entity: 'FINANCE', action: 'LOAN_IMPORTED', user_id: ownerId, record_id: rec.id, job_id: id });

      } else if (docType === 'INVESTMENT') {
        const bodyParsed = ApproveInvestmentSchema.safeParse(req.body);
        if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'owner_entity_id is required.'); return; }
        const { owner_entity_id, account_id, overrides } = bodyParsed.data;

        const ex = job.extracted_data as { institution_name?: string; as_of_date?: string; holdings?: unknown[] };
        const holdings = overrides?.holdings ?? (ex.holdings as Record<string, unknown>[] | undefined) ?? [];
        if (!holdings.length) {
          err(res, 422, 'VALIDATION_ERROR', 'No holdings found in extracted data. Provide overrides.holdings.');
          return;
        }

        for (const h of holdings as Record<string, unknown>[]) {
          const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
            c.query(
              `INSERT INTO fin_investments
                 (owner_id, owner_entity_id, account_id, investment_type, asset_name,
                  ticker_symbol, units_held, average_cost_per_unit, current_price,
                  currency, current_value_ttd, institution_name, purchase_date, maturity_date, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
               RETURNING id`,
              [
                ownerId, owner_entity_id, account_id ?? null,
                h['investment_type'] ?? 'OTHER',
                h['asset_name'] ?? 'Unknown',
                h['ticker_symbol'] ?? null,
                h['units_held'] ?? 0,
                h['average_cost_per_unit'] ?? null,
                h['current_price'] ?? null,
                h['currency'] ?? 'TTD',
                h['current_value_ttd'] ?? null,
                ex.institution_name ?? null,
                h['purchase_date'] ?? null,
                h['maturity_date'] ?? null,
                h['notes'] ?? null,
              ],
            ).then(r => r.rows[0]),
          );
          createdIds.push(rec.id as string);
        }
        logger.info({ entity: 'FINANCE', action: 'INVESTMENTS_IMPORTED', user_id: ownerId, count: createdIds.length, job_id: id });

      } else if (docType === 'INSURANCE') {
        const bodyParsed = ApproveInsuranceSchema.safeParse(req.body);
        if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'owner_entity_id is required.'); return; }
        const { owner_entity_id, overrides } = bodyParsed.data;
        const ex = job.extracted_data as Record<string, unknown>;
        const d = { ...ex, ...(overrides ?? {}) } as Record<string, unknown>;

        // TTD amounts: if currency is TTD use amount directly; otherwise caller must provide via overrides
        const currency = String(d['currency'] ?? 'TTD').toUpperCase();
        const coverageAmt    = Number(d['coverage_amount']     ?? 0);
        const premiumAmt     = Number(d['premium_amount']      ?? 0);
        const coverageAmtTTD = d['coverage_amount_ttd']  != null ? Number(d['coverage_amount_ttd'])  : (currency === 'TTD' ? coverageAmt : null);
        const premiumAmtTTD  = d['premium_amount_ttd']   != null ? Number(d['premium_amount_ttd'])   : (currency === 'TTD' ? premiumAmt  : null);

        if (!coverageAmtTTD || !premiumAmtTTD) {
          err(res, 422, 'VALIDATION_ERROR', 'coverage_amount_ttd and premium_amount_ttd are required when currency is not TTD. Provide via overrides.');
          return;
        }

        const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
          c.query(
            `INSERT INTO fin_insurance_policies
               (owner_id, owner_entity_id, policy_number, insurer_name, broker_name,
                policy_type, insured_asset_type, coverage_amount, currency,
                coverage_amount_ttd, premium_amount, premium_amount_ttd,
                premium_frequency, start_date, expiry_date, renewal_alert_days, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING id`,
            [
              ownerId, owner_entity_id,
              d['policy_number']      ?? 'UNKNOWN',
              d['insurer_name']       ?? 'Unknown',
              d['broker_name']        ?? null,
              d['policy_type']        ?? 'OTHER',
              d['insured_asset_type'] ?? 'OTHER',
              coverageAmt, currency, coverageAmtTTD, premiumAmt, premiumAmtTTD,
              d['premium_frequency']  ?? 'ANNUAL',
              d['start_date']         ?? null,
              d['expiry_date']        ?? null,
              d['renewal_alert_days'] ?? 60,
              d['notes']              ?? null,
            ],
          ).then(r => r.rows[0]),
        );
        createdIds = [rec.id as string];
        logger.info({ entity: 'FINANCE', action: 'INSURANCE_IMPORTED', user_id: ownerId, record_id: rec.id, job_id: id });
      }

      // Mark job APPROVED with target record IDs
      await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE fin_document_jobs
           SET status = 'APPROVED', target_record_ids = $2, completed_at = now(), updated_at = now()
           WHERE id = $1`,
          [id, createdIds],
        ),
      );

      // Auto-delete the MinIO object — data is in the DB, file no longer needed
      try {
        await minioClient.removeObject(BUCKET_DOCUMENTS, job.storage_path as string);
        logger.info({ entity: 'MINIO', action: 'OBJECT_DELETED', bucket: BUCKET_DOCUMENTS, key: job.storage_path });
      } catch (minioErr) {
        logger.warn({ entity: 'MINIO', action: 'OBJECT_DELETE_FAILED', key: job.storage_path, error: (minioErr as Error).message });
      }

      ok(res, { approved: true, target_record_ids: createdIds });
    } catch (e) { next(e); } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /document-jobs/:id ─────────────────────────────────────────────────
// Terminal states only (REVIEW, APPROVED, FAILED).

documentJobsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const job = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fin_document_jobs WHERE id = $1`, [parsed.data.id])
          .then(r => r.rows[0] ?? null),
      );
      if (!job) { err(res, 404, 'NOT_FOUND', 'Job not found.'); return; }

      const terminal = ['REVIEW', 'APPROVED', 'FAILED'];
      if (!terminal.includes(job.status as string)) {
        err(res, 409, 'CONFLICT', `Cannot delete a job in ${job.status} status. Wait for processing to finish.`);
        return;
      }

      // Delete MinIO object if not yet cleared (APPROVED jobs auto-delete on approve)
      if (job.status !== 'APPROVED') {
        try {
          await minioClient.removeObject(BUCKET_DOCUMENTS, job.storage_path as string);
          logger.info({ entity: 'MINIO', action: 'OBJECT_DELETED', bucket: BUCKET_DOCUMENTS, key: job.storage_path });
        } catch (minioErr) {
          logger.warn({ entity: 'MINIO', action: 'OBJECT_DELETE_FAILED', key: job.storage_path, error: (minioErr as Error).message });
        }
      }

      await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM fin_document_jobs WHERE id = $1`, [parsed.data.id]),
      );

      logger.info({ entity: 'FINANCE', action: 'DOCUMENT_JOB_DELETED', user_id: ownerId, record_id: parsed.data.id });
      ok(res, { deleted: true });
    } catch (e) { next(e); } finally { client.release(); }
  } catch (e) { next(e); }
});
