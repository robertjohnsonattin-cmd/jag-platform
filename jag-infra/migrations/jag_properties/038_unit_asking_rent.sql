-- Migration 038: Asking rent for unit listings
-- The listing-info PATCH endpoint and frontend "Manage Listing" modal have referenced
-- a rent_amount column since the listing feature shipped, but the column was never
-- actually added -- every save silently 500'd (column "rent_amount" does not exist).

ALTER TABLE prop_units
  ADD COLUMN IF NOT EXISTS rent_amount NUMERIC(12,2);
