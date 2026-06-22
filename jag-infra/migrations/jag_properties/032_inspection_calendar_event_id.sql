-- Migration 032: calendar event ID on property inspections
-- STD-04: versioned migration, never run raw SQL on production

ALTER TABLE prop_inspections
  ADD COLUMN IF NOT EXISTS calendar_event_id text;
