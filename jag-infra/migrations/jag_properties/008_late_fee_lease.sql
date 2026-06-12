-- Migration: 008_late_fee_lease
-- Adds configurable late fee policy to individual leases.

ALTER TABLE prop_lease_agreements
  ADD COLUMN IF NOT EXISTS late_fee_type       TEXT    NOT NULL DEFAULT 'NONE'
    CHECK (late_fee_type IN ('NONE','FIXED','PERCENT')),
  ADD COLUMN IF NOT EXISTS late_fee_value      NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_fee_grace_days INTEGER NOT NULL DEFAULT 0;
