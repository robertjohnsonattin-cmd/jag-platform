// Accountant export endpoints — read-only views optimised for accountant review.
//
// All endpoints return JSON. The UI layer handles CSV serialisation.
// These endpoints are accessible to:
//   - Owner (Robert) — always
//   - Auditor portal (jag_auditor Keycloak role) — GET only, enforced by auditorGate
//
// GET /finance/export/trial-balance          ?period_year=&period_month=
// GET /finance/export/gl-entries             ?from=&to=&status=&entity_id=&page=&limit=
// GET /finance/export/expenses               ?from=&to=&status=&page=&limit=
// GET /finance/export/insurance              (policies + current premium status)
// GET /finance/export/insurance/premiums     ?from=&to=&status=
// GET /finance/export/insurance/claims       ?status=
// GET /finance/export/intercompany           ?from=&to=&status=

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { ok, err } from '../../lib/response';

export const exportRouter = Router();

// ── Shared helpers ────────────────────────────────────────────────────────────

const DateParam  = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const YearParam  = z.coerce.number().int().min(2020).max(2099).optional();
const MonthParam = z.coerce.number().int().min(1).max(12).optional();
const PageParam  = z.coerce.number().int().min(1).default(1);
const LimitParam = z.coerce.number().int().min(1).max(500).default(100);

// ── Trial balance ─────────────────────────────────────────────────────────────
// Debit/credit totals per GL account for a given period (or all time if omitted).

const TrialBalanceQuery = z.object({
  period_year:  YearParam,
  period_month: MonthParam,
  entity_id:    z.string().uuid().optional(),
}).strict();

exportRouter.get('/trial-balance', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = TrialBalanceQuery.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { period_year, period_month, entity_id } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [`je.status = 'POSTED'`];
        if (period_year)  where.push(`je.period_year  = ${push(period_year)}`);
        if (period_month) where.push(`je.period_month = ${push(period_month)}`);
        if (entity_id)    where.push(`ga.owner_entity_id = ${push(entity_id)}`);

        return c.query(
          `SELECT
             ga.account_code,
             ga.account_name,
             ga.account_type,
             ga.normal_balance,
             ga.owner_entity_id,
             COALESCE(SUM(jel.debit_ttd),  0) AS total_debit_ttd,
             COALESCE(SUM(jel.credit_ttd), 0) AS total_credit_ttd,
             COALESCE(SUM(jel.debit_ttd),  0) - COALESCE(SUM(jel.credit_ttd), 0) AS net_ttd,
             COUNT(DISTINCT je.id)::int         AS entry_count
           FROM  fin_gl_accounts ga
           LEFT JOIN fin_journal_entry_lines jel ON jel.gl_account_id = ga.id
           LEFT JOIN fin_journal_entries     je  ON je.id = jel.journal_entry_id
             AND ${where.join(' AND ')}
           WHERE ga.is_active = true
           GROUP BY ga.id, ga.account_code, ga.account_name, ga.account_type,
                    ga.normal_balance, ga.owner_entity_id
           ORDER BY ga.account_code`,
          params,
        ).then(r => r.rows);
      });

      ok(res, {
        period_year:  period_year  ?? null,
        period_month: period_month ?? null,
        entity_id:    entity_id    ?? null,
        accounts:     rows,
        generated_at: new Date().toISOString(),
      });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GL journal entries ────────────────────────────────────────────────────────

const GlEntriesQuery = z.object({
  from:      DateParam,
  to:        DateParam,
  status:    z.enum(['DRAFT','POSTED','VOID']).optional(),
  entity_id: z.string().uuid().optional(),
  page:      PageParam,
  limit:     LimitParam,
}).strict();

exportRouter.get('/gl-entries', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = GlEntriesQuery.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { from, to, status, entity_id, page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const client = await familyPool.connect();
    try {
      const { entries, total } = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (from)      where.push(`je.entry_date >= ${push(from)}`);
        if (to)        where.push(`je.entry_date <= ${push(to)}`);
        if (status)    where.push(`je.status = ${push(status)}`);
        if (entity_id) where.push(`je.owner_entity_id = ${push(entity_id)}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const countResult = await c.query(
          `SELECT COUNT(*)::int AS total FROM fin_journal_entries je ${clause}`, params
        );
        params.push(limit, offset);
        const dataResult = await c.query(
          `SELECT
             je.id, je.entry_date, je.period_year, je.period_month,
             je.description, je.status, je.entry_source, je.owner_entity_id,
             je.currency, je.total_debit_ttd, je.total_credit_ttd,
             je.created_at, je.posted_at, je.reference_number,
             json_agg(json_build_object(
               'id',             jel.id,
               'account_code',   ga.account_code,
               'account_name',   ga.account_name,
               'account_type',   ga.account_type,
               'debit_amount',   jel.debit_amount,
               'credit_amount',  jel.credit_amount,
               'debit_ttd',      jel.debit_ttd,
               'credit_ttd',     jel.credit_ttd,
               'description',    jel.description
             ) ORDER BY jel.line_number) AS lines
           FROM fin_journal_entries je
           JOIN fin_journal_entry_lines jel ON jel.journal_entry_id = je.id
           JOIN fin_gl_accounts         ga  ON ga.id = jel.gl_account_id
           ${clause}
           GROUP BY je.id
           ORDER BY je.entry_date DESC, je.created_at DESC
           LIMIT ${push(limit)} OFFSET ${push(offset)}`,
          params
        );
        return { entries: dataResult.rows, total: countResult.rows[0].total };
      });

      ok(res, { entries, total, page, limit, pages: Math.ceil(total / limit) });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Expenses ──────────────────────────────────────────────────────────────────

const ExpensesQuery = z.object({
  from:   DateParam,
  to:     DateParam,
  status: z.enum(['DRAFT','SUBMITTED','APPROVED','REJECTED']).optional(),
  page:   PageParam,
  limit:  LimitParam,
}).strict();

exportRouter.get('/expenses', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ExpensesQuery.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { from, to, status, page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const client = await familyPool.connect();
    try {
      const { expenses, total } = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (from)   where.push(`e.expense_date >= ${push(from)}`);
        if (to)     where.push(`e.expense_date <= ${push(to)}`);
        if (status) where.push(`e.status = ${push(status)}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const countResult = await c.query(
          `SELECT COUNT(*)::int AS total FROM fin_expenses e ${clause}`, params
        );
        params.push(limit, offset);
        const dataResult = await c.query(
          `SELECT
             e.id, e.expense_date, e.description, e.category, e.status,
             e.amount, e.currency, e.amount_ttd, e.fx_rate_used,
             e.payment_method, e.owner_entity_id,
             e.submitted_at, e.approved_at, e.rejection_reason,
             e.journal_entry_id, e.created_at,
             da.account_code AS debit_account_code,
             da.account_name AS debit_account_name
           FROM fin_expenses e
           LEFT JOIN fin_gl_accounts da ON da.id = e.gl_debit_account_id
           ${clause}
           ORDER BY e.expense_date DESC, e.created_at DESC
           LIMIT ${push(limit)} OFFSET ${push(offset)}`,
          params
        );
        return { expenses: dataResult.rows, total: countResult.rows[0].total };
      });

      ok(res, { expenses, total, page, limit, pages: Math.ceil(total / limit) });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Insurance summary ─────────────────────────────────────────────────────────

exportRouter.get('/insurance', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT
             p.id, p.policy_number, p.insurer_name, p.broker_name,
             p.policy_type, p.insured_asset_type, p.coverage_amount_ttd,
             p.premium_amount_ttd, p.premium_frequency,
             p.start_date, p.expiry_date, p.renewal_alert_days, p.is_active,
             p.owner_entity_id,
             -- Premium summary
             COUNT(prem.id)::int                                                           AS total_premiums,
             COUNT(prem.id) FILTER (WHERE prem.status = 'DUE')::int                       AS due_premiums,
             COUNT(prem.id) FILTER (WHERE prem.status = 'OVERDUE')::int                   AS overdue_premiums,
             COALESCE(SUM(prem.amount_ttd) FILTER (WHERE prem.status = 'PAID'), 0)        AS total_paid_ttd,
             -- Claims summary
             COUNT(clm.id)::int                                                            AS total_claims,
             COUNT(clm.id) FILTER (WHERE clm.status NOT IN ('SETTLED','REJECTED','WITHDRAWN'))::int AS open_claims,
             COALESCE(SUM(clm.claimed_amount_ttd),  0)                                    AS total_claimed_ttd,
             COALESCE(SUM(clm.settled_amount_ttd), 0)                                     AS total_settled_ttd
           FROM fin_insurance_policies p
           LEFT JOIN fin_insurance_premiums prem ON prem.policy_id = p.id
           LEFT JOIN fin_insurance_claims   clm  ON clm.policy_id  = p.id
           GROUP BY p.id
           ORDER BY p.expiry_date ASC`
        ).then(r => r.rows)
      );
      ok(res, { policies: rows, generated_at: new Date().toISOString() });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// GET /insurance/premiums
const PremsQuery = z.object({
  from:   DateParam,
  to:     DateParam,
  status: z.enum(['DUE','PAID','OVERDUE','WAIVED']).optional(),
}).strict();

exportRouter.get('/insurance/premiums', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PremsQuery.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { from, to, status } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (from)   where.push(`prem.due_date >= ${push(from)}`);
        if (to)     where.push(`prem.due_date <= ${push(to)}`);
        if (status) where.push(`prem.status = ${push(status)}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

        return c.query(
          `SELECT
             prem.id, prem.due_date, prem.paid_date, prem.amount_ttd,
             prem.status, prem.payment_method,
             p.policy_number, p.insurer_name, p.policy_type, p.owner_entity_id
           FROM fin_insurance_premiums prem
           JOIN fin_insurance_policies p ON p.id = prem.policy_id
           ${clause}
           ORDER BY prem.due_date ASC`,
          params
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// GET /insurance/claims
const ClaimsQuery = z.object({
  status: z.enum(['SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','SETTLED','WITHDRAWN']).optional(),
}).strict();

exportRouter.get('/insurance/claims', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ClaimsQuery.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { status } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (status) where.push(`clm.status = ${push(status)}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

        return c.query(
          `SELECT
             clm.id, clm.claim_reference, clm.incident_date, clm.claim_date,
             clm.description, clm.claimed_amount_ttd, clm.settled_amount_ttd,
             clm.status, clm.settlement_date,
             p.policy_number, p.insurer_name, p.policy_type, p.owner_entity_id
           FROM fin_insurance_claims clm
           JOIN fin_insurance_policies p ON p.id = clm.policy_id
           ${clause}
           ORDER BY clm.claim_date DESC`,
          params
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Intercompany charges ──────────────────────────────────────────────────────

const IccQuery = z.object({
  from:   DateParam,
  to:     DateParam,
  status: z.enum(['DRAFT','POSTED','ELIMINATED']).optional(),
}).strict();

exportRouter.get('/intercompany', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = IccQuery.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { from, to, status } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (from)   where.push(`ic.charge_date >= ${push(from)}`);
        if (to)     where.push(`ic.charge_date <= ${push(to)}`);
        if (status) where.push(`ic.status = ${push(status)}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

        return c.query(
          `SELECT
             ic.id, ic.charge_date, ic.description, ic.charge_type,
             ic.amount_ttd, ic.currency, ic.status,
             ic.from_entity_id, ic.to_entity_id,
             ic.from_gl_entry_id, ic.to_gl_entry_id,
             ic.created_at
           FROM fin_intercompany_charges ic
           ${clause}
           ORDER BY ic.charge_date DESC`,
          params
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
