-- Migration 057: Preventive / recurring maintenance scheduler
--
-- prop_maintenance_tickets is reactive only (tenant/landlord reports an issue
-- after the fact). This adds a separate recurring-task engine for planned
-- upkeep (e.g. "service the AC every 3 months") that isn't tied to a report.
-- Completion is logged separately so history is preserved even as
-- next_due_date advances on the parent row.

CREATE TABLE prop_scheduled_maintenance (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           UUID        NOT NULL,
  property_id        UUID        NOT NULL REFERENCES prop_properties(id) ON DELETE CASCADE,
  unit_id            UUID        REFERENCES prop_units(id) ON DELETE CASCADE,
  title              VARCHAR(200) NOT NULL,
  description        TEXT,
  frequency          VARCHAR(20) NOT NULL
    CHECK (frequency IN ('WEEKLY','MONTHLY','QUARTERLY','BIANNUAL','ANNUAL','ONE_TIME')),
  last_done_date     DATE,
  next_due_date      DATE        NOT NULL,
  assigned_contractor_id UUID    REFERENCES prop_contractors(id) ON DELETE SET NULL,
  estimated_cost_ttd NUMERIC(12,2),
  status             VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','PAUSED','COMPLETED','CANCELLED')),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_scheduled_maintenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_scheduled_maintenance_owner ON prop_scheduled_maintenance
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_sched_maint_property  ON prop_scheduled_maintenance(property_id);
CREATE INDEX idx_prop_sched_maint_unit      ON prop_scheduled_maintenance(unit_id);
CREATE INDEX idx_prop_sched_maint_next_due  ON prop_scheduled_maintenance(next_due_date) WHERE status = 'ACTIVE';
CREATE INDEX idx_prop_sched_maint_status    ON prop_scheduled_maintenance(status);

CREATE TABLE prop_scheduled_maintenance_log (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                   UUID NOT NULL,
  scheduled_maintenance_id   UUID NOT NULL REFERENCES prop_scheduled_maintenance(id) ON DELETE CASCADE,
  completed_date             DATE NOT NULL,
  actual_cost_ttd            NUMERIC(12,2),
  completed_by               VARCHAR(200),
  notes                      TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_scheduled_maintenance_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_scheduled_maintenance_log_owner ON prop_scheduled_maintenance_log
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_sched_maint_log_parent ON prop_scheduled_maintenance_log(scheduled_maintenance_id);
