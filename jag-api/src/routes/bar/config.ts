// GET   /api/v1/bar/config  — get current VAT + service charge rates
// PATCH /api/v1/bar/config  — update rates (e.g. when VAT registration obtained)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { entertainmentPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const barConfigRouter = Router();
barConfigRouter.use(requireAuth());

const PatchConfigSchema = z.object({
  vat_pct:              z.number().min(0).max(100).optional(),
  service_charge_pct:   z.number().min(0).max(100).optional(),
  bar_license_expiry:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  club_license_expiry:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict().refine(o => Object.keys(o).length > 0, { message: 'At least one field required.' });

// ── GET /bar/config ───────────────────────────────────────────────────────────

barConfigRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { tenantId } = req.rlsCtx;
    const client = await entertainmentPool.connect();
    try {
      const cfg = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM ent_config WHERE tenant_id = $1`, [tenantId]).then(r => r.rows[0] ?? null),
      );
      // Return defaults if no config row yet (tenant hasn't been seeded).
      ok(res, cfg ?? { tenant_id: tenantId, vat_pct: 0, service_charge_pct: 10 });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /bar/config ─────────────────────────────────────────────────────────

barConfigRouter.patch('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const bodyP = PatchConfigSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const { tenantId, userId } = req.rlsCtx;

    const client = await entertainmentPool.connect();
    try {
      const cfg = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Upsert — create config row for tenant if it doesn't exist yet.
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM ent_config WHERE tenant_id = $1`, [tenantId],
        ).then(r => r.rows[0] ?? null);

        if (!existing) {
          return c.query(
            `INSERT INTO ent_config (tenant_id, vat_pct, service_charge_pct, updated_by)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [tenantId, body.vat_pct ?? 0, body.service_charge_pct ?? 10, userId],
          ).then(r => r.rows[0]);
        }

        const setCols: string[] = ['updated_at = now()', `updated_by = '${userId}'`];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        if (body.vat_pct             !== undefined) setCols.push(`vat_pct             = ${push(body.vat_pct)}`);
        if (body.service_charge_pct  !== undefined) setCols.push(`service_charge_pct  = ${push(body.service_charge_pct)}`);
        if (body.bar_license_expiry  !== undefined) setCols.push(`bar_license_expiry  = ${push(body.bar_license_expiry)}`);
        if (body.club_license_expiry !== undefined) setCols.push(`club_license_expiry = ${push(body.club_license_expiry)}`);
        params.push(tenantId);
        return c.query(
          `UPDATE ent_config SET ${setCols.join(',')} WHERE tenant_id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0]);
      });
      logger.info({ entity: 'BAR', action: 'CONFIG_UPDATED', user_id: userId });
      ok(res, cfg);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
