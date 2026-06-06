import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { corePool } from '../db/index';
import { logger } from '../lib/logger';
import { ok } from '../lib/response';

const router = Router();

router.use(requireAuth());

// ── GET /api/v1/tenants ───────────────────────────────────────────────────────
//
// Lists the tenants the authenticated caller has an active role in.
// Uses the user_self_access RLS policy so all memberships are visible
// before a specific tenant context is established.

router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { userId } = req.rlsCtx;
    const client = await corePool.connect();

    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);

      const result = await client.query<{
        id: string;
        code: string;
        name: string;
        parent_tenant_id: string | null;
        role: string;
        expires_at: string | null;
      }>(
        `SELECT
           t.id,
           t.code,
           t.name,
           t.parent_tenant_id,
           r.name      AS role,
           utr.expires_at
         FROM user_tenant_roles utr
         JOIN tenants t ON t.id  = utr.tenant_id
         JOIN roles   r ON r.id  = utr.role_id
         WHERE utr.user_id  = $1
           AND utr.is_active = true
           AND (utr.expires_at IS NULL OR utr.expires_at > now())
           AND utr.revoked_at IS NULL
           AND t.is_active   = true
         ORDER BY (r.name = 'Owner') DESC, t.name ASC`,
        [userId],
      );

      await client.query('COMMIT');

      logger.info({
        entity: 'TENANTS',
        action: 'LIST',
        user_id: userId,
        tenant_id: req.rlsCtx.tenantId,
      });

      ok(res, result.rows);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    next(e);
  }
});

export { router as tenantsRouter };
