/**
 * Non-blocking GL journal entry posting for payroll runs.
 * Mirrors the vms-disposal pattern: fire-and-forget, familyPool for GL write,
 * commercialPool for hr_payroll_runs.journal_entry_id writeback.
 *
 * Accounting entry:
 *   Dr  Salary Expense           (total gross)
 *   Dr  NIS Employer Expense     (employer NIS contribution)
 *   Cr  Salaries Payable / Bank  (total net pay)
 *   Cr  NIS Payable              (employee NIS + employer NIS)
 *   Cr  PAYE Payable             (withholding tax)
 *   Cr  Health Surcharge Payable (total health surcharge)
 *
 * If any GL account ID is absent the entry is skipped gracefully.
 */

import { familyPool, commercialPool } from '../db/index';
import { withOwnerRLS, withTenantRLS, type RLSContext } from '../middleware/rls';
import { logger } from './logger';

export interface PayrollGlArgs {
  payrollRunId:               string;
  periodLabel:                string;   // e.g. "May 2026"
  runDate:                    string;   // YYYY-MM-DD
  ownerEntityId:              string;
  rlsCtx:                     RLSContext;

  // Amounts
  totalGrossTtd:              number;
  totalNetTtd:                number;
  totalNisEmployeeTtd:        number;
  totalNisEmployerTtd:        number;
  totalPayeTtd:               number;
  totalHealthSurchargeTtd:    number;

  // GL account IDs (from entity's Chart of Accounts — optional; skip if absent)
  salaryExpenseAccountId?:    string;
  nisExpenseAccountId?:       string;
  salariesPayableAccountId?:  string;
  nisPayableAccountId?:       string;
  payePayableAccountId?:      string;
  healthSurchargePayableAccountId?: string;
}

export async function postPayrollGlEntry(args: PayrollGlArgs): Promise<void> {
  const {
    payrollRunId, periodLabel, runDate, ownerEntityId, rlsCtx,
    totalGrossTtd, totalNetTtd, totalNisEmployeeTtd,
    totalNisEmployerTtd, totalPayeTtd, totalHealthSurchargeTtd,
    salaryExpenseAccountId, nisExpenseAccountId,
    salariesPayableAccountId, nisPayableAccountId,
    payePayableAccountId, healthSurchargePayableAccountId,
  } = args;
  const { ownerId, userId } = rlsCtx;

  // Need at least salary expense + salaries payable to post a meaningful entry
  if (!salaryExpenseAccountId || !salariesPayableAccountId) {
    logger.warn({ entity: 'HR', action: 'PAYROLL_GL_SKIPPED', payroll_run_id: payrollRunId,
      reason: 'salary_expense or salaries_payable GL account not configured' });
    return;
  }

  const familyClient = await familyPool.connect();
  try {
    const jeId = await withOwnerRLS(familyClient, rlsCtx, async (c) => {
      const description   = `Payroll run — ${periodLabel}`;
      const idempotencyKey = `payroll_run_${payrollRunId}`;

      type Line = { accountId: string; debit: number; credit: number; label: string };
      const lines: Line[] = [];

      // Debit: Salary Expense (total gross including employer NIS cost)
      const totalEmployerCost = totalGrossTtd + totalNisEmployerTtd;
      lines.push({
        accountId: salaryExpenseAccountId,
        debit:     totalGrossTtd,
        credit:    0,
        label:     `Gross salaries — ${periodLabel}`,
      });

      // Debit: NIS Employer Expense (if account provided)
      if (nisExpenseAccountId && totalNisEmployerTtd > 0) {
        lines.push({
          accountId: nisExpenseAccountId,
          debit:     totalNisEmployerTtd,
          credit:    0,
          label:     `NIS employer contribution — ${periodLabel}`,
        });
      }

      // Credit: Salaries Payable (net pay to employees)
      lines.push({
        accountId: salariesPayableAccountId,
        debit:     0,
        credit:    totalNetTtd,
        label:     `Net pay to employees — ${periodLabel}`,
      });

      // Credit: NIS Payable (employee + employer NIS)
      const totalNis = totalNisEmployeeTtd + (nisExpenseAccountId ? totalNisEmployerTtd : 0);
      if (nisPayableAccountId && totalNis > 0) {
        lines.push({
          accountId: nisPayableAccountId,
          debit:     0,
          credit:    nisExpenseAccountId ? totalNis : totalNisEmployeeTtd,
          label:     `NIS payable — ${periodLabel}`,
        });
      }

      // Credit: PAYE Payable
      if (payePayableAccountId && totalPayeTtd > 0) {
        lines.push({
          accountId: payePayableAccountId,
          debit:     0,
          credit:    totalPayeTtd,
          label:     `PAYE withholding — ${periodLabel}`,
        });
      }

      // Credit: Health Surcharge Payable
      if (healthSurchargePayableAccountId && totalHealthSurchargeTtd > 0) {
        lines.push({
          accountId: healthSurchargePayableAccountId,
          debit:     0,
          credit:    totalHealthSurchargeTtd,
          label:     `Health surcharge — ${periodLabel}`,
        });
      }

      const totalDebit  = lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

      const je = await c.query(
        `INSERT INTO fin_journal_entries
           (owner_id, owner_entity_id, entry_date, description,
            status, source, source_id, currency,
            total_debit_ttd, total_credit_ttd,
            idempotency_key, posted_at, posted_by)
         VALUES ($1,$2,$3,$4,'POSTED','PAYROLL',$5,'TTD',$6,$7,$8,now(),$9)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [ownerId, ownerEntityId, runDate, description,
         payrollRunId,
         totalDebit.toFixed(2), totalCredit.toFixed(2),
         idempotencyKey, userId],
      );
      if (je.rows.length === 0) return null;

      const newJeId = je.rows[0].id as string;

      await Promise.all(lines.map((l, i) =>
        c.query(
          `INSERT INTO fin_journal_entry_lines
             (owner_id, journal_entry_id, gl_account_id, line_number,
              description, debit_ttd, credit_ttd, currency)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'TTD')`,
          [ownerId, newJeId, l.accountId, i + 1, l.label,
           l.debit.toFixed(2), l.credit.toFixed(2)],
        ),
      ));

      return newJeId;
    });

    if (!jeId) return;

    // Write JE reference back onto the payroll run (best-effort)
    const updateClient = await commercialPool.connect();
    try {
      await withTenantRLS(updateClient, rlsCtx, (c) =>
        c.query(
          `UPDATE hr_payroll_runs SET journal_entry_id = $1, updated_at = now() WHERE id = $2`,
          [jeId, payrollRunId],
        ),
      );
    } finally { updateClient.release(); }

    logger.info({ entity: 'HR', action: 'PAYROLL_GL_POSTED',
      payroll_run_id: payrollRunId, journal_entry_id: jeId });
  } catch (e: unknown) {
    logger.warn({ entity: 'HR', action: 'PAYROLL_GL_POST_FAILED',
      payroll_run_id: payrollRunId, error: (e as Error).message });
  } finally {
    familyClient.release();
  }
}
