-- Migration 058: Per-unit cost allocation for vendor invoices
--
-- prop_vendor_invoices has an approval workflow (RECEIVED -> APPROVED -> PAID)
-- but no way to split a shared expense (e.g. a roof repair covering 3 units)
-- across the units it benefits. Adds an allocations table; POSTing a new set
-- of allocations replaces the previous set for that invoice (simpler than
-- incremental edits, matches how the frontend form works: pick a method,
-- submit the whole split at once).

CREATE TABLE prop_vendor_invoice_allocations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL,
  invoice_id  UUID NOT NULL REFERENCES prop_vendor_invoices(id) ON DELETE CASCADE,
  unit_id     UUID NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  pct         NUMERIC(5,2) NOT NULL CHECK (pct > 0 AND pct <= 100),
  amount      NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id, unit_id)
);

ALTER TABLE prop_vendor_invoice_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_vendor_invoice_allocations_owner ON prop_vendor_invoice_allocations
  USING      (owner_id = (NULLIF(current_setting('app.current_user_id', true), ''))::uuid)
  WITH CHECK (owner_id = (NULLIF(current_setting('app.current_user_id', true), ''))::uuid);

CREATE INDEX idx_prop_vendor_invoice_alloc_invoice ON prop_vendor_invoice_allocations(invoice_id);
CREATE INDEX idx_prop_vendor_invoice_alloc_unit    ON prop_vendor_invoice_allocations(unit_id);
