import type { MigrationBuilder } from 'node-pg-migrate';

// Phase 1A — jag_family business schema.
// Creates all personal/family tables in dependency order.
// RLS applied immediately after each table — no table exists without its policy (STD-02).
//
// RLS: owner_id on all tables (personal data, not multi-tenant).
// Session variable: app.current_owner_id (SET LOCAL by jag-api withOwnerRLS middleware).
// Fail-closed: nullif(current_setting(..., true), '') converts missing setting to NULL.
//
// Vehicle note: jag_commercial.ims_vehicles is the canonical asset-tracking record.
// This DB holds the family-admin view: insurance, registration, family assignment.
// Cross-DB link: fam_personal_vehicles.ims_item_id → jag_commercial.ims_items.id (logical only).

export async function up(pgm: MigrationBuilder): Promise<void> {

  // ── Enums ────────────────────────────────────────────────────────────────────

  pgm.createType('family_relationship', ['SELF', 'WIFE', 'DAUGHTER', 'FATHER', 'BROTHER', 'OTHER']);
  pgm.createType('vehicle_fuel_type', ['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'CNG']);
  pgm.createType('personal_vehicle_type', ['CAR', 'SUV', 'PICKUP_TRUCK', 'VAN', 'MOTORCYCLE', 'OTHER']);
  pgm.createType('maintenance_service_type', [
    'OIL_CHANGE', 'TYRE_ROTATION', 'BRAKE_SERVICE', 'ANNUAL_SERVICE',
    'TRANSMISSION_SERVICE', 'AC_SERVICE', 'WINDSCREEN', 'BODY_REPAIR',
    'INSPECTION', 'REPAIR', 'OTHER',
  ]);
  pgm.createType('lifestyle_metric_type', [
    'WEIGHT_KG', 'STEPS', 'SLEEP_HOURS', 'CALORIES', 'EXERCISE_MINUTES',
    'BLOOD_PRESSURE_SYSTOLIC', 'BLOOD_PRESSURE_DIASTOLIC', 'RESTING_HEART_RATE', 'OTHER',
  ]);
  pgm.createType('loyalty_programme_type', ['AIRLINE', 'HOTEL', 'CRUISE', 'CREDIT_CARD', 'RETAIL', 'DINING', 'OTHER']);
  pgm.createType('loyalty_transaction_type', [
    'EARN', 'REDEEM', 'EXPIRE', 'TRANSFER_IN', 'TRANSFER_OUT', 'BONUS', 'REINSTATEMENT',
  ]);
  pgm.createType('succession_document_type', [
    'WILL', 'TRUST', 'POWER_OF_ATTORNEY', 'INSURANCE_POLICY', 'TITLE_DEED',
    'SHARE_CERTIFICATE', 'BANK_MANDATE', 'COMPANY_RESOLUTION', 'ADVANCE_DIRECTIVE', 'OTHER',
  ]);
  pgm.createType('docvault_document_type', [
    'NATIONAL_ID', 'PASSPORT', 'BIRTH_CERTIFICATE', 'MARRIAGE_CERTIFICATE', 'DEATH_CERTIFICATE',
    'MEDICAL_RECORD', 'ACADEMIC_CERTIFICATE', 'PROFESSIONAL_LICENCE', 'FINANCIAL_STATEMENT',
    'TAX_RETURN', 'INSURANCE_POLICY', 'PROPERTY_TITLE', 'LEGAL_AGREEMENT', 'OTHER',
  ]);


  // ── fam_family_members ───────────────────────────────────────────────────────

  pgm.createTable('fam_family_members', {
    id:                     { type: 'uuid',                primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id:               { type: 'uuid',                notNull: true,  comment: 'cross-db ref: jag_core.users.id — Robert is the owner of all family records' },
    relationship:           { type: 'family_relationship', notNull: true },
    first_name:             { type: 'varchar',             notNull: true },
    last_name:              { type: 'varchar',             notNull: true },
    date_of_birth:          { type: 'date',                notNull: false },
    email:                  { type: 'varchar',             notNull: false },
    phone:                  { type: 'varchar',             notNull: false },
    preferred_language:     { type: 'varchar(5)',           notNull: true,  default: 'en', comment: 'en | zh | es. Wife defaults zh.' },
    is_emergency_designate: { type: 'boolean',             notNull: true,  default: false, comment: 'Wife = true. Emergency Designate has full read-only access via Keycloak role.' },
    keycloak_user_id:       { type: 'uuid',                notNull: false, comment: 'cross-db ref: jag_core.users.id — non-null when family member has a platform login' },
    notes:                  { type: 'text',                notNull: false },
    created_at:             { type: 'timestamptz',         notNull: true,  default: pgm.func('now()') },
    updated_at:             { type: 'timestamptz',         notNull: true,  default: pgm.func('now()') },
  });

  pgm.createIndex('fam_family_members', 'owner_id',             { name: 'idx_family_owner' });
  pgm.createIndex('fam_family_members', 'relationship',         { name: 'idx_family_relationship' });
  pgm.createIndex('fam_family_members', 'is_emergency_designate', { name: 'idx_family_emergency_designate' });

  pgm.sql(`
    COMMENT ON TABLE fam_family_members IS
    'RLS: owner_id. Succession activation adds parallel Owner grant to wife — Robert''s Owner record is never modified (v1.9 rule).';

    ALTER TABLE fam_family_members ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fam_family_members FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON fam_family_members
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);


  // ── fam_personal_vehicles ────────────────────────────────────────────────────

  pgm.createTable('fam_personal_vehicles', {
    id:                     { type: 'uuid',                 primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id:               { type: 'uuid',                 notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    family_member_id:       { type: 'uuid',                 notNull: false, comment: 'Primary user of this vehicle' },
    ims_item_id:            { type: 'uuid',                 notNull: false, comment: 'cross-db ref: jag_commercial.ims_items.id — links to asset-tracking record in IMS' },
    registration_number:    { type: 'varchar',              notNull: true,  unique: true },
    make:                   { type: 'varchar',              notNull: true },
    model:                  { type: 'varchar',              notNull: true },
    year:                   { type: 'integer',              notNull: true },
    colour:                 { type: 'varchar',              notNull: false },
    vehicle_type:           { type: 'personal_vehicle_type',notNull: true },
    fuel_type:              { type: 'vehicle_fuel_type',    notNull: true },
    vin:                    { type: 'varchar',              notNull: false },
    engine_number:          { type: 'varchar',              notNull: false },
    insurance_policy_number:{ type: 'varchar',              notNull: false },
    insurance_provider:     { type: 'varchar',              notNull: false },
    insurance_expiry:       { type: 'date',                 notNull: false },
    registration_expiry:    { type: 'date',                 notNull: false },
    purchase_date:          { type: 'date',                 notNull: false },
    purchase_price:         { type: 'numeric',              notNull: false },
    current_mileage_km:     { type: 'integer',              notNull: false },
    notes:                  { type: 'text',                 notNull: false },
    last_modified_at:       { type: 'timestamptz',          notNull: true,  default: pgm.func('now()') },
    created_at:             { type: 'timestamptz',          notNull: true,  default: pgm.func('now()') },
    updated_at:             { type: 'timestamptz',          notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('fam_personal_vehicles', 'fam_personal_vehicles_family_member_id_fkey', {
    foreignKeys: { columns: 'family_member_id', references: 'fam_family_members(id)' },
  });

  pgm.createIndex('fam_personal_vehicles', 'owner_id',            { name: 'idx_pveh_owner' });
  pgm.createIndex('fam_personal_vehicles', 'family_member_id',    { name: 'idx_pveh_family_member' });
  pgm.createIndex('fam_personal_vehicles', 'registration_number', { name: 'idx_pveh_rego', unique: true });
  pgm.createIndex('fam_personal_vehicles', 'insurance_expiry',    { name: 'idx_pveh_ins_expiry' });
  pgm.createIndex('fam_personal_vehicles', 'registration_expiry', { name: 'idx_pveh_rego_expiry' });
  pgm.createIndex('fam_personal_vehicles', 'last_modified_at',    { name: 'idx_pveh_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE fam_personal_vehicles IS
    'RLS: owner_id. Family-admin view (insurance, registration, family assignment). jag_commercial.ims_vehicles is the asset-tracking counterpart. ims_item_id is the cross-DB logical link.';

    ALTER TABLE fam_personal_vehicles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fam_personal_vehicles FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON fam_personal_vehicles
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);


  // ── fam_vehicle_maintenance ──────────────────────────────────────────────────

  pgm.createTable('fam_vehicle_maintenance', {
    id:                   { type: 'uuid',                     primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id:             { type: 'uuid',                     notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    vehicle_id:           { type: 'uuid',                     notNull: true },
    service_type:         { type: 'maintenance_service_type', notNull: true },
    service_date:         { type: 'date',                     notNull: true },
    mileage_at_service:   { type: 'integer',                  notNull: false },
    service_provider:     { type: 'varchar',                  notNull: false },
    cost:                 { type: 'numeric',                  notNull: false },
    description:          { type: 'text',                     notNull: false },
    next_service_date:    { type: 'date',                     notNull: false },
    next_service_mileage: { type: 'integer',                  notNull: false },
    receipt_path:         { type: 'varchar',                  notNull: false, comment: 'MinIO path for receipt/invoice' },
    idempotency_key:      { type: 'uuid',                     notNull: true,  unique: true },
    created_at:           { type: 'timestamptz',              notNull: true,  default: pgm.func('now()') },
    updated_at:           { type: 'timestamptz',              notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('fam_vehicle_maintenance', 'fam_vehicle_maintenance_vehicle_id_fkey', {
    foreignKeys: { columns: 'vehicle_id', references: 'fam_personal_vehicles(id)' },
  });

  pgm.createIndex('fam_vehicle_maintenance', 'owner_id',          { name: 'idx_vmaint_owner' });
  pgm.createIndex('fam_vehicle_maintenance', 'vehicle_id',        { name: 'idx_vmaint_vehicle' });
  pgm.createIndex('fam_vehicle_maintenance', 'service_date',      { name: 'idx_vmaint_date' });
  pgm.createIndex('fam_vehicle_maintenance', 'next_service_date', { name: 'idx_vmaint_next_service' });
  pgm.createIndex('fam_vehicle_maintenance', 'idempotency_key',   { name: 'idx_vmaint_idempotency', unique: true });

  pgm.sql(`
    COMMENT ON TABLE fam_vehicle_maintenance IS 'RLS: owner_id.';

    ALTER TABLE fam_vehicle_maintenance ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fam_vehicle_maintenance FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON fam_vehicle_maintenance
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);


  // ── fam_lifestyle_tracker ────────────────────────────────────────────────────

  pgm.createTable('fam_lifestyle_tracker', {
    id:               { type: 'uuid',                  primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id:         { type: 'uuid',                  notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    family_member_id: { type: 'uuid',                  notNull: false },
    entry_date:       { type: 'date',                  notNull: true },
    metric_type:      { type: 'lifestyle_metric_type', notNull: true },
    value:            { type: 'numeric',               notNull: true },
    unit:             { type: 'varchar',               notNull: true,  comment: 'e.g. kg, steps, hours, kcal, bpm, mmHg' },
    notes:            { type: 'text',                  notNull: false },
    source:           { type: 'varchar',               notNull: false, comment: 'e.g. MANUAL, APPLE_HEALTH, GARMIN, FITBIT' },
    created_at:       { type: 'timestamptz',           notNull: true,  default: pgm.func('now()') },
    updated_at:       { type: 'timestamptz',           notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('fam_lifestyle_tracker', 'fam_lifestyle_tracker_family_member_id_fkey', {
    foreignKeys: { columns: 'family_member_id', references: 'fam_family_members(id)' },
  });

  pgm.createIndex('fam_lifestyle_tracker', 'owner_id',         { name: 'idx_lifestyle_owner' });
  pgm.createIndex('fam_lifestyle_tracker', 'family_member_id', { name: 'idx_lifestyle_member' });
  pgm.createIndex('fam_lifestyle_tracker', ['family_member_id', 'metric_type', 'entry_date'], { name: 'idx_lifestyle_query' });
  pgm.createIndex('fam_lifestyle_tracker', 'entry_date',       { name: 'idx_lifestyle_date' });

  pgm.sql(`
    COMMENT ON TABLE fam_lifestyle_tracker IS 'RLS: owner_id.';

    ALTER TABLE fam_lifestyle_tracker ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fam_lifestyle_tracker FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON fam_lifestyle_tracker
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);


  // ── fam_loyalty_programmes ───────────────────────────────────────────────────

  pgm.createTable('fam_loyalty_programmes', {
    id:               { type: 'uuid',                  primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id:         { type: 'uuid',                  notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    family_member_id: { type: 'uuid',                  notNull: false, comment: 'Which family member holds this membership' },
    programme_type:   { type: 'loyalty_programme_type',notNull: true },
    provider_name:    { type: 'varchar',               notNull: true,  comment: 'e.g. Caribbean Airlines, Marriott, Royal Caribbean, Visa Infinite' },
    membership_number:{ type: 'varchar',               notNull: false },
    tier:             { type: 'varchar',               notNull: false, comment: 'e.g. Gold, Platinum, Diamond' },
    points_balance:   { type: 'numeric',               notNull: true,  default: 0 },
    miles_balance:    { type: 'numeric',               notNull: true,  default: 0 },
    expiry_date:      { type: 'date',                  notNull: false, comment: 'Points expiry date — alert fires 60 days before' },
    notes:            { type: 'text',                  notNull: false },
    last_modified_at: { type: 'timestamptz',           notNull: true,  default: pgm.func('now()') },
    created_at:       { type: 'timestamptz',           notNull: true,  default: pgm.func('now()') },
    updated_at:       { type: 'timestamptz',           notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('fam_loyalty_programmes', 'fam_loyalty_programmes_family_member_id_fkey', {
    foreignKeys: { columns: 'family_member_id', references: 'fam_family_members(id)' },
  });

  pgm.createIndex('fam_loyalty_programmes', 'owner_id',         { name: 'idx_loyalty_owner' });
  pgm.createIndex('fam_loyalty_programmes', 'family_member_id', { name: 'idx_loyalty_member' });
  pgm.createIndex('fam_loyalty_programmes', 'programme_type',   { name: 'idx_loyalty_type' });
  pgm.createIndex('fam_loyalty_programmes', 'expiry_date',      { name: 'idx_loyalty_expiry' });
  pgm.createIndex('fam_loyalty_programmes', 'last_modified_at', { name: 'idx_loyalty_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE fam_loyalty_programmes IS
    'RLS: owner_id. crm_contacts.loyalty_member_id in jag_commercial cross-references this table for JAG Lifestyle integration (logical reference, no DB-level FK).';

    ALTER TABLE fam_loyalty_programmes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fam_loyalty_programmes FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON fam_loyalty_programmes
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);


  // ── fam_loyalty_transactions ─────────────────────────────────────────────────

  pgm.createTable('fam_loyalty_transactions', {
    id:               { type: 'uuid',                     primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id:         { type: 'uuid',                     notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    programme_id:     { type: 'uuid',                     notNull: true },
    transaction_date: { type: 'date',                     notNull: true },
    transaction_type: { type: 'loyalty_transaction_type', notNull: true },
    points_amount:    { type: 'numeric',                  notNull: true,  default: 0, comment: 'Positive = earn/credit. Negative = redeem/debit.' },
    miles_amount:     { type: 'numeric',                  notNull: true,  default: 0 },
    description:      { type: 'varchar',                  notNull: true },
    reference_number: { type: 'varchar',                  notNull: false, comment: 'Programme reference or booking number' },
    idempotency_key:  { type: 'uuid',                     notNull: true,  unique: true },
    created_at:       { type: 'timestamptz',              notNull: true,  default: pgm.func('now()') },
    updated_at:       { type: 'timestamptz',              notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('fam_loyalty_transactions', 'fam_loyalty_transactions_programme_id_fkey', {
    foreignKeys: { columns: 'programme_id', references: 'fam_loyalty_programmes(id)' },
  });

  pgm.createIndex('fam_loyalty_transactions', 'owner_id',         { name: 'idx_loyalty_tx_owner' });
  pgm.createIndex('fam_loyalty_transactions', 'programme_id',     { name: 'idx_loyalty_tx_programme' });
  pgm.createIndex('fam_loyalty_transactions', 'transaction_date', { name: 'idx_loyalty_tx_date' });
  pgm.createIndex('fam_loyalty_transactions', 'idempotency_key',  { name: 'idx_loyalty_tx_idempotency', unique: true });

  pgm.sql(`
    COMMENT ON TABLE fam_loyalty_transactions IS
    'RLS: owner_id. idempotency_key prevents duplicate logging of the same transaction.';

    ALTER TABLE fam_loyalty_transactions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fam_loyalty_transactions FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON fam_loyalty_transactions
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);


  // ── fam_succession_documents ─────────────────────────────────────────────────

  pgm.createTable('fam_succession_documents', {
    id:                  { type: 'uuid',                     primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id:            { type: 'uuid',                     notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    document_type:       { type: 'succession_document_type', notNull: true },
    title:               { type: 'varchar',                  notNull: true },
    description:         { type: 'text',                     notNull: false },
    document_date:       { type: 'date',                     notNull: false },
    storage_path:        { type: 'varchar',                  notNull: false, comment: 'MinIO path — classified documents only accessible via Owner role' },
    is_classified:       { type: 'boolean',                  notNull: true,  default: true, comment: 'Classified docs accessible only to Owner. Emergency Designate has guided access per activation protocol.' },
    governing_law:       { type: 'varchar',                  notNull: false, comment: 'Jurisdiction e.g. Trinidad and Tobago' },
    lawyer_firm:         { type: 'varchar',                  notNull: false, comment: 'Name of law firm only — no individual lawyer identity per OPSEC' },
    last_reviewed_date:  { type: 'date',                     notNull: false },
    review_reminder_date:{ type: 'date',                     notNull: false },
    notes:               { type: 'text',                     notNull: false },
    last_modified_at:    { type: 'timestamptz',              notNull: true,  default: pgm.func('now()') },
    created_at:          { type: 'timestamptz',              notNull: true,  default: pgm.func('now()') },
    updated_at:          { type: 'timestamptz',              notNull: true,  default: pgm.func('now()') },
  });

  pgm.createIndex('fam_succession_documents', 'owner_id',             { name: 'idx_succession_owner' });
  pgm.createIndex('fam_succession_documents', 'document_type',        { name: 'idx_succession_type' });
  pgm.createIndex('fam_succession_documents', 'review_reminder_date', { name: 'idx_succession_reminder' });
  pgm.createIndex('fam_succession_documents', 'last_modified_at',     { name: 'idx_succession_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE fam_succession_documents IS
    'RLS: owner_id. Classified documents do not expose details to External Advisors without explicit external_advisor_grants scope in jag_core. Lawyer identities are NOT stored (OPSEC).';

    ALTER TABLE fam_succession_documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fam_succession_documents FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON fam_succession_documents
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);


  // ── fam_docvault_files ───────────────────────────────────────────────────────

  pgm.createTable('fam_docvault_files', {
    id:               { type: 'uuid',                  primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id:         { type: 'uuid',                  notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    family_member_id: { type: 'uuid',                  notNull: false, comment: 'Whose document this is' },
    title:            { type: 'varchar',               notNull: true },
    document_type:    { type: 'docvault_document_type',notNull: true },
    file_name:        { type: 'varchar',               notNull: true },
    storage_path:     { type: 'varchar',               notNull: true,  comment: 'MinIO path' },
    mime_type:        { type: 'varchar',               notNull: true },
    file_size_bytes:  { type: 'bigint',                notNull: true },
    expires_date:     { type: 'date',                  notNull: false, comment: 'e.g. passport expiry — alert fires 90 days before' },
    is_data_room:     { type: 'boolean',               notNull: true,  default: false, comment: 'If true, document is available in the sale-readiness Data Room for that entity' },
    data_room_entity: { type: 'varchar',               notNull: false, comment: 'Which entity Data Room this belongs to — null if not a data room document' },
    uploaded_by:      { type: 'uuid',                  notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    notes:            { type: 'text',                  notNull: false },
    last_modified_at: { type: 'timestamptz',           notNull: true,  default: pgm.func('now()') },
    created_at:       { type: 'timestamptz',           notNull: true,  default: pgm.func('now()') },
    updated_at:       { type: 'timestamptz',           notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('fam_docvault_files', 'fam_docvault_files_family_member_id_fkey', {
    foreignKeys: { columns: 'family_member_id', references: 'fam_family_members(id)' },
  });

  pgm.createIndex('fam_docvault_files', 'owner_id',         { name: 'idx_docvault_owner' });
  pgm.createIndex('fam_docvault_files', 'family_member_id', { name: 'idx_docvault_member' });
  pgm.createIndex('fam_docvault_files', 'document_type',    { name: 'idx_docvault_type' });
  pgm.createIndex('fam_docvault_files', 'expires_date',     { name: 'idx_docvault_expiry' });
  pgm.createIndex('fam_docvault_files', 'is_data_room',     { name: 'idx_docvault_data_room' });
  pgm.createIndex('fam_docvault_files', 'last_modified_at', { name: 'idx_docvault_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE fam_docvault_files IS
    'RLS: owner_id. Data Room documents (is_data_room=true) accessible to External Advisors with appropriate scope in jag_core.external_advisor_grants. All other documents: Owner only.';

    ALTER TABLE fam_docvault_files ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fam_docvault_files FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON fam_docvault_files
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);
}


export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('fam_docvault_files');
  pgm.dropTable('fam_succession_documents');
  pgm.dropTable('fam_loyalty_transactions');
  pgm.dropTable('fam_loyalty_programmes');
  pgm.dropTable('fam_lifestyle_tracker');
  pgm.dropTable('fam_vehicle_maintenance');
  pgm.dropTable('fam_personal_vehicles');
  pgm.dropTable('fam_family_members');

  pgm.dropType('docvault_document_type');
  pgm.dropType('succession_document_type');
  pgm.dropType('loyalty_transaction_type');
  pgm.dropType('loyalty_programme_type');
  pgm.dropType('lifestyle_metric_type');
  pgm.dropType('maintenance_service_type');
  pgm.dropType('personal_vehicle_type');
  pgm.dropType('vehicle_fuel_type');
  pgm.dropType('family_relationship');
}
