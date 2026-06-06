-- DragonBridge schema: China sourcing, forex, logistics, Caribbean last-mile delivery.
-- JAG role is per-order: AGENT (buying agent, pass-through costs + fee) or
-- IMPORTER (importer of record, full landed cost + margin).
-- Landed cost is estimated at quote time (FX snapshot) and reconciled on arrival.
-- STD-13 Expand-and-Contract: all new tables, no existing tables modified.

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE db_jag_role AS ENUM ('AGENT', 'IMPORTER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE db_client_type AS ENUM ('B2B', 'B2C');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE db_quote_status AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE db_order_status AS ENUM (
    'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP',
    'IN_TRANSIT', 'CUSTOMS', 'DELIVERED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE db_shipment_status AS ENUM ('BOOKING', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'CLEARED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE db_reconciliation_status AS ENUM (
    'PENDING', 'AUTO_CLOSED', 'PENDING_REVIEW', 'APPROVED', 'INVOICED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE db_delivery_status AS ENUM (
    'SCHEDULED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE db_invoice_type AS ENUM ('DEPOSIT', 'FINAL', 'AGENCY_FEE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE db_invoice_status AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Config ────────────────────────────────────────────────────────────────────
-- One row per tenant. Industry norm defaults: 30% deposit, 5% variance threshold.
-- balance_trigger: PRE_DELIVERY = balance collected before driver dispatched.

CREATE TABLE IF NOT EXISTS db_config (
  id                            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     UUID         NOT NULL UNIQUE,
  deposit_pct_default           NUMERIC(5,2) NOT NULL DEFAULT 30.00
                                CHECK (deposit_pct_default > 0 AND deposit_pct_default < 100),
  balance_trigger               VARCHAR(15)  NOT NULL DEFAULT 'PRE_DELIVERY'
                                CHECK (balance_trigger IN ('PRE_DELIVERY', 'ON_DELIVERY')),
  variance_threshold_pct        NUMERIC(5,2) NOT NULL DEFAULT 5.00
                                CHECK (variance_threshold_pct >= 0),
  default_vat_pct               NUMERIC(5,2) NOT NULL DEFAULT 12.50
                                CHECK (default_vat_pct >= 0),
  -- AGENT mode: fee charged as % of total landed cost (post-duty, post-VAT, excl delivery).
  -- JAG covers full order-to-door workflow; not just FOB like a China sourcing agent.
  agency_fee_pct                NUMERIC(5,2) NOT NULL DEFAULT 5.00
                                CHECK (agency_fee_pct >= 0),
  -- Determines how actual freight is split across orders in a shared container.
  -- CBM: by gross cubic volume (default — matches LCL/FCL billing method).
  -- VALUE: by supplier cost TTD (fallback when CBM data is absent).
  -- EQUAL: equal split regardless of size or value.
  freight_apportionment_method  VARCHAR(10)  NOT NULL DEFAULT 'CBM'
                                CHECK (freight_apportionment_method IN ('CBM', 'VALUE', 'EQUAL')),
  updated_at                    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by                    UUID
);

ALTER TABLE db_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON db_config
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

INSERT INTO db_config (tenant_id)
VALUES ('00000000-0000-0000-0001-000000000008')
ON CONFLICT (tenant_id) DO NOTHING;

-- ── Pricing tiers ─────────────────────────────────────────────────────────────
-- Default margin per tier; overridable at the individual quote level.

CREATE TABLE IF NOT EXISTS db_pricing_tiers (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID         NOT NULL,
  name               VARCHAR(50)  NOT NULL,
  default_margin_pct NUMERIC(5,2) NOT NULL CHECK (default_margin_pct >= 0),
  description        TEXT,
  is_active          BOOLEAN      NOT NULL DEFAULT true,
  created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE db_pricing_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON db_pricing_tiers
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
CREATE INDEX IF NOT EXISTS idx_db_pricing_tiers_tenant ON db_pricing_tiers(tenant_id);

INSERT INTO db_pricing_tiers (tenant_id, name, default_margin_pct, description) VALUES
  ('00000000-0000-0000-0001-000000000008', 'B2C_STANDARD', 25.00, 'Standard retail margin'),
  ('00000000-0000-0000-0001-000000000008', 'B2B_STANDARD', 15.00, 'Standard wholesale margin'),
  ('00000000-0000-0000-0001-000000000008', 'B2B_VIP',      10.00, 'Key account wholesale margin')
ON CONFLICT (tenant_id, name) DO NOTHING;

-- ── Suppliers ─────────────────────────────────────────────────────────────────
-- China-based supply partners. Currency CNY by default.
-- last_modified_at + last_modified_by: STD offline conflict resolution for master records.

CREATE TABLE IF NOT EXISTS db_suppliers (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID         NOT NULL,
  name             VARCHAR(200) NOT NULL,
  contact_name     VARCHAR(100),
  contact_email    VARCHAR(200),
  contact_phone    VARCHAR(50),
  address          TEXT,
  currency         CHAR(3)      NOT NULL DEFAULT 'CNY',
  payment_terms    TEXT,
  notes            TEXT,
  is_active        BOOLEAN      NOT NULL DEFAULT true,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_modified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_modified_by UUID
);

ALTER TABLE db_suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON db_suppliers
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
CREATE INDEX IF NOT EXISTS idx_db_suppliers_tenant ON db_suppliers(tenant_id);

-- ── Products ──────────────────────────────────────────────────────────────────
-- duty_rate is the applicable T&T customs rate for this HS code (decimal: 0.20 = 20%).
-- All fields are snapshotted at quote time — edits here never affect existing quotes.

CREATE TABLE IF NOT EXISTS db_products (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID          NOT NULL,
  supplier_id      UUID          NOT NULL REFERENCES db_suppliers(id),
  name             VARCHAR(200)  NOT NULL,
  description      TEXT,
  hs_code          VARCHAR(10)   NOT NULL,
  unit_cost_cny    NUMERIC(14,4) NOT NULL CHECK (unit_cost_cny > 0),
  unit             VARCHAR(20)   NOT NULL DEFAULT 'EACH',
  duty_rate        NUMERIC(6,4)  NOT NULL DEFAULT 0
                   CHECK (duty_rate >= 0 AND duty_rate <= 1),
  notes            TEXT,
  is_active        BOOLEAN       NOT NULL DEFAULT true,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_modified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_modified_by UUID
);

ALTER TABLE db_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON db_products
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
CREATE INDEX IF NOT EXISTS idx_db_products_tenant   ON db_products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_db_products_supplier ON db_products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_db_products_hs       ON db_products(hs_code);

-- ── Clients ───────────────────────────────────────────────────────────────────
-- B2B (businesses/resellers) and B2C (end consumers).
-- pricing_tier_id sets the default margin; overridable per quote.

CREATE TABLE IF NOT EXISTS db_clients (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID           NOT NULL,
  client_type      db_client_type NOT NULL,
  name             VARCHAR(200)   NOT NULL,
  company_name     VARCHAR(200),
  contact_name     VARCHAR(100),
  contact_email    VARCHAR(200),
  contact_phone    VARCHAR(50),
  address          TEXT,
  pricing_tier_id  UUID           REFERENCES db_pricing_tiers(id),
  notes            TEXT,
  is_active        BOOLEAN        NOT NULL DEFAULT true,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_modified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_modified_by UUID
);

ALTER TABLE db_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON db_clients
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
CREATE INDEX IF NOT EXISTS idx_db_clients_tenant ON db_clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_db_clients_type   ON db_clients(client_type);

-- ── Quotes ────────────────────────────────────────────────────────────────────
-- fx_cny_usd and fx_usd_ttd are snapshots at creation — the client's quoted price
-- is locked to these rates regardless of later market movements.
-- margin_pct: when set, overrides the client's pricing tier default.
-- AGENT mode: agency_fee_pct snapshots from db_config at quote creation (overridable).
--   est_agency_fee_ttd is computed (Σ item_landed_cost × agency_fee_pct / 100); stored after recalc.
--   margin_pct must be NULL in AGENT mode.
-- IMPORTER mode: margin_pct applied to (Σ item_landed_cost + local_delivery).
--   agency_fee_pct must be NULL in IMPORTER mode.
-- est_total_ttd: computed and stored by the application at quote generation time.

CREATE TABLE IF NOT EXISTS db_quotes (
  id                     UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID            NOT NULL,
  client_id              UUID            NOT NULL REFERENCES db_clients(id),
  jag_role               db_jag_role     NOT NULL,
  status                 db_quote_status NOT NULL DEFAULT 'DRAFT',
  margin_pct             NUMERIC(5,2)    CHECK (margin_pct >= 0),
  fx_cny_usd             NUMERIC(12,6)   NOT NULL CHECK (fx_cny_usd > 0),
  fx_usd_ttd             NUMERIC(12,6)   NOT NULL CHECK (fx_usd_ttd > 0),
  est_freight_usd        NUMERIC(14,2)   NOT NULL DEFAULT 0 CHECK (est_freight_usd >= 0),
  est_insurance_usd      NUMERIC(14,2)   NOT NULL DEFAULT 0 CHECK (est_insurance_usd >= 0),
  est_local_delivery_ttd NUMERIC(14,2)   NOT NULL DEFAULT 0 CHECK (est_local_delivery_ttd >= 0),
  agency_fee_pct         NUMERIC(5,2)    CHECK (agency_fee_pct >= 0),
  est_agency_fee_ttd     NUMERIC(14,2)   NOT NULL DEFAULT 0 CHECK (est_agency_fee_ttd >= 0),
  est_total_ttd          NUMERIC(16,2)   NOT NULL DEFAULT 0,
  notes                  TEXT,
  valid_until            DATE,
  created_by             UUID            NOT NULL,
  created_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE db_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON db_quotes
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
CREATE INDEX IF NOT EXISTS idx_db_quotes_tenant ON db_quotes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_db_quotes_client ON db_quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_db_quotes_status ON db_quotes(status);

-- ── Quote items ───────────────────────────────────────────────────────────────
-- Product fields are snapshotted at quote creation so master edits never alter quotes.
-- All TTD cost fields are computed and stored by the application.
-- Landed cost formula per item:
--   supplier_cost_ttd = qty × unit_cost_cny ÷ fx_cny_usd ÷ fx_usd_ttd
--   cif_share_ttd     = supplier_cost_ttd + proportional freight + insurance (converted)
--   duty_ttd          = cif_share_ttd × duty_rate
--   vat_ttd           = (cif_share_ttd + duty_ttd) × vat_pct
--   margin_ttd        = (supplier_cost + duty + vat + delivery_share) × margin_pct
--   est_landed_cost_ttd = all of the above + est_local_delivery share

CREATE TABLE IF NOT EXISTS db_quote_items (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id            UUID          NOT NULL REFERENCES db_quotes(id) ON DELETE CASCADE,
  product_id          UUID          REFERENCES db_products(id),
  product_name        VARCHAR(200)  NOT NULL,
  hs_code             VARCHAR(10)   NOT NULL,
  unit_cost_cny       NUMERIC(14,4) NOT NULL CHECK (unit_cost_cny > 0),
  duty_rate           NUMERIC(6,4)  NOT NULL CHECK (duty_rate >= 0 AND duty_rate <= 1),
  qty                 NUMERIC(12,3) NOT NULL CHECK (qty > 0),
  unit                VARCHAR(20)   NOT NULL,
  -- gross_volume_cbm: total CBM for this line (qty × volume per unit).
  -- Used for freight apportionment when method = 'CBM'. NULL falls back to VALUE method.
  gross_volume_cbm    NUMERIC(10,4) CHECK (gross_volume_cbm > 0),
  est_duty_ttd        NUMERIC(14,2) NOT NULL DEFAULT 0,
  est_vat_ttd         NUMERIC(14,2) NOT NULL DEFAULT 0,
  est_landed_cost_ttd NUMERIC(16,2) NOT NULL DEFAULT 0,
  notes               TEXT
);

ALTER TABLE db_quote_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON db_quote_items
  USING (
    quote_id IN (
      SELECT id FROM db_quotes
      WHERE tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid
    )
  );
CREATE INDEX IF NOT EXISTS idx_db_quote_items_quote ON db_quote_items(quote_id);

-- ── Orders ────────────────────────────────────────────────────────────────────
-- Created when a quote moves to ACCEPTED status. One order per quote (UNIQUE).
-- deposit_pct is snapshotted from db_config at order time — config changes don't
-- retroactively alter existing orders.

CREATE TABLE IF NOT EXISTS db_orders (
  id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID            NOT NULL,
  quote_id                UUID            NOT NULL UNIQUE REFERENCES db_quotes(id),
  client_id               UUID            NOT NULL REFERENCES db_clients(id),
  jag_role                db_jag_role     NOT NULL,
  status                  db_order_status NOT NULL DEFAULT 'CONFIRMED',
  deposit_pct             NUMERIC(5,2)    NOT NULL CHECK (deposit_pct > 0 AND deposit_pct < 100),
  deposit_amount_ttd      NUMERIC(16,2)   NOT NULL CHECK (deposit_amount_ttd >= 0),
  deposit_paid_at         TIMESTAMP WITH TIME ZONE,
  deposit_idempotency_key UUID            UNIQUE,
  quoted_total_ttd        NUMERIC(16,2)   NOT NULL,
  notes                   TEXT,
  created_by              UUID            NOT NULL,
  created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE db_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON db_orders
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
CREATE INDEX IF NOT EXISTS idx_db_orders_tenant ON db_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_db_orders_client ON db_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_db_orders_status ON db_orders(status);
CREATE INDEX IF NOT EXISTS idx_db_orders_quote  ON db_orders(quote_id);
CREATE INDEX IF NOT EXISTS idx_db_orders_dep_idem ON db_orders(deposit_idempotency_key);

-- ── Shipments ─────────────────────────────────────────────────────────────────
-- One shipment = one container/vessel movement. Multiple orders may share a shipment.
-- actual_freight_usd and actual_insurance_usd are set on arrival and drive reconciliation.

CREATE TABLE IF NOT EXISTS db_shipments (
  id                   UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID               NOT NULL,
  container_ref        VARCHAR(50),
  vessel_name          VARCHAR(200),
  port_of_origin       VARCHAR(100)       NOT NULL DEFAULT 'SHANGHAI',
  port_of_destination  VARCHAR(100)       NOT NULL DEFAULT 'PORT OF SPAIN',
  etd                  DATE,
  eta                  DATE,
  atd                  DATE,
  ata                  DATE,
  status               db_shipment_status NOT NULL DEFAULT 'BOOKING',
  actual_freight_usd   NUMERIC(14,2)      CHECK (actual_freight_usd >= 0),
  actual_insurance_usd NUMERIC(14,2)      CHECK (actual_insurance_usd >= 0),
  freight_forwarder    VARCHAR(200),
  notes                TEXT,
  created_by           UUID               NOT NULL,
  created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE db_shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON db_shipments
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
CREATE INDEX IF NOT EXISTS idx_db_shipments_tenant ON db_shipments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_db_shipments_status ON db_shipments(status);

-- ── Order → Shipment assignments ──────────────────────────────────────────────
-- freight_share_pct: this order's portion of total shipment freight cost.
-- NULL until freight is known and apportioned (apportionment method TBD in design session).

CREATE TABLE IF NOT EXISTS db_order_shipments (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID         NOT NULL REFERENCES db_orders(id),
  shipment_id       UUID         NOT NULL REFERENCES db_shipments(id),
  freight_share_pct NUMERIC(7,4) CHECK (freight_share_pct > 0 AND freight_share_pct <= 100),
  UNIQUE (order_id, shipment_id)
);

ALTER TABLE db_order_shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON db_order_shipments
  USING (
    order_id IN (
      SELECT id FROM db_orders
      WHERE tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid
    )
  );
CREATE INDEX IF NOT EXISTS idx_db_order_shipments_order    ON db_order_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_db_order_shipments_shipment ON db_order_shipments(shipment_id);

-- ── Customs declarations ──────────────────────────────────────────────────────
-- One declaration per shipment (UNIQUE on shipment_id).
-- actual_cif_usd, actual_duty_ttd, actual_vat_ttd drive reconciliation for all orders
-- in this shipment. cleared_at timestamps when goods are released.

CREATE TABLE IF NOT EXISTS db_customs_declarations (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID         NOT NULL,
  shipment_id      UUID         NOT NULL UNIQUE REFERENCES db_shipments(id),
  declaration_ref  VARCHAR(100),
  actual_cif_usd   NUMERIC(14,2) NOT NULL CHECK (actual_cif_usd >= 0),
  actual_duty_ttd  NUMERIC(14,2) NOT NULL CHECK (actual_duty_ttd >= 0),
  actual_vat_ttd   NUMERIC(14,2) NOT NULL CHECK (actual_vat_ttd >= 0),
  cleared_at       TIMESTAMP WITH TIME ZONE,
  customs_broker   VARCHAR(200),
  notes            TEXT,
  created_by       UUID         NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE db_customs_declarations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON db_customs_declarations
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
CREATE INDEX IF NOT EXISTS idx_db_customs_tenant   ON db_customs_declarations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_db_customs_shipment ON db_customs_declarations(shipment_id);

-- ── Landed cost reconciliations ───────────────────────────────────────────────
-- One per order. Created when the order's shipment customs declaration is cleared.
-- variance_pct = (actual_total_ttd - quoted_total_ttd) / quoted_total_ttd * 100
-- AUTO_CLOSED: abs(variance_pct) < db_config.variance_threshold_pct → final invoice auto-issued.
-- PENDING_REVIEW: abs(variance_pct) >= threshold → Tier 1 alert to Robert, invoice held.
-- Client always receives a variance breakdown on the final invoice regardless of status.
-- idempotency_key prevents double-triggering from the customs cleared event.

CREATE TABLE IF NOT EXISTS db_landed_cost_reconciliations (
  id                        UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID                    NOT NULL,
  order_id                  UUID                    NOT NULL UNIQUE REFERENCES db_orders(id),
  status                    db_reconciliation_status NOT NULL DEFAULT 'PENDING',
  quoted_total_ttd          NUMERIC(16,2)           NOT NULL,
  actual_supplier_cost_ttd  NUMERIC(14,2)           NOT NULL DEFAULT 0,
  actual_freight_ttd        NUMERIC(14,2)           NOT NULL DEFAULT 0,
  actual_insurance_ttd      NUMERIC(14,2)           NOT NULL DEFAULT 0,
  actual_duty_ttd           NUMERIC(14,2)           NOT NULL DEFAULT 0,
  actual_vat_ttd            NUMERIC(14,2)           NOT NULL DEFAULT 0,
  actual_local_delivery_ttd NUMERIC(14,2)           NOT NULL DEFAULT 0,
  actual_margin_ttd         NUMERIC(14,2)           NOT NULL DEFAULT 0,
  actual_agency_fee_ttd     NUMERIC(14,2)           NOT NULL DEFAULT 0,
  actual_total_ttd          NUMERIC(16,2)           NOT NULL DEFAULT 0,
  variance_ttd              NUMERIC(16,2)           NOT NULL DEFAULT 0,
  variance_pct              NUMERIC(8,4)            NOT NULL DEFAULT 0,
  approved_by               UUID,
  approved_at               TIMESTAMP WITH TIME ZONE,
  notes                     TEXT,
  idempotency_key           UUID                    NOT NULL UNIQUE,
  created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE db_landed_cost_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON db_landed_cost_reconciliations
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
CREATE INDEX IF NOT EXISTS idx_db_recon_tenant ON db_landed_cost_reconciliations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_db_recon_order  ON db_landed_cost_reconciliations(order_id);
CREATE INDEX IF NOT EXISTS idx_db_recon_status ON db_landed_cost_reconciliations(status);
CREATE INDEX IF NOT EXISTS idx_db_recon_idem   ON db_landed_cost_reconciliations(idempotency_key);

-- ── Local deliveries ──────────────────────────────────────────────────────────
-- TT last-mile. App layer must gate dispatch on balance payment being confirmed
-- (deposit_paid_at on the order AND balance collected) before status can move to
-- OUT_FOR_DELIVERY.

CREATE TABLE IF NOT EXISTS db_local_deliveries (
  id               UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID               NOT NULL,
  order_id         UUID               NOT NULL REFERENCES db_orders(id),
  delivery_address TEXT               NOT NULL,
  contact_name     VARCHAR(100),
  contact_phone    VARCHAR(50),
  cost_ttd         NUMERIC(12,2)      NOT NULL DEFAULT 0 CHECK (cost_ttd >= 0),
  status           db_delivery_status NOT NULL DEFAULT 'SCHEDULED',
  scheduled_date   DATE,
  delivered_at     TIMESTAMP WITH TIME ZONE,
  notes            TEXT,
  idempotency_key  UUID               NOT NULL UNIQUE,
  created_by       UUID               NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE db_local_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON db_local_deliveries
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
CREATE INDEX IF NOT EXISTS idx_db_deliveries_tenant ON db_local_deliveries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_db_deliveries_order  ON db_local_deliveries(order_id);
CREATE INDEX IF NOT EXISTS idx_db_deliveries_status ON db_local_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_db_deliveries_idem   ON db_local_deliveries(idempotency_key);

-- ── Invoices ──────────────────────────────────────────────────────────────────
-- DEPOSIT: issued on order confirmation (amount = deposit_amount_ttd from order).
-- FINAL: issued after reconciliation reaches AUTO_CLOSED or APPROVED.
--   amount_ttd     = actual_total_ttd from reconciliation
--   deposit_offset = deposit already collected
--   balance_due    = amount_ttd - deposit_offset_ttd
-- AGENCY_FEE: AGENT mode only. JAG's service fee billed as a separate invoice.
-- idempotency_key prevents duplicate invoice generation from event retries.

CREATE TABLE IF NOT EXISTS db_invoices (
  id                 UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID              NOT NULL,
  order_id           UUID              NOT NULL REFERENCES db_orders(id),
  invoice_type       db_invoice_type   NOT NULL,
  status             db_invoice_status NOT NULL DEFAULT 'DRAFT',
  amount_ttd         NUMERIC(16,2)     NOT NULL CHECK (amount_ttd >= 0),
  deposit_offset_ttd NUMERIC(16,2)     NOT NULL DEFAULT 0 CHECK (deposit_offset_ttd >= 0),
  balance_due_ttd    NUMERIC(16,2)     NOT NULL CHECK (balance_due_ttd >= 0),
  issued_at          TIMESTAMP WITH TIME ZONE,
  due_date           DATE,
  paid_at            TIMESTAMP WITH TIME ZONE,
  payment_method     VARCHAR(50),
  notes              TEXT,
  idempotency_key    UUID              NOT NULL UNIQUE,
  created_by         UUID              NOT NULL,
  created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE db_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON db_invoices
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
CREATE INDEX IF NOT EXISTS idx_db_invoices_tenant ON db_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_db_invoices_order  ON db_invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_db_invoices_type   ON db_invoices(invoice_type);
CREATE INDEX IF NOT EXISTS idx_db_invoices_status ON db_invoices(status);
CREATE INDEX IF NOT EXISTS idx_db_invoices_idem   ON db_invoices(idempotency_key);
