// GET    /api/v1/jabco/projects/:projectId/punch-list
// POST   /api/v1/jabco/projects/:projectId/punch-list
// PATCH  /api/v1/jabco/projects/:projectId/punch-list/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const jabcoPunchListRouter = Router({ mergeParams: true });

// ── Schemas ───────────────────────────────────────────────────────────────────

const ProjectParam = z.object({ projectId: z.string().uuid() });
const PunchParam   = z.object({ projectId: z.string().uuid(), id: z.string().uuid() });

const PunchQuerySchema = z.object({
  status: z.enum(['IDENTIFIED','RECTIFIED','VERIFIED']).optional(),
}).strict();

const CreatePunchSchema = z.object({
  description: z.string().min(1),
  location:    z.string().max(200).optional(),
  trade:       z.string().max(100).optional(),
  photo_url:   z.string().optional(),
}).strict();

const PatchPunchSchema = z.object({
  status:        z.enum(['RECTIFIED','VERIFIED']),
  rectified_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  verified_by:   z.string().uuid().optional(),
  verified_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
      `INSERT INTO audit_log (tenant_id, user_id, entity, action, record_id, new_values, source) VALUES ($1,$2,$3,$4,$5,$6,'API')`,
      [tenantId, userId, entity, action, recordId, JSON.stringify(newValues)],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); logger.warn({ entity, action: 'AUDIT_LOG_FAILED', error_message: (e as Error).message }); }
  finally { client.release(); }
}

// ── GET /projects/:projectId/punch-list ───────────────────────────────────────

jabcoPunchListRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const queryParsed = PunchQuerySchema.safeParse(req.query);
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
          `SELECT id, description, location, trade, photo_url, status,
                  identified_by, identified_date,
                  rectified_date, verified_by, verified_date,
                  created_at, updated_at
           FROM   jabco_punch_list_items
           WHERE  ${conditions.join(' AND ')}
           ORDER  BY created_at ASC`,
          params,
        ).then(r => r.rows);
      });

      logger.info({ entity: 'JABCO', action: 'PUNCH_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId, project_id: projectId });
      ok(res, { punch_list_items: rows });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /projects/:projectId/punch-list ──────────────────────────────────────

jabcoPunchListRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const bodyParsed = CreatePunchSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { projectId } = paramParsed.data;
    const body = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const newItem = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Verify project exists.
        const proj = await c.query<{ id: string }>(
          `SELECT id FROM jabco_projects WHERE id = $1`, [projectId],
        );
        if (proj.rows.length === 0) throw Object.assign(new Error('Project not found.'), { status: 404, code: 'PROJECT_NOT_FOUND' });

        return c.query(
          `INSERT INTO jabco_punch_list_items
             (tenant_id, project_id, description, location, trade, photo_url,
              status, identified_by, identified_date)
           VALUES ($1,$2,$3,$4,$5,$6,'IDENTIFIED',$7,CURRENT_DATE)
           RETURNING *`,
          [
            tenantId, projectId, body.description,
            body.location ?? null, body.trade ?? null,
            body.photo_url ?? null, userId,
          ],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'JABCO', action: 'PUNCH_ITEM_CREATED', user_id: userId, tenant_id: tenantId, record_id: newItem.id, project_id: projectId });
      await auditLog(tenantId, userId, 'JabcoPunchListItem', 'CREATE', newItem.id, { ...body, project_id: projectId });
      ok(res, newItem, 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { err(res, 404, ex.code ?? 'PROJECT_NOT_FOUND', ex.message); return; }
    next(e);
  }
});

// ── PATCH /projects/:projectId/punch-list/:id ─────────────────────────────────
// State-gated: IDENTIFIED → RECTIFIED → VERIFIED only.

jabcoPunchListRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = PunchParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID and Item ID must be valid UUIDs.'); return; }

    const bodyParsed = PatchPunchSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { projectId, id } = paramParsed.data;
    const b = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const updated = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Read current status within the same RLS-scoped connection.
        const current = await c.query<{ status: string }>(
          `SELECT status FROM jabco_punch_list_items WHERE id = $1 AND project_id = $2`,
          [id, projectId],
        ).then(r => r.rows[0] ?? null);

        if (!current) throw Object.assign(new Error('Punch list item not found for this project.'), { status: 404, code: 'PUNCH_ITEM_NOT_FOUND' });

        // State-gate validation.
        if (b.status === 'RECTIFIED' && current.status !== 'IDENTIFIED') {
          throw Object.assign(
            new Error(`Cannot transition to RECTIFIED from ${current.status}. Only IDENTIFIED items can be rectified.`),
            { status: 409, code: 'INVALID_TRANSITION' },
          );
        }
        if (b.status === 'VERIFIED' && current.status !== 'RECTIFIED') {
          throw Object.assign(
            new Error(`Cannot transition to VERIFIED from ${current.status}. Only RECTIFIED items can be verified.`),
            { status: 409, code: 'INVALID_TRANSITION' },
          );
        }

        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const sets: string[] = [`status = ${push(b.status)}`, `updated_at = now()`];

        if (b.status === 'RECTIFIED') {
          sets.push(`rectified_date = ${push(b.rectified_date ?? null)} :: date`);
          // If no date provided, fall back to CURRENT_DATE.
          if (!b.rectified_date) {
            sets[sets.length - 1] = `rectified_date = CURRENT_DATE`;
            params.pop(); // remove the null we just pushed
          }
        }

        if (b.status === 'VERIFIED') {
          sets.push(`verified_by = ${push(b.verified_by ?? userId)}`);
          if (b.verified_date) {
            sets.push(`verified_date = ${push(b.verified_date)}`);
          } else {
            sets.push(`verified_date = CURRENT_DATE`);
          }
        }

        params.push(id);
        params.push(projectId);
        return c.query(
          `UPDATE jabco_punch_list_items
           SET ${sets.join(', ')}
           WHERE id = $${params.length - 1} AND project_id = $${params.length}
           RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null);
      });

      if (!updated) { err(res, 404, 'PUNCH_ITEM_NOT_FOUND', 'Punch list item not found for this project.'); return; }
      logger.info({ entity: 'JABCO', action: 'PUNCH_ITEM_PATCHED', user_id: userId, tenant_id: tenantId, record_id: id, project_id: projectId, new_status: b.status });
      await auditLog(tenantId, userId, 'JabcoPunchListItem', 'UPDATE', id, b);
      ok(res, updated);
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { err(res, 404, ex.code ?? 'PUNCH_ITEM_NOT_FOUND', ex.message); return; }
    if (ex.status === 409) { err(res, 409, ex.code ?? 'INVALID_TRANSITION', ex.message); return; }
    next(e);
  }
});
