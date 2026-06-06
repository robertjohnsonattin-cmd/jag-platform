-- jag_family — Migration 002: Finance schema (Phase 4)
-- Architecture: Option B — accounts scoped per JAG entity, consolidated via snapshots.
-- Run against jag_family as jag_app.
--
-- Design notes:
--   owner_entity_id is a UUID matching jag_core.tenants.id.
--   No cross-database FK is declared (separate logical DBs); the application
--   enforces referential integrity by validating against the tenant list at
--   write time.
--
--   Tenant UUIDs (from jag_core.tenants):
--     JAG_HOLDINGS      00000000-0000-0000-0001-000000000001  (Robert personally)
--     JABCO             00000000-0000-0000-0001-000000000002
--     JAG_PROPERTIES    00000000-0000-0000-0001-000000000003
--     JAG_ENTERTAINMENT 00000000-0000-0000-0001-000000000004
--     JAG_FINANCE       00000000-0000-0000-0001-000000000005
--     DRAGONBRIDGE      00000000-0000-0000-0001-000000000006
--     NLCB              00000000-0000-0000-0001-000000000007
--
-- Tables:
--   fin_accounts             — bank/investment/credit accounts, one entity per row
--   fin_transactions         — transaction ledger, linked to fin_accounts
--   fin_fx_rates             — FX rate cache (TTD base)
--   fin_investments          — investment positions (equities, bonds, funds, real estate)
--   fin_mortgages_loans      — mortgage and loan schedules
--   fin_net_worth_snapshots  — periodic consolidated net worth roll-up
--   fin_bank_statement_jobs  — async bank statement import tracker
--   fin_pending_review_queue — transactions pending categorisation
--
-- RLS: withOwnerRLS — app.current_owner_id

-- ── fin_accounts ──────────────────────────────────────────────────────────────

CREATE TABLE fin_accounts (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID          NOT NULL,
  owner_entity_id   UUID          NOT NULL,   -- jag_core.tenants.id
  account_name      VARCHAR(200)  NOT NULL,
  institution_name  VARCHAR(200)  NOT NULL,
  account_type      TEXT          NOT NULL
    CHECK (account_type IN (
      'CHEQUING','SAVINGS','CURRENT','CALL_DEPOSIT',
      'CREDIT_CARD','LINE_OF_CREDIT',
      'BROKERAGE','RETIREMENT','MUTUAL_FUND',
      'MORTGAGE','TERM_LOAN','PERSONAL_LOAN',
      'OTHER'
    )),
  currency          CHAR(3)       NOT NULL DEFAULT 'TTD',  -- ISO 4217
  current_balance   NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit_limit      NUMERIC(18,2),                          -- for credit accounts
  interest_rate     NUMERIC(7,4),                           -- annual %, informational
  account_number_last4 CHAR(4),                             -- last 4 digits only — OPSEC
  is_active         BOOLEAN       NOT NULL DEFAULT true,
  opened_date       DATE,
  closed_date       DATE,
  notes             VARCHAR(2000),
  last_synced_at    TIMESTAMPTZ,                            -- last bank statement import
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── fin_transactions ──────────────────────────────────────────────────────────
-- STD-11: idempotency_key on every write.

CREATE TABLE fin_transactions (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID          NOT NULL,
  account_id        UUID          NOT NULL REFERENCES fin_accounts(id),
  transaction_date  DATE          NOT NULL,
  posted_date       DATE,
  amount            NUMERIC(18,2) NOT NULL,        -- positive = credit, negative = debit
  currency          CHAR(3)       NOT NULL DEFAULT 'TTD',
  amount_ttd        NUMERIC(18,2),                 -- converted to TTD (null if TTD native)
  fx_rate_used      NUMERIC(14,8),                 -- rate at time of conversion
  description       VARCHAR(500)  NOT NULL,
  merchant_name     VARCHAR(200),
  category          TEXT
    CHECK (category IN (
      'SALARY','DIVIDEND','RENTAL_INCOME','INTEREST_INCOME','TRANSFER_IN',
      'OPERATING_EXPENSE','PAYROLL','TAX_PAYMENT','LOAN_REPAYMENT',
      'INVESTMENT_PURCHASE','INVESTMENT_SALE','TRANSFER_OUT',
      'PERSONAL_EXPENSE','UTILITIES','INSURANCE','ENTERTAINMENT',
      'TRAVEL','MEDICAL','EDUCATION','CHARITY',
      'UNCLASSIFIED'
    )),
  is_reconciled     BOOLEAN       NOT NULL DEFAULT false,
  is_pending_review BOOLEAN       NOT NULL DEFAULT false,
  reference_number  VARCHAR(100),
  transfer_pair_id  UUID,                          -- links two sides of an inter-account transfer
  idempotency_key   TEXT          NOT NULL UNIQUE,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── fin_fx_rates ──────────────────────────────────────────────────────────────
-- Cache of exchange rates. TTD is the base currency (rate = how many TTD per 1 foreign unit).

CREATE TABLE fin_fx_rates (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  currency        CHAR(3)       NOT NULL,          -- foreign currency, ISO 4217
  rate_date       DATE          NOT NULL,
  rate_to_ttd     NUMERIC(14,8) NOT NULL CHECK (rate_to_ttd > 0),
  source          VARCHAR(100)  NOT NULL DEFAULT 'MANUAL',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (currency, rate_date)
);

-- ── fin_investments ───────────────────────────────────────────────────────────

CREATE TABLE fin_investments (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID          NOT NULL,
  owner_entity_id       UUID          NOT NULL,   -- jag_core.tenants.id
  account_id            UUID          REFERENCES fin_accounts(id),  -- brokerage account, if applicable
  investment_type       TEXT          NOT NULL
    CHECK (investment_type IN (
      'EQUITY','BOND','MUTUAL_FUND','ETF','UNIT_TRUST',
      'REAL_ESTATE','PRIVATE_EQUITY','CASH_EQUIVALENT','OTHER'
    )),
  asset_name            VARCHAR(200)  NOT NULL,
  ticker_symbol         VARCHAR(20),
  units_held            NUMERIC(18,8) NOT NULL DEFAULT 0 CHECK (units_held >= 0),
  average_cost_per_unit NUMERIC(18,8),
  current_price         NUMERIC(18,8),
  currency              CHAR(3)       NOT NULL DEFAULT 'TTD',
  current_value_ttd     NUMERIC(18,2),             -- updated periodically
  unrealised_gain_ttd   NUMERIC(18,2),
  institution_name      VARCHAR(200),
  purchase_date         DATE,
  maturity_date         DATE,
  notes                 VARCHAR(2000),
  last_valued_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── fin_mortgages_loans ───────────────────────────────────────────────────────

CREATE TABLE fin_mortgages_loans (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID          NOT NULL,
  owner_entity_id       UUID          NOT NULL,   -- jag_core.tenants.id
  account_id            UUID          REFERENCES fin_accounts(id),
  loan_type             TEXT          NOT NULL
    CHECK (loan_type IN ('MORTGAGE','CAR_LOAN','PERSONAL_LOAN','BUSINESS_LOAN','OVERDRAFT','OTHER')),
  lender_name           VARCHAR(200)  NOT NULL,
  original_principal    NUMERIC(18,2) NOT NULL CHECK (original_principal > 0),
  outstanding_balance   NUMERIC(18,2) NOT NULL CHECK (outstanding_balance >= 0),
  currency              CHAR(3)       NOT NULL DEFAULT 'TTD',
  interest_rate         NUMERIC(7,4)  NOT NULL CHECK (interest_rate >= 0),
  interest_type         TEXT          NOT NULL DEFAULT 'FIXED'
    CHECK (interest_type IN ('FIXED','VARIABLE')),
  monthly_payment       NUMERIC(18,2),
  start_date            DATE          NOT NULL,
  maturity_date         DATE,
  collateral_description VARCHAR(500),             -- property or asset description only — OPSEC
  notes                 VARCHAR(2000),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── fin_net_worth_snapshots ───────────────────────────────────────────────────
-- Point-in-time snapshot. One row per entity per snapshot date, plus a CONSOLIDATED row.
-- Computed by the API worker; not written directly by user-facing routes.

CREATE TABLE fin_net_worth_snapshots (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID          NOT NULL,
  snapshot_date         DATE          NOT NULL,
  owner_entity_id       UUID          NOT NULL,   -- or the special CONSOLIDATED marker UUID below
  -- CONSOLIDATED pseudo-entity: 00000000-0000-0000-0000-000000000000
  total_assets_ttd      NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_liabilities_ttd NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_worth_ttd         NUMERIC(18,2) GENERATED ALWAYS AS (total_assets_ttd - total_liabilities_ttd) STORED,
  liquid_assets_ttd     NUMERIC(18,2) NOT NULL DEFAULT 0,
  investment_assets_ttd NUMERIC(18,2) NOT NULL DEFAULT 0,
  property_assets_ttd   NUMERIC(18,2) NOT NULL DEFAULT 0,
  notes                 VARCHAR(1000),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (owner_id, owner_entity_id, snapshot_date)
);

-- ── fin_bank_statement_jobs ───────────────────────────────────────────────────

CREATE TABLE fin_bank_statement_jobs (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID          NOT NULL,
  account_id      UUID          NOT NULL REFERENCES fin_accounts(id),
  status          TEXT          NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PROCESSING','COMPLETE','FAILED','PARTIAL')),
  file_name       VARCHAR(300)  NOT NULL,
  storage_path    VARCHAR(500)  NOT NULL,          -- MinIO object path
  mime_type       VARCHAR(100)  NOT NULL,
  statement_from  DATE,
  statement_to    DATE,
  rows_parsed     INTEGER       NOT NULL DEFAULT 0,
  rows_imported   INTEGER       NOT NULL DEFAULT 0,
  rows_skipped    INTEGER       NOT NULL DEFAULT 0,
  error_detail    TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  idempotency_key TEXT          NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── fin_pending_review_queue ──────────────────────────────────────────────────
-- Transactions that need Robert's categorisation after a bank statement import.

CREATE TABLE fin_pending_review_queue (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID          NOT NULL,
  transaction_id  UUID          NOT NULL REFERENCES fin_transactions(id),
  job_id          UUID          REFERENCES fin_bank_statement_jobs(id),
  suggested_category TEXT,                         -- AI/rule-based suggestion
  confidence      NUMERIC(4,3),                    -- 0.000 to 1.000
  reviewer_notes  VARCHAR(1000),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX ON fin_accounts             (owner_id, owner_entity_id);
CREATE INDEX ON fin_accounts             (owner_id, account_type);
CREATE INDEX ON fin_accounts             (owner_id, is_active);
CREATE INDEX ON fin_transactions         (account_id, transaction_date DESC);
CREATE INDEX ON fin_transactions         (owner_id, transaction_date DESC);
CREATE INDEX ON fin_transactions         (is_pending_review) WHERE is_pending_review = true;
CREATE INDEX ON fin_transactions         (transfer_pair_id) WHERE transfer_pair_id IS NOT NULL;
CREATE INDEX ON fin_fx_rates             (currency, rate_date DESC);
CREATE INDEX ON fin_investments          (owner_id, owner_entity_id);
CREATE INDEX ON fin_investments          (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX ON fin_mortgages_loans      (owner_id, owner_entity_id);
CREATE INDEX ON fin_mortgages_loans      (maturity_date) WHERE maturity_date IS NOT NULL;
CREATE INDEX ON fin_net_worth_snapshots  (owner_id, snapshot_date DESC);
CREATE INDEX ON fin_net_worth_snapshots  (owner_entity_id, snapshot_date DESC);
CREATE INDEX ON fin_bank_statement_jobs  (owner_id, status);
CREATE INDEX ON fin_bank_statement_jobs  (account_id, created_at DESC);
CREATE INDEX ON fin_pending_review_queue (owner_id, resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX ON fin_pending_review_queue (transaction_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE fin_accounts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_transactions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_fx_rates             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_investments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_mortgages_loans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_net_worth_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_bank_statement_jobs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_pending_review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY fin_owner_isolation ON fin_accounts
  USING      (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY fin_owner_isolation ON fin_transactions
  USING      (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

-- fin_fx_rates: shared reference table — visible to all authenticated owners
CREATE POLICY fin_fx_rates_read ON fin_fx_rates
  FOR SELECT USING (current_setting('app.current_owner_id', true) IS NOT NULL);
CREATE POLICY fin_fx_rates_write ON fin_fx_rates
  FOR ALL USING (current_setting('app.current_owner_id', true) IS NOT NULL);

CREATE POLICY fin_owner_isolation ON fin_investments
  USING      (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY fin_owner_isolation ON fin_mortgages_loans
  USING      (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY fin_owner_isolation ON fin_net_worth_snapshots
  USING      (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY fin_owner_isolation ON fin_bank_statement_jobs
  USING      (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY fin_owner_isolation ON fin_pending_review_queue
  USING      (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);
