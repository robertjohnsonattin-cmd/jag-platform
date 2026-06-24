-- Migration 031: VMS Increment 1 — preventive maintenance schedules and work orders
-- STD-04: versioned migration, never run raw SQL on production.
-- RLS uses NULLIF pattern (STD-02) to handle '' vs NULL from session GUC.

-- ── PM Schedules ──────────────────────────────────────────────────────────────
-- One row per maintenance task type per vehicle (e.g. "Oil Change", "Full Service").
-- trigger_type controls which interval/threshold field is active.

CREATE TABLE vms_pm_schedules (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid         NOT NULL,
  vehicle_id        uuid         NOT NULL REFERENCES ims_vehicles(id) ON DELETE CASCADE,
  schedule_name     varchar(200) NOT NULL,
  trigger_type      varchar(20)  NOT NULL
                    CHECK (trigger_type IN ('DATE', 'MILEAGE', 'ENGINE_HOURS')),
  -- Exactly one interval field must be set, matching trigger_type
  interval_days     integer,
  interval_km       integer,
  interval_hours    numeric(10,1),
  -- Last completion snapshot (populated by work order completion)
  last_done_date    date,
  last_done_km      integer,
  last_done_hours   numeric(10,1),
  -- Computed next-due thresholds (recomputed on each WO completion)
  next_due_date     date,
  next_due_km       integer,
  next_due_hours    numeric(10,1),
  is_overdue        boolean      NOT NULL DEFAULT false,
  is_active         boolean      NOT NULL DEFAULT true,
  notes             text,
  last_modified_at  timestamptz  NOT NULL DEFAULT now(),
  last_modified_by  uuid,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT vms_pm_interval_check CHECK (
    (trigger_type = 'DATE'         AND interval_days  IS NOT NULL) OR
    (trigger_type = 'MILEAGE'      AND interval_km    IS NOT NULL) OR
    (trigger_type = 'ENGINE_HOURS' AND interval_hours IS NOT NULL)
  )
);

ALTER TABLE vms_pm_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY vms_pm_rls ON vms_pm_schedules
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

CREATE INDEX IF NOT EXISTS idx_vms_pm_vehicle
  ON vms_pm_schedules(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_vms_pm_tenant
  ON vms_pm_schedules(tenant_id);

CREATE INDEX IF NOT EXISTS idx_vms_pm_active_due
  ON vms_pm_schedules(next_due_date)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_vms_pm_overdue
  ON vms_pm_schedules(is_overdue, is_active);

GRANT SELECT, INSERT, UPDATE ON vms_pm_schedules TO jag_app;

-- ── Work Orders ───────────────────────────────────────────────────────────────
-- One row per maintenance visit / job card.
-- pm_schedule_id links back for PREVENTIVE work orders (nullable for ad-hoc).

CREATE TABLE vms_work_orders (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid          NOT NULL,
  vehicle_id              uuid          NOT NULL REFERENCES ims_vehicles(id),
  pm_schedule_id          uuid          REFERENCES vms_pm_schedules(id),
  wo_number               varchar(50)   NOT NULL,
  wo_type                 varchar(20)   NOT NULL
                          CHECK (wo_type IN ('PREVENTIVE', 'CORRECTIVE', 'EMERGENCY')),
  status                  varchar(20)   NOT NULL DEFAULT 'OPEN'
                          CHECK (status IN ('OPEN', 'IN_PROGRESS', 'AWAITING_PARTS', 'COMPLETE', 'CANCELLED')),
  description             text          NOT NULL,
  scheduled_date          date,
  started_at              timestamptz,
  completed_at            timestamptz,
  vendor_name             varchar(200),
  vendor_ref              varchar(100),
  odometer_at_service     integer,
  engine_hours_at_service numeric(10,1),
  total_parts_cost_ttd    numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_parts_cost_ttd >= 0),
  total_labour_cost_ttd   numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_labour_cost_ttd >= 0),
  total_cost_ttd          numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_cost_ttd >= 0),
  -- Job-costing seam: reference to JABCO project or other entity (same pattern as ims_stock_movements)
  reference_type          varchar(50),
  reference_id            uuid,
  notes                   text,
  idempotency_key         uuid          NOT NULL,
  last_modified_at        timestamptz   NOT NULL DEFAULT now(),
  last_modified_by        uuid,
  created_by              uuid          NOT NULL,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, wo_number),
  UNIQUE (idempotency_key)
);

ALTER TABLE vms_work_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY vms_wo_rls ON vms_work_orders
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

CREATE INDEX IF NOT EXISTS idx_vms_wo_vehicle
  ON vms_work_orders(vehicle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vms_wo_tenant
  ON vms_work_orders(tenant_id);

CREATE INDEX IF NOT EXISTS idx_vms_wo_status
  ON vms_work_orders(status, tenant_id);

CREATE INDEX IF NOT EXISTS idx_vms_wo_idem
  ON vms_work_orders(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_vms_wo_ref
  ON vms_work_orders(reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON vms_work_orders TO jag_app;

-- ── Work Order Items ──────────────────────────────────────────────────────────
-- Parts, labour, and miscellaneous cost lines for a work order.
-- Totals on vms_work_orders are recomputed from items on every insert/delete.

CREATE TABLE vms_work_order_items (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   uuid          NOT NULL REFERENCES vms_work_orders(id) ON DELETE CASCADE,
  tenant_id       uuid          NOT NULL,
  item_type       varchar(20)   NOT NULL CHECK (item_type IN ('PARTS', 'LABOUR', 'MISC')),
  description     varchar(500)  NOT NULL,
  qty             numeric(10,3) NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_cost_ttd   numeric(12,2) NOT NULL CHECK (unit_cost_ttd >= 0),
  total_ttd       numeric(12,2) NOT NULL CHECK (total_ttd >= 0),
  ims_item_id     uuid          REFERENCES ims_items(id),
  created_at      timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE vms_work_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY vms_wo_items_rls ON vms_work_order_items
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

CREATE INDEX IF NOT EXISTS idx_vms_wo_items_wo
  ON vms_work_order_items(work_order_id);

CREATE INDEX IF NOT EXISTS idx_vms_wo_items_tenant
  ON vms_work_order_items(tenant_id);

GRANT SELECT, INSERT, DELETE ON vms_work_order_items TO jag_app;
