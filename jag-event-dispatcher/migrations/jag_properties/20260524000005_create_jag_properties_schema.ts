import type { MigrationBuilder } from 'node-pg-migrate';

// Phase 1A — jag_properties business schema.
// Creates all property management tables in dependency order.
// RLS applied immediately after each table — no table exists without its policy (STD-02).
//
// Note: prop_pending_review_queue and pending_review_status already exist (migrations 000002/000004).
// This migration creates only the business portfolio tables.
//
// RLS: owner_id on all tables (personal portfolio, not multi-tenant).
// Session variable: app.current_owner_id (SET LOCAL by jag-api withOwnerRLS middleware).
// Fail-closed: nullif(current_setting(..., true), '') converts missing setting to NULL.
//
// OPSEC: prop_mortgage_register.account_reference stores PARTIAL reference only
// (e.g. last 4 digits). Full account numbers are NEVER stored in this system.

export async function up(pgm: MigrationBuilder): Promise<void> {

  // ── Enums ────────────────────────────────────────────────────────────────────
  // pending_review_status already created in migration 000002 — not repeated here.

  pgm.createType('property_type', ['RESIDENTIAL', 'COMMERCIAL', 'LAND', 'MIXED', 'AGRICULTURAL']);
  pgm.createType('tenure_type', ['FREEHOLD', 'LEASEHOLD', 'STATE_LAND']);
  pgm.createType('property_tenant_id_type', ['TT_NIC', 'PASSPORT', 'COMPANY_REG', 'DRIVERS_LICENCE', 'OTHER']);
  pgm.createType('lease_type', ['MONTH_TO_MONTH', 'FIXED_TERM']);
  pgm.createType('lease_status', ['ACTIVE', 'EXPIRED', 'TERMINATED', 'NOTICE_GIVEN', 'PENDING_START']);
  pgm.createType('prop_payment_method', ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'WIPAY', 'OTHER']);
  pgm.createType('maintenance_category', [
    'PLUMBING', 'ELECTRICAL', 'STRUCTURAL', 'HVAC', 'APPLIANCE',
    'PEST_CONTROL', 'SECURITY', 'GARDEN', 'PAINTING', 'ROOFING', 'OTHER',
  ]);
  pgm.createType('maintenance_priority', ['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
  pgm.createType('maintenance_status', [
    'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_PARTS',
    'COMPLETED', 'CLOSED', 'CANNOT_REPRODUCE',
  ]);
  pgm.createType('prop_pipeline_stage', ['WATCH', 'INTERESTED', 'OFFER_MADE', 'DUE_DILIGENCE', 'CONTRACT', 'ACQUIRED', 'PASSED']);
  pgm.createType('pipeline_source', ['AGENT', 'PRIVATE_SELLER', 'AUCTION', 'ONLINE_LISTING', 'REFERRAL', 'OTHER']);
  pgm.createType('mortgage_type', ['FIXED_RATE', 'VARIABLE_RATE', 'INTEREST_ONLY']);
  pgm.createType('mortgage_status', ['ACTIVE', 'PAID_OFF', 'IN_ARREARS', 'REFINANCED', 'DISCHARGED']);


  // ── prop_properties ──────────────────────────────────────────────────────────

  pgm.createTable('prop_properties', {
    id:                { type: 'uuid',          primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id:          { type: 'uuid',          notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    property_code:     { type: 'varchar',       notNull: true,  unique: true, comment: 'e.g. PROP-BARATARIA-01, PROP-FYZABAD-01' },
    name:              { type: 'varchar',       notNull: true,  comment: 'e.g. Barataria House 1, Fyzabad Land Parcel' },
    address_line1:     { type: 'varchar',       notNull: true },
    address_line2:     { type: 'varchar',       notNull: false },
    city:              { type: 'varchar',       notNull: true },
    region:            { type: 'varchar',       notNull: false },
    country:           { type: 'varchar',       notNull: true,  default: 'TT' },
    property_type:     { type: 'property_type', notNull: true },
    tenure_type:       { type: 'tenure_type',   notNull: true,  default: 'FREEHOLD' },
    lot_number:        { type: 'varchar',       notNull: false, comment: 'Land registry lot/parcel number' },
    lot_size_sqm:      { type: 'numeric',       notNull: false },
    floor_area_sqm:    { type: 'numeric',       notNull: false },
    bedrooms:          { type: 'integer',       notNull: false },
    bathrooms:         { type: 'integer',       notNull: false },
    purchase_date:     { type: 'date',          notNull: false },
    purchase_price:    { type: 'numeric',       notNull: false },
    current_valuation: { type: 'numeric',       notNull: false },
    valuation_date:    { type: 'date',          notNull: false },
    is_rented:         { type: 'boolean',       notNull: true,  default: false },
    is_active:         { type: 'boolean',       notNull: true,  default: true },
    photos:            { type: 'jsonb',         notNull: false, comment: 'Array of MinIO storage paths' },
    notes:             { type: 'text',          notNull: false },
    last_modified_at:  { type: 'timestamptz',   notNull: true,  default: pgm.func('now()') },
    created_at:        { type: 'timestamptz',   notNull: true,  default: pgm.func('now()') },
    updated_at:        { type: 'timestamptz',   notNull: true,  default: pgm.func('now()') },
  });

  pgm.createIndex('prop_properties', 'owner_id',         { name: 'idx_prop_owner' });
  pgm.createIndex('prop_properties', 'property_code',    { name: 'idx_prop_code', unique: true });
  pgm.createIndex('prop_properties', 'property_type',    { name: 'idx_prop_type' });
  pgm.createIndex('prop_properties', 'is_rented',        { name: 'idx_prop_is_rented' });
  pgm.createIndex('prop_properties', 'last_modified_at', { name: 'idx_prop_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE prop_properties IS
    'RLS: owner_id. purchase_price and valuation are personal financial data — no cross-module write permitted (STD-01).';

    ALTER TABLE prop_properties ENABLE ROW LEVEL SECURITY;
    ALTER TABLE prop_properties FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON prop_properties
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);


  // ── prop_property_tenants ────────────────────────────────────────────────────
  // "Property tenants" = rental tenants (people/companies who pay rent).
  // Not to be confused with jag_core.tenants (JAG business entities).

  pgm.createTable('prop_property_tenants', {
    id:                      { type: 'uuid',                    primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id:                { type: 'uuid',                    notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    first_name:              { type: 'varchar',                 notNull: true },
    last_name:               { type: 'varchar',                 notNull: false, comment: 'Null for company tenants' },
    company_name:            { type: 'varchar',                 notNull: false },
    is_company:              { type: 'boolean',                 notNull: true,  default: false },
    phone:                   { type: 'varchar',                 notNull: false },
    email:                   { type: 'varchar',                 notNull: false },
    identification_type:     { type: 'property_tenant_id_type', notNull: false },
    identification_number:   { type: 'varchar',                 notNull: false, comment: 'For reference only — not for identity verification' },
    emergency_contact_name:  { type: 'varchar',                 notNull: false },
    emergency_contact_phone: { type: 'varchar',                 notNull: false },
    notes:                   { type: 'text',                    notNull: false },
    last_modified_at:        { type: 'timestamptz',             notNull: true,  default: pgm.func('now()') },
    created_at:              { type: 'timestamptz',             notNull: true,  default: pgm.func('now()') },
    updated_at:              { type: 'timestamptz',             notNull: true,  default: pgm.func('now()') },
  });

  pgm.createIndex('prop_property_tenants', 'owner_id', { name: 'idx_prop_tenants_owner' });
  pgm.createIndex('prop_property_tenants', 'email',    { name: 'idx_prop_tenants_email' });

  pgm.sql(`
    COMMENT ON TABLE prop_property_tenants IS
    'RLS: owner_id. Rental tenants (people/companies who pay rent). Not to be confused with jag_core.tenants (JAG business entities).';

    ALTER TABLE prop_property_tenants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE prop_property_tenants FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON prop_property_tenants
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);


  // ── prop_lease_agreements ────────────────────────────────────────────────────

  pgm.createTable('prop_lease_agreements', {
    id:                { type: 'uuid',         primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id:          { type: 'uuid',         notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    property_id:       { type: 'uuid',         notNull: true },
    tenant_id:         { type: 'uuid',         notNull: true },
    lease_type:        { type: 'lease_type',   notNull: true },
    start_date:        { type: 'date',         notNull: true },
    end_date:          { type: 'date',         notNull: false, comment: 'Null for month-to-month leases' },
    monthly_rent:      { type: 'numeric',      notNull: true },
    currency:          { type: 'varchar(3)',    notNull: true,  default: 'TTD' },
    security_deposit:  { type: 'numeric',      notNull: true,  default: 0 },
    payment_due_day:   { type: 'integer',      notNull: true,  default: 1, comment: 'Day of month rent is due (1-28)' },
    status:            { type: 'lease_status', notNull: true,  default: 'ACTIVE' },
    termination_date:  { type: 'date',         notNull: false },
    notice_given_date: { type: 'date',         notNull: false },
    document_path:     { type: 'varchar',      notNull: false, comment: 'MinIO path for signed lease document' },
    notes:             { type: 'text',         notNull: false },
    idempotency_key:   { type: 'uuid',         notNull: true,  unique: true },
    last_modified_at:  { type: 'timestamptz',  notNull: true,  default: pgm.func('now()') },
    created_at:        { type: 'timestamptz',  notNull: true,  default: pgm.func('now()') },
    updated_at:        { type: 'timestamptz',  notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('prop_lease_agreements', 'prop_lease_agreements_property_id_fkey', {
    foreignKeys: { columns: 'property_id', references: 'prop_properties(id)' },
  });
  pgm.addConstraint('prop_lease_agreements', 'prop_lease_agreements_tenant_id_fkey', {
    foreignKeys: { columns: 'tenant_id', references: 'prop_property_tenants(id)' },
  });

  pgm.createIndex('prop_lease_agreements', 'owner_id',        { name: 'idx_lease_owner' });
  pgm.createIndex('prop_lease_agreements', 'property_id',     { name: 'idx_lease_property' });
  pgm.createIndex('prop_lease_agreements', 'tenant_id',       { name: 'idx_lease_tenant' });
  pgm.createIndex('prop_lease_agreements', 'status',          { name: 'idx_lease_status' });
  pgm.createIndex('prop_lease_agreements', 'end_date',        { name: 'idx_lease_end_date' });
  pgm.createIndex('prop_lease_agreements', 'idempotency_key', { name: 'idx_lease_idempotency', unique: true });
  pgm.createIndex('prop_lease_agreements', 'last_modified_at',{ name: 'idx_lease_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE prop_lease_agreements IS
    'RLS: owner_id. Financial record — idempotency_key required (STD-11).';

    ALTER TABLE prop_lease_agreements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE prop_lease_agreements FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON prop_lease_agreements
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);


  // ── prop_rent_payments ───────────────────────────────────────────────────────

  pgm.createTable('prop_rent_payments', {
    id:                    { type: 'uuid',               primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id:              { type: 'uuid',               notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    lease_id:              { type: 'uuid',               notNull: true },
    payment_date:          { type: 'date',               notNull: true },
    period_month:          { type: 'integer',            notNull: true,  comment: '1-12' },
    period_year:           { type: 'integer',            notNull: true },
    amount_due:            { type: 'numeric',            notNull: true },
    amount_paid:           { type: 'numeric',            notNull: true },
    payment_method:        { type: 'prop_payment_method',notNull: true },
    receipt_number:        { type: 'varchar',            notNull: false },
    wipay_reference:       { type: 'varchar',            notNull: false, comment: 'WiPay transaction reference for online payments' },
    wipay_webhook_payload: { type: 'jsonb',              notNull: false, comment: 'Raw WiPay webhook snapshot for audit trail' },
    is_late:               { type: 'boolean',            notNull: true,  default: false },
    late_fee_charged:      { type: 'numeric',            notNull: true,  default: 0 },
    notes:                 { type: 'text',               notNull: false },
    idempotency_key:       { type: 'uuid',               notNull: true,  unique: true },
    last_modified_at:      { type: 'timestamptz',        notNull: true,  default: pgm.func('now()') },
    created_at:            { type: 'timestamptz',        notNull: true,  default: pgm.func('now()') },
    updated_at:            { type: 'timestamptz',        notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('prop_rent_payments', 'prop_rent_payments_lease_id_fkey', {
    foreignKeys: { columns: 'lease_id', references: 'prop_lease_agreements(id)' },
  });

  pgm.createIndex('prop_rent_payments', 'owner_id',                        { name: 'idx_rent_owner' });
  pgm.createIndex('prop_rent_payments', 'lease_id',                        { name: 'idx_rent_lease' });
  pgm.createIndex('prop_rent_payments', ['period_year', 'period_month'],   { name: 'idx_rent_period' });
  pgm.createIndex('prop_rent_payments', 'payment_method',                  { name: 'idx_rent_method' });
  pgm.createIndex('prop_rent_payments', 'wipay_reference',                 { name: 'idx_rent_wipay' });
  pgm.createIndex('prop_rent_payments', 'idempotency_key',                 { name: 'idx_rent_idempotency', unique: true });
  pgm.createIndex('prop_rent_payments', 'last_modified_at',                { name: 'idx_rent_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE prop_rent_payments IS
    'RLS: owner_id. Financial write — idempotency_key required (STD-11). WiPay webhooks carry idempotency_key generated by client to prevent double-posting on webhook retry.';

    ALTER TABLE prop_rent_payments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE prop_rent_payments FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON prop_rent_payments
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);


  // ── prop_maintenance_requests ────────────────────────────────────────────────

  pgm.createTable('prop_maintenance_requests', {
    id:                    { type: 'uuid',                 primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id:              { type: 'uuid',                 notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    property_id:           { type: 'uuid',                 notNull: true },
    lease_id:              { type: 'uuid',                 notNull: false, comment: 'Null for vacant property maintenance' },
    reported_by_tenant_id: { type: 'uuid',                 notNull: false, comment: 'Null if reported by owner' },
    category:              { type: 'maintenance_category', notNull: true },
    description:           { type: 'text',                 notNull: true },
    priority:              { type: 'maintenance_priority', notNull: true,  default: 'MEDIUM' },
    status:                { type: 'maintenance_status',   notNull: true,  default: 'OPEN' },
    assigned_to:           { type: 'varchar',              notNull: false, comment: 'Contractor name or internal reference' },
    estimated_cost:        { type: 'numeric',              notNull: false },
    actual_cost:           { type: 'numeric',              notNull: false },
    reported_date:         { type: 'date',                 notNull: true },
    scheduled_date:        { type: 'date',                 notNull: false },
    completed_date:        { type: 'date',                 notNull: false },
    completion_notes:      { type: 'text',                 notNull: false },
    photos:                { type: 'jsonb',                notNull: false, comment: 'Array of MinIO storage paths — before/after photos' },
    idempotency_key:       { type: 'uuid',                 notNull: true,  unique: true },
    last_modified_at:      { type: 'timestamptz',          notNull: true,  default: pgm.func('now()') },
    created_at:            { type: 'timestamptz',          notNull: true,  default: pgm.func('now()') },
    updated_at:            { type: 'timestamptz',          notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('prop_maintenance_requests', 'prop_maintenance_requests_property_id_fkey', {
    foreignKeys: { columns: 'property_id', references: 'prop_properties(id)' },
  });
  pgm.addConstraint('prop_maintenance_requests', 'prop_maintenance_requests_lease_id_fkey', {
    foreignKeys: { columns: 'lease_id', references: 'prop_lease_agreements(id)' },
  });
  pgm.addConstraint('prop_maintenance_requests', 'prop_maintenance_requests_tenant_id_fkey', {
    foreignKeys: { columns: 'reported_by_tenant_id', references: 'prop_property_tenants(id)' },
  });

  pgm.createIndex('prop_maintenance_requests', 'owner_id',              { name: 'idx_maint_owner' });
  pgm.createIndex('prop_maintenance_requests', 'property_id',           { name: 'idx_maint_property' });
  pgm.createIndex('prop_maintenance_requests', 'status',                { name: 'idx_maint_status' });
  pgm.createIndex('prop_maintenance_requests', 'priority',              { name: 'idx_maint_priority' });
  pgm.createIndex('prop_maintenance_requests', 'reported_by_tenant_id', { name: 'idx_maint_tenant' });
  pgm.createIndex('prop_maintenance_requests', 'idempotency_key',       { name: 'idx_maint_idempotency', unique: true });
  pgm.createIndex('prop_maintenance_requests', 'last_modified_at',      { name: 'idx_maint_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE prop_maintenance_requests IS 'RLS: owner_id.';

    ALTER TABLE prop_maintenance_requests ENABLE ROW LEVEL SECURITY;
    ALTER TABLE prop_maintenance_requests FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON prop_maintenance_requests
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);


  // ── prop_property_pipeline ───────────────────────────────────────────────────

  pgm.createTable('prop_property_pipeline', {
    id:                      { type: 'uuid',               primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id:                { type: 'uuid',               notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    name:                    { type: 'varchar',            notNull: true,  comment: 'Descriptive name e.g. "Corner lot Diego Martin"' },
    address:                 { type: 'text',               notNull: false },
    property_type:           { type: 'property_type',      notNull: true },
    asking_price:            { type: 'numeric',            notNull: false },
    estimated_value:         { type: 'numeric',            notNull: false },
    currency:                { type: 'varchar(3)',          notNull: true,  default: 'TTD' },
    lot_size_sqm:            { type: 'numeric',            notNull: false },
    floor_area_sqm:          { type: 'numeric',            notNull: false },
    estimated_monthly_rent:  { type: 'numeric',            notNull: false, comment: 'For yield calculation' },
    gross_yield_percent:     { type: 'numeric',            notNull: false, comment: 'Estimated: (annual_rent / purchase_price) x 100' },
    net_yield_percent:       { type: 'numeric',            notNull: false, comment: 'Estimated: after expenses' },
    stage:                   { type: 'prop_pipeline_stage',notNull: true,  default: 'WATCH' },
    source:                  { type: 'pipeline_source',    notNull: false },
    agent_name:              { type: 'varchar',            notNull: false },
    agent_phone:             { type: 'varchar',            notNull: false },
    analysis_notes:          { type: 'text',               notNull: false },
    photos:                  { type: 'jsonb',              notNull: false, comment: 'Array of MinIO storage paths' },
    last_modified_at:        { type: 'timestamptz',        notNull: true,  default: pgm.func('now()') },
    created_at:              { type: 'timestamptz',        notNull: true,  default: pgm.func('now()') },
    updated_at:              { type: 'timestamptz',        notNull: true,  default: pgm.func('now()') },
  });

  pgm.createIndex('prop_property_pipeline', 'owner_id',         { name: 'idx_pipeline_owner' });
  pgm.createIndex('prop_property_pipeline', 'stage',            { name: 'idx_pipeline_stage' });
  pgm.createIndex('prop_property_pipeline', 'property_type',    { name: 'idx_pipeline_type' });
  pgm.createIndex('prop_property_pipeline', 'last_modified_at', { name: 'idx_pipeline_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE prop_property_pipeline IS
    'RLS: owner_id. Financial figures are estimates for decision-making only — not ledger entries. Acquisition completion moves record to prop_properties.';

    ALTER TABLE prop_property_pipeline ENABLE ROW LEVEL SECURITY;
    ALTER TABLE prop_property_pipeline FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON prop_property_pipeline
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);


  // ── prop_mortgage_register ───────────────────────────────────────────────────
  // OPSEC: account_reference is PARTIAL only (e.g. last 4 digits).
  // Full account numbers are NEVER stored in this system.

  pgm.createTable('prop_mortgage_register', {
    id:                    { type: 'uuid',            primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id:              { type: 'uuid',            notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    property_id:           { type: 'uuid',            notNull: true },
    lender_name:           { type: 'varchar',         notNull: true },
    account_reference:     { type: 'varchar',         notNull: false, comment: 'PARTIAL reference only (e.g. last 4 digits) — OPSEC: full account numbers are NEVER stored' },
    mortgage_type:         { type: 'mortgage_type',   notNull: true },
    original_amount:       { type: 'numeric',         notNull: true },
    currency:              { type: 'varchar(3)',       notNull: true,  default: 'TTD' },
    outstanding_balance:   { type: 'numeric',         notNull: true },
    interest_rate_percent: { type: 'numeric',         notNull: true },
    start_date:            { type: 'date',            notNull: true },
    maturity_date:         { type: 'date',            notNull: false },
    monthly_payment:       { type: 'numeric',         notNull: true },
    payment_due_day:       { type: 'integer',         notNull: true,  default: 1, comment: 'Day of month payment is due (1-28)' },
    status:                { type: 'mortgage_status', notNull: true,  default: 'ACTIVE' },
    document_path:         { type: 'varchar',         notNull: false, comment: 'MinIO path for mortgage deed/agreement' },
    notes:                 { type: 'text',            notNull: false },
    idempotency_key:       { type: 'uuid',            notNull: true,  unique: true },
    last_modified_at:      { type: 'timestamptz',     notNull: true,  default: pgm.func('now()') },
    created_at:            { type: 'timestamptz',     notNull: true,  default: pgm.func('now()') },
    updated_at:            { type: 'timestamptz',     notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('prop_mortgage_register', 'prop_mortgage_register_property_id_fkey', {
    foreignKeys: { columns: 'property_id', references: 'prop_properties(id)' },
  });

  pgm.createIndex('prop_mortgage_register', 'owner_id',         { name: 'idx_mortgage_owner' });
  pgm.createIndex('prop_mortgage_register', 'property_id',      { name: 'idx_mortgage_property' });
  pgm.createIndex('prop_mortgage_register', 'status',           { name: 'idx_mortgage_status' });
  pgm.createIndex('prop_mortgage_register', 'maturity_date',    { name: 'idx_mortgage_maturity' });
  pgm.createIndex('prop_mortgage_register', 'idempotency_key',  { name: 'idx_mortgage_idempotency', unique: true });
  pgm.createIndex('prop_mortgage_register', 'last_modified_at', { name: 'idx_mortgage_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE prop_mortgage_register IS
    'RLS: owner_id. OPSEC: account_reference is partial only (e.g. last 4 digits) — full account numbers are NEVER stored. Financial write — idempotency_key required (STD-11).';

    ALTER TABLE prop_mortgage_register ENABLE ROW LEVEL SECURITY;
    ALTER TABLE prop_mortgage_register FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON prop_mortgage_register
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);
}


export async function down(pgm: MigrationBuilder): Promise<void> {
  // Drop in reverse dependency order. Do NOT touch prop_pending_review_queue (created in 000002).
  pgm.dropTable('prop_mortgage_register');
  pgm.dropTable('prop_property_pipeline');
  pgm.dropTable('prop_maintenance_requests');
  pgm.dropTable('prop_rent_payments');
  pgm.dropTable('prop_lease_agreements');
  pgm.dropTable('prop_property_tenants');
  pgm.dropTable('prop_properties');

  // Do NOT drop pending_review_status — created in migration 000002.
  pgm.dropType('mortgage_status');
  pgm.dropType('mortgage_type');
  pgm.dropType('pipeline_source');
  pgm.dropType('prop_pipeline_stage');
  pgm.dropType('maintenance_status');
  pgm.dropType('maintenance_priority');
  pgm.dropType('maintenance_category');
  pgm.dropType('prop_payment_method');
  pgm.dropType('lease_status');
  pgm.dropType('lease_type');
  pgm.dropType('property_tenant_id_type');
  pgm.dropType('tenure_type');
  pgm.dropType('property_type');
}
