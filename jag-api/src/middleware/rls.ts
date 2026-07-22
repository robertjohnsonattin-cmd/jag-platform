import type { Pool, PoolClient } from 'pg';

export interface RLSContext {
  userId: string;          // jag_core.users.id (internal UUID, not Keycloak sub)
  tenantId: string;        // jag_core.tenants.id
  isOwner: boolean;        // true for Owner role — enables app.bypass_rls on audit_log
  ownerId: string;         // jag_core.users.id — same as userId for owner-scoped DBs
  isBrianPortal?: boolean;   // true when JWT carries the brian_portal Keycloak role
  isAuditorPortal?: boolean; // true when JWT carries the jag_auditor Keycloak role
  isCronService?: boolean;   // true when JWT carries the jag_cron_service Keycloak role (service account)
  operatorId?: string;       // Robert's userId when he is acting as Brian (X-Act-As: brian),
                             // or the cron service account's own userId when isCronService
}

// PostgreSQL does not allow parameterised SET statements (SET x = $1 is invalid).
// Use set_config(name, value, is_local) instead — is_local=true scopes to the
// current transaction, equivalent to SET LOCAL.
function setLocal(client: PoolClient, name: string, value: string): Promise<unknown> {
  return client.query('SELECT set_config($1, $2, true)', [name, value]);
}

function isPoolClient(p: Pool | PoolClient): p is PoolClient {
  return typeof (p as PoolClient).release === 'function';
}

// Wraps a callback in a transaction with tenant-scoped RLS session variables.
// Use for: jag_core, jag_commercial, jag_entertainment.
export async function withTenantRLS<T>(
  client: PoolClient,
  ctx: RLSContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await setLocal(client, 'app.current_tenant_id', ctx.tenantId);
    await setLocal(client, 'app.current_user_id', ctx.userId);
    if (ctx.isOwner) {
      await setLocal(client, 'app.bypass_rls', 'true');
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// Overload 1: existing pattern — caller manages pool checkout lifecycle
export async function withOwnerRLS<T>(
  client: PoolClient,
  ctx: RLSContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T>;
// Overload 2: convenience pattern — pool + ownerId string; checkout handled internally
export async function withOwnerRLS<T>(
  pool: Pool,
  ownerId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T>;
// Implementation
export async function withOwnerRLS<T>(
  poolOrClient: Pool | PoolClient,
  ctxOrOwnerId: RLSContext | string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (isPoolClient(poolOrClient)) {
    // Overload 1: caller-managed client
    const client = poolOrClient;
    const ctx = ctxOrOwnerId as RLSContext;
    await client.query('BEGIN');
    try {
      await setLocal(client, 'app.current_owner_id', ctx.ownerId);
      await setLocal(client, 'app.current_user_id', ctx.userId);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } else {
    // Overload 2: auto-checkout from pool
    const pool = poolOrClient as Pool;
    const ownerId = ctxOrOwnerId as string;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await setLocal(client, 'app.current_owner_id', ownerId);
        await setLocal(client, 'app.current_user_id', ownerId);
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    } finally {
      client.release();
    }
  }
}
