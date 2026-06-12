-- 010_ims_stock_takes.sql
-- IMS: Stock take (physical count reconciliation)

CREATE TABLE ims_stock_takes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  reference       VARCHAR(50) NOT NULL,      -- e.g. ST-2026-001
  status          VARCHAR(20) NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN','COUNTING','FINALISED','CANCELLED')),
  location_id     UUID        REFERENCES ims_locations(id),  -- NULL = all locations
  notes           TEXT,
  finalised_at    TIMESTAMPTZ,
  last_modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified_by UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, reference)
);

ALTER TABLE ims_stock_takes ENABLE ROW LEVEL SECURITY;
CREATE POLICY ims_stock_takes_rls ON ims_stock_takes
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

CREATE INDEX ims_st_tenant_idx ON ims_stock_takes (tenant_id);
CREATE INDEX ims_st_status_idx ON ims_stock_takes (status);

CREATE SEQUENCE ims_st_seq START 1;

-- ── Stock Take Lines ──────────────────────────────────────────────────────────

CREATE TABLE ims_stock_take_lines (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID          NOT NULL,
  stock_take_id    UUID          NOT NULL REFERENCES ims_stock_takes(id) ON DELETE CASCADE,
  item_id          UUID          NOT NULL REFERENCES ims_items(id),
  expected_qty     NUMERIC(12,4) NOT NULL,   -- snapshot of quantity_on_hand at take creation
  counted_qty      NUMERIC(12,4),            -- NULL until counted
  variance         NUMERIC(12,4) GENERATED ALWAYS AS (counted_qty - expected_qty) STORED,
  notes            TEXT,
  counted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (stock_take_id, item_id)
);

ALTER TABLE ims_stock_take_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY ims_stl_rls ON ims_stock_take_lines
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

CREATE INDEX ims_stl_take_idx ON ims_stock_take_lines (stock_take_id);
CREATE INDEX ims_stl_item_idx ON ims_stock_take_lines (item_id);
