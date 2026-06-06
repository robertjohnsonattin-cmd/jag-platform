import type { MigrationBuilder } from 'node-pg-migrate';

// Phase 1B — jag_core tenant seed.
//
// Inserts the initial set of JAG Holdings business entities into jag_core.tenants.
// Deterministic UUIDs allow cross-migration and test-fixture references.
//
// Tenant codes exactly match the module identifiers used in every other JAG subsystem.
// ON CONFLICT (code) DO NOTHING — idempotent; safe to run multiple times.
//
// Parent relationship:
//   JAG Holdings is the parent of all operating entities.
//   Its own parent_tenant_id is NULL (it is the root).
//
// Phase 3 tenants (Brian's Portal, etc.) are seeded in their own migration.

// Deterministic tenant UUIDs — treat these as platform constants.
// Never reassign; reference directly in fixtures and migration scripts.
//
//   TENANT_JAG_HOLDINGS    = '00000000-0000-0000-0001-000000000001'
//   TENANT_JABCO           = '00000000-0000-0000-0001-000000000002'
//   TENANT_JAG_PROPERTIES  = '00000000-0000-0000-0001-000000000003'
//   TENANT_JAG_ENTERTAIN   = '00000000-0000-0000-0001-000000000004'
//   TENANT_JAG_FINANCE     = '00000000-0000-0000-0001-000000000005'
//   TENANT_DRAGONBRIDGE    = '00000000-0000-0000-0001-000000000006'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    -- Root tenant first (no parent)
    INSERT INTO tenants (id, code, name, parent_tenant_id) VALUES
      (
        '00000000-0000-0000-0001-000000000001',
        'JAG_HOLDINGS',
        'JAG Holdings',
        NULL
      )
    ON CONFLICT (code) DO NOTHING;

    -- Operating entities (parent = JAG Holdings)
    INSERT INTO tenants (id, code, name, parent_tenant_id) VALUES
      (
        '00000000-0000-0000-0001-000000000002',
        'JABCO',
        'JABCO Limited',
        '00000000-0000-0000-0001-000000000001'
      ),
      (
        '00000000-0000-0000-0001-000000000003',
        'JAG_PROPERTIES',
        'JAG Properties',
        '00000000-0000-0000-0001-000000000001'
      ),
      (
        '00000000-0000-0000-0001-000000000004',
        'JAG_ENTERTAINMENT',
        'JAG Entertainment',
        '00000000-0000-0000-0001-000000000001'
      ),
      (
        '00000000-0000-0000-0001-000000000005',
        'JAG_FINANCE',
        'JAG Finance',
        '00000000-0000-0000-0001-000000000001'
      ),
      (
        '00000000-0000-0000-0001-000000000006',
        'DRAGONBRIDGE',
        'DragonBridge',
        '00000000-0000-0000-0001-000000000001'
      )
    ON CONFLICT (code) DO NOTHING;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Will fail with FK violation if any user_tenant_roles reference these tenants.
  // Resolve dependencies before rolling back.
  pgm.sql(`
    DELETE FROM tenants
    WHERE code IN (
      'JAG_HOLDINGS', 'JABCO', 'JAG_PROPERTIES',
      'JAG_ENTERTAINMENT', 'JAG_FINANCE', 'DRAGONBRIDGE'
    );
  `);
}
