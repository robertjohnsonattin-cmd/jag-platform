// GET    /api/v1/hr/advances              — list salary advances (filterable by employee)
// POST   /api/v1/hr/advances              — record a new advance
// PATCH  /api/v1/hr/advances/:id          — update (status, recovered amount)
// DELETE /api/v1/hr/advances/:id          — cancel (only ACTIVE)
// GET    /api/v1/hr/loans                 — list staff loans
// POST   /api/v1/hr/loans                 — record a new loan
// PATCH  /api/v1/hr/loans/:id             — update (status, repaid amount, balance)
// DELETE /api/v1/hr/loans/:id             — cancel (only ACTIVE)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const hrAdvancesRouter = Router();
export const hrLoansRouter    = Router();
hrAdvancesRouter.use(requireAuth());
hrLoansRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;
const optDate   = z.preprocess(v => (v === '' ? undefined : v), z.string().regex(DATE_RE).optional());

// ── Advances ──────────────────────────────────────────────────────────────────

const CreateAdvanceSchema = z.object({
  employee_id:              z.string().uuid(),
  advance_date:             optDate,
  amount_ttd:               z.coerce.number().positive(),
  recovery_installment_ttd: z.coerce.number().positive(),
  reason:                   z.string().max(500).optional(),
  approved_by:              z.string().max(200).optional(),
  notes:                    z.string().max(2000).optional(),
}).strict();

const PatchAdvanceSchema = z.object({
  recovery_installment_ttd: z.coerce.number().positive().optional(),
  total_recovered_ttd:      z.coerce.number().min(0).optional(),
  status:                   z.enum(['ACTIVE','RECOVERED','WRITTEN_OFF','CANCELLED']).optional(),
  notes:                    z.string().max(2000).optional(),
}).strict();

hrAdvancesRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const q = z.object({
    employee_id: z.string().uuid().optional(),
    status:      z.string().optional(),
    limit:       z.coerce.number().int().min(1).max(500).default(100),
  }).safeParse(req.query);
  if (!q.success) { err(res, 400, 'VALIDATION_ERROR', q.error.message); return; }

  const { employee_id, status, limit } = q.data;
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const conds: string[] = [];
  if (employee_id) conds.push(`a.employee_id = ${push(employee_id)}`);
  if (status)      conds.push(`a.status = ${push(status)}`);
  const wc = conds.length ? `AND ${conds.join(' AND ')}` : '';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT a.*,
                 e.first_name || ' ' || e.last_name AS employee_name,
                 e.employee_number,
                 (a.amount_ttd - a.total_recovered_ttd) AS outstanding_ttd
          FROM hr_salary_advances a
          JOIN hr_employees e ON e.id = a.employee_id
          WHERE a.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ${wc}
          ORDER BY a.advance_date DESC
          LIMIT ${push(limit)}
        `, params).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrAdvancesRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateAdvanceSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }
  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO hr_salary_advances
             (tenant_id, employee_id, advance_date, amount_ttd, recovery_installment_ttd,
              reason, approved_by, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [tenantId, d.employee_id, d.advance_date ?? new Date().toISOString().slice(0, 10),
           d.amount_ttd, d.recovery_installment_ttd,
           d.reason ?? null, d.approved_by ?? null, d.notes ?? null, userId],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'HR', action: 'ADVANCE_CREATED', advance_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrAdvancesRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid advance id.'); return; }
  const parsed = PatchAdvanceSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const upd = parsed.data;
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const sets: string[] = [];
  if (upd.recovery_installment_ttd !== undefined) sets.push(`recovery_installment_ttd = ${push(upd.recovery_installment_ttd)}`);
  if (upd.total_recovered_ttd !== undefined)      sets.push(`total_recovered_ttd = ${push(upd.total_recovered_ttd)}`);
  if (upd.status !== undefined)                   sets.push(`status = ${push(upd.status)}`);
  if (upd.notes !== undefined)                    sets.push(`notes = ${push(upd.notes)}`);
  if (!sets.length) { err(res, 400, 'NO_CHANGES', 'No fields to update.'); return; }
  sets.push(`updated_at = now()`);

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE hr_salary_advances SET ${sets.join(', ')} WHERE id = ${push(pp.data.id)} RETURNING *`, params)
          .then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Advance not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrAdvancesRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid advance id.'); return; }
  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE hr_salary_advances SET status = 'CANCELLED', updated_at = now()
                 WHERE id = $1 AND status = 'ACTIVE' RETURNING id`, [pp.data.id])
          .then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Active advance not found.'); return; }
      ok(res, { id: row.id });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Staff Loans ───────────────────────────────────────────────────────────────

const CreateLoanSchema = z.object({
  employee_id:             z.string().uuid(),
  loan_date:               optDate,
  principal_ttd:           z.coerce.number().positive(),
  interest_rate:           z.coerce.number().min(0).default(0),
  monthly_installment_ttd: z.coerce.number().positive(),
  reason:                  z.string().max(500).optional(),
  approved_by:             z.string().max(200).optional(),
  notes:                   z.string().max(2000).optional(),
}).strict();

const PatchLoanSchema = z.object({
  monthly_installment_ttd: z.coerce.number().positive().optional(),
  total_repaid_ttd:        z.coerce.number().min(0).optional(),
  outstanding_balance_ttd: z.coerce.number().min(0).optional(),
  status:                  z.enum(['ACTIVE','PAID_OFF','WRITTEN_OFF','CANCELLED']).optional(),
  notes:                   z.string().max(2000).optional(),
}).strict();

hrLoansRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const q = z.object({
    employee_id: z.string().uuid().optional(),
    status:      z.string().optional(),
    limit:       z.coerce.number().int().min(1).max(500).default(100),
  }).safeParse(req.query);
  if (!q.success) { err(res, 400, 'VALIDATION_ERROR', q.error.message); return; }

  const { employee_id, status, limit } = q.data;
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const conds: string[] = [];
  if (employee_id) conds.push(`l.employee_id = ${push(employee_id)}`);
  if (status)      conds.push(`l.status = ${push(status)}`);
  const wc = conds.length ? `AND ${conds.join(' AND ')}` : '';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT l.*,
                 e.first_name || ' ' || e.last_name AS employee_name,
                 e.employee_number
          FROM hr_staff_loans l
          JOIN hr_employees e ON e.id = l.employee_id
          WHERE l.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ${wc}
          ORDER BY l.loan_date DESC
          LIMIT ${push(limit)}
        `, params).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrLoansRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateLoanSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }
  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO hr_staff_loans
             (tenant_id, employee_id, loan_date, principal_ttd, interest_rate,
              monthly_installment_ttd, outstanding_balance_ttd, reason, approved_by, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [tenantId, d.employee_id, d.loan_date ?? new Date().toISOString().slice(0, 10),
           d.principal_ttd, d.interest_rate, d.monthly_installment_ttd,
           d.principal_ttd,
           d.reason ?? null, d.approved_by ?? null, d.notes ?? null, userId],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'HR', action: 'LOAN_CREATED', loan_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrLoansRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid loan id.'); return; }
  const parsed = PatchLoanSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const upd = parsed.data;
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const sets: string[] = [];
  if (upd.monthly_installment_ttd !== undefined) sets.push(`monthly_installment_ttd = ${push(upd.monthly_installment_ttd)}`);
  if (upd.total_repaid_ttd !== undefined)        sets.push(`total_repaid_ttd = ${push(upd.total_repaid_ttd)}`);
  if (upd.outstanding_balance_ttd !== undefined) sets.push(`outstanding_balance_ttd = ${push(upd.outstanding_balance_ttd)}`);
  if (upd.status !== undefined)                  sets.push(`status = ${push(upd.status)}`);
  if (upd.notes !== undefined)                   sets.push(`notes = ${push(upd.notes)}`);
  if (!sets.length) { err(res, 400, 'NO_CHANGES', 'No fields to update.'); return; }
  sets.push(`updated_at = now()`);

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE hr_staff_loans SET ${sets.join(', ')} WHERE id = ${push(pp.data.id)} RETURNING *`, params)
          .then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Loan not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrLoansRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid loan id.'); return; }
  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE hr_staff_loans SET status = 'CANCELLED', updated_at = now()
                 WHERE id = $1 AND status = 'ACTIVE' RETURNING id`, [pp.data.id])
          .then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Active loan not found.'); return; }
      ok(res, { id: row.id });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
