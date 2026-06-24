-- Migration 029 (jag_properties)
-- Tracks the 1-hour-before viewing reminder separately from the 24h reminder
-- reminder_sent_at = 24h reminder; reminder_1h_sent_at = 1h reminder

ALTER TABLE prop_viewings
  ADD COLUMN IF NOT EXISTS reminder_1h_sent_at TIMESTAMPTZ;
