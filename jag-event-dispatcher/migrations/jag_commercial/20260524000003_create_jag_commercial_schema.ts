import type { MigrationBuilder } from 'node-pg-migrate';

// Phase 1A — jag_commercial business schema.
// Creates all IMS, JABCO, and CRM tables in dependency order.
// RLS applied immediately after each table — no table exists without its policy (STD-02).
//
// Covers three domains:
//   IMS   — Inventory Management (all locations, JABCO tool crib, JABCO FLEET, personal FLEET)
//   JABCO — Full construction PM: BOQ, VOs, progress claims, retention, Gantt, site diary
//   CRM   — Contact master, JABCO sales pipeline, DragonBridge deals
//
// entity_tag is an Entertainment concept only — NOT used in jag_commercial.
//
// RLS session variable: app.current_tenant_id (SET LOCAL by jag-api middleware).
// Fail-closed: nullif(current_setting(..., true), '') converts missing setting to NULL.
//
// Cross-DB references (logical only — no DB-level FK):
//   tenant_id → jag_core.tenants.id
//   user refs (performed_by, assigned_to, etc.) → jag_core.users.id

export async function up(pgm: MigrationBuilder): Promise<void> {

  // ── Enums ────────────────────────────────────────────────────────────────────

  pgm.createType('item_condition', ['NEW', 'GOOD', 'FAIR', 'POOR', 'WRITTEN_OFF']);
  pgm.createType('movement_type', ['RECEIVE', 'TRANSFER', 'ADJUSTMENT', 'CONSUME', 'RETURN', 'DISPOSAL']);
  pgm.createType('vehicle_type', [
    'CAR', 'SUV', 'TRUCK', 'VAN', 'EXCAVATOR', 'COMPACTOR',
    'ROLLER', 'CRANE', 'GENERATOR', 'TRAILER', 'MOTORCYCLE', 'OTHER',
  ]);
  pgm.createType('project_status', ['TENDER', 'ACTIVE', 'PRACTICAL_COMPLETION', 'DEFECTS_LIABILITY', 'CLOSED', 'CANCELLED']);
  pgm.createType('vo_status', ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']);
  pgm.createType('claim_status', ['DRAFT', 'SUBMITTED', 'CERTIFIED', 'PAID', 'DISPUTED']);
  pgm.createType('retention_status', ['HOLDING', 'PARTIALLY_RELEASED', 'FULLY_RELEASED']);
  pgm.createType('pipeline_stage', ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']);
  pgm.createType('sync_status', ['SYNCED', 'PENDING_SYNC']);


  // ════════════════════════════════════════════════════════════════════════════
  // IMS — INVENTORY MANAGEMENT SYSTEM
  // ════════════════════════════════════════════════════════════════════════════

  // ── ims_locations ────────────────────────────────────────────────────────────

  pgm.createTable('ims_locations', {
    id:               { type: 'uuid',       primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:        { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    code:             { type: 'varchar',    notNull: true,  comment: 'e.g. BARATARIA_HOME, FYZABAD_HOME, JABCO_OFFICE, JABCO_YARD' },
    name:             { type: 'varchar',    notNull: true },
    address:          { type: 'text',       notNull: false },
    is_active:        { type: 'boolean',    notNull: true,  default: true },
    last_modified_at: { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    last_modified_by: { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    created_at:       { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    updated_at:       { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
  });

  pgm.createIndex('ims_locations', 'tenant_id', { name: 'idx_ims_locations_tenant' });
  pgm.createIndex('ims_locations', 'code',      { name: 'idx_ims_locations_code' });

  pgm.sql(`
    COMMENT ON TABLE ims_locations IS
    'RLS: tenant_id. Seed locations: Barataria Home, Fyzabad Home, JABCO Office/Yard.';

    ALTER TABLE ims_locations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ims_locations FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON ims_locations
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── ims_categories ───────────────────────────────────────────────────────────
  // Self-referential FK added after table creation.

  pgm.createTable('ims_categories', {
    id:                 { type: 'uuid',       primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:          { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    name:               { type: 'varchar',    notNull: true },
    parent_category_id: { type: 'uuid',       notNull: false, comment: 'Self-ref for hierarchy e.g. Tools > Power Tools' },
    description:        { type: 'text',       notNull: false },
    last_modified_at:   { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    created_at:         { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    updated_at:         { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('ims_categories', 'ims_categories_parent_category_id_fkey', {
    foreignKeys: { columns: 'parent_category_id', references: 'ims_categories(id)' },
  });

  pgm.createIndex('ims_categories', 'tenant_id',          { name: 'idx_ims_cat_tenant' });
  pgm.createIndex('ims_categories', 'parent_category_id', { name: 'idx_ims_cat_parent' });

  pgm.sql(`
    COMMENT ON TABLE ims_categories IS 'RLS: tenant_id.';

    ALTER TABLE ims_categories ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ims_categories FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON ims_categories
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── ims_tags ─────────────────────────────────────────────────────────────────

  pgm.createTable('ims_tags', {
    id:         { type: 'uuid',       primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:  { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    name:       { type: 'varchar',    notNull: true },
    color:      { type: 'varchar',    notNull: false, comment: 'Hex color for UI display e.g. #FF5733' },
    created_at: { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    updated_at: { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
  });

  pgm.createIndex('ims_tags', 'tenant_id', { name: 'idx_ims_tags_tenant' });

  pgm.sql(`
    COMMENT ON TABLE ims_tags IS 'RLS: tenant_id.';

    ALTER TABLE ims_tags ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ims_tags FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON ims_tags
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── ims_items ────────────────────────────────────────────────────────────────
  // JABCO FLEET and personal FLEET vehicles are items with is_asset=true.
  // ims_vehicles extends this table with vehicle-specific fields.

  pgm.createTable('ims_items', {
    id:               { type: 'uuid',          primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:        { type: 'uuid',          notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    location_id:      { type: 'uuid',          notNull: true },
    category_id:      { type: 'uuid',          notNull: false },
    name:             { type: 'varchar',       notNull: true },
    description:      { type: 'text',          notNull: false },
    sku:              { type: 'varchar',       notNull: false, comment: 'Unique per tenant — used for barcode generation' },
    unit_of_measure:  { type: 'varchar',       notNull: true,  default: 'each', comment: 'each | kg | m | L | m2 | m3' },
    quantity_on_hand: { type: 'numeric',       notNull: true,  default: 0 },
    quantity_reserved:{ type: 'numeric',       notNull: true,  default: 0 },
    reorder_point:    { type: 'numeric',       notNull: false },
    unit_value:       { type: 'numeric',       notNull: false, comment: 'Asset valuation — not a sale price' },
    serial_number:    { type: 'varchar',       notNull: false },
    condition:        { type: 'item_condition',notNull: true,  default: 'GOOD' },
    is_asset:         { type: 'boolean',       notNull: true,  default: false, comment: 'True for capital assets (vehicles, equipment). False for consumables.' },
    is_active:        { type: 'boolean',       notNull: true,  default: true },
    last_modified_at: { type: 'timestamptz',   notNull: true,  default: pgm.func('now()') },
    last_modified_by: { type: 'uuid',          notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    created_at:       { type: 'timestamptz',   notNull: true,  default: pgm.func('now()') },
    updated_at:       { type: 'timestamptz',   notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('ims_items', 'ims_items_location_id_fkey', {
    foreignKeys: { columns: 'location_id', references: 'ims_locations(id)' },
  });
  pgm.addConstraint('ims_items', 'ims_items_category_id_fkey', {
    foreignKeys: { columns: 'category_id', references: 'ims_categories(id)' },
  });

  pgm.createIndex('ims_items', 'tenant_id',        { name: 'idx_ims_items_tenant' });
  pgm.createIndex('ims_items', 'location_id',      { name: 'idx_ims_items_location' });
  pgm.createIndex('ims_items', 'category_id',      { name: 'idx_ims_items_category' });
  pgm.createIndex('ims_items', 'sku',              { name: 'idx_ims_items_sku' });
  pgm.createIndex('ims_items', 'last_modified_at', { name: 'idx_ims_items_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE ims_items IS
    'RLS: tenant_id. JABCO FLEET and personal FLEET vehicles are items with is_asset=true and category VEHICLE. ims_vehicles extends this table with vehicle-specific fields.';

    ALTER TABLE ims_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ims_items FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON ims_items
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── ims_vehicles ─────────────────────────────────────────────────────────────
  // One-to-one extension of ims_items for vehicle-specific fields.
  // Covers JABCO FLEET (trucks, excavators) and personal FLEET.

  pgm.createTable('ims_vehicles', {
    id:                      { type: 'uuid',         primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:               { type: 'uuid',         notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    item_id:                 { type: 'uuid',         notNull: true,  unique: true, comment: 'One-to-one extension of ims_items' },
    fleet_type:              { type: 'varchar',      notNull: true,  comment: 'JABCO_FLEET | PERSONAL_FLEET' },
    registration_number:     { type: 'varchar',      notNull: true },
    make:                    { type: 'varchar',      notNull: true },
    model:                   { type: 'varchar',      notNull: true },
    year:                    { type: 'integer',      notNull: true },
    colour:                  { type: 'varchar',      notNull: false },
    vehicle_type:            { type: 'vehicle_type', notNull: true },
    fuel_type:               { type: 'varchar',      notNull: true,  comment: 'PETROL | DIESEL | HYBRID | ELECTRIC | NONE' },
    vin:                     { type: 'varchar',      notNull: false },
    engine_number:           { type: 'varchar',      notNull: false },
    insurance_policy_number: { type: 'varchar',      notNull: false },
    insurance_provider:      { type: 'varchar',      notNull: false },
    insurance_expiry:        { type: 'date',         notNull: false },
    registration_expiry:     { type: 'date',         notNull: false },
    purchase_date:           { type: 'date',         notNull: false },
    purchase_price:          { type: 'numeric',      notNull: false },
    current_mileage_km:      { type: 'integer',      notNull: false },
    assigned_to_user_id:     { type: 'uuid',         notNull: false, comment: 'cross-db ref: jag_core.users.id — primary driver/user' },
    last_modified_at:        { type: 'timestamptz',  notNull: true,  default: pgm.func('now()') },
    last_modified_by:        { type: 'uuid',         notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    created_at:              { type: 'timestamptz',  notNull: true,  default: pgm.func('now()') },
    updated_at:              { type: 'timestamptz',  notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('ims_vehicles', 'ims_vehicles_item_id_fkey', {
    foreignKeys: { columns: 'item_id', references: 'ims_items(id)' },
  });

  pgm.createIndex('ims_vehicles', 'tenant_id',           { name: 'idx_ims_veh_tenant' });
  pgm.createIndex('ims_vehicles', 'registration_number', { name: 'idx_ims_veh_rego' });
  pgm.createIndex('ims_vehicles', 'fleet_type',          { name: 'idx_ims_veh_fleet_type' });
  pgm.createIndex('ims_vehicles', 'insurance_expiry',    { name: 'idx_ims_veh_ins_expiry' });
  pgm.createIndex('ims_vehicles', 'registration_expiry', { name: 'idx_ims_veh_rego_expiry' });

  pgm.sql(`
    COMMENT ON TABLE ims_vehicles IS
    'RLS: tenant_id. Personal fleet records also have a counterpart in jag_family.fam_personal_vehicles for family-admin data. Cross-DB reference held as ims_item_id in jag_family.';

    ALTER TABLE ims_vehicles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ims_vehicles FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON ims_vehicles
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── ims_item_tags ────────────────────────────────────────────────────────────

  pgm.createTable('ims_item_tags', {
    id:         { type: 'uuid',       primaryKey: true, default: pgm.func('gen_random_uuid()') },
    item_id:    { type: 'uuid',       notNull: true },
    tag_id:     { type: 'uuid',       notNull: true },
    created_at: { type: 'timestamptz',notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('ims_item_tags', 'ims_item_tags_item_id_fkey', {
    foreignKeys: { columns: 'item_id', references: 'ims_items(id)' },
  });
  pgm.addConstraint('ims_item_tags', 'ims_item_tags_tag_id_fkey', {
    foreignKeys: { columns: 'tag_id', references: 'ims_tags(id)' },
  });
  pgm.addConstraint('ims_item_tags', 'ims_item_tags_item_tag_unique', {
    unique: ['item_id', 'tag_id'],
  });

  pgm.createIndex('ims_item_tags', ['item_id', 'tag_id'], { name: 'idx_ims_item_tags_pair', unique: true });

  // ims_item_tags has no tenant_id; access is governed by the parent ims_items RLS.
  // No standalone RLS policy on this junction table.
  pgm.sql(`COMMENT ON TABLE ims_item_tags IS 'Junction: ims_items <-> ims_tags. Access governed by ims_items RLS.'`);


  // ── ims_barcodes ─────────────────────────────────────────────────────────────
  // barcode_value is unique platform-wide to prevent scan collisions.

  pgm.createTable('ims_barcodes', {
    id:            { type: 'uuid',       primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:     { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    item_id:       { type: 'uuid',       notNull: true },
    barcode_value: { type: 'varchar',    notNull: true,  unique: true },
    barcode_type:  { type: 'varchar',    notNull: true,  comment: 'QR | CODE128 | EAN13 | EAN8 | DATAMATRIX' },
    is_primary:    { type: 'boolean',    notNull: true,  default: false },
    created_at:    { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    updated_at:    { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('ims_barcodes', 'ims_barcodes_item_id_fkey', {
    foreignKeys: { columns: 'item_id', references: 'ims_items(id)' },
  });

  pgm.createIndex('ims_barcodes', 'tenant_id',     { name: 'idx_ims_barcodes_tenant' });
  pgm.createIndex('ims_barcodes', 'item_id',       { name: 'idx_ims_barcodes_item' });
  pgm.createIndex('ims_barcodes', 'barcode_value', { name: 'idx_ims_barcodes_value', unique: true });

  pgm.sql(`
    COMMENT ON TABLE ims_barcodes IS
    'RLS: tenant_id. barcode_value uniqueness is platform-wide to prevent scan collisions.';

    ALTER TABLE ims_barcodes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ims_barcodes FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON ims_barcodes
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── ims_photos ───────────────────────────────────────────────────────────────

  pgm.createTable('ims_photos', {
    id:           { type: 'uuid',       primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:    { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    item_id:      { type: 'uuid',       notNull: true },
    storage_path: { type: 'varchar',    notNull: true,  comment: 'MinIO object path e.g. ims/items/{item_id}/{uuid}.jpg' },
    is_primary:   { type: 'boolean',    notNull: true,  default: false },
    uploaded_by:  { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    created_at:   { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    updated_at:   { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('ims_photos', 'ims_photos_item_id_fkey', {
    foreignKeys: { columns: 'item_id', references: 'ims_items(id)' },
  });

  pgm.createIndex('ims_photos', 'tenant_id', { name: 'idx_ims_photos_tenant' });
  pgm.createIndex('ims_photos', 'item_id',   { name: 'idx_ims_photos_item' });

  pgm.sql(`
    COMMENT ON TABLE ims_photos IS 'RLS: tenant_id.';

    ALTER TABLE ims_photos ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ims_photos FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON ims_photos
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── ims_stock_movements ──────────────────────────────────────────────────────
  // Offline-critical. idempotency_key prevents duplicate posting on reconnect (STD-11).
  // from_location_id and to_location_id both reference ims_locations — nullable for source/dest.

  pgm.createTable('ims_stock_movements', {
    id:               { type: 'uuid',         primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:        { type: 'uuid',         notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    item_id:          { type: 'uuid',         notNull: true },
    from_location_id: { type: 'uuid',         notNull: false },
    to_location_id:   { type: 'uuid',         notNull: false },
    quantity:         { type: 'numeric',      notNull: true },
    movement_type:    { type: 'movement_type',notNull: true },
    reference_type:   { type: 'varchar',      notNull: false, comment: 'e.g. JABCO_PROJECT, PURCHASE_ORDER' },
    reference_id:     { type: 'uuid',         notNull: false, comment: 'ID of the reference document' },
    notes:            { type: 'text',         notNull: false },
    performed_by:     { type: 'uuid',         notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    idempotency_key:  { type: 'uuid',         notNull: true,  unique: true },
    last_modified_at: { type: 'timestamptz',  notNull: true,  default: pgm.func('now()') },
    created_at:       { type: 'timestamptz',  notNull: true,  default: pgm.func('now()') },
    updated_at:       { type: 'timestamptz',  notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('ims_stock_movements', 'ims_stock_movements_item_id_fkey', {
    foreignKeys: { columns: 'item_id', references: 'ims_items(id)' },
  });
  pgm.addConstraint('ims_stock_movements', 'ims_stock_movements_from_location_id_fkey', {
    foreignKeys: { columns: 'from_location_id', references: 'ims_locations(id)' },
  });
  pgm.addConstraint('ims_stock_movements', 'ims_stock_movements_to_location_id_fkey', {
    foreignKeys: { columns: 'to_location_id', references: 'ims_locations(id)' },
  });

  pgm.createIndex('ims_stock_movements', 'tenant_id',                        { name: 'idx_ims_movements_tenant' });
  pgm.createIndex('ims_stock_movements', 'item_id',                          { name: 'idx_ims_movements_item' });
  pgm.createIndex('ims_stock_movements', ['reference_type', 'reference_id'], { name: 'idx_ims_movements_ref' });
  pgm.createIndex('ims_stock_movements', 'idempotency_key',                  { name: 'idx_ims_movements_idempotency', unique: true });
  pgm.createIndex('ims_stock_movements', 'last_modified_at',                 { name: 'idx_ims_movements_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE ims_stock_movements IS
    'RLS: tenant_id. OFFLINE-CRITICAL — idempotency_key prevents duplicate posting on reconnect (STD-11).';

    ALTER TABLE ims_stock_movements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ims_stock_movements FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON ims_stock_movements
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ════════════════════════════════════════════════════════════════════════════
  // JABCO — CONSTRUCTION PROJECT MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  // ── jabco_projects ───────────────────────────────────────────────────────────

  pgm.createTable('jabco_projects', {
    id:                 { type: 'uuid',           primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:          { type: 'uuid',           notNull: true,  comment: 'cross-db ref: jag_core.tenants.id — always JABCO tenant' },
    project_code:       { type: 'varchar',        notNull: true,  unique: true },
    name:               { type: 'varchar',        notNull: true },
    client_name:        { type: 'varchar',        notNull: true },
    client_type:        { type: 'varchar',        notNull: true,  comment: 'GOVERNMENT | PRIVATE' },
    status:             { type: 'project_status', notNull: true,  default: 'TENDER' },
    contract_value:     { type: 'numeric',        notNull: true },
    contract_currency:  { type: 'varchar(3)',      notNull: true,  default: 'TTD' },
    start_date:         { type: 'date',           notNull: false },
    expected_end_date:  { type: 'date',           notNull: false },
    actual_end_date:    { type: 'date',           notNull: false },
    site_address:       { type: 'text',           notNull: false },
    project_manager_id: { type: 'uuid',           notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    idempotency_key:    { type: 'uuid',           notNull: true,  unique: true },
    last_modified_at:   { type: 'timestamptz',    notNull: true,  default: pgm.func('now()') },
    last_modified_by:   { type: 'uuid',           notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    created_at:         { type: 'timestamptz',    notNull: true,  default: pgm.func('now()') },
    updated_at:         { type: 'timestamptz',    notNull: true,  default: pgm.func('now()') },
  });

  pgm.createIndex('jabco_projects', 'tenant_id',        { name: 'idx_jabco_proj_tenant' });
  pgm.createIndex('jabco_projects', 'status',           { name: 'idx_jabco_proj_status' });
  pgm.createIndex('jabco_projects', 'project_code',     { name: 'idx_jabco_proj_code', unique: true });
  pgm.createIndex('jabco_projects', 'idempotency_key',  { name: 'idx_jabco_proj_idempotency', unique: true });
  pgm.createIndex('jabco_projects', 'last_modified_at', { name: 'idx_jabco_proj_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE jabco_projects IS
    'RLS: tenant_id. Offline sync supported — foremen access project data offline. Financial amounts in TTD by default; multi-currency for government contracts.';

    ALTER TABLE jabco_projects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE jabco_projects FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON jabco_projects
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── jabco_boq_items ──────────────────────────────────────────────────────────

  pgm.createTable('jabco_boq_items', {
    id:               { type: 'uuid',       primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:        { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    project_id:       { type: 'uuid',       notNull: true },
    section:          { type: 'varchar',    notNull: true,  comment: 'e.g. Earthworks, Concrete Works, Drainage' },
    item_number:      { type: 'varchar',    notNull: false, comment: 'BOQ line item reference number' },
    description:      { type: 'text',       notNull: true },
    unit:             { type: 'varchar',    notNull: true,  comment: 'e.g. m3, m2, lm, sum, item' },
    quantity_budgeted:{ type: 'numeric',    notNull: true },
    unit_rate:        { type: 'numeric',    notNull: true },
    amount_budgeted:  { type: 'numeric',    notNull: true,  comment: 'quantity_budgeted x unit_rate — denormalised for reporting' },
    quantity_actual:  { type: 'numeric',    notNull: true,  default: 0 },
    amount_actual:    { type: 'numeric',    notNull: true,  default: 0 },
    last_modified_at: { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    created_at:       { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    updated_at:       { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('jabco_boq_items', 'jabco_boq_items_project_id_fkey', {
    foreignKeys: { columns: 'project_id', references: 'jabco_projects(id)' },
  });

  pgm.createIndex('jabco_boq_items', 'tenant_id',  { name: 'idx_boq_tenant' });
  pgm.createIndex('jabco_boq_items', 'project_id', { name: 'idx_boq_project' });

  pgm.sql(`
    COMMENT ON TABLE jabco_boq_items IS 'RLS: tenant_id.';

    ALTER TABLE jabco_boq_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE jabco_boq_items FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON jabco_boq_items
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── jabco_variation_orders ───────────────────────────────────────────────────

  pgm.createTable('jabco_variation_orders', {
    id:              { type: 'uuid',       primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:       { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    project_id:      { type: 'uuid',       notNull: true },
    vo_number:       { type: 'varchar',    notNull: true },
    description:     { type: 'text',       notNull: true },
    status:          { type: 'vo_status',  notNull: true,  default: 'PENDING' },
    amount:          { type: 'numeric',    notNull: true },
    currency:        { type: 'varchar(3)', notNull: true,  default: 'TTD' },
    submitted_date:  { type: 'date',       notNull: false },
    approved_date:   { type: 'date',       notNull: false },
    approved_by:     { type: 'uuid',       notNull: false, comment: 'cross-db ref: jag_core.users.id' },
    idempotency_key: { type: 'uuid',       notNull: true,  unique: true },
    last_modified_at:{ type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    created_at:      { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    updated_at:      { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('jabco_variation_orders', 'jabco_variation_orders_project_id_fkey', {
    foreignKeys: { columns: 'project_id', references: 'jabco_projects(id)' },
  });

  pgm.createIndex('jabco_variation_orders', 'tenant_id',       { name: 'idx_vo_tenant' });
  pgm.createIndex('jabco_variation_orders', 'project_id',      { name: 'idx_vo_project' });
  pgm.createIndex('jabco_variation_orders', 'status',          { name: 'idx_vo_status' });
  pgm.createIndex('jabco_variation_orders', 'idempotency_key', { name: 'idx_vo_idempotency', unique: true });

  pgm.sql(`
    COMMENT ON TABLE jabco_variation_orders IS 'RLS: tenant_id.';

    ALTER TABLE jabco_variation_orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE jabco_variation_orders FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON jabco_variation_orders
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── jabco_progress_claims ────────────────────────────────────────────────────

  pgm.createTable('jabco_progress_claims', {
    id:               { type: 'uuid',         primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:        { type: 'uuid',         notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    project_id:       { type: 'uuid',         notNull: true },
    claim_number:     { type: 'integer',      notNull: true },
    period_from:      { type: 'date',         notNull: true },
    period_to:        { type: 'date',         notNull: true },
    amount_claimed:   { type: 'numeric',      notNull: true },
    amount_certified: { type: 'numeric',      notNull: false },
    status:           { type: 'claim_status', notNull: true,  default: 'DRAFT' },
    submitted_date:   { type: 'date',         notNull: false },
    certified_date:   { type: 'date',         notNull: false },
    paid_date:        { type: 'date',         notNull: false },
    idempotency_key:  { type: 'uuid',         notNull: true,  unique: true },
    last_modified_at: { type: 'timestamptz',  notNull: true,  default: pgm.func('now()') },
    created_at:       { type: 'timestamptz',  notNull: true,  default: pgm.func('now()') },
    updated_at:       { type: 'timestamptz',  notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('jabco_progress_claims', 'jabco_progress_claims_project_id_fkey', {
    foreignKeys: { columns: 'project_id', references: 'jabco_projects(id)' },
  });

  pgm.createIndex('jabco_progress_claims', 'tenant_id',       { name: 'idx_claims_tenant' });
  pgm.createIndex('jabco_progress_claims', 'project_id',      { name: 'idx_claims_project' });
  pgm.createIndex('jabco_progress_claims', 'status',          { name: 'idx_claims_status' });
  pgm.createIndex('jabco_progress_claims', 'idempotency_key', { name: 'idx_claims_idempotency', unique: true });

  pgm.sql(`
    COMMENT ON TABLE jabco_progress_claims IS
    'RLS: tenant_id. Financial write — idempotency_key required (STD-11).';

    ALTER TABLE jabco_progress_claims ENABLE ROW LEVEL SECURITY;
    ALTER TABLE jabco_progress_claims FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON jabco_progress_claims
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── jabco_payment_certificates ───────────────────────────────────────────────

  pgm.createTable('jabco_payment_certificates', {
    id:                  { type: 'uuid',       primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:           { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    progress_claim_id:   { type: 'uuid',       notNull: true },
    certificate_number:  { type: 'varchar',    notNull: true },
    amount_certified:    { type: 'numeric',    notNull: true },
    issued_date:         { type: 'date',       notNull: true },
    due_date:            { type: 'date',       notNull: false },
    paid_date:           { type: 'date',       notNull: false },
    idempotency_key:     { type: 'uuid',       notNull: true,  unique: true },
    created_at:          { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    updated_at:          { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('jabco_payment_certificates', 'jabco_payment_certificates_progress_claim_id_fkey', {
    foreignKeys: { columns: 'progress_claim_id', references: 'jabco_progress_claims(id)' },
  });

  pgm.createIndex('jabco_payment_certificates', 'tenant_id',         { name: 'idx_pc_tenant' });
  pgm.createIndex('jabco_payment_certificates', 'progress_claim_id', { name: 'idx_pc_claim' });
  pgm.createIndex('jabco_payment_certificates', 'idempotency_key',   { name: 'idx_pc_idempotency', unique: true });

  pgm.sql(`
    COMMENT ON TABLE jabco_payment_certificates IS 'RLS: tenant_id.';

    ALTER TABLE jabco_payment_certificates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE jabco_payment_certificates FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON jabco_payment_certificates
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── jabco_subcontractor_retention ────────────────────────────────────────────

  pgm.createTable('jabco_subcontractor_retention', {
    id:                       { type: 'uuid',             primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:                { type: 'uuid',             notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    project_id:               { type: 'uuid',             notNull: true },
    subcontractor_name:       { type: 'varchar',          notNull: true },
    subcontractor_contact:    { type: 'varchar',          notNull: false },
    contract_amount:          { type: 'numeric',          notNull: true },
    retention_percentage:     { type: 'numeric',          notNull: true,  default: 5.00 },
    retention_amount_held:    { type: 'numeric',          notNull: true },
    retention_released:       { type: 'numeric',          notNull: true,  default: 0 },
    release_condition:        { type: 'varchar',          notNull: true,  comment: 'PRACTICAL_COMPLETION | DEFECTS_LIABILITY_EXPIRY' },
    defects_liability_expiry: { type: 'date',             notNull: false },
    status:                   { type: 'retention_status', notNull: true,  default: 'HOLDING' },
    idempotency_key:          { type: 'uuid',             notNull: true,  unique: true },
    last_modified_at:         { type: 'timestamptz',      notNull: true,  default: pgm.func('now()') },
    created_at:               { type: 'timestamptz',      notNull: true,  default: pgm.func('now()') },
    updated_at:               { type: 'timestamptz',      notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('jabco_subcontractor_retention', 'jabco_subcontractor_retention_project_id_fkey', {
    foreignKeys: { columns: 'project_id', references: 'jabco_projects(id)' },
  });

  pgm.createIndex('jabco_subcontractor_retention', 'tenant_id',               { name: 'idx_retention_tenant' });
  pgm.createIndex('jabco_subcontractor_retention', 'project_id',              { name: 'idx_retention_project' });
  pgm.createIndex('jabco_subcontractor_retention', 'defects_liability_expiry',{ name: 'idx_retention_dl_expiry' });
  pgm.createIndex('jabco_subcontractor_retention', 'idempotency_key',         { name: 'idx_retention_idempotency', unique: true });

  pgm.sql(`
    COMMENT ON TABLE jabco_subcontractor_retention IS
    'RLS: tenant_id. Financial write — idempotency_key required (STD-11).';

    ALTER TABLE jabco_subcontractor_retention ENABLE ROW LEVEL SECURITY;
    ALTER TABLE jabco_subcontractor_retention FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON jabco_subcontractor_retention
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── jabco_site_diary ─────────────────────────────────────────────────────────
  // OFFLINE-CRITICAL: mobile PWA foreman app writes here. sync_status tracks pending-sync.

  pgm.createTable('jabco_site_diary', {
    id:                   { type: 'uuid',        primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:            { type: 'uuid',        notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    project_id:           { type: 'uuid',        notNull: true },
    foreman_id:           { type: 'uuid',        notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    entry_date:           { type: 'date',        notNull: true },
    weather:              { type: 'varchar',     notNull: false },
    workers_on_site:      { type: 'integer',     notNull: false },
    activities_completed: { type: 'text',        notNull: false },
    materials_received:   { type: 'text',        notNull: false },
    equipment_on_site:    { type: 'text',        notNull: false },
    instructions_received:{ type: 'text',        notNull: false },
    issues_noted:         { type: 'text',        notNull: false },
    photos:               { type: 'jsonb',       notNull: false, comment: 'Array of MinIO storage paths' },
    sync_status:          { type: 'sync_status', notNull: true,  default: 'SYNCED' },
    last_modified_at:     { type: 'timestamptz', notNull: true,  default: pgm.func('now()') },
    last_modified_by:     { type: 'uuid',        notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    created_at:           { type: 'timestamptz', notNull: true,  default: pgm.func('now()') },
    updated_at:           { type: 'timestamptz', notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('jabco_site_diary', 'jabco_site_diary_project_id_fkey', {
    foreignKeys: { columns: 'project_id', references: 'jabco_projects(id)' },
  });

  pgm.createIndex('jabco_site_diary', 'tenant_id',        { name: 'idx_diary_tenant' });
  pgm.createIndex('jabco_site_diary', 'project_id',       { name: 'idx_diary_project' });
  pgm.createIndex('jabco_site_diary', 'foreman_id',       { name: 'idx_diary_foreman' });
  pgm.createIndex('jabco_site_diary', 'entry_date',       { name: 'idx_diary_date' });
  pgm.createIndex('jabco_site_diary', 'sync_status',      { name: 'idx_diary_sync_status' });
  pgm.createIndex('jabco_site_diary', 'last_modified_at', { name: 'idx_diary_last_modified' });

  pgm.sql(`
    COMMENT ON TABLE jabco_site_diary IS
    'RLS: tenant_id. OFFLINE-CRITICAL: sync_status tracks pending-sync records. Conflicts route to Conflict Review queue — non-conflicting updates auto-merge. Mobile PWA foreman app writes here.';

    ALTER TABLE jabco_site_diary ENABLE ROW LEVEL SECURITY;
    ALTER TABLE jabco_site_diary FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON jabco_site_diary
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── jabco_project_gantt ──────────────────────────────────────────────────────
  // Self-referential FK on predecessor_id added after table creation.

  pgm.createTable('jabco_project_gantt', {
    id:                    { type: 'uuid',       primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:             { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    project_id:            { type: 'uuid',       notNull: true },
    task_name:             { type: 'varchar',    notNull: true },
    planned_start:         { type: 'date',       notNull: true },
    planned_end:           { type: 'date',       notNull: true },
    actual_start:          { type: 'date',       notNull: false },
    actual_end:            { type: 'date',       notNull: false },
    predecessor_id:        { type: 'uuid',       notNull: false, comment: 'Self-ref for task dependencies' },
    completion_percentage: { type: 'numeric',    notNull: true,  default: 0 },
    last_modified_at:      { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    created_at:            { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    updated_at:            { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('jabco_project_gantt', 'jabco_project_gantt_project_id_fkey', {
    foreignKeys: { columns: 'project_id', references: 'jabco_projects(id)' },
  });
  pgm.addConstraint('jabco_project_gantt', 'jabco_project_gantt_predecessor_id_fkey', {
    foreignKeys: { columns: 'predecessor_id', references: 'jabco_project_gantt(id)' },
  });

  pgm.createIndex('jabco_project_gantt', 'tenant_id',      { name: 'idx_gantt_tenant' });
  pgm.createIndex('jabco_project_gantt', 'project_id',     { name: 'idx_gantt_project' });
  pgm.createIndex('jabco_project_gantt', 'predecessor_id', { name: 'idx_gantt_predecessor' });

  pgm.sql(`
    COMMENT ON TABLE jabco_project_gantt IS 'RLS: tenant_id.';

    ALTER TABLE jabco_project_gantt ENABLE ROW LEVEL SECURITY;
    ALTER TABLE jabco_project_gantt FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON jabco_project_gantt
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ════════════════════════════════════════════════════════════════════════════
  // CRM — CONTACT AND SALES MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  // ── crm_companies ────────────────────────────────────────────────────────────

  pgm.createTable('crm_companies', {
    id:               { type: 'uuid',       primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:        { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    name:             { type: 'varchar',    notNull: true },
    industry:         { type: 'varchar',    notNull: false },
    country:          { type: 'varchar',    notNull: true,  default: 'TT' },
    phone:            { type: 'varchar',    notNull: false },
    email:            { type: 'varchar',    notNull: false },
    website:          { type: 'varchar',    notNull: false },
    notes:            { type: 'text',       notNull: false },
    last_modified_at: { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    created_at:       { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    updated_at:       { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
  });

  pgm.createIndex('crm_companies', 'tenant_id', { name: 'idx_crm_companies_tenant' });

  pgm.sql(`
    COMMENT ON TABLE crm_companies IS
    'RLS: tenant_id. Shared master record for JABCO clients, DragonBridge partners, and potential acquisitions.';

    ALTER TABLE crm_companies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE crm_companies FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON crm_companies
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── crm_contacts ─────────────────────────────────────────────────────────────

  pgm.createTable('crm_contacts', {
    id:                 { type: 'uuid',       primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:          { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    company_id:         { type: 'uuid',       notNull: false },
    first_name:         { type: 'varchar',    notNull: true },
    last_name:          { type: 'varchar',    notNull: true },
    email:              { type: 'varchar',    notNull: false },
    phone:              { type: 'varchar',    notNull: false },
    role:               { type: 'varchar',    notNull: false, comment: 'e.g. Project Manager, Procurement Officer, Director' },
    preferred_language: { type: 'varchar(5)', notNull: true,  default: 'en' },
    loyalty_member_id:  { type: 'uuid',       notNull: false, comment: 'cross-db ref: jag_family.fam_loyalty_programmes.id — JAG Lifestyle integration point (logical reference, no DB-level FK)' },
    notes:              { type: 'text',       notNull: false },
    last_modified_at:   { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    created_at:         { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    updated_at:         { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('crm_contacts', 'crm_contacts_company_id_fkey', {
    foreignKeys: { columns: 'company_id', references: 'crm_companies(id)' },
  });

  pgm.createIndex('crm_contacts', 'tenant_id',  { name: 'idx_crm_contacts_tenant' });
  pgm.createIndex('crm_contacts', 'company_id', { name: 'idx_crm_contacts_company' });
  pgm.createIndex('crm_contacts', 'email',      { name: 'idx_crm_contacts_email' });

  pgm.sql(`
    COMMENT ON TABLE crm_contacts IS 'RLS: tenant_id.';

    ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE crm_contacts FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON crm_contacts
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── crm_interactions ─────────────────────────────────────────────────────────

  pgm.createTable('crm_interactions', {
    id:               { type: 'uuid',       primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:        { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    contact_id:       { type: 'uuid',       notNull: true },
    user_id:          { type: 'uuid',       notNull: true,  comment: 'cross-db ref: jag_core.users.id — who logged this' },
    interaction_type: { type: 'varchar',    notNull: true,  comment: 'CALL | EMAIL | MEETING | SITE_VISIT | OTHER' },
    subject:          { type: 'varchar',    notNull: true },
    notes:            { type: 'text',       notNull: false },
    occurred_at:      { type: 'timestamptz',notNull: true },
    follow_up_date:   { type: 'date',       notNull: false },
    created_at:       { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
    updated_at:       { type: 'timestamptz',notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('crm_interactions', 'crm_interactions_contact_id_fkey', {
    foreignKeys: { columns: 'contact_id', references: 'crm_contacts(id)' },
  });

  pgm.createIndex('crm_interactions', 'tenant_id',    { name: 'idx_crm_inter_tenant' });
  pgm.createIndex('crm_interactions', 'contact_id',   { name: 'idx_crm_inter_contact' });
  pgm.createIndex('crm_interactions', 'occurred_at',  { name: 'idx_crm_inter_occurred_at' });
  pgm.createIndex('crm_interactions', 'follow_up_date',{ name: 'idx_crm_inter_follow_up' });

  pgm.sql(`
    COMMENT ON TABLE crm_interactions IS 'RLS: tenant_id.';

    ALTER TABLE crm_interactions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE crm_interactions FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON crm_interactions
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);


  // ── crm_sales_pipeline ───────────────────────────────────────────────────────

  pgm.createTable('crm_sales_pipeline', {
    id:                  { type: 'uuid',           primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:           { type: 'uuid',           notNull: true,  comment: 'cross-db ref: jag_core.tenants.id' },
    contact_id:          { type: 'uuid',           notNull: false },
    company_id:          { type: 'uuid',           notNull: false },
    title:               { type: 'varchar',        notNull: true },
    stage:               { type: 'pipeline_stage', notNull: true,  default: 'LEAD' },
    estimated_value:     { type: 'numeric',        notNull: false },
    currency:            { type: 'varchar(3)',      notNull: true,  default: 'TTD' },
    probability_percent: { type: 'integer',        notNull: false },
    expected_close_date: { type: 'date',           notNull: false },
    assigned_to:         { type: 'uuid',           notNull: true,  comment: 'cross-db ref: jag_core.users.id' },
    notes:               { type: 'text',           notNull: false },
    idempotency_key:     { type: 'uuid',           notNull: true,  unique: true },
    last_modified_at:    { type: 'timestamptz',    notNull: true,  default: pgm.func('now()') },
    created_at:          { type: 'timestamptz',    notNull: true,  default: pgm.func('now()') },
    updated_at:          { type: 'timestamptz',    notNull: true,  default: pgm.func('now()') },
  });

  pgm.addConstraint('crm_sales_pipeline', 'crm_sales_pipeline_contact_id_fkey', {
    foreignKeys: { columns: 'contact_id', references: 'crm_contacts(id)' },
  });
  pgm.addConstraint('crm_sales_pipeline', 'crm_sales_pipeline_company_id_fkey', {
    foreignKeys: { columns: 'company_id', references: 'crm_companies(id)' },
  });

  pgm.createIndex('crm_sales_pipeline', 'tenant_id',       { name: 'idx_pipeline_tenant' });
  pgm.createIndex('crm_sales_pipeline', 'stage',           { name: 'idx_pipeline_stage' });
  pgm.createIndex('crm_sales_pipeline', 'assigned_to',     { name: 'idx_pipeline_assigned' });
  pgm.createIndex('crm_sales_pipeline', 'idempotency_key', { name: 'idx_pipeline_idempotency', unique: true });

  pgm.sql(`
    COMMENT ON TABLE crm_sales_pipeline IS
    'RLS: tenant_id. Used for JABCO construction tendering and DragonBridge deal tracking. DragonBridge sub-architecture session required before Phase 3.';

    ALTER TABLE crm_sales_pipeline ENABLE ROW LEVEL SECURITY;
    ALTER TABLE crm_sales_pipeline FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON crm_sales_pipeline
      USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  `);
}


export async function down(pgm: MigrationBuilder): Promise<void> {
  // CRM — drop children before parents
  pgm.dropTable('crm_sales_pipeline');
  pgm.dropTable('crm_interactions');
  pgm.dropTable('crm_contacts');
  pgm.dropTable('crm_companies');

  // JABCO — drop children before parents
  pgm.dropTable('jabco_project_gantt');
  pgm.dropTable('jabco_site_diary');
  pgm.dropTable('jabco_subcontractor_retention');
  pgm.dropTable('jabco_payment_certificates');
  pgm.dropTable('jabco_progress_claims');
  pgm.dropTable('jabco_variation_orders');
  pgm.dropTable('jabco_boq_items');
  pgm.dropTable('jabco_projects');

  // IMS — drop children before parents
  pgm.dropTable('ims_stock_movements');
  pgm.dropTable('ims_photos');
  pgm.dropTable('ims_barcodes');
  pgm.dropTable('ims_item_tags');
  pgm.dropTable('ims_vehicles');
  pgm.dropTable('ims_items');
  pgm.dropTable('ims_tags');
  pgm.dropTable('ims_categories');
  pgm.dropTable('ims_locations');

  pgm.dropType('sync_status');
  pgm.dropType('pipeline_stage');
  pgm.dropType('retention_status');
  pgm.dropType('claim_status');
  pgm.dropType('vo_status');
  pgm.dropType('project_status');
  pgm.dropType('vehicle_type');
  pgm.dropType('movement_type');
  pgm.dropType('item_condition');
}
