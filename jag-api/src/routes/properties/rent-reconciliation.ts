// GET    /api/v1/properties/rent-reconciliation/candidates  — unreconciled bank credits + open rent periods + suggestions
// GET    /api/v1/properties/rent-reconciliation/matches      — existing confirmed links
// POST   /api/v1/properties/rent-reconciliation/match        — link a bank credit to a rent period (link-only)
// POST   /api/v1/properties/rent-reconciliation/auto-match   — auto-link every unambiguous suggestion
// DELETE /api/v1/properties/rent-reconciliation/matches/:id  — remove a link
//
// Phase 1 is LINK-ONLY: creating a match records the reconciliation link and marks
// the bank line reconciled. It does NOT change rent status, generate a receipt, or
// notify the tenant. Reconciliation here is a back-office cross-check that money
// actually landed, run independently of the tenant-confirms-receipt payment flow.
//
// CROSS-DATABASE: bank credits live in jag_family (familyPool), rent periods and the
// match table live in jag_properties (propertiesPool). No SQL JOIN is possible across
// them; candidates are joined in application code, and writes touch each DB in its own
// transaction. Both DBs gate RLS on app.current_owner_id, so withOwnerRLS works on both.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool, familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const rentReconciliationRouter = Router();

const OPEN_STATUSES = ['UPCOMING', 'REMINDER_SENT', 'LATE', 'PARTIAL'];
const AMOUNT_TOLERANCE_TTD = 1.0;
const DATE_TOLERANCE_DAYS  = 5;
const CREDIT_LOOKBACK_DAYS = 180;

interface BankCredit {
  id: string;
  transaction_date: string;
  amount_ttd: number;
  description: string;
  reference_number: string | null;
}
interface OpenPeriod {
  id: string;
  unit_number: string | null;
  tenant_name: string;
  due_date: string;
  amount_due_ttd: number;
  period_year: number;
  period_month: number;
}

function daysBetween(a: string, b: string): number {
  return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
}
function isMatch(credit: BankCredit, period: OpenPeriod): boolean {
  return Math.abs(credit.amount_ttd - period.amount_due_ttd) < AMOUNT_TOLERANCE_TTD
      && daysBetween(credit.transaction_date, period.due_date) <= DATE_TOLERANCE_DAYS;
}

// Reads unreconciled bank credits (family DB) and open rent periods (properties DB).
async function loadCandidates(req: Request): Promise<{ credits: BankCredit[]; periods: OpenPeriod[] }> {
  const famClient = await familyPool.connect();
  let credits: BankCredit[];
  try {
    credits = await withOwnerRLS(famClient, req.rlsCtx, (c) =>
      c.query(
        `SELECT id, transaction_date,
                COALESCE(amount_ttd, amount)::float8 AS amount_ttd,
                description, reference_number
         FROM   fin_transactions
         WHERE  is_reconciled = false
           AND  COALESCE(amount_ttd, amount) > 0
           AND  transaction_date >= (CURRENT_DATE - $1::int)
         ORDER  BY transaction_date DESC
         LIMIT  500`,
        [CREDIT_LOOKBACK_DAYS],
      ).then(r => r.rows as BankCredit[]),
    );
  } finally { famClient.release(); }

  const propClient = await propertiesPool.connect();
  let periods: OpenPeriod[];
  try {
    periods = await withOwnerRLS(propClient, req.rlsCtx, (c) =>
      c.query(
        `SELECT rs.id, u.unit_number, rs.tenant_name, rs.due_date,
                rs.amount_due_ttd::float8 AS amount_due_ttd,
                rs.period_year, rs.period_month
         FROM   prop_rent_schedule rs
         LEFT   JOIN prop_units u ON u.id = rs.unit_id
         WHERE  rs.status = ANY($1)
         ORDER  BY rs.due_date DESC`,
        [OPEN_STATUSES],
      ).then(r => r.rows as OpenPeriod[]),
    );
  } finally { propClient.release(); }

  return { credits, periods };
}

// ── GET /candidates ───────────────────────────────────────────────────────────
rentReconciliationRouter.get('/candidates', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { credits, periods } = await loadCandidates(req);

    const suggestions = credits.flatMap(credit => {
      const hits = periods.filter(p => isMatch(credit, p));
      return hits.map(p => ({
        bank_txn_id: credit.id,
        rent_schedule_id: p.id,
        unambiguous: hits.length === 1,
      }));
    });

    ok(res, { bank_credits: credits, rent_periods: periods, suggestions });
  } catch (e) { next(e); }
});

// ── GET /matches ──────────────────────────────────────────────────────────────
rentReconciliationRouter.get('/matches', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT m.id, m.rent_schedule_id, m.bank_txn_id, m.bank_txn_date,
                  m.bank_amount_ttd, m.bank_description, m.match_type, m.created_at,
                  rs.tenant_name, rs.due_date, rs.amount_due_ttd, u.unit_number
           FROM   prop_rent_bank_matches m
           JOIN   prop_rent_schedule rs ON rs.id = m.rent_schedule_id
           LEFT   JOIN prop_units u ON u.id = rs.unit_id
           ORDER  BY m.created_at DESC`,
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// Shared: create one link. Verifies both sides, writes the properties link, then
// reconciles the bank line in family. If the family write fails after the link is
// committed, the link is compensating-deleted so the two DBs don't drift.
async function createMatch(
  req: Request, rentScheduleId: string, bankTxnId: string, matchType: 'AUTO' | 'MANUAL',
): Promise<{ ok: true; match: Record<string, unknown> } | { ok: false; code: string; message: string }> {
  const ownerId = req.rlsCtx.userId;

  // 1. Verify + snapshot the bank credit (family DB).
  const famClient = await familyPool.connect();
  let credit: BankCredit | null;
  try {
    credit = await withOwnerRLS(famClient, req.rlsCtx, (c) =>
      c.query(
        `SELECT id, transaction_date,
                COALESCE(amount_ttd, amount)::float8 AS amount_ttd,
                description, reference_number
         FROM   fin_transactions
         WHERE  id = $1 AND is_reconciled = false AND COALESCE(amount_ttd, amount) > 0`,
        [bankTxnId],
      ).then(r => (r.rows[0] as BankCredit) ?? null),
    );
  } finally { famClient.release(); }
  if (!credit) return { ok: false, code: 'BANK_TXN_UNAVAILABLE', message: 'Bank transaction not found, not a credit, or already reconciled.' };

  // 2. Verify the rent period is open, then insert the link (properties DB).
  const propClient = await propertiesPool.connect();
  let match: Record<string, unknown> | null = null;
  try {
    match = await withOwnerRLS(propClient, req.rlsCtx, async (c) => {
      const period = await c.query(
        `SELECT id FROM prop_rent_schedule WHERE id = $1 AND status = ANY($2)`,
        [rentScheduleId, OPEN_STATUSES],
      ).then(r => r.rows[0] ?? null);
      if (!period) throw Object.assign(new Error('RENT_PERIOD_UNAVAILABLE'), { known: true });

      return c.query(
        `INSERT INTO prop_rent_bank_matches
           (owner_id, rent_schedule_id, bank_txn_id, bank_txn_date, bank_amount_ttd, bank_description, match_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [ownerId, rentScheduleId, credit!.id, credit!.transaction_date, credit!.amount_ttd, credit!.description, matchType],
      ).then(r => r.rows[0]);
    });
  } catch (e: unknown) {
    if ((e as { known?: boolean }).known) return { ok: false, code: 'RENT_PERIOD_UNAVAILABLE', message: 'Rent period not found or not open.' };
    if ((e as { code?: string }).code === '23505') return { ok: false, code: 'ALREADY_MATCHED', message: 'That bank transaction is already linked to a rent period.' };
    throw e;
  } finally { propClient.release(); }

  // 3. Mark the bank line reconciled (family DB). Compensate on failure so we never
  //    leave a link pointing at a still-unreconciled bank line.
  const famClient2 = await familyPool.connect();
  try {
    await withOwnerRLS(famClient2, req.rlsCtx, (c) =>
      c.query(`UPDATE fin_transactions SET is_reconciled = true, updated_at = now() WHERE id = $1`, [bankTxnId]),
    );
  } catch (e) {
    const undoClient = await propertiesPool.connect();
    try {
      await withOwnerRLS(undoClient, req.rlsCtx, (c) =>
        c.query(`DELETE FROM prop_rent_bank_matches WHERE id = $1`, [(match as Record<string, unknown>).id]),
      );
    } finally { undoClient.release(); }
    logger.error({ entity: 'PROPERTIES', action: 'RECONCILE_COMPENSATED', bank_txn_id: bankTxnId, error: (e as Error).message });
    return { ok: false, code: 'RECONCILE_FAILED', message: 'Could not reconcile the bank line; the link was rolled back. Please retry.' };
  } finally { famClient2.release(); }

  return { ok: true, match: match as Record<string, unknown> };
}

// ── POST /match ───────────────────────────────────────────────────────────────
const MatchSchema = z.object({
  rent_schedule_id: z.string().uuid(),
  bank_txn_id:      z.string().uuid(),
}).strict();

rentReconciliationRouter.post('/match', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = MatchSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'rent_schedule_id and bank_txn_id (UUIDs) are required.'); return; }

    const result = await createMatch(req, parsed.data.rent_schedule_id, parsed.data.bank_txn_id, 'MANUAL');
    if (!result.ok) {
      const status = result.code === 'RECONCILE_FAILED' ? 500 : result.code === 'ALREADY_MATCHED' ? 409 : 422;
      err(res, status, result.code, result.message); return;
    }
    logger.info({ entity: 'PROPERTIES', action: 'RENT_BANK_MATCHED', user_id: req.rlsCtx.userId, record_id: result.match.id, match_type: 'MANUAL' });
    ok(res, result.match, 201);
  } catch (e) { next(e); }
});

// ── POST /auto-match ──────────────────────────────────────────────────────────
// Links every credit that matches exactly ONE open rent period. Credits with zero
// or multiple candidates are left for manual matching.
rentReconciliationRouter.post('/auto-match', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { credits, periods } = await loadCandidates(req);

    let matched = 0, ambiguous = 0, failed = 0;
    for (const credit of credits) {
      const hits = periods.filter(p => isMatch(credit, p));
      if (hits.length !== 1) { if (hits.length > 1) ambiguous++; continue; }
      const result = await createMatch(req, hits[0].id, credit.id, 'AUTO');
      if (result.ok) matched++; else failed++;
    }

    logger.info({ entity: 'PROPERTIES', action: 'RENT_BANK_AUTO_MATCH', user_id: req.rlsCtx.userId, matched, ambiguous, failed });
    ok(res, { matched, ambiguous, failed });
  } catch (e) { next(e); }
});

// ── DELETE /matches/:id ───────────────────────────────────────────────────────
rentReconciliationRouter.delete('/matches/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid match ID.'); return; }
    const { id } = parsed.data;

    // Remove the link (properties), capture the bank_txn_id, then un-reconcile it (family).
    const propClient = await propertiesPool.connect();
    let bankTxnId: string | null;
    try {
      bankTxnId = await withOwnerRLS(propClient, req.rlsCtx, (c) =>
        c.query(`DELETE FROM prop_rent_bank_matches WHERE id = $1 RETURNING bank_txn_id`, [id])
          .then(r => (r.rows[0]?.bank_txn_id as string) ?? null),
      );
    } finally { propClient.release(); }
    if (!bankTxnId) { err(res, 404, 'NOT_FOUND', 'Match not found.'); return; }

    const famClient = await familyPool.connect();
    try {
      await withOwnerRLS(famClient, req.rlsCtx, (c) =>
        c.query(`UPDATE fin_transactions SET is_reconciled = false, updated_at = now() WHERE id = $1`, [bankTxnId]),
      );
    } finally { famClient.release(); }

    logger.info({ entity: 'PROPERTIES', action: 'RENT_BANK_UNMATCHED', user_id: req.rlsCtx.userId, record_id: id });
    ok(res, { id });
  } catch (e) { next(e); }
});
