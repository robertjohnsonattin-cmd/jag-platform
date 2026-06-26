-- HR Module — Payroll: pay runs, per-employee entries, and ad-hoc deduction line items.
-- T&T statutory deductions (NIS, Health Surcharge, PAYE) are calculated by
-- jag-api/src/lib/tt-payroll.ts and stored in hr_payroll_entries at run calculation time.
-- GL posting to jag_family happens non-blocking when a run is finalized.

-- Payroll run status enum
DO $$ BEGIN
  CREATE TYPE hr_payroll_run_status AS ENUM (
    'DRAFT', 'FINALIZED', 'PAID'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Payroll entry status enum
DO $$ BEGIN
  CREATE TYPE hr_payroll_entry_status AS ENUM (
    'INCLUDED', 'EXCLUDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Payroll runs (one per entity per period) ───────────────────────────────────
CREATE TABLE hr_payroll_runs (
  id                        UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID                    NOT NULL,
  period_month              SMALLINT                NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year               SMALLINT                NOT NULL CHECK (period_year >= 2020),
  pay_date                  DATE,
  status                    hr_payroll_run_status   NOT NULL DEFAULT 'DRAFT',

  -- Totals (populated after calculate step)
  total_gross_ttd           NUMERIC(15,2)           NOT NULL DEFAULT 0,
  total_net_ttd             NUMERIC(15,2)           NOT NULL DEFAULT 0,
  total_nis_employee_ttd    NUMERIC(15,2)           NOT NULL DEFAULT 0,
  total_nis_employer_ttd    NUMERIC(15,2)           NOT NULL DEFAULT 0,
  total_paye_ttd            NUMERIC(15,2)           NOT NULL DEFAULT 0,
  total_health_surcharge_ttd NUMERIC(15,2)          NOT NULL DEFAULT 0,

  -- Finance integration
  journal_entry_id          UUID,                   -- set after GL post (soft ref to fin_journal_entries)

  -- Audit
  idempotency_key           TEXT                    NOT NULL UNIQUE,
  created_by                UUID,
  notes                     TEXT,
  created_at                TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ             NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, period_month, period_year)
);

CREATE INDEX idx_hr_payroll_runs_tenant ON hr_payroll_runs (tenant_id, period_year DESC, period_month DESC);

ALTER TABLE hr_payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_payroll_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_payroll_runs_tenant ON hr_payroll_runs
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON hr_payroll_runs TO jag_app;

-- ── Payroll entries (one per employee per run) ────────────────────────────────
CREATE TABLE hr_payroll_entries (
  id                    UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID                        NOT NULL,
  payroll_run_id        UUID                        NOT NULL REFERENCES hr_payroll_runs(id) ON DELETE CASCADE,
  employee_id           UUID                        NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,

  -- Earnings
  base_salary_ttd       NUMERIC(15,2)               NOT NULL DEFAULT 0,
  overtime_hours        NUMERIC(6,2)                NOT NULL DEFAULT 0,
  overtime_rate_ttd     NUMERIC(10,2)               NOT NULL DEFAULT 0,
  overtime_pay_ttd      NUMERIC(15,2)               NOT NULL DEFAULT 0,
  bonus_ttd             NUMERIC(15,2)               NOT NULL DEFAULT 0,
  other_allowances_ttd  NUMERIC(15,2)               NOT NULL DEFAULT 0,
  total_gross_ttd       NUMERIC(15,2)               NOT NULL DEFAULT 0,

  -- T&T statutory deductions (calculated by tt-payroll.ts)
  nis_employee_ttd      NUMERIC(15,2)               NOT NULL DEFAULT 0,
  health_surcharge_ttd  NUMERIC(15,2)               NOT NULL DEFAULT 0,
  paye_ttd              NUMERIC(15,2)               NOT NULL DEFAULT 0,
  nis_employer_ttd      NUMERIC(15,2)               NOT NULL DEFAULT 0,  -- employer-side cost

  -- Other deductions (see hr_payroll_deduction_items for line items)
  other_deductions_ttd  NUMERIC(15,2)               NOT NULL DEFAULT 0,
  total_deductions_ttd  NUMERIC(15,2)               NOT NULL DEFAULT 0,
  net_pay_ttd           NUMERIC(15,2)               NOT NULL DEFAULT 0,

  -- Leave without pay used in this period
  unpaid_leave_days     NUMERIC(5,1)                NOT NULL DEFAULT 0,

  status                hr_payroll_entry_status     NOT NULL DEFAULT 'INCLUDED',
  notes                 TEXT,

  created_at            TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ                 NOT NULL DEFAULT now(),

  UNIQUE (payroll_run_id, employee_id)
);

CREATE INDEX idx_hr_payroll_entries_run      ON hr_payroll_entries (payroll_run_id);
CREATE INDEX idx_hr_payroll_entries_employee ON hr_payroll_entries (employee_id);

ALTER TABLE hr_payroll_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_payroll_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_payroll_entries_tenant ON hr_payroll_entries
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON hr_payroll_entries TO jag_app;

-- ── Ad-hoc deduction line items ────────────────────────────────────────────────
-- For items like loans, uniform deductions, health insurance, union dues, etc.
CREATE TABLE hr_payroll_deduction_items (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL,
  payroll_entry_id  UUID          NOT NULL REFERENCES hr_payroll_entries(id) ON DELETE CASCADE,
  label             VARCHAR(200)  NOT NULL,
  amount_ttd        NUMERIC(15,2) NOT NULL CHECK (amount_ttd >= 0),
  deduction_type    VARCHAR(50)   NOT NULL DEFAULT 'OTHER'
    CHECK (deduction_type IN ('LOAN_REPAYMENT','HEALTH_INSURANCE','UNION_DUES','UNIFORM','PENSION','OTHER')),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_hr_payroll_deductions_entry ON hr_payroll_deduction_items (payroll_entry_id);

ALTER TABLE hr_payroll_deduction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_payroll_deduction_items FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_payroll_deductions_tenant ON hr_payroll_deduction_items
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, DELETE ON hr_payroll_deduction_items TO jag_app;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO jag_app;
