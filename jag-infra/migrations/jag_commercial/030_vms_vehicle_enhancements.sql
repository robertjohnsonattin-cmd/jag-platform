-- Migration 030: VMS Increment 1 — extend ims_vehicles with operational fields
-- All columns are additive (STD-13 Step 1 — Expand only; nothing dropped).
-- STD-04: versioned migration, never run raw SQL on production.

ALTER TABLE ims_vehicles
  ADD COLUMN IF NOT EXISTS ownership_type       varchar(10)  NOT NULL DEFAULT 'COMPANY'
                             CHECK (ownership_type IN ('COMPANY', 'PERSONAL')),
  ADD COLUMN IF NOT EXISTS engine_hours         numeric(10,1),
  ADD COLUMN IF NOT EXISTS status               varchar(20)  NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE', 'IN_MAINTENANCE', 'OFF_ROAD', 'DISPOSED')),
  ADD COLUMN IF NOT EXISTS notes                text,
  ADD COLUMN IF NOT EXISTS assigned_driver_name varchar(200);

CREATE INDEX IF NOT EXISTS idx_ims_veh_status
  ON ims_vehicles(status, tenant_id);

CREATE INDEX IF NOT EXISTS idx_ims_veh_ownership
  ON ims_vehicles(ownership_type, tenant_id);
