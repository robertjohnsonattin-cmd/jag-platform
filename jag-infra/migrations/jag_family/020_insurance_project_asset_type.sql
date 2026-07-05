-- Adds PROJECT as a valid insured_asset_type so tender/performance bonds in
-- fin_insurance_policies can be soft-linked (insured_asset_ref) to a
-- jabco_projects row, mirroring the existing PROPERTY/VEHICLE pattern.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block — apply via
-- `sudo -u postgres psql -d jag_family -f 020_insurance_project_asset_type.sql`
-- (same as migration 018_insurance_consolidation.sql), then manually register
-- in __migrations.

ALTER TYPE insurance_asset_type ADD VALUE IF NOT EXISTS 'PROJECT';
