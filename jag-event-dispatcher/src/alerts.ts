import { Pool } from 'pg';
import { PendingEvent } from './types';

/**
 * Inserts a Tier 1 immediate alert into jag_core.notification_queue.
 * Called when an event exhausts its retry budget (retry_count >= MAX_RETRIES).
 */
export async function fireTier1Alert(
  corePool: Pool,
  alertUserId: string,
  dbName: string,
  event: PendingEvent,
  error: unknown,
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const title = `Event dispatcher failure: ${event.event_type}`;
  const body =
    `Event ${event.id} in ${dbName} has failed ${event.retry_count + 1} time(s) ` +
    `and will not be retried. Last error: ${errorMessage}`;

  await corePool.query(
    `INSERT INTO notification_queue (user_id, tier, channel, title, body, payload)
     VALUES ($1, 1, 'IN_APP', $2, $3, $4)`,
    [
      alertUserId,
      title,
      body,
      JSON.stringify({
        event_id: event.id,
        db: dbName,
        event_type: event.event_type,
        aggregate_type: event.aggregate_type,
        aggregate_id: event.aggregate_id,
        retry_count: event.retry_count + 1,
        last_error: errorMessage,
      }),
    ],
  );
}
