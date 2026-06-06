import type { MigrationBuilder } from 'node-pg-migrate';

// Phase 1A — jag_core business schema.
// Creates all platform-hub tables (tenants, users, roles, etc.) in dependency order.
// RLS is applied immediately after each qualifying table — no table should exist without
// its policy (STD-02).  Tables with 'No RLS' notes in the DBML are intentionally excluded.
//
// RLS session variables set by API middleware (src/middleware/rls.ts) at request start:
//   app.current_tenant_id  — for tenant-scoped tables
//   app.current_user_id    — for user-scoped tables (notification_queue)
//   app.bypass_rls         — 'true' for Owner role (audit_log bypass)
//
// nullif(current_setting(..., true), '') converts a missing setting to NULL,
// making the USING clause fail-closed rather than fail-open.

export async function up(pgm: MigrationBuilder): Promise<void> {

  // ── Enums ───────────────────────────────────────────────────────────────────

  pgm.createType('notification_channel', ['IN_APP', 'WHATSAPP', 'EMAIL']);
  pgm.createType('audit_source', ['API', 'SYSTEM', 'MIGRATION', 'MANUAL']);


  // ── tenants ─────────────────────────────────────────────────────────────────
  // No RLS: read by all authenticated sessions for lookups.

  pgm.createTable('tenants', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    code: {
      type: 'varchar',
      notNull: true,
      unique: true,
      comment: 'e.g. JABCO, JAG_PROPERTIES, JAG_ENTERTAINMENT, JAG_HOLDINGS',
    },
    name: { type: 'varchar', notNull: true },
    parent_tenant_id: {
      type: 'uuid',
      notNull: false,
      comment: 'JAG Holdings is parent of all operating entities',
    },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('tenants', 'tenants_parent_tenant_id_fkey', {
    foreignKeys: { columns: 'parent_tenant_id', references: 'tenants(id)' },
  });

  pgm.createIndex('tenants', 'code', { name: 'idx_tenants_code', unique: true });
  pgm.createIndex('tenants', 'parent_tenant_id', { name: 'idx_tenants_parent' });

  pgm.sql(`COMMENT ON TABLE tenants IS 'No RLS — tenants table is read by all authenticated sessions for lookups.'`);


  // ── users ───────────────────────────────────────────────────────────────────
  // No RLS: user records are referenced across all modules.

  pgm.createTable('users', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    keycloak_id: {
      type: 'uuid',
      notNull: true,
      unique: true,
      comment: 'Keycloak sub claim — the authoritative identity identifier',
    },
    email: { type: 'varchar', notNull: true, unique: true },
    display_name: { type: 'varchar', notNull: true },
    preferred_language: {
      type: 'varchar(5)',
      notNull: true,
      default: 'en',
      comment: 'en | zh | es. Wife defaults to zh.',
    },
    is_active: { type: 'boolean', notNull: true, default: true },
    last_login_at: { type: 'timestamptz', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('users', 'keycloak_id', { name: 'idx_users_keycloak_id', unique: true });
  pgm.createIndex('users', 'email', { name: 'idx_users_email' });

  pgm.sql(`COMMENT ON TABLE users IS 'No RLS — user records are referenced across all modules. Keycloak manages auth.'`);


  // ── roles ───────────────────────────────────────────────────────────────────
  // No RLS: role definitions are platform-wide constants.

  pgm.createTable('roles', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: {
      type: 'varchar',
      notNull: true,
      unique: true,
      comment: 'Owner | Domain Admin | Operator | Viewer | External Advisor | Auditor | Emergency Designate | System',
    },
    description: { type: 'text', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`COMMENT ON TABLE roles IS 'Seeded at Phase 1A. Changes require written change request (STD-12).'`);


  // ── i18n_translations ────────────────────────────────────────────────────────
  // No RLS: translations are platform-wide read.

  pgm.createTable('i18n_translations', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    key: {
      type: 'varchar',
      notNull: true,
      comment: 'Pattern: module.semantic_id e.g. finance.bir_threshold_alert',
    },
    locale: { type: 'varchar(5)', notNull: true, comment: 'en | zh | es' },
    value: { type: 'text', notNull: true },
    module: {
      type: 'varchar',
      notNull: false,
      comment: 'e.g. IMS, JABCO, BAR, FINANCE, PROPERTIES',
    },
    is_machine_translated: {
      type: 'boolean',
      notNull: true,
      default: false,
      comment: 'Financial, legal, compliance, and alert strings must be manual.',
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('i18n_translations', 'i18n_translations_key_locale_key', {
    unique: ['key', 'locale'],
  });

  pgm.createIndex('i18n_translations', ['key', 'locale'], {
    name: 'idx_i18n_key_locale',
    unique: true,
  });
  pgm.createIndex('i18n_translations', 'locale', { name: 'idx_i18n_locale' });
  pgm.createIndex('i18n_translations', 'module', { name: 'idx_i18n_module' });

  pgm.sql(`COMMENT ON TABLE i18n_translations IS 'No RLS — platform-wide read. Three locales: en (all), zh (Phase 1), es (Phase 3/6).'`);


  // ── user_tenant_roles ────────────────────────────────────────────────────────
  // RLS: tenant_id

  pgm.createTable('user_tenant_roles', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: { type: 'uuid', notNull: true },
    tenant_id: { type: 'uuid', notNull: true },
    role_id: { type: 'uuid', notNull: true },
    granted_by: { type: 'uuid', notNull: true },
    expires_at: {
      type: 'timestamptz',
      notNull: false,
      comment: 'Non-null for External Advisor — auto-revoked by scheduled job',
    },
    is_active: { type: 'boolean', notNull: true, default: true },
    revoked_at: { type: 'timestamptz', notNull: false },
    revoked_by: { type: 'uuid', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('user_tenant_roles', 'utr_user_id_fkey', {
    foreignKeys: { columns: 'user_id', references: 'users(id)' },
  });
  pgm.addConstraint('user_tenant_roles', 'utr_tenant_id_fkey', {
    foreignKeys: { columns: 'tenant_id', references: 'tenants(id)' },
  });
  pgm.addConstraint('user_tenant_roles', 'utr_role_id_fkey', {
    foreignKeys: { columns: 'role_id', references: 'roles(id)' },
  });
  pgm.addConstraint('user_tenant_roles', 'utr_granted_by_fkey', {
    foreignKeys: { columns: 'granted_by', references: 'users(id)' },
  });
  pgm.addConstraint('user_tenant_roles', 'utr_revoked_by_fkey', {
    foreignKeys: { columns: 'revoked_by', references: 'users(id)' },
  });

  pgm.createIndex('user_tenant_roles', ['user_id', 'tenant_id'], { name: 'idx_utr_user_tenant' });
  pgm.createIndex('user_tenant_roles', 'expires_at', { name: 'idx_utr_expires_at' });
  pgm.createIndex('user_tenant_roles', 'tenant_id', { name: 'idx_utr_tenant_id' });

  pgm.sql(`
    COMMENT ON TABLE user_tenant_roles IS
    'RLS: tenant_id. Succession activation adds parallel Owner grant to wife — Robert''s Owner record is never modified (v1.9).';

    ALTER TABLE user_tenant_roles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_tenant_roles FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON user_tenant_roles
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── sessions ─────────────────────────────────────────────────────────────────
  // No RLS: Keycloak is primary auth; sessions table tracks active tokens only.
  // The jag_app role queries this only during token validation — no cross-user access risk.

  pgm.createTable('sessions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: { type: 'uuid', notNull: true },
    keycloak_session_id: { type: 'varchar', notNull: true, unique: true },
    ip_address: { type: 'varchar', notNull: false },
    user_agent: { type: 'text', notNull: false },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('sessions', 'sessions_user_id_fkey', {
    foreignKeys: { columns: 'user_id', references: 'users(id)' },
  });

  pgm.createIndex('sessions', 'user_id', { name: 'idx_sessions_user_id' });
  pgm.createIndex('sessions', 'keycloak_session_id', {
    name: 'idx_sessions_kc_session',
    unique: true,
  });
  pgm.createIndex('sessions', 'expires_at', { name: 'idx_sessions_expires_at' });


  // ── audit_log ────────────────────────────────────────────────────────────────
  // RLS: tenant_id, with two special cases:
  //   • tenant_id IS NULL = system-level event, visible to all authenticated sessions
  //   • app.bypass_rls = 'true' = Owner role, can see all tenants

  pgm.createTable('audit_log', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    tenant_id: {
      type: 'uuid',
      notNull: false,
      comment: 'Null for system-level platform events',
    },
    user_id: {
      type: 'uuid',
      notNull: false,
      comment: 'Null for automated system events',
    },
    entity: {
      type: 'varchar',
      notNull: true,
      comment: 'e.g. User, InventoryItem, RentPayment, BarTransaction',
    },
    action: {
      type: 'varchar',
      notNull: true,
      comment: 'e.g. CREATE, UPDATE, DELETE, LOGIN, EXPORT, APPROVE',
    },
    record_id: { type: 'uuid', notNull: false },
    old_values: { type: 'jsonb', notNull: false },
    new_values: { type: 'jsonb', notNull: false },
    ip_address: { type: 'varchar', notNull: false },
    source: { type: 'audit_source', notNull: true, default: 'API' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('audit_log', 'audit_log_tenant_id_fkey', {
    foreignKeys: { columns: 'tenant_id', references: 'tenants(id)' },
  });
  pgm.addConstraint('audit_log', 'audit_log_user_id_fkey', {
    foreignKeys: { columns: 'user_id', references: 'users(id)' },
  });

  pgm.createIndex('audit_log', 'tenant_id', { name: 'idx_audit_tenant_id' });
  pgm.createIndex('audit_log', 'user_id', { name: 'idx_audit_user_id' });
  pgm.createIndex('audit_log', ['entity', 'record_id'], { name: 'idx_audit_entity_record' });
  pgm.createIndex('audit_log', 'created_at', { name: 'idx_audit_created_at' });

  pgm.sql(`
    COMMENT ON TABLE audit_log IS
    'RLS: tenant_id. Owner bypasses via app.bypass_rls. Append-only — no UPDATE or DELETE from application role.';

    ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
    ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON audit_log
      USING (
        current_setting('app.bypass_rls', true) = 'true'
        OR tenant_id IS NULL
        OR tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
      );
  `);


  // ── notification_queue ───────────────────────────────────────────────────────
  // RLS: user_id — each user sees only their own notifications.
  // app.current_user_id is set to jag_core.users.id (not Keycloak sub).
  // Phase 1B: add jag_user_id custom Keycloak mapper so JWT carries users.id directly.

  pgm.createTable('notification_queue', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: { type: 'uuid', notNull: true },
    tenant_id: { type: 'uuid', notNull: false },
    tier: {
      type: 'integer',
      notNull: true,
      comment: '1=Immediate | 2=Daily 7am | 3=Weekly Monday',
    },
    channel: { type: 'notification_channel', notNull: true },
    title: { type: 'varchar', notNull: true },
    body: { type: 'text', notNull: true },
    payload: {
      type: 'jsonb',
      notNull: false,
      comment: 'Structured data for client deep-linking',
    },
    is_read: { type: 'boolean', notNull: true, default: false },
    is_sent: { type: 'boolean', notNull: true, default: false },
    sent_at: { type: 'timestamptz', notNull: false },
    scheduled_for: {
      type: 'timestamptz',
      notNull: false,
      comment: 'Null = send immediately. Dispatcher sets this for Tier 2/3.',
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('notification_queue', 'notification_queue_user_id_fkey', {
    foreignKeys: { columns: 'user_id', references: 'users(id)' },
  });
  pgm.addConstraint('notification_queue', 'notification_queue_tenant_id_fkey', {
    foreignKeys: { columns: 'tenant_id', references: 'tenants(id)' },
  });

  pgm.createIndex('notification_queue', 'user_id', { name: 'idx_notif_user_id' });
  pgm.createIndex('notification_queue', ['is_sent', 'scheduled_for'], {
    name: 'idx_notif_pending',
  });
  pgm.createIndex('notification_queue', 'tier', { name: 'idx_notif_tier' });
  pgm.createIndex('notification_queue', 'tenant_id', { name: 'idx_notif_tenant_id' });

  pgm.sql(`
    COMMENT ON TABLE notification_queue IS
    'RLS: user_id. Quiet hours 22:00-06:00 enforced by dispatcher. Tier 1 = in-app + WhatsApp link.';

    ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notification_queue FORCE ROW LEVEL SECURITY;

    CREATE POLICY user_isolation ON notification_queue
      USING (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
  `);


  // ── external_advisor_grants ───────────────────────────────────────────────────
  // RLS: tenant_id

  pgm.createTable('external_advisor_grants', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: { type: 'uuid', notNull: true },
    tenant_id: { type: 'uuid', notNull: true },
    granted_by: { type: 'uuid', notNull: true },
    scope: {
      type: 'jsonb',
      notNull: true,
      comment: 'Defines accessible modules and record IDs. e.g. {modules: ["DOCVAULT"], record_ids: [...]}',
    },
    expires_at: {
      type: 'timestamptz',
      notNull: true,
      comment: 'Mandatory — auto-revoked by scheduler. No perpetual external grants.',
    },
    is_active: { type: 'boolean', notNull: true, default: true },
    revoked_at: { type: 'timestamptz', notNull: false },
    revoked_by: { type: 'uuid', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('external_advisor_grants', 'eag_user_id_fkey', {
    foreignKeys: { columns: 'user_id', references: 'users(id)' },
  });
  pgm.addConstraint('external_advisor_grants', 'eag_tenant_id_fkey', {
    foreignKeys: { columns: 'tenant_id', references: 'tenants(id)' },
  });
  pgm.addConstraint('external_advisor_grants', 'eag_granted_by_fkey', {
    foreignKeys: { columns: 'granted_by', references: 'users(id)' },
  });
  pgm.addConstraint('external_advisor_grants', 'eag_revoked_by_fkey', {
    foreignKeys: { columns: 'revoked_by', references: 'users(id)' },
  });

  pgm.createIndex('external_advisor_grants', 'user_id', { name: 'idx_eag_user_id' });
  pgm.createIndex('external_advisor_grants', 'tenant_id', { name: 'idx_eag_tenant_id' });
  pgm.createIndex('external_advisor_grants', 'expires_at', { name: 'idx_eag_expires_at' });

  pgm.sql(`
    COMMENT ON TABLE external_advisor_grants IS
    'RLS: tenant_id. Time-limited scoped read access for lawyers (estate review) and potential buyers (Data Room).';

    ALTER TABLE external_advisor_grants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE external_advisor_grants FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON external_advisor_grants
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);
}


export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('external_advisor_grants');
  pgm.dropTable('notification_queue');
  pgm.dropTable('audit_log');
  pgm.dropTable('sessions');
  pgm.dropTable('user_tenant_roles');
  pgm.dropTable('i18n_translations');
  pgm.dropTable('roles');
  pgm.dropTable('users');
  pgm.dropTable('tenants');

  pgm.dropType('audit_source');
  pgm.dropType('notification_channel');
}
