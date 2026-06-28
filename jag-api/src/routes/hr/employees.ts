// GET    /api/v1/hr/employees                           — list employees
// GET    /api/v1/hr/employees/:id                       — get employee detail
// POST   /api/v1/hr/employees                           — create employee
// PATCH  /api/v1/hr/employees/:id                       — update employee
// POST   /api/v1/hr/employees/:id/terminate             — terminate employee
// GET    /api/v1/hr/employees/:id/emergency-contacts    — list emergency contacts
// POST   /api/v1/hr/employees/:id/emergency-contacts    — add emergency contact
// DELETE /api/v1/hr/employees/:id/emergency-contacts/:ecId — remove contact
// GET    /api/v1/hr/employees/:id/history               — employment history

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const hrEmployeesRouter = Router();
hrEmployeesRouter.use(requireAuth());

const UUIDParam  = z.object({ id: z.string().uuid() });
const ECParam    = z.object({ id: z.string().uuid(), ecId: z.string().uuid() });
const DATE_RE    = /^\d{4}-\d{2}-\d{2}$/;
const optDate    = z.preprocess(v => (v === '' ? undefined : v), z.string().regex(DATE_RE).nullable().optional());

const CreateEmployeeSchema = z.object({
  employee_number:    z.string().max(30).optional(),
  first_name:         z.string().min(1).max(100),
  last_name:          z.string().min(1).max(100),
  preferred_name:     z.string().max(100).optional(),
  date_of_birth:      optDate,
  gender:             z.string().max(20).optional(),
  nationality:        z.string().max(100).optional(),
  id_type:            z.enum(['NATIONAL_ID','PASSPORT','DRIVERS_LICENCE','OTHER']).optional(),
  id_number:          z.string().max(50).optional(),
  nis_number:         z.string().max(30).optional(),
  birs_tax_id:        z.string().max(30).optional(),
  address:            z.string().max(500).optional(),
  city:               z.string().max(100).optional(),
  email:              z.string().email().max(200).optional(),
  phone:              z.string().max(30).optional(),
  phone2:             z.string().max(30).optional(),
  position_id:        z.string().uuid().optional(),
  department_id:      z.string().uuid().optional(),
  manager_id:         z.string().uuid().optional(),
  employment_type:    z.enum(['FULL_TIME','PART_TIME','CONTRACT','CASUAL']).default('FULL_TIME'),
  hire_date:          z.preprocess(v => (v === '' ? undefined : v), z.string().regex(DATE_RE).optional()),
  probation_end_date: optDate,
  base_salary_ttd:    z.coerce.number().min(0).default(0),
  pay_frequency:      z.enum(['MONTHLY','BIWEEKLY','WEEKLY']).default('MONTHLY'),
  bank_name:          z.string().max(200).optional(),
  bank_branch:        z.string().max(200).optional(),
  account_number:     z.string().max(50).optional(),
  account_type:       z.string().max(20).optional(),
  notes:              z.string().max(2000).optional(),
  crm_contact_id:     z.string().uuid().optional(),
}).strict();

const UpdateEmployeeSchema = CreateEmployeeSchema.partial().omit({ employee_number: true, hire_date: true });

const TerminateSchema = z.object({
  termination_date:   z.string().regex(DATE_RE),
  termination_reason: z.string().max(1000).optional(),
}).strict();

const EmergencyContactSchema = z.object({
  name:         z.string().min(1).max(200),
  relationship: z.string().min(1).max(100),
  phone:        z.string().min(1).max(30),
  phone2:       z.string().max(30).optional(),
  email:        z.string().email().max(200).optional(),
}).strict();

const ListQuerySchema = z.object({
  status:        z.enum(['ACTIVE','INACTIVE','TERMINATED','ON_LEAVE']).optional(),
  department_id: z.string().uuid().optional(),
  search:        z.string().max(100).optional(),
  limit:         z.coerce.number().int().min(1).max(500).default(100),
  offset:        z.coerce.number().int().min(0).default(0),
});

// ── GET / ─────────────────────────────────────────────────────────────────────
hrEmployeesRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const q = ListQuerySchema.safeParse(req.query);
  if (!q.success) { err(res, 400, 'VALIDATION_ERROR', q.error.message); return; }

  const { status, department_id, search, limit, offset } = q.data;

  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (status)        where.push(`e.status = ${push(status)}`);
  if (department_id) where.push(`e.department_id = ${push(department_id)}`);
  if (search)        where.push(`(e.first_name ILIKE ${push(`%${search}%`)} OR e.last_name ILIKE $${params.length} OR e.employee_number ILIKE $${params.length})`);

  const whereClause = where.length ? `AND ${where.join(' AND ')}` : '';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT e.*,
                 p.name AS position_name,
                 d.name AS department_name,
                 m.first_name || ' ' || m.last_name AS manager_name
          FROM hr_employees e
          LEFT JOIN hr_positions   p ON p.id = e.position_id
          LEFT JOIN hr_departments d ON d.id = e.department_id
          LEFT JOIN hr_employees   m ON m.id = e.manager_id
          WHERE e.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ${whereClause}
          ORDER BY e.last_name, e.first_name
          LIMIT ${push(limit)} OFFSET ${push(offset)}
        `, params).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
hrEmployeesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid employee id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT e.*,
                 p.name AS position_name, p.code AS position_code,
                 d.name AS department_name, d.code AS department_code,
                 m.first_name || ' ' || m.last_name AS manager_name
          FROM hr_employees e
          LEFT JOIN hr_positions   p ON p.id = e.position_id
          LEFT JOIN hr_departments d ON d.id = e.department_id
          LEFT JOIN hr_employees   m ON m.id = e.manager_id
          WHERE e.id = $1
        `, [pp.data.id]).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Employee not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST / ────────────────────────────────────────────────────────────────────
hrEmployeesRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateEmployeeSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Auto-generate employee number if not provided
        let empNumber = d.employee_number?.trim() || '';
        if (!empNumber) {
          const { rows: [seq] } = await c.query<{ n: string }>(
            `SELECT LPAD(((COALESCE(MAX(SUBSTRING(employee_number FROM 'EMP-(\\d+)')::int), 0) + 1)::text), 4, '0') AS n
             FROM hr_employees WHERE tenant_id = $1 AND employee_number LIKE 'EMP-%'`,
            [tenantId],
          );
          empNumber = `EMP-${seq.n}`;
        }

        const emp = await c.query(
          `INSERT INTO hr_employees
             (tenant_id, employee_number, first_name, last_name, preferred_name,
              date_of_birth, gender, nationality, id_type, id_number,
              nis_number, birs_tax_id, address, city, email, phone, phone2,
              position_id, department_id, manager_id, employment_type,
              hire_date, probation_end_date, base_salary_ttd, pay_frequency,
              bank_name, bank_branch, account_number, account_type,
              notes, crm_contact_id, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                   $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
           RETURNING *`,
          [tenantId, empNumber, d.first_name, d.last_name, d.preferred_name ?? null,
           d.date_of_birth ?? null, d.gender ?? null, d.nationality ?? null,
           d.id_type ?? null, d.id_number ?? null, d.nis_number ?? null, d.birs_tax_id ?? null,
           d.address ?? null, d.city ?? null, d.email ?? null, d.phone ?? null, d.phone2 ?? null,
           d.position_id ?? null, d.department_id ?? null, d.manager_id ?? null, d.employment_type,
           d.hire_date ?? today, d.probation_end_date ?? null, d.base_salary_ttd, d.pay_frequency,
           d.bank_name ?? null, d.bank_branch ?? null, d.account_number ?? null, d.account_type ?? null,
           d.notes ?? null, d.crm_contact_id ?? null, userId],
        ).then((r) => r.rows[0]);

        // Record initial hire in employment history
        await c.query(
          `INSERT INTO hr_employment_history
             (tenant_id, employee_id, effective_date, change_type,
              new_position, new_salary_ttd, change_reason, changed_by)
           VALUES ($1,$2,$3,'HIRE',$4,$5,'Initial hire',$6)`,
          [tenantId, emp.id, d.hire_date ?? today, d.position_id ?? null, d.base_salary_ttd, userId],
        );

        return emp;
      });
      logger.info({ entity: 'HR', action: 'EMPLOYEE_CREATED', employee_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') { err(res, 409, 'CONFLICT', 'An employee with that number already exists for this entity.'); return; }
    next(e);
  }
});

// ── PATCH /:id ────────────────────────────────────────────────────────────────
hrEmployeesRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid employee id.'); return; }

  const bp = UpdateEmployeeSchema.safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const { id } = pp.data;
  const upd = bp.data;
  const { userId, tenantId } = req.rlsCtx;

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  const fields: Array<[string, unknown]> = [
    ['first_name', upd.first_name], ['last_name', upd.last_name],
    ['preferred_name', upd.preferred_name], ['date_of_birth', upd.date_of_birth],
    ['gender', upd.gender], ['nationality', upd.nationality],
    ['id_type', upd.id_type], ['id_number', upd.id_number],
    ['nis_number', upd.nis_number], ['birs_tax_id', upd.birs_tax_id],
    ['address', upd.address], ['city', upd.city],
    ['email', upd.email], ['phone', upd.phone], ['phone2', upd.phone2],
    ['position_id', upd.position_id], ['department_id', upd.department_id],
    ['manager_id', upd.manager_id], ['employment_type', upd.employment_type],
    ['probation_end_date', upd.probation_end_date],
    ['base_salary_ttd', upd.base_salary_ttd], ['pay_frequency', upd.pay_frequency],
    ['bank_name', upd.bank_name], ['bank_branch', upd.bank_branch],
    ['account_number', upd.account_number], ['account_type', upd.account_type],
    ['notes', upd.notes], ['crm_contact_id', upd.crm_contact_id],
  ];

  for (const [col, val] of fields) {
    if (val !== undefined) sets.push(`${col} = ${push(val)}`);
  }
  sets.push(`last_modified_by = ${push(userId)}`);
  sets.push(`updated_at = now()`);

  if (sets.length === 2) { err(res, 400, 'NO_CHANGES', 'No fields to update.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      // Snapshot previous state to record history if salary or position changed
      const prev = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT base_salary_ttd, position_id, department_id FROM hr_employees WHERE id = $1`, [id])
          .then((r) => r.rows[0]),
      );

      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const updated = await c.query(
          `UPDATE hr_employees SET ${sets.join(', ')} WHERE id = ${push(id)} RETURNING *`,
          params,
        ).then((r) => r.rows[0] ?? null);

        if (!updated) return null;

        // Record history if compensation or position changed
        const salaryChanged   = upd.base_salary_ttd !== undefined
          && parseFloat(String(prev?.base_salary_ttd ?? 0)) !== upd.base_salary_ttd;
        const positionChanged = upd.position_id !== undefined && prev?.position_id !== upd.position_id;

        if (salaryChanged || positionChanged) {
          await c.query(
            `INSERT INTO hr_employment_history
               (tenant_id, employee_id, effective_date, change_type,
                previous_salary_ttd, new_salary_ttd,
                previous_position, new_position, changed_by)
             VALUES ($1,$2,CURRENT_DATE,
                     CASE WHEN $3 THEN 'SALARY_CHANGE' ELSE 'PROMOTION' END,
                     $4,$5,$6,$7,$8)`,
            [tenantId, id, salaryChanged,
             prev?.base_salary_ttd ?? null, upd.base_salary_ttd ?? null,
             prev?.position_id ?? null, upd.position_id ?? null, userId],
          );
        }

        return updated;
      });

      if (!row) { err(res, 404, 'NOT_FOUND', 'Employee not found.'); return; }
      logger.info({ entity: 'HR', action: 'EMPLOYEE_UPDATED', employee_id: id, user_id: userId });
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /:id/terminate ───────────────────────────────────────────────────────
hrEmployeesRouter.post('/:id/terminate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid employee id.'); return; }

  const bp = TerminateSchema.safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const { id } = pp.data;
  const { termination_date, termination_reason } = bp.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const updated = await c.query(
          `UPDATE hr_employees SET status = 'TERMINATED', termination_date = $1,
           termination_reason = $2, last_modified_by = $3, updated_at = now()
           WHERE id = $4 AND status != 'TERMINATED' RETURNING *`,
          [termination_date, termination_reason ?? null, userId, id],
        ).then((r) => r.rows[0] ?? null);

        if (!updated) return null;

        await c.query(
          `INSERT INTO hr_employment_history
             (tenant_id, employee_id, effective_date, change_type, change_reason, changed_by)
           VALUES ($1,$2,$3,'TERMINATION',$4,$5)`,
          [tenantId, id, termination_date, termination_reason ?? null, userId],
        );

        return updated;
      });
      if (!row) { err(res, 404, 'NOT_FOUND', 'Employee not found or already terminated.'); return; }
      logger.info({ entity: 'HR', action: 'EMPLOYEE_TERMINATED', employee_id: id, user_id: userId });
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /:id/emergency-contacts ───────────────────────────────────────────────
hrEmployeesRouter.get('/:id/emergency-contacts', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid employee id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM hr_emergency_contacts WHERE employee_id = $1 ORDER BY created_at`,
          [pp.data.id]).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /:id/emergency-contacts ──────────────────────────────────────────────
hrEmployeesRouter.post('/:id/emergency-contacts', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid employee id.'); return; }

  const bp = EmergencyContactSchema.safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const d = bp.data;
  const { tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO hr_emergency_contacts (tenant_id, employee_id, name, relationship, phone, phone2, email)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [tenantId, pp.data.id, d.name, d.relationship, d.phone, d.phone2 ?? null, d.email ?? null],
        ).then((r) => r.rows[0]),
      );
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /:id/emergency-contacts/:ecId ──────────────────────────────────────
hrEmployeesRouter.delete('/:id/emergency-contacts/:ecId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = ECParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid ids.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM hr_emergency_contacts WHERE id = $1 AND employee_id = $2 RETURNING id`,
          [pp.data.ecId, pp.data.id]).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Emergency contact not found.'); return; }
      ok(res, { id: pp.data.ecId });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /:id/history ──────────────────────────────────────────────────────────
hrEmployeesRouter.get('/:id/history', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid employee id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM hr_employment_history WHERE employee_id = $1 ORDER BY effective_date DESC, created_at DESC`,
          [pp.data.id]).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
