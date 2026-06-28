// GET    /api/v1/hr/departments      — list departments for current entity
// POST   /api/v1/hr/departments      — create department
// PATCH  /api/v1/hr/departments/:id  — update department
// DELETE /api/v1/hr/departments/:id  — soft-deactivate department

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const hrDepartmentsRouter = Router();
hrDepartmentsRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateDeptSchema = z.object({
  name:                 z.string().min(1).max(200),
  code:                 z.string().max(20).optional(),
  parent_dept_id:       z.string().uuid().optional(),
  manager_employee_id:  z.string().uuid().optional(),
}).strict();

const UpdateDeptSchema = z.object({
  name:                 z.string().min(1).max(200).optional(),
  code:                 z.string().min(1).max(20).optional(),
  parent_dept_id:       z.string().uuid().nullable().optional(),
  manager_employee_id:  z.string().uuid().nullable().optional(),
  is_active:            z.boolean().optional(),
}).strict();

// ── GET / ─────────────────────────────────────────────────────────────────────
hrDepartmentsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT d.*,
                 e.first_name || ' ' || e.last_name AS manager_name
          FROM hr_departments d
          LEFT JOIN hr_employees e ON e.id = d.manager_employee_id
          WHERE d.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            AND d.is_active = true
          ORDER BY d.name
        `).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST / ────────────────────────────────────────────────────────────────────
hrDepartmentsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateDeptSchema.safeParse(req.body);
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
          const base = d.name.split(/\s+/).map((w: string) => w[0] ?? '').join('').toUpperCase().slice(0, 8) || 'DEPT';
          const { rows } = await c.query<{ count: string }>(
            `SELECT COUNT(*) AS count FROM hr_departments WHERE tenant_id = $1 AND code LIKE $2`,
            [tenantId, `${base}%`],
          );
          const n = parseInt(rows[0].count);
          code = n === 0 ? base : `${base}${n + 1}`;
        }
        return c.query(
          `INSERT INTO hr_departments (tenant_id, name, code, parent_dept_id, manager_employee_id)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [tenantId, d.name, code, d.parent_dept_id ?? null, d.manager_employee_id ?? null],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'HR', action: 'DEPARTMENT_CREATED', department_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') { err(res, 409, 'CONFLICT', 'A department with that code already exists for this entity.'); return; }
    next(e);
  }
});

// ── PATCH /:id ────────────────────────────────────────────────────────────────
hrDepartmentsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid department id.'); return; }

  const bp = UpdateDeptSchema.safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const { id } = pp.data;
  const upd = bp.data;
  const { userId } = req.rlsCtx;

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (upd.name !== undefined)               sets.push(`name = ${push(upd.name)}`);
  if (upd.code !== undefined)               sets.push(`code = ${push(upd.code)}`);
  if (upd.parent_dept_id !== undefined)     sets.push(`parent_dept_id = ${push(upd.parent_dept_id)}`);
  if (upd.manager_employee_id !== undefined) sets.push(`manager_employee_id = ${push(upd.manager_employee_id)}`);
  if (upd.is_active !== undefined)          sets.push(`is_active = ${push(upd.is_active)}`);
  sets.push(`updated_at = now()`);

  if (sets.length === 1) { err(res, 400, 'NO_CHANGES', 'No fields to update.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE hr_departments SET ${sets.join(', ')} WHERE id = ${push(id)} RETURNING *`,
          params,
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Department not found.'); return; }
      logger.info({ entity: 'HR', action: 'DEPARTMENT_UPDATED', department_id: id, user_id: userId });
      ok(res, row);
    } finally { client.release(); }
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') { err(res, 409, 'CONFLICT', 'A department with that code already exists.'); return; }
    next(e);
  }
});

// ── DELETE /:id (soft — deactivate) ──────────────────────────────────────────
hrDepartmentsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid department id.'); return; }

  const { id } = pp.data;
  const { userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE hr_departments SET is_active = false, updated_at = now() WHERE id = $1 RETURNING id`,
          [id],
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Department not found.'); return; }
      logger.info({ entity: 'HR', action: 'DEPARTMENT_DEACTIVATED', department_id: id, user_id: userId });
      ok(res, { id });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
