-- Migration 030 (jag_properties)
-- Track when a "stale listing" WA alert was last sent to the owner
-- Prevents the daily cron from re-alerting on the same unit every day

ALTER TABLE prop_units
  ADD COLUMN IF NOT EXISTS stale_alert_sent_at TIMESTAMPTZ;
