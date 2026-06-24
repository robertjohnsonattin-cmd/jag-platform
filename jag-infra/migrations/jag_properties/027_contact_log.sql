-- Migration 027 (jag_properties)
-- Manual correspondence log for WhatsApp inbox
-- Allows Robert to log phone calls, in-person visits, and notes against a contact
-- These appear in the unified conversation timeline alongside automated WA messages

CREATE TABLE prop_contact_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL,
  contact_phone   VARCHAR(30) NOT NULL,      -- the contact this log entry is about
  log_type        VARCHAR(20) NOT NULL CHECK (log_type IN (
                    'CALL_INBOUND',
                    'CALL_OUTBOUND',
                    'WHATSAPP_CALL',          -- WA voice call (not logged automatically)
                    'IN_PERSON',
                    'NOTE',
                    'EMAIL'
                  )),
  body            TEXT NOT NULL,             -- notes / summary of the interaction
  duration_mins   INTEGER,                   -- for calls, optional
  enquiry_id      UUID REFERENCES prop_enquiries(id) ON DELETE SET NULL,
  ticket_id       UUID REFERENCES prop_maintenance_tickets(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID
);

ALTER TABLE prop_contact_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY prop_contact_log_owner ON prop_contact_log
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_contact_log_phone ON prop_contact_log(owner_id, contact_phone, created_at DESC);
