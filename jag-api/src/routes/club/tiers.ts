// GET  /api/v1/club/tiers     — list active tiers
// POST /api/v1/club/tiers     — create tier
// PATCH /api/v1/club/tiers/:id — update tier

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { entertainmentPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const clubTiersRouter = Router();
clubTiersRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateTierSchema = z.object({
  name:                   z.string().min(1).max(100),
  monthly_fee:            z.number().min(0).default(0),
  bar_discount_pct:       z.number().min(0).max(100).default(0),
  guest_passes_per_month: z.number().int().min(0).default(0),
  credit_on_join:         z.number().min(0).default(0),
}).strict();

const PatchTierSchema = z.object({
  name:                   z.string().min(1).max(100).optional(),
  monthly_fee:            z.number().min(0).optional(),
  bar_discount_pct:       z.number().min(0).max(100).optional(),
  guest_passes_per_month: z.number().int().min(0).optional(),
  credit_on_join:         z.number().min(0).optional(),
  is_active:              z.boolean().optional(),
}).strict().refine(o => Object.keys(o).length > 0, { message: 'At least one field required.' });

// ── GET /club/tiers ───────────────────────────────────────────────────────────

clubTiersRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const activeOnly = req.query.active !== 'false';
    const client = await entertainmentPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, name, monthly_fee, bar_discount_pct, guest_passes_per_month,
                  credit_on_join, is_active, created_at, updated_at
           FROM   ent_membership_tiers
           ${activeOnly ? 'WHERE is_active = true' : ''}
           ORDER  BY monthly_fee`,
        ).then(r => r.rows),
      );
      logger.info({ entity: 'CLUB', action: 'TIERS_LIST', user_id: req.rlsCtx.userId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /club/tiers ──────────────────────────────────────────────────────────

clubTiersRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateTierSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { tenantId, userId } = req.rlsCtx;

    const client = await entertainmentPool.connect();
    try {
      const rec = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO ent_membership_tiers
             (tenant_id, name, monthly_fee, bar_discount_pct, guest_passes_per_month, credit_on_join)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [tenantId, body.name, body.monthly_fee, body.bar_discount_pct,
           body.guest_passes_per_month, body.credit_on_join],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'CLUB', action: 'TIER_CREATED', user_id: userId, record_id: rec.id });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /club/tiers/:id ─────────────────────────────────────────────────────

clubTiersRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = PatchTierSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;

    const setCols: string[] = ['updated_at = now()'];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (body.name                   !== undefined) setCols.push(`name                   = ${push(body.name)}`);
    if (body.monthly_fee            !== undefined) setCols.push(`monthly_fee            = ${push(body.monthly_fee)}`);
    if (body.bar_discount_pct       !== undefined) setCols.push(`bar_discount_pct       = ${push(body.bar_discount_pct)}`);
    if (body.guest_passes_per_month !== undefined) setCols.push(`guest_passes_per_month = ${push(body.guest_passes_per_month)}`);
    if (body.credit_on_join         !== undefined) setCols.push(`credit_on_join         = ${push(body.credit_on_join)}`);
    if (body.is_active              !== undefined) setCols.push(`is_active              = ${push(body.is_active)}`);
    params.push(idP.data.id);

    const client = await entertainmentPool.connect();
    try {
      const rec = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE ent_membership_tiers SET ${setCols.join(',')} WHERE id = $${params.length} RETURNING *`, params)
          .then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'TIER_NOT_FOUND', 'Membership tier not found.'); return; }
      logger.info({ entity: 'CLUB', action: 'TIER_UPDATED', user_id: req.rlsCtx.userId, record_id: rec.id });
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
