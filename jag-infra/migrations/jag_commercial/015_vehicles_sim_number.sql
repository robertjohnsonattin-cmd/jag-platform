-- Migration 015: ims_vehicles — GPS tracker SIM number
-- STD-04: versioned migration, never run raw SQL on production

ALTER TABLE ims_vehicles
  ADD COLUMN IF NOT EXISTS sim_number varchar(20);
