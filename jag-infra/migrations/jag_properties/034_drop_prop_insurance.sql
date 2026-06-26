-- jag_properties — Migration 034: Remove prop_insurance table
-- Insurance is now tracked exclusively in fin_insurance_policies (jag_family).
-- The insured_asset_ref UUID on fin_insurance_policies points to prop_properties.id.
-- Existing prop_insurance rows should be migrated via scripts/migrate-insurance.js before running this.

DROP TABLE IF EXISTS prop_insurance;
