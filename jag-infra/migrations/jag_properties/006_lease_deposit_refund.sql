-- Migration: 006_lease_deposit_refund
-- Adds security deposit refund tracking to prop_lease_agreements

ALTER TABLE prop_lease_agreements
  ADD COLUMN IF NOT EXISTS deposit_refunded_amount  NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS deposit_deductions        NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_refund_date       DATE,
  ADD COLUMN IF NOT EXISTS deposit_refund_notes      TEXT,
  ADD COLUMN IF NOT EXISTS deposit_status            TEXT NOT NULL DEFAULT 'HELD'
    CHECK (deposit_status IN ('HELD','PARTIALLY_REFUNDED','FULLY_REFUNDED','N_A'));

-- Properties with no deposit are N/A at the app layer; DB default is HELD.
-- Documents table for attaching MinIO files to leases or properties.

CREATE TABLE IF NOT EXISTS prop_documents (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID        NOT NULL,
  property_id      UUID        NOT NULL REFERENCES prop_properties(id) ON DELETE CASCADE,
  lease_id         UUID        REFERENCES prop_lease_agreements(id) ON DELETE SET NULL,
  document_type    TEXT        NOT NULL DEFAULT 'OTHER'
    CHECK (document_type IN ('TITLE_DEED','TENANCY_AGREEMENT','INSURANCE_CERTIFICATE',
                             'INSPECTION_REPORT','PERMIT','INVOICE','OTHER')),
  label            TEXT        NOT NULL,
  minio_object_key TEXT        NOT NULL,
  file_name        TEXT        NOT NULL,
  file_size_bytes  BIGINT,
  mime_type        TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified_by UUID
);

ALTER TABLE prop_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY prop_documents_owner ON prop_documents
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid);
