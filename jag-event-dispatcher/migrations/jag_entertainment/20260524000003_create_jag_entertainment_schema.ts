import type { MigrationBuilder } from 'node-pg-migrate';

// Phase 1A — jag_entertainment business schema.
// Creates all JAG Entertainment Ops tables (BAR + Members Club) in dependency order.
// RLS applied immediately after each table — no table exists without its policy (STD-02).
//
// CRITICAL: entity_tag (BAR | MEMBERS_CLUB) is MANDATORY on every transaction row.
// This is the sole P&L separation mechanism between the two entities — no exceptions.
//
// RLS session variable: app.current_tenant_id (SET LOCAL by jag-api middleware).
// Fail-closed: nullif(current_setting(..., true), '') converts missing setting to NULL.

export async function up(pgm: MigrationBuilder): Promise<void> {

  // ── Enums ────────────────────────────────────────────────────────────────────

  pgm.createType('entity_tag', ['BAR', 'MEMBERS_CLUB']);
  pgm.createType('session_status', ['OPEN', 'CLOSED']);
  pgm.createType('transaction_type', ['SALE', 'REFUND', 'VOID', 'COMP']);
  pgm.createType('payment_method', ['CASH', 'CARD', 'TAB', 'COMP', 'MEMBER_ACCOUNT']);
  pgm.createType('membership_type', ['FULL', 'ASSOCIATE', 'HONORARY']);
  pgm.createType('membership_status', ['ACTIVE', 'SUSPENDED', 'LAPSED', 'RESIGNED']);
  pgm.createType('license_status', ['CURRENT', 'EXPIRING_SOON', 'EXPIRED']);


  // ── ent_members_registry ─────────────────────────────────────────────────────
  // Created before ent_bar_transactions (transactions carry optional FK to this table).

  pgm.createTable('ent_members_registry', {
    id:              { type: 'uuid',              primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:       { type: 'uuid',              notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    member_number:   { type: 'varchar',           notNull: true,  unique: true },
    first_name:      { type: 'varchar',           notNull: true },
    last_name:       { type: 'varchar',           notNull: true },
    phone:           { type: 'varchar',           notNull: false },
    email:           { type: 'varchar',           notNull: false },
    date_of_birth:   { type: 'date',              notNull: false },
    membership_type: { type: 'membership_type',   notNull: true,  default: 'FULL' },
    status:          { type: 'membership_status', notNull: true,  default: 'ACTIVE' },
    joined_date:     { type: 'date',              notNull: true },
    expiry_date:     { type: 'date',              notNull: false },
    photo_path:      { type: 'varchar',           notNull: false, comment: 'MinIO path for member photo/ID' },
    notes:           { type: 'text',              notNull: false },
    last_modified_at:{ type: 'timestamptz',       notNull: true,  default: pgm.func('now()') },
    created_at:      { type: 'timestamptz',       notNull: true,  default: pgm.func('now()') },
    updated_at:      { type: 'timestamptz',       notNull: true,  default: pgm.func('now()') },
  });

  pgm.createIndex('ent_members_registry', 'tenant_id',     { name: 'idx_members_tenant' });
  pgm.createIndex('ent_members_registry', 'member_number', { name: 'idx_members_number', unique: true });
  pgm.createIndex('ent_members_registry', 'status',        { name: 'idx_members_status' });
  pgm.createIndex('ent_members_registry', 'expiry_date',   { name: 'idx_members_expiry' });

  pgm.sql(`
    COMMENT ON TABLE ent_members_registry IS
    'RLS: tenant_id. Members Club only. member_number is the physical card/key number.';

    ALTER TABLE ent_members_registry ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ent_members_registry FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON ent_members_registry
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── ent_bar_sessions ─────────────────────────────────────────────────────────

  pgm.createTable('ent_bar_sessions', {
    id:                   { type: 'uuid',           primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:            { type: 'uuid',           notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    entity_tag:           { type: 'entity_tag',     notNull: true,  comment: 'BAR or MEMBERS_CLUB — determines which P&L this session contributes to' },
    session_date:         { type: 'date',           notNull: true },
    opened_by:            { type: 'uuid',           notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    closed_by:            { type: 'uuid',           notNull: false, comment: 'cross-db ref: jag_core.users.id' },
    opening_float:        { type: 'numeric',        notNull: true },
    closing_cash_counted: { type: 'numeric',        notNull: false, comment: 'Null until session is closed' },
    status:               { type: 'session_status', notNull: true,  default: 'OPEN' },
    notes:                { type: 'text',           notNull: false },
    idempotency_key:      { type: 'uuid',           notNull: true,  unique: true },
    last_modified_at:     { type: 'timestamptz',    notNull: true,  default: pgm.func('now()') },
    created_at:           { type: 'timestamptz',    notNull: true,  default: pgm.func('now()') },
    updated_at:           { type: 'timestamptz',    notNull: true,  default: pgm.func('now()') },
  });

  pgm.createIndex('ent_bar_sessions', 'tenant_id',        { name: 'idx_sessions_tenant' });
  pgm.createIndex('ent_bar_sessions', 'entity_tag',       { name: 'idx_sessions_entity_tag' });
  pgm.createIndex('ent_bar_sessions', 'session_date',     { name: 'idx_sessions_date' });
  pgm.createIndex('ent_bar_sessions', 'status',           { name: 'idx_sessions_status' });
  pgm.createIndex('ent_bar_sessions', 'idempotency_key',  { name: 'idx_sessions_idempotency', unique: true });
  pgm.createIndex('ent_bar_sessions', 'last_modified_at', { name: 'idx_sessions_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE ent_bar_sessions IS
    'RLS: tenant_id. OFFLINE-CRITICAL: cash logging must work without connectivity. idempotency_key prevents duplicate session open on reconnect.';

    ALTER TABLE ent_bar_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ent_bar_sessions FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON ent_bar_sessions
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── ent_bar_transactions ─────────────────────────────────────────────────────
  // entity_tag is MANDATORY — the sole mechanism producing separate BAR/MEMBERS_CLUB P&Ls.

  pgm.createTable('ent_bar_transactions', {
    id:               { type: 'uuid',             primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:        { type: 'uuid',             notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    session_id:       { type: 'uuid',             notNull: true },
    entity_tag:       { type: 'entity_tag',       notNull: true,  comment: 'MANDATORY — separates BAR vs MEMBERS_CLUB P&L. Must match parent session entity_tag.' },
    transaction_type: { type: 'transaction_type', notNull: true },
    payment_method:   { type: 'payment_method',   notNull: true },
    amount:           { type: 'numeric',          notNull: true },
    currency:         { type: 'varchar(3)',        notNull: true,  default: 'TTD' },
    items:            { type: 'jsonb',            notNull: true,  comment: 'Snapshot: [{name, qty, unit_price, subtotal}]' },
    served_by:        { type: 'uuid',             notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    member_id:        { type: 'uuid',             notNull: false, comment: 'Null for non-member bar customers' },
    notes:            { type: 'text',             notNull: false },
    idempotency_key:  { type: 'uuid',             notNull: true,  unique: true },
    last_modified_at: { type: 'timestamptz',      notNull: true,  default: pgm.func('now()') },
    created_at:       { type: 'timestamptz',      notNull: true,  default: pgm.func('now()') },
    updated_at:       { type: 'timestamptz',      notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('ent_bar_transactions', 'ent_bar_transactions_session_id_fkey', {
    foreignKeys: { columns: 'session_id', references: 'ent_bar_sessions(id)' },
  });
  pgm.addConstraint('ent_bar_transactions', 'ent_bar_transactions_member_id_fkey', {
    foreignKeys: { columns: 'member_id', references: 'ent_members_registry(id)' },
  });

  pgm.createIndex('ent_bar_transactions', 'tenant_id',        { name: 'idx_bar_tx_tenant' });
  pgm.createIndex('ent_bar_transactions', 'session_id',       { name: 'idx_bar_tx_session' });
  pgm.createIndex('ent_bar_transactions', 'entity_tag',       { name: 'idx_bar_tx_entity_tag' });
  pgm.createIndex('ent_bar_transactions', 'transaction_type', { name: 'idx_bar_tx_type' });
  pgm.createIndex('ent_bar_transactions', 'member_id',        { name: 'idx_bar_tx_member' });
  pgm.createIndex('ent_bar_transactions', 'idempotency_key',  { name: 'idx_bar_tx_idempotency', unique: true });
  pgm.createIndex('ent_bar_transactions', 'last_modified_at', { name: 'idx_bar_tx_last_modified' });
  pgm.createIndex('ent_bar_transactions', 'created_at',       { name: 'idx_bar_tx_created_at' });

  pgm.sql(`
    COMMENT ON TABLE ent_bar_transactions IS
    'RLS: tenant_id. entity_tag is MANDATORY on every row — produces separate BAR and MEMBERS_CLUB P&Ls in JAG Finance. idempotency_key (STD-11) prevents double-posting on offline reconnect.';

    ALTER TABLE ent_bar_transactions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ent_bar_transactions FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON ent_bar_transactions
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── ent_member_visits ────────────────────────────────────────────────────────

  pgm.createTable('ent_member_visits', {
    id:             { type: 'uuid',        primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:      { type: 'uuid',        notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    entity_tag:     { type: 'entity_tag',  notNull: true,  comment: 'MEMBERS_CLUB for formal visitor log; BAR for walk-in tracking if required' },
    member_id:      { type: 'uuid',        notNull: false, comment: 'Null for non-member guests' },
    guest_name:     { type: 'varchar',     notNull: false, comment: 'Required when member_id is null' },
    signed_in_by:   { type: 'uuid',        notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    visit_date:     { type: 'date',        notNull: true },
    check_in_time:  { type: 'timestamptz', notNull: true },
    check_out_time: { type: 'timestamptz', notNull: false },
    notes:          { type: 'text',        notNull: false },
    created_at:     { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at:     { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('ent_member_visits', 'ent_member_visits_member_id_fkey', {
    foreignKeys: { columns: 'member_id', references: 'ent_members_registry(id)' },
  });

  pgm.createIndex('ent_member_visits', 'tenant_id',  { name: 'idx_visits_tenant' });
  pgm.createIndex('ent_member_visits', 'entity_tag', { name: 'idx_visits_entity_tag' });
  pgm.createIndex('ent_member_visits', 'member_id',  { name: 'idx_visits_member' });
  pgm.createIndex('ent_member_visits', 'visit_date', { name: 'idx_visits_date' });

  pgm.sql(`
    COMMENT ON TABLE ent_member_visits IS
    'RLS: tenant_id. Visitor log is a compliance requirement for the Members Club annual license. Standard audit trail — no AML, no Gaming Commission format.';

    ALTER TABLE ent_member_visits ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ent_member_visits FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON ent_member_visits
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── ent_chip_float_sessions ──────────────────────────────────────────────────

  pgm.createTable('ent_chip_float_sessions', {
    id:                  { type: 'uuid',           primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:           { type: 'uuid',           notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    entity_tag:          { type: 'entity_tag',     notNull: true,  comment: 'Always MEMBERS_CLUB' },
    session_date:        { type: 'date',           notNull: true },
    opened_by:           { type: 'uuid',           notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    closed_by:           { type: 'uuid',           notNull: false, comment: 'cross-db ref: jag_core.users.id' },
    opening_chip_count:  { type: 'jsonb',          notNull: true,  comment: 'Denomination breakdown: [{denomination, count, subtotal}]' },
    opening_chip_value:  { type: 'numeric',        notNull: true },
    closing_chip_count:  { type: 'jsonb',          notNull: false, comment: 'Null until session is closed' },
    closing_chip_value:  { type: 'numeric',        notNull: false },
    variance:            { type: 'numeric',        notNull: false, comment: 'closing_chip_value - opening_chip_value, computed on close' },
    status:              { type: 'session_status', notNull: true,  default: 'OPEN' },
    idempotency_key:     { type: 'uuid',           notNull: true,  unique: true },
    last_modified_at:    { type: 'timestamptz',    notNull: true,  default: pgm.func('now()') },
    created_at:          { type: 'timestamptz',    notNull: true,  default: pgm.func('now()') },
    updated_at:          { type: 'timestamptz',    notNull: true,  default: pgm.func('now()') },
  });

  pgm.createIndex('ent_chip_float_sessions', 'tenant_id',        { name: 'idx_chip_tenant' });
  pgm.createIndex('ent_chip_float_sessions', 'entity_tag',       { name: 'idx_chip_entity_tag' });
  pgm.createIndex('ent_chip_float_sessions', 'session_date',     { name: 'idx_chip_date' });
  pgm.createIndex('ent_chip_float_sessions', 'status',           { name: 'idx_chip_status' });
  pgm.createIndex('ent_chip_float_sessions', 'idempotency_key',  { name: 'idx_chip_idempotency', unique: true });
  pgm.createIndex('ent_chip_float_sessions', 'last_modified_at', { name: 'idx_chip_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE ent_chip_float_sessions IS
    'RLS: tenant_id. Chip float tracking is a compliance requirement. Members Club is NOT a regulated casino — no AML, no Gaming Commission export, no hash-chain.';

    ALTER TABLE ent_chip_float_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ent_chip_float_sessions FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON ent_chip_float_sessions
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── ent_cash_reconciliation ──────────────────────────────────────────────────

  pgm.createTable('ent_cash_reconciliation', {
    id:                  { type: 'uuid',       primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:           { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    entity_tag:          { type: 'entity_tag', notNull: true,  comment: 'BAR or MEMBERS_CLUB — determines which P&L receives this reconciliation' },
    session_id:          { type: 'uuid',       notNull: true },
    reconciliation_date: { type: 'date',       notNull: true },
    expected_cash:       { type: 'numeric',    notNull: true,  comment: 'System-calculated from transactions in this session' },
    actual_cash_counted: { type: 'numeric',    notNull: true },
    variance:            { type: 'numeric',    notNull: true,  comment: 'actual_cash_counted - expected_cash' },
    reconciled_by:       { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    approved_by:         { type: 'uuid',       notNull: false, comment: 'cross-db ref: jag_core.users.id — second sign-off' },
    notes:               { type: 'text',       notNull: false },
    idempotency_key:     { type: 'uuid',       notNull: true,  unique: true },
    last_modified_at:    { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    created_at:          { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    updated_at:          { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('ent_cash_reconciliation', 'ent_cash_reconciliation_session_id_fkey', {
    foreignKeys: { columns: 'session_id', references: 'ent_bar_sessions(id)' },
  });

  pgm.createIndex('ent_cash_reconciliation', 'tenant_id',           { name: 'idx_cash_recon_tenant' });
  pgm.createIndex('ent_cash_reconciliation', 'entity_tag',          { name: 'idx_cash_recon_entity_tag' });
  pgm.createIndex('ent_cash_reconciliation', 'session_id',          { name: 'idx_cash_recon_session' });
  pgm.createIndex('ent_cash_reconciliation', 'reconciliation_date', { name: 'idx_cash_recon_date' });
  pgm.createIndex('ent_cash_reconciliation', 'idempotency_key',     { name: 'idx_cash_recon_idempotency', unique: true });

  pgm.sql(`
    COMMENT ON TABLE ent_cash_reconciliation IS
    'RLS: tenant_id. Financial write — idempotency_key required (STD-11). Variance reported to JAG Finance via pending_events outbox.';

    ALTER TABLE ent_cash_reconciliation ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ent_cash_reconciliation FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON ent_cash_reconciliation
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── ent_license_renewals ─────────────────────────────────────────────────────

  pgm.createTable('ent_license_renewals', {
    id:                        { type: 'uuid',           primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:                 { type: 'uuid',           notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    entity_tag:                { type: 'entity_tag',     notNull: true,  comment: 'BAR or MEMBERS_CLUB — each entity has its own license' },
    license_type:              { type: 'varchar',        notNull: true,  comment: 'e.g. FOOD_BEVERAGE, PRIVATE_CLUB, MUSIC, DANCE' },
    license_number:            { type: 'varchar',        notNull: false },
    issuing_authority:         { type: 'varchar',        notNull: false, comment: 'e.g. Licensing Board, Ministry of Trade' },
    issue_date:                { type: 'date',           notNull: true },
    expiry_date:               { type: 'date',           notNull: true },
    renewal_alert_days_before: { type: 'integer',        notNull: true,  default: 90, comment: 'Tier 1 alert fires when expiry_date - today <= this value' },
    status:                    { type: 'license_status', notNull: true,  default: 'CURRENT' },
    document_path:             { type: 'varchar',        notNull: false, comment: 'MinIO path for license document' },
    notes:                     { type: 'text',           notNull: false },
    created_at:                { type: 'timestamptz',    notNull: true,  default: pgm.func('now()') },
    updated_at:                { type: 'timestamptz',    notNull: true,  default: pgm.func('now()') },
  });

  pgm.createIndex('ent_license_renewals', 'tenant_id',   { name: 'idx_license_tenant' });
  pgm.createIndex('ent_license_renewals', 'entity_tag',  { name: 'idx_license_entity_tag' });
  pgm.createIndex('ent_license_renewals', 'expiry_date', { name: 'idx_license_expiry' });
  pgm.createIndex('ent_license_renewals', 'status',      { name: 'idx_license_status' });

  pgm.sql(`
    COMMENT ON TABLE ent_license_renewals IS
    'RLS: tenant_id. Annual license renewal alerts fire at renewal_alert_days_before days before expiry_date as Tier 1 notifications. Both BAR and MEMBERS_CLUB have independent licenses.';

    ALTER TABLE ent_license_renewals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ent_license_renewals FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON ent_license_renewals
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);
}


export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('ent_license_renewals');
  pgm.dropTable('ent_cash_reconciliation');
  pgm.dropTable('ent_chip_float_sessions');
  pgm.dropTable('ent_member_visits');
  pgm.dropTable('ent_bar_transactions');
  pgm.dropTable('ent_bar_sessions');
  pgm.dropTable('ent_members_registry');

  pgm.dropType('license_status');
  pgm.dropType('membership_status');
  pgm.dropType('membership_type');
  pgm.dropType('payment_method');
  pgm.dropType('transaction_type');
  pgm.dropType('session_status');
  pgm.dropType('entity_tag');
}
