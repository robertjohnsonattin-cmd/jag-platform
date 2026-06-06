import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { withTenantRLS } from '../middleware/rls';
import { corePool } from '../db/index';
import { logger } from '../lib/logger';
import { ok, err } from '../lib/response';

const router = Router();

router.use(requireAuth());

// ── Query / path schemas ──────────────────────────────────────────────────────

const ListQuerySchema = z.object({
  page:        z.coerce.number().int().min(1).default(1),
  limit:       z.coerce.number().int().min(1).max(100).default(20),
  unread_only: z.enum(['true', 'false', '1', '0']).optional(),
}).strict();

const NotifIdSchema = z.object({
  id: z.string().uuid(),
});

// ── Row type ──────────────────────────────────────────────────────────────────

interface NotifRow {
  id: string;
  tenant_id: string | null;
  tier: number;
  channel: string;
  title: string;
  body: string;
  payload: unknown;
  is_read: boolean;
  is_sent: boolean;
  sent_at: string | null;
  scheduled_for: string | null;
  created_at: string;
}

// ── GET /api/v1/notifications ─────────────────────────────────────────────────
//
// Returns the authenticated user's notification queue, newest first.
// RLS on notification_queue is user_id-scoped (migration 000003), enforced via
// app.current_user_id set by withTenantRLS.
//
// Owner sees all their own notifications across all tenants — this is automatic
// because the policy is user_id based, not tenant_id based.
//
// Query params:
//   page        — page number (default 1)
//   limit       — rows per page (default 20, max 100)
//   unread_only — if truthy, return only is_read = false entries

router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.');
      return;
    }

    const { page, limit, unread_only } = parsed.data;
    const showUnreadOnly = unread_only === 'true' || unread_only === '1';
    const offset = (page - 1) * limit;

    const client = await corePool.connect();
    try {
      const { rows, totalCount } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const countResult = await c.query<{ count: string }>(
          `SELECT count(*) FROM notification_queue
           WHERE ($1 = false OR is_read = false)`,
          [showUnreadOnly],
        );

        const dataResult = await c.query<NotifRow>(
          `SELECT id, tenant_id, tier, channel, title, body, payload,
                  is_read, is_sent, sent_at, scheduled_for, created_at
           FROM   notification_queue
           WHERE  ($1 = false OR is_read = false)
           ORDER  BY created_at DESC
           LIMIT  $2 OFFSET $3`,
          [showUnreadOnly, limit, offset],
        );

        return { rows: dataResult.rows, totalCount: Number(countResult.rows[0].count) };
      });

      logger.info({
        entity:    'NOTIFICATIONS',
        action:    'LIST',
        user_id:   req.rlsCtx.userId,
        tenant_id: req.rlsCtx.tenantId,
        count:     rows.length,
      });

      ok(res, {
        notifications: rows,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit),
        },
      });
    } finally {
      client.release();
    }
  } catch (e) {
    next(e);
  }
});

// ── PATCH /api/v1/notifications/:id/read ─────────────────────────────────────
//
// Marks a single notification as read. Returns 404 if the notification does not
// exist OR belongs to a different user (RLS prevents cross-user access — the
// UPDATE finds zero rows, indistinguishable from not-found by design).
//
// Writes an audit_log entry within the same transaction (STD per Phase 1B plan).

router.patch('/:id/read', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParse = NotifIdSchema.safeParse(req.params);
    if (!idParse.success) {
      err(res, 422, 'VALIDATION_ERROR', 'Notification ID must be a valid UUID.');
      return;
    }

    const { id } = idParse.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await corePool.connect();
    try {
      const updated = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const result = await c.query<NotifRow>(
          `UPDATE notification_queue
           SET    is_read    = true,
                  updated_at = now()
           WHERE  id = $1
             AND  is_read = false
           RETURNING id, tenant_id, tier, channel, title, body, payload,
                     is_read, is_sent, sent_at, scheduled_for, created_at`,
          [id],
        );

        if (result.rows.length === 0) {
          // Either not found or already read — treat both as 404 to avoid leaking
          // information about other users' notification IDs.
          return null;
        }

        const notif = result.rows[0];

        // Audit log (STD — every mutating endpoint logs within the same tx).
        await c.query(
          `INSERT INTO audit_log (tenant_id, user_id, entity, action, record_id, source)
           VALUES ($1, $2, 'Notification', 'MARK_READ', $3, 'API')`,
          [tenantId, userId, id],
        );

        return notif;
      });

      if (updated === null) {
        err(res, 404, 'NOTIFICATION_NOT_FOUND', 'Notification not found or already read.');
        return;
      }

      logger.info({
        entity:    'NOTIFICATIONS',
        action:    'MARK_READ',
        user_id:   userId,
        tenant_id: tenantId,
        record_id: id,
      });

      ok(res, updated);
    } finally {
      client.release();
    }
  } catch (e) {
    next(e);
  }
});

export { router as notificationsRouter };
