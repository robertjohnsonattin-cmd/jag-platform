// GET    /api/v1/crm/pipeline
// GET    /api/v1/crm/pipeline/intelligence
// GET    /api/v1/crm/pipeline/:id
// POST   /api/v1/crm/pipeline
// PATCH  /api/v1/crm/pipeline/:id
// POST   /api/v1/crm/pipeline/:id/go-no-go
// POST   /api/v1/crm/pipeline/:id/submit
// POST   /api/v1/crm/pipeline/:id/decide

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const pipelineRouter = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────

const UUIDParam = z.object({ id: z.string().uuid() });

const PipelineQuerySchema = z.object({
  stage: z.enum(['PREQUALIFICATION','LEAD','QUALIFIED','PROPOSAL','SUBMITTED','NEGOTIATION','WON','LOST','NO_GO']).optional(),
  pipeline_type: z.enum(['JABCO_TENDER','DRAGONBRIDGE_DEAL']).optional(),
  assigned_to: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
}).strict();

const CreatePipelineSchema = z.object({
  title: z.string().min(1).max(200),
  company_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  estimated_value: z.number().positive().optional(),
  bid_deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source_url: z.string().url().optional(),
  assigned_to: z.string().uuid().optional(),
  notes: z.string().max(5000).optional(),
  pipeline_type: z.enum(['JABCO_TENDER','DRAGONBRIDGE_DEAL']).default('JABCO_TENDER'),
  idempotency_key: z.string().uuid(),
}).strict();

const PatchPipelineSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  estimated_value: z.number().positive().optional(),
  bid_deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  source_url: z.string().url().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'At least one field required.' });

const REASON_CATEGORIES = ['RESOURCE_CONSTRAINTS','HIGH_RISK','LOW_MARGIN','STRATEGIC_MISFIT','CLIENT_RELATIONSHIP','SCHEDULE_CONFLICT','OTHER'] as const;

const GoNoGoSchema = z.object({
  decision: z.enum(['GO', 'NO_GO']),
  reason_category: z.enum(REASON_CATEGORIES).optional(),
  reason_text: z.string().max(2000).optional(),
  project_code: z.string().min(1).max(50).optional(),
  client_type: z.enum(['GOVERNMENT','PRIVATE']).optional(),
  contract_currency: z.string().length(3).default('TTD'),
  idempotency_key: z.string().uuid(),
}).strict().refine(
  (b) => b.decision === 'GO' ? !!b.project_code && !!b.client_type : !!b.reason_category && !!b.reason_text,
  { message: 'GO requires project_code + client_type; NO_GO requires reason_category + reason_text' },
);

const SubmitSchema = z.object({
  proposal_document_url: z.string().min(1),
  submitted_at: z.string().datetime().optional(),
}).strict();

const DecideSchema = z.object({
  decision: z.enum(['WON', 'LOST']),
  competitor_name: z.string().max(200).optional(),
  winning_total_price: z.number().positive().optional(),
  our_total_price: z.number().positive().optional(),
  technical_score: z.number().optional(),
  financial_score: z.number().optional(),
  package_variances: z.array(z.object({
    work_package_tag: z.string().max(100),
    our_rate: z.number(),
    market_rate: z.number(),
  })).optional(),
  idempotency_key: z.string().uuid(),
}).strict().refine(
  (b) => b.decision === 'WON' || (!!b.competitor_name && b.winning_total_price !== undefined),
  { message: 'LOST requires competitor_name + winning_total_price' },
);

const IntelligenceQuerySchema = z.object({
  client_company_id: z.string().uuid(),
  work_package_tags: z.string().optional(),
}).strict();

// ── Constants ─────────────────────────────────────────────────────────────────

const MOBILIZATION_CHECKLIST_TEMPLATE = [
  'Secure Permits',
  'Establish Site Office',
  'Finalize Baseline Schedule',
  'Mobilize Initial Crew',
] as const;

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
      `INSERT INTO audit_log (tenant_id, user_id, entity, action, record_id, new_values, source) VALUES ($1,$2,$3,$4,$5,$6,'API')`,
      [tenantId, userId, entity, action, recordId, JSON.stringify(newValues)],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); logger.warn({ entity, action: 'AUDIT_LOG_FAILED', error_message: (e as Error).message }); }
  finally { client.release(); }
}

// ── GET /pipeline ─────────────────────────────────────────────────────────────

pipelineRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PipelineQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }

    const { stage, pipeline_type, assigned_to, page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const client = await commercialPool.connect();
    try {
      const { rows, total } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];

        if (stage)         conditions.push(`p.stage = ${push(stage)}`);
        if (pipeline_type) conditions.push(`p.pipeline_type = ${push(pipeline_type)}`);
        if (assigned_to)   conditions.push(`p.assigned_to = ${push(assigned_to)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await c.query<{ count: string }>(
          `SELECT count(*) FROM crm_sales_pipeline p ${where}`, params,
        );

        const dataResult = await c.query(
          `SELECT p.id, p.title, p.stage, p.pipeline_type, p.company_id,
                  co.name AS company_name, p.estimated_value, p.bid_deadline,
                  p.assigned_to, p.assigned_estimator_id, p.linked_project_id,
                  p.submitted_at, p.created_at, p.updated_at
           FROM   crm_sales_pipeline p
           LEFT JOIN crm_companies co ON co.id = p.company_id
           ${where}
           ORDER  BY p.created_at DESC
           LIMIT  ${push(limit)} OFFSET ${push(offset)}`,
          params,
        );
        return { rows: dataResult.rows, total: Number(countResult.rows[0].count) };
      });

      logger.info({ entity: 'CRM_PIPELINE', action: 'PIPELINE_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId, count: rows.length });
      ok(res, { opportunities: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /pipeline/intelligence ─────────────────────────────────────────────────
// IMPORTANT: defined BEFORE /:id so Express does not parse "intelligence" as a UUID.

pipelineRouter.get('/intelligence', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = IntelligenceQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'client_company_id (UUID) is required.'); return; }

    const { client_company_id, work_package_tags } = parsed.data;
    const tags = work_package_tags ? work_package_tags.split(',').map(t => t.trim()).filter(Boolean) : [];

    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Base query: all bid log entries for this client.
        const baseRows = await c.query<{
          log_type: string;
          reason_category: string | null;
          reason_text: string | null;
          competitor_name: string | null;
          winning_total_price: string | null;
          our_total_price: string | null;
          work_package_tag: string | null;
          variance_pct: string | null;
          created_at: string;
        }>(
          `SELECT log_type, reason_category, reason_text, competitor_name,
                  winning_total_price, our_total_price, work_package_tag, variance_pct, created_at
           FROM   jabco_bid_log
           WHERE  client_company_id = $1
           ORDER  BY created_at DESC`,
          [client_company_id],
        ).then(r => r.rows);

        // Tag-specific RATE_VARIANCE rows (if tags provided).
        let tagRows: typeof baseRows = [];
        if (tags.length > 0) {
          tagRows = await c.query<{
            log_type: string;
            reason_category: string | null;
            reason_text: string | null;
            competitor_name: string | null;
            winning_total_price: string | null;
            our_total_price: string | null;
            work_package_tag: string | null;
            variance_pct: string | null;
            created_at: string;
          }>(
            `SELECT log_type, reason_category, reason_text, competitor_name,
                    winning_total_price, our_total_price, work_package_tag, variance_pct, created_at
             FROM   jabco_bid_log
             WHERE  client_company_id = $1
               AND  log_type = 'RATE_VARIANCE'
               AND  work_package_tag = ANY($2)
             ORDER  BY created_at DESC`,
            [client_company_id, tags],
          ).then(r => r.rows);
        }

        // Compute win/loss ratio.
        const wonCount  = baseRows.filter(r => r.log_type === 'WON').length;
        const lostCount = baseRows.filter(r => r.log_type === 'LOST_BID').length;

        // Filter history subsets.
        const no_go_history   = baseRows.filter(r => r.log_type === 'NO_GO');
        const lost_bid_history = baseRows.filter(r => r.log_type === 'LOST_BID');

        // Compute package rate warnings from RATE_VARIANCE rows (use tagRows if provided, else baseRows).
        const rateRows = (tags.length > 0 ? tagRows : baseRows).filter(r => r.log_type === 'RATE_VARIANCE');

        // Group by work_package_tag and compute average variance_pct.
        const tagMap = new Map<string, number[]>();
        for (const row of rateRows) {
          if (!row.work_package_tag || row.variance_pct === null) continue;
          const pct = parseFloat(String(row.variance_pct));
          const existing = tagMap.get(row.work_package_tag) ?? [];
          existing.push(pct);
          tagMap.set(row.work_package_tag, existing);
        }

        const package_rate_warnings: Array<{
          work_package_tag: string;
          avg_variance_pct: number;
          sample_size: number;
          warning: string;
        }> = [];

        for (const [tag, pcts] of tagMap.entries()) {
          const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
          const roundedAvg = Math.round(avg * 100) / 100;
          if (Math.abs(roundedAvg) > 10) {
            const direction = roundedAvg > 0 ? 'above' : 'below';
            package_rate_warnings.push({
              work_package_tag: tag,
              avg_variance_pct: roundedAvg,
              sample_size: pcts.length,
              warning: `Our ${tag} rates have historically run ${Math.abs(roundedAvg)}% ${direction} market across ${pcts.length} past bid${pcts.length !== 1 ? 's' : ''} for this client.`,
            });
          }
        }

        return {
          win_loss_ratio: { won: wonCount, lost: lostCount, total: wonCount + lostCount },
          no_go_history,
          lost_bid_history,
          package_rate_warnings,
        };
      });

      logger.info({ entity: 'CRM_PIPELINE', action: 'INTELLIGENCE_QUERY', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId });
      ok(res, result);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /pipeline/:id ─────────────────────────────────────────────────────────

pipelineRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Pipeline ID must be a valid UUID.'); return; }
    const { id } = idParsed.data;

    const client = await commercialPool.connect();
    try {
      const record = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const pipelineResult = await c.query(
          `SELECT p.*, co.name AS company_name
           FROM   crm_sales_pipeline p
           LEFT JOIN crm_companies co ON co.id = p.company_id
           WHERE  p.id = $1`,
          [id],
        );
        if (pipelineResult.rows.length === 0) return null;

        const pipeline = pipelineResult.rows[0] as Record<string, unknown>;
        let linked_project: Record<string, unknown> | null = null;

        if (pipeline.linked_project_id) {
          const projResult = await c.query(
            `SELECT id, project_code, name, client_name, status, contract_value, contract_currency, start_date, expected_end_date
             FROM   jabco_projects WHERE id = $1`,
            [pipeline.linked_project_id],
          );
          linked_project = projResult.rows[0] ?? null;
        }

        return { ...pipeline, linked_project };
      });

      if (!record) { err(res, 404, 'PIPELINE_NOT_FOUND', 'Pipeline opportunity not found.'); return; }
      logger.info({ entity: 'CRM_PIPELINE', action: 'PIPELINE_GET', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId, record_id: id });
      ok(res, record);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /pipeline ────────────────────────────────────────────────────────────

pipelineRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreatePipelineSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = parsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const { record, created } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // STD-11 idempotency check.
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM crm_sales_pipeline WHERE idempotency_key = $1`,
          [body.idempotency_key],
        );
        if (existing.rows.length > 0) {
          const dup = await c.query(`SELECT * FROM crm_sales_pipeline WHERE id = $1`, [existing.rows[0].id]);
          return { record: dup.rows[0], created: false };
        }

        const result = await c.query(
          `INSERT INTO crm_sales_pipeline
             (tenant_id, title, stage, pipeline_type, company_id, contact_id,
              estimated_value, bid_deadline, source_url, assigned_to,
              notes, idempotency_key)
           VALUES ($1,$2,'PREQUALIFICATION',$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [
            tenantId, body.title, body.pipeline_type,
            body.company_id ?? null, body.contact_id ?? null,
            body.estimated_value ?? null, body.bid_deadline ?? null,
            body.source_url ?? null, body.assigned_to ?? userId,
            body.notes ?? null, body.idempotency_key,
          ],
        );
        return { record: result.rows[0], created: true };
      });

      logger.info({ entity: 'CRM_PIPELINE', action: created ? 'PIPELINE_CREATED' : 'PIPELINE_DUPLICATE', user_id: userId, tenant_id: tenantId, record_id: record.id });
      if (created) await auditLog(tenantId, userId, 'CrmPipeline', 'CREATE', record.id, body);
      ok(res, record, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /pipeline/:id ───────────────────────────────────────────────────────

pipelineRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Pipeline ID must be a valid UUID.'); return; }

    const bodyParsed = PatchPipelineSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const b = bodyParsed.data;
    const { id } = idParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const updated = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Check current stage — cannot edit terminal/submitted stages.
        const current = await c.query<{ stage: string }>(
          `SELECT stage FROM crm_sales_pipeline WHERE id = $1`, [id],
        ).then(r => r.rows[0] ?? null);

        if (!current) throw Object.assign(new Error('Pipeline opportunity not found.'), { status: 404, code: 'PIPELINE_NOT_FOUND' });

        if (['SUBMITTED','WON','LOST','NO_GO'].includes(current.stage)) {
          throw Object.assign(
            new Error(`Pipeline in stage ${current.stage} cannot be edited.`),
            { status: 409, code: 'INVALID_STAGE' },
          );
        }

        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const sets: string[] = [`updated_at = now()`];

        if (b.title           !== undefined) sets.push(`title = ${push(b.title)}`);
        if (b.estimated_value !== undefined) sets.push(`estimated_value = ${push(b.estimated_value)}`);
        if (b.bid_deadline    !== undefined) sets.push(`bid_deadline = ${push(b.bid_deadline)}`);
        if (b.source_url      !== undefined) sets.push(`source_url = ${push(b.source_url)}`);
        if (b.notes           !== undefined) sets.push(`notes = ${push(b.notes)}`);
        if (b.assigned_to     !== undefined) sets.push(`assigned_to = ${push(b.assigned_to)}`);

        params.push(id);
        return c.query(
          `UPDATE crm_sales_pipeline SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null);
      });

      if (!updated) { err(res, 404, 'PIPELINE_NOT_FOUND', 'Pipeline opportunity not found.'); return; }
      logger.info({ entity: 'CRM_PIPELINE', action: 'PIPELINE_PATCHED', user_id: userId, tenant_id: tenantId, record_id: id });
      await auditLog(tenantId, userId, 'CrmPipeline', 'UPDATE', id, b);
      ok(res, updated);
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { err(res, 404, ex.code ?? 'PIPELINE_NOT_FOUND', ex.message); return; }
    if (ex.status === 409) { err(res, 409, ex.code ?? 'CONFLICT', ex.message); return; }
    next(e);
  }
});

// ── POST /pipeline/:id/go-no-go ───────────────────────────────────────────────

pipelineRouter.post('/:id/go-no-go', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Pipeline ID must be a valid UUID.'); return; }

    const bodyParsed = GoNoGoSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = bodyParsed.data;
    const { id } = idParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Load the pipeline row.
        const pipeline = await c.query<{
          id: string; title: string; stage: string; pipeline_type: string;
          company_id: string | null; estimated_value: string | null;
          assigned_estimator_id: string | null;
        }>(
          `SELECT id, title, stage, pipeline_type, company_id, estimated_value, assigned_estimator_id
           FROM crm_sales_pipeline WHERE id = $1`,
          [id],
        ).then(r => r.rows[0] ?? null);

        if (!pipeline) throw Object.assign(new Error('Pipeline opportunity not found.'), { status: 404, code: 'PIPELINE_NOT_FOUND' });
        if (pipeline.pipeline_type !== 'JABCO_TENDER') throw Object.assign(new Error('Go/No-Go is only valid for JABCO_TENDER opportunities.'), { status: 404, code: 'PIPELINE_NOT_FOUND' });
        if (!['LEAD','QUALIFIED'].includes(pipeline.stage)) {
          throw Object.assign(new Error(`Pipeline must be in LEAD or QUALIFIED stage for Go/No-Go (currently ${pipeline.stage}).`), { status: 409, code: 'INVALID_STAGE' });
        }

        if (body.decision === 'GO') {
          // Idempotency check via jabco_projects.
          const existingProject = await c.query<{ id: string; project_code: string }>(
            `SELECT id, project_code FROM jabco_projects WHERE idempotency_key = $1`,
            [body.idempotency_key],
          ).then(r => r.rows[0] ?? null);

          if (existingProject) {
            const pipelineRow = await c.query(`SELECT * FROM crm_sales_pipeline WHERE id = $1`, [id]).then(r => r.rows[0]);
            const projectRow  = await c.query(`SELECT * FROM jabco_projects WHERE id = $1`, [existingProject.id]).then(r => r.rows[0]);
            return { pipeline: pipelineRow, project: projectRow, created: false };
          }

          // Resolve client_name from crm_companies if company_id is set.
          let clientName = pipeline.title;
          if (pipeline.company_id) {
            const co = await c.query<{ name: string }>(
              `SELECT name FROM crm_companies WHERE id = $1`, [pipeline.company_id],
            ).then(r => r.rows[0] ?? null);
            if (co) clientName = co.name;
          }

          // INSERT jabco_projects.
          const newProject = await c.query(
            `INSERT INTO jabco_projects
               (tenant_id, project_code, name, client_name, client_type,
                status, contract_value, contract_currency,
                client_company_id, project_manager_id,
                idempotency_key, last_modified_by)
             VALUES ($1,$2,$3,$4,$5,'TENDER',$6,$7,$8,$9,$10,$11)
             RETURNING *`,
            [
              tenantId, body.project_code!, pipeline.title, clientName, body.client_type!,
              parseFloat(String(pipeline.estimated_value ?? 0)),
              body.contract_currency,
              pipeline.company_id ?? null, userId,
              body.idempotency_key, userId,
            ],
          ).then(r => r.rows[0]);

          // UPDATE pipeline to QUALIFIED with linked_project_id.
          const updatedPipeline = await c.query(
            `UPDATE crm_sales_pipeline
             SET stage = 'QUALIFIED', linked_project_id = $1, updated_at = now()
             WHERE id = $2
             RETURNING *`,
            [newProject.id, id],
          ).then(r => r.rows[0]);

          return { pipeline: updatedPipeline, project: newProject, created: true };

        } else {
          // NO_GO path — idempotency via jabco_bid_log.
          const existingLog = await c.query<{ id: string }>(
            `SELECT id FROM jabco_bid_log WHERE idempotency_key = $1`,
            [body.idempotency_key],
          ).then(r => r.rows[0] ?? null);

          if (existingLog) {
            const pipelineRow = await c.query(`SELECT * FROM crm_sales_pipeline WHERE id = $1`, [id]).then(r => r.rows[0]);
            const logRow      = await c.query(`SELECT * FROM jabco_bid_log WHERE id = $1`, [existingLog.id]).then(r => r.rows[0]);
            return { pipeline: pipelineRow, bid_log_entry: logRow, created: false };
          }

          // INSERT jabco_bid_log.
          const logEntry = await c.query(
            `INSERT INTO jabco_bid_log
               (tenant_id, log_type, pipeline_id, client_company_id,
                reason_category, reason_text, logged_by, idempotency_key)
             VALUES ($1,'NO_GO',$2,$3,$4,$5,$6,$7)
             RETURNING *`,
            [
              tenantId, id, pipeline.company_id ?? null,
              body.reason_category!, body.reason_text!,
              userId, body.idempotency_key,
            ],
          ).then(r => r.rows[0]);

          // UPDATE pipeline to NO_GO.
          const updatedPipeline = await c.query(
            `UPDATE crm_sales_pipeline
             SET stage = 'NO_GO', assigned_estimator_id = NULL, updated_at = now()
             WHERE id = $1
             RETURNING *`,
            [id],
          ).then(r => r.rows[0]);

          return { pipeline: updatedPipeline, bid_log_entry: logEntry, created: true };
        }
      });

      logger.info({ entity: 'CRM_PIPELINE', action: 'GO_NO_GO_DECIDED', user_id: userId, tenant_id: tenantId, record_id: id, decision: body.decision });
      await auditLog(tenantId, userId, 'CrmPipeline', 'GO_NO_GO_DECIDED', id, { decision: body.decision, idempotency_key: body.idempotency_key });
      ok(res, result, (result as { created?: boolean }).created === false ? 200 : 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { err(res, 404, ex.code ?? 'PIPELINE_NOT_FOUND', ex.message); return; }
    if (ex.status === 409) { err(res, 409, ex.code ?? 'CONFLICT', ex.message); return; }
    next(e);
  }
});

// ── POST /pipeline/:id/submit ─────────────────────────────────────────────────

pipelineRouter.post('/:id/submit', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Pipeline ID must be a valid UUID.'); return; }

    const bodyParsed = SubmitSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = bodyParsed.data;
    const { id } = idParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const updated = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE crm_sales_pipeline
           SET stage = 'SUBMITTED',
               proposal_document_url = $1,
               submitted_at = COALESCE($2::timestamptz, now()),
               updated_at = now()
           WHERE id = $3
             AND stage IN ('QUALIFIED','PROPOSAL','NEGOTIATION')
           RETURNING *`,
          [body.proposal_document_url, body.submitted_at ?? null, id],
        ).then(r => r.rows[0] ?? null),
      );

      if (!updated) {
        err(res, 409, 'INVALID_STAGE', 'Pipeline not found or not in a submittable stage (QUALIFIED, PROPOSAL, or NEGOTIATION).');
        return;
      }

      logger.info({ entity: 'CRM_PIPELINE', action: 'PIPELINE_SUBMITTED', user_id: userId, tenant_id: tenantId, record_id: id });
      await auditLog(tenantId, userId, 'CrmPipeline', 'SUBMIT', id, body);
      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /pipeline/:id/decide ─────────────────────────────────────────────────

pipelineRouter.post('/:id/decide', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Pipeline ID must be a valid UUID.'); return; }

    const bodyParsed = DecideSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = bodyParsed.data;
    const { id } = idParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Load pipeline — must be SUBMITTED with a linked project.
        const pipeline = await c.query<{
          id: string; stage: string; linked_project_id: string | null;
          company_id: string | null; assigned_estimator_id: string | null;
        }>(
          `SELECT id, stage, linked_project_id, company_id, assigned_estimator_id
           FROM crm_sales_pipeline WHERE id = $1`,
          [id],
        ).then(r => r.rows[0] ?? null);

        if (!pipeline) throw Object.assign(new Error('Pipeline opportunity not found.'), { status: 404, code: 'PIPELINE_NOT_FOUND' });
        if (pipeline.stage !== 'SUBMITTED') {
          throw Object.assign(new Error(`Pipeline must be in SUBMITTED stage to decide (currently ${pipeline.stage}).`), { status: 409, code: 'INVALID_STAGE' });
        }
        if (!pipeline.linked_project_id) {
          throw Object.assign(new Error('Pipeline has no linked project. Run go-no-go first.'), { status: 409, code: 'NO_LINKED_PROJECT' });
        }

        const linkedProjectId = pipeline.linked_project_id;

        // Idempotency check.
        const existingLog = await c.query<{ id: string }>(
          `SELECT id FROM jabco_bid_log WHERE idempotency_key = $1`,
          [body.idempotency_key],
        ).then(r => r.rows[0] ?? null);

        if (existingLog) {
          return { created: false, idempotency_key: body.idempotency_key };
        }

        if (body.decision === 'WON') {
          // Update project to AWARDED.
          const awardedProject = await c.query(
            `UPDATE jabco_projects SET status = 'AWARDED', last_modified_at = now(), last_modified_by = $1
             WHERE id = $2 AND status = 'TENDER'
             RETURNING id, project_code`,
            [userId, linkedProjectId],
          ).then(r => r.rows[0] ?? null);

          if (!awardedProject) {
            throw Object.assign(new Error('Project is not in TENDER status — bid decision may have already been recorded.'), { status: 409, code: 'PROJECT_ALREADY_DECIDED' });
          }

          // Update pipeline to WON.
          await c.query(
            `UPDATE crm_sales_pipeline SET stage = 'WON', updated_at = now() WHERE id = $1`,
            [id],
          );

          // Insert mobilization tasks.
          for (const taskTitle of MOBILIZATION_CHECKLIST_TEMPLATE) {
            await c.query(
              `INSERT INTO jabco_project_tasks
                 (tenant_id, project_id, task_type, title, status)
               VALUES ($1, $2, 'MOBILIZATION', $3, 'OPEN')`,
              [tenantId, linkedProjectId, taskTitle],
            );
          }

          // Insert WON bid log entry.
          const logEntry = await c.query(
            `INSERT INTO jabco_bid_log
               (tenant_id, log_type, pipeline_id, project_id, client_company_id,
                our_total_price, idempotency_key, logged_by)
             VALUES ($1,'WON',$2,$3,$4,$5,$6,$7)
             RETURNING *`,
            [
              tenantId, id, linkedProjectId, pipeline.company_id ?? null,
              body.our_total_price ?? null, body.idempotency_key, userId,
            ],
          ).then(r => r.rows[0]);

          // pending_events outbox — non-blocking.
          try {
            await c.query(
              `INSERT INTO pending_events (aggregate_type, aggregate_id, event_type, payload)
               VALUES ('jabco_project', $1, 'jabco.project_awarded', jsonb_build_object('project_id', $1))`,
              [linkedProjectId],
            );
          } catch { /* table may not exist yet; non-blocking */ }

          return { created: true, decision: 'WON', project_id: linkedProjectId, bid_log_entry: logEntry };

        } else {
          // LOST path.
          // Update project to CANCELLED.
          await c.query(
            `UPDATE jabco_projects SET status = 'CANCELLED', last_modified_at = now(), last_modified_by = $1
             WHERE id = $2 AND status = 'TENDER'`,
            [userId, linkedProjectId],
          );

          // Update pipeline to LOST.
          await c.query(
            `UPDATE crm_sales_pipeline SET stage = 'LOST', updated_at = now() WHERE id = $1`,
            [id],
          );

          // Insert LOST_BID bid log entry.
          const logEntry = await c.query(
            `INSERT INTO jabco_bid_log
               (tenant_id, log_type, pipeline_id, project_id, client_company_id,
                competitor_name, winning_total_price, our_total_price,
                technical_score, financial_score, idempotency_key, logged_by)
             VALUES ($1,'LOST_BID',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING *`,
            [
              tenantId, id, linkedProjectId, pipeline.company_id ?? null,
              body.competitor_name ?? null, body.winning_total_price ?? null,
              body.our_total_price ?? null, body.technical_score ?? null,
              body.financial_score ?? null, body.idempotency_key, userId,
            ],
          ).then(r => r.rows[0]);

          // Get project code for post-mortem task title.
          const projectCode = await c.query<{ project_code: string }>(
            `SELECT project_code FROM jabco_projects WHERE id = $1`, [linkedProjectId],
          ).then(r => r.rows[0]?.project_code ?? linkedProjectId);

          // Insert RATE_VARIANCE rows for significant variances (>10%).
          if (body.package_variances && body.package_variances.length > 0) {
            for (const pv of body.package_variances) {
              if (pv.market_rate === 0) continue;
              const variance_pct = Math.round(((pv.our_rate - pv.market_rate) / pv.market_rate) * 10000) / 100;
              if (Math.abs(variance_pct) > 10) {
                await c.query(
                  `INSERT INTO jabco_bid_log
                     (tenant_id, log_type, pipeline_id, project_id, client_company_id,
                      work_package_tag, variance_pct, logged_by)
                   VALUES ($1,'RATE_VARIANCE',$2,$3,$4,$5,$6,$7)`,
                  [
                    tenantId, id, linkedProjectId, pipeline.company_id ?? null,
                    pv.work_package_tag, variance_pct, userId,
                  ],
                );
              }
            }
          }

          // Insert post-mortem task.
          await c.query(
            `INSERT INTO jabco_project_tasks
               (tenant_id, project_id, task_type, title, assigned_to, status)
             VALUES ($1,$2,'POST_MORTEM',$3,$4,'OPEN')`,
            [tenantId, linkedProjectId, `Post-Mortem Review — ${projectCode}`, pipeline.assigned_estimator_id ?? null],
          );

          return { created: true, decision: 'LOST', project_id: linkedProjectId, bid_log_entry: logEntry };
        }
      });

      logger.info({ entity: 'CRM_PIPELINE', action: 'BID_DECIDED', user_id: userId, tenant_id: tenantId, record_id: id, decision: body.decision });
      await auditLog(tenantId, userId, 'CrmPipeline', 'BID_DECIDED', id, { decision: body.decision, idempotency_key: body.idempotency_key });
      ok(res, result, (result as { created?: boolean }).created === false ? 200 : 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { err(res, 404, ex.code ?? 'PIPELINE_NOT_FOUND', ex.message); return; }
    if (ex.status === 409) { err(res, 409, ex.code ?? 'CONFLICT', ex.message); return; }
    next(e);
  }
});

// ── POST /pipeline/:id/advance ─────────────────────────────────────────────────
// Advance from PREQUALIFICATION → LEAD. No other stage transitions allowed here;
// LEAD→QUALIFIED uses Go/No-Go, QUALIFIED+→SUBMITTED uses Submit, SUBMITTED→ uses Decide.

pipelineRouter.post('/:id/advance', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Pipeline ID must be a valid UUID.'); return; }
    const { id } = idParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const updated = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const current = await c.query<{ stage: string }>(
          `SELECT stage FROM crm_sales_pipeline WHERE id = $1`, [id],
        ).then(r => r.rows[0] ?? null);

        if (!current) throw Object.assign(new Error('Pipeline opportunity not found.'), { status: 404, code: 'PIPELINE_NOT_FOUND' });
        if (current.stage !== 'PREQUALIFICATION') {
          throw Object.assign(
            new Error(`Advance only moves PREQUALIFICATION → LEAD (currently ${current.stage}).`),
            { status: 409, code: 'INVALID_STAGE' },
          );
        }

        return c.query(
          `UPDATE crm_sales_pipeline SET stage = 'LEAD', updated_at = now() WHERE id = $1 RETURNING *`, [id],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'CRM_PIPELINE', action: 'PIPELINE_ADVANCED', user_id: userId, tenant_id: tenantId, record_id: id });
      await auditLog(tenantId, userId, 'CrmPipeline', 'PIPELINE_ADVANCED', id, { from: 'PREQUALIFICATION', to: 'LEAD' });
      ok(res, updated);
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { err(res, 404, ex.code ?? 'PIPELINE_NOT_FOUND', ex.message); return; }
    if (ex.status === 409) { err(res, 409, ex.code ?? 'CONFLICT', ex.message); return; }
    next(e);
  }
});

// ── DELETE /pipeline/:id ───────────────────────────────────────────────────────
// Only allowed for non-terminal stages (WON/LOST/NO_GO cannot be deleted).

pipelineRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Pipeline ID must be a valid UUID.'); return; }
    const { id } = idParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      await withTenantRLS(client, req.rlsCtx, async (c) => {
        const current = await c.query<{ stage: string }>(
          `SELECT stage FROM crm_sales_pipeline WHERE id = $1`, [id],
        ).then(r => r.rows[0] ?? null);

        if (!current) throw Object.assign(new Error('Pipeline opportunity not found.'), { status: 404, code: 'PIPELINE_NOT_FOUND' });
        if (['WON', 'LOST', 'NO_GO'].includes(current.stage)) {
          throw Object.assign(
            new Error(`Cannot delete a ${current.stage} opportunity — it is part of the bid intelligence record.`),
            { status: 409, code: 'INVALID_STAGE' },
          );
        }

        await c.query(`DELETE FROM crm_sales_pipeline WHERE id = $1`, [id]);
      });

      logger.info({ entity: 'CRM_PIPELINE', action: 'PIPELINE_DELETED', user_id: userId, tenant_id: tenantId, record_id: id });
      await auditLog(tenantId, userId, 'CrmPipeline', 'PIPELINE_DELETED', id, {});
      ok(res, { deleted: true });
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { err(res, 404, ex.code ?? 'PIPELINE_NOT_FOUND', ex.message); return; }
    if (ex.status === 409) { err(res, 409, ex.code ?? 'CONFLICT', ex.message); return; }
    next(e);
  }
});
