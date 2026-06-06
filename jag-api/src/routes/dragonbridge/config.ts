// GET   /api/v1/dragonbridge/config  — get booth config
// PATCH /api/v1/dragonbridge/config  — update config

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const dbConfigRouter = Router();
dbConfigRouter.use(requireAuth());

const UpdateConfigSchema = z.object({
  deposit_pct_default:           z.number().gt(0).lt(100).optional(),
  balance_trigger:               z.enum(['PRE_DELIVERY', 'ON_DELIVERY']).optional(),
  variance_threshold_pct:        z.number().min(0).optional(),
  default_vat_pct:               z.number().min(0).optional(),
  agency_fee_pct:                z.number().min(0).optional(),
  freight_apportionment_method:  z.enum(['CBM', 'VALUE', 'EQUAL']).optional(),
}).strict();

// ── GET /dragonbridge/config ──────────────────────────────────────────────────

dbConfigRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT tenant_id, deposit_pct_default, balance_trigger,
                  variance_threshold_pct, default_vat_pct,
                  agency_fee_pct, freight_apportionment_method, updated_at
           FROM db_config WHERE tenant_id = $1`,
          [req.rlsCtx.tenantId],
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Config not found.'); return; }
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── PATCH /dragonbridge/config ────────────────────────────────────────────────

dbConfigRouter.patch('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = UpdateConfigSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const updates = parsed.data;
  const { userId, tenantId } = req.rlsCtx;

  if (Object.keys(updates).length === 0) { err(res, 400, 'NO_FIELDS', 'No fields to update.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const sets: string[] = [];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (updates.deposit_pct_default          !== undefined) sets.push(`deposit_pct_default = ${push(updates.deposit_pct_default)}`);
        if (updates.balance_trigger              !== undefined) sets.push(`balance_trigger = ${push(updates.balance_trigger)}`);
        if (updates.variance_threshold_pct       !== undefined) sets.push(`variance_threshold_pct = ${push(updates.variance_threshold_pct)}`);
        if (updates.default_vat_pct              !== undefined) sets.push(`default_vat_pct = ${push(updates.default_vat_pct)}`);
        if (updates.agency_fee_pct               !== undefined) sets.push(`agency_fee_pct = ${push(updates.agency_fee_pct)}`);
        if (updates.freight_apportionment_method !== undefined) sets.push(`freight_apportionment_method = ${push(updates.freight_apportionment_method)}`);
        sets.push(`updated_at = now()`);
        sets.push(`updated_by = ${push(userId)}`);

        return c.query(
          `UPDATE db_config SET ${sets.join(', ')}
           WHERE tenant_id = ${push(tenantId)}
           RETURNING tenant_id, deposit_pct_default, balance_trigger,
                     variance_threshold_pct, default_vat_pct,
                     agency_fee_pct, freight_apportionment_method, updated_at`,
          params,
        ).then((r) => r.rows[0] ?? null);
      });
      if (!row) { err(res, 404, 'NOT_FOUND', 'Config not found.'); return; }
      logger.info({ entity: 'DRAGONBRIDGE', action: 'CONFIG_UPDATED', user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});
