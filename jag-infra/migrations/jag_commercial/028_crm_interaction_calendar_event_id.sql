-- Migration 028: store Google Calendar event ID on CRM interactions
-- Allows future edit/delete of the follow-up calendar event

ALTER TABLE crm_interactions
  ADD COLUMN IF NOT EXISTS calendar_event_id TEXT;
