-- Migration 023 — add phone2 to prop_property_tenants
-- Expand step only (STD-13); no existing column dropped.

ALTER TABLE prop_property_tenants
  ADD COLUMN IF NOT EXISTS phone2 VARCHAR(30);
