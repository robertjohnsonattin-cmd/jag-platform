-- JABCO: vendor/subcontractor invoices
-- STD-13 Expand-and-Contract: new table only, no changes to existing tables.

-- VAT code enum (may already exist from 002; guard with IF NOT EXISTS equivalent)
DO $$ BEGIN
  CREATE TYPE jabco_vat_code AS ENUM ('STANDARD', 'ZERO', 'EXEMPT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Invoice status enum
DO $$ BEGIN
  CREATE TYPE jabco_invoice_status AS ENUM ('RECEIVED', 'APPROVED', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── JABCO vendor/subcontractor invoices ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS jabco_vendor_invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  project_id        UUID NOT NULL REFERENCES jabco_projects(id),
  vendor_name       VARCHAR(200) NOT NULL,
  vendor_type       VARCHAR(50)  NOT NULL DEFAULT 'SUPPLIER',  -- SUPPLIER | SUBCONTRACTOR
  invoice_ref       VARCHAR(100),
  invoice_date      DATE NOT NULL,
  due_date          DATE,
  amount            NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  vat_code          jabco_vat_code NOT NULL DEFAULT 'STANDARD',
  vat_amount        NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  status            jabco_invoice_status NOT NULL DEFAULT 'RECEIVED',
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

ALTER TABLE jabco_vendor_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON jabco_vendor_invoices
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_jabco_vendor_invoices_project    ON jabco_vendor_invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_jabco_vendor_invoices_tenant     ON jabco_vendor_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_jabco_vendor_invoices_status     ON jabco_vendor_invoices(status);
CREATE INDEX IF NOT EXISTS idx_jabco_vendor_invoices_idempotent ON jabco_vendor_invoices(idempotency_key);
