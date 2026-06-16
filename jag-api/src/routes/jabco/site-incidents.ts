// GET    /api/v1/jabco/projects/:projectId/incidents
// POST   /api/v1/jabco/projects/:projectId/incidents
// PATCH  /api/v1/jabco/projects/:projectId/incidents/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const jabcoSiteIncidentsRouter = Router({ mergeParams: true });

// ── Schemas ───────────────────────────────────────────────────────────────────

const ProjectParam  = z.object({ projectId: z.string().uuid() });
const IncidentParam = z.object({ projectId: z.string().uuid(), id: z.string().uuid() });

const IncidentQuerySchema = z.object({
  status: z.enum(['OPEN','CLOSED']).optional(),
}).strict();

const CreateIncidentSchema = z.object({
  incident_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  incident_type:    z.enum(['NEAR_MISS','MINOR_INJURY','MAJOR_INJURY','PROPERTY_DAMAGE','ENVIRONMENTAL','OTHER']),
  severity:         z.enum(['LOW','MEDIUM','HIGH','CRITICAL']),
  description:      z.string().min(1),
  corrective_action: z.string().max(2000).optional(),
  photos:           z.array(z.string()).default([]),
}).strict();

const PatchIncidentSchema = z.object({
  corrective_action: z.string().max(2000).nullable().optional(),
  status:            z.enum(['OPEN','CLOSED']).optional(),
  closed_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  photos:            z.array(z.string()).optional(),
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

// ── GET /projects/:projectId/incidents ────────────────────────────────────────

jabcoSiteIncidentsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const queryParsed = IncidentQuerySchema.safeParse(req.query);
    if (!queryParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }

    const { projectId } = paramParsed.data;
    const { status } = queryParsed.data;

    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const params: unknown[] = [projectId];
        const conditions: string[] = [`project_id = $1`];
        if (status) {
          params.push(status);
          conditions.push(`status = $${params.length}`);
        }
        return c.query(
          `SELECT id, incident_date, incident_type, severity, description,
                  corrective_action, photos, status, reported_by,
                  closed_date, created_at, updated_at
           FROM   jabco_site_incidents
           WHERE  ${conditions.join(' AND ')}
           ORDER  BY incident_date DESC, created_at DESC`,
          params,
        ).then(r => r.rows);
      });

      logger.info({ entity: 'JABCO', action: 'INCIDENTS_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId, project_id: projectId });
      ok(res, { incidents: rows });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /projects/:projectId/incidents ───────────────────────────────────────

jabcoSiteIncidentsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const bodyParsed = CreateIncidentSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { projectId } = paramParsed.data;
    const body = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const newIncident = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Verify project exists.
        const proj = await c.query<{ id: string }>(
          `SELECT id FROM jabco_projects WHERE id = $1`, [projectId],
        );
        if (proj.rows.length === 0) throw Object.assign(new Error('Project not found.'), { status: 404, code: 'PROJECT_NOT_FOUND' });

        return c.query(
          `INSERT INTO jabco_site_incidents
             (tenant_id, project_id, incident_date, incident_type, severity,
              description, corrective_action, photos, status, reported_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',$9)
           RETURNING *`,
          [
            tenantId, projectId, body.incident_date, body.incident_type, body.severity,
            body.description, body.corrective_action ?? null,
            JSON.stringify(body.photos), userId,
          ],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'JABCO', action: 'INCIDENT_CREATED', user_id: userId, tenant_id: tenantId, record_id: newIncident.id, project_id: projectId });
      await auditLog(tenantId, userId, 'JabcoSiteIncident', 'CREATE', newIncident.id, { ...body, project_id: projectId });
      ok(res, newIncident, 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { err(res, 404, ex.code ?? 'PROJECT_NOT_FOUND', ex.message); return; }
    next(e);
  }
});

// ── PATCH /projects/:projectId/incidents/:id ──────────────────────────────────

jabcoSiteIncidentsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = IncidentParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID and Incident ID must be valid UUIDs.'); return; }

    const bodyParsed = PatchIncidentSchema.safeParse(req.body);
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

        if (b.corrective_action !== undefined) sets.push(`corrective_action = ${push(b.corrective_action)}`);
        if (b.status            !== undefined) sets.push(`status = ${push(b.status)}`);
        if (b.closed_date       !== undefined) sets.push(`closed_date = ${push(b.closed_date)}`);
        if (b.photos            !== undefined) sets.push(`photos = ${push(JSON.stringify(b.photos))}`);

        params.push(id);
        params.push(projectId);
        return c.query(
          `UPDATE jabco_site_incidents
           SET ${sets.join(', ')}
           WHERE id = $${params.length - 1} AND project_id = $${params.length}
           RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null);
      });

      if (!updated) { err(res, 404, 'INCIDENT_NOT_FOUND', 'Incident not found for this project.'); return; }
      logger.info({ entity: 'JABCO', action: 'INCIDENT_PATCHED', user_id: userId, tenant_id: tenantId, record_id: id, project_id: projectId });
      await auditLog(tenantId, userId, 'JabcoSiteIncident', 'UPDATE', id, b);
      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
