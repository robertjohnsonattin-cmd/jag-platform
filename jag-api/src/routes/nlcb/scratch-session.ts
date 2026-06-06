// Scratch and bill endpoints nested under a daily session:
//
// GET  /api/v1/nlcb/sessions/:id/scratch-sales    — list scratch sales for session
// POST /api/v1/nlcb/sessions/:id/scratch-sales    — record scratch sales (cash-flow; no commission)
// GET  /api/v1/nlcb/sessions/:id/scratch-winnings — list scratch winnings
// POST /api/v1/nlcb/sessions/:id/scratch-winnings — record scratch winning paid at booth (idempotency)
// GET  /api/v1/nlcb/sessions/:id/bill-payments    — list bill payments for session
// POST /api/v1/nlcb/sessions/:id/bill-payments    — record a bill payment (idempotency)
//
// Scratch scratch winnings:
//   - is_large_win auto-set when amount > game.max_agent_payout (winner goes to NLCB office)
//   - cashing_commission_amount = amount × cashing_commission_rate / 100 (only if not large win)
//   - Large wins are logged for audit only; agent pays nothing and earns no cashing commission

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const nlcbScratchSessionRouter = Router({ mergeParams: true });
nlcbScratchSessionRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const AddScratchSalesSchema = z.object({
  game_id:         z.string().uuid(),
  pack_purchase_id: z.string().uuid().optional(),
  tickets_sold:    z.number().int().positive(),
  idempotency_key: z.string().uuid(),
}).strict();

const AddScratchWinningSchema = z.object({
  game_id:         z.string().uuid(),
  amount:          z.number().positive(),
  ticket_ref:      z.string().max(100).optional(),
  notes:           z.string().max(500).optional(),
  idempotency_key: z.string().uuid(),
}).strict();

const AddBillPaymentSchema = z.object({
  biller_id:        z.string().uuid(),
  amount_collected: z.number().positive(),
  customer_ref:     z.string().max(100).optional(),
  idempotency_key:  z.string().uuid(),
}).strict();

// ── GET /sessions/:id/scratch-sales ──────────────────────────────────────────

nlcbScratchSessionRouter.get('/scratch-sales', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid session id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT ss.id, ss.game_id, sg.name AS game_name, sg.denomination,
                  ss.pack_purchase_id, ss.tickets_sold, ss.gross_value, ss.created_at
           FROM nlcb_scratch_sales ss
           JOIN nlcb_scratch_games sg ON sg.id = ss.game_id
           WHERE ss.session_id = $1
           ORDER BY ss.created_at`,
          [paramParsed.data.id],
        ).then((r) => r.rows),
      );
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /sessions/:id/scratch-sales ─────────────────────────────────────────
// gross_value = tickets_sold × game.denomination (computed server-side).
// No commission computed — margin was captured when the pack was purchased.

nlcbScratchSessionRouter.post('/scratch-sales', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid session id.'); return; }

  const bodyParsed = AddScratchSalesSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const sessionId = paramParsed.data.id;
  const { game_id, pack_purchase_id, tickets_sold, idempotency_key } = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query(
          `SELECT id, gross_value FROM nlcb_scratch_sales WHERE idempotency_key = $1`,
          [idempotency_key],
        );
        if (existing.rows.length > 0) return existing.rows[0];

        const sessionRes = await c.query(
          `SELECT status FROM nlcb_daily_sessions WHERE id = $1`, [sessionId],
        );
        if (sessionRes.rows.length === 0) throw Object.assign(new Error('SESSION_NOT_FOUND'), {});
        if (sessionRes.rows[0].status !== 'OPEN') throw Object.assign(new Error('SESSION_CLOSED'), {});

        const gameRes = await c.query(
          `SELECT denomination FROM nlcb_scratch_games WHERE id = $1 AND is_active = true`,
          [game_id],
        );
        if (gameRes.rows.length === 0) throw Object.assign(new Error('GAME_NOT_FOUND'), {});

        const gross_value = parseFloat((tickets_sold * Number(gameRes.rows[0].denomination)).toFixed(2));

        return c.query(
          `INSERT INTO nlcb_scratch_sales
             (tenant_id, session_id, game_id, pack_purchase_id, tickets_sold, gross_value,
              idempotency_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id, tickets_sold, gross_value, created_at`,
          [tenantId, sessionId, game_id, pack_purchase_id ?? null, tickets_sold, gross_value,
           idempotency_key, userId],
        ).then((r) => r.rows[0]);
      });

      logger.info({ entity: 'NLCB', action: 'SCRATCH_SALES_RECORDED', session_id: sessionId, user_id: userId, tenant_id: tenantId, tickets_sold });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'SESSION_NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Session not found.'); return; }
      if (e.message === 'SESSION_CLOSED')    { err(res, 409, 'SESSION_CLOSED', 'Cannot add sales to a closed session.'); return; }
      if (e.message === 'GAME_NOT_FOUND')    { err(res, 404, 'GAME_NOT_FOUND', 'Scratch game not found or inactive.'); return; }
    }
    next(e);
  }
});

// ── GET /sessions/:id/scratch-winnings ───────────────────────────────────────

nlcbScratchSessionRouter.get('/scratch-winnings', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid session id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT sw.id, sw.game_id, sg.name AS game_name, sw.amount,
                  sw.ticket_ref, sw.is_large_win,
                  sw.cashing_commission_rate, sw.cashing_commission_amount,
                  sw.notes, sw.created_at
           FROM nlcb_scratch_winnings sw
           JOIN nlcb_scratch_games sg ON sg.id = sw.game_id
           WHERE sw.session_id = $1
           ORDER BY sw.created_at`,
          [paramParsed.data.id],
        ).then((r) => r.rows),
      );
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /sessions/:id/scratch-winnings ──────────────────────────────────────
// is_large_win auto-set if amount > game.max_agent_payout.
// Cashing commission only earned on booth-paid wins (not large wins).

nlcbScratchSessionRouter.post('/scratch-winnings', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid session id.'); return; }

  const bodyParsed = AddScratchWinningSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const sessionId = paramParsed.data.id;
  const { game_id, amount, ticket_ref, notes, idempotency_key } = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query(
          `SELECT id, amount, is_large_win, cashing_commission_amount
           FROM nlcb_scratch_winnings WHERE idempotency_key = $1`,
          [idempotency_key],
        );
        if (existing.rows.length > 0) return existing.rows[0];

        const sessionRes = await c.query(
          `SELECT status FROM nlcb_daily_sessions WHERE id = $1`, [sessionId],
        );
        if (sessionRes.rows.length === 0) throw Object.assign(new Error('SESSION_NOT_FOUND'), {});
        if (sessionRes.rows[0].status !== 'OPEN') throw Object.assign(new Error('SESSION_CLOSED'), {});

        const gameRes = await c.query(
          `SELECT max_agent_payout, cashing_commission_rate
           FROM nlcb_scratch_games WHERE id = $1 AND is_active = true`,
          [game_id],
        );
        if (gameRes.rows.length === 0) throw Object.assign(new Error('GAME_NOT_FOUND'), {});

        const { max_agent_payout, cashing_commission_rate } = gameRes.rows[0];
        const is_large_win            = amount > Number(max_agent_payout);
        const cashing_commission_amount = is_large_win
          ? 0
          : parseFloat((amount * Number(cashing_commission_rate) / 100).toFixed(2));

        return c.query(
          `INSERT INTO nlcb_scratch_winnings
             (tenant_id, session_id, game_id, amount, ticket_ref, is_large_win,
              cashing_commission_rate, cashing_commission_amount, notes, idempotency_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING id, amount, ticket_ref, is_large_win,
                     cashing_commission_rate, cashing_commission_amount, created_at`,
          [tenantId, sessionId, game_id, amount, ticket_ref ?? null, is_large_win,
           cashing_commission_rate, cashing_commission_amount, notes ?? null, idempotency_key, userId],
        ).then((r) => r.rows[0]);
      });

      logger.info({ entity: 'NLCB', action: 'SCRATCH_WINNING_RECORDED', session_id: sessionId, user_id: userId, tenant_id: tenantId, amount, is_large_win: row.is_large_win });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'SESSION_NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Session not found.'); return; }
      if (e.message === 'SESSION_CLOSED')    { err(res, 409, 'SESSION_CLOSED', 'Cannot add winnings to a closed session.'); return; }
      if (e.message === 'GAME_NOT_FOUND')    { err(res, 404, 'GAME_NOT_FOUND', 'Scratch game not found or inactive.'); return; }
    }
    next(e);
  }
});

// ── GET /sessions/:id/bill-payments ──────────────────────────────────────────

nlcbScratchSessionRouter.get('/bill-payments', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid session id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT bp.id, bp.biller_id, b.name AS biller_name,
                  bp.amount_collected, bp.flat_fee, bp.customer_ref, bp.created_at
           FROM nlcb_bill_payments bp
           JOIN nlcb_billers b ON b.id = bp.biller_id
           WHERE bp.session_id = $1
           ORDER BY bp.created_at`,
          [paramParsed.data.id],
        ).then((r) => r.rows),
      );
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /sessions/:id/bill-payments ─────────────────────────────────────────

nlcbScratchSessionRouter.post('/bill-payments', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid session id.'); return; }

  const bodyParsed = AddBillPaymentSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const sessionId = paramParsed.data.id;
  const { biller_id, amount_collected, customer_ref, idempotency_key } = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query(
          `SELECT id, amount_collected, flat_fee FROM nlcb_bill_payments WHERE idempotency_key = $1`,
          [idempotency_key],
        );
        if (existing.rows.length > 0) return existing.rows[0];

        const sessionRes = await c.query(
          `SELECT status FROM nlcb_daily_sessions WHERE id = $1`, [sessionId],
        );
        if (sessionRes.rows.length === 0) throw Object.assign(new Error('SESSION_NOT_FOUND'), {});
        if (sessionRes.rows[0].status !== 'OPEN') throw Object.assign(new Error('SESSION_CLOSED'), {});

        const billerRes = await c.query(
          `SELECT flat_fee FROM nlcb_billers WHERE id = $1 AND is_active = true`, [biller_id],
        );
        if (billerRes.rows.length === 0) throw Object.assign(new Error('BILLER_NOT_FOUND'), {});

        return c.query(
          `INSERT INTO nlcb_bill_payments
             (tenant_id, session_id, biller_id, amount_collected, flat_fee,
              customer_ref, idempotency_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id, amount_collected, flat_fee, customer_ref, created_at`,
          [tenantId, sessionId, biller_id, amount_collected,
           Number(billerRes.rows[0].flat_fee), customer_ref ?? null, idempotency_key, userId],
        ).then((r) => r.rows[0]);
      });

      logger.info({ entity: 'NLCB', action: 'BILL_PAYMENT_RECORDED', session_id: sessionId, user_id: userId, tenant_id: tenantId, amount: amount_collected });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'SESSION_NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Session not found.'); return; }
      if (e.message === 'SESSION_CLOSED')    { err(res, 409, 'SESSION_CLOSED', 'Cannot add bill payments to a closed session.'); return; }
      if (e.message === 'BILLER_NOT_FOUND')  { err(res, 404, 'BILLER_NOT_FOUND', 'Biller not found or inactive.'); return; }
    }
    next(e);
  }
});
