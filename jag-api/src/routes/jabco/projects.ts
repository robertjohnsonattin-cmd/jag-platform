// GET  /api/v1/jabco/projects
// POST /api/v1/jabco/projects
// GET  /api/v1/jabco/projects/:id
// GET  /api/v1/jabco/projects/:id/boq
// POST /api/v1/jabco/projects/:id/boq
// POST /api/v1/jabco/projects/:id/variation-orders
// POST /api/v1/jabco/projects/:id/progress-claims

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const jabcoProjectsRouter = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────

const UUIDParam    = z.object({ id: z.string().uuid() });
const ProjectParam = z.object({ projectId: z.string().uuid() });

const ProjectsQuerySchema = z.object({
  status: z.enum(['TENDER','ACTIVE','PRACTICAL_COMPLETION','DEFECTS_LIABILITY','CLOSED','CANCELLED']).optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const CreateProjectSchema = z.object({
  project_code:       z.string().min(1).max(50),
  name:               z.string().min(1).max(200),
  client_name:        z.string().min(1).max(200),
  client_type:        z.enum(['GOVERNMENT', 'PRIVATE']),
  contract_value:     z.number().positive(),
  contract_currency:  z.string().length(3).default('TTD'),
  vat_inclusive:      z.boolean().default(false),
  vat_pct:            z.number().min(0).max(100).default(12.5),
  start_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expected_end_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  site_address:       z.string().max(500).optional(),
  project_manager_id: z.string().uuid(),
  idempotency_key:    z.string().uuid(),
}).strict();

const AddBoqItemSchema = z.object({
  section:           z.string().min(1).max(200),
  item_number:       z.string().max(50).optional(),
  description:       z.string().min(1),
  unit:              z.string().min(1).max(20),
  quantity_budgeted: z.number().positive(),
  unit_rate:         z.number().min(0),
}).strict();

const CreateVOSchema = z.object({
  vo_number:       z.string().min(1).max(50),
  description:     z.string().min(1),
  amount:          z.number(),           // can be negative (deduct VO)
  currency:        z.string().length(3).default('TTD'),
  submitted_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  idempotency_key: z.string().uuid(),
}).strict();

const CreateClaimSchema = z.object({
  claim_number:   z.number().int().positive(),
  period_from:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_to:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_claimed: z.number().positive(),
  idempotency_key: z.string().uuid(),
}).strict();

// ── Shared audit helper ───────────────────────────────────────────────────────

async function auditLog(
  tenantId: string,
  userId: string,
  entity: string,
  action: string,
  recordId: string,
  newValues: unknown,
): Promise<void> {
  const client = await corePool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenantId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
    await client.query(
      `INSERT INTO audit_log (tenant_id, user_id, entity, action, record_id, new_values, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'API')`,
      [tenantId, userId, entity, action, recordId, JSON.stringify(newValues)],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    logger.warn({ entity: 'JABCO', action: 'AUDIT_LOG_FAILED', error_message: (e as Error).message, record_id: recordId });
  } finally {
    client.release();
  }
}

// ── GET /projects ─────────────────────────────────────────────────────────────

jabcoProjectsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ProjectsQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }

    const { status, page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const client = await commercialPool.connect();
    try {
      const { rows, total } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (status) conditions.push(`p.status = ${push(status)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await c.query<{ count: string }>(
          `SELECT count(*) FROM jabco_projects p ${where}`, params,
        );

        const dataResult = await c.query(
          `SELECT p.id, p.project_code, p.name, p.client_name, p.client_type,
                  p.status, p.contract_value, p.contract_currency,
                  p.start_date, p.expected_end_date, p.actual_end_date,
                  p.site_address, p.project_manager_id,
                  p.last_modified_at, p.created_at,
                  COALESCE(SUM(b.amount_budgeted), 0)  AS boq_total_budgeted,
                  COALESCE(SUM(b.amount_actual),   0)  AS boq_total_actual
           FROM   jabco_projects p
           LEFT JOIN jabco_boq_items b ON b.project_id = p.id
           ${where}
           GROUP BY p.id
           ORDER BY p.created_at DESC
           LIMIT ${push(limit)} OFFSET ${push(offset)}`,
          params,
        );
        return { rows: dataResult.rows, total: Number(countResult.rows[0].count) };
      });

      logger.info({ entity: 'JABCO', action: 'PROJECTS_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId });
      ok(res, { projects: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /projects ────────────────────────────────────────────────────────────

jabcoProjectsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateProjectSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = parsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const { project, created } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // STD-11 idempotency check.
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM jabco_projects WHERE idempotency_key = $1`,
          [body.idempotency_key],
        );
        if (existing.rows.length > 0) {
          const dup = await c.query(`SELECT * FROM jabco_projects WHERE id = $1`, [existing.rows[0].id]);
          return { project: dup.rows[0], created: false };
        }

        const result = await c.query(
          `INSERT INTO jabco_projects
             (tenant_id, project_code, name, client_name, client_type,
              contract_value, contract_currency, vat_inclusive, vat_pct,
              start_date, expected_end_date,
              site_address, project_manager_id, idempotency_key, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING *`,
          [
            tenantId, body.project_code, body.name, body.client_name, body.client_type,
            body.contract_value, body.contract_currency,
            body.vat_inclusive, body.vat_pct,
            body.start_date ?? null, body.expected_end_date ?? null,
            body.site_address ?? null, body.project_manager_id,
            body.idempotency_key, userId,
          ],
        );
        return { project: result.rows[0], created: true };
      });

      logger.info({ entity: 'JABCO', action: created ? 'PROJECT_CREATED' : 'PROJECT_DUPLICATE', user_id: userId, tenant_id: tenantId, record_id: project.id });
      if (created) await auditLog(tenantId, userId, 'JabcoProject', 'CREATE', project.id, body);
      ok(res, project, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /projects/:id ─────────────────────────────────────────────────────────

jabcoProjectsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const client = await commercialPool.connect();
    try {
      const project = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const [projResult, boqSummary, voResult, claimResult] = await Promise.all([
          c.query(
            `SELECT * FROM jabco_projects WHERE id = $1`,
            [idParsed.data.id],
          ),
          c.query(
            `SELECT COALESCE(SUM(amount_budgeted),0) AS total_budgeted,
                    COALESCE(SUM(amount_actual),  0) AS total_actual,
                    count(*)                          AS line_items
             FROM jabco_boq_items WHERE project_id = $1`,
            [idParsed.data.id],
          ),
          c.query(
            `SELECT id, vo_number, description, status, amount, currency, submitted_date, approved_date
             FROM jabco_variation_orders WHERE project_id = $1 ORDER BY created_at ASC`,
            [idParsed.data.id],
          ),
          c.query(
            `SELECT id, claim_number, period_from, period_to,
                    amount_claimed, amount_certified, status, submitted_date
             FROM jabco_progress_claims WHERE project_id = $1 ORDER BY claim_number ASC`,
            [idParsed.data.id],
          ),
        ]);

        if (projResult.rows.length === 0) return null;
        return {
          ...projResult.rows[0],
          boq_summary:       boqSummary.rows[0],
          variation_orders:  voResult.rows,
          progress_claims:   claimResult.rows,
        };
      });

      if (!project) { err(res, 404, 'PROJECT_NOT_FOUND', 'Project not found.'); return; }
      logger.info({ entity: 'JABCO', action: 'PROJECT_GET', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId, record_id: idParsed.data.id });
      ok(res, project);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /projects/:projectId/boq ──────────────────────────────────────────────

jabcoProjectsRouter.get('/:projectId/boq', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ProjectParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, section, item_number, description, unit,
                  quantity_budgeted, unit_rate, amount_budgeted,
                  quantity_actual, amount_actual, last_modified_at
           FROM   jabco_boq_items
           WHERE  project_id = $1
           ORDER  BY section ASC, item_number ASC`,
          [parsed.data.projectId],
        ).then(r => r.rows),
      );

      logger.info({ entity: 'JABCO', action: 'BOQ_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /projects/:projectId/boq ─────────────────────────────────────────────

jabcoProjectsRouter.post('/:projectId/boq', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const bodyParsed = AddBoqItemSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;
    const projectId = paramParsed.data.projectId;
    const amountBudgeted = body.quantity_budgeted * body.unit_rate;

    const client = await commercialPool.connect();
    try {
      const newItem = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Verify project exists and is in this tenant.
        const proj = await c.query<{ id: string }>(`SELECT id FROM jabco_projects WHERE id = $1`, [projectId]);
        if (proj.rows.length === 0) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { httpStatus: 404 });

        return c.query(
          `INSERT INTO jabco_boq_items
             (tenant_id, project_id, section, item_number, description,
              unit, quantity_budgeted, unit_rate, amount_budgeted, last_modified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
           RETURNING *`,
          [tenantId, projectId, body.section, body.item_number ?? null, body.description,
           body.unit, body.quantity_budgeted, body.unit_rate, amountBudgeted],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'JABCO', action: 'BOQ_ITEM_ADDED', user_id: userId, tenant_id: tenantId, record_id: newItem.id });
      await auditLog(tenantId, userId, 'JabcoBoqItem', 'CREATE', newItem.id, { ...body, project_id: projectId, amount_budgeted: amountBudgeted });
      ok(res, newItem, 201);
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'PROJECT_NOT_FOUND', 'Project not found.'); return; }
    next(e);
  }
});

// ── POST /projects/:projectId/variation-orders ────────────────────────────────

jabcoProjectsRouter.post('/:projectId/variation-orders', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const bodyParsed = CreateVOSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;
    const projectId = paramParsed.data.projectId;

    const client = await commercialPool.connect();
    try {
      const { vo, created } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM jabco_variation_orders WHERE idempotency_key = $1`, [body.idempotency_key],
        );
        if (existing.rows.length > 0) {
          const dup = await c.query(`SELECT * FROM jabco_variation_orders WHERE id = $1`, [existing.rows[0].id]);
          return { vo: dup.rows[0], created: false };
        }

        const proj = await c.query<{ id: string }>(`SELECT id FROM jabco_projects WHERE id = $1`, [projectId]);
        if (proj.rows.length === 0) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { httpStatus: 404 });

        const result = await c.query(
          `INSERT INTO jabco_variation_orders
             (tenant_id, project_id, vo_number, description, amount, currency,
              submitted_date, idempotency_key, last_modified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
           RETURNING *`,
          [tenantId, projectId, body.vo_number, body.description, body.amount,
           body.currency, body.submitted_date ?? null, body.idempotency_key],
        );
        return { vo: result.rows[0], created: true };
      });

      logger.info({ entity: 'JABCO', action: created ? 'VO_CREATED' : 'VO_DUPLICATE', user_id: userId, tenant_id: tenantId, record_id: vo.id });
      if (created) await auditLog(tenantId, userId, 'JabcoVariationOrder', 'CREATE', vo.id, { ...body, project_id: projectId });
      ok(res, vo, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'PROJECT_NOT_FOUND', 'Project not found.'); return; }
    next(e);
  }
});

// ── POST /projects/:projectId/progress-claims ─────────────────────────────────

jabcoProjectsRouter.post('/:projectId/progress-claims', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const bodyParsed = CreateClaimSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;
    const projectId = paramParsed.data.projectId;

    const client = await commercialPool.connect();
    try {
      const { claim, created } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM jabco_progress_claims WHERE idempotency_key = $1`, [body.idempotency_key],
        );
        if (existing.rows.length > 0) {
          const dup = await c.query(`SELECT * FROM jabco_progress_claims WHERE id = $1`, [existing.rows[0].id]);
          return { claim: dup.rows[0], created: false };
        }

        const proj = await c.query<{ id: string }>(`SELECT id FROM jabco_projects WHERE id = $1`, [projectId]);
        if (proj.rows.length === 0) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { httpStatus: 404 });

        const result = await c.query(
          `INSERT INTO jabco_progress_claims
             (tenant_id, project_id, claim_number, period_from, period_to,
              amount_claimed, idempotency_key, last_modified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,now())
           RETURNING *`,
          [tenantId, projectId, body.claim_number, body.period_from, body.period_to,
           body.amount_claimed, body.idempotency_key],
        );
        return { claim: result.rows[0], created: true };
      });

      logger.info({ entity: 'JABCO', action: created ? 'CLAIM_CREATED' : 'CLAIM_DUPLICATE', user_id: userId, tenant_id: tenantId, record_id: claim.id });
      if (created) await auditLog(tenantId, userId, 'JabcoProgressClaim', 'CREATE', claim.id, { ...body, project_id: projectId });
      ok(res, claim, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'PROJECT_NOT_FOUND', 'Project not found.'); return; }
    next(e);
  }
});
