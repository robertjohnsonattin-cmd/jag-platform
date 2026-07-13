-- Migration 046: Carry employment/DOB data from prop_applications onto the
-- tenant record so the lease PDF's Schedule C (Tenant Information) can be
-- pre-filled instead of asking the tenant to retype data already collected
-- on their rental application — violated the Enter Once principle (see
-- lease-pdf.ts header comment, which explicitly calls this out as the goal).

ALTER TABLE prop_property_tenants ADD COLUMN date_of_birth DATE;
ALTER TABLE prop_property_tenants ADD COLUMN employer_name VARCHAR(200);
ALTER TABLE prop_property_tenants ADD COLUMN employment_type VARCHAR(20);
