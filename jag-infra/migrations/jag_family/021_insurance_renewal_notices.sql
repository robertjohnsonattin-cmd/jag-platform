-- Adds dedup columns so the insurance renewal-check job only fires each
-- notification tier once per expiry cycle. Reset to NULL whenever a PATCH
-- changes expiry_date (i.e. the policy has been renewed), so the next cycle
-- can alert again.

ALTER TABLE fin_insurance_policies
  ADD COLUMN renewal_notice_sent_at        TIMESTAMPTZ,
  ADD COLUMN renewal_notice_urgent_sent_at TIMESTAMPTZ;
