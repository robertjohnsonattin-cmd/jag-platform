-- HR Module — Performance reviews (annual, mid-year, probation).

DO $$ BEGIN
  CREATE TYPE hr_review_period AS ENUM (
    'PROBATION', 'MID_YEAR', 'ANNUAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE hr_review_status AS ENUM (
    'DRAFT', 'SUBMITTED', 'ACKNOWLEDGED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE hr_performance_reviews (
  id                        UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID              NOT NULL,
  employee_id               UUID              NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  reviewer_id               UUID              REFERENCES hr_employees(id) ON DELETE SET NULL,

  review_period             hr_review_period  NOT NULL,
  review_year               SMALLINT          NOT NULL,
  review_date               DATE,

  -- Ratings 1–5 (1=Unsatisfactory, 5=Outstanding)
  overall_rating            SMALLINT          CHECK (overall_rating BETWEEN 1 AND 5),
  goals_met_rating          SMALLINT          CHECK (goals_met_rating BETWEEN 1 AND 5),
  competency_rating         SMALLINT          CHECK (competency_rating BETWEEN 1 AND 5),
  attendance_rating         SMALLINT          CHECK (attendance_rating BETWEEN 1 AND 5),

  -- Narrative
  strengths                 TEXT,
  areas_for_improvement     TEXT,
  goals_next_period         TEXT,
  employee_comments         TEXT,

  status                    hr_review_status  NOT NULL DEFAULT 'DRAFT',
  acknowledged_at           TIMESTAMPTZ,

  created_at                TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ       NOT NULL DEFAULT now()
);

CREATE INDEX idx_hr_perf_reviews_employee ON hr_performance_reviews (employee_id, review_year DESC);
CREATE INDEX idx_hr_perf_reviews_tenant   ON hr_performance_reviews (tenant_id);

ALTER TABLE hr_performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_performance_reviews FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_performance_reviews_tenant ON hr_performance_reviews
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON hr_performance_reviews TO jag_app;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO jag_app;
