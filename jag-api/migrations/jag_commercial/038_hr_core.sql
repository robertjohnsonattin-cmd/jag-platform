-- HR Module — Core tables: departments, positions, employees, emergency contacts, employment history.
-- Covers all 7 JAG entities via tenant RLS (same pattern as ims_vehicles, gps_trackers, etc.).

-- Employment type enum
DO $$ BEGIN
  CREATE TYPE hr_employment_type AS ENUM (
    'FULL_TIME', 'PART_TIME', 'CONTRACT', 'CASUAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Employee status enum
DO $$ BEGIN
  CREATE TYPE hr_employee_status AS ENUM (
    'ACTIVE', 'INACTIVE', 'TERMINATED', 'ON_LEAVE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ID document type enum
DO $$ BEGIN
  CREATE TYPE hr_id_type AS ENUM (
    'NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENCE', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Pay frequency enum
DO $$ BEGIN
  CREATE TYPE hr_pay_frequency AS ENUM (
    'MONTHLY', 'BIWEEKLY', 'WEEKLY'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Departments ────────────────────────────────────────────────────────────────
CREATE TABLE hr_departments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL,
  name              VARCHAR(200) NOT NULL,
  code              VARCHAR(20)  NOT NULL,
  parent_dept_id    UUID        REFERENCES hr_departments(id) ON DELETE SET NULL,
  manager_employee_id UUID,   -- soft ref; FK added after hr_employees created below
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX idx_hr_departments_tenant ON hr_departments (tenant_id);

ALTER TABLE hr_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_departments FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_departments_tenant ON hr_departments
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_departments TO jag_app;

-- ── Positions / Job titles ─────────────────────────────────────────────────────
CREATE TABLE hr_positions (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL,
  name              VARCHAR(200)  NOT NULL,
  code              VARCHAR(20)   NOT NULL,
  department_id     UUID          REFERENCES hr_departments(id) ON DELETE SET NULL,
  min_salary_ttd    NUMERIC(15,2),
  max_salary_ttd    NUMERIC(15,2),
  description       TEXT,
  is_active         BOOLEAN       NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX idx_hr_positions_tenant ON hr_positions (tenant_id);

ALTER TABLE hr_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_positions FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_positions_tenant ON hr_positions
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_positions TO jag_app;

-- ── Employees ──────────────────────────────────────────────────────────────────
CREATE TABLE hr_employees (
  id                    UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID                 NOT NULL,

  -- Identity
  employee_number       VARCHAR(30)          NOT NULL,
  first_name            VARCHAR(100)         NOT NULL,
  last_name             VARCHAR(100)         NOT NULL,
  preferred_name        VARCHAR(100),
  date_of_birth         DATE,
  gender                VARCHAR(20),
  nationality           VARCHAR(100),
  id_type               hr_id_type,
  id_number             VARCHAR(50),
  nis_number            VARCHAR(30),
  birs_tax_id           VARCHAR(30),

  -- Contact
  address               TEXT,
  city                  VARCHAR(100),
  email                 VARCHAR(200),
  phone                 VARCHAR(30),
  phone2                VARCHAR(30),

  -- Employment
  position_id           UUID                 REFERENCES hr_positions(id) ON DELETE SET NULL,
  department_id         UUID                 REFERENCES hr_departments(id) ON DELETE SET NULL,
  manager_id            UUID                 REFERENCES hr_employees(id) ON DELETE SET NULL,
  employment_type       hr_employment_type   NOT NULL DEFAULT 'FULL_TIME',
  status                hr_employee_status   NOT NULL DEFAULT 'ACTIVE',
  hire_date             DATE                 NOT NULL,
  probation_end_date    DATE,
  termination_date      DATE,
  termination_reason    TEXT,

  -- Compensation
  base_salary_ttd       NUMERIC(15,2)        NOT NULL DEFAULT 0,
  pay_frequency         hr_pay_frequency     NOT NULL DEFAULT 'MONTHLY',

  -- Banking
  bank_name             VARCHAR(200),
  bank_branch           VARCHAR(200),
  account_number        VARCHAR(50),
  account_type          VARCHAR(20),

  -- Misc
  profile_photo_url     TEXT,
  notes                 TEXT,
  crm_contact_id        UUID,   -- soft ref to crm_contacts (cross-DB, no FK per STD-01)

  -- Audit
  created_at            TIMESTAMPTZ          NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ          NOT NULL DEFAULT now(),
  last_modified_by      UUID,

  UNIQUE (tenant_id, employee_number)
);

CREATE INDEX idx_hr_employees_tenant         ON hr_employees (tenant_id);
CREATE INDEX idx_hr_employees_status         ON hr_employees (tenant_id, status);
CREATE INDEX idx_hr_employees_department     ON hr_employees (tenant_id, department_id);
CREATE INDEX idx_hr_employees_position       ON hr_employees (tenant_id, position_id);

ALTER TABLE hr_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employees FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_employees_tenant ON hr_employees
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_employees TO jag_app;

-- Back-fill the FK on hr_departments now that hr_employees exists
ALTER TABLE hr_departments
  ADD CONSTRAINT fk_hr_departments_manager
  FOREIGN KEY (manager_employee_id) REFERENCES hr_employees(id) ON DELETE SET NULL;

-- ── Emergency contacts ─────────────────────────────────────────────────────────
CREATE TABLE hr_emergency_contacts (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL,
  employee_id   UUID          NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  name          VARCHAR(200)  NOT NULL,
  relationship  VARCHAR(100)  NOT NULL,
  phone         VARCHAR(30)   NOT NULL,
  phone2        VARCHAR(30),
  email         VARCHAR(200),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_hr_emergency_contacts_employee ON hr_emergency_contacts (employee_id);

ALTER TABLE hr_emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_emergency_contacts FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_emergency_contacts_tenant ON hr_emergency_contacts
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_emergency_contacts TO jag_app;

-- ── Employment history (salary / position changes) ─────────────────────────────
CREATE TABLE hr_employment_history (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL,
  employee_id           UUID          NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  effective_date        DATE          NOT NULL,
  change_type           VARCHAR(50)   NOT NULL, -- SALARY_CHANGE / PROMOTION / TRANSFER / STATUS_CHANGE / etc.
  previous_position     VARCHAR(200),
  new_position          VARCHAR(200),
  previous_department   VARCHAR(200),
  new_department        VARCHAR(200),
  previous_salary_ttd   NUMERIC(15,2),
  new_salary_ttd        NUMERIC(15,2),
  change_reason         TEXT,
  changed_by            UUID,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_hr_employment_history_employee ON hr_employment_history (employee_id, effective_date DESC);

ALTER TABLE hr_employment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employment_history FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_employment_history_tenant ON hr_employment_history
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON hr_employment_history TO jag_app;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO jag_app;
