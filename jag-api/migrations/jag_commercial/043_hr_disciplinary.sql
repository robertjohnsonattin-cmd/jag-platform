-- HR Module — Disciplinary and grievance records.

DO $$ BEGIN
  CREATE TYPE hr_disciplinary_severity AS ENUM (
    'VERBAL_WARNING', 'WRITTEN_WARNING', 'FINAL_WARNING', 'SUSPENSION', 'DISMISSAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE hr_incident_type AS ENUM (
    'TARDINESS', 'INSUBORDINATION', 'MISCONDUCT', 'PERFORMANCE',
    'POLICY_VIOLATION', 'ATTENDANCE', 'HEALTH_SAFETY', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE hr_disciplinary_records (
  id                          UUID                       PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID                       NOT NULL,
  employee_id                 UUID                       NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,

  incident_date               DATE                       NOT NULL,
  reported_date               DATE,
  incident_type               hr_incident_type           NOT NULL,
  severity                    hr_disciplinary_severity   NOT NULL,

  description                 TEXT                       NOT NULL,
  action_taken                TEXT,
  outcome                     TEXT,

  investigation_conducted     BOOLEAN                    NOT NULL DEFAULT false,
  union_involved              BOOLEAN                    NOT NULL DEFAULT false,
  appeal_filed                BOOLEAN                    NOT NULL DEFAULT false,
  appeal_outcome              TEXT,

  issued_by_employee_id       UUID                       REFERENCES hr_employees(id) ON DELETE SET NULL,
  acknowledged_by_employee    BOOLEAN                    NOT NULL DEFAULT false,
  acknowledged_at             TIMESTAMPTZ,

  document_url                TEXT,

  created_at                  TIMESTAMPTZ                NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ                NOT NULL DEFAULT now(),
  last_modified_by            UUID
);

CREATE INDEX idx_hr_disciplinary_employee ON hr_disciplinary_records (employee_id, incident_date DESC);
CREATE INDEX idx_hr_disciplinary_tenant   ON hr_disciplinary_records (tenant_id);

ALTER TABLE hr_disciplinary_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_disciplinary_records FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_disciplinary_records_tenant ON hr_disciplinary_records
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON hr_disciplinary_records TO jag_app;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO jag_app;
