-- Migration 017: Rent Schedule
-- Auto-generated monthly rent due dates per lease. Generated on lease activation.

CREATE TABLE prop_rent_schedule (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID NOT NULL,
  lease_id              UUID NOT NULL REFERENCES prop_lease_agreements(id) ON DELETE CASCADE,
  unit_id               UUID NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  tenant_name           VARCHAR(200) NOT NULL,
  tenant_phone          VARCHAR(30),
  tenant_email          VARCHAR(200),
  period_year           INT NOT NULL,
  period_month          INT NOT NULL,
  due_date              DATE NOT NULL,
  amount_due_ttd        NUMERIC(12,2) NOT NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'UPCOMING'
    CHECK (status IN ('UPCOMING','REMINDER_SENT','PAID','PARTIAL','LATE','WAIVED')),
  paid_amount_ttd       NUMERIC(12,2),
  paid_date             DATE,
  payment_method        VARCHAR(20) CHECK (payment_method IN ('BANK_TRANSFER','CHEQUE','CASH')),
  payment_reference     VARCHAR(200),
  account_received      VARCHAR(200),
  late_fee_applied      BOOLEAN DEFAULT FALSE,
  late_fee_amount_ttd   NUMERIC(12,2),
  late_fee_applied_at   TIMESTAMPTZ,
  reminder_d5_sent_at   TIMESTAMPTZ,
  reminder_d1_sent_at   TIMESTAMPTZ,
  reminder_d1_sms_sent_at TIMESTAMPTZ,
  overdue_d1_sent_at    TIMESTAMPTZ,
  overdue_d3_sent_at    TIMESTAMPTZ,
  overdue_d7_sent_at    TIMESTAMPTZ,
  overdue_d14_flagged_at TIMESTAMPTZ,
  receipt_number        VARCHAR(50),
  receipt_pdf_url       TEXT,
  receipt_sent_at       TIMESTAMPTZ,
  idempotency_key       VARCHAR(100) UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lease_id, period_year, period_month)
);

ALTER TABLE prop_rent_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_rent_schedule_owner ON prop_rent_schedule
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_rent_due_date ON prop_rent_schedule(due_date);
CREATE INDEX idx_prop_rent_status   ON prop_rent_schedule(status);
CREATE INDEX idx_prop_rent_lease    ON prop_rent_schedule(lease_id);
