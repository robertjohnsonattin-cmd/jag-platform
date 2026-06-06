-- jag_commercial — Migration 001: JABCO VAT
-- Adds per-contract VAT settings and VAT breakdown to payment certificates.
--
-- vat_inclusive = false (exclusive): VAT added on top of certified amount
--   gross_certified = amount_certified + vat_amount
--   vat_amount      = amount_certified × vat_pct / 100
--
-- vat_inclusive = true: VAT extracted from certified amount
--   gross_certified = amount_certified  (input already includes VAT)
--   vat_amount      = amount_certified × vat_pct / (100 + vat_pct)

-- Default privileges so future tables are auto-accessible to jag_app
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO jag_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO jag_app;

-- ── jabco_projects ────────────────────────────────────────────────────────────
ALTER TABLE jabco_projects
  ADD COLUMN vat_inclusive boolean      NOT NULL DEFAULT false,
  ADD COLUMN vat_pct       numeric(5,2) NOT NULL DEFAULT 12.5
    CHECK (vat_pct >= 0 AND vat_pct <= 100);

COMMENT ON COLUMN jabco_projects.vat_inclusive IS
  'true = contract price includes VAT; false = VAT added on top (exclusive)';

-- ── jabco_payment_certificates ────────────────────────────────────────────────
-- amount_certified = net amount (ex-VAT for exclusive; VAT-inclusive input for inclusive)
-- vat_amount       = VAT portion (computed at cert issue time)
-- gross_certified  = total amount payable including VAT
ALTER TABLE jabco_payment_certificates
  ADD COLUMN vat_pct        numeric(5,2)  NOT NULL DEFAULT 12.5,
  ADD COLUMN vat_amount     numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN gross_certified numeric(14,2) NOT NULL DEFAULT 0;

-- Back-fill gross_certified for any existing certs (treat as exclusive at 12.5%).
-- Safe to run even if table is empty.
UPDATE jabco_payment_certificates
SET vat_amount      = ROUND(amount_certified * 12.5 / 100, 2),
    gross_certified = ROUND(amount_certified * 1.125, 2);
