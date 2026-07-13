-- Adds proration tracking to prop_rent_schedule (STD-13 expand-only).
-- generateRentSchedule() now prorates the first/last calendar-month period
-- when a lease starts or ends mid-month; these columns record the exact
-- occupied-day window and flag which periods were prorated, for receipts
-- and any future audit.
ALTER TABLE prop_rent_schedule
  ADD COLUMN IF NOT EXISTS period_start_date DATE,
  ADD COLUMN IF NOT EXISTS period_end_date   DATE,
  ADD COLUMN IF NOT EXISTS is_prorated       BOOLEAN NOT NULL DEFAULT false;
