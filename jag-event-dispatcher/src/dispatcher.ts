import { Pool, PoolClient } from 'pg';
import { config } from './config';
import { fireTier1Alert } from './alerts';
import { PendingEvent, EventHandler } from './types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processEvent(
  pool: Pool,
  corePool: Pool,
  dbName: string,
  event: PendingEvent,
  handlers: Map<string, EventHandler>,
): Promise<void> {
  const handler = handlers.get(event.event_type);

  if (!handler) {
    // Unknown event type — mark processed immediately to prevent a retry storm on deploy
    console.warn(
      `[${dbName}] No handler for event_type="${event.event_type}" (id=${event.id}) — marking processed`,
    );
    await pool.query('UPDATE pending_events SET processed_at = NOW() WHERE id = $1', [event.id]);
    return;
  }

  try {
    await handler(event);
    await pool.query('UPDATE pending_events SET processed_at = NOW() WHERE id = $1', [event.id]);
    console.log(`[${dbName}] ✓ ${event.event_type} (id=${event.id})`);
  } catch (err) {
    const { rows } = await pool.query<{ retry_count: number }>(
      `UPDATE pending_events
       SET retry_count = retry_count + 1,
           last_error  = $1
       WHERE id = $2
       RETURNING retry_count`,
      [err instanceof Error ? err.message : String(err), event.id],
    );

    const newRetryCount = rows[0]?.retry_count ?? config.maxRetries;
    console.error(
      `[${dbName}] ✗ ${event.event_type} (id=${event.id}) retry_count=${newRetryCount}`,
      err,
    );

    if (newRetryCount >= config.maxRetries) {
      await pool.query(
        `UPDATE pending_events SET failed_at = NOW() WHERE id = $1 AND failed_at IS NULL`,
        [event.id],
      );

      console.error(
        JSON.stringify({
          severity: 'ERROR',
          action: 'EVENT_PERMANENTLY_FAILED',
          entity: dbName,
          event_id: event.id,
          event_type: event.event_type,
          retry_count: newRetryCount,
          timestamp: new Date().toISOString(),
        }),
      );

      try {
        await fireTier1Alert(corePool, config.alertUserId, dbName, event, err);
      } catch (alertErr) {
        console.error(`[${dbName}] Failed to fire Tier 1 alert for event ${event.id}:`, alertErr);
      }
    }
  }
}

async function pollOnce(
  pool: Pool,
  corePool: Pool,
  dbName: string,
  handlers: Map<string, EventHandler>,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  let events: PendingEvent[] = [];

  try {
    await client.query('BEGIN');
    const { rows } = await client.query<PendingEvent>(
      `SELECT * FROM pending_events
       WHERE processed_at IS NULL
         AND retry_count < $1
       ORDER BY created_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [config.maxRetries, config.batchSize],
    );
    events = rows;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  for (const event of events) {
    await processEvent(pool, corePool, dbName, event, handlers);
  }
}

export async function startPollingLoop(
  pool: Pool,
  corePool: Pool,
  dbName: string,
  handlers: Map<string, EventHandler>,
  signal: { running: boolean },
): Promise<void> {
  console.log(`[${dbName}] Polling loop started (interval=${config.pollIntervalMs}ms)`);

  while (signal.running) {
    try {
      await pollOnce(pool, corePool, dbName, handlers);
    } catch (err) {
      console.error(`[${dbName}] Poll loop error:`, err);
    }
    await sleep(config.pollIntervalMs);
  }

  console.log(`[${dbName}] Polling loop stopped`);
}
