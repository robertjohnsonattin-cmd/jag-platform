-- Migration 036: GPS tracker registry (Traccar integration)
-- STD-04: versioned migration, never run raw SQL on production.
-- RLS uses the NULLIF tenant pattern (STD-02).
--
-- A gps_tracker is a PHYSICAL device that moves between vehicles over its life
-- (disposed-vehicle reassignment + spares wired into future vehicles), so it is
-- modelled as its own record with a changeable vehicle assignment — NOT a fixed
-- column on ims_vehicles. The existing ims_vehicles.sim_number column is left in
-- place (expand-not-drop per STD-13).
--
-- traccar_device_id is Traccar's internal numeric device id, captured after the
-- device first connects to Traccar (the device announces its id on connect).
-- vehicle_id is a soft reference to ims_vehicles (same DB) — assigned/unassigned
-- as trackers are moved between vehicles or held as spares.

CREATE TABLE gps_trackers (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid         NOT NULL,
  -- Device identity (the id printed on the unit / announced to Traccar)
  device_serial     varchar(50)  NOT NULL,
  model             varchar(50),
  -- Traccar protocol the unit speaks (tkstar | gt06 | h02 | ...)
  protocol          varchar(30),
  -- Traccar's internal numeric device id (NULL until registered in Traccar)
  traccar_device_id integer,
  -- SIM phone number used to send configuration SMS (NULL for spares with no SIM)
  sim_phone         varchar(30),
  status            varchar(20)  NOT NULL DEFAULT 'UNASSIGNED'
                    CHECK (status IN ('UNASSIGNED', 'ASSIGNED', 'RETIRED')),
  -- Soft reference to ims_vehicles (same DB). NULL when a spare / unassigned.
  vehicle_id        uuid         REFERENCES ims_vehicles(id) ON DELETE SET NULL,
  notes             text,
  -- Cached last-seen timestamp from Traccar (advisory; Traccar remains source of truth)
  last_seen_at      timestamptz,
  last_modified_at  timestamptz  NOT NULL DEFAULT now(),
  last_modified_by  uuid,
  created_at        timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE gps_trackers ENABLE ROW LEVEL SECURITY;

CREATE POLICY gps_trackers_rls ON gps_trackers
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- One physical device cannot be registered twice within a tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_gps_trackers_serial
  ON gps_trackers(tenant_id, device_serial);

-- Resolve "which tracker is on this vehicle right now"
CREATE INDEX IF NOT EXISTS idx_gps_trackers_vehicle
  ON gps_trackers(vehicle_id)
  WHERE vehicle_id IS NOT NULL;

-- Map an inbound Traccar deviceId back to a tracker (event webhook + fleet map)
CREATE INDEX IF NOT EXISTS idx_gps_trackers_traccar
  ON gps_trackers(traccar_device_id)
  WHERE traccar_device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gps_trackers_tenant
  ON gps_trackers(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON gps_trackers TO jag_app;
