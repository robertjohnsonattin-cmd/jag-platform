-- HR Module — Time & Attendance: weekly timesheets and daily time entries.
-- hours_worked is computed on insert/update; stored for fast aggregation.

DO $$ BEGIN
  CREATE TYPE hr_timesheet_status AS ENUM (
    'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE hr_time_entry_type AS ENUM (
    'REGULAR', 'OVERTIME', 'PUBLIC_HOLIDAY', 'SICK', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Timesheets (one per employee per week) ─────────────────────────────────────
CREATE TABLE hr_timesheets (
  id                UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID                  NOT NULL,
  employee_id       UUID                  NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  week_start_date   DATE                  NOT NULL,  -- always a Monday
  week_end_date     DATE                  NOT NULL,  -- always the Sunday following
  status            hr_timesheet_status   NOT NULL DEFAULT 'DRAFT',
  total_hours       NUMERIC(6,2)          NOT NULL DEFAULT 0,
  total_overtime_hours NUMERIC(6,2)       NOT NULL DEFAULT 0,
  approved_by       UUID,                 -- soft ref hr_employees.id
  approved_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ           NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, week_start_date)
);

CREATE INDEX idx_hr_timesheets_employee ON hr_timesheets (employee_id, week_start_date DESC);
CREATE INDEX idx_hr_timesheets_pending  ON hr_timesheets (tenant_id, status) WHERE status IN ('SUBMITTED');

ALTER TABLE hr_timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_timesheets FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_timesheets_tenant ON hr_timesheets
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON hr_timesheets TO jag_app;

-- ── Time entries (one per day per employee) ────────────────────────────────────
CREATE TABLE hr_time_entries (
  id              UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID                  NOT NULL,
  employee_id     UUID                  NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  timesheet_id    UUID                  REFERENCES hr_timesheets(id) ON DELETE SET NULL,
  entry_date      DATE                  NOT NULL,
  clock_in        TIMESTAMPTZ,
  clock_out       TIMESTAMPTZ,
  break_minutes   SMALLINT              NOT NULL DEFAULT 0,
  -- hours_worked stored (not generated) so it can be set manually / adjusted
  hours_worked    NUMERIC(5,2)          NOT NULL DEFAULT 0,
  is_overtime     BOOLEAN               NOT NULL DEFAULT false,
  entry_type      hr_time_entry_type    NOT NULL DEFAULT 'REGULAR',
  notes           TEXT,
  created_at      TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ           NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, entry_date)
);

CREATE INDEX idx_hr_time_entries_employee ON hr_time_entries (employee_id, entry_date DESC);
CREATE INDEX idx_hr_time_entries_timesheet ON hr_time_entries (timesheet_id);

ALTER TABLE hr_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_time_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_time_entries_tenant ON hr_time_entries
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_time_entries TO jag_app;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO jag_app;
