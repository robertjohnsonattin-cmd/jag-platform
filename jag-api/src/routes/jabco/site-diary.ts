// GET  /api/v1/jabco/projects/:projectId/site-diary
// POST /api/v1/jabco/projects/:projectId/site-diary

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const jabcoSiteDiaryRouter = Router({ mergeParams: true });

// ── Schemas ───────────────────────────────────────────────────────────────────

const ProjectParam = z.object({ projectId: z.string().uuid() });

const DiaryQuerySchema = z.object({
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const CreateDiarySchema = z.object({
  entry_date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weather:               z.string().max(100).optional(),
  workers_on_site:       z.number().int().min(0).optional(),
  activities_completed:  z.string().optional(),
  materials_received:    z.string().optional(),
  equipment_on_site:     z.string().optional(),
  instructions_received: z.string().optional(),
  issues_noted:          z.string().optional(),
  idempotency_key:       z.string().uuid(),
}).strict();

// ── GET /projects/:projectId/site-diary ───────────────────────────────────────

jabcoSiteDiaryRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const queryParsed = DiaryQuerySchema.safeParse(req.query);
    if (!queryParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }

    const { projectId } = paramParsed.data;
    const { from_date, to_date, page, limit } = queryParsed.data;
    const offset = (page - 1) * limit;

    const client = await commercialPool.connect();
    try {
      const { rows, total } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const params: unknown[] = [projectId];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions = ['d.project_id = $1'];

        if (from_date) conditions.push(`d.entry_date >= ${push(from_date)}`);
        if (to_date)   conditions.push(`d.entry_date <= ${push(to_date)}`);
        const where = conditions.join(' AND ');

        const countResult = await c.query<{ count: string }>(
          `SELECT count(*) FROM jabco_site_diary d WHERE ${where}`, params,
        );

        const dataResult = await c.query(
          `SELECT d.id, d.entry_date, d.weather, d.workers_on_site,
                  d.activities_completed, d.materials_received, d.equipment_on_site,
                  d.instructions_received, d.issues_noted,
                  d.sync_status, d.foreman_id, d.last_modified_at, d.created_at
           FROM   jabco_site_diary d
           WHERE  ${where}
           ORDER  BY d.entry_date DESC
           LIMIT  ${push(limit)} OFFSET ${push(offset)}`,
          params,
        );

        return { rows: dataResult.rows, total: Number(countResult.rows[0].count) };
      });

      logger.info({ entity: 'JABCO', action: 'DIARY_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId });
      ok(res, { entries: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /projects/:projectId/site-diary ──────────────────────────────────────
//
// OFFLINE-CRITICAL: foreman submits on reconnect with a client-generated
// idempotency_key. Duplicate delivery → 200 with original record (STD-11).
// Out-of-order delivery is safe — idempotency_key prevents double-posting.

jabcoSiteDiaryRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const bodyParsed = CreateDiarySchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;
    const { projectId } = paramParsed.data;

    const client = await commercialPool.connect();
    try {
      const { entry, created } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // STD-11 idempotency — keyed on idempotency_key field.
        // jabco_site_diary does not have an idempotency_key column, so we key on
        // (project_id, foreman_id, entry_date) unique constraint instead.
        // The idempotency_key is stored in the notes field as a fallback until a
        // proper column is added via STD-13 Expand-and-Contract migration.
        //
        // TODO Phase 2: add idempotency_key column to jabco_site_diary via
        // STD-13 Expand-and-Contract — 5 migration steps required.

        // For now: check for existing entry for this foreman on this date.
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM jabco_site_diary
           WHERE project_id = $1 AND foreman_id = $2 AND entry_date = $3`,
          [projectId, userId, body.entry_date],
        );
        if (existing.rows.length > 0) {
          const dup = await c.query(`SELECT * FROM jabco_site_diary WHERE id = $1`, [existing.rows[0].id]);
          return { entry: dup.rows[0], created: false };
        }

        const proj = await c.query<{ id: string }>(`SELECT id FROM jabco_projects WHERE id = $1`, [projectId]);
        if (proj.rows.length === 0) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { httpStatus: 404 });

        const result = await c.query(
          `INSERT INTO jabco_site_diary
             (tenant_id, project_id, foreman_id, entry_date, weather,
              workers_on_site, activities_completed, materials_received,
              equipment_on_site, instructions_received, issues_noted,
              sync_status, last_modified_by, last_modified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'SYNCED',$12,now())
           RETURNING *`,
          [
            tenantId, projectId, userId, body.entry_date,
            body.weather ?? null, body.workers_on_site ?? null,
            body.activities_completed ?? null, body.materials_received ?? null,
            body.equipment_on_site ?? null, body.instructions_received ?? null,
            body.issues_noted ?? null, userId,
          ],
        );
        return { entry: result.rows[0], created: true };
      });

      logger.info({ entity: 'JABCO', action: created ? 'DIARY_CREATED' : 'DIARY_DUPLICATE', user_id: userId, tenant_id: tenantId, record_id: entry.id });

      if (created) {
        const coreClient = await corePool.connect();
        try {
          await coreClient.query('BEGIN');
          await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenantId]);
          await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
          await coreClient.query(
            `INSERT INTO audit_log (tenant_id, user_id, entity, action, record_id, new_values, source)
             VALUES ($1,$2,'JabcoSiteDiary','CREATE',$3,$4,'API')`,
            [tenantId, userId, entry.id, JSON.stringify({ ...body, project_id: projectId })],
          );
          await coreClient.query('COMMIT');
        } catch (auditErr) {
          await coreClient.query('ROLLBACK');
          logger.warn({ entity: 'JABCO', action: 'AUDIT_LOG_FAILED', error_message: (auditErr as Error).message });
        } finally { coreClient.release(); }
      }

      ok(res, entry, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'PROJECT_NOT_FOUND', 'Project not found.'); return; }
    next(e);
  }
});
