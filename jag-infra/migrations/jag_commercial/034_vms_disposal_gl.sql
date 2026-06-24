-- Migration 034: VMS Increment 4 — GL account linkage + disposal workflow
-- STD-04: versioned migration only; never raw SQL on production.
-- STD-13 Step 1 (Expand): additive columns on existing tables; no renames, no drops.
-- RLS uses NULLIF pattern (STD-02).

-- ── Depreciation schedule GL linkage (STD-13: additive only) ──────────────────
-- Optional: when set, posting a depreciation period auto-creates a balanced JE
-- in fin_journal_entries (jag_family DB) under the vehicle's owner entity.

ALTER TABLE ims_depreciation_schedules
  ADD COLUMN IF NOT EXISTS dep_expense_gl_account_id UUID,
  ADD COLUMN IF NOT EXISTS acc_dep_gl_account_id     UUID;

-- Track which JE was auto-posted for each depreciation entry (nullable until GL post fires).
ALTER TABLE ims_depreciation_entries
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID;

-- ── vms_disposals ─────────────────────────────────────────────────────────────
-- One row per disposed vehicle. UNIQUE(vehicle_id) enforces one disposal per vehicle.
-- Captures final financial snapshot at disposal date.

CREATE TABLE vms_disposals (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID          NOT NULL,
  vehicle_id               UUID          NOT NULL REFERENCES ims_vehicles(id),

  disposal_type            VARCHAR(20)   NOT NULL
                           CHECK (disposal_type IN ('SALE', 'WRITE_OFF', 'TRANSFER')),
  disposal_date            DATE          NOT NULL,

  -- Financial snapshot at time of disposal
  cost_at_disposal         NUMERIC(14,2) NOT NULL,
  accumulated_dep          NUMERIC(14,2) NOT NULL DEFAULT 0,
  nbv_at_disposal          NUMERIC(14,2) NOT NULL,
  sale_price_ttd           NUMERIC(14,2),           -- SALE only; NULL for WRITE_OFF/TRANSFER
  gain_loss_ttd            NUMERIC(14,2),           -- positive = gain, negative = loss

  -- Reference to the GL journal entry created on disposal (NULL if GL accounts not provided)
  journal_entry_id         UUID,

  -- TCO summary frozen at disposal time
  tco_snapshot             JSONB,

  -- Counterparty / logistics
  buyer_name               VARCHAR(200),
  final_mileage_km         INTEGER,
  final_engine_hours       NUMERIC(10,1),
  notes                    TEXT,

  -- Approval
  approved_by              UUID,
  approved_at              TIMESTAMPTZ,

  last_modified_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_modified_by         UUID,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (vehicle_id)
);

ALTER TABLE vms_disposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY vms_disposal_rls ON vms_disposals
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

CREATE INDEX IF NOT EXISTS idx_vms_disposal_vehicle
  ON vms_disposals(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_vms_disposal_tenant
  ON vms_disposals(tenant_id, disposal_date DESC);

GRANT SELECT, INSERT, UPDATE ON vms_disposals TO jag_app;
