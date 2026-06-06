// GET   /api/v1/nlcb/billers      — list billers
// POST  /api/v1/nlcb/billers      — create biller
// PATCH /api/v1/nlcb/billers/:id  — update flat fee / active status

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const nlcbBillersRouter = Router();
nlcbBillersRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateBillerSchema = z.object({
  name:     z.string().min(1).max(100),
  flat_fee: z.number().min(0),
}).strict();

const UpdateBillerSchema = z.object({
  name:      z.string().min(1).max(100).optional(),
  flat_fee:  z.number().min(0).optional(),
  is_active: z.boolean().optional(),
}).strict();

// ── GET /nlcb/billers ─────────────────────────────────────────────────────────

nlcbBillersRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, name, flat_fee, is_active, created_at, last_modified_at
           FROM nlcb_billers
           ORDER BY name`,
        ).then((r) => r.rows),
      );
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /nlcb/billers ────────────────────────────────────────────────────────

nlcbBillersRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateBillerSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const { name, flat_fee } = parsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO nlcb_billers (tenant_id, name, flat_fee, last_modified_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, flat_fee, is_active, created_at`,
          [tenantId, name, flat_fee, userId],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'NLCB', action: 'BILLER_CREATED', biller_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── PATCH /nlcb/billers/:id ───────────────────────────────────────────────────

nlcbBillersRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid biller id.'); return; }

  const bodyParsed = UpdateBillerSchema.safeParse(req.body);
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

        if (updates.name      !== undefined) sets.push(`name = ${push(updates.name)}`);
        if (updates.flat_fee  !== undefined) sets.push(`flat_fee = ${push(updates.flat_fee)}`);
        if (updates.is_active !== undefined) sets.push(`is_active = ${push(updates.is_active)}`);
        sets.push(`last_modified_at = now()`);
        sets.push(`last_modified_by = ${push(userId)}`);

        return c.query(
          `UPDATE nlcb_billers SET ${sets.join(', ')}
           WHERE id = ${push(id)}
           RETURNING id, name, flat_fee, is_active, last_modified_at`,
          params,
        ).then((r) => r.rows[0] ?? null);
      });

      if (!row) { err(res, 404, 'NOT_FOUND', 'Biller not found.'); return; }
      logger.info({ entity: 'NLCB', action: 'BILLER_UPDATED', biller_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});
