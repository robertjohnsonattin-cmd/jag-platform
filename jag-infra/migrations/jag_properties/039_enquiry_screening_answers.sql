-- Migration 039: Pre-viewing screening questionnaire
-- Collected on the public booking page before a viewing request is accepted.
-- Stored as JSONB (single column) rather than one column per question since this
-- is a lightweight pre-screen, not the full tenancy application (prop_applications
-- already has structured employment/income/reference columns for that later stage).

ALTER TABLE prop_enquiries
  ADD COLUMN IF NOT EXISTS screening_answers JSONB;
