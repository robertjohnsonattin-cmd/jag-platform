-- Migration 028 (jag_properties)
-- Add reminder tracking columns to prop_rent_schedule
-- Tracks D-1, D+1 missed payment, D+7 and D+14 escalation sends
-- Prevents duplicate sends when cron re-runs

ALTER TABLE prop_rent_schedule
  ADD COLUMN IF NOT EXISTS d1_reminder_sent_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS missed_d1_sent_at      TIMESTAMPTZ;
