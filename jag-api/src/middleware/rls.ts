import { PoolClient } from 'pg';

// RLS session context extracted from a verified Keycloak JWT.
// Route handlers must resolve keycloakSub → users.id before calling withTenantRLS/withOwnerRLS.
// Phase 1B: add jag_user_id and jag_tenant_id custom Keycloak mappers so the JWT carries
// these directly, removing the DB lookup at request start.
export interface RLSContext {
  userId: string;          // jag_core.users.id (internal UUID, not Keycloak sub)
  tenantId: string;        // jag_core.tenants.id
  isOwner: boolean;        // true for Owner role — enables app.bypass_rls on audit_log
  ownerId: string;         // jag_core.users.id — same as userId for owner-scoped DBs
  isBrianPortal?: boolean;   // true when JWT carries the brian_portal Keycloak role
  isAuditorPortal?: boolean; // true when JWT carries the jag_auditor Keycloak role
  operatorId?: string;       // Robert's userId when he is acting as Brian (X-Act-As: brian)
}

// PostgreSQL does not allow parameterised SET statements (SET x = $1 is invalid).
// Use set_config(name, value, is_local) instead — is_local=true scopes to the
// current transaction, equivalent to SET LOCAL.
function setLocal(client: PoolClient, name: string, value: string): Promise<unknown> {
  return client.query('SELECT set_config($1, $2, true)', [name, value]);
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
      // Enables Owner bypass on audit_log (see policy definition in migration 000003).
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

// Wraps a callback in a transaction with owner-scoped RLS session variables.
// Use for: jag_family, jag_properties.
export async function withOwnerRLS<T>(
  client: PoolClient,
  ctx: RLSContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
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
}
