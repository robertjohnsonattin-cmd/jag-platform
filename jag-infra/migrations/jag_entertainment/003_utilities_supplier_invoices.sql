-- Entertainment: utility bills + supplier invoices (BAR + Members Club)
-- STD-13 Expand-and-Contract: new tables only, no changes to existing tables.

-- Venue enum
DO $$ BEGIN
  CREATE TYPE ent_venue AS ENUM ('BAR', 'CLUB');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Utility type enum
DO $$ BEGIN
  CREATE TYPE ent_utility_type AS ENUM ('ELECTRICITY', 'WATER', 'GAS', 'INTERNET', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- VAT code enum
DO $$ BEGIN
  CREATE TYPE ent_vat_code AS ENUM ('STANDARD', 'ZERO', 'EXEMPT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Invoice status enum
DO $$ BEGIN
  CREATE TYPE ent_invoice_status AS ENUM ('RECEIVED', 'APPROVED', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Utility bills ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ent_utility_bills (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  venue            ent_venue NOT NULL,
  utility_type     ent_utility_type NOT NULL,
  provider         VARCHAR(200) NOT NULL,
  bill_date        DATE NOT NULL,
  paid_date        DATE,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  vat_code         ent_vat_code NOT NULL DEFAULT 'STANDARD',
  vat_amount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  notes            TEXT,
  idempotency_key  UUID NOT NULL UNIQUE,
  created_by       UUID NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE ent_utility_bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ent_utility_bills
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_ent_utility_bills_tenant  ON ent_utility_bills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ent_utility_bills_venue   ON ent_utility_bills(venue);

-- ── Supplier invoices ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ent_supplier_invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  venue             ent_venue NOT NULL,
  supplier_name     VARCHAR(200) NOT NULL,
  invoice_ref       VARCHAR(100),
  invoice_date      DATE NOT NULL,
  due_date          DATE,
  amount            NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  vat_code          ent_vat_code NOT NULL DEFAULT 'STANDARD',
  vat_amount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  status            ent_invoice_status NOT NULL DEFAULT 'RECEIVED',
  approved_by       UUID,
  approved_at       TIMESTAMP WITH TIME ZONE,
  paid_date         DATE,
  payment_reference VARCHAR(200),
  notes             TEXT,
  idempotency_key   UUID NOT NULL UNIQUE,
  created_by        UUID NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE ent_supplier_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ent_supplier_invoices
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_ent_supplier_invoices_tenant  ON ent_supplier_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ent_supplier_invoices_venue   ON ent_supplier_invoices(venue);
CREATE INDEX IF NOT EXISTS idx_ent_supplier_invoices_status  ON ent_supplier_invoices(status);
