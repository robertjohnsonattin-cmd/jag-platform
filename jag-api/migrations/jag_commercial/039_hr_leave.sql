-- HR Module — Leave management: leave types, balances, and requests.

-- Leave request status enum
DO $$ BEGIN
  CREATE TYPE hr_leave_status AS ENUM (
    'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Leave types ────────────────────────────────────────────────────────────────
-- Seeded with T&T standard types; entities can add their own.
CREATE TABLE hr_leave_types (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL,
  name              VARCHAR(100)  NOT NULL,
  code              VARCHAR(20)   NOT NULL,
  days_per_year     NUMERIC(5,1)  NOT NULL DEFAULT 14,
  is_paid           BOOLEAN       NOT NULL DEFAULT true,
  carry_over_days   NUMERIC(5,1)  NOT NULL DEFAULT 0,
  requires_approval BOOLEAN       NOT NULL DEFAULT true,
  description       TEXT,
  is_active         BOOLEAN       NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX idx_hr_leave_types_tenant ON hr_leave_types (tenant_id);

ALTER TABLE hr_leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_types FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_leave_types_tenant ON hr_leave_types
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_leave_types TO jag_app;

-- ── Leave balances (per employee, per type, per year) ─────────────────────────
CREATE TABLE hr_leave_balances (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL,
  employee_id       UUID          NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  leave_type_id     UUID          NOT NULL REFERENCES hr_leave_types(id) ON DELETE CASCADE,
  year              SMALLINT      NOT NULL,
  entitled_days     NUMERIC(5,1)  NOT NULL DEFAULT 0,
  used_days         NUMERIC(5,1)  NOT NULL DEFAULT 0,
  carried_over_days NUMERIC(5,1)  NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, leave_type_id, year)
);

CREATE INDEX idx_hr_leave_balances_employee ON hr_leave_balances (employee_id, year);

ALTER TABLE hr_leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_balances FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_leave_balances_tenant ON hr_leave_balances
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON hr_leave_balances TO jag_app;

-- ── Leave requests ─────────────────────────────────────────────────────────────
CREATE TABLE hr_leave_requests (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID            NOT NULL,
  employee_id       UUID            NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  leave_type_id     UUID            NOT NULL REFERENCES hr_leave_types(id),
  start_date        DATE            NOT NULL,
  end_date          DATE            NOT NULL,
  days_requested    NUMERIC(5,1)    NOT NULL,
  reason            TEXT,
  status            hr_leave_status NOT NULL DEFAULT 'PENDING',
  approved_by       UUID,           -- references hr_employees.id (soft)
  approved_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_hr_leave_requests_employee ON hr_leave_requests (employee_id, start_date DESC);
CREATE INDEX idx_hr_leave_requests_pending  ON hr_leave_requests (tenant_id, status) WHERE status = 'PENDING';

ALTER TABLE hr_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_leave_requests_tenant ON hr_leave_requests
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON hr_leave_requests TO jag_app;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO jag_app;
