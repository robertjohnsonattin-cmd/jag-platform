-- Migration 003: Property insurance policies
-- A property may carry multiple policies (building, contents, liability, etc.)

CREATE TABLE prop_insurance (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id               UUID NOT NULL,
  property_id            UUID NOT NULL REFERENCES prop_properties(id),
  insurance_type         TEXT NOT NULL CHECK (insurance_type IN ('BUILDING','CONTENTS','COMPREHENSIVE','LIABILITY','FLOOD','FIRE','OTHER')),
  insurer                VARCHAR(200) NOT NULL,
  policy_number          VARCHAR(100),
  premium_amount         NUMERIC(14,2),
  premium_currency       VARCHAR(3)  NOT NULL DEFAULT 'TTD',
  premium_frequency      TEXT        NOT NULL DEFAULT 'ANNUAL' CHECK (premium_frequency IN ('MONTHLY','QUARTERLY','ANNUAL')),
  coverage_amount        NUMERIC(14,2),
  start_date             DATE,
  expiry_date            DATE,
  auto_renew             BOOLEAN     NOT NULL DEFAULT false,
  notes                  TEXT,
  idempotency_key        UUID        UNIQUE,
  last_modified_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX prop_insurance_property_id_idx ON prop_insurance(property_id);
CREATE INDEX prop_insurance_owner_id_idx    ON prop_insurance(owner_id);
CREATE INDEX prop_insurance_expiry_idx      ON prop_insurance(expiry_date) WHERE expiry_date IS NOT NULL;

ALTER TABLE prop_insurance ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_owner_isolation ON prop_insurance
  USING      (owner_id = (current_setting('app.current_owner_id', true))::uuid)
  WITH CHECK (owner_id = (current_setting('app.current_owner_id', true))::uuid);
