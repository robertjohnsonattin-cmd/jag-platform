// GET  /api/v1/jabco/projects/:projectId/subcontractor-retention
// POST /api/v1/jabco/projects/:projectId/subcontractor-retention

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const jabcoRetentionRouter = Router({ mergeParams: true });

const ProjectParam = z.object({ projectId: z.string().uuid() });

const CreateRetentionSchema = z.object({
  subcontractor_name:       z.string().min(1).max(200),
  subcontractor_contact:    z.string().max(100).optional(),
  contract_amount:          z.number().positive(),
  retention_percentage:     z.number().min(0).max(100).default(5.00),
  release_condition:        z.enum(['PRACTICAL_COMPLETION', 'DEFECTS_LIABILITY_EXPIRY']),
  defects_liability_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  idempotency_key:          z.string().uuid(),
}).strict();

// ── GET /projects/:projectId/subcontractor-retention ──────────────────────────

jabcoRetentionRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ProjectParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, subcontractor_name, subcontractor_contact,
                  contract_amount, retention_percentage, retention_amount_held,
                  retention_released, release_condition, defects_liability_expiry,
                  status, last_modified_at, created_at
           FROM   jabco_subcontractor_retention
           WHERE  project_id = $1
           ORDER  BY created_at ASC`,
          [parsed.data.projectId],
        ).then(r => r.rows),
      );

      logger.info({ entity: 'JABCO', action: 'RETENTION_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /projects/:projectId/subcontractor-retention ─────────────────────────

jabcoRetentionRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const bodyParsed = CreateRetentionSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;
    const projectId = paramParsed.data.projectId;
    const retentionHeld = (body.contract_amount * body.retention_percentage) / 100;

    const client = await commercialPool.connect();
    try {
      const { record, created } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM jabco_subcontractor_retention WHERE idempotency_key = $1`,
          [body.idempotency_key],
        );
        if (existing.rows.length > 0) {
          const dup = await c.query(`SELECT * FROM jabco_subcontractor_retention WHERE id = $1`, [existing.rows[0].id]);
          return { record: dup.rows[0], created: false };
        }

        const proj = await c.query<{ id: string }>(`SELECT id FROM jabco_projects WHERE id = $1`, [projectId]);
        if (proj.rows.length === 0) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { httpStatus: 404 });

        const result = await c.query(
          `INSERT INTO jabco_subcontractor_retention
             (tenant_id, project_id, subcontractor_name, subcontractor_contact,
              contract_amount, retention_percentage, retention_amount_held,
              release_condition, defects_liability_expiry, idempotency_key, last_modified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
           RETURNING *`,
          [tenantId, projectId, body.subcontractor_name, body.subcontractor_contact ?? null,
           body.contract_amount, body.retention_percentage, retentionHeld,
           body.release_condition, body.defects_liability_expiry ?? null, body.idempotency_key],
        );
        return { record: result.rows[0], created: true };
      });

      logger.info({ entity: 'JABCO', action: created ? 'RETENTION_CREATED' : 'RETENTION_DUPLICATE', user_id: userId, tenant_id: tenantId, record_id: record.id });

      if (created) {
        const coreClient = await corePool.connect();
        try {
          await coreClient.query('BEGIN');
          await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenantId]);
          await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
          await coreClient.query(
            `INSERT INTO audit_log (tenant_id, user_id, entity, action, record_id, new_values, source)
             VALUES ($1,$2,'JabcoRetention','CREATE',$3,$4,'API')`,
            [tenantId, userId, record.id, JSON.stringify({ ...body, project_id: projectId, retention_amount_held: retentionHeld })],
          );
          await coreClient.query('COMMIT');
        } catch (e) { await coreClient.query('ROLLBACK'); } finally { coreClient.release(); }
      }

      ok(res, record, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'PROJECT_NOT_FOUND', 'Project not found.'); return; }
    next(e);
  }
});
