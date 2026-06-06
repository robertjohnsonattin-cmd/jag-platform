import type { MigrationBuilder } from 'node-pg-migrate';

// Phase 1B — user_tenant_roles self-access RLS policy.
//
// Problem: the existing tenant_isolation policy on user_tenant_roles only allows
// reads when app.current_tenant_id is set, creating a chicken-and-egg situation:
// to list all tenants a user belongs to (GET /me, GET /tenants), there is no
// single tenant context to set.
//
// Fix: add a second SELECT policy that allows a user to see their own rows by
// matching app.current_user_id against user_id.
//
// PostgreSQL ORs multiple permissive policies of the same command type together,
// so either policy granting access is sufficient. This does NOT weaken tenant
// isolation — it adds a user-scoped read path alongside the tenant-scoped one.
//
// The API sets app.current_user_id in withTenantRLS and withOwnerRLS via
// `SET LOCAL app.current_user_id = $userId`. The GET /me route additionally
// sets it directly so the self-access policy fires before tenant context exists.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE POLICY user_self_access ON user_tenant_roles
      USING (
        user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
      );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP POLICY IF EXISTS user_self_access ON user_tenant_roles;`);
}
