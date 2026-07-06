-- Migration 041: Screening-gate for public viewing requests
-- Splits the public booking flow into two steps: prospect submits screening
-- answers first (stage='SCREENING'), owner reviews and approves/rejects, and
-- only on approval is a one-time schedule_token issued for the prospect to
-- pick an actual viewing slot (POST /api/v1/public/schedule/:token).

ALTER TABLE prop_enquiries
  ADD COLUMN IF NOT EXISTS schedule_token VARCHAR(64) UNIQUE,
  ADD COLUMN IF NOT EXISTS schedule_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS screening_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS screening_reviewed_by UUID;

CREATE INDEX IF NOT EXISTS idx_prop_enquiries_schedule_token ON prop_enquiries(schedule_token);
