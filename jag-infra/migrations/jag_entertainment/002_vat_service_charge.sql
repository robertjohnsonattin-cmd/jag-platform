-- jag_entertainment — Migration 002: VAT + service charge
-- Adds per-tenant rate config and snapshots charge columns onto ent_tabs.

-- ── Tenant rate config ────────────────────────────────────────────────────────
-- One row per tenant. vat_pct defaults to 0 (not yet registered).
-- Update vat_pct to 12.5 when VAT registration is obtained.
CREATE TABLE ent_config (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL UNIQUE,
  vat_pct             numeric(5,2) NOT NULL DEFAULT 0   CHECK (vat_pct >= 0 AND vat_pct <= 100),
  service_charge_pct  numeric(5,2) NOT NULL DEFAULT 10  CHECK (service_charge_pct >= 0 AND service_charge_pct <= 100),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text
);

ALTER TABLE ent_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY ent_tenant_isolation ON ent_config
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX ON ent_config (tenant_id);

-- ── Snapshot columns on ent_tabs ──────────────────────────────────────────────
-- All amounts are snapshotted at close time — rate changes never affect history.
ALTER TABLE ent_tabs
  ADD COLUMN discount_amount       numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN service_charge_pct    numeric(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN service_charge_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN vat_pct               numeric(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN vat_amount            numeric(10,2) NOT NULL DEFAULT 0;
