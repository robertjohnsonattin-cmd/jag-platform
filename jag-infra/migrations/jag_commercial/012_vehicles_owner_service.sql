-- Migration 012: vehicles — flexible owner_entity + service tracking
-- STD-13 Step 1 (Expand): add owner_entity alongside fleet_type; make location_id nullable
-- STD-04: versioned migration, never run raw SQL on production

-- 1. Make ims_items.location_id nullable
--    (less restrictive than current NOT NULL — no STD-13 needed)
ALTER TABLE ims_items ALTER COLUMN location_id DROP NOT NULL;

-- 2. Expand: add owner_entity (free-text owner/entity label)
ALTER TABLE ims_vehicles
  ADD COLUMN IF NOT EXISTS owner_entity varchar(100);

-- 3. Backfill: copy fleet_type → owner_entity for existing rows (STD-13 Step 3)
UPDATE ims_vehicles
SET owner_entity = CASE fleet_type
  WHEN 'JABCO_FLEET'    THEN 'JABCO'
  WHEN 'PERSONAL_FLEET' THEN 'Personal — Robert'
  ELSE fleet_type
END
WHERE owner_entity IS NULL;

-- 4. Service tracking columns
ALTER TABLE ims_vehicles
  ADD COLUMN IF NOT EXISTS last_service_date    date,
  ADD COLUMN IF NOT EXISTS next_service_date    date,
  ADD COLUMN IF NOT EXISTS service_interval_days integer NOT NULL DEFAULT 90;

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_ims_veh_owner_entity   ON ims_vehicles(owner_entity);
CREATE INDEX IF NOT EXISTS idx_ims_veh_next_service   ON ims_vehicles(next_service_date);
