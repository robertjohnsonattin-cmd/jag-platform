// GET    /api/v1/hr/disciplinary          — list disciplinary records
// POST   /api/v1/hr/disciplinary          — create record
// PATCH  /api/v1/hr/disciplinary/:id      — update record
// DELETE /api/v1/hr/disciplinary/:id      — delete record

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const hrDisciplinaryRouter = Router();
hrDisciplinaryRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;

const CreateDisciplinarySchema = z.object({
  employee_id:              z.string().uuid(),
  incident_date:            z.string().regex(DATE_RE),
  reported_date:            z.string().regex(DATE_RE).optional(),
  incident_type:            z.enum(['TARDINESS','INSUBORDINATION','MISCONDUCT','PERFORMANCE','POLICY_VIOLATION','ATTENDANCE','HEALTH_SAFETY','OTHER']),
  severity:                 z.enum(['VERBAL_WARNING','WRITTEN_WARNING','FINAL_WARNING','SUSPENSION','DISMISSAL']),
  description:              z.string().min(1).max(5000),
  action_taken:             z.string().max(5000).optional(),
  outcome:                  z.string().max(5000).optional(),
  investigation_conducted:  z.boolean().default(false),
  union_involved:           z.boolean().default(false),
  appeal_filed:             z.boolean().default(false),
  appeal_outcome:           z.string().max(2000).optional(),
  issued_by_employee_id:    z.string().uuid().optional(),
  document_url:             z.string().max(2000).optional(),
}).strict();

const ListQuerySchema = z.object({
  employee_id: z.string().uuid().optional(),
  severity:    z.enum(['VERBAL_WARNING','WRITTEN_WARNING','FINAL_WARNING','SUSPENSION','DISMISSAL']).optional(),
  limit:       z.coerce.number().int().min(1).max(500).default(50),
  offset:      z.coerce.number().int().min(0).default(0),
});

hrDisciplinaryRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const q = ListQuerySchema.safeParse(req.query);
  if (!q.success) { err(res, 400, 'VALIDATION_ERROR', q.error.message); return; }

  const { employee_id, severity, limit, offset } = q.data;
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (employee_id) where.push(`dr.employee_id = ${push(employee_id)}`);
  if (severity)    where.push(`dr.severity = ${push(severity)}`);
  const wc = where.length ? `AND ${where.join(' AND ')}` : '';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT dr.*,
                 e.first_name  || ' ' || e.last_name  AS employee_name,
                 ib.first_name || ' ' || ib.last_name AS issued_by_name
          FROM hr_disciplinary_records dr
          JOIN hr_employees e   ON e.id   = dr.employee_id
          LEFT JOIN hr_employees ib ON ib.id = dr.issued_by_employee_id
          WHERE dr.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ${wc}
          ORDER BY dr.incident_date DESC
          LIMIT ${push(limit)} OFFSET ${push(offset)}
        `, params).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrDisciplinaryRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateDisciplinarySchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO hr_disciplinary_records
             (tenant_id, employee_id, incident_date, reported_date, incident_type, severity,
              description, action_taken, outcome, investigation_conducted, union_involved,
              appeal_filed, appeal_outcome, issued_by_employee_id, document_url, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
          [tenantId, d.employee_id, d.incident_date, d.reported_date ?? null,
           d.incident_type, d.severity, d.description, d.action_taken ?? null,
           d.outcome ?? null, d.investigation_conducted, d.union_involved, d.appeal_filed,
           d.appeal_outcome ?? null, d.issued_by_employee_id ?? null, d.document_url ?? null, userId],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'HR', action: 'DISCIPLINARY_RECORD_CREATED', record_id: row.id, employee_id: d.employee_id, user_id: userId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrDisciplinaryRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid record id.'); return; }

  const bp = CreateDisciplinarySchema.omit({ employee_id: true }).partial().safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const upd = bp.data;
  const { userId } = req.rlsCtx;
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  const fields: Array<[string, unknown]> = [
    ['incident_date', upd.incident_date], ['reported_date', upd.reported_date],
    ['incident_type', upd.incident_type], ['severity', upd.severity],
    ['description', upd.description], ['action_taken', upd.action_taken],
    ['outcome', upd.outcome], ['investigation_conducted', upd.investigation_conducted],
    ['union_involved', upd.union_involved], ['appeal_filed', upd.appeal_filed],
    ['appeal_outcome', upd.appeal_outcome], ['issued_by_employee_id', upd.issued_by_employee_id],
    ['document_url', upd.document_url],
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
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE hr_disciplinary_records SET ${sets.join(', ')} WHERE id = ${push(pp.data.id)} RETURNING *`,
          params,
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Disciplinary record not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrDisciplinaryRouter.patch('/:id/acknowledge', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid record id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE hr_disciplinary_records SET acknowledged_by_employee = true, acknowledged_at = now(), updated_at = now()
           WHERE id = $1 RETURNING *`,
          [pp.data.id],
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Disciplinary record not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrDisciplinaryRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid record id.'); return; }

  const { userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM hr_disciplinary_records WHERE id = $1 RETURNING id`, [pp.data.id])
          .then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Disciplinary record not found.'); return; }
      logger.info({ entity: 'HR', action: 'DISCIPLINARY_RECORD_DELETED', record_id: pp.data.id, user_id: userId });
      ok(res, { id: pp.data.id });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
