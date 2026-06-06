// GET  /api/v1/jabco/projects/:projectId/gantt
// POST /api/v1/jabco/projects/:projectId/gantt
// PATCH /api/v1/jabco/projects/:projectId/gantt/:taskId

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const jabcoGanttRouter = Router({ mergeParams: true });

const ProjectParam = z.object({ projectId: z.string().uuid() });
const TaskParam    = z.object({ projectId: z.string().uuid(), taskId: z.string().uuid() });

const CreateTaskSchema = z.object({
  task_name:      z.string().min(1).max(200),
  planned_start:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  planned_end:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  predecessor_id: z.string().uuid().optional(),
  completion_percentage: z.number().min(0).max(100).default(0),
}).strict();

const PatchTaskSchema = z.object({
  actual_start:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  actual_end:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  completion_percentage: z.number().min(0).max(100).optional(),
  planned_start:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  planned_end:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict().refine(o => Object.keys(o).length > 0, { message: 'At least one field required.' });

// ── GET /projects/:projectId/gantt ────────────────────────────────────────────

jabcoGanttRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ProjectParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, task_name, planned_start, planned_end, actual_start, actual_end,
                  predecessor_id, completion_percentage, last_modified_at
           FROM   jabco_project_gantt
           WHERE  project_id = $1
           ORDER  BY planned_start ASC`,
          [parsed.data.projectId],
        ).then(r => r.rows),
      );

      logger.info({ entity: 'JABCO', action: 'GANTT_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /projects/:projectId/gantt ───────────────────────────────────────────

jabcoGanttRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const bodyParsed = CreateTaskSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;
    const projectId = paramParsed.data.projectId;

    const client = await commercialPool.connect();
    try {
      const newTask = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const proj = await c.query<{ id: string }>(`SELECT id FROM jabco_projects WHERE id = $1`, [projectId]);
        if (proj.rows.length === 0) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { httpStatus: 404 });

        return c.query(
          `INSERT INTO jabco_project_gantt
             (tenant_id, project_id, task_name, planned_start, planned_end,
              predecessor_id, completion_percentage, last_modified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,now())
           RETURNING *`,
          [tenantId, projectId, body.task_name, body.planned_start, body.planned_end,
           body.predecessor_id ?? null, body.completion_percentage],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'JABCO', action: 'GANTT_TASK_CREATED', user_id: userId, tenant_id: tenantId, record_id: newTask.id });

      const coreClient = await corePool.connect();
      try {
        await coreClient.query('BEGIN');
        await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenantId]);
        await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
        await coreClient.query(
          `INSERT INTO audit_log (tenant_id, user_id, entity, action, record_id, new_values, source)
           VALUES ($1,$2,'JabcoGanttTask','CREATE',$3,$4,'API')`,
          [tenantId, userId, newTask.id, JSON.stringify({ ...body, project_id: projectId })],
        );
        await coreClient.query('COMMIT');
      } catch (e) { await coreClient.query('ROLLBACK'); } finally { coreClient.release(); }

      ok(res, newTask, 201);
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'PROJECT_NOT_FOUND', 'Project not found.'); return; }
    next(e);
  }
});

// ── PATCH /projects/:projectId/gantt/:taskId ──────────────────────────────────

jabcoGanttRouter.patch('/:taskId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = TaskParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID in path.'); return; }

    const bodyParsed = PatchTaskSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body   = bodyParsed.data;
    const { taskId } = paramParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const setCols: string[] = ['last_modified_at = now()', 'updated_at = now()'];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

    if (body.actual_start            !== undefined) setCols.push(`actual_start           = ${push(body.actual_start)}`);
    if (body.actual_end              !== undefined) setCols.push(`actual_end             = ${push(body.actual_end)}`);
    if (body.completion_percentage   !== undefined) setCols.push(`completion_percentage  = ${push(body.completion_percentage)}`);
    if (body.planned_start           !== undefined) setCols.push(`planned_start          = ${push(body.planned_start)}`);
    if (body.planned_end             !== undefined) setCols.push(`planned_end            = ${push(body.planned_end)}`);

    params.push(taskId);

    const client = await commercialPool.connect();
    try {
      const updated = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE jabco_project_gantt SET ${setCols.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null),
      );

      if (!updated) { err(res, 404, 'TASK_NOT_FOUND', 'Gantt task not found.'); return; }

      logger.info({ entity: 'JABCO', action: 'GANTT_TASK_UPDATED', user_id: userId, tenant_id: tenantId, record_id: taskId });

      const coreClient = await corePool.connect();
      try {
        await coreClient.query('BEGIN');
        await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenantId]);
        await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
        await coreClient.query(
          `INSERT INTO audit_log (tenant_id, user_id, entity, action, record_id, new_values, source)
           VALUES ($1,$2,'JabcoGanttTask','UPDATE',$3,$4,'API')`,
          [tenantId, userId, taskId, JSON.stringify(body)],
        );
        await coreClient.query('COMMIT');
      } catch (e) { await coreClient.query('ROLLBACK'); } finally { coreClient.release(); }

      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
