-- HR Module — Training records and certifications.

DO $$ BEGIN
  CREATE TYPE hr_training_status AS ENUM (
    'PLANNED', 'COMPLETED', 'EXPIRED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Training types (categories / catalogue) ────────────────────────────────────
CREATE TABLE hr_training_types (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL,
  name          VARCHAR(200)  NOT NULL,
  category      VARCHAR(100),   -- e.g. Safety, Compliance, Technical, Soft Skills
  description   TEXT,
  is_active     BOOLEAN       NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_hr_training_types_tenant ON hr_training_types (tenant_id);

ALTER TABLE hr_training_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_training_types FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_training_types_tenant ON hr_training_types
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_training_types TO jag_app;

-- ── Training records (per employee) ───────────────────────────────────────────
CREATE TABLE hr_training_records (
  id                UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID                NOT NULL,
  employee_id       UUID                NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  training_type_id  UUID                REFERENCES hr_training_types(id) ON DELETE SET NULL,
  training_name     VARCHAR(300)        NOT NULL,
  provider          VARCHAR(200),
  training_date     DATE,
  expiry_date       DATE,
  certificate_number VARCHAR(100),
  certificate_url   TEXT,
  cost_ttd          NUMERIC(12,2),
  status            hr_training_status  NOT NULL DEFAULT 'PLANNED',
  notes             TEXT,
  created_at        TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_hr_training_records_employee ON hr_training_records (employee_id, training_date DESC);
CREATE INDEX idx_hr_training_records_expiry   ON hr_training_records (tenant_id, expiry_date) WHERE expiry_date IS NOT NULL;

ALTER TABLE hr_training_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_training_records FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_training_records_tenant ON hr_training_records
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_training_records TO jag_app;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO jag_app;
