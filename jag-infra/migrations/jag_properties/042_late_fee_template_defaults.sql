-- Migration: 042_late_fee_template_defaults
-- Aligns late-fee policy with the standard Tenancy Agreement template
-- (5% of monthly rent, 4-day grace period) so the auto-generated lease
-- PDF never has to diverge from what's actually on file. Applies the
-- template's terms as the new default for future leases and backfills
-- existing ACTIVE/PENDING leases that still hold the old 'NONE' default.

ALTER TABLE prop_lease_agreements
  ALTER COLUMN late_fee_type       SET DEFAULT 'PERCENT',
  ALTER COLUMN late_fee_value      SET DEFAULT 5,
  ALTER COLUMN late_fee_grace_days SET DEFAULT 4;

UPDATE prop_lease_agreements
SET    late_fee_type = 'PERCENT',
       late_fee_value = 5,
       late_fee_grace_days = 4
WHERE  status IN ('ACTIVE', 'PENDING')
AND    late_fee_type = 'NONE'
AND    late_fee_value = 0
AND    late_fee_grace_days = 0;
