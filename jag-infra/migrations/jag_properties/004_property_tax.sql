-- Migration 004: Property tax records

CREATE TABLE prop_property_tax (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           UUID        NOT NULL,
  property_id        UUID        NOT NULL REFERENCES prop_properties(id),
  tax_year           INTEGER     NOT NULL CHECK (tax_year BETWEEN 1990 AND 2100),
  assessment_value   NUMERIC(14,2),
  tax_amount         NUMERIC(14,2) NOT NULL,
  currency           VARCHAR(3)  NOT NULL DEFAULT 'TTD',
  due_date           DATE,
  paid_date          DATE,
  payment_reference  VARCHAR(200),
  notes              TEXT,
  idempotency_key    UUID        UNIQUE,
  last_modified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, tax_year)
);

CREATE INDEX prop_property_tax_property_id_idx ON prop_property_tax(property_id);
CREATE INDEX prop_property_tax_owner_id_idx    ON prop_property_tax(owner_id);

ALTER TABLE prop_property_tax ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_owner_isolation ON prop_property_tax
  USING      (owner_id = (current_setting('app.current_owner_id', true))::uuid)
  WITH CHECK (owner_id = (current_setting('app.current_owner_id', true))::uuid);
