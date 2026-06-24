-- Migration 031: Unit listing photos and description

ALTER TABLE prop_units
  ADD COLUMN IF NOT EXISTS listing_description TEXT;

CREATE TABLE IF NOT EXISTS prop_unit_photos (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID         NOT NULL,
  unit_id       UUID         NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  object_key    VARCHAR(500) NOT NULL,
  display_order INT          NOT NULL DEFAULT 0,
  caption       VARCHAR(200),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS prop_unit_photos_unit_idx ON prop_unit_photos (unit_id, display_order);

ALTER TABLE prop_unit_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY unit_photos_owner ON prop_unit_photos
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);
