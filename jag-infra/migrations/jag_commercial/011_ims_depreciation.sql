-- 011_ims_depreciation.sql
-- IMS: Asset depreciation schedules and entries

CREATE TABLE ims_depreciation_schedules (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL,
  item_id               UUID          NOT NULL REFERENCES ims_items(id),
  method                VARCHAR(20)   NOT NULL DEFAULT 'STRAIGHT_LINE'
                          CHECK (method IN ('STRAIGHT_LINE','DECLINING_BALANCE')),
  useful_life_years     NUMERIC(5,2)  NOT NULL CHECK (useful_life_years > 0),
  residual_value        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (residual_value >= 0),
  depreciation_start    DATE          NOT NULL,
  cost_at_start         NUMERIC(12,2) NOT NULL CHECK (cost_at_start > 0),
  is_active             BOOLEAN       NOT NULL DEFAULT true,
  notes                 TEXT,
  last_modified_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_modified_by      UUID,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (item_id)   -- one active schedule per asset
);

ALTER TABLE ims_depreciation_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY ims_dep_sched_rls ON ims_depreciation_schedules
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

CREATE INDEX ims_dep_sched_tenant_idx ON ims_depreciation_schedules (tenant_id);
CREATE INDEX ims_dep_sched_item_idx   ON ims_depreciation_schedules (item_id);

-- ── Depreciation Entries ──────────────────────────────────────────────────────
-- One row per period (usually monthly or annual) per asset.

CREATE TABLE ims_depreciation_entries (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL,
  schedule_id           UUID          NOT NULL REFERENCES ims_depreciation_schedules(id),
  item_id               UUID          NOT NULL REFERENCES ims_items(id),
  period_start          DATE          NOT NULL,
  period_end            DATE          NOT NULL,
  depreciation_amount   NUMERIC(12,2) NOT NULL CHECK (depreciation_amount >= 0),
  accumulated_depreciation NUMERIC(12,2) NOT NULL,
  net_book_value        NUMERIC(12,2) NOT NULL,
  notes                 TEXT,
  posted_by             UUID,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, period_start)
);

ALTER TABLE ims_depreciation_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY ims_dep_entry_rls ON ims_depreciation_entries
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

CREATE INDEX ims_dep_entry_schedule_idx ON ims_depreciation_entries (schedule_id);
CREATE INDEX ims_dep_entry_item_idx     ON ims_depreciation_entries (item_id);
CREATE INDEX ims_dep_entry_period_idx   ON ims_depreciation_entries (period_start);
