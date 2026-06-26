// GET    /api/v1/hr/training/types          — list training types
// POST   /api/v1/hr/training/types          — create training type
// GET    /api/v1/hr/training/records        — list training records
// POST   /api/v1/hr/training/records        — add training record
// PATCH  /api/v1/hr/training/records/:id    — update record
// DELETE /api/v1/hr/training/records/:id    — delete record

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const hrTrainingRouter = Router();
hrTrainingRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;
const optDate   = z.string().regex(DATE_RE).nullable().optional();

// ── Training types ────────────────────────────────────────────────────────────
hrTrainingRouter.get('/types', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM hr_training_types
                 WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
                 AND is_active = true ORDER BY name`).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

const CreateTypeSchema = z.object({
  name:        z.string().min(1).max(200),
  category:    z.string().max(100).optional(),
  description: z.string().max(1000).optional(),
}).strict();

hrTrainingRouter.post('/types', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateTypeSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO hr_training_types (tenant_id, name, category, description) VALUES ($1,$2,$3,$4) RETURNING *`,
          [tenantId, d.name, d.category ?? null, d.description ?? null],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'HR', action: 'TRAINING_TYPE_CREATED', type_id: row.id, user_id: userId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Training records ──────────────────────────────────────────────────────────
const CreateRecordSchema = z.object({
  employee_id:       z.string().uuid(),
  training_type_id:  z.string().uuid().optional(),
  training_name:     z.string().min(1).max(300),
  provider:          z.string().max(200).optional(),
  training_date:     optDate,
  expiry_date:       optDate,
  certificate_number: z.string().max(100).optional(),
  certificate_url:   z.string().max(2000).optional(),
  cost_ttd:          z.number().min(0).optional(),
  status:            z.enum(['PLANNED','COMPLETED','EXPIRED','CANCELLED']).default('PLANNED'),
  notes:             z.string().max(2000).optional(),
}).strict();

const RecordsQuerySchema = z.object({
  employee_id: z.string().uuid().optional(),
  status:      z.enum(['PLANNED','COMPLETED','EXPIRED','CANCELLED']).optional(),
  expiring:    z.coerce.boolean().optional(),   // true = expiry_date within next 60 days
  limit:       z.coerce.number().int().min(1).max(500).default(100),
  offset:      z.coerce.number().int().min(0).default(0),
});

hrTrainingRouter.get('/records', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const q = RecordsQuerySchema.safeParse(req.query);
  if (!q.success) { err(res, 400, 'VALIDATION_ERROR', q.error.message); return; }

  const { employee_id, status, expiring, limit, offset } = q.data;
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (employee_id) where.push(`r.employee_id = ${push(employee_id)}`);
  if (status)      where.push(`r.status = ${push(status)}`);
  if (expiring)    where.push(`r.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days'`);
  const wc = where.length ? `AND ${where.join(' AND ')}` : '';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT r.*,
                 e.first_name || ' ' || e.last_name AS employee_name,
                 t.name AS training_type_name,
                 CASE
                   WHEN r.expiry_date < CURRENT_DATE THEN 'EXPIRED'
                   WHEN r.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'EXPIRING_SOON'
                   ELSE 'VALID'
                 END AS expiry_status
          FROM hr_training_records r
          JOIN hr_employees       e ON e.id = r.employee_id
          LEFT JOIN hr_training_types t ON t.id = r.training_type_id
          WHERE r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ${wc}
          ORDER BY r.training_date DESC
          LIMIT ${push(limit)} OFFSET ${push(offset)}
        `, params).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrTrainingRouter.post('/records', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateRecordSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO hr_training_records
             (tenant_id, employee_id, training_type_id, training_name, provider,
              training_date, expiry_date, certificate_number, certificate_url, cost_ttd, status, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [tenantId, d.employee_id, d.training_type_id ?? null, d.training_name, d.provider ?? null,
           d.training_date ?? null, d.expiry_date ?? null, d.certificate_number ?? null,
           d.certificate_url ?? null, d.cost_ttd ?? null, d.status, d.notes ?? null],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'HR', action: 'TRAINING_RECORD_ADDED', record_id: row.id, user_id: userId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrTrainingRouter.patch('/records/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid record id.'); return; }

  const bp = CreateRecordSchema.omit({ employee_id: true }).partial().safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const upd = bp.data;
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  const fields: Array<[string, unknown]> = [
    ['training_type_id', upd.training_type_id], ['training_name', upd.training_name],
    ['provider', upd.provider], ['training_date', upd.training_date],
    ['expiry_date', upd.expiry_date], ['certificate_number', upd.certificate_number],
    ['certificate_url', upd.certificate_url], ['cost_ttd', upd.cost_ttd],
    ['status', upd.status], ['notes', upd.notes],
  ];
  for (const [col, val] of fields) {
    if (val !== undefined) sets.push(`${col} = ${push(val)}`);
  }
  sets.push(`updated_at = now()`);
  if (sets.length === 1) { err(res, 400, 'NO_CHANGES', 'No fields to update.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE hr_training_records SET ${sets.join(', ')} WHERE id = ${push(pp.data.id)} RETURNING *`,
          params,
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Training record not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrTrainingRouter.delete('/records/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid record id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM hr_training_records WHERE id = $1 RETURNING id`, [pp.data.id])
          .then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Training record not found.'); return; }
      ok(res, { id: pp.data.id });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
