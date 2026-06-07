// GET    /api/v1/finance/transactions
// POST   /api/v1/finance/transactions
// GET    /api/v1/finance/transactions/:id
// PATCH  /api/v1/finance/transactions/:id  (categorise / reconcile)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const transactionsRouter = Router();

const CATEGORIES = [
  'SALARY','DIVIDEND','RENTAL_INCOME','INTEREST_INCOME','TRANSFER_IN',
  'OPERATING_EXPENSE','PAYROLL','TAX_PAYMENT','LOAN_REPAYMENT',
  'INVESTMENT_PURCHASE','INVESTMENT_SALE','TRANSFER_OUT',
  'PERSONAL_EXPENSE','UTILITIES','INSURANCE','ENTERTAINMENT',
  'TRAVEL','MEDICAL','EDUCATION','CHARITY',
  'UNCLASSIFIED',
] as const;

const UUIDParam = z.object({ id: z.string().uuid() });

const TxnQuerySchema = z.object({
  account_id:       z.string().uuid().optional(),
  category:         z.enum(CATEGORIES).optional(),
  is_reconciled:    z.enum(['true','false']).optional(),
  is_pending_review:z.enum(['true','false']).optional(),
  date_from:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit:            z.coerce.number().int().min(1).max(500).default(100),
  offset:           z.coerce.number().int().min(0).default(0),
}).strict();

const CreateTxnSchema = z.object({
  account_id:        z.string().uuid(),
  transaction_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  posted_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amount:            z.number(),   // positive = credit, negative = debit
  currency:          z.string().length(3).default('TTD'),
  amount_ttd:        z.number().optional(),
  fx_rate_used:      z.number().positive().optional(),
  description:       z.string().min(1).max(500),
  merchant_name:     z.string().max(200).optional(),
  category:          z.enum(CATEGORIES).default('UNCLASSIFIED'),
  reference_number:  z.string().max(100).optional(),
  transfer_pair_id:  z.string().uuid().optional(),
  idempotency_key:   z.string().min(1).max(500),
}).strict();

const PatchTxnSchema = z.object({
  category:         z.enum(CATEGORIES).optional(),
  is_reconciled:    z.boolean().optional(),
  merchant_name:    z.string().max(200).optional(),
  reference_number: z.string().max(100).optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'At least one field required.' });

// ── GET /transactions ─────────────────────────────────────────────────────────

transactionsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = TxnQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { account_id, category, is_reconciled, is_pending_review, date_from, date_to, limit, offset } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (account_id)        where.push(`account_id = ${push(account_id)}`);
        if (category)          where.push(`category = ${push(category)}`);
        if (is_reconciled !== undefined)     where.push(`is_reconciled = ${push(is_reconciled === 'true')}`);
        if (is_pending_review !== undefined) where.push(`is_pending_review = ${push(is_pending_review === 'true')}`);
        if (date_from)         where.push(`transaction_date >= ${push(date_from)}`);
        if (date_to)           where.push(`transaction_date <= ${push(date_to)}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return c.query(
          `SELECT id, account_id, transaction_date, posted_date, amount, currency,
                  amount_ttd, fx_rate_used, description, merchant_name, category,
                  is_reconciled, is_pending_review, reference_number, transfer_pair_id,
                  created_at, updated_at
           FROM   fin_transactions ${clause}
           ORDER  BY transaction_date DESC, created_at DESC
           LIMIT  ${push(limit)} OFFSET ${push(offset)}`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /transactions ────────────────────────────────────────────────────────

transactionsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateTxnSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        // Verify account belongs to this owner (RLS handles it, but give a clear 404)
        const acct = await c.query(
          `SELECT id FROM fin_accounts WHERE id = $1`, [b.account_id],
        );
        if (acct.rows.length === 0) throw Object.assign(new Error('ACCOUNT_NOT_FOUND'), { status: 404 });

        // Insert transaction AND update balance in the same connection/transaction
        // so both succeed or both roll back together (atomicity).
        const row = await c.query(
          `INSERT INTO fin_transactions
             (owner_id, account_id, transaction_date, posted_date, amount, currency,
              amount_ttd, fx_rate_used, description, merchant_name, category,
              reference_number, transfer_pair_id, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING *`,
          [ownerId, b.account_id, b.transaction_date, b.posted_date ?? null,
           b.amount, b.currency, b.amount_ttd ?? null, b.fx_rate_used ?? null,
           b.description, b.merchant_name ?? null, b.category,
           b.reference_number ?? null, b.transfer_pair_id ?? null, b.idempotency_key],
        ).then(r => r.rows[0]);

        // Update balance in the same transaction — no separate connection needed
        await c.query(
          `UPDATE fin_accounts SET current_balance = current_balance + $1, updated_at = now() WHERE id = $2`,
          [b.amount, b.account_id],
        );

        return row;
      });

      logger.info({ entity: 'FINANCE', action: 'TRANSACTION_CREATED', user_id: ownerId, record_id: rec.id });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    if (e instanceof Error && (e as Error & { status?: number }).status === 404) {
      err(res, 404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
      return;
    }
    // Idempotency key conflict
    if (e instanceof Error && e.message.includes('idempotency_key')) {
      err(res, 409, 'DUPLICATE_TRANSACTION', 'A transaction with this idempotency key already exists.');
      return;
    }
    next(e);
  }
});

// ── GET /transactions/:id ─────────────────────────────────────────────────────

transactionsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fin_transactions WHERE id = $1`, [parsed.data.id]).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'TRANSACTION_NOT_FOUND', 'Transaction not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /transactions/:id ───────────────────────────────────────────────────
// Allows categorising and marking reconciled. Amount/date/account are immutable.

transactionsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = UUIDParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyParsed = PatchTxnSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = paramParsed.data;
    const b = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const sets = ['updated_at = now()'];
        if (b.category         !== undefined) sets.push(`category = ${push(b.category)}`);
        if (b.is_reconciled    !== undefined) sets.push(`is_reconciled = ${push(b.is_reconciled)}`);
        if (b.merchant_name    !== undefined) sets.push(`merchant_name = ${push(b.merchant_name)}`);
        if (b.reference_number !== undefined) sets.push(`reference_number = ${push(b.reference_number)}`);
        // Clear pending review flag when category is explicitly set
        if (b.category !== undefined) sets.push(`is_pending_review = false`);
        params.push(id);
        return c.query(
          `UPDATE fin_transactions SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null);
      });
      if (!rec) { err(res, 404, 'TRANSACTION_NOT_FOUND', 'Transaction not found.'); return; }
      logger.info({ entity: 'FINANCE', action: 'TRANSACTION_UPDATED', user_id: ownerId, record_id: id });
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
