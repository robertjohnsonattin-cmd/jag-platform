-- Migration 040: Switch unit floor area from sqm to sqft (expand step)
-- Trinidad real estate listings conventionally use square feet, not square metres.
-- Old floor_area_sqm column is left in place per STD-13 expand-and-contract (no drop
-- in this cycle) -- application code now reads/writes floor_area_sqft only.

ALTER TABLE prop_units
  ADD COLUMN IF NOT EXISTS floor_area_sqft NUMERIC(10,2);

UPDATE prop_units
SET floor_area_sqft = ROUND(floor_area_sqm * 10.7639, 2)
WHERE floor_area_sqm IS NOT NULL AND floor_area_sqft IS NULL;
