import { corePool } from '../db/index';
import { withOwnerRLS } from '../middleware/rls';
import { logger } from './logger';

// Owner (Robert) jag_core users.id — recipient for all owner-facing in-app
// notifications. Overridable via env (mirrors the dispatcher's alertUserId).
const OWNER_USER_ID =
  process.env['NOTIFY_OWNER_USER_ID'] ?? '95ca3f77-60ba-4a0f-af70-2832b247b525';

export type NotificationTier = 1 | 2 | 3; // 1=Immediate | 2=Daily 7am | 3=Weekly

export interface EnqueueNotificationOptions {
  tier: NotificationTier;
  title: string;
  body: string;
  payload?: unknown;          // structured deep-link context for the client
  tenantId?: string | null;   // optional tenant attribution (nullable FK)
  recipientUserId?: string;   // defaults to the owner
}

/**
 * Inserts a single IN_APP notification into jag_core.notification_queue.
 *
 * Non-blocking by design: any failure is logged and swallowed — a notification
 * problem must never break the business write that triggered it. Always call as
 * `void enqueueNotification(...)` from route handlers (same fire-and-forget shape
 * as the existing WhatsApp sendTemplate(...).catch(...) calls).
 *
 * RLS: notification_queue's user_isolation policy (USING, reused as the INSERT
 * WITH CHECK under FORCE RLS) requires app.current_user_id = the row's user_id.
 * withOwnerRLS(corePool, recipient, ...) sets app.current_user_id to the recipient
 * for us, so the insert passes the policy.
 */
export async function enqueueNotification(opts: EnqueueNotificationOptions): Promise<void> {
  const recipient = opts.recipientUserId ?? OWNER_USER_ID;
  try {
    await withOwnerRLS(corePool, recipient, (c) =>
      c.query(
        `INSERT INTO notification_queue (user_id, tenant_id, tier, channel, title, body, payload)
         VALUES ($1, $2, $3, 'IN_APP', $4, $5, $6)`,
        [
          recipient,
          opts.tenantId ?? null,
          opts.tier,
          opts.title,
          opts.body,
          opts.payload === undefined ? null : JSON.stringify(opts.payload),
        ],
      ),
    );
  } catch (e) {
    logger.warn({
      entity: 'NOTIFICATIONS',
      action: 'ENQUEUE_FAILED',
      recipient_user_id: recipient,
      title: opts.title,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
