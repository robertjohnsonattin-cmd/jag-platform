-- Migration 016: Security Deposits
-- Deposits are a LIABILITY (money held), NOT income. Never post to P&L.

CREATE TABLE prop_deposits (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                      UUID NOT NULL,
  lease_id                      UUID REFERENCES prop_lease_agreements(id) ON DELETE SET NULL,
  unit_id                       UUID NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  tenant_name                   VARCHAR(200) NOT NULL,
  amount_ttd                    NUMERIC(12,2) NOT NULL,
  months_equivalent             NUMERIC(4,1),
  payment_method                VARCHAR(20) CHECK (payment_method IN ('BANK_TRANSFER','CHEQUE','CASH')),
  received_date                 DATE NOT NULL,
  reference_bank                VARCHAR(100),
  reference_number              VARCHAR(100),
  held_in_account               VARCHAR(200),
  receipt_number                VARCHAR(50) UNIQUE,
  receipt_pdf_url               TEXT,
  receipt_sent_at               TIMESTAMPTZ,
  status                        VARCHAR(20) NOT NULL DEFAULT 'HELD'
    CHECK (status IN ('HELD','PARTIALLY_RETURNED','RETURNED','FORFEITED')),
  deductions_ttd                NUMERIC(12,2) DEFAULT 0,
  deduction_notes               TEXT,
  refund_amount_ttd             NUMERIC(12,2),
  refund_date                   DATE,
  reconciliation_statement_url  TEXT,
  tenant_signed_off             BOOLEAN DEFAULT FALSE,
  idempotency_key               VARCHAR(100) UNIQUE,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_deposits_owner ON prop_deposits
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_deposits_unit  ON prop_deposits(unit_id);
CREATE INDEX idx_prop_deposits_lease ON prop_deposits(lease_id);
