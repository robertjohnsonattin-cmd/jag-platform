-- Migration 015: extended transaction tagging
-- Adds subcategory, entity_id, project_ref, property_ref, cost_centre, billable, notes, tags

ALTER TABLE fin_transactions
  ADD COLUMN IF NOT EXISTS subcategory   TEXT,
  ADD COLUMN IF NOT EXISTS entity_id     UUID,
  ADD COLUMN IF NOT EXISTS project_ref   TEXT,
  ADD COLUMN IF NOT EXISTS property_ref  TEXT,
  ADD COLUMN IF NOT EXISTS cost_centre   TEXT,
  ADD COLUMN IF NOT EXISTS billable      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes         TEXT,
  ADD COLUMN IF NOT EXISTS tags          TEXT[]  NOT NULL DEFAULT '{}';
