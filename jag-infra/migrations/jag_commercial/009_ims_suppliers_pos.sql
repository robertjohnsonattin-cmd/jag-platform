-- 009_ims_suppliers_pos.sql
-- IMS: Suppliers master + Purchase Orders + PO Lines

-- ── Suppliers ─────────────────────────────────────────────────────────────────

CREATE TABLE ims_suppliers (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL,
  name                VARCHAR(200) NOT NULL,
  contact_name        VARCHAR(200),
  phone               VARCHAR(50),
  email               VARCHAR(200),
  address             TEXT,
  country_code        CHAR(2)     NOT NULL DEFAULT 'TT',
  payment_terms_days  INTEGER     NOT NULL DEFAULT 30,
  notes               TEXT,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  last_modified_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified_by    UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ims_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY ims_suppliers_rls ON ims_suppliers
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

CREATE INDEX ims_suppliers_tenant_idx ON ims_suppliers (tenant_id);
CREATE INDEX ims_suppliers_name_idx   ON ims_suppliers (name);

-- ── PO number sequence ────────────────────────────────────────────────────────

CREATE SEQUENCE ims_po_seq START 1;

-- ── Purchase Orders ───────────────────────────────────────────────────────────

CREATE TABLE ims_purchase_orders (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID        NOT NULL,
  supplier_id            UUID        NOT NULL REFERENCES ims_suppliers(id),
  po_number              VARCHAR(50) NOT NULL,
  status                 VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                           CHECK (status IN ('DRAFT','SUBMITTED','PARTIAL','RECEIVED','CANCELLED')),
  order_date             DATE        NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery_date DATE,
  notes                  TEXT,
  last_modified_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified_by       UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, po_number)
);

ALTER TABLE ims_purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY ims_purchase_orders_rls ON ims_purchase_orders
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

CREATE INDEX ims_po_tenant_idx    ON ims_purchase_orders (tenant_id);
CREATE INDEX ims_po_supplier_idx  ON ims_purchase_orders (supplier_id);
CREATE INDEX ims_po_status_idx    ON ims_purchase_orders (status);

-- ── Purchase Order Lines ──────────────────────────────────────────────────────

CREATE TABLE ims_purchase_order_lines (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID         NOT NULL,
  po_id             UUID         NOT NULL REFERENCES ims_purchase_orders(id) ON DELETE CASCADE,
  item_id           UUID         REFERENCES ims_items(id),
  description       VARCHAR(300),
  quantity_ordered  NUMERIC(12,4) NOT NULL CHECK (quantity_ordered > 0),
  quantity_received NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  unit_cost         NUMERIC(12,2),
  notes             TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT pol_item_or_desc CHECK (item_id IS NOT NULL OR description IS NOT NULL)
);

ALTER TABLE ims_purchase_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY ims_po_lines_rls ON ims_purchase_order_lines
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

CREATE INDEX ims_pol_po_idx   ON ims_purchase_order_lines (po_id);
CREATE INDEX ims_pol_item_idx ON ims_purchase_order_lines (item_id);
