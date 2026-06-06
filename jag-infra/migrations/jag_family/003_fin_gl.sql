-- jag_family — Migration 003: General Ledger schema (Phase 5)
-- Run against jag_family as jag_app.
--
-- Design:
--   Double-entry bookkeeping. Every financial event is a journal entry with
--   two or more balanced lines (debits = credits). fin_transactions and bank
--   statement imports post here via the API — never direct DB writes.
--
--   Account numbering follows a standard CoA structure:
--     1xxx  Assets
--     2xxx  Liabilities
--     3xxx  Equity
--     4xxx  Revenue
--     5xxx  Expenses
--     6xxx  Other income / gains
--     7xxx  Other expenses / losses
--
--   owner_entity_id: logical FK → jag_core.tenants.id (no DB-level FK across DBs).
--   The CONSOLIDATED pseudo-entity uses '00000000-0000-0000-0000-000000000000'.
--
-- RLS: withOwnerRLS — app.current_owner_id (same as all other fin_* tables)

-- ── ENUMS ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE gl_account_type AS ENUM (
    'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gl_normal_balance AS ENUM ('DEBIT', 'CREDIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gl_entry_status AS ENUM ('DRAFT', 'POSTED', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gl_entry_source AS ENUM (
    'MANUAL',
    'BANK_IMPORT',       -- from fin_bank_statement_jobs
    'TRANSACTION_SYNC',  -- synced from fin_transactions
    'INTERCOMPANY',      -- intercompany elimination or charge
    'PERIOD_CLOSE',      -- month/year-end closing entry
    'ADJUSTMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── fin_gl_accounts — chart of accounts ──────────────────────────────────────

CREATE TABLE fin_gl_accounts (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID          NOT NULL,
  owner_entity_id  UUID          NOT NULL,   -- jag_core.tenants.id
  account_code     VARCHAR(20)   NOT NULL,   -- e.g. '1100', '4100'
  account_name     VARCHAR(200)  NOT NULL,
  account_type     gl_account_type NOT NULL,
  normal_balance   gl_normal_balance NOT NULL,
  parent_id        UUID          REFERENCES fin_gl_accounts(id),  -- for sub-accounts
  currency         CHAR(3)       NOT NULL DEFAULT 'TTD',
  description      TEXT,
  is_active        BOOLEAN       NOT NULL DEFAULT true,
  allow_direct_posting BOOLEAN   NOT NULL DEFAULT true,  -- false for summary/header accounts
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (owner_id, owner_entity_id, account_code)
);

CREATE INDEX idx_gl_accounts_owner         ON fin_gl_accounts(owner_id);
CREATE INDEX idx_gl_accounts_entity        ON fin_gl_accounts(owner_entity_id);
CREATE INDEX idx_gl_accounts_type          ON fin_gl_accounts(account_type);
CREATE INDEX idx_gl_accounts_code          ON fin_gl_accounts(owner_id, account_code);
CREATE INDEX idx_gl_accounts_parent        ON fin_gl_accounts(parent_id);

ALTER TABLE fin_gl_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY gl_accounts_owner_isolation ON fin_gl_accounts
  USING  (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

-- ── fin_journal_entries — header record ───────────────────────────────────────

CREATE TABLE fin_journal_entries (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID          NOT NULL,
  owner_entity_id  UUID          NOT NULL,   -- entity this entry belongs to
  entry_date       DATE          NOT NULL,
  period_month     SMALLINT      NOT NULL GENERATED ALWAYS AS (EXTRACT(MONTH FROM entry_date)::SMALLINT) STORED,
  period_year      SMALLINT      NOT NULL GENERATED ALWAYS AS (EXTRACT(YEAR  FROM entry_date)::SMALLINT) STORED,
  reference        VARCHAR(100),             -- e.g. invoice number, bank ref
  description      TEXT          NOT NULL,
  status           gl_entry_status NOT NULL DEFAULT 'DRAFT',
  source           gl_entry_source NOT NULL DEFAULT 'MANUAL',
  source_id        UUID,                     -- logical FK to fin_transactions, bank_statement_jobs, etc.
  currency         CHAR(3)       NOT NULL DEFAULT 'TTD',
  total_debit_ttd  NUMERIC(18,2) NOT NULL DEFAULT 0,  -- kept in sync with lines
  total_credit_ttd NUMERIC(18,2) NOT NULL DEFAULT 0,
  posted_at        TIMESTAMPTZ,
  posted_by        UUID,                     -- jag_core.users.id
  void_reason      TEXT,
  idempotency_key  TEXT          NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_je_owner              ON fin_journal_entries(owner_id);
CREATE INDEX idx_je_entity             ON fin_journal_entries(owner_entity_id);
CREATE INDEX idx_je_date               ON fin_journal_entries(entry_date);
CREATE INDEX idx_je_period             ON fin_journal_entries(period_year, period_month);
CREATE INDEX idx_je_status             ON fin_journal_entries(status);
CREATE INDEX idx_je_source             ON fin_journal_entries(source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX idx_je_idempotency        ON fin_journal_entries(idempotency_key);

ALTER TABLE fin_journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY je_owner_isolation ON fin_journal_entries
  USING  (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

-- ── fin_journal_entry_lines — double-entry lines ──────────────────────────────
-- Invariant (enforced by API, verified by check): SUM(debit_ttd) = SUM(credit_ttd) per entry.

CREATE TABLE fin_journal_entry_lines (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID          NOT NULL,
  journal_entry_id UUID          NOT NULL REFERENCES fin_journal_entries(id) ON DELETE CASCADE,
  gl_account_id    UUID          NOT NULL REFERENCES fin_gl_accounts(id),
  line_number      SMALLINT      NOT NULL,   -- ordering within the entry
  description      TEXT,
  debit_ttd        NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit_ttd       NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency         CHAR(3)       NOT NULL DEFAULT 'TTD',
  amount_original  NUMERIC(18,2),            -- original currency amount (when non-TTD)
  fx_rate_used     NUMERIC(12,6),            -- rate applied for TTD conversion
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT chk_jel_debit_credit_nonzero
    CHECK (debit_ttd >= 0 AND credit_ttd >= 0),
  CONSTRAINT chk_jel_not_both_nonzero
    CHECK (NOT (debit_ttd > 0 AND credit_ttd > 0)),
  CONSTRAINT chk_jel_one_side
    CHECK (debit_ttd > 0 OR credit_ttd > 0)
);

CREATE INDEX idx_jel_entry        ON fin_journal_entry_lines(journal_entry_id);
CREATE INDEX idx_jel_account      ON fin_journal_entry_lines(gl_account_id);
CREATE INDEX idx_jel_owner        ON fin_journal_entry_lines(owner_id);

ALTER TABLE fin_journal_entry_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY jel_owner_isolation ON fin_journal_entry_lines
  USING  (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);
