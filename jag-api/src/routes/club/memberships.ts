// GET  /api/v1/club/members/:id/memberships  — list a member's memberships
// POST /api/v1/club/members/:id/memberships  — subscribe member to tier (idempotency)
// PATCH /api/v1/club/members/:id/memberships/:msId — cancel or expire membership

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { entertainmentPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const clubMembershipsRouter = Router({ mergeParams: true });
clubMembershipsRouter.use(requireAuth());

const MemberParam      = z.object({ id: z.string().uuid() });
const MembershipParam  = z.object({ id: z.string().uuid(), msId: z.string().uuid() });

const CreateMembershipSchema = z.object({
  tier_id:         z.string().uuid(),
  started_at:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expires_at:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  idempotency_key: z.string().uuid(),
}).strict();

const PatchMembershipSchema = z.object({
  status:     z.enum(['CANCELLED', 'EXPIRED']),
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

// ── GET /club/members/:id/memberships ─────────────────────────────────────────

clubMembershipsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = MemberParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'Member ID must be a valid UUID.'); return; }

    const client = await entertainmentPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT ms.id, ms.tier_id, t.name AS tier_name, t.bar_discount_pct,
                  ms.started_at, ms.expires_at, ms.status, ms.created_at
           FROM   ent_memberships ms
           JOIN   ent_membership_tiers t ON t.id = ms.tier_id
           WHERE  ms.member_id = $1
           ORDER  BY ms.started_at DESC`,
          [idP.data.id],
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /club/members/:id/memberships ────────────────────────────────────────

clubMembershipsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = MemberParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'Member ID must be a valid UUID.'); return; }
    const bodyP = CreateMembershipSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const { tenantId, userId } = req.rlsCtx;
    const memberId = idP.data.id;

    const client = await entertainmentPool.connect();
    try {
      const { ms, created } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Idempotency check.
        const dup = await c.query<{ id: string }>(
          `SELECT id FROM ent_memberships WHERE idempotency_key = $1`, [body.idempotency_key],
        ).then(r => r.rows[0] ?? null);
        if (dup) {
          const existing = await c.query(`SELECT * FROM ent_memberships WHERE id = $1`, [dup.id]).then(r => r.rows[0]);
          return { ms: existing, created: false };
        }

        // Verify member and tier exist.
        const member = await c.query<{ id: string }>(`SELECT id FROM ent_members WHERE id = $1`, [memberId]).then(r => r.rows[0] ?? null);
        if (!member) throw Object.assign(new Error('MEMBER_NOT_FOUND'), { httpStatus: 404 });
        const tier = await c.query<{ id: string; credit_on_join: string }>(
          `SELECT id, credit_on_join FROM ent_membership_tiers WHERE id = $1 AND is_active = true`, [body.tier_id],
        ).then(r => r.rows[0] ?? null);
        if (!tier) throw Object.assign(new Error('TIER_NOT_FOUND'), { httpStatus: 404 });

        const rec = await c.query(
          `INSERT INTO ent_memberships (tenant_id, member_id, tier_id, started_at, expires_at, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [tenantId, memberId, body.tier_id, body.started_at, body.expires_at ?? null, body.idempotency_key],
        ).then(r => r.rows[0]);

        // Credit on join: add to member balance + ledger.
        const creditOnJoin = parseFloat(tier.credit_on_join);
        if (creditOnJoin > 0) {
          await c.query(
            `INSERT INTO ent_member_credits (tenant_id, member_id, amount, description, idempotency_key)
             VALUES ($1,$2,$3,$4,$5)`,
            [tenantId, memberId, creditOnJoin, `Welcome credit — membership ${rec.id}`, body.idempotency_key + '-join-credit'],
          );
          await c.query(
            `UPDATE ent_members SET credit_balance = credit_balance + $1, updated_at = now() WHERE id = $2`,
            [creditOnJoin, memberId],
          );
        }

        return { ms: rec, created: true };
      });
      logger.info({ entity: 'CLUB', action: created ? 'MEMBERSHIP_CREATED' : 'MEMBERSHIP_DUPLICATE', user_id: userId, record_id: ms.id });
      ok(res, ms, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) {
    const httpErr = e as { httpStatus?: number; message?: string };
    if (httpErr.httpStatus === 404) { err(res, 404, httpErr.message ?? 'NOT_FOUND', 'Resource not found.'); return; }
    next(e);
  }
});

// ── PATCH /club/members/:id/memberships/:msId ─────────────────────────────────

clubMembershipsRouter.patch('/:msId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramP = MembershipParam.safeParse(req.params);
    if (!paramP.success) { err(res, 422, 'VALIDATION_ERROR', 'IDs must be valid UUIDs.'); return; }
    const bodyP = PatchMembershipSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;

    const client = await entertainmentPool.connect();
    try {
      const rec = await withTenantRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [body.status];
        const setCols = [`status = $1`, `updated_at = now()`];
        if (body.expires_at) { params.push(body.expires_at); setCols.push(`expires_at = $${params.length}`); }
        // $N = member_id, $(N+1) = membership id
        params.push(paramP.data.id);
        const memberPlaceholder = params.length;
        params.push(paramP.data.msId);
        const msPlaceholder = params.length;
        return c.query(
          `UPDATE ent_memberships SET ${setCols.join(',')}
           WHERE member_id = $${memberPlaceholder} AND id = $${msPlaceholder} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null);
      });
      if (!rec) { err(res, 404, 'MEMBERSHIP_NOT_FOUND', 'Membership not found.'); return; }
      logger.info({ entity: 'CLUB', action: 'MEMBERSHIP_UPDATED', user_id: req.rlsCtx.userId, record_id: rec.id });
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
