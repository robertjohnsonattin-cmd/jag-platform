-- Migration 016: calendar event ID on finance insurance policies
-- STD-04: versioned migration, never run raw SQL on production

ALTER TABLE fin_insurance_policies
  ADD COLUMN IF NOT EXISTS calendar_event_id text;
