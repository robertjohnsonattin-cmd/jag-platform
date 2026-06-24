-- Migration 032: VMS Increment 2 — fuel logs and operating costs
-- STD-04: versioned migration, never run raw SQL on production.
-- STD-11: idempotency_key UNIQUE on both write tables.
-- RLS uses NULLIF pattern (STD-02).

-- ── Fuel Logs ─────────────────────────────────────────────────────────────────
-- One row per fill. litres = litres for ICE/hybrid, kWh for electric.
-- km/L efficiency is computed at query time using a window function (prev full-tank odometer).

CREATE TABLE vms_fuel_logs (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid          NOT NULL,
  vehicle_id          uuid          NOT NULL REFERENCES ims_vehicles(id),
  log_date            date          NOT NULL,
  odometer_km         integer       CHECK (odometer_km >= 0),
  litres              numeric(8,2)  NOT NULL CHECK (litres > 0),
  cost_per_litre_ttd  numeric(6,3)  NOT NULL CHECK (cost_per_litre_ttd >= 0),
  total_cost_ttd      numeric(12,2) NOT NULL CHECK (total_cost_ttd >= 0),
  fuel_type           varchar(20)   NOT NULL DEFAULT 'PETROL'
                      CHECK (fuel_type IN ('PETROL', 'DIESEL', 'CNG', 'ELECTRIC')),
  station_name        varchar(200),
  is_full_tank        boolean       NOT NULL DEFAULT true,
  reference_type      varchar(50),
  reference_id        uuid,
  notes               text,
  idempotency_key     uuid          NOT NULL,
  created_by          uuid          NOT NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

ALTER TABLE vms_fuel_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY vms_fuel_rls ON vms_fuel_logs
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

CREATE INDEX IF NOT EXISTS idx_vms_fuel_vehicle
  ON vms_fuel_logs(vehicle_id, log_date DESC);

CREATE INDEX IF NOT EXISTS idx_vms_fuel_tenant
  ON vms_fuel_logs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_vms_fuel_idem
  ON vms_fuel_logs(idempotency_key);

GRANT SELECT, INSERT, DELETE ON vms_fuel_logs TO jag_app;

-- ── Operating Costs ───────────────────────────────────────────────────────────
-- Non-fuel vehicle costs: tolls, insurance premiums, road tax, tyres, etc.
-- Separate from work orders (which track labour + parts for maintenance jobs).

CREATE TABLE vms_operating_costs (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL,
  vehicle_id      uuid          NOT NULL REFERENCES ims_vehicles(id),
  cost_date       date          NOT NULL,
  cost_type       varchar(50)   NOT NULL
                  CHECK (cost_type IN (
                    'TOLL', 'INSURANCE_PREMIUM', 'REGISTRATION_FEE',
                    'TYRE', 'WASH', 'INSPECTION_FEE', 'PARKING', 'MISC'
                  )),
  amount_ttd      numeric(12,2) NOT NULL CHECK (amount_ttd >= 0),
  description     varchar(500),
  vendor_name     varchar(200),
  reference_type  varchar(50),
  reference_id    uuid,
  notes           text,
  idempotency_key uuid          NOT NULL,
  created_by      uuid          NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

ALTER TABLE vms_operating_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY vms_opcost_rls ON vms_operating_costs
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

CREATE INDEX IF NOT EXISTS idx_vms_opcost_vehicle
  ON vms_operating_costs(vehicle_id, cost_date DESC);

CREATE INDEX IF NOT EXISTS idx_vms_opcost_tenant
  ON vms_operating_costs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_vms_opcost_type
  ON vms_operating_costs(cost_type, tenant_id);

CREATE INDEX IF NOT EXISTS idx_vms_opcost_idem
  ON vms_operating_costs(idempotency_key);

GRANT SELECT, INSERT, DELETE ON vms_operating_costs TO jag_app;
