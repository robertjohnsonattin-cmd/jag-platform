-- Migration 014: Scheduled Viewings
-- Availability is managed in Google Calendar directly; JAG stores the booking record.

CREATE TABLE prop_viewings (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                   UUID NOT NULL,
  enquiry_id                 UUID NOT NULL REFERENCES prop_enquiries(id) ON DELETE CASCADE,
  unit_id                    UUID NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  scheduled_at               TIMESTAMPTZ NOT NULL,
  google_event_id            VARCHAR(200),
  status                     VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED','CONFIRMED','COMPLETED','NO_SHOW','CANCELLED','RESCHEDULED')),
  confirmation_sent_at       TIMESTAMPTZ,
  reminder_24h_sent_at       TIMESTAMPTZ,
  reminder_1h_sent_at        TIMESTAMPTZ,
  no_show_followup_sent_at   TIMESTAMPTZ,
  post_viewing_app_link_sent_at TIMESTAMPTZ,
  notes                      TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_viewings ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_viewings_owner ON prop_viewings
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_viewings_scheduled ON prop_viewings(scheduled_at);
CREATE INDEX idx_prop_viewings_status    ON prop_viewings(status);
CREATE INDEX idx_prop_viewings_enquiry   ON prop_viewings(enquiry_id);
