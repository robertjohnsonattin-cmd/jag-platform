// GET    /api/v1/jabco/projects/:projectId/quality-inspections
// POST   /api/v1/jabco/projects/:projectId/quality-inspections
// PATCH  /api/v1/jabco/projects/:projectId/quality-inspections/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const jabcoQualityInspectionsRouter = Router({ mergeParams: true });

// ── Schemas ───────────────────────────────────────────────────────────────────

const ProjectParam = z.object({ projectId: z.string().uuid() });
const QualityParam = z.object({ projectId: z.string().uuid(), id: z.string().uuid() });

const QualityQuerySchema = z.object({
  checklist_result: z.enum(['PASS','FAIL','CONDITIONAL']).optional(),
}).strict();

const CreateQualitySchema = z.object({
  inspection_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inspector_name:     z.string().min(1).max(200),
  area_inspected:     z.string().min(1).max(200),
  checklist_result:   z.enum(['PASS','FAIL','CONDITIONAL']),
  defects_noted:      z.string().max(2000).optional(),
  follow_up_required: z.boolean().default(false),
  follow_up_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  photos:             z.array(z.string()).default([]),
}).strict();

const PatchQualitySchema = z.object({
  checklist_result:   z.enum(['PASS','FAIL','CONDITIONAL']).optional(),
  defects_noted:      z.string().max(2000).nullable().optional(),
  follow_up_required: z.boolean().optional(),
  follow_up_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  photos:             z.array(z.string()).optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'At least one field required.' });

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

// ── GET /projects/:projectId/quality-inspections ──────────────────────────────

jabcoQualityInspectionsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const queryParsed = QualityQuerySchema.safeParse(req.query);
    if (!queryParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }

    const { projectId } = paramParsed.data;
    const { checklist_result } = queryParsed.data;

    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const params: unknown[] = [projectId];
        const conditions: string[] = [`project_id = $1`];
        if (checklist_result) {
          params.push(checklist_result);
          conditions.push(`checklist_result = $${params.length}`);
        }
        return c.query(
          `SELECT id, inspection_date, inspector_name, area_inspected,
                  checklist_result, defects_noted, follow_up_required, follow_up_date,
                  photos, created_at, updated_at
           FROM   jabco_quality_inspections
           WHERE  ${conditions.join(' AND ')}
           ORDER  BY inspection_date DESC`,
          params,
        ).then(r => r.rows);
      });

      logger.info({ entity: 'JABCO', action: 'QUALITY_INSPECTIONS_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId, project_id: projectId });
      ok(res, { quality_inspections: rows });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /projects/:projectId/quality-inspections ─────────────────────────────

jabcoQualityInspectionsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const bodyParsed = CreateQualitySchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { projectId } = paramParsed.data;
    const body = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const newInspection = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Verify project exists.
        const proj = await c.query<{ id: string }>(
          `SELECT id FROM jabco_projects WHERE id = $1`, [projectId],
        );
        if (proj.rows.length === 0) throw Object.assign(new Error('Project not found.'), { status: 404, code: 'PROJECT_NOT_FOUND' });

        return c.query(
          `INSERT INTO jabco_quality_inspections
             (tenant_id, project_id, inspection_date, inspector_name, area_inspected,
              checklist_result, defects_noted, follow_up_required, follow_up_date, photos)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            tenantId, projectId, body.inspection_date, body.inspector_name,
            body.area_inspected, body.checklist_result,
            body.defects_noted ?? null, body.follow_up_required,
            body.follow_up_date ?? null, JSON.stringify(body.photos),
          ],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'JABCO', action: 'QUALITY_INSPECTION_CREATED', user_id: userId, tenant_id: tenantId, record_id: newInspection.id, project_id: projectId });
      await auditLog(tenantId, userId, 'JabcoQualityInspection', 'CREATE', newInspection.id, { ...body, project_id: projectId });
      ok(res, newInspection, 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { err(res, 404, ex.code ?? 'PROJECT_NOT_FOUND', ex.message); return; }
    next(e);
  }
});

// ── PATCH /projects/:projectId/quality-inspections/:id ───────────────────────

jabcoQualityInspectionsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = QualityParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID and Inspection ID must be valid UUIDs.'); return; }

    const bodyParsed = PatchQualitySchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { projectId, id } = paramParsed.data;
    const b = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const updated = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const sets: string[] = [`updated_at = now()`];

        if (b.checklist_result   !== undefined) sets.push(`checklist_result = ${push(b.checklist_result)}`);
        if (b.defects_noted      !== undefined) sets.push(`defects_noted = ${push(b.defects_noted)}`);
        if (b.follow_up_required !== undefined) sets.push(`follow_up_required = ${push(b.follow_up_required)}`);
        if (b.follow_up_date     !== undefined) sets.push(`follow_up_date = ${push(b.follow_up_date)}`);
        if (b.photos             !== undefined) sets.push(`photos = ${push(JSON.stringify(b.photos))}`);

        params.push(id);
        params.push(projectId);
        return c.query(
          `UPDATE jabco_quality_inspections
           SET ${sets.join(', ')}
           WHERE id = $${params.length - 1} AND project_id = $${params.length}
           RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null);
      });

      if (!updated) { err(res, 404, 'INSPECTION_NOT_FOUND', 'Quality inspection not found for this project.'); return; }
      logger.info({ entity: 'JABCO', action: 'QUALITY_INSPECTION_PATCHED', user_id: userId, tenant_id: tenantId, record_id: id, project_id: projectId });
      await auditLog(tenantId, userId, 'JabcoQualityInspection', 'UPDATE', id, b);
      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
