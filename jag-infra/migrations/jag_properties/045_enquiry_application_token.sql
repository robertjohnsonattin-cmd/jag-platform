-- Migration 045: Application token on enquiries for the public /apply form
-- The post-viewing WhatsApp message links to https://jagcorporate.com/apply/<token>;
-- the token resolves to the enquiry (→ unit/property + prefill) so the prospect can
-- self-complete the Stage-2 rental application (writes to prop_applications).

BEGIN;

ALTER TABLE prop_enquiries
  ADD COLUMN IF NOT EXISTS application_token            VARCHAR(64),
  ADD COLUMN IF NOT EXISTS application_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS application_submitted_at     TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_enquiries_application_token
  ON prop_enquiries(application_token) WHERE application_token IS NOT NULL;

COMMIT;
