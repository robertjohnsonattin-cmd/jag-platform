-- STD-13 Expand: add last_modified_at + last_modified_by audit columns to prop_properties.
-- Required by PATCH /properties/:id handler which sets these on every update.

ALTER TABLE prop_properties
  ADD COLUMN IF NOT EXISTS last_modified_at  timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_modified_by  uuid;

-- Backfill: use updated_at as a reasonable proxy for existing rows
UPDATE prop_properties
SET last_modified_at = updated_at
WHERE last_modified_at IS NULL OR last_modified_at = now();
