-- Migration 036: fam_clinic_registrations — which clinics/facilities a family member
-- is enrolled at, their registration number there, and their next appointment (synced
-- to Google Calendar). Robert asked for an easy-reference table of clinic enrollments
-- after a full medical-records review found registration numbers and appointment
-- history scattered across many individual clinic-card records with no single
-- summary view, and no way to track/sync a genuinely upcoming appointment at all.

CREATE TABLE fam_clinic_registrations (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id               UUID          NOT NULL,
  family_member_id       UUID          NOT NULL REFERENCES fam_family_members(id) ON DELETE CASCADE,
  facility_name          VARCHAR(200)  NOT NULL,
  department             VARCHAR(100),
  registration_number    VARCHAR(50),
  next_appointment_date  DATE,
  calendar_event_id      TEXT,
  notes                  TEXT,
  last_modified_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_modified_by       UUID,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_fam_clinic_registrations_member ON fam_clinic_registrations (family_member_id);
CREATE INDEX idx_fam_clinic_registrations_next_appt ON fam_clinic_registrations (next_appointment_date);

ALTER TABLE fam_clinic_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY fam_clinic_registrations_owner ON fam_clinic_registrations
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON fam_clinic_registrations TO jag_app;
