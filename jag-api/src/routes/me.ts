import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { corePool } from '../db/index';
import { logger } from '../lib/logger';
import { ok } from '../lib/response';

const router = Router();

router.use(requireAuth());

// ── GET /api/v1/me ────────────────────────────────────────────────────────────
//
// Returns the authenticated user's profile and all active tenant memberships.
// Uses the user_self_access RLS policy (migration 000007) which allows reading
// user_tenant_roles rows where user_id = app.current_user_id, regardless of
// which tenant is active — necessary to list all tenants before one is chosen.

router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { userId } = req.rlsCtx;
    const client = await corePool.connect();

    try {
      await client.query('BEGIN');

      // set_config(..., true) is the parameterised equivalent of SET LOCAL.
      await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);

      const [userResult, tenantResult] = await Promise.all([
        client.query<{
          id: string;
          email: string;
          display_name: string;
          preferred_language: string;
          is_active: boolean;
          last_login_at: string | null;
          created_at: string;
        }>(
          `SELECT id, email, display_name, preferred_language, is_active, last_login_at, created_at
           FROM users
           WHERE id = $1`,
          [userId],
        ),

        client.query<{
          tenant_id: string;
          tenant_code: string;
          tenant_name: string;
          role: string;
          expires_at: string | null;
          granted_at: string;
        }>(
          `SELECT
             t.id        AS tenant_id,
             t.code      AS tenant_code,
             t.name      AS tenant_name,
             r.name      AS role,
             utr.expires_at,
             utr.created_at AS granted_at
           FROM user_tenant_roles utr
           JOIN tenants t ON t.id    = utr.tenant_id
           JOIN roles   r ON r.id    = utr.role_id
           WHERE utr.user_id  = $1
             AND utr.is_active = true
             AND (utr.expires_at IS NULL OR utr.expires_at > now())
             AND utr.revoked_at IS NULL
             AND t.is_active   = true
           ORDER BY (r.name = 'Owner') DESC, utr.created_at ASC`,
          [userId],
        ),
      ]);

      await client.query('COMMIT');

      logger.info({
        entity: 'ME',
        action: 'PROFILE_READ',
        user_id: userId,
        tenant_id: req.rlsCtx.tenantId,
      });

      ok(res, {
        user: userResult.rows[0] ?? null,
        tenants: tenantResult.rows,
      });
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

export { router as meRouter };
