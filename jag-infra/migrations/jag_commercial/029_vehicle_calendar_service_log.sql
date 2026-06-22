-- Migration 029: vehicle Google Calendar event IDs + service log table
-- STD-04: versioned migration, never run raw SQL on production

-- 1. Calendar event ID columns on ims_vehicles
--    Three separate columns so each date type can be managed independently
ALTER TABLE ims_vehicles
  ADD COLUMN IF NOT EXISTS cal_service_event_id      text,
  ADD COLUMN IF NOT EXISTS cal_insurance_event_id    text,
  ADD COLUMN IF NOT EXISTS cal_registration_event_id text;

-- 2. Vehicle service log — append-only, one row per service visit
CREATE TABLE IF NOT EXISTS ims_vehicle_service_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id      uuid        NOT NULL REFERENCES ims_vehicles(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL,
  service_date    date        NOT NULL,
  mileage_km      integer,
  service_type    varchar(30) NOT NULL DEFAULT 'OTHER',
  -- e.g. OIL_CHANGE | FULL_SERVICE | TYRES | BRAKES | INSPECTION | WASH | OTHER
  description     text,
  cost_ttd        numeric(12,2),
  performed_by    varchar(200),
  -- next_service_date recorded at time of service (snapshot)
  next_service_date date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_modified_at timestamptz NOT NULL DEFAULT now(),
  last_modified_by uuid
);

CREATE INDEX IF NOT EXISTS idx_veh_svc_log_vehicle ON ims_vehicle_service_log(vehicle_id, service_date DESC);
CREATE INDEX IF NOT EXISTS idx_veh_svc_log_tenant  ON ims_vehicle_service_log(tenant_id);

-- 3. RLS on service log — same tenant-based policy as ims_vehicles
ALTER TABLE ims_vehicle_service_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY veh_svc_log_tenant_policy ON ims_vehicle_service_log
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

GRANT SELECT, INSERT, UPDATE ON ims_vehicle_service_log TO jag_app;
