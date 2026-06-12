// Financial Statements
//
// GET /api/v1/finance/reports/income-statement?owner_entity_id=&date_from=&date_to=
// GET /api/v1/finance/reports/balance-sheet?owner_entity_id=&as_of_date=
// GET /api/v1/finance/reports/cash-flow?owner_entity_id=&date_from=&date_to=

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const reportsRouter = Router();

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today   = () => new Date().toISOString().slice(0, 10);

// ── Income Statement ──────────────────────────────────────────────────────────

const IncomeStatementQuery = z.object({
  owner_entity_id: z.string().uuid().optional(),
  date_from:       DateStr,
  date_to:         DateStr,
}).strict();

reportsRouter.get('/income-statement', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = IncomeStatementQuery.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'date_from and date_to are required (YYYY-MM-DD).'); return; }
    const { owner_entity_id, date_from, date_to } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [date_from, date_to];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        const acctWhere = [
          `ga.account_type IN ('REVENUE','EXPENSE','OTHER_INCOME','OTHER_EXPENSE')`,
          `ga.is_active = true`,
        ];
        const jeExtra: string[] = [];
        if (owner_entity_id) {
          acctWhere.push(`ga.owner_entity_id = ${push(owner_entity_id)}`);
          jeExtra.push(`AND je.owner_entity_id = ${push(owner_entity_id)}`);
        }

        return c.query(
          `WITH period_lines AS (
             SELECT jel.gl_account_id, jel.debit_ttd, jel.credit_ttd
             FROM   fin_journal_entry_lines jel
             JOIN   fin_journal_entries je ON je.id = jel.journal_entry_id
               AND  je.status = 'POSTED'
               AND  je.entry_date BETWEEN $1 AND $2
               ${jeExtra.join(' ')}
           )
           SELECT ga.id, ga.account_code, ga.account_name, ga.account_type,
                  COALESCE(SUM(pl.debit_ttd),  0)::NUMERIC(18,2) AS total_debit,
                  COALESCE(SUM(pl.credit_ttd), 0)::NUMERIC(18,2) AS total_credit
           FROM   fin_gl_accounts ga
           LEFT   JOIN period_lines pl ON pl.gl_account_id = ga.id
           WHERE  ${acctWhere.join(' AND ')}
           GROUP  BY ga.id, ga.account_code, ga.account_name, ga.account_type
           ORDER  BY ga.account_code`,
          params,
        ).then(r => r.rows);
      });

      type GlRow = { id: string; account_code: string; account_name: string; account_type: string; total_debit: string; total_credit: string };

      const revenue:      GlRow[] = [];
      const expenses:     GlRow[] = [];
      const otherIncome:  GlRow[] = [];
      const otherExpense: GlRow[] = [];

      for (const row of rows as GlRow[]) {
        if (row.account_type === 'REVENUE')       revenue.push(row);
        else if (row.account_type === 'EXPENSE')  expenses.push(row);
        else if (row.account_type === 'OTHER_INCOME')  otherIncome.push(row);
        else if (row.account_type === 'OTHER_EXPENSE') otherExpense.push(row);
      }

      const netAmount = (row: GlRow, type: string): number => {
        const c = Number(row.total_credit);
        const d = Number(row.total_debit);
        return (type === 'REVENUE' || type === 'OTHER_INCOME') ? c - d : d - c;
      };

      const mapLine = (arr: GlRow[], type: string) =>
        arr.map(r => ({ id: r.id, account_code: r.account_code, account_name: r.account_name, amount: netAmount(r, type) }));

      const totalRevenue      = revenue.reduce((s, r)      => s + netAmount(r, 'REVENUE'),       0);
      const totalExpenses     = expenses.reduce((s, r)     => s + netAmount(r, 'EXPENSE'),       0);
      const operatingIncome   = totalRevenue - totalExpenses;
      const totalOtherIncome  = otherIncome.reduce((s, r)  => s + netAmount(r, 'OTHER_INCOME'),  0);
      const totalOtherExpense = otherExpense.reduce((s, r) => s + netAmount(r, 'OTHER_EXPENSE'), 0);
      const netIncome         = operatingIncome + totalOtherIncome - totalOtherExpense;

      logger.info({ entity: 'Finance', action: 'REPORT_INCOME_STATEMENT', user_id: req.rlsCtx.ownerId });

      ok(res, {
        period:               { from: date_from, to: date_to },
        owner_entity_id:      owner_entity_id ?? null,
        revenue:              mapLine(revenue,      'REVENUE'),
        total_revenue:        totalRevenue,
        expenses:             mapLine(expenses,     'EXPENSE'),
        total_expenses:       totalExpenses,
        operating_income:     operatingIncome,
        other_income:         mapLine(otherIncome,  'OTHER_INCOME'),
        total_other_income:   totalOtherIncome,
        other_expense:        mapLine(otherExpense, 'OTHER_EXPENSE'),
        total_other_expense:  totalOtherExpense,
        net_income:           netIncome,
      });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Balance Sheet ─────────────────────────────────────────────────────────────

const BalanceSheetQuery = z.object({
  owner_entity_id: z.string().uuid().optional(),
  as_of_date:      DateStr.optional(),
}).strict();

reportsRouter.get('/balance-sheet', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = BalanceSheetQuery.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { owner_entity_id } = parsed.data;
    const asOf = parsed.data.as_of_date ?? today();

    const client = await familyPool.connect();
    try {
      const result = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const params: unknown[] = [asOf];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        const acctWhere = [`ga.account_type IN ('ASSET','LIABILITY','EQUITY')`, `ga.is_active = true`];
        const jeExtra: string[] = [];
        if (owner_entity_id) {
          acctWhere.push(`ga.owner_entity_id = ${push(owner_entity_id)}`);
          jeExtra.push(`AND je.owner_entity_id = ${push(owner_entity_id)}`);
        }

        const glQ = c.query(
          `WITH cum AS (
             SELECT jel.gl_account_id, jel.debit_ttd, jel.credit_ttd
             FROM   fin_journal_entry_lines jel
             JOIN   fin_journal_entries je ON je.id = jel.journal_entry_id
               AND  je.status = 'POSTED'
               AND  je.entry_date <= $1
               ${jeExtra.join(' ')}
           )
           SELECT ga.id, ga.account_code, ga.account_name, ga.account_type, ga.normal_balance,
                  COALESCE(SUM(c.debit_ttd),  0)::NUMERIC(18,2) AS total_debit,
                  COALESCE(SUM(c.credit_ttd), 0)::NUMERIC(18,2) AS total_credit
           FROM   fin_gl_accounts ga
           LEFT   JOIN cum c ON c.gl_account_id = ga.id
           WHERE  ${acctWhere.join(' AND ')}
           GROUP  BY ga.id, ga.account_code, ga.account_name, ga.account_type, ga.normal_balance
           ORDER  BY ga.account_code`,
          params,
        ).then(r => r.rows);

        // Standalone liquid assets from fin_accounts
        const bankParams: unknown[] = [`is_active = true`];
        const bankExtra = owner_entity_id ? ` AND owner_entity_id = $2` : '';
        const bankArgs  = owner_entity_id ? [true, owner_entity_id] : [true];
        const bankQ = c.query(
          `SELECT account_type, COALESCE(SUM(current_balance), 0)::NUMERIC(18,2) AS total
           FROM fin_accounts WHERE is_active = $1${bankExtra}
           GROUP BY account_type`,
          bankArgs,
        ).then(r => r.rows);

        // Investments
        const invArgs  = owner_entity_id ? [owner_entity_id] : [];
        const invWhere = owner_entity_id ? `WHERE owner_entity_id = $1` : '';
        const invQ = c.query(
          `SELECT COALESCE(SUM(current_value_ttd), 0)::NUMERIC(18,2) AS total FROM fin_investments ${invWhere}`,
          invArgs,
        ).then(r => r.rows[0]);

        // Loans
        const loanArgs  = owner_entity_id ? [owner_entity_id] : [];
        const loanWhere = owner_entity_id ? `WHERE owner_entity_id = $1` : '';
        const loanQ = c.query(
          `SELECT COALESCE(SUM(outstanding_balance), 0)::NUMERIC(18,2) AS total FROM fin_mortgages_loans ${loanWhere}`,
          loanArgs,
        ).then(r => r.rows[0]);

        return Promise.all([glQ, bankQ, invQ, loanQ]);
      });

      const [glRows, bankRows, invRow, loanRow] = result;

      type GlRow = { id: string; account_code: string; account_name: string; account_type: string; normal_balance: string; total_debit: string; total_credit: string };

      const assets:      GlRow[] = [];
      const liabilities: GlRow[] = [];
      const equity:      GlRow[] = [];

      for (const row of glRows as GlRow[]) {
        if (row.account_type === 'ASSET')           assets.push(row);
        else if (row.account_type === 'LIABILITY')  liabilities.push(row);
        else if (row.account_type === 'EQUITY')     equity.push(row);
      }

      const glBalance = (row: GlRow): number => {
        const d = Number(row.total_debit);
        const cr = Number(row.total_credit);
        return row.normal_balance === 'DEBIT' ? d - cr : cr - d;
      };

      const mapGl = (arr: GlRow[]) =>
        arr.map(r => ({ id: r.id, account_code: r.account_code, account_name: r.account_name, balance: glBalance(r) }));

      const totalGlAssets      = assets.reduce((s, r)      => s + glBalance(r), 0);
      const totalGlLiabilities = liabilities.reduce((s, r) => s + glBalance(r), 0);
      const totalGlEquity      = equity.reduce((s, r)      => s + glBalance(r), 0);

      // Standalone totals
      type BankRow = { account_type: string; total: string };
      const LIQUID_TYPES = new Set(['CHEQUING','SAVINGS','CURRENT','CALL_DEPOSIT']);
      const CREDIT_TYPES = new Set(['CREDIT_CARD','LINE_OF_CREDIT']);

      const bankLiquid  = (bankRows as BankRow[]).filter(r => LIQUID_TYPES.has(r.account_type)).reduce((s, r) => s + Number(r.total), 0);
      const creditLiab  = (bankRows as BankRow[]).filter(r => CREDIT_TYPES.has(r.account_type) && Number(r.total) < 0).reduce((s, r) => s + Math.abs(Number(r.total)), 0);
      const investments = Number(invRow?.total ?? 0);
      const loans       = Number(loanRow?.total ?? 0);

      logger.info({ entity: 'Finance', action: 'REPORT_BALANCE_SHEET', user_id: req.rlsCtx.ownerId });

      ok(res, {
        as_of:           asOf,
        owner_entity_id: owner_entity_id ?? null,
        gl: {
          assets:              mapGl(assets),
          total_assets:        totalGlAssets,
          liabilities:         mapGl(liabilities),
          total_liabilities:   totalGlLiabilities,
          equity:              mapGl(equity),
          total_equity:        totalGlEquity,
          check:               totalGlAssets - totalGlLiabilities - totalGlEquity,
        },
        standalone: {
          bank_liquid:      bankLiquid,
          investments,
          total_assets:     bankLiquid + investments,
          credit_liabilities: creditLiab,
          loans,
          total_liabilities:  creditLiab + loans,
          net_equity:       (bankLiquid + investments) - (creditLiab + loans),
        },
      });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Cash Flow Statement ───────────────────────────────────────────────────────

const CashFlowQuery = z.object({
  owner_entity_id: z.string().uuid().optional(),
  date_from:       DateStr,
  date_to:         DateStr,
}).strict();

const OPERATING_CATS = new Set([
  'SALARY','DIVIDEND','RENTAL_INCOME','INTEREST_INCOME',
  'OPERATING_EXPENSE','PAYROLL','TAX_PAYMENT',
  'PERSONAL_EXPENSE','UTILITIES','INSURANCE','ENTERTAINMENT',
  'TRAVEL','MEDICAL','EDUCATION','CHARITY','UNCLASSIFIED',
]);
const INVESTING_CATS  = new Set(['INVESTMENT_PURCHASE','INVESTMENT_SALE']);
const FINANCING_CATS  = new Set(['LOAN_REPAYMENT','TRANSFER_IN','TRANSFER_OUT']);

reportsRouter.get('/cash-flow', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CashFlowQuery.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'date_from and date_to are required (YYYY-MM-DD).'); return; }
    const { owner_entity_id, date_from, date_to } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [date_from, date_to];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where = [`t.transaction_date BETWEEN $1 AND $2`];
        if (owner_entity_id) where.push(`a.owner_entity_id = ${push(owner_entity_id)}`);

        return c.query(
          `SELECT t.category,
                  COUNT(*)::int AS txn_count,
                  COALESCE(SUM(COALESCE(t.amount_ttd, t.amount)), 0)::NUMERIC(18,2) AS net_amount,
                  COALESCE(SUM(CASE WHEN COALESCE(t.amount_ttd, t.amount) > 0 THEN COALESCE(t.amount_ttd, t.amount) ELSE 0 END), 0)::NUMERIC(18,2) AS inflows,
                  COALESCE(SUM(CASE WHEN COALESCE(t.amount_ttd, t.amount) < 0 THEN COALESCE(t.amount_ttd, t.amount) ELSE 0 END), 0)::NUMERIC(18,2) AS outflows
           FROM fin_transactions t
           JOIN fin_accounts a ON a.id = t.account_id
           WHERE ${where.join(' AND ')}
           GROUP BY t.category
           ORDER BY t.category`,
          params,
        ).then(r => r.rows);
      });

      type CfRow   = { category: string; txn_count: number; net_amount: string; inflows: string; outflows: string };
      type Activity = { category: string; txn_count: number; inflows: number; outflows: number; net: number };

      const operating: Activity[] = [];
      const investing: Activity[] = [];
      const financing: Activity[] = [];

      for (const r of rows as CfRow[]) {
        const item: Activity = {
          category:  r.category,
          txn_count: r.txn_count,
          inflows:   Number(r.inflows),
          outflows:  Number(r.outflows),
          net:       Number(r.net_amount),
        };
        if (INVESTING_CATS.has(r.category))  investing.push(item);
        else if (FINANCING_CATS.has(r.category)) financing.push(item);
        else operating.push(item);
      }

      const sum = (arr: Activity[]) => ({
        inflows:  arr.reduce((s, r) => s + r.inflows,  0),
        outflows: arr.reduce((s, r) => s + r.outflows, 0),
        net:      arr.reduce((s, r) => s + r.net,      0),
      });

      const opTot  = sum(operating);
      const invTot = sum(investing);
      const finTot = sum(financing);

      logger.info({ entity: 'Finance', action: 'REPORT_CASH_FLOW', user_id: req.rlsCtx.ownerId });

      ok(res, {
        period:          { from: date_from, to: date_to },
        owner_entity_id: owner_entity_id ?? null,
        operating:       { activities: operating,  ...opTot },
        investing:       { activities: investing,  ...invTot },
        financing:       { activities: financing,  ...finTot },
        net_change:      opTot.net + invTot.net + finTot.net,
      });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
