// GET   /api/v1/nlcb/sessions              — list sessions (date filter)
// POST  /api/v1/nlcb/sessions              — open a new daily session
// GET   /api/v1/nlcb/sessions/:id          — session detail (sales + payouts + summary)
// POST  /api/v1/nlcb/sessions/:id/sales    — record sales for a game (idempotency)
// POST  /api/v1/nlcb/sessions/:id/payouts  — record a prize payout (idempotency)
// PATCH /api/v1/nlcb/sessions/:id/close    — close session with closing float

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const nlcbSessionsRouter = Router();
nlcbSessionsRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const OpenSessionSchema = z.object({
  session_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'session_date must be YYYY-MM-DD'),
  cash_float_open: z.number().min(0),
  notes:           z.string().max(500).optional(),
}).strict();

const AddSalesSchema = z.object({
  game_id:         z.string().uuid(),
  gross_sales:     z.number().min(0),
  idempotency_key: z.string().uuid(),
}).strict();

const AddPayoutSchema = z.object({
  game_id:         z.string().uuid(),
  payout_amount:   z.number().positive(),
  ticket_ref:      z.string().max(100).optional(),
  notes:           z.string().max(500).optional(),
  idempotency_key: z.string().uuid(),
}).strict();

const CloseSessionSchema = z.object({
  cash_float_close: z.number().min(0),
  notes:            z.string().max(500).optional(),
}).strict();

// ── GET /nlcb/sessions ────────────────────────────────────────────────────────

nlcbSessionsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const dateFrom = req.query.date_from as string | undefined;
  const dateTo   = req.query.date_to   as string | undefined;

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (dateFrom) conditions.push(`session_date >= ${push(dateFrom)}`);
        if (dateTo)   conditions.push(`session_date <= ${push(dateTo)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT s.id, s.session_date, s.status, s.cash_float_open, s.cash_float_close,
                  s.opened_at, s.closed_at,
                  COALESCE(SUM(sa.gross_sales), 0)       AS total_sales,
                  COALESCE(SUM(sa.commission_amount), 0) AS total_commission,
                  COALESCE(SUM(p.payout_amount), 0)      AS total_payouts
           FROM nlcb_daily_sessions s
           LEFT JOIN nlcb_sales   sa ON sa.session_id = s.id
           LEFT JOIN nlcb_payouts p  ON p.session_id  = s.id
           ${where}
           GROUP BY s.id
           ORDER BY s.session_date DESC`,
          params,
        ).then((r) => r.rows);
      });
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /nlcb/sessions ───────────────────────────────────────────────────────

nlcbSessionsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = OpenSessionSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const { session_date, cash_float_open, notes } = parsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query(
          `SELECT id FROM nlcb_daily_sessions WHERE tenant_id = $1 AND session_date = $2`,
          [tenantId, session_date],
        );
        if (existing.rows.length > 0) throw Object.assign(new Error('SESSION_EXISTS'), { code: 'SESSION_EXISTS' });

        return c.query(
          `INSERT INTO nlcb_daily_sessions (tenant_id, session_date, opened_by, cash_float_open, notes, last_modified_by)
           VALUES ($1, $2, $3, $4, $5, $3)
           RETURNING id, session_date, status, cash_float_open, opened_at`,
          [tenantId, session_date, userId, cash_float_open, notes ?? null],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'NLCB', action: 'SESSION_OPENED', session_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'SESSION_EXISTS') {
      err(res, 409, 'SESSION_EXISTS', 'A session already exists for this date.');
      return;
    }
    next(e);
  }
});

// ── GET /nlcb/sessions/:id ────────────────────────────────────────────────────

nlcbSessionsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid session id.'); return; }

  const { id } = paramParsed.data;

  try {
    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const sessionRes = await c.query(
          `SELECT id, session_date, status, cash_float_open, cash_float_close,
                  opened_by, opened_at, closed_at, notes
           FROM nlcb_daily_sessions WHERE id = $1`,
          [id],
        );
        if (sessionRes.rows.length === 0) return null;
        const session = sessionRes.rows[0];

        const [salesRes, payoutsRes, scratchSalesRes, scratchWinningsRes, billPaymentsRes] = await Promise.all([
          c.query(
            `SELECT s.id, s.game_id, g.name AS game_name, s.gross_sales,
                    s.commission_rate, s.commission_amount, s.created_at
             FROM nlcb_sales s
             JOIN nlcb_games g ON g.id = s.game_id
             WHERE s.session_id = $1
             ORDER BY s.created_at`,
            [id],
          ),
          c.query(
            `SELECT p.id, p.game_id, g.name AS game_name, p.payout_amount,
                    p.ticket_ref, p.notes, p.created_at
             FROM nlcb_payouts p
             JOIN nlcb_games g ON g.id = p.game_id
             WHERE p.session_id = $1
             ORDER BY p.created_at`,
            [id],
          ),
          c.query(
            `SELECT ss.id, ss.game_id, sg.name AS game_name, sg.denomination,
                    ss.consignment_id, ss.tickets_sold, ss.gross_value,
                    ss.commission_rate, ss.commission_amount, ss.created_at
             FROM nlcb_scratch_sales ss
             JOIN nlcb_scratch_games sg ON sg.id = ss.game_id
             WHERE ss.session_id = $1
             ORDER BY ss.created_at`,
            [id],
          ),
          c.query(
            `SELECT sw.id, sw.game_id, sg.name AS game_name, sw.amount,
                    sw.ticket_ref, sw.is_large_win, sw.notes, sw.created_at
             FROM nlcb_scratch_winnings sw
             JOIN nlcb_scratch_games sg ON sg.id = sw.game_id
             WHERE sw.session_id = $1
             ORDER BY sw.created_at`,
            [id],
          ),
          c.query(
            `SELECT bp.id, bp.biller_id, b.name AS biller_name,
                    bp.amount_collected, bp.flat_fee, bp.customer_ref, bp.created_at
             FROM nlcb_bill_payments bp
             JOIN nlcb_billers b ON b.id = bp.biller_id
             WHERE bp.session_id = $1
             ORDER BY bp.created_at`,
            [id],
          ),
        ]);

        const sales        = salesRes.rows;
        const payouts      = payoutsRes.rows;
        const scratchSales = scratchSalesRes.rows;
        const scratchWins  = scratchWinningsRes.rows;
        const billPayments = billPaymentsRes.rows;

        // Draw: agent collects gross_sales, keeps commission + cashing_commission, remits rest
        const totalSales               = sales.reduce((s, r) => s + Number(r.gross_sales), 0);
        const totalCommission          = sales.reduce((s, r) => s + Number(r.commission_amount), 0);
        const boothPayouts             = payouts.filter(r => !r.is_large_win);
        const totalPayouts             = boothPayouts.reduce((s, r) => s + Number(r.payout_amount), 0);
        const totalDrawCashingComm     = boothPayouts.reduce((s, r) => s + Number(r.cashing_commission_amount), 0);

        // Scratch: packs presold (paid upfront). Settlement credits agent for booth payouts + cashing comm.
        const scratchBoothWins         = scratchWins.filter(r => !r.is_large_win);
        const totalScratchWinsPaid     = scratchBoothWins.reduce((s, r) => s + Number(r.amount), 0);
        const totalScratchCashingComm  = scratchBoothWins.reduce((s, r) => s + Number(r.cashing_commission_amount), 0);

        // Bills: agent collects full amount, keeps flat fee, remits rest
        const totalBillCollections     = billPayments.reduce((s, r) => s + Number(r.amount_collected), 0);
        const totalBillFees            = billPayments.reduce((s, r) => s + Number(r.flat_fee), 0);

        const netOwed = (totalSales - totalPayouts - totalCommission - totalDrawCashingComm)
                      - (totalScratchWinsPaid + totalScratchCashingComm)
                      + (totalBillCollections - totalBillFees);

        return {
          ...session,
          sales,
          payouts,
          scratch_sales:    scratchSales,
          scratch_winnings: scratchWins,
          bill_payments:    billPayments,
          summary: {
            draw: {
              total_sales: totalSales,
              total_commission: totalCommission,
              total_payouts: totalPayouts,
              total_cashing_commission: totalDrawCashingComm,
            },
            scratch: {
              total_sales: scratchSales.reduce((s, r) => s + Number(r.gross_value), 0),
              total_winnings_paid: totalScratchWinsPaid,
              total_cashing_commission: totalScratchCashingComm,
            },
            bills: { total_collections: totalBillCollections, total_fees: totalBillFees },
            net_owed: parseFloat(netOwed.toFixed(2)),
          },
        };
      });

      if (!result) { err(res, 404, 'NOT_FOUND', 'Session not found.'); return; }
      ok(res, result);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /nlcb/sessions/:id/sales ─────────────────────────────────────────────

nlcbSessionsRouter.post('/:id/sales', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid session id.'); return; }

  const bodyParsed = AddSalesSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const { game_id, gross_sales, idempotency_key } = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Idempotency check
        const existing = await c.query(
          `SELECT id, gross_sales, commission_amount FROM nlcb_sales WHERE idempotency_key = $1`,
          [idempotency_key],
        );
        if (existing.rows.length > 0) return existing.rows[0];

        // Validate session is open
        const sessionRes = await c.query(
          `SELECT status FROM nlcb_daily_sessions WHERE id = $1`,
          [id],
        );
        if (sessionRes.rows.length === 0) throw Object.assign(new Error('SESSION_NOT_FOUND'), { code: 'SESSION_NOT_FOUND' });
        if (sessionRes.rows[0].status !== 'OPEN') throw Object.assign(new Error('SESSION_CLOSED'), { code: 'SESSION_CLOSED' });

        // Get commission rate from game
        const gameRes = await c.query(
          `SELECT commission_rate FROM nlcb_games WHERE id = $1 AND is_active = true`,
          [game_id],
        );
        if (gameRes.rows.length === 0) throw Object.assign(new Error('GAME_NOT_FOUND'), { code: 'GAME_NOT_FOUND' });

        const commission_rate   = Number(gameRes.rows[0].commission_rate);
        const commission_amount = parseFloat((gross_sales * commission_rate / 100).toFixed(2));

        return c.query(
          `INSERT INTO nlcb_sales
             (tenant_id, session_id, game_id, gross_sales, commission_rate, commission_amount, idempotency_key, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, gross_sales, commission_rate, commission_amount, created_at`,
          [tenantId, id, game_id, gross_sales, commission_rate, commission_amount, idempotency_key, userId],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'NLCB', action: 'SALES_RECORDED', session_id: id, user_id: userId, tenant_id: tenantId, amount: gross_sales });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'SESSION_NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Session not found.'); return; }
      if (e.message === 'SESSION_CLOSED')    { err(res, 409, 'SESSION_CLOSED', 'Cannot add sales to a closed session.'); return; }
      if (e.message === 'GAME_NOT_FOUND')    { err(res, 404, 'GAME_NOT_FOUND', 'Game not found or inactive.'); return; }
    }
    next(e);
  }
});

// ── POST /nlcb/sessions/:id/payouts ──────────────────────────────────────────

nlcbSessionsRouter.post('/:id/payouts', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid session id.'); return; }

  const bodyParsed = AddPayoutSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const { game_id, payout_amount, ticket_ref, notes, idempotency_key } = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Idempotency check
        const existing = await c.query(
          `SELECT id, payout_amount FROM nlcb_payouts WHERE idempotency_key = $1`,
          [idempotency_key],
        );
        if (existing.rows.length > 0) return existing.rows[0];

        // Validate session is open
        const sessionRes = await c.query(
          `SELECT status FROM nlcb_daily_sessions WHERE id = $1`,
          [id],
        );
        if (sessionRes.rows.length === 0) throw Object.assign(new Error('SESSION_NOT_FOUND'), { code: 'SESSION_NOT_FOUND' });
        if (sessionRes.rows[0].status !== 'OPEN') throw Object.assign(new Error('SESSION_CLOSED'), { code: 'SESSION_CLOSED' });

        // Get game limits and cashing commission rate
        const gameRes = await c.query(
          `SELECT max_agent_payout, cashing_commission_rate FROM nlcb_games WHERE id = $1 AND is_active = true`,
          [game_id],
        );
        if (gameRes.rows.length === 0) throw Object.assign(new Error('GAME_NOT_FOUND'), { code: 'GAME_NOT_FOUND' });

        const { max_agent_payout, cashing_commission_rate } = gameRes.rows[0];
        const is_large_win              = payout_amount > Number(max_agent_payout);
        const cashing_commission_amount = is_large_win
          ? 0
          : parseFloat((payout_amount * Number(cashing_commission_rate) / 100).toFixed(2));

        return c.query(
          `INSERT INTO nlcb_payouts
             (tenant_id, session_id, game_id, payout_amount, ticket_ref, notes,
              is_large_win, cashing_commission_rate, cashing_commission_amount,
              idempotency_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING id, payout_amount, ticket_ref, is_large_win,
                     cashing_commission_rate, cashing_commission_amount, created_at`,
          [tenantId, id, game_id, payout_amount, ticket_ref ?? null, notes ?? null,
           is_large_win, cashing_commission_rate, cashing_commission_amount,
           idempotency_key, userId],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'NLCB', action: 'PAYOUT_RECORDED', session_id: id, user_id: userId, tenant_id: tenantId, amount: payout_amount, is_large_win: row.is_large_win });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'SESSION_NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Session not found.'); return; }
      if (e.message === 'SESSION_CLOSED')    { err(res, 409, 'SESSION_CLOSED', 'Cannot add payouts to a closed session.'); return; }
      if (e.message === 'GAME_NOT_FOUND')    { err(res, 404, 'GAME_NOT_FOUND', 'Game not found or inactive.'); return; }
    }
    next(e);
  }
});

// ── PATCH /nlcb/sessions/:id/close ───────────────────────────────────────────

nlcbSessionsRouter.patch('/:id/close', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid session id.'); return; }

  const bodyParsed = CloseSessionSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const { cash_float_close, notes } = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const sessionRes = await c.query(
          `SELECT status FROM nlcb_daily_sessions WHERE id = $1`,
          [id],
        );
        if (sessionRes.rows.length === 0) throw Object.assign(new Error('SESSION_NOT_FOUND'), { code: 'SESSION_NOT_FOUND' });
        if (sessionRes.rows[0].status !== 'OPEN') throw Object.assign(new Error('ALREADY_CLOSED'), { code: 'ALREADY_CLOSED' });

        const updateParams: unknown[] = [cash_float_close, userId, id];
        const noteSet = notes !== undefined ? `, notes = $4` : '';
        if (notes !== undefined) updateParams.splice(2, 0, notes);

        const idxClose = 1, idxUser = 2, idxId = notes !== undefined ? 4 : 3;
        return c.query(
          `UPDATE nlcb_daily_sessions
           SET cash_float_close = $1, status = 'CLOSED', closed_at = now(),
               last_modified_at = now(), last_modified_by = $2
               ${notes !== undefined ? ', notes = $3' : ''}
           WHERE id = $${notes !== undefined ? 4 : 3}
           RETURNING id, session_date, status, cash_float_open, cash_float_close, closed_at`,
          notes !== undefined ? [cash_float_close, userId, notes, id] : [cash_float_close, userId, id],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'NLCB', action: 'SESSION_CLOSED', session_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'SESSION_NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Session not found.'); return; }
      if (e.message === 'ALREADY_CLOSED')    { err(res, 409, 'ALREADY_CLOSED', 'Session is already closed.'); return; }
    }
    next(e);
  }
});
