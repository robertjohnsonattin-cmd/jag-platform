// GET    /api/v1/hr/recruitment/postings                   — list job postings
// POST   /api/v1/hr/recruitment/postings                   — create posting
// PATCH  /api/v1/hr/recruitment/postings/:id               — update posting
// DELETE /api/v1/hr/recruitment/postings/:id               — delete posting
// GET    /api/v1/hr/recruitment/applications               — list applications
// POST   /api/v1/hr/recruitment/applications               — add applicant
// PATCH  /api/v1/hr/recruitment/applications/:id           — update application
// POST   /api/v1/hr/recruitment/applications/:id/advance   — advance pipeline stage
// POST   /api/v1/hr/recruitment/applications/:id/hire      — mark as hired (link employee)
// GET    /api/v1/hr/recruitment/interviews                 — list interviews
// POST   /api/v1/hr/recruitment/interviews                 — schedule interview
// PATCH  /api/v1/hr/recruitment/interviews/:id             — update interview

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const hrRecruitmentRouter = Router();
hrRecruitmentRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;

// ── Job Postings ──────────────────────────────────────────────────────────────
const CreatePostingSchema = z.object({
  position_id:    z.string().uuid().optional(),
  department_id:  z.string().uuid().optional(),
  title:          z.string().min(1).max(200),
  description:    z.string().max(5000).optional(),
  requirements:   z.string().max(5000).optional(),
  salary_min_ttd: z.number().min(0).optional(),
  salary_max_ttd: z.number().min(0).optional(),
  employment_type: z.enum(['FULL_TIME','PART_TIME','CONTRACT','CASUAL']).default('FULL_TIME'),
  location:       z.string().max(200).optional(),
  vacancies:      z.number().int().min(1).default(1),
  status:         z.enum(['DRAFT','OPEN','CLOSED','FILLED','CANCELLED']).default('DRAFT'),
  posted_date:    z.string().regex(DATE_RE).optional(),
  closing_date:   z.string().regex(DATE_RE).optional(),
}).strict();

hrRecruitmentRouter.get('/postings', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const q = z.object({
    status: z.enum(['DRAFT','OPEN','CLOSED','FILLED','CANCELLED']).optional(),
    limit:  z.coerce.number().int().min(1).max(500).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }).safeParse(req.query);
  if (!q.success) { err(res, 400, 'VALIDATION_ERROR', q.error.message); return; }

  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const wc   = q.data.status ? `AND jp.status = ${push(q.data.status)}` : '';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT jp.*,
                 p.name AS position_name, d.name AS department_name,
                 COUNT(a.id) AS application_count
          FROM hr_job_postings jp
          LEFT JOIN hr_positions   p ON p.id = jp.position_id
          LEFT JOIN hr_departments d ON d.id = jp.department_id
          LEFT JOIN hr_job_applications a ON a.job_posting_id = jp.id
          WHERE jp.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ${wc}
          GROUP BY jp.id, p.name, d.name
          ORDER BY jp.created_at DESC
          LIMIT ${push(q.data.limit)} OFFSET ${push(q.data.offset)}
        `, params).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrRecruitmentRouter.post('/postings', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreatePostingSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO hr_job_postings
             (tenant_id, position_id, department_id, title, description, requirements,
              salary_min_ttd, salary_max_ttd, employment_type, location, vacancies, status, posted_date, closing_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [tenantId, d.position_id ?? null, d.department_id ?? null, d.title,
           d.description ?? null, d.requirements ?? null, d.salary_min_ttd ?? null,
           d.salary_max_ttd ?? null, d.employment_type, d.location ?? null, d.vacancies,
           d.status, d.posted_date ?? null, d.closing_date ?? null],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'HR', action: 'JOB_POSTING_CREATED', posting_id: row.id, user_id: userId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrRecruitmentRouter.patch('/postings/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid posting id.'); return; }

  const bp = CreatePostingSchema.partial().safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const upd = bp.data;
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  const fields: Array<[string, unknown]> = [
    ['position_id', upd.position_id], ['department_id', upd.department_id],
    ['title', upd.title], ['description', upd.description],
    ['requirements', upd.requirements], ['salary_min_ttd', upd.salary_min_ttd],
    ['salary_max_ttd', upd.salary_max_ttd], ['employment_type', upd.employment_type],
    ['location', upd.location], ['vacancies', upd.vacancies],
    ['status', upd.status], ['posted_date', upd.posted_date], ['closing_date', upd.closing_date],
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
          `UPDATE hr_job_postings SET ${sets.join(', ')} WHERE id = ${push(pp.data.id)} RETURNING *`,
          params,
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Job posting not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrRecruitmentRouter.delete('/postings/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid posting id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM hr_job_postings WHERE id = $1 AND status = 'DRAFT' RETURNING id`, [pp.data.id])
          .then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Posting not found or not deletable (only DRAFT postings can be deleted).'); return; }
      ok(res, { id: pp.data.id });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Applications ──────────────────────────────────────────────────────────────
const CreateApplicationSchema = z.object({
  job_posting_id:       z.string().uuid(),
  applicant_name:       z.string().min(1).max(200),
  email:                z.string().email().max(200).optional(),
  phone:                z.string().max(30).optional(),
  address:              z.string().max(500).optional(),
  current_employer:     z.string().max(200).optional(),
  current_title:        z.string().max(200).optional(),
  years_experience:     z.number().int().min(0).max(60).optional(),
  cv_url:               z.string().max(2000).optional(),
  cover_letter_url:     z.string().max(2000).optional(),
  source:               z.enum(['WALK_IN','REFERRAL','ONLINE','NEWSPAPER','INDEED','LINKEDIN','OTHER']).default('OTHER'),
  referral_employee_id: z.string().uuid().optional(),
  notes:                z.string().max(2000).optional(),
}).strict();

const STAGE_ORDER: string[] = ['APPLIED','SCREENING','INTERVIEW','ASSESSMENT','OFFER','HIRED'];

hrRecruitmentRouter.get('/applications', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const q = z.object({
    job_posting_id: z.string().uuid().optional(),
    stage:          z.string().optional(),
    limit:          z.coerce.number().int().min(1).max(500).default(100),
    offset:         z.coerce.number().int().min(0).default(0),
  }).safeParse(req.query);
  if (!q.success) { err(res, 400, 'VALIDATION_ERROR', q.error.message); return; }

  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where: string[] = [];
  if (q.data.job_posting_id) where.push(`a.job_posting_id = ${push(q.data.job_posting_id)}`);
  if (q.data.stage)          where.push(`a.stage = ${push(q.data.stage)}`);
  const wc = where.length ? `AND ${where.join(' AND ')}` : '';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT a.*, jp.title AS job_title
          FROM hr_job_applications a
          JOIN hr_job_postings jp ON jp.id = a.job_posting_id
          WHERE a.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ${wc}
          ORDER BY a.created_at DESC
          LIMIT ${push(q.data.limit)} OFFSET ${push(q.data.offset)}
        `, params).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrRecruitmentRouter.post('/applications', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateApplicationSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO hr_job_applications
             (tenant_id, job_posting_id, applicant_name, email, phone, address,
              current_employer, current_title, years_experience, cv_url, cover_letter_url,
              source, referral_employee_id, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [tenantId, d.job_posting_id, d.applicant_name, d.email ?? null, d.phone ?? null,
           d.address ?? null, d.current_employer ?? null, d.current_title ?? null,
           d.years_experience ?? null, d.cv_url ?? null, d.cover_letter_url ?? null,
           d.source, d.referral_employee_id ?? null, d.notes ?? null],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'HR', action: 'APPLICATION_RECEIVED', application_id: row.id, user_id: userId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrRecruitmentRouter.patch('/applications/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid application id.'); return; }

  const bp = CreateApplicationSchema.omit({ job_posting_id: true }).partial().extend({
    rejection_reason: z.string().max(1000).optional(),
  }).safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const upd = bp.data;
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  const fields: Array<[string, unknown]> = [
    ['applicant_name', upd.applicant_name], ['email', upd.email], ['phone', upd.phone],
    ['current_employer', upd.current_employer], ['current_title', upd.current_title],
    ['years_experience', upd.years_experience], ['cv_url', upd.cv_url],
    ['cover_letter_url', upd.cover_letter_url], ['notes', upd.notes],
    ['rejection_reason', (upd as { rejection_reason?: string }).rejection_reason],
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
          `UPDATE hr_job_applications SET ${sets.join(', ')} WHERE id = ${push(pp.data.id)} RETURNING *`,
          params,
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Application not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrRecruitmentRouter.post('/applications/:id/advance', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid application id.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const app = await c.query(`SELECT * FROM hr_job_applications WHERE id = $1`, [pp.data.id])
          .then((r) => r.rows[0] ?? null);
        if (!app) return null;

        const currentIdx = STAGE_ORDER.indexOf(app.stage as string);
        if (currentIdx < 0 || currentIdx >= STAGE_ORDER.length - 1) {
          throw Object.assign(new Error('Application cannot be advanced further.'), { status: 409 });
        }
        const nextStage = STAGE_ORDER[currentIdx + 1];

        return c.query(
          `UPDATE hr_job_applications SET stage = $1, updated_at = now() WHERE id = $2 RETURNING *`,
          [nextStage, pp.data.id],
        ).then((r) => r.rows[0]);
      });

      if (!row) { err(res, 404, 'NOT_FOUND', 'Application not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; message: string };
    if (ex.status === 409) { err(res, 409, 'CONFLICT', ex.message); return; }
    next(e);
  }
});

hrRecruitmentRouter.post('/applications/:id/hire', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid application id.'); return; }

  const bp = z.object({ hired_employee_id: z.string().uuid() }).safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE hr_job_applications SET stage = 'HIRED', hired_employee_id = $1, updated_at = now()
           WHERE id = $2 RETURNING *`,
          [bp.data.hired_employee_id, pp.data.id],
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Application not found.'); return; }
      logger.info({ entity: 'HR', action: 'APPLICANT_HIRED', application_id: pp.data.id, employee_id: bp.data.hired_employee_id });
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Interviews ────────────────────────────────────────────────────────────────
const CreateInterviewSchema = z.object({
  application_id:          z.string().uuid(),
  interview_type:          z.enum(['PHONE','VIDEO','IN_PERSON','PANEL','TECHNICAL']).default('IN_PERSON'),
  scheduled_at:            z.string(),  // ISO datetime
  duration_minutes:        z.number().int().min(15).max(480).default(60),
  location:                z.string().max(300).optional(),
  interviewer_employee_id: z.string().uuid().optional(),
  notes:                   z.string().max(2000).optional(),
}).strict();

hrRecruitmentRouter.get('/interviews', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const q = z.object({
    application_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50),
  }).safeParse(req.query);
  if (!q.success) { err(res, 400, 'VALIDATION_ERROR', q.error.message); return; }

  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const wc   = q.data.application_id ? `AND i.application_id = ${push(q.data.application_id)}` : '';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`
          SELECT i.*,
                 a.applicant_name,
                 e.first_name || ' ' || e.last_name AS interviewer_name
          FROM hr_interviews i
          JOIN hr_job_applications a ON a.id = i.application_id
          LEFT JOIN hr_employees e  ON e.id  = i.interviewer_employee_id
          WHERE i.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ${wc}
          ORDER BY i.scheduled_at DESC
          LIMIT ${push(q.data.limit)}
        `, params).then((r) => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrRecruitmentRouter.post('/interviews', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateInterviewSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO hr_interviews
             (tenant_id, application_id, interview_type, scheduled_at, duration_minutes, location, interviewer_employee_id, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [tenantId, d.application_id, d.interview_type, d.scheduled_at, d.duration_minutes,
           d.location ?? null, d.interviewer_employee_id ?? null, d.notes ?? null],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'HR', action: 'INTERVIEW_SCHEDULED', interview_id: row.id, user_id: userId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

hrRecruitmentRouter.patch('/interviews/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const pp = UUIDParam.safeParse(req.params);
  if (!pp.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid interview id.'); return; }

  const bp = z.object({
    status:                  z.enum(['SCHEDULED','COMPLETED','CANCELLED','NO_SHOW']).optional(),
    scheduled_at:            z.string().optional(),
    duration_minutes:        z.number().int().optional(),
    location:                z.string().max(300).nullable().optional(),
    interviewer_employee_id: z.string().uuid().nullable().optional(),
    rating:                  z.number().int().min(1).max(5).nullable().optional(),
    notes:                   z.string().max(2000).nullable().optional(),
  }).strict().safeParse(req.body);
  if (!bp.success) { err(res, 400, 'VALIDATION_ERROR', bp.error.message); return; }

  const upd = bp.data;
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  const fields: Array<[string, unknown]> = [
    ['status', upd.status], ['scheduled_at', upd.scheduled_at],
    ['duration_minutes', upd.duration_minutes], ['location', upd.location],
    ['interviewer_employee_id', upd.interviewer_employee_id],
    ['rating', upd.rating], ['notes', upd.notes],
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
          `UPDATE hr_interviews SET ${sets.join(', ')} WHERE id = ${push(pp.data.id)} RETURNING *`,
          params,
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Interview not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
