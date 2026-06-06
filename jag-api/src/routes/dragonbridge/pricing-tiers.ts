// GET   /api/v1/dragonbridge/pricing-tiers      — list tiers
// POST  /api/v1/dragonbridge/pricing-tiers      — create tier
// PATCH /api/v1/dragonbridge/pricing-tiers/:id  — update tier

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const dbPricingTiersRouter = Router();
dbPricingTiersRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateTierSchema = z.object({
  name:               z.string().min(1).max(50),
  default_margin_pct: z.number().min(0),
  description:        z.string().max(500).optional(),
}).strict();

const UpdateTierSchema = z.object({
  name:               z.string().min(1).max(50).optional(),
  default_margin_pct: z.number().min(0).optional(),
  description:        z.string().max(500).optional(),
  is_active:          z.boolean().optional(),
}).strict();

// ── GET /dragonbridge/pricing-tiers ──────────────────────────────────────────

dbPricingTiersRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, name, default_margin_pct, description, is_active, created_at
           FROM db_pricing_tiers ORDER BY name`,
        ).then((r) => r.rows),
      );
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /dragonbridge/pricing-tiers ─────────────────────────────────────────

dbPricingTiersRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateTierSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const { name, default_margin_pct, description } = parsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO db_pricing_tiers (tenant_id, name, default_margin_pct, description)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, default_margin_pct, description, is_active, created_at`,
          [tenantId, name, default_margin_pct, description ?? null],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'DRAGONBRIDGE', action: 'PRICING_TIER_CREATED', tier_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === '23505') {
      err(res, 409, 'DUPLICATE_NAME', 'A pricing tier with this name already exists.');
      return;
    }
    next(e);
  }
});

// ── PATCH /dragonbridge/pricing-tiers/:id ────────────────────────────────────

dbPricingTiersRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid tier id.'); return; }

  const bodyParsed = UpdateTierSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const updates = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  if (Object.keys(updates).length === 0) { err(res, 400, 'NO_FIELDS', 'No fields to update.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const sets: string[] = [];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (updates.name               !== undefined) sets.push(`name = ${push(updates.name)}`);
        if (updates.default_margin_pct !== undefined) sets.push(`default_margin_pct = ${push(updates.default_margin_pct)}`);
        if (updates.description        !== undefined) sets.push(`description = ${push(updates.description)}`);
        if (updates.is_active          !== undefined) sets.push(`is_active = ${push(updates.is_active)}`);
        sets.push(`updated_at = now()`);

        return c.query(
          `UPDATE db_pricing_tiers SET ${sets.join(', ')}
           WHERE id = ${push(id)}
           RETURNING id, name, default_margin_pct, description, is_active, updated_at`,
          params,
        ).then((r) => r.rows[0] ?? null);
      });
      if (!row) { err(res, 404, 'NOT_FOUND', 'Pricing tier not found.'); return; }
      logger.info({ entity: 'DRAGONBRIDGE', action: 'PRICING_TIER_UPDATED', tier_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});
