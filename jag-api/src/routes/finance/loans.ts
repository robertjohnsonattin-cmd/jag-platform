// GET    /api/v1/finance/loans
// POST   /api/v1/finance/loans
// GET    /api/v1/finance/loans/:id
// PATCH  /api/v1/finance/loans/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const loansRouter = Router();

const LOAN_TYPES = ['MORTGAGE','CAR_LOAN','PERSONAL_LOAN','BUSINESS_LOAN','OVERDRAFT','OTHER'] as const;
const INTEREST_TYPES = ['FIXED','VARIABLE'] as const;

const UUIDParam = z.object({ id: z.string().uuid() });

const LoanQuerySchema = z.object({
  owner_entity_id: z.string().uuid().optional(),
  loan_type:       z.enum(LOAN_TYPES).optional(),
  currency:        z.string().length(3).optional(),
}).strict();

const CreateLoanSchema = z.object({
  owner_entity_id:         z.string().uuid(),
  account_id:              z.string().uuid().optional(),
  loan_type:               z.enum(LOAN_TYPES),
  lender_name:             z.string().min(1).max(200),
  original_principal:      z.number().positive(),
  outstanding_balance:     z.number().min(0),
  currency:                z.string().length(3).default('TTD'),
  interest_rate:           z.number().min(0).max(100),
  interest_type:           z.enum(INTEREST_TYPES).default('FIXED'),
  monthly_payment:         z.number().positive().optional(),
  start_date:              z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maturity_date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  collateral_description:  z.string().max(500).optional(),
  notes:                   z.string().max(2000).optional(),
}).strict();

const UpdateLoanSchema = z.object({
  outstanding_balance:    z.number().min(0).optional(),
  interest_rate:          z.number().min(0).max(100).optional(),
  interest_type:          z.enum(INTEREST_TYPES).optional(),
  monthly_payment:        z.number().positive().optional(),
  maturity_date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  collateral_description: z.string().max(500).optional(),
  notes:                  z.string().max(2000).optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'At least one field required.' });

// ── GET /loans ────────────────────────────────────────────────────────────────

loansRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = LoanQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { owner_entity_id, loan_type, currency } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (owner_entity_id) where.push(`owner_entity_id = ${push(owner_entity_id)}`);
        if (loan_type)       where.push(`loan_type = ${push(loan_type)}`);
        if (currency)        where.push(`currency = ${push(currency.toUpperCase())}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return c.query(
          `SELECT id, owner_entity_id, account_id, loan_type, lender_name,
                  original_principal, outstanding_balance, currency, interest_rate,
                  interest_type, monthly_payment, start_date, maturity_date,
                  collateral_description, created_at, updated_at
           FROM   fin_mortgages_loans ${clause}
           ORDER  BY start_date DESC`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /loans ───────────────────────────────────────────────────────────────

loansRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateLoanSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fin_mortgages_loans
             (owner_id, owner_entity_id, account_id, loan_type, lender_name,
              original_principal, outstanding_balance, currency, interest_rate,
              interest_type, monthly_payment, start_date, maturity_date,
              collateral_description, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING *`,
          [
            ownerId, b.owner_entity_id, b.account_id ?? null, b.loan_type, b.lender_name,
            b.original_principal, b.outstanding_balance, b.currency, b.interest_rate,
            b.interest_type, b.monthly_payment ?? null, b.start_date, b.maturity_date ?? null,
            b.collateral_description ?? null, b.notes ?? null,
          ],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'FINANCE', action: 'LOAN_CREATED', user_id: ownerId, record_id: rec.id });

      const coreClient = await corePool.connect();
      try {
        await coreClient.query('BEGIN');
        await coreClient.query('SELECT set_config($1,$2,true)', ['app.current_user_id', ownerId]);
        await coreClient.query(
          `INSERT INTO audit_log (user_id, entity, action, record_id, new_values, source)
           VALUES ($1,'FinLoan','CREATE',$2,$3,'API')`,
          [ownerId, rec.id, JSON.stringify({ loan_type: b.loan_type, lender_name: b.lender_name, owner_entity_id: b.owner_entity_id, original_principal: b.original_principal })],
        );
        await coreClient.query('COMMIT');
      } catch { await coreClient.query('ROLLBACK'); } finally { coreClient.release(); }

      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /loans/:id ────────────────────────────────────────────────────────────

loansRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }

    const client = await familyPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT * FROM fin_mortgages_loans WHERE id = $1`,
          [parsed.data.id],
        ).then(r => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Loan not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /loans/:id ──────────────────────────────────────────────────────────

loansRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }

    const bodyParsed = UpdateLoanSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const b = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const ALLOWED = [
      'outstanding_balance','interest_rate','interest_type',
      'monthly_payment','maturity_date','collateral_description','notes',
    ] as const;

    const setClauses: string[] = [];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

    for (const key of ALLOWED) {
      if (key in b) setClauses.push(`${key} = ${push(b[key])}`);
    }
    setClauses.push(`updated_at = now()`);
    params.push(idParsed.data.id);

    const client = await familyPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE fin_mortgages_loans SET ${setClauses.join(', ')}
           WHERE  id = $${params.length}
           RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Loan not found.'); return; }
      logger.info({ entity: 'FINANCE', action: 'LOAN_UPDATED', user_id: ownerId, record_id: row.id });
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
