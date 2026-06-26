// GET    /api/v1/hr/performance                    — list reviews
// POST   /api/v1/hr/performance                    — create review
// PATCH  /api/v1/hr/performance/:id                — update review
// DELETE /api/v1/hr/performance/:id                — delete (DRAFT only)
// PATCH  /api/v1/hr/performance/:id/submit         — submit for acknowledgement
// PATCH  /api/v1/hr/performance/:id/acknowledge    — employee acknowledges

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const hrPerformanceRouter = Router();
hrPerformanceRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;
const rating    = z.number().int().min(1).max(5).optional();

const CreateReviewSchema = z.object({
  employee_id:            z.string().uuid(),
  reviewer_id:            z.string().uuid().optional(),
  review_period:          z.enum(['PROBATION','MID_YEAR','ANNUAL']),
  review_year:            z.number().int().min(2020).max(2099),
  review_date:            z.string().regex(DATE_RE).optional(),
  overall_rating:         rating,
  goals_met_rating:       rating,
  competency_rating:      rating,
  attendance_rating:      rating,
  strengths:              z.string().max(3000).optional(),
  areas_for_improvement:  z.string().max(3000).optional(),
  goals_next_period:      z.string().max(3000).optional(),
  employee_comments:      z.string().max(3000).optional(),
}).strict();

const ListQuerySchema = z.object({
  employee_id: z.string().uuid().optional(),
  review_year: z.coerce.number().int().optional(),
  limit:       z.coerce.number().int().min(1).max(500).default(50),
  offset:      z.coerce.number().int().min(0).default(0),
});

hrPerformanceRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const q = ListQuerySchema.safeParse(req.query);
  if (!q.success) { err(res, 400, 'VALIDATION_ERROR', q.error.message); return; }

  const { employee_id, review_year, limit, offset } = q.data;
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (employee_id) where.push(`r.employee_id = ${push(employee_id)}`);
  if (review_year) where.push(`r.review_year = ${push(review_year)}`);
  const wc = where.length ? `AND ${where.join(' AND ')}` : '';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT r.*,
                 e.first_name || ' ' || e.last_name  AS employee_name,
                 rv.first_name || ' ' || rv.last_name AS reviewer_name
          FROM hr_performance_reviews r
          JOIN hr_employees e  ON e.id  = r.employee_id
          LEFT JOIN hr_employees rv ON rv.id = r.reviewer_id
          WHERE r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ${wc}
          ORDER BY r.review_year DESC, r.created_at DESC
          LIMIT ${push(limit)} OFFSET ${push(offset)}
        `, params).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrPerformanceRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateReviewSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO hr_performance_reviews
             (tenant_id, employee_id, reviewer_id, review_period, review_year, review_date,
              overall_rating, goals_met_rating, competency_rating, attendance_rating,
              strengths, areas_for_improvement, goals_next_period, employee_comments)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [tenantId, d.employee_id, d.reviewer_id ?? null, d.review_period, d.review_year,
           d.review_date ?? null, d.overall_rating ?? null, d.goals_met_rating ?? null,
           d.competency_rating ?? null, d.attendance_rating ?? null,
           d.strengths ?? null, d.areas_for_improvement ?? null,
           d.goals_next_period ?? null, d.employee_comments ?? null],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'HR', action: 'REVIEW_CREATED', review_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrPerformanceRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid review id.'); return; }

  const bp = CreateReviewSchema.omit({ employee_id: true, review_period: true, review_year: true }).partial().safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const upd = bp.data;
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  const fields: Array<[string, unknown]> = [
    ['reviewer_id', upd.reviewer_id], ['review_date', upd.review_date],
    ['overall_rating', upd.overall_rating], ['goals_met_rating', upd.goals_met_rating],
    ['competency_rating', upd.competency_rating], ['attendance_rating', upd.attendance_rating],
    ['strengths', upd.strengths], ['areas_for_improvement', upd.areas_for_improvement],
    ['goals_next_period', upd.goals_next_period], ['employee_comments', upd.employee_comments],
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
          `UPDATE hr_performance_reviews SET ${sets.join(', ')} WHERE id = ${push(pp.data.id)} AND status = 'DRAFT' RETURNING *`,
          params,
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Review not found or not editable.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrPerformanceRouter.patch('/:id/submit', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid review id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE hr_performance_reviews SET status = 'SUBMITTED', updated_at = now()
           WHERE id = $1 AND status = 'DRAFT' RETURNING *`,
          [pp.data.id],
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Review not found or already submitted.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrPerformanceRouter.patch('/:id/acknowledge', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid review id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE hr_performance_reviews SET status = 'ACKNOWLEDGED', acknowledged_at = now(), updated_at = now()
           WHERE id = $1 AND status = 'SUBMITTED' RETURNING *`,
          [pp.data.id],
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Review not found or not in SUBMITTED status.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrPerformanceRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid review id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM hr_performance_reviews WHERE id = $1 AND status = 'DRAFT' RETURNING id`, [pp.data.id])
          .then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Review not found or not deletable.'); return; }
      ok(res, { id: pp.data.id });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
