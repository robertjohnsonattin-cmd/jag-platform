// GET  /api/v1/nlcb/expenses  — list expenses (category / date filter)
// POST /api/v1/nlcb/expenses  — create expense (idempotency)
// PATCH /api/v1/nlcb/expenses/:id/pay — mark expense as paid

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const nlcbExpensesRouter = Router();
nlcbExpensesRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const ExpenseCategoryEnum = z.enum(['RENT', 'UTILITY', 'SUPPLIES', 'STAFF', 'OTHER']);

const CreateExpenseSchema = z.object({
  expense_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expense_date must be YYYY-MM-DD'),
  category:        ExpenseCategoryEnum,
  description:     z.string().min(1).max(500),
  amount:          z.number().positive(),
  vat_amount:      z.number().min(0).default(0),
  vendor_name:     z.string().max(200).optional(),
  notes:           z.string().max(500).optional(),
  idempotency_key: z.string().uuid(),
}).strict();

const PayExpenseSchema = z.object({
  notes:           z.string().max(500).optional(),
  idempotency_key: z.string().uuid(),
}).strict();

// ── GET /nlcb/expenses ────────────────────────────────────────────────────────

nlcbExpensesRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const category = req.query.category as string | undefined;
  const dateFrom = req.query.date_from as string | undefined;
  const dateTo   = req.query.date_to   as string | undefined;

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (category) conditions.push(`category = ${push(category)}`);
        if (dateFrom)  conditions.push(`expense_date >= ${push(dateFrom)}`);
        if (dateTo)    conditions.push(`expense_date <= ${push(dateTo)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT id, expense_date, category, description, amount, vat_amount,
                  vendor_name, status, paid_at, notes, created_at
           FROM nlcb_expenses
           ${where}
           ORDER BY expense_date DESC`,
          params,
        ).then((r) => r.rows);
      });
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /nlcb/expenses ───────────────────────────────────────────────────────

nlcbExpensesRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateExpenseSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const { expense_date, category, description, amount, vat_amount, vendor_name, notes, idempotency_key } = parsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query(
          `SELECT id, amount, status FROM nlcb_expenses WHERE idempotency_key = $1`,
          [idempotency_key],
        );
        if (existing.rows.length > 0) return existing.rows[0];

        return c.query(
          `INSERT INTO nlcb_expenses
             (tenant_id, expense_date, category, description, amount, vat_amount,
              vendor_name, notes, idempotency_key, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, expense_date, category, description, amount, vat_amount, vendor_name, status, created_at`,
          [tenantId, expense_date, category, description, amount, vat_amount,
           vendor_name ?? null, notes ?? null, idempotency_key, userId],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'NLCB', action: 'EXPENSE_CREATED', expense_id: row.id, user_id: userId, tenant_id: tenantId, amount });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── PATCH /nlcb/expenses/:id/pay ──────────────────────────────────────────────

nlcbExpensesRouter.patch('/:id/pay', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid expense id.'); return; }

  const bodyParsed = PayExpenseSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const { notes } = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const expRes = await c.query(
          `SELECT id, status FROM nlcb_expenses WHERE id = $1`,
          [id],
        );
        if (expRes.rows.length === 0) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
        if (expRes.rows[0].status === 'PAID') return expRes.rows[0];

        return c.query(
          `UPDATE nlcb_expenses
           SET status = 'PAID', paid_at = now(), notes = COALESCE($1, notes)
           WHERE id = $2
           RETURNING id, category, description, amount, status, paid_at`,
          [notes ?? null, id],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'NLCB', action: 'EXPENSE_PAID', expense_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Expense not found.'); return; }
    next(e);
  }
});
