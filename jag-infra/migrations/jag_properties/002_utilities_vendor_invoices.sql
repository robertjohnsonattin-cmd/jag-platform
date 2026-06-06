-- Properties: utility bills + vendor invoices
-- STD-13 Expand-and-Contract: new tables only, no changes to existing tables.

-- VAT code enum (reused pattern from jag_commercial)
DO $$ BEGIN
  CREATE TYPE prop_vat_code AS ENUM ('STANDARD', 'ZERO', 'EXEMPT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Utility type enum
DO $$ BEGIN
  CREATE TYPE prop_utility_type AS ENUM ('ELECTRICITY', 'WATER', 'GAS', 'INTERNET', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Vendor invoice status enum
DO $$ BEGIN
  CREATE TYPE prop_invoice_status AS ENUM ('RECEIVED', 'APPROVED', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Utility bills ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prop_utility_bills (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL,
  property_id      UUID NOT NULL REFERENCES prop_properties(id),
  utility_type     prop_utility_type NOT NULL,
  provider         VARCHAR(200) NOT NULL,
  bill_date        DATE NOT NULL,
  paid_date        DATE,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  vat_code         prop_vat_code NOT NULL DEFAULT 'STANDARD',
  vat_amount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  notes            TEXT,
  idempotency_key  UUID NOT NULL UNIQUE,
  created_by       UUID NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE prop_utility_bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON prop_utility_bills
  USING (owner_id = (NULLIF(current_setting('app.current_user_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_prop_utility_bills_property ON prop_utility_bills(property_id);
CREATE INDEX IF NOT EXISTS idx_prop_utility_bills_owner    ON prop_utility_bills(owner_id);

-- ── Vendor invoices ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prop_vendor_invoices (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id               UUID NOT NULL,
  property_id            UUID NOT NULL REFERENCES prop_properties(id),
  maintenance_request_id UUID REFERENCES prop_maintenance_requests(id),
  vendor_name            VARCHAR(200) NOT NULL,
  invoice_ref            VARCHAR(100),
  invoice_date           DATE NOT NULL,
  due_date               DATE,
  amount                 NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  vat_code               prop_vat_code NOT NULL DEFAULT 'STANDARD',
  vat_amount             NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  status                 prop_invoice_status NOT NULL DEFAULT 'RECEIVED',
  approved_by            UUID,
  approved_at            TIMESTAMP WITH TIME ZONE,
  paid_date              DATE,
  payment_reference      VARCHAR(200),
  notes                  TEXT,
  idempotency_key        UUID NOT NULL UNIQUE,
  created_by             UUID NOT NULL,
  created_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE prop_vendor_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON prop_vendor_invoices
  USING (owner_id = (NULLIF(current_setting('app.current_user_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_prop_vendor_invoices_property   ON prop_vendor_invoices(property_id);
CREATE INDEX IF NOT EXISTS idx_prop_vendor_invoices_owner      ON prop_vendor_invoices(owner_id);
CREATE INDEX IF NOT EXISTS idx_prop_vendor_invoices_status     ON prop_vendor_invoices(status);
CREATE INDEX IF NOT EXISTS idx_prop_vendor_invoices_maint      ON prop_vendor_invoices(maintenance_request_id);
