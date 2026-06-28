-- Migration 046: HR Salary Advances and Staff Loans
-- Salary advances: amounts paid early, recovered over subsequent pay runs
-- Staff loans: interest-bearing or interest-free loans repaid via payroll deductions

-- ── Salary Advances ───────────────────────────────────────────────────────────
CREATE TABLE hr_salary_advances (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL,
  employee_id               UUID NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,

  advance_date              DATE NOT NULL DEFAULT CURRENT_DATE,
  amount_ttd                NUMERIC(12,2) NOT NULL CHECK (amount_ttd > 0),
  reason                    TEXT,

  -- Recovery configuration
  recovery_installment_ttd  NUMERIC(12,2) NOT NULL CHECK (recovery_installment_ttd > 0),
  total_recovered_ttd       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_recovered_ttd >= 0),

  status                    VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                              CHECK (status IN ('ACTIVE','RECOVERED','WRITTEN_OFF','CANCELLED')),

  approved_by               TEXT,
  notes                     TEXT,
  created_by                UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE hr_salary_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_salary_advances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hr_salary_advances
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE INDEX idx_hr_advances_employee ON hr_salary_advances (tenant_id, employee_id, status);

GRANT SELECT, INSERT, UPDATE ON hr_salary_advances TO jag_app;

-- ── Staff Loans ───────────────────────────────────────────────────────────────
CREATE TABLE hr_staff_loans (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL,
  employee_id               UUID NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,

  loan_date                 DATE NOT NULL DEFAULT CURRENT_DATE,
  principal_ttd             NUMERIC(12,2) NOT NULL CHECK (principal_ttd > 0),
  interest_rate             NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (interest_rate >= 0),
  monthly_installment_ttd   NUMERIC(12,2) NOT NULL CHECK (monthly_installment_ttd > 0),
  total_repaid_ttd          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_repaid_ttd >= 0),
  outstanding_balance_ttd   NUMERIC(12,2) NOT NULL,

  reason                    TEXT,
  status                    VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                              CHECK (status IN ('ACTIVE','PAID_OFF','WRITTEN_OFF','CANCELLED')),

  approved_by               TEXT,
  notes                     TEXT,
  created_by                UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE hr_staff_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_staff_loans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hr_staff_loans
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE INDEX idx_hr_loans_employee ON hr_staff_loans (tenant_id, employee_id, status);

GRANT SELECT, INSERT, UPDATE ON hr_staff_loans TO jag_app;

-- ── Extend hr_payroll_deduction_items for advance/loan references ─────────────
ALTER TABLE hr_payroll_deduction_items
  ADD COLUMN IF NOT EXISTS reference_id UUID;

ALTER TABLE hr_payroll_deduction_items
  DROP CONSTRAINT IF EXISTS hr_payroll_deduction_items_deduction_type_check;

ALTER TABLE hr_payroll_deduction_items
  ADD CONSTRAINT hr_payroll_deduction_items_deduction_type_check
  CHECK (deduction_type IN ('LOAN_REPAYMENT','ADVANCE_RECOVERY','HEALTH_INSURANCE','UNION_DUES','UNIFORM','PENSION','OTHER'));
