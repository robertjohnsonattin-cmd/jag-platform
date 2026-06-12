-- Migration 010: Add last_modified_at to prop_mortgage_register
-- The table was created with updated_at instead of last_modified_at.
-- Expand step: add last_modified_at, backfill from updated_at.

ALTER TABLE prop_mortgage_register
  ADD COLUMN IF NOT EXISTS last_modified_at TIMESTAMPTZ;

UPDATE prop_mortgage_register
   SET last_modified_at = updated_at
 WHERE last_modified_at IS NULL;

ALTER TABLE prop_mortgage_register
  ALTER COLUMN last_modified_at SET NOT NULL,
  ALTER COLUMN last_modified_at SET DEFAULT now();
