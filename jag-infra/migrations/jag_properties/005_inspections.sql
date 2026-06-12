-- Migration 005: Property inspections

CREATE TABLE prop_inspections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID        NOT NULL,
  property_id       UUID        NOT NULL REFERENCES prop_properties(id),
  inspection_type   TEXT        NOT NULL CHECK (inspection_type IN ('MOVE_IN','MOVE_OUT','PERIODIC','PRE_TENANCY','MAINTENANCE','VALUATION')),
  inspection_date   DATE        NOT NULL,
  inspector_name    VARCHAR(200),
  condition_rating  TEXT        CHECK (condition_rating IN ('EXCELLENT','GOOD','FAIR','POOR')),
  notes             TEXT,
  next_due_date     DATE,
  idempotency_key   UUID        UNIQUE,
  last_modified_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX prop_inspections_property_id_idx ON prop_inspections(property_id);
CREATE INDEX prop_inspections_owner_id_idx    ON prop_inspections(owner_id);
CREATE INDEX prop_inspections_date_idx        ON prop_inspections(inspection_date DESC);

ALTER TABLE prop_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_owner_isolation ON prop_inspections
  USING      (owner_id = (current_setting('app.current_owner_id', true))::uuid)
  WITH CHECK (owner_id = (current_setting('app.current_owner_id', true))::uuid);
