// GET    /api/v1/hr/attendance/timesheets                 — list timesheets
// POST   /api/v1/hr/attendance/timesheets                 — create timesheet
// PATCH  /api/v1/hr/attendance/timesheets/:id/submit      — submit for approval
// PATCH  /api/v1/hr/attendance/timesheets/:id/approve     — approve timesheet
// PATCH  /api/v1/hr/attendance/timesheets/:id/reject      — reject timesheet
// GET    /api/v1/hr/attendance/entries                    — list time entries
// POST   /api/v1/hr/attendance/entries                    — add time entry
// PATCH  /api/v1/hr/attendance/entries/:id                — update time entry
// DELETE /api/v1/hr/attendance/entries/:id                — delete time entry

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const hrAttendanceRouter = Router();
hrAttendanceRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;

// ── Timesheets ────────────────────────────────────────────────────────────────
const CreateTimesheetSchema = z.object({
  employee_id:     z.string().uuid(),
  week_start_date: z.string().regex(DATE_RE),
  week_end_date:   z.string().regex(DATE_RE),
}).strict();

const TimesheetsQuerySchema = z.object({
  employee_id:     z.string().uuid().optional(),
  status:          z.enum(['DRAFT','SUBMITTED','APPROVED','REJECTED']).optional(),
  week_start_date: z.string().regex(DATE_RE).optional(),
  limit:           z.coerce.number().int().min(1).max(500).default(50),
  offset:          z.coerce.number().int().min(0).default(0),
});

hrAttendanceRouter.get('/timesheets', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const q = TimesheetsQuerySchema.safeParse(req.query);
  if (!q.success) { err(res, 400, 'VALIDATION_ERROR', q.error.message); return; }

  const { employee_id, status, week_start_date, limit, offset } = q.data;
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (employee_id)     where.push(`ts.employee_id = ${push(employee_id)}`);
  if (status)          where.push(`ts.status = ${push(status)}`);
  if (week_start_date) where.push(`ts.week_start_date = ${push(week_start_date)}`);
  const wc = where.length ? `AND ${where.join(' AND ')}` : '';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT ts.*,
                 e.first_name || ' ' || e.last_name AS employee_name,
                 e.employee_number
          FROM hr_timesheets ts
          JOIN hr_employees e ON e.id = ts.employee_id
          WHERE ts.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ${wc}
          ORDER BY ts.week_start_date DESC, e.last_name
          LIMIT ${push(limit)} OFFSET ${push(offset)}
        `, params).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrAttendanceRouter.post('/timesheets', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateTimesheetSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO hr_timesheets (tenant_id, employee_id, week_start_date, week_end_date)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [tenantId, d.employee_id, d.week_start_date, d.week_end_date],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'HR', action: 'TIMESHEET_CREATED', timesheet_id: row.id, user_id: userId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') { err(res, 409, 'CONFLICT', 'A timesheet already exists for this employee and week.'); return; }
    next(e);
  }
});

const patchTimesheetStatus = (newStatus: 'SUBMITTED' | 'APPROVED' | 'REJECTED', requiredFrom: string[]) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const pp = UUIDParam.safeParse(req.params);
    if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid timesheet id.'); return; }

    const { userId } = req.rlsCtx;
    const rejectionReason = newStatus === 'REJECTED'
      ? z.object({ rejection_reason: z.string().max(500).optional() }).safeParse(req.body).data?.rejection_reason
      : undefined;

    try {
      const client = await commercialPool.connect();
      try {
        const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
          const ts = await c.query(`SELECT status FROM hr_timesheets WHERE id = $1`, [pp.data.id])
            .then((r) => r.rows[0] ?? null);
          if (!ts) return null;
          if (!requiredFrom.includes(ts.status as string)) {
            throw Object.assign(new Error(`Timesheet cannot be ${newStatus.toLowerCase()} from ${ts.status} status.`), { status: 409 });
          }

          const sets = newStatus === 'APPROVED'
            ? `status = '${newStatus}', approved_by = '${userId}', approved_at = now(), updated_at = now()`
            : newStatus === 'REJECTED'
            ? `status = '${newStatus}', rejection_reason = ${rejectionReason ? `'${rejectionReason.replace(/'/g, "''")}'` : 'NULL'}, updated_at = now()`
            : `status = '${newStatus}', updated_at = now()`;

          return c.query(`UPDATE hr_timesheets SET ${sets} WHERE id = $1 RETURNING *`, [pp.data.id])
            .then((r) => r.rows[0]);
        });

        if (!row) { err(res, 404, 'NOT_FOUND', 'Timesheet not found.'); return; }
        ok(res, row);
      } finally { client.release(); }
    } catch (e: unknown) {
      const ex = e as { status?: number; message: string };
      if (ex.status === 409) { err(res, 409, 'CONFLICT', ex.message); return; }
      next(e);
    }
  };

hrAttendanceRouter.patch('/timesheets/:id/submit',  patchTimesheetStatus('SUBMITTED', ['DRAFT']));
hrAttendanceRouter.patch('/timesheets/:id/approve', patchTimesheetStatus('APPROVED', ['SUBMITTED']));
hrAttendanceRouter.patch('/timesheets/:id/reject',  patchTimesheetStatus('REJECTED', ['SUBMITTED']));

// ── Time entries ──────────────────────────────────────────────────────────────
const CreateEntrySchema = z.object({
  employee_id:   z.string().uuid(),
  timesheet_id:  z.string().uuid().optional(),
  entry_date:    z.string().regex(DATE_RE),
  clock_in:      z.string().optional(),  // ISO datetime
  clock_out:     z.string().optional(),
  break_minutes: z.number().int().min(0).max(480).default(0),
  hours_worked:  z.number().min(0).max(24),
  is_overtime:   z.boolean().default(false),
  entry_type:    z.enum(['REGULAR','OVERTIME','PUBLIC_HOLIDAY','SICK','OTHER']).default('REGULAR'),
  notes:         z.string().max(500).optional(),
}).strict();

const EntriesQuerySchema = z.object({
  employee_id:  z.string().uuid().optional(),
  timesheet_id: z.string().uuid().optional(),
  date_from:    z.string().regex(DATE_RE).optional(),
  date_to:      z.string().regex(DATE_RE).optional(),
  limit:        z.coerce.number().int().min(1).max(500).default(50),
  offset:       z.coerce.number().int().min(0).default(0),
});

hrAttendanceRouter.get('/entries', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const q = EntriesQuerySchema.safeParse(req.query);
  if (!q.success) { err(res, 400, 'VALIDATION_ERROR', q.error.message); return; }

  const { employee_id, timesheet_id, date_from, date_to, limit, offset } = q.data;
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (employee_id)  where.push(`te.employee_id = ${push(employee_id)}`);
  if (timesheet_id) where.push(`te.timesheet_id = ${push(timesheet_id)}`);
  if (date_from)    where.push(`te.entry_date >= ${push(date_from)}`);
  if (date_to)      where.push(`te.entry_date <= ${push(date_to)}`);
  const wc = where.length ? `AND ${where.join(' AND ')}` : '';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT te.*,
                 e.first_name || ' ' || e.last_name AS employee_name
          FROM hr_time_entries te
          JOIN hr_employees e ON e.id = te.employee_id
          WHERE te.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ${wc}
          ORDER BY te.entry_date DESC
          LIMIT ${push(limit)} OFFSET ${push(offset)}
        `, params).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrAttendanceRouter.post('/entries', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateEntrySchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const entry = await c.query(
          `INSERT INTO hr_time_entries
             (tenant_id, employee_id, timesheet_id, entry_date, clock_in, clock_out,
              break_minutes, hours_worked, is_overtime, entry_type, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (tenant_id, employee_id, entry_date) DO UPDATE SET
             clock_in = EXCLUDED.clock_in, clock_out = EXCLUDED.clock_out,
             break_minutes = EXCLUDED.break_minutes, hours_worked = EXCLUDED.hours_worked,
             is_overtime = EXCLUDED.is_overtime, entry_type = EXCLUDED.entry_type,
             notes = EXCLUDED.notes, updated_at = now()
           RETURNING *`,
          [tenantId, d.employee_id, d.timesheet_id ?? null, d.entry_date,
           d.clock_in ?? null, d.clock_out ?? null, d.break_minutes, d.hours_worked,
           d.is_overtime, d.entry_type, d.notes ?? null],
        ).then((r) => r.rows[0]);

        // Keep timesheet total_hours in sync
        if (entry.timesheet_id) {
          await c.query(
            `UPDATE hr_timesheets SET
               total_hours          = (SELECT COALESCE(SUM(hours_worked), 0) FROM hr_time_entries WHERE timesheet_id = $1),
               total_overtime_hours = (SELECT COALESCE(SUM(hours_worked), 0) FROM hr_time_entries WHERE timesheet_id = $1 AND is_overtime = true),
               updated_at           = now()
             WHERE id = $1`,
            [entry.timesheet_id],
          );
        }

        return entry;
      });
      logger.info({ entity: 'HR', action: 'TIME_ENTRY_ADDED', entry_id: row.id, user_id: userId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrAttendanceRouter.patch('/entries/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid entry id.'); return; }

  const bp = CreateEntrySchema.omit({ employee_id: true, entry_date: true }).partial().safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const upd = bp.data;
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  const fields: Array<[string, unknown]> = [
    ['timesheet_id', upd.timesheet_id], ['clock_in', upd.clock_in],
    ['clock_out', upd.clock_out], ['break_minutes', upd.break_minutes],
    ['hours_worked', upd.hours_worked], ['is_overtime', upd.is_overtime],
    ['entry_type', upd.entry_type], ['notes', upd.notes],
  ];
  for (const [col, val] of fields) {
    if (val !== undefined) sets.push(`${col} = ${push(val)}`);
  }
  sets.push(`updated_at = now()`);
  if (sets.length === 1) { err(res, 400, 'NO_CHANGES', 'No fields to update.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const updated = await c.query(
          `UPDATE hr_time_entries SET ${sets.join(', ')} WHERE id = ${push(pp.data.id)} RETURNING *`,
          params,
        ).then((r) => r.rows[0] ?? null);

        if (updated?.timesheet_id) {
          await c.query(
            `UPDATE hr_timesheets SET
               total_hours          = (SELECT COALESCE(SUM(hours_worked), 0) FROM hr_time_entries WHERE timesheet_id = $1),
               total_overtime_hours = (SELECT COALESCE(SUM(hours_worked), 0) FROM hr_time_entries WHERE timesheet_id = $1 AND is_overtime = true),
               updated_at           = now()
             WHERE id = $1`,
            [updated.timesheet_id],
          );
        }
        return updated;
      });
      if (!row) { err(res, 404, 'NOT_FOUND', 'Time entry not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrAttendanceRouter.delete('/entries/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid entry id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM hr_time_entries WHERE id = $1 RETURNING id, timesheet_id`, [pp.data.id])
          .then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Time entry not found.'); return; }

      // Sync timesheet total if applicable
      if (row.timesheet_id) {
        const tsClient = await commercialPool.connect();
        try {
          await withTenantRLS(tsClient, req.rlsCtx, (c) =>
            c.query(
              `UPDATE hr_timesheets SET
                 total_hours          = (SELECT COALESCE(SUM(hours_worked), 0) FROM hr_time_entries WHERE timesheet_id = $1),
                 total_overtime_hours = (SELECT COALESCE(SUM(hours_worked), 0) FROM hr_time_entries WHERE timesheet_id = $1 AND is_overtime = true),
                 updated_at           = now()
               WHERE id = $1`,
              [row.timesheet_id],
            ),
          );
        } finally { tsClient.release(); }
      }

      ok(res, { id: pp.data.id });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
