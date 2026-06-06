// GET  /api/v1/brian/permissions              — Brian or Robert: list all module permissions
// PATCH /api/v1/brian/permissions/:module     — Robert only: update a module's access level

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { invalidateBrianPermissionCache } from '../../middleware/brian';
import { corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const brianRouter = Router();
brianRouter.use(requireAuth());

const ModuleParam = z.object({
  module: z.enum(['PROPERTIES','JABCO','IMS','CRM','FAMILY','LIFESTYLE','DOCVAULT','SUCCESSION','BAR','CLUB','NLCB','DRAGONBRIDGE','ENTERTAINMENT']),
});

const PatchPermissionSchema = z.object({
  access_level: z.enum(['NONE', 'READ', 'WRITE']),
  notes:        z.string().max(500).optional(),
}).strict();

// ── GET /brian/permissions ────────────────────────────────────────────────────

brianRouter.get('/permissions', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Brian can see his own permissions; Robert (isOwner) can see them too.
    if (!req.rlsCtx.isOwner && !req.rlsCtx.isBrianPortal) {
      err(res, 403, 'FORBIDDEN', 'Access denied.'); return;
    }

    const client = await corePool.connect();
    try {
      const rows = await client.query(
        `SELECT module, access_level, granted_by, granted_at, notes, updated_at
         FROM   brian_module_permissions
         ORDER  BY module ASC`,
      );
      logger.info({ entity: 'BRIAN_PORTAL', action: 'PERMISSIONS_LIST', user_id: req.rlsCtx.userId });
      ok(res, rows.rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /brian/permissions/:module ─────────────────────────────────────────

brianRouter.patch('/permissions/:module', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.rlsCtx.isOwner) {
      err(res, 403, 'FORBIDDEN', 'Only the platform Owner can modify Brian\'s permissions.'); return;
    }

    const paramParsed = ModuleParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid module name.'); return; }

    const bodyParsed = PatchPermissionSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { module } = paramParsed.data;
    const { access_level, notes } = bodyParsed.data;
    const { userId } = req.rlsCtx;

    const client = await corePool.connect();
    try {
      const updated = await client.query(
        `UPDATE brian_module_permissions
         SET    access_level = $1,
                notes        = $2,
                granted_by   = $3,
                granted_at   = now(),
                updated_at   = now()
         WHERE  module = $4
         RETURNING *`,
        [access_level, notes ?? null, userId, module],
      ).then(r => r.rows[0] ?? null);

      if (!updated) { err(res, 404, 'MODULE_NOT_FOUND', 'Module not found.'); return; }

      // Invalidate cache so the new level takes effect immediately.
      invalidateBrianPermissionCache(module);

      logger.info({ entity: 'BRIAN_PORTAL', action: 'PERMISSION_UPDATED', module, access_level, user_id: userId });
      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
