// GET    /api/v1/hr/leave/types                     — list leave types
// POST   /api/v1/hr/leave/types                     — create leave type
// PATCH  /api/v1/hr/leave/types/:id                 — update leave type
// GET    /api/v1/hr/leave/requests                  — list leave requests (pending/all)
// POST   /api/v1/hr/leave/requests                  — submit leave request
// PATCH  /api/v1/hr/leave/requests/:id/approve      — approve request
// PATCH  /api/v1/hr/leave/requests/:id/reject       — reject request
// PATCH  /api/v1/hr/leave/requests/:id/cancel       — cancel request
// GET    /api/v1/hr/leave/balances                  — list balances (query by employee_id / year)
// POST   /api/v1/hr/leave/balances                  — upsert balance

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const hrLeaveRouter = Router();
hrLeaveRouter.use(requireAuth());

const UUIDParam  = z.object({ id: z.string().uuid() });
const DATE_RE    = /^\d{4}-\d{2}-\d{2}$/;

// ── Leave types ───────────────────────────────────────────────────────────────
const CreateLeaveTypeSchema = z.object({
  name:              z.string().min(1).max(100),
  code:              z.string().min(1).max(20),
  days_per_year:     z.number().min(0).max(365).default(14),
  is_paid:           z.boolean().default(true),
  carry_over_days:   z.number().min(0).max(365).default(0),
  requires_approval: z.boolean().default(true),
  description:       z.string().max(1000).optional(),
}).strict();

hrLeaveRouter.get('/types', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM hr_leave_types
                 WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
                 ORDER BY name`).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrLeaveRouter.post('/types', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateLeaveTypeSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO hr_leave_types (tenant_id, name, code, days_per_year, is_paid, carry_over_days, requires_approval, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [tenantId, d.name, d.code, d.days_per_year, d.is_paid, d.carry_over_days,
           d.requires_approval, d.description ?? null],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'HR', action: 'LEAVE_TYPE_CREATED', leave_type_id: row.id, user_id: userId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') { err(res, 409, 'CONFLICT', 'A leave type with that code already exists.'); return; }
    next(e);
  }
});

hrLeaveRouter.patch('/types/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid leave type id.'); return; }

  const bp = CreateLeaveTypeSchema.partial().safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const upd = bp.data;
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (upd.name !== undefined)              sets.push(`name = ${push(upd.name)}`);
  if (upd.days_per_year !== undefined)     sets.push(`days_per_year = ${push(upd.days_per_year)}`);
  if (upd.is_paid !== undefined)           sets.push(`is_paid = ${push(upd.is_paid)}`);
  if (upd.carry_over_days !== undefined)   sets.push(`carry_over_days = ${push(upd.carry_over_days)}`);
  if (upd.requires_approval !== undefined) sets.push(`requires_approval = ${push(upd.requires_approval)}`);
  if (upd.description !== undefined)       sets.push(`description = ${push(upd.description)}`);

  if (!sets.length) { err(res, 400, 'NO_CHANGES', 'No fields to update.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE hr_leave_types SET ${sets.join(', ')} WHERE id = ${push(pp.data.id)} RETURNING *`, params)
          .then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Leave type not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Leave requests ────────────────────────────────────────────────────────────
const SubmitLeaveSchema = z.object({
  employee_id:   z.string().uuid(),
  leave_type_id: z.string().uuid(),
  start_date:    z.string().regex(DATE_RE),
  end_date:      z.string().regex(DATE_RE),
  days_requested: z.number().min(0.5).max(365),
  reason:        z.string().max(1000).optional(),
}).strict();

const RequestsQuerySchema = z.object({
  status:      z.enum(['PENDING','APPROVED','REJECTED','CANCELLED']).optional(),
  employee_id: z.string().uuid().optional(),
  limit:       z.coerce.number().int().min(1).max(500).default(50),
  offset:      z.coerce.number().int().min(0).default(0),
});

hrLeaveRouter.get('/requests', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const q = RequestsQuerySchema.safeParse(req.query);
  if (!q.success) { err(res, 400, 'VALIDATION_ERROR', q.error.message); return; }

  const { status, employee_id, limit, offset } = q.data;
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (status)      where.push(`r.status = ${push(status)}`);
  if (employee_id) where.push(`r.employee_id = ${push(employee_id)}`);
  const wc = where.length ? `AND ${where.join(' AND ')}` : '';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT r.*,
                 e.first_name || ' ' || e.last_name AS employee_name,
                 lt.name AS leave_type_name
          FROM hr_leave_requests r
          JOIN hr_employees   e  ON e.id  = r.employee_id
          JOIN hr_leave_types lt ON lt.id = r.leave_type_id
          WHERE r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ${wc}
          ORDER BY r.created_at DESC
          LIMIT ${push(limit)} OFFSET ${push(offset)}
        `, params).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrLeaveRouter.post('/requests', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = SubmitLeaveSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO hr_leave_requests (tenant_id, employee_id, leave_type_id, start_date, end_date, days_requested, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [tenantId, d.employee_id, d.leave_type_id, d.start_date, d.end_date, d.days_requested, d.reason ?? null],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'HR', action: 'LEAVE_REQUEST_SUBMITTED', request_id: row.id, employee_id: d.employee_id, user_id: userId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrLeaveRouter.patch('/requests/:id/approve', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid request id.'); return; }

  const { userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const req_ = await c.query(`SELECT * FROM hr_leave_requests WHERE id = $1`, [pp.data.id])
          .then((r) => r.rows[0] ?? null);
        if (!req_ || req_.status !== 'PENDING') return null;

        const approved = await c.query(
          `UPDATE hr_leave_requests SET status = 'APPROVED', approved_by = $1, approved_at = now(), updated_at = now()
           WHERE id = $2 RETURNING *`,
          [userId, pp.data.id],
        ).then((r) => r.rows[0]);

        // Deduct from leave balance
        await c.query(
          `INSERT INTO hr_leave_balances (tenant_id, employee_id, leave_type_id, year, entitled_days, used_days)
           VALUES ($1,$2,$3,EXTRACT(YEAR FROM $4::date)::smallint, 0, $5)
           ON CONFLICT (tenant_id, employee_id, leave_type_id, year)
           DO UPDATE SET used_days = hr_leave_balances.used_days + $5, updated_at = now()`,
          [req_.tenant_id, req_.employee_id, req_.leave_type_id, req_.start_date, req_.days_requested],
        );

        return approved;
      });
      if (!row) { err(res, 404, 'NOT_FOUND', 'Leave request not found or not in PENDING status.'); return; }
      logger.info({ entity: 'HR', action: 'LEAVE_APPROVED', request_id: pp.data.id, user_id: userId });
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrLeaveRouter.patch('/requests/:id/reject', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid request id.'); return; }

  const bp = z.object({ rejection_reason: z.string().max(500).optional() }).safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const { userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE hr_leave_requests SET status = 'REJECTED', rejection_reason = $1, updated_at = now()
           WHERE id = $2 AND status = 'PENDING' RETURNING *`,
          [bp.data.rejection_reason ?? null, pp.data.id],
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Leave request not found or not in PENDING status.'); return; }
      logger.info({ entity: 'HR', action: 'LEAVE_REJECTED', request_id: pp.data.id, user_id: userId });
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrLeaveRouter.patch('/requests/:id/cancel', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid request id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE hr_leave_requests SET status = 'CANCELLED', updated_at = now()
           WHERE id = $1 AND status IN ('PENDING','APPROVED') RETURNING *`,
          [pp.data.id],
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Leave request not found or already closed.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Leave balances ────────────────────────────────────────────────────────────
const BalancesQuerySchema = z.object({
  employee_id: z.string().uuid().optional(),
  year:        z.coerce.number().int().min(2020).max(2099).optional(),
});

hrLeaveRouter.get('/balances', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const q = BalancesQuerySchema.safeParse(req.query);
  if (!q.success) { err(res, 400, 'VALIDATION_ERROR', q.error.message); return; }

  const { employee_id, year } = q.data;
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (employee_id) where.push(`b.employee_id = ${push(employee_id)}`);
  if (year)        where.push(`b.year = ${push(year)}`);
  const wc = where.length ? `AND ${where.join(' AND ')}` : '';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT b.*,
                 e.first_name || ' ' || e.last_name AS employee_name,
                 lt.name AS leave_type_name
          FROM hr_leave_balances b
          JOIN hr_employees   e  ON e.id  = b.employee_id
          JOIN hr_leave_types lt ON lt.id = b.leave_type_id
          WHERE b.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ${wc}
          ORDER BY e.last_name, lt.name
        `, params).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

const UpsertBalanceSchema = z.object({
  employee_id:      z.string().uuid(),
  leave_type_id:    z.string().uuid(),
  year:             z.number().int().min(2020).max(2099),
  entitled_days:    z.number().min(0),
  used_days:        z.number().min(0).optional(),
  carried_over_days: z.number().min(0).optional(),
}).strict();

hrLeaveRouter.post('/balances', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = UpsertBalanceSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO hr_leave_balances (tenant_id, employee_id, leave_type_id, year, entitled_days, used_days, carried_over_days)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (tenant_id, employee_id, leave_type_id, year)
           DO UPDATE SET entitled_days = $5, used_days = $6, carried_over_days = $7, updated_at = now()
           RETURNING *`,
          [tenantId, d.employee_id, d.leave_type_id, d.year, d.entitled_days,
           d.used_days ?? 0, d.carried_over_days ?? 0],
        ).then((r) => r.rows[0]),
      );
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
