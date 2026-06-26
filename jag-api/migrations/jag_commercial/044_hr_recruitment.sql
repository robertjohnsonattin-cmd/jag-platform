-- HR Module — Recruitment / Applicant Tracking System (ATS).
-- Job postings → applicant pipeline → interviews → offer → hire.
-- Hired applicants link to hr_employees via the "Create Employee" flow.

DO $$ BEGIN
  CREATE TYPE hr_posting_status AS ENUM (
    'DRAFT', 'OPEN', 'CLOSED', 'FILLED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE hr_application_stage AS ENUM (
    'APPLIED', 'SCREENING', 'INTERVIEW', 'ASSESSMENT', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE hr_interview_type AS ENUM (
    'PHONE', 'VIDEO', 'IN_PERSON', 'PANEL', 'TECHNICAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE hr_interview_status AS ENUM (
    'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE hr_application_source AS ENUM (
    'WALK_IN', 'REFERRAL', 'ONLINE', 'NEWSPAPER', 'INDEED', 'LINKEDIN', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Job postings ───────────────────────────────────────────────────────────────
CREATE TABLE hr_job_postings (
  id                UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID               NOT NULL,
  position_id       UUID               REFERENCES hr_positions(id) ON DELETE SET NULL,
  department_id     UUID               REFERENCES hr_departments(id) ON DELETE SET NULL,
  title             VARCHAR(200)       NOT NULL,
  description       TEXT,
  requirements      TEXT,
  salary_min_ttd    NUMERIC(15,2),
  salary_max_ttd    NUMERIC(15,2),
  employment_type   hr_employment_type NOT NULL DEFAULT 'FULL_TIME',
  location          VARCHAR(200),
  vacancies         SMALLINT           NOT NULL DEFAULT 1,
  status            hr_posting_status  NOT NULL DEFAULT 'DRAFT',
  posted_date       DATE,
  closing_date      DATE,
  created_at        TIMESTAMPTZ        NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ        NOT NULL DEFAULT now()
);

CREATE INDEX idx_hr_job_postings_tenant ON hr_job_postings (tenant_id, status);

ALTER TABLE hr_job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_job_postings FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_job_postings_tenant ON hr_job_postings
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_job_postings TO jag_app;

-- ── Job applications ───────────────────────────────────────────────────────────
CREATE TABLE hr_job_applications (
  id                    UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID                    NOT NULL,
  job_posting_id        UUID                    NOT NULL REFERENCES hr_job_postings(id) ON DELETE CASCADE,
  applicant_name        VARCHAR(200)            NOT NULL,
  email                 VARCHAR(200),
  phone                 VARCHAR(30),
  address               TEXT,
  current_employer      VARCHAR(200),
  current_title         VARCHAR(200),
  years_experience      SMALLINT,
  cv_url                TEXT,
  cover_letter_url      TEXT,
  source                hr_application_source   NOT NULL DEFAULT 'OTHER',
  referral_employee_id  UUID                    REFERENCES hr_employees(id) ON DELETE SET NULL,
  stage                 hr_application_stage    NOT NULL DEFAULT 'APPLIED',
  rejection_reason      TEXT,
  hired_employee_id     UUID                    REFERENCES hr_employees(id) ON DELETE SET NULL,
  notes                 TEXT,
  created_at            TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ             NOT NULL DEFAULT now()
);

CREATE INDEX idx_hr_applications_posting ON hr_job_applications (job_posting_id, stage);
CREATE INDEX idx_hr_applications_tenant  ON hr_job_applications (tenant_id, stage);

ALTER TABLE hr_job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_job_applications FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_job_applications_tenant ON hr_job_applications
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_job_applications TO jag_app;

-- ── Interviews ─────────────────────────────────────────────────────────────────
CREATE TABLE hr_interviews (
  id                      UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID                  NOT NULL,
  application_id          UUID                  NOT NULL REFERENCES hr_job_applications(id) ON DELETE CASCADE,
  interview_type          hr_interview_type     NOT NULL DEFAULT 'IN_PERSON',
  scheduled_at            TIMESTAMPTZ           NOT NULL,
  duration_minutes        SMALLINT              NOT NULL DEFAULT 60,
  location                VARCHAR(300),
  interviewer_employee_id UUID                  REFERENCES hr_employees(id) ON DELETE SET NULL,
  status                  hr_interview_status   NOT NULL DEFAULT 'SCHEDULED',
  rating                  SMALLINT              CHECK (rating BETWEEN 1 AND 5),
  notes                   TEXT,
  calendar_event_id       TEXT,
  created_at              TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ           NOT NULL DEFAULT now()
);

CREATE INDEX idx_hr_interviews_application ON hr_interviews (application_id);
CREATE INDEX idx_hr_interviews_scheduled   ON hr_interviews (tenant_id, scheduled_at);

ALTER TABLE hr_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_interviews FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_interviews_tenant ON hr_interviews
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_interviews TO jag_app;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO jag_app;
