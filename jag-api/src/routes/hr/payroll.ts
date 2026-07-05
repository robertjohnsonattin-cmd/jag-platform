// GET    /api/v1/hr/payroll/runs                              — list pay runs
// POST   /api/v1/hr/payroll/runs                              — create pay run (DRAFT)
// GET    /api/v1/hr/payroll/runs/:id                          — get run + entries
// POST   /api/v1/hr/payroll/runs/:id/calculate                — auto-calculate T&T deductions
// POST   /api/v1/hr/payroll/runs/:id/finalize                 — finalise + post GL
// PATCH  /api/v1/hr/payroll/runs/:id/entries/:entryId         — override an entry
// GET    /api/v1/hr/payroll/runs/:id/payslip/:employeeId      — payslip data

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { calculateTTPayrollForFrequency } from '../../lib/tt-payroll';
import { postPayrollGlEntry } from '../../lib/payroll-gl';

export const hrPayrollRouter = Router();
hrPayrollRouter.use(requireAuth());

const UUIDParam     = z.object({ id: z.string().uuid() });
const RunEntryParam = z.object({ id: z.string().uuid(), entryId: z.string().uuid() });
const SlipParam     = z.object({ id: z.string().uuid(), employeeId: z.string().uuid() });
const DATE_RE       = /^\d{4}-\d{2}-\d{2}$/;

const CreateRunSchema = z.object({
  period_month: z.number().int().min(1).max(12),
  period_year:  z.number().int().min(2020).max(2099),
  pay_date:     z.string().regex(DATE_RE).optional(),
  notes:        z.string().max(1000).optional(),
}).strict();

const FinalizeSchema = z.object({
  pay_date:                   z.string().regex(DATE_RE),
  // Optional GL account IDs for posting — can be configured per entity
  salary_expense_account_id:           z.string().uuid().optional(),
  nis_expense_account_id:              z.string().uuid().optional(),
  salaries_payable_account_id:         z.string().uuid().optional(),
  nis_payable_account_id:              z.string().uuid().optional(),
  paye_payable_account_id:             z.string().uuid().optional(),
  health_surcharge_payable_account_id: z.string().uuid().optional(),
}).strict();

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── GET /runs ─────────────────────────────────────────────────────────────────
hrPayrollRouter.get('/runs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const q = z.object({
    year: z.coerce.number().int().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(24),
  }).safeParse(req.query);
  if (!q.success) { err(res, 400, 'VALIDATION_ERROR', q.error.message); return; }

  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (q.data.year) where.push(`period_year = ${push(q.data.year)}`);
  const wc = where.length ? `AND ${where.join(' AND ')}` : '';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT r.*,
                 COUNT(e.id) AS employee_count
          FROM hr_payroll_runs r
          LEFT JOIN hr_payroll_entries e ON e.payroll_run_id = r.id AND e.status = 'INCLUDED'
          WHERE r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ${wc}
          GROUP BY r.id
          ORDER BY r.period_year DESC, r.period_month DESC
          LIMIT ${push(q.data.limit)}
        `, params).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /runs ────────────────────────────────────────────────────────────────
hrPayrollRouter.post('/runs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateRunSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;
  const idempotencyKey = `payrun_${tenantId}_${d.period_year}_${String(d.period_month).padStart(2, '0')}`;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const run = await c.query(
          `INSERT INTO hr_payroll_runs (tenant_id, period_month, period_year, pay_date, notes, idempotency_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING *`,
          [tenantId, d.period_month, d.period_year, d.pay_date ?? null, d.notes ?? null, idempotencyKey, userId],
        ).then((r) => r.rows[0] ?? null);

        if (!run) return null;  // already exists

        // Pre-populate with all ACTIVE employees
        const employees = await c.query(
          `SELECT id, base_salary_ttd, pay_frequency FROM hr_employees
           WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
             AND status = 'ACTIVE'`,
        ).then((r) => r.rows);

        if (employees.length > 0) {
          await Promise.all(employees.map((emp: { id: string; base_salary_ttd: string; pay_frequency: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY' }) =>
            c.query(
              `INSERT INTO hr_payroll_entries (tenant_id, payroll_run_id, employee_id, base_salary_ttd)
               VALUES ($1,$2,$3,$4) ON CONFLICT (payroll_run_id, employee_id) DO NOTHING`,
              [tenantId, run.id, emp.id, emp.base_salary_ttd],
            ),
          ));
        }

        return run;
      });

      if (!row) { err(res, 409, 'CONFLICT', 'A payroll run already exists for this period.'); return; }
      logger.info({ entity: 'HR', action: 'PAYROLL_RUN_CREATED', run_id: row.id, user_id: userId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /runs/:id ─────────────────────────────────────────────────────────────
hrPayrollRouter.get('/runs/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid run id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const [run, entries] = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const r = await c.query(`SELECT * FROM hr_payroll_runs WHERE id = $1`, [pp.data.id])
          .then((r) => r.rows[0] ?? null);
        if (!r) return [null, []];

        const e = await c.query(`
          SELECT pe.*,
                 e.first_name || ' ' || e.last_name AS employee_name,
                 e.employee_number, e.position_id, p.name AS position_name,
                 e.department_id, d.name AS department_name,
                 e.pay_frequency,
                 COALESCE(
                   (SELECT json_agg(di.*) FROM hr_payroll_deduction_items di WHERE di.payroll_entry_id = pe.id),
                   '[]'
                 ) AS deduction_items
          FROM hr_payroll_entries pe
          JOIN hr_employees   e ON e.id = pe.employee_id
          LEFT JOIN hr_positions   p ON p.id = e.position_id
          LEFT JOIN hr_departments d ON d.id = e.department_id
          WHERE pe.payroll_run_id = $1
          ORDER BY e.last_name, e.first_name
        `, [pp.data.id]).then((r) => r.rows);

        return [r, e];
      });

      if (!run) { err(res, 404, 'NOT_FOUND', 'Payroll run not found.'); return; }
      ok(res, { ...run, entries });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /runs/:id/calculate ──────────────────────────────────────────────────
hrPayrollRouter.post('/runs/:id/calculate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid run id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const run = await c.query(
          `SELECT * FROM hr_payroll_runs WHERE id = $1 AND status = 'DRAFT'`, [pp.data.id],
        ).then((r) => r.rows[0] ?? null);
        if (!run) return null;

        // Sync: add any ACTIVE employees not yet in this run (hired after run was created)
        const tenantId = req.rlsCtx.tenantId;
        await c.query(
          `INSERT INTO hr_payroll_entries (tenant_id, payroll_run_id, employee_id, base_salary_ttd)
           SELECT $1, $2, e.id, e.base_salary_ttd
           FROM hr_employees e
           WHERE e.tenant_id = $1 AND e.status = 'ACTIVE'
             AND NOT EXISTS (
               SELECT 1 FROM hr_payroll_entries pe
               WHERE pe.payroll_run_id = $2 AND pe.employee_id = e.id
             )
           ON CONFLICT (payroll_run_id, employee_id) DO NOTHING`,
          [tenantId, pp.data.id],
        );

        const entries: Array<{
          id: string; base_salary_ttd: string; overtime_pay_ttd: string;
          bonus_ttd: string; other_allowances_ttd: string; other_deductions_ttd: string;
          employee_id: string;
          pay_frequency: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY';
          employment_type: string;
        }> = await c.query(`
          SELECT pe.id, pe.base_salary_ttd, pe.overtime_pay_ttd, pe.bonus_ttd,
                 pe.other_allowances_ttd, pe.other_deductions_ttd, pe.employee_id,
                 e.pay_frequency, e.employment_type
          FROM hr_payroll_entries pe
          JOIN hr_employees e ON e.id = pe.employee_id
          WHERE pe.payroll_run_id = $1 AND pe.status = 'INCLUDED'
        `, [pp.data.id]).then((r) => r.rows);

        // Calculate statutory deductions per entry
        // CONTRACT workers: flat payment, no statutory deductions (NIS/Health Surcharge/PAYE)
        // They are self-employed for NIS purposes and handle their own tax obligations.
        let totalGross = 0, totalNet = 0, totalNisEmp = 0, totalNisEr = 0,
            totalPaye = 0, totalHS = 0;

        await Promise.all(entries.map(async (entry) => {
          const gross = parseFloat(String(entry.base_salary_ttd ?? 0))
                      + parseFloat(String(entry.overtime_pay_ttd ?? 0))
                      + parseFloat(String(entry.bonus_ttd ?? 0))
                      + parseFloat(String(entry.other_allowances_ttd ?? 0));

          const isContractor = entry.employment_type === 'CONTRACT';
          const calc = isContractor
            ? { nisEmployeeTtd: 0, nisEmployerTtd: 0, healthSurchargeTtd: 0, payeTtd: 0, totalDeductionsTtd: 0 }
            : calculateTTPayrollForFrequency(gross, entry.pay_frequency ?? 'MONTHLY');

          // Pull active advance recovery amounts for this employee
          const advanceRows = await c.query<{ id: string; recovery_installment_ttd: string; outstanding_ttd: string }>(
            `SELECT id, recovery_installment_ttd,
                    (amount_ttd - total_recovered_ttd) AS outstanding_ttd
             FROM hr_salary_advances
             WHERE employee_id = $1 AND status = 'ACTIVE'`,
            [entry.employee_id],
          ).then((r) => r.rows);

          // Pull active loan installments for this employee
          const loanRows = await c.query<{ id: string; monthly_installment_ttd: string; outstanding_balance_ttd: string }>(
            `SELECT id, monthly_installment_ttd, outstanding_balance_ttd
             FROM hr_staff_loans
             WHERE employee_id = $1 AND status = 'ACTIVE'`,
            [entry.employee_id],
          ).then((r) => r.rows);

          // Rebuild deduction_items (clear old, insert new)
          await c.query(`DELETE FROM hr_payroll_deduction_items WHERE payroll_entry_id = $1`, [entry.id]);

          let advanceDedTotal = 0;
          for (const adv of advanceRows) {
            const installment = Math.min(
              parseFloat(String(adv.recovery_installment_ttd)),
              parseFloat(String(adv.outstanding_ttd)),
            );
            if (installment > 0) {
              advanceDedTotal += installment;
              await c.query(
                `INSERT INTO hr_payroll_deduction_items (tenant_id, payroll_entry_id, label, amount_ttd, deduction_type, reference_id)
                 VALUES ($1,$2,'Salary Advance Recovery',$3,'ADVANCE_RECOVERY',$4)`,
                [tenantId, entry.id, installment.toFixed(2), adv.id],
              );
            }
          }

          let loanDedTotal = 0;
          for (const loan of loanRows) {
            const installment = Math.min(
              parseFloat(String(loan.monthly_installment_ttd)),
              parseFloat(String(loan.outstanding_balance_ttd)),
            );
            if (installment > 0) {
              loanDedTotal += installment;
              await c.query(
                `INSERT INTO hr_payroll_deduction_items (tenant_id, payroll_entry_id, label, amount_ttd, deduction_type, reference_id)
                 VALUES ($1,$2,'Staff Loan Repayment',$3,'LOAN_REPAYMENT',$4)`,
                [tenantId, entry.id, installment.toFixed(2), loan.id],
              );
            }
          }

          const otherDed = parseFloat(String(entry.other_deductions_ttd ?? 0));
          const totalDed = calc.totalDeductionsTtd + otherDed + advanceDedTotal + loanDedTotal;
          const net      = gross - totalDed;

          totalGross  += gross;
          totalNet    += net;
          totalNisEmp += calc.nisEmployeeTtd;
          totalNisEr  += calc.nisEmployerTtd;
          totalPaye   += calc.payeTtd;
          totalHS     += calc.healthSurchargeTtd;

          await c.query(
            `UPDATE hr_payroll_entries SET
               total_gross_ttd       = $1,
               nis_employee_ttd      = $2,
               nis_employer_ttd      = $3,
               health_surcharge_ttd  = $4,
               paye_ttd              = $5,
               total_deductions_ttd  = $6,
               net_pay_ttd           = $7,
               updated_at            = now()
             WHERE id = $8`,
            [gross.toFixed(2), calc.nisEmployeeTtd.toFixed(2), calc.nisEmployerTtd.toFixed(2),
             calc.healthSurchargeTtd.toFixed(2), calc.payeTtd.toFixed(2),
             totalDed.toFixed(2), net.toFixed(2), entry.id],
          );
        }));

        // Update run totals
        const updated = await c.query(
          `UPDATE hr_payroll_runs SET
             total_gross_ttd             = $1,
             total_net_ttd               = $2,
             total_nis_employee_ttd      = $3,
             total_nis_employer_ttd      = $4,
             total_paye_ttd              = $5,
             total_health_surcharge_ttd  = $6,
             updated_at                  = now()
           WHERE id = $7 RETURNING *`,
          [totalGross.toFixed(2), totalNet.toFixed(2), totalNisEmp.toFixed(2),
           totalNisEr.toFixed(2), totalPaye.toFixed(2), totalHS.toFixed(2), run.id],
        ).then((r) => r.rows[0]);

        return updated;
      });

      if (!result) { err(res, 404, 'NOT_FOUND', 'Payroll run not found or not in DRAFT status.'); return; }
      logger.info({ entity: 'HR', action: 'PAYROLL_CALCULATED', run_id: pp.data.id, user_id: req.rlsCtx.userId });
      ok(res, result);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /runs/:id/finalize ───────────────────────────────────────────────────
hrPayrollRouter.post('/runs/:id/finalize', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid run id.'); return; }

  const bp = FinalizeSchema.safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const glAccounts = bp.data;

  try {
    const client = await commercialPool.connect();
    try {
      const run = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE hr_payroll_runs SET status = 'FINALIZED', pay_date = $1, updated_at = now()
           WHERE id = $2 AND status = 'DRAFT' RETURNING *`,
          [glAccounts.pay_date, pp.data.id],
        ).then((r) => r.rows[0] ?? null),
      );
      if (!run) { err(res, 404, 'NOT_FOUND', 'Payroll run not found or not in DRAFT status.'); return; }

      logger.info({ entity: 'HR', action: 'PAYROLL_FINALIZED', run_id: pp.data.id, user_id: req.rlsCtx.userId });

      // Non-blocking GL posting
      const { tenantId } = req.rlsCtx;
      const periodLabel = `${MONTH_NAMES[(run.period_month as number) - 1]} ${run.period_year}`;
      void postPayrollGlEntry({
        payrollRunId:                  run.id as string,
        periodLabel,
        runDate:                       (run.pay_date as string | undefined) ?? glAccounts.pay_date,
        ownerEntityId:                 tenantId,
        rlsCtx:                        req.rlsCtx,
        totalGrossTtd:                 parseFloat(String(run.total_gross_ttd ?? 0)),
        totalNetTtd:                   parseFloat(String(run.total_net_ttd ?? 0)),
        totalNisEmployeeTtd:           parseFloat(String(run.total_nis_employee_ttd ?? 0)),
        totalNisEmployerTtd:           parseFloat(String(run.total_nis_employer_ttd ?? 0)),
        totalPayeTtd:                  parseFloat(String(run.total_paye_ttd ?? 0)),
        totalHealthSurchargeTtd:       parseFloat(String(run.total_health_surcharge_ttd ?? 0)),
        salaryExpenseAccountId:        glAccounts.salary_expense_account_id,
        nisExpenseAccountId:           glAccounts.nis_expense_account_id,
        salariesPayableAccountId:      glAccounts.salaries_payable_account_id,
        nisPayableAccountId:           glAccounts.nis_payable_account_id,
        payePayableAccountId:          glAccounts.paye_payable_account_id,
        healthSurchargePayableAccountId: glAccounts.health_surcharge_payable_account_id,
      });

      ok(res, run);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /runs/:id/entries/:entryId ─────────────────────────────────────────
const UpdateEntrySchema = z.object({
  base_salary_ttd:      z.number().min(0).optional(),
  overtime_hours:       z.number().min(0).optional(),
  overtime_rate_ttd:    z.number().min(0).optional(),
  bonus_ttd:            z.number().min(0).optional(),
  other_allowances_ttd: z.number().min(0).optional(),
  other_deductions_ttd: z.number().min(0).optional(),
  unpaid_leave_days:    z.number().min(0).optional(),
  status:               z.enum(['INCLUDED','EXCLUDED']).optional(),
  notes:                z.string().max(1000).optional(),
}).strict();

hrPayrollRouter.patch('/runs/:id/entries/:entryId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = RunEntryParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid ids.'); return; }

  const bp = UpdateEntrySchema.safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const upd = bp.data;
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  const fields: Array<[string, unknown]> = [
    ['base_salary_ttd', upd.base_salary_ttd],
    ['overtime_hours', upd.overtime_hours], ['overtime_rate_ttd', upd.overtime_rate_ttd],
    ['bonus_ttd', upd.bonus_ttd], ['other_allowances_ttd', upd.other_allowances_ttd],
    ['other_deductions_ttd', upd.other_deductions_ttd],
    ['unpaid_leave_days', upd.unpaid_leave_days],
    ['status', upd.status], ['notes', upd.notes],
  ];
  for (const [col, val] of fields) {
    if (val !== undefined) sets.push(`${col} = ${push(val)}`);
  }

  // Recalculate overtime_pay_ttd if hours or rate changed
  if (upd.overtime_hours !== undefined || upd.overtime_rate_ttd !== undefined) {
    sets.push(`overtime_pay_ttd = COALESCE(${push(upd.overtime_hours ?? null)}, overtime_hours) * COALESCE(${push(upd.overtime_rate_ttd ?? null)}, overtime_rate_ttd)`);
  }
  sets.push(`updated_at = now()`);
  if (sets.length === 1) { err(res, 400, 'NO_CHANGES', 'No fields to update.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE hr_payroll_entries SET ${sets.join(', ')}
           WHERE id = ${push(pp.data.entryId)} AND payroll_run_id = ${push(pp.data.id)} RETURNING *`,
          params,
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Payroll entry not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /runs/:id/payslip/:employeeId ─────────────────────────────────────────
hrPayrollRouter.get('/runs/:id/payslip/:employeeId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = SlipParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid ids.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const data = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const run = await c.query(`SELECT * FROM hr_payroll_runs WHERE id = $1`, [pp.data.id])
          .then((r) => r.rows[0] ?? null);
        if (!run) return null;

        const entry = await c.query(`
          SELECT pe.*,
                 e.first_name, e.last_name, e.employee_number,
                 e.nis_number, e.birs_tax_id,
                 e.bank_name, e.bank_branch, e.account_number, e.account_type,
                 e.pay_frequency,
                 p.name AS position_name,
                 d.name AS department_name,
                 COALESCE(
                   (SELECT json_agg(di.*) FROM hr_payroll_deduction_items di WHERE di.payroll_entry_id = pe.id),
                   '[]'
                 ) AS deduction_items
          FROM hr_payroll_entries pe
          JOIN hr_employees   e ON e.id = pe.employee_id
          LEFT JOIN hr_positions   p ON p.id = e.position_id
          LEFT JOIN hr_departments d ON d.id = e.department_id
          WHERE pe.payroll_run_id = $1 AND pe.employee_id = $2
        `, [pp.data.id, pp.data.employeeId]).then((r) => r.rows[0] ?? null);

        if (!entry) return null;
        return { run, entry };
      });

      if (!data) { err(res, 404, 'NOT_FOUND', 'Payslip not found.'); return; }
      ok(res, data);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
