-- Migration: 009_units
-- Adds unit-level tracking for multi-unit properties (apartment blocks, commercial suites, etc.).

CREATE TABLE IF NOT EXISTS prop_units (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID        NOT NULL,
  property_id      UUID        NOT NULL REFERENCES prop_properties(id) ON DELETE CASCADE,
  unit_number      TEXT        NOT NULL,
  floor            INTEGER,
  bedrooms         INTEGER,
  bathrooms        NUMERIC(3,1),
  floor_area_sqm   NUMERIC(10,2),
  is_rented        BOOLEAN     NOT NULL DEFAULT false,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified_by UUID,
  UNIQUE (property_id, unit_number)
);

ALTER TABLE prop_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY prop_units_owner ON prop_units
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid);

-- Expand: link leases to a specific unit (nullable — single-unit properties don't need this).
ALTER TABLE prop_lease_agreements
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES prop_units(id) ON DELETE SET NULL;
