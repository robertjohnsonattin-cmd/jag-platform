// GET    /api/v1/finance/pending-review         — list unresolved items
// GET    /api/v1/finance/pending-review/:id      — single item with transaction detail
// PATCH  /api/v1/finance/pending-review/:id      — resolve: accept category, mark resolved

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const pendingReviewRouter = Router();

const CATEGORIES = [
  'SALARY','DIVIDEND','RENTAL_INCOME','INTEREST_INCOME','TRANSFER_IN',
  'OPERATING_EXPENSE','PAYROLL','TAX_PAYMENT','LOAN_REPAYMENT',
  'INVESTMENT_PURCHASE','INVESTMENT_SALE','TRANSFER_OUT',
  'PERSONAL_EXPENSE','UTILITIES','INSURANCE','ENTERTAINMENT',
  'TRAVEL','MEDICAL','EDUCATION','CHARITY',
  'UNCLASSIFIED',
] as const;

const UUIDParam = z.object({ id: z.string().uuid() });

const ReviewQuerySchema = z.object({
  account_id: z.string().uuid().optional(),
  job_id:     z.string().uuid().optional(),
  limit:      z.coerce.number().int().min(1).max(500).default(100),
  offset:     z.coerce.number().int().min(0).default(0),
}).strict();

const ResolveSchema = z.object({
  category:       z.enum(CATEGORIES),
  reviewer_notes: z.string().max(1000).optional(),
}).strict();

// ── GET /pending-review ───────────────────────────────────────────────────────

pendingReviewRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ReviewQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { account_id, job_id, limit, offset } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = ['q.resolved_at IS NULL'];
        if (job_id)     where.push(`q.job_id = ${push(job_id)}`);
        if (account_id) where.push(`t.account_id = ${push(account_id)}`);
        params.push(limit, offset);
        return c.query(
          `SELECT q.id, q.transaction_id, q.job_id, q.suggested_category, q.confidence,
                  q.reviewer_notes, q.created_at,
                  t.transaction_date, t.amount, t.currency, t.description,
                  t.merchant_name, t.reference_number, t.account_id
           FROM   fin_pending_review_queue q
           JOIN   fin_transactions t ON t.id = q.transaction_id
           WHERE  ${where.join(' AND ')}
           ORDER  BY q.created_at ASC
           LIMIT  $${params.length - 1} OFFSET $${params.length}`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /pending-review/:id ───────────────────────────────────────────────────

pendingReviewRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }

    const client = await familyPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT q.*, t.transaction_date, t.amount, t.currency, t.description,
                  t.merchant_name, t.reference_number, t.account_id, t.category
           FROM   fin_pending_review_queue q
           JOIN   fin_transactions t ON t.id = q.transaction_id
           WHERE  q.id = $1`,
          [parsed.data.id],
        ).then(r => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Review item not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /pending-review/:id ─────────────────────────────────────────────────
// Resolves a pending review item: sets the category on the transaction and
// marks the queue entry as resolved.

pendingReviewRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }

    const bodyParsed = ResolveSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'category is required.'); return; }

    const { category, reviewer_notes } = bodyParsed.data;
    const { ownerId } = req.rlsCtx;
    const queueId = idParsed.data.id;

    const client = await familyPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        // Get the queue entry
        const qEntry = await c.query<{ id: string; transaction_id: string; resolved_at: string | null }>(
          `SELECT id, transaction_id, resolved_at FROM fin_pending_review_queue WHERE id = $1`,
          [queueId],
        ).then(r => r.rows[0] ?? null);

        if (!qEntry) return null;
        if (qEntry.resolved_at) {
          throw Object.assign(new Error('This item has already been resolved.'), { statusCode: 409, code: 'CONFLICT' });
        }

        // Update the transaction category and clear pending_review flag
        await c.query(
          `UPDATE fin_transactions
           SET category = $1, is_pending_review = false, updated_at = now()
           WHERE id = $2`,
          [category, qEntry.transaction_id],
        );

        // Mark queue entry resolved
        return c.query(
          `UPDATE fin_pending_review_queue
           SET reviewer_notes = $1, resolved_at = now()
           WHERE id = $2
           RETURNING *`,
          [reviewer_notes ?? null, queueId],
        ).then(r => r.rows[0]);
      });

      if (!row) { err(res, 404, 'NOT_FOUND', 'Review item not found.'); return; }

      logger.info({ entity: 'FINANCE', action: 'PENDING_REVIEW_RESOLVED', user_id: ownerId, record_id: queueId, category });
      ok(res, row);
    } catch (e: unknown) {
      const typed = e as { statusCode?: number; code?: string; message?: string };
      if (typed.statusCode) { err(res, typed.statusCode, typed.code ?? 'ERROR', typed.message ?? 'Error'); return; }
      next(e);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
