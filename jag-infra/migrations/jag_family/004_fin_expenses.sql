-- jag_family — Migration 004: Expense management schema (Phase 5)
-- Run against jag_family as jag_app.
--
-- Design:
--   Expenses flow through a status lifecycle: DRAFT → SUBMITTED → APPROVED / REJECTED.
--   On APPROVED, a GL journal entry is auto-posted:
--     Debit:  gl_debit_account_id  (expense account, 5xxx)
--     Credit: gl_credit_account_id (bank/cash/AP account, 1xxx or 2xxx)
--   Rejected expenses may be corrected and resubmitted.
--   Receipts are stored as MinIO paths.
--
-- RLS: withOwnerRLS — app.current_owner_id

-- ── ENUMS ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE expense_status AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE expense_payment_method AS ENUM (
    'CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'CHEQUE', 'DIRECT_DEBIT', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── fin_expenses ──────────────────────────────────────────────────────────────

CREATE TABLE fin_expenses (
  id                   UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id             UUID                    NOT NULL,
  owner_entity_id      UUID                    NOT NULL,   -- jag_core.tenants.id
  submitted_by         UUID                    NOT NULL,   -- jag_core.users.id
  expense_date         DATE                    NOT NULL,
  description          TEXT                    NOT NULL,
  payee_name           VARCHAR(200),
  amount               NUMERIC(18,2)           NOT NULL,
  currency             CHAR(3)                 NOT NULL DEFAULT 'TTD',
  amount_ttd           NUMERIC(18,2)           NOT NULL,   -- always in TTD
  fx_rate_used         NUMERIC(12,6),                      -- null when currency = TTD
  payment_method       expense_payment_method  NOT NULL DEFAULT 'BANK_TRANSFER',
  category             TEXT                    NOT NULL DEFAULT 'OPERATING_EXPENSE'
    CHECK (category IN (
      'SALARY','DIVIDEND','RENTAL_INCOME','INTEREST_INCOME','TRANSFER_IN',
      'OPERATING_EXPENSE','PAYROLL','TAX_PAYMENT','LOAN_REPAYMENT',
      'INVESTMENT_PURCHASE','INVESTMENT_SALE','TRANSFER_OUT',
      'PERSONAL_EXPENSE','UTILITIES','INSURANCE','ENTERTAINMENT',
      'TRAVEL','MEDICAL','EDUCATION','CHARITY','UNCLASSIFIED'
    )),
  -- GL accounts — set by submitter, confirmed/overridden at approval
  gl_debit_account_id  UUID                    REFERENCES fin_gl_accounts(id),   -- expense account (5xxx)
  gl_credit_account_id UUID                    REFERENCES fin_gl_accounts(id),   -- bank/cash/AP (1xxx/2xxx)
  -- Workflow
  status               expense_status          NOT NULL DEFAULT 'DRAFT',
  submitted_at         TIMESTAMPTZ,
  approved_by          UUID,                   -- jag_core.users.id (Owner only)
  approved_at          TIMESTAMPTZ,
  rejection_reason     TEXT,
  -- GL link — populated on approval
  journal_entry_id     UUID                    REFERENCES fin_journal_entries(id),
  -- Receipt
  receipt_path         VARCHAR(500),           -- MinIO path
  receipt_filename     VARCHAR(200),
  -- Audit
  notes                TEXT,
  idempotency_key      TEXT                    NOT NULL UNIQUE,
  created_at           TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ             NOT NULL DEFAULT now()
);

CREATE INDEX idx_exp_owner          ON fin_expenses(owner_id);
CREATE INDEX idx_exp_entity         ON fin_expenses(owner_entity_id);
CREATE INDEX idx_exp_status         ON fin_expenses(status);
CREATE INDEX idx_exp_date           ON fin_expenses(expense_date);
CREATE INDEX idx_exp_submitted_by   ON fin_expenses(submitted_by);
CREATE INDEX idx_exp_journal_entry  ON fin_expenses(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
CREATE INDEX idx_exp_idempotency    ON fin_expenses(idempotency_key);

ALTER TABLE fin_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY expenses_owner_isolation ON fin_expenses
  USING  (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);
