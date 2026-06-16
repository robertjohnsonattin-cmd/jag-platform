-- Migration 015: Rental Applications

CREATE TABLE prop_applications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID NOT NULL,
  enquiry_id            UUID REFERENCES prop_enquiries(id) ON DELETE SET NULL,
  unit_id               UUID NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  full_name             VARCHAR(200) NOT NULL,
  date_of_birth         DATE,
  national_id           VARCHAR(50),
  email                 VARCHAR(200),
  phone                 VARCHAR(30),
  employer_name         VARCHAR(200),
  employment_type       VARCHAR(30) CHECK (employment_type IN ('EMPLOYED','SELF_EMPLOYED','CONTRACT','RETIRED','UNEMPLOYED','OTHER')),
  monthly_income_ttd    NUMERIC(12,2),
  employment_letter_url TEXT,
  reference_1_name      VARCHAR(200),
  reference_1_phone     VARCHAR(30),
  reference_1_relation  VARCHAR(100),
  reference_2_name      VARCHAR(200),
  reference_2_phone     VARCHAR(30),
  reference_2_relation  VARCHAR(100),
  prior_landlord_name   VARCHAR(200),
  prior_landlord_phone  VARCHAR(30),
  national_id_url       TEXT,
  payslip_1_url         TEXT,
  payslip_2_url         TEXT,
  payslip_3_url         TEXT,
  status                VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','UNDER_REVIEW','APPROVED','REJECTED','WITHDRAWN')),
  rejection_reason      TEXT,
  form_sent_at          TIMESTAMPTZ,
  reminder_48h_sent_at  TIMESTAMPTZ,
  submitted_at          TIMESTAMPTZ,
  decision_at           TIMESTAMPTZ,
  decided_by            UUID,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_applications_owner ON prop_applications
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_applications_unit   ON prop_applications(unit_id);
CREATE INDEX idx_prop_applications_status ON prop_applications(status);
