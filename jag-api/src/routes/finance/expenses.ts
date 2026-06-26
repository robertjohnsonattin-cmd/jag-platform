// Expense Management
//
// GET    /api/v1/finance/expenses
// POST   /api/v1/finance/expenses
// GET    /api/v1/finance/expenses/:id
// PATCH  /api/v1/finance/expenses/:id          (edit while DRAFT)
// POST   /api/v1/finance/expenses/:id/submit   (DRAFT → SUBMITTED)
// POST   /api/v1/finance/expenses/:id/approve  (SUBMITTED → APPROVED, Owner only — auto-posts GL)
// POST   /api/v1/finance/expenses/:id/reject   (SUBMITTED → REJECTED, Owner only)
// POST   /api/v1/finance/expenses/:id/receipt  (upload receipt to MinIO)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { withOwnerRLS, withTenantRLS } from '../../middleware/rls';
import { familyPool, corePool, commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { enqueueNotification } from '../../lib/notifications';
import { minioClient, ensureBucket, mediaObjectKey, BUCKET_RECEIPTS } from '../../lib/minio';

export const expensesRouter = Router();

// ── Auto fuel-log helper ───────────────────────────────────────────────────────
// Called fire-and-forget when a FUEL expense is created with a vehicle link.
// Inserts a vms_fuel_logs row using reference_type='EXPENSE' for traceability.

async function autoInsertFuelLog(opts: {
  vehicleId:    string;
  tenantId:     string;
  expenseId:    string;
  logDate:      string;
  litres:       number;
  totalCostTtd: number;
  odometerKm?:  number;
  fuelType:     string;
  stationName?: string;
  description:  string;
  userId:       string;
}): Promise<void> {
  const { vehicleId, tenantId, expenseId, logDate, litres, totalCostTtd,
          odometerKm, fuelType, stationName, description, userId } = opts;
  const costPerLitre = litres > 0 ? totalCostTtd / litres : 0;
  const client = await commercialPool.connect();
  try {
    await withTenantRLS(client, { tenantId, userId, ownerId: userId, isOwner: true }, (c) =>
      c.query(
        `INSERT INTO vms_fuel_logs
           (tenant_id, vehicle_id, log_date, odometer_km, litres,
            cost_per_litre_ttd, total_cost_ttd, fuel_type, station_name,
            is_full_tank, reference_type, reference_id, notes, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,'EXPENSE',$10,$11,$12,$13)`,
        [tenantId, vehicleId, logDate, odometerKm ?? null, litres,
         costPerLitre, totalCostTtd, fuelType, stationName ?? null,
         expenseId, description,
         `exp-${expenseId}`,
         userId],
      ),
    );
    logger.info({ entity: 'VMS', action: 'FUEL_LOG_AUTO_CREATED', vehicle_id: vehicleId, expense_id: expenseId });
  } catch (e) {
    logger.warn({ entity: 'VMS', action: 'FUEL_LOG_AUTO_CREATE_FAILED', expense_id: expenseId, error: String(e) });
  } finally {
    client.release();
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ── Schemas ────────────────────────────────────────────────────────────────────

const UUIDParam = z.object({ id: z.string().uuid() });

const CATEGORIES = [
  'SALARY','DIVIDEND','RENTAL_INCOME','INTEREST_INCOME','TRANSFER_IN',
  'OPERATING_EXPENSE','PAYROLL','TAX_PAYMENT','LOAN_REPAYMENT',
  'INVESTMENT_PURCHASE','INVESTMENT_SALE','TRANSFER_OUT',
  'PERSONAL_EXPENSE','UTILITIES','INSURANCE','ENTERTAINMENT',
  'TRAVEL','MEDICAL','EDUCATION','CHARITY','UNCLASSIFIED',
  'GROCERIES','FUEL','DINING','MAINTENANCE','SUBSCRIPTIONS','TRANSPORT','CLOTHING',
] as const;

const PAYMENT_METHODS = ['CASH','BANK_TRANSFER','CREDIT_CARD','DEBIT_CARD','CHEQUE','DIRECT_DEBIT','OTHER'] as const;

const ExpenseQuerySchema = z.object({
  owner_entity_id: z.string().uuid().optional(),
  status:          z.enum(['DRAFT','SUBMITTED','APPROVED','REJECTED']).optional(),
  category:        z.enum(CATEGORIES).optional(),
  date_from:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit:           z.coerce.number().int().min(1).max(500).default(100),
  offset:          z.coerce.number().int().min(0).default(0),
}).strict();

const LINKED_RECORD_TYPES = ['VEHICLE','INSURANCE_POLICY','PROPERTY','FAMILY_MEMBER'] as const;
const FUEL_TYPES = ['PETROL','DIESEL','CNG','ELECTRIC'] as const;

const CreateExpenseSchema = z.object({
  owner_entity_id:      z.string().uuid(),
  expense_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description:          z.string().min(1).max(2000),
  payee_name:           z.string().max(200).optional(),
  amount:               z.number().positive(),
  currency:             z.string().length(3).default('TTD'),
  amount_ttd:           z.number().positive(),
  fx_rate_used:         z.number().positive().optional(),
  payment_method:       z.enum(PAYMENT_METHODS).default('BANK_TRANSFER'),
  category:             z.enum(CATEGORIES).default('OPERATING_EXPENSE'),
  gl_debit_account_id:  z.string().uuid().optional(),
  notes:                z.string().max(2000).optional(),
  card_id:              z.string().uuid().optional(),
  idempotency_key:      z.string().min(1).max(500),
  linked_record_type:   z.enum(LINKED_RECORD_TYPES).optional(),
  linked_record_id:     z.string().uuid().optional(),
  linked_record_label:  z.string().max(500).optional(),
  fuel_litres:          z.number().positive().optional(),
  fuel_odometer_km:     z.number().int().min(0).optional(),
  fuel_type:            z.enum(FUEL_TYPES).optional(),
}).strict();

const UpdateExpenseSchema = z.object({
  expense_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description:         z.string().min(1).max(2000).optional(),
  payee_name:          z.string().max(200).optional(),
  amount:              z.number().positive().optional(),
  currency:            z.string().length(3).optional(),
  amount_ttd:          z.number().positive().optional(),
  fx_rate_used:        z.number().positive().optional(),
  payment_method:      z.enum(PAYMENT_METHODS).optional(),
  category:             z.enum(CATEGORIES).optional(),
  gl_debit_account_id:  z.string().uuid().optional(),
  notes:                z.string().max(2000).optional(),
  card_id:              z.string().uuid().optional(),
  linked_record_type:   z.enum(LINKED_RECORD_TYPES).optional(),
  linked_record_id:     z.string().uuid().optional(),
  linked_record_label:  z.string().max(500).optional(),
  fuel_litres:          z.number().positive().optional(),
  fuel_odometer_km:     z.number().int().min(0).optional(),
  fuel_type:            z.enum(FUEL_TYPES).optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'At least one field required.' });

const ApproveExpenseSchema = z.object({
  gl_debit_account_id:  z.string().uuid(),
  gl_credit_account_id: z.string().uuid(),
  idempotency_key:      z.string().min(1).max(500),
}).strict();

const RejectExpenseSchema = z.object({
  rejection_reason: z.string().min(1).max(1000),
}).strict();

// ── GET /expenses ──────────────────────────────────────────────────────────────

expensesRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ExpenseQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { owner_entity_id, status, category, date_from, date_to, limit, offset } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (owner_entity_id) where.push(`owner_entity_id = ${push(owner_entity_id)}`);
        if (status)          where.push(`status = ${push(status)}`);
        if (category)        where.push(`category = ${push(category)}`);
        if (date_from)       where.push(`expense_date >= ${push(date_from)}`);
        if (date_to)         where.push(`expense_date <= ${push(date_to)}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return c.query(
          `SELECT id, owner_entity_id, submitted_by, expense_date, description, payee_name,
                  amount, currency, amount_ttd, fx_rate_used, payment_method, category,
                  gl_debit_account_id, gl_credit_account_id, status, submitted_at,
                  approved_by, approved_at, rejection_reason, journal_entry_id,
                  receipt_path, receipt_filename, notes, idempotency_key, created_at, updated_at,
                  linked_record_type, linked_record_id, linked_record_label,
                  fuel_litres, fuel_odometer_km, fuel_type
           FROM   fin_expenses ${clause}
           ORDER  BY expense_date DESC, created_at DESC
           LIMIT  ${push(limit)} OFFSET ${push(offset)}`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /expenses ─────────────────────────────────────────────────────────────

expensesRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateExpenseSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const { ownerId, userId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        if (b.gl_debit_account_id) {
          const acct = await c.query(
            `SELECT id, account_type FROM fin_gl_accounts WHERE id = $1`, [b.gl_debit_account_id],
          );
          if (acct.rows.length === 0) throw Object.assign(new Error('GL debit account not found.'), { status: 404, code: 'GL_ACCOUNT_NOT_FOUND' });
          if (!['EXPENSE','OTHER_EXPENSE'].includes(acct.rows[0].account_type)) {
            throw Object.assign(new Error('GL debit account must be an EXPENSE account.'), { status: 422, code: 'INVALID_GL_ACCOUNT_TYPE' });
          }
        }
        return c.query(
          `INSERT INTO fin_expenses
             (owner_id, owner_entity_id, submitted_by, expense_date, description, payee_name,
              amount, currency, amount_ttd, fx_rate_used, payment_method, category,
              gl_debit_account_id, notes, idempotency_key, card_id,
              linked_record_type, linked_record_id, linked_record_label,
              fuel_litres, fuel_odometer_km, fuel_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
           RETURNING *`,
          [ownerId, b.owner_entity_id, userId, b.expense_date, b.description,
           b.payee_name ?? null, b.amount, b.currency, b.amount_ttd,
           b.fx_rate_used ?? null, b.payment_method, b.category,
           b.gl_debit_account_id ?? null, b.notes ?? null, b.idempotency_key,
           b.card_id ?? null,
           b.linked_record_type ?? null, b.linked_record_id ?? null, b.linked_record_label ?? null,
           b.fuel_litres ?? null, b.fuel_odometer_km ?? null, b.fuel_type ?? null],
        ).then(r => r.rows[0]);
      });
      logger.info({ entity: 'EXPENSE', action: 'CREATED', user_id: ownerId, record_id: rec.id });

      // Auto-sync fuel log when a FUEL expense is linked to a vehicle with litres provided
      if (b.category === 'FUEL' && b.linked_record_type === 'VEHICLE' && b.linked_record_id && b.fuel_litres) {
        void autoInsertFuelLog({
          vehicleId:      b.linked_record_id,
          tenantId:       b.owner_entity_id,
          expenseId:      rec.id,
          logDate:        b.expense_date,
          litres:         b.fuel_litres,
          totalCostTtd:   b.amount_ttd,
          odometerKm:     b.fuel_odometer_km,
          fuelType:       b.fuel_type ?? 'PETROL',
          stationName:    b.payee_name,
          description:    b.description,
          userId,
        });
      }

      ok(res, rec, 201);
    } catch (e: unknown) {
      if (e instanceof Error) {
        const typed = e as Error & { status?: number; code?: string };
        if (typed.status) { err(res, typed.status, typed.code ?? 'EXPENSE_ERROR', typed.message); return; }
        if (typed.message.includes('idempotency_key')) {
          err(res, 409, 'DUPLICATE_EXPENSE', 'An expense with this idempotency key already exists.');
          return;
        }
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /expenses/:id ──────────────────────────────────────────────────────────

expensesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fin_expenses WHERE id = $1`, [parsed.data.id]).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'EXPENSE_NOT_FOUND', 'Expense not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /expenses/:id ────────────────────────────────────────────────────────
// Only allowed while status = DRAFT.

expensesRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = UUIDParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyParsed = UpdateExpenseSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = paramParsed.data;
    const b = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query(
          `SELECT status FROM fin_expenses WHERE id = $1`, [id],
        ).then(r => r.rows[0] ?? null);
        if (!existing) throw Object.assign(new Error('Expense not found.'), { status: 404, code: 'EXPENSE_NOT_FOUND' });
        if (existing.status !== 'DRAFT') throw Object.assign(new Error('Only DRAFT expenses can be edited.'), { status: 409, code: 'EXPENSE_NOT_DRAFT' });

        if (b.gl_debit_account_id) {
          const acct = await c.query(
            `SELECT id, account_type FROM fin_gl_accounts WHERE id = $1`, [b.gl_debit_account_id],
          );
          if (acct.rows.length === 0) throw Object.assign(new Error('GL debit account not found.'), { status: 404, code: 'GL_ACCOUNT_NOT_FOUND' });
          if (!['EXPENSE','OTHER_EXPENSE'].includes(acct.rows[0].account_type)) {
            throw Object.assign(new Error('GL debit account must be an EXPENSE account.'), { status: 422, code: 'INVALID_GL_ACCOUNT_TYPE' });
          }
        }

        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const sets = ['updated_at = now()'];
        if (b.expense_date        !== undefined) sets.push(`expense_date = ${push(b.expense_date)}`);
        if (b.description         !== undefined) sets.push(`description = ${push(b.description)}`);
        if (b.payee_name          !== undefined) sets.push(`payee_name = ${push(b.payee_name)}`);
        if (b.amount              !== undefined) sets.push(`amount = ${push(b.amount)}`);
        if (b.currency            !== undefined) sets.push(`currency = ${push(b.currency)}`);
        if (b.amount_ttd          !== undefined) sets.push(`amount_ttd = ${push(b.amount_ttd)}`);
        if (b.fx_rate_used        !== undefined) sets.push(`fx_rate_used = ${push(b.fx_rate_used)}`);
        if (b.payment_method      !== undefined) sets.push(`payment_method = ${push(b.payment_method)}`);
        if (b.category            !== undefined) sets.push(`category = ${push(b.category)}`);
        if (b.gl_debit_account_id  !== undefined) sets.push(`gl_debit_account_id = ${push(b.gl_debit_account_id)}`);
        if (b.notes                !== undefined) sets.push(`notes = ${push(b.notes)}`);
        if (b.card_id              !== undefined) sets.push(`card_id = ${push(b.card_id)}`);
        if (b.linked_record_type   !== undefined) sets.push(`linked_record_type = ${push(b.linked_record_type)}`);
        if (b.linked_record_id     !== undefined) sets.push(`linked_record_id = ${push(b.linked_record_id)}`);
        if (b.linked_record_label  !== undefined) sets.push(`linked_record_label = ${push(b.linked_record_label)}`);
        if (b.fuel_litres          !== undefined) sets.push(`fuel_litres = ${push(b.fuel_litres)}`);
        if (b.fuel_odometer_km     !== undefined) sets.push(`fuel_odometer_km = ${push(b.fuel_odometer_km)}`);
        if (b.fuel_type            !== undefined) sets.push(`fuel_type = ${push(b.fuel_type)}`);
        params.push(id);
        return c.query(
          `UPDATE fin_expenses SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0]);
      });
      logger.info({ entity: 'EXPENSE', action: 'UPDATED', user_id: ownerId, record_id: id });
      ok(res, rec);
    } catch (e: unknown) {
      if (e instanceof Error) {
        const typed = e as Error & { status?: number; code?: string };
        if (typed.status) { err(res, typed.status, typed.code ?? 'EXPENSE_ERROR', typed.message); return; }
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /expenses/:id/submit ──────────────────────────────────────────────────
// DRAFT → SUBMITTED

expensesRouter.post('/:id/submit', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query(
          `SELECT status FROM fin_expenses WHERE id = $1`, [parsed.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!existing) throw Object.assign(new Error('Expense not found.'), { status: 404, code: 'EXPENSE_NOT_FOUND' });
        if (existing.status !== 'DRAFT') throw Object.assign(new Error('Only DRAFT expenses can be submitted.'), { status: 409, code: 'EXPENSE_NOT_DRAFT' });

        return c.query(
          `UPDATE fin_expenses
           SET status = 'SUBMITTED', submitted_at = now(), updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [parsed.data.id],
        ).then(r => r.rows[0]);
      });
      logger.info({ entity: 'EXPENSE', action: 'SUBMITTED', user_id: ownerId, record_id: parsed.data.id });

      // Owner notification — expense awaiting approval (non-blocking).
      const amt = parseFloat(String(rec?.amount_ttd ?? 0));
      void enqueueNotification({
        tier: 1,
        title: 'Expense awaiting approval',
        body: `${rec?.payee_name ? `${rec.payee_name} — ` : ''}${rec?.description ?? 'Expense'} (TTD ${amt.toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) submitted for approval.`,
        payload: { module: 'FINANCE', kind: 'EXPENSE_APPROVAL', expense_id: parsed.data.id },
      });

      ok(res, rec);
    } catch (e: unknown) {
      if (e instanceof Error) {
        const typed = e as Error & { status?: number; code?: string };
        if (typed.status) { err(res, typed.status, typed.code ?? 'EXPENSE_ERROR', typed.message); return; }
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /expenses/:id/approve ─────────────────────────────────────────────────
// SUBMITTED → APPROVED  (Owner only)
// Auto-posts a GL journal entry: debit expense account, credit payment account.

expensesRouter.post('/:id/approve', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = UUIDParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyParsed = ApproveExpenseSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'gl_debit_account_id, gl_credit_account_id and idempotency_key are required.'); return; }

    if (!req.rlsCtx.isOwner) { err(res, 403, 'FORBIDDEN', 'Only the Owner can approve expenses.'); return; }

    const { id } = paramParsed.data;
    const b = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const result = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const expense = await c.query(
          `SELECT * FROM fin_expenses WHERE id = $1`, [id],
        ).then(r => r.rows[0] ?? null);
        if (!expense) throw Object.assign(new Error('Expense not found.'), { status: 404, code: 'EXPENSE_NOT_FOUND' });
        if (expense.status !== 'SUBMITTED') throw Object.assign(new Error('Only SUBMITTED expenses can be approved.'), { status: 409, code: 'EXPENSE_NOT_SUBMITTED' });

        // Validate both GL accounts exist and allow direct posting
        const accounts = await c.query(
          `SELECT id, account_type, allow_direct_posting FROM fin_gl_accounts WHERE id = ANY($1::uuid[])`,
          [[b.gl_debit_account_id, b.gl_credit_account_id]],
        );
        if (accounts.rows.length !== 2) throw Object.assign(new Error('One or more GL accounts not found.'), { status: 404, code: 'GL_ACCOUNT_NOT_FOUND' });

        const debitAcct  = accounts.rows.find(r => r.id === b.gl_debit_account_id);
        const creditAcct = accounts.rows.find(r => r.id === b.gl_credit_account_id);

        if (!debitAcct!.allow_direct_posting || !creditAcct!.allow_direct_posting) {
          throw Object.assign(new Error('Summary accounts do not allow direct posting.'), { status: 422, code: 'ACCOUNT_NO_DIRECT_POSTING' });
        }
        if (!['EXPENSE','OTHER_EXPENSE'].includes(debitAcct!.account_type)) {
          throw Object.assign(new Error('Debit account must be an EXPENSE account.'), { status: 422, code: 'INVALID_GL_ACCOUNT_TYPE' });
        }
        if (!['LIABILITY','ASSET'].includes(creditAcct!.account_type)) {
          throw Object.assign(new Error('Credit account must be a LIABILITY or ASSET account (e.g. bank, credit card, accrued liabilities).'), { status: 422, code: 'INVALID_GL_CREDIT_ACCOUNT_TYPE' });
        }

        const amountTtd = Number(expense.amount_ttd).toFixed(2);

        // Create and immediately post the GL journal entry
        const je = await c.query(
          `INSERT INTO fin_journal_entries
             (owner_id, owner_entity_id, entry_date, description, status, source, source_id,
              currency, total_debit_ttd, total_credit_ttd, posted_at, posted_by, idempotency_key)
           VALUES ($1,$2,$3,$4,'POSTED','MANUAL',$5,'TTD',$6,$7,now(),$8,$9)
           RETURNING *`,
          [ownerId, expense.owner_entity_id, expense.expense_date,
           `Expense: ${expense.description}`, id,
           amountTtd, amountTtd, ownerId, b.idempotency_key],
        ).then(r => r.rows[0]);

        // Debit the expense account
        await c.query(
          `INSERT INTO fin_journal_entry_lines
             (owner_id, journal_entry_id, gl_account_id, line_number, description, debit_ttd, credit_ttd)
           VALUES ($1,$2,$3,1,$4,$5,0)`,
          [ownerId, je.id, b.gl_debit_account_id, expense.description, amountTtd],
        );

        // Credit the payment account
        await c.query(
          `INSERT INTO fin_journal_entry_lines
             (owner_id, journal_entry_id, gl_account_id, line_number, description, debit_ttd, credit_ttd)
           VALUES ($1,$2,$3,2,$4,0,$5)`,
          [ownerId, je.id, b.gl_credit_account_id, expense.description, amountTtd],
        );

        // Mark expense approved and link the GL entry
        const updated = await c.query(
          `UPDATE fin_expenses
           SET status = 'APPROVED', approved_by = $1, approved_at = now(),
               gl_debit_account_id = $2, gl_credit_account_id = $3,
               journal_entry_id = $4, updated_at = now()
           WHERE id = $5
           RETURNING *`,
          [ownerId, b.gl_debit_account_id, b.gl_credit_account_id, je.id, id],
        ).then(r => r.rows[0]);

        return { expense: updated, journal_entry_id: je.id };
      });

      logger.info({ entity: 'EXPENSE', action: 'APPROVED', user_id: ownerId, record_id: id, journal_entry_id: result.journal_entry_id });

      // Audit trail
      const coreClient = await corePool.connect();
      try {
        await coreClient.query('BEGIN');
        await coreClient.query('SELECT set_config($1,$2,true)', ['app.current_user_id', ownerId]);
        await coreClient.query(
          `INSERT INTO audit_log (user_id, entity, action, record_id, source)
           VALUES ($1,'Expense','APPROVE',$2,'API')`,
          [ownerId, id],
        );
        await coreClient.query('COMMIT');
      } catch { await coreClient.query('ROLLBACK'); } finally { coreClient.release(); }

      ok(res, result.expense);
    } catch (e: unknown) {
      if (e instanceof Error) {
        const typed = e as Error & { status?: number; code?: string };
        if (typed.status) { err(res, typed.status, typed.code ?? 'EXPENSE_ERROR', typed.message); return; }
        if (typed.message.includes('idempotency_key')) {
          err(res, 409, 'DUPLICATE_APPROVAL', 'This expense has already been approved (duplicate idempotency key).');
          return;
        }
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /expenses/:id/reject ──────────────────────────────────────────────────
// SUBMITTED → REJECTED  (Owner only)

expensesRouter.post('/:id/reject', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = UUIDParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyParsed = RejectExpenseSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'rejection_reason is required.'); return; }

    if (!req.rlsCtx.isOwner) { err(res, 403, 'FORBIDDEN', 'Only the Owner can reject expenses.'); return; }

    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query(
          `SELECT status FROM fin_expenses WHERE id = $1`, [paramParsed.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!existing) throw Object.assign(new Error('Expense not found.'), { status: 404, code: 'EXPENSE_NOT_FOUND' });
        if (existing.status !== 'SUBMITTED') throw Object.assign(new Error('Only SUBMITTED expenses can be rejected.'), { status: 409, code: 'EXPENSE_NOT_SUBMITTED' });

        return c.query(
          `UPDATE fin_expenses
           SET status = 'REJECTED', rejection_reason = $1,
               approved_by = $2, approved_at = now(), updated_at = now()
           WHERE id = $3
           RETURNING *`,
          [bodyParsed.data.rejection_reason, ownerId, paramParsed.data.id],
        ).then(r => r.rows[0]);
      });
      logger.info({ entity: 'EXPENSE', action: 'REJECTED', user_id: ownerId, record_id: paramParsed.data.id });
      ok(res, rec);
    } catch (e: unknown) {
      if (e instanceof Error) {
        const typed = e as Error & { status?: number; code?: string };
        if (typed.status) { err(res, typed.status, typed.code ?? 'EXPENSE_ERROR', typed.message); return; }
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /expenses/:id/reverse ────────────────────────────────────────────────
// APPROVED → REVERSED  (Owner only)
// Voids the original GL journal entry and posts a reversing entry in one
// transaction, then marks the expense REVERSED. The original entry is never
// deleted — full audit trail is preserved.

const ReverseExpenseSchema = z.object({
  reversal_reason: z.string().min(1).max(1000),
  idempotency_key: z.string().min(1).max(500),
}).strict();

expensesRouter.post('/:id/reverse', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = UUIDParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyParsed = ReverseExpenseSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'reversal_reason and idempotency_key are required.'); return; }

    if (!req.rlsCtx.isOwner) { err(res, 403, 'FORBIDDEN', 'Only the Owner can reverse expenses.'); return; }

    const { id } = paramParsed.data;
    const { reversal_reason, idempotency_key } = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const result = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const expense = await c.query(
          `SELECT * FROM fin_expenses WHERE id = $1`, [id],
        ).then(r => r.rows[0] ?? null);

        if (!expense) throw Object.assign(new Error('Expense not found.'), { status: 404, code: 'EXPENSE_NOT_FOUND' });
        if (expense.status !== 'APPROVED') throw Object.assign(new Error('Only APPROVED expenses can be reversed.'), { status: 409, code: 'EXPENSE_NOT_APPROVED' });
        if (!expense.journal_entry_id) throw Object.assign(new Error('No GL entry linked to this expense.'), { status: 409, code: 'NO_JOURNAL_ENTRY' });

        // Fetch original GL lines
        const lines = await c.query(
          `SELECT * FROM fin_journal_entry_lines WHERE journal_entry_id = $1 ORDER BY line_number`,
          [expense.journal_entry_id],
        ).then(r => r.rows);

        // Void the original entry
        await c.query(
          `UPDATE fin_journal_entries
           SET status = 'VOID', void_reason = $1, voided_at = now(), voided_by = $2, updated_at = now()
           WHERE id = $3`,
          [reversal_reason, ownerId, expense.journal_entry_id],
        );

        // Post the reversing entry (swap debit/credit)
        const amountTtd = Number(expense.amount_ttd).toFixed(2);
        const reversing = await c.query(
          `INSERT INTO fin_journal_entries
             (owner_id, owner_entity_id, entry_date, description, status, source, source_id,
              currency, total_debit_ttd, total_credit_ttd, posted_at, posted_by, idempotency_key)
           VALUES ($1,$2,CURRENT_DATE,$3,'POSTED','REVERSAL',$4,'TTD',$5,$6,now(),$7,$8)
           RETURNING *`,
          [ownerId, expense.owner_entity_id,
           `REVERSAL: ${expense.description}`,
           expense.journal_entry_id, amountTtd, amountTtd, ownerId, idempotency_key],
        ).then(r => r.rows[0]);

        // Insert reversed lines (debit ↔ credit swapped)
        for (const line of lines) {
          await c.query(
            `INSERT INTO fin_journal_entry_lines
               (owner_id, journal_entry_id, gl_account_id, line_number, description, debit_ttd, credit_ttd)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [ownerId, reversing.id, line.gl_account_id, line.line_number,
             `REVERSAL: ${line.description}`,
             line.credit_ttd, line.debit_ttd],  // swapped
          );
        }

        // Mark expense as REVERSED
        const updated = await c.query(
          `UPDATE fin_expenses
           SET status = 'REVERSED', reversal_reason = $1, reversed_at = now(),
               reversed_by = $2, reversing_journal_entry_id = $3, updated_at = now()
           WHERE id = $4
           RETURNING *`,
          [reversal_reason, ownerId, reversing.id, id],
        ).then(r => r.rows[0]);

        return { expense: updated, reversing_journal_entry_id: reversing.id };
      });

      logger.info({ entity: 'EXPENSE', action: 'REVERSED', user_id: ownerId, record_id: id, reversing_je: result.reversing_journal_entry_id });

      const coreClient = await corePool.connect();
      try {
        await coreClient.query('BEGIN');
        await coreClient.query('SELECT set_config($1,$2,true)', ['app.current_user_id', ownerId]);
        await coreClient.query(
          `INSERT INTO audit_log (user_id, entity, action, record_id, new_values, source)
           VALUES ($1,'Expense','REVERSE',$2,$3,'API')`,
          [ownerId, id, JSON.stringify({ reversal_reason, reversing_journal_entry_id: result.reversing_journal_entry_id })],
        );
        await coreClient.query('COMMIT');
      } catch { await coreClient.query('ROLLBACK'); } finally { coreClient.release(); }

      ok(res, result.expense);
    } catch (e: unknown) {
      if (e instanceof Error) {
        const typed = e as Error & { status?: number; code?: string };
        if (typed.status) { err(res, typed.status, typed.code ?? 'EXPENSE_ERROR', typed.message); return; }
        if (typed.message.includes('idempotency_key')) {
          err(res, 409, 'DUPLICATE_REVERSAL', 'This expense has already been reversed.');
          return;
        }
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /expenses/:id ──────────────────────────────────────────────────────
// Owner only. Deletes DRAFT or REJECTED expenses. SUBMITTED/APPROVED are blocked.

expensesRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.rlsCtx.isOwner) { err(res, 403, 'FORBIDDEN', 'This action requires Owner role.'); return; }

    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }

    const { id } = parsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const deleted = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const expense = await c.query(
          `SELECT id, status, description FROM fin_expenses WHERE id = $1`,
          [id],
        ).then(r => r.rows[0] ?? null);

        if (!expense) throw Object.assign(new Error('Expense not found.'), { status: 404, code: 'EXPENSE_NOT_FOUND' });

        if (expense.status === 'SUBMITTED' || expense.status === 'APPROVED') {
          throw Object.assign(
            new Error(`Cannot delete a ${expense.status.toLowerCase()} expense. Void or reverse it instead.`),
            { status: 409, code: 'EXPENSE_IN_WORKFLOW' },
          );
        }

        await c.query(`DELETE FROM fin_expenses WHERE id = $1`, [id]);
        return expense.description as string;
      });

      logger.info({ entity: 'EXPENSE', action: 'EXPENSE_DELETED', user_id: ownerId, record_id: id });
      ok(res, { deleted: true, id });
    } catch (e: unknown) {
      const typed = e as Error & { status?: number; code?: string };
      if (typed.status === 404) { err(res, 404, 'EXPENSE_NOT_FOUND', typed.message); return; }
      if (typed.status === 409) { err(res, 409, typed.code ?? 'EXPENSE_ERROR', typed.message); return; }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /expenses/:id/receipt ─────────────────────────────────────────────────
// Attach a receipt file. Stores to MinIO path pattern: expenses/{owner_id}/{expense_id}/{filename}

expensesRouter.post('/:id/receipt', upload.single('receipt'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    if (!req.file) { err(res, 422, 'NO_FILE', 'Receipt file is required (PDF, JPEG, PNG, or WebP).'); return; }

    const { ownerId } = req.rlsCtx;
    const { id } = parsed.data;
    const key  = mediaObjectKey(ownerId, 'expenses', id, req.file.originalname);
    const mime = req.file.mimetype || 'application/octet-stream';

    // Upload to MinIO first — if it fails, the DB is never touched.
    await ensureBucket(BUCKET_RECEIPTS);
    await minioClient.putObject(BUCKET_RECEIPTS, key, req.file.buffer, req.file.size, { 'Content-Type': mime });
    logger.info({ entity: 'MINIO', action: 'OBJECT_PUT', bucket: BUCKET_RECEIPTS, key });

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query(
          `SELECT id FROM fin_expenses WHERE id = $1`, [id],
        ).then(r => r.rows[0] ?? null);
        if (!existing) throw Object.assign(new Error('Expense not found.'), { status: 404, code: 'EXPENSE_NOT_FOUND' });

        return c.query(
          `UPDATE fin_expenses
           SET receipt_path = $1, receipt_filename = $2, receipt_bucket = $3, updated_at = now()
           WHERE id = $4
           RETURNING id, receipt_path, receipt_filename, receipt_bucket`,
          [key, req.file!.originalname, BUCKET_RECEIPTS, id],
        ).then(r => r.rows[0]);
      });
      logger.info({ entity: 'EXPENSE', action: 'RECEIPT_ATTACHED', user_id: ownerId, record_id: id });
      ok(res, rec);
    } catch (e: unknown) {
      if (e instanceof Error) {
        const typed = e as Error & { status?: number; code?: string };
        if (typed.status) { err(res, typed.status, typed.code ?? 'EXPENSE_ERROR', typed.message); return; }
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});
