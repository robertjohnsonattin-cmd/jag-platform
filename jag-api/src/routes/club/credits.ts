// GET  /api/v1/club/members/:id/credits  — credit ledger for a member
// POST /api/v1/club/members/:id/credits  — manually add credit (staff top-up / adjustment)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { entertainmentPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const clubCreditsRouter = Router({ mergeParams: true });
clubCreditsRouter.use(requireAuth());

const MemberParam = z.object({ id: z.string().uuid() });

const AddCreditSchema = z.object({
  amount:          z.number().refine(v => v !== 0, { message: 'Amount cannot be zero.' }),
  description:     z.string().min(1).max(300),
  idempotency_key: z.string().uuid(),
}).strict();

// ── GET /club/members/:id/credits ─────────────────────────────────────────────

clubCreditsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = MemberParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'Member ID must be a valid UUID.'); return; }

    const client = await entertainmentPool.connect();
    try {
      const { ledger, balance } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const member = await c.query<{ credit_balance: string }>(
          `SELECT credit_balance FROM ent_members WHERE id = $1`, [idP.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!member) throw Object.assign(new Error('MEMBER_NOT_FOUND'), { httpStatus: 404 });

        const rows = await c.query(
          `SELECT id, amount, description, tab_payment_id, created_at
           FROM   ent_member_credits WHERE member_id = $1
           ORDER  BY created_at DESC`,
          [idP.data.id],
        ).then(r => r.rows);
        return { ledger: rows, balance: parseFloat(member.credit_balance) };
      });
      ok(res, { balance, ledger });
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'MEMBER_NOT_FOUND', 'Member not found.'); return; }
    next(e);
  }
});

// ── POST /club/members/:id/credits ────────────────────────────────────────────

clubCreditsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = MemberParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'Member ID must be a valid UUID.'); return; }
    const bodyP = AddCreditSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const { tenantId, userId } = req.rlsCtx;
    const memberId = idP.data.id;

    const client = await entertainmentPool.connect();
    try {
      const { rec, created } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Idempotency check.
        const dup = await c.query<{ id: string }>(
          `SELECT id FROM ent_member_credits WHERE idempotency_key = $1`, [body.idempotency_key],
        ).then(r => r.rows[0] ?? null);
        if (dup) {
          const existing = await c.query(`SELECT * FROM ent_member_credits WHERE id = $1`, [dup.id]).then(r => r.rows[0]);
          return { rec: existing, created: false };
        }

        const member = await c.query<{ id: string }>(
          `SELECT id FROM ent_members WHERE id = $1`, [memberId],
        ).then(r => r.rows[0] ?? null);
        if (!member) throw Object.assign(new Error('MEMBER_NOT_FOUND'), { httpStatus: 404 });

        const result = await c.query(
          `INSERT INTO ent_member_credits (tenant_id, member_id, amount, description, idempotency_key)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [tenantId, memberId, body.amount, body.description, body.idempotency_key],
        ).then(r => r.rows[0]);

        await c.query(
          `UPDATE ent_members SET credit_balance = credit_balance + $1, updated_at = now() WHERE id = $2`,
          [body.amount, memberId],
        );

        return { rec: result, created: true };
      });
      logger.info({ entity: 'CLUB', action: created ? 'CREDIT_ADDED' : 'CREDIT_DUPLICATE', user_id: userId, record_id: rec.id });
      ok(res, rec, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'MEMBER_NOT_FOUND', 'Member not found.'); return; }
    next(e);
  }
});
