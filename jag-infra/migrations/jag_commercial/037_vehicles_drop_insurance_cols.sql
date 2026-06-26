-- jag_commercial — Migration 037: Remove vehicle insurance columns
-- Insurance is now tracked exclusively in fin_insurance_policies (jag_family).
-- The insured_asset_ref UUID on fin_insurance_policies points to ims_vehicles.id.
-- Calendar events for insurance expiry are managed through fin_insurance_policies.calendar_event_id.

ALTER TABLE ims_vehicles DROP COLUMN IF EXISTS insurance_policy_number;
ALTER TABLE ims_vehicles DROP COLUMN IF EXISTS insurance_provider;
ALTER TABLE ims_vehicles DROP COLUMN IF EXISTS insurance_expiry;
ALTER TABLE ims_vehicles DROP COLUMN IF EXISTS cal_insurance_event_id;
