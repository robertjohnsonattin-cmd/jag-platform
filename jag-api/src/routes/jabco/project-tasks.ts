// GET    /api/v1/jabco/projects/:projectId/tasks
// POST   /api/v1/jabco/projects/:projectId/tasks
// PATCH  /api/v1/jabco/projects/:projectId/tasks/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const jabcoProjectTasksRouter = Router({ mergeParams: true });

// ── Schemas ───────────────────────────────────────────────────────────────────

const ProjectParam = z.object({ projectId: z.string().uuid() });
const TaskParam    = z.object({ projectId: z.string().uuid(), id: z.string().uuid() });

const TasksQuerySchema = z.object({
  task_type: z.enum(['MOBILIZATION','POST_MORTEM','GENERAL']).optional(),
}).strict();

const CreateTaskSchema = z.object({
  task_type:   z.enum(['MOBILIZATION','POST_MORTEM','GENERAL']).default('GENERAL'),
  title:       z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  assigned_to: z.string().uuid().optional(),
  due_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

const PatchTaskSchema = z.object({
  status:      z.enum(['OPEN','IN_PROGRESS','DONE']).optional(),
  due_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  title:       z.string().min(1).max(200).optional(),
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

// ── GET /projects/:projectId/tasks ────────────────────────────────────────────

jabcoProjectTasksRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const queryParsed = TasksQuerySchema.safeParse(req.query);
    if (!queryParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }

    const { projectId } = paramParsed.data;
    const { task_type } = queryParsed.data;

    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const params: unknown[] = [projectId];
        const conditions: string[] = [`project_id = $1`];
        if (task_type) {
          params.push(task_type);
          conditions.push(`task_type = $${params.length}`);
        }
        const where = `WHERE ${conditions.join(' AND ')}`;
        return c.query(
          `SELECT id, task_type, title, description, assigned_to, due_date,
                  status, completed_at, created_at, updated_at
           FROM   jabco_project_tasks
           ${where}
           ORDER  BY created_at ASC`,
          params,
        ).then(r => r.rows);
      });

      logger.info({ entity: 'JABCO', action: 'TASKS_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId, project_id: projectId });
      ok(res, { tasks: rows });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /projects/:projectId/tasks ───────────────────────────────────────────

jabcoProjectTasksRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const bodyParsed = CreateTaskSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { projectId } = paramParsed.data;
    const body = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const newTask = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Verify project exists and belongs to this tenant.
        const proj = await c.query<{ id: string }>(
          `SELECT id FROM jabco_projects WHERE id = $1`, [projectId],
        );
        if (proj.rows.length === 0) throw Object.assign(new Error('Project not found.'), { status: 404, code: 'PROJECT_NOT_FOUND' });

        return c.query(
          `INSERT INTO jabco_project_tasks
             (tenant_id, project_id, task_type, title, description,
              assigned_to, due_date, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN')
           RETURNING *`,
          [
            tenantId, projectId, body.task_type, body.title,
            body.description ?? null, body.assigned_to ?? null,
            body.due_date ?? null,
          ],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'JABCO', action: 'TASK_CREATED', user_id: userId, tenant_id: tenantId, record_id: newTask.id, project_id: projectId });
      await auditLog(tenantId, userId, 'JabcoProjectTask', 'CREATE', newTask.id, { ...body, project_id: projectId });
      ok(res, newTask, 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { err(res, 404, ex.code ?? 'PROJECT_NOT_FOUND', ex.message); return; }
    next(e);
  }
});

// ── PATCH /projects/:projectId/tasks/:id ──────────────────────────────────────

jabcoProjectTasksRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = TaskParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID and Task ID must be valid UUIDs.'); return; }

    const bodyParsed = PatchTaskSchema.safeParse(req.body);
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

        if (b.title       !== undefined) sets.push(`title = ${push(b.title)}`);
        if (b.assigned_to !== undefined) sets.push(`assigned_to = ${push(b.assigned_to)}`);
        if (b.due_date    !== undefined) sets.push(`due_date = ${push(b.due_date)}`);
        if (b.status      !== undefined) {
          sets.push(`status = ${push(b.status)}`);
          // Server-side: set completed_at when marking DONE.
          if (b.status === 'DONE') sets.push(`completed_at = now()`);
        }

        params.push(id);
        params.push(projectId);
        return c.query(
          `UPDATE jabco_project_tasks
           SET ${sets.join(', ')}
           WHERE id = $${params.length - 1} AND project_id = $${params.length}
           RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null);
      });

      if (!updated) { err(res, 404, 'TASK_NOT_FOUND', 'Task not found for this project.'); return; }
      logger.info({ entity: 'JABCO', action: 'TASK_PATCHED', user_id: userId, tenant_id: tenantId, record_id: id, project_id: projectId });
      await auditLog(tenantId, userId, 'JabcoProjectTask', 'UPDATE', id, b);
      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
