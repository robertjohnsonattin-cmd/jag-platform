-- Migration 062: structured Category/Priority/Responsible/Trade/Est Hours fields
--
-- prop_scheduled_maintenance (migration 057) only captured title/frequency/next_due_date/
-- contractor/cost/notes. The source planning workbook (JAG Preventive Maintenance
-- Schedule.xlsx) carries richer fields per task -- Category, Priority, Responsible
-- (In-house/Contractor/Tenant/Office), Suggested Trade, Est Hours -- needed to print a
-- usable weekly/daily crew schedule. Adding them as real columns (previously only
-- present as free text inside `notes`/`description`) so they're editable in-app and
-- usable for print-schedule sorting/filtering. All nullable/additive -- no data loss.

ALTER TABLE prop_scheduled_maintenance
  ADD COLUMN category    VARCHAR(30),
  ADD COLUMN priority     VARCHAR(10) CHECK (priority IN ('LOW','MED','HIGH')),
  ADD COLUMN responsible  VARCHAR(20) CHECK (responsible IN ('IN_HOUSE','CONTRACTOR','TENANT','OFFICE')),
  ADD COLUMN trade        VARCHAR(50),
  ADD COLUMN est_hours    NUMERIC(5,2);
