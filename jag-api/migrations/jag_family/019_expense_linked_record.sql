-- 018_expense_linked_record.sql
-- Adds cross-module linking + fuel-specific fields to fin_expenses.
-- linked_record_type/id/label: soft cross-DB ref to vehicle, insurance policy,
--   property, or family member (no FK per STD-01).
-- fuel_litres/odometer/type: captured on FUEL expenses so the backend can
--   auto-sync a row into vms_fuel_logs on creation.

ALTER TABLE fin_expenses
  ADD COLUMN linked_record_type  VARCHAR(50)
    CONSTRAINT fin_expenses_linked_type_chk
    CHECK (linked_record_type IN ('VEHICLE','INSURANCE_POLICY','PROPERTY','FAMILY_MEMBER')),
  ADD COLUMN linked_record_id    UUID,
  ADD COLUMN linked_record_label TEXT,
  ADD COLUMN fuel_litres         NUMERIC(10,2),
  ADD COLUMN fuel_odometer_km    INTEGER,
  ADD COLUMN fuel_type           VARCHAR(20)
    CONSTRAINT fin_expenses_fuel_type_chk
    CHECK (fuel_type IN ('PETROL','DIESEL','CNG','ELECTRIC'));
