// GET    /api/v1/hr/positions      — list positions
// POST   /api/v1/hr/positions      — create position
// PATCH  /api/v1/hr/positions/:id  — update position
// DELETE /api/v1/hr/positions/:id  — soft-deactivate

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const hrPositionsRouter = Router();
hrPositionsRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const CreatePositionSchema = z.object({
  name:           z.string().min(1).max(200),
  code:           z.string().max(20).optional(),
  department_id:  z.string().uuid().optional(),
  min_salary_ttd: z.coerce.number().min(0).optional(),
  max_salary_ttd: z.coerce.number().min(0).optional(),
  description:    z.string().max(2000).optional(),
}).strict();

const UpdatePositionSchema = z.object({
  name:           z.string().min(1).max(200).optional(),
  code:           z.string().min(1).max(20).optional(),
  department_id:  z.string().uuid().nullable().optional(),
  min_salary_ttd: z.number().min(0).nullable().optional(),
  max_salary_ttd: z.number().min(0).nullable().optional(),
  description:    z.string().max(2000).nullable().optional(),
  is_active:      z.boolean().optional(),
}).strict();

hrPositionsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT p.*, d.name AS department_name
          FROM hr_positions p
          LEFT JOIN hr_departments d ON d.id = p.department_id
          WHERE p.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
          ORDER BY p.name
        `).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrPositionsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreatePositionSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Auto-generate code from name initials if not provided
        let code = d.code?.trim() || '';
        if (!code) {
          const base = d.name.split(/\s+/).map((w: string) => w[0] ?? '').join('').toUpperCase().slice(0, 8) || 'POS';
          const { rows } = await c.query<{ count: string }>(
            `SELECT COUNT(*) AS count FROM hr_positions WHERE tenant_id = $1 AND code LIKE $2`,
            [tenantId, `${base}%`],
          );
          const n = parseInt(rows[0].count);
          code = n === 0 ? base : `${base}${n + 1}`;
        }
        return c.query(
          `INSERT INTO hr_positions (tenant_id, name, code, department_id, min_salary_ttd, max_salary_ttd, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [tenantId, d.name, code, d.department_id ?? null, d.min_salary_ttd ?? null,
           d.max_salary_ttd ?? null, d.description ?? null],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'HR', action: 'POSITION_CREATED', position_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') { err(res, 409, 'CONFLICT', 'A position with that code already exists.'); return; }
    next(e);
  }
});

hrPositionsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid position id.'); return; }

  const bp = UpdatePositionSchema.safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const { id } = pp.data;
  const upd = bp.data;
  const { userId } = req.rlsCtx;

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (upd.name !== undefined)           sets.push(`name = ${push(upd.name)}`);
  if (upd.code !== undefined)           sets.push(`code = ${push(upd.code)}`);
  if (upd.department_id !== undefined)  sets.push(`department_id = ${push(upd.department_id)}`);
  if (upd.min_salary_ttd !== undefined) sets.push(`min_salary_ttd = ${push(upd.min_salary_ttd)}`);
  if (upd.max_salary_ttd !== undefined) sets.push(`max_salary_ttd = ${push(upd.max_salary_ttd)}`);
  if (upd.description !== undefined)   sets.push(`description = ${push(upd.description)}`);
  if (upd.is_active !== undefined)     sets.push(`is_active = ${push(upd.is_active)}`);
  sets.push(`updated_at = now()`);

  if (sets.length === 1) { err(res, 400, 'NO_CHANGES', 'No fields to update.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE hr_positions SET ${sets.join(', ')} WHERE id = ${push(id)} RETURNING *`,
          params,
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Position not found.'); return; }
      logger.info({ entity: 'HR', action: 'POSITION_UPDATED', position_id: id, user_id: userId });
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrPositionsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid position id.'); return; }

  const { id } = pp.data;
  const { userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE hr_positions SET is_active = false, updated_at = now() WHERE id = $1 RETURNING id`,
          [id],
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Position not found.'); return; }
      logger.info({ entity: 'HR', action: 'POSITION_DEACTIVATED', position_id: id, user_id: userId });
      ok(res, { id });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
