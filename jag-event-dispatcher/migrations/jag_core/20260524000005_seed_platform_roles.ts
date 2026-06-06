import type { MigrationBuilder } from 'node-pg-migrate';

// Phase 1A — jag_core role seed.
//
// Inserts the 8 canonical platform roles into jag_core.roles.
// Deterministic UUIDs allow cross-migration and test-fixture references
// without querying the roles table at runtime.
//
// Role names exactly match the Keycloak realm role names in jag_keycloak_realm_v1.json
// so the auth middleware comparison (r.name = 'Owner') works correctly.
//
// ON CONFLICT (name) DO NOTHING — fully idempotent; safe to run multiple times.
//
// Changes to role definitions require a written change request (STD-12).

// Deterministic role UUIDs — treat these as platform constants.
// Never reassign; reference directly in fixtures and migration scripts.
//
//   ROLE_OWNER              = '00000000-0000-0000-0000-000000000001'
//   ROLE_DOMAIN_ADMIN       = '00000000-0000-0000-0000-000000000002'
//   ROLE_OPERATOR           = '00000000-0000-0000-0000-000000000003'
//   ROLE_VIEWER             = '00000000-0000-0000-0000-000000000004'
//   ROLE_EXTERNAL_ADVISOR   = '00000000-0000-0000-0000-000000000005'
//   ROLE_AUDITOR            = '00000000-0000-0000-0000-000000000006'
//   ROLE_EMERGENCY_DESIGNATE= '00000000-0000-0000-0000-000000000007'
//   ROLE_SYSTEM             = '00000000-0000-0000-0000-000000000008'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    INSERT INTO roles (id, name, description) VALUES
      (
        '00000000-0000-0000-0000-000000000001',
        'Owner',
        'Platform owner. Unrestricted access across all tenants and modules. Robert only. '
        || 'Succession activation adds a parallel Owner grant to the emergency designate — '
        || 'Robert''s own record is never demoted or modified (v1.9 rule).'
      ),
      (
        '00000000-0000-0000-0000-000000000002',
        'Domain Admin',
        'Manages a specific business entity (tenant). Can grant Operator, Viewer, or '
        || 'External Advisor roles within their tenant scope.'
      ),
      (
        '00000000-0000-0000-0000-000000000003',
        'Operator',
        'Day-to-day operations access within the assigned tenant. '
        || 'Can create and update records; cannot delete or access financial summaries.'
      ),
      (
        '00000000-0000-0000-0000-000000000004',
        'Viewer',
        'Read-only access within the assigned tenant. Cannot create, update, or delete.'
      ),
      (
        '00000000-0000-0000-0000-000000000005',
        'External Advisor',
        'Time-limited scoped read access for lawyers and external parties. '
        || 'Always expires — no perpetual grants. Scope defined in external_advisor_grants.scope (jsonb).'
      ),
      (
        '00000000-0000-0000-0000-000000000006',
        'Auditor',
        'Read-only access to audit_log and financial records across all tenants. '
        || 'No write access. Designed for accountants and compliance reviewers.'
      ),
      (
        '00000000-0000-0000-0000-000000000007',
        'Emergency Designate',
        'Wife role. Full read-only access to all owner data activated on succession event. '
        || 'Granted in parallel — Robert''s Owner record is never touched during succession activation.'
      ),
      (
        '00000000-0000-0000-0000-000000000008',
        'System',
        'Internal service accounts: jag-event-dispatcher, webhook receiver. '
        || 'No human users assigned to this role.'
      )
    ON CONFLICT (name) DO NOTHING;
  `);
}


export async function down(pgm: MigrationBuilder): Promise<void> {
  // This will fail with a FK violation if any user_tenant_roles rows reference
  // these roles — which is the correct behaviour. Do not roll back a seeded role
  // that is in active use. Resolve the FK dependencies first.
  pgm.sql(`
    DELETE FROM roles
    WHERE name IN (
      'Owner', 'Domain Admin', 'Operator', 'Viewer',
      'External Advisor', 'Auditor', 'Emergency Designate', 'System'
    );
  `);
}
