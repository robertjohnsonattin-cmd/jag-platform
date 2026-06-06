-- NLCB lottery booth schema.
-- Brian Johnson-Attin is the owner/operator.
-- Tenant-scoped via jag_commercial RLS (same pattern as JABCO/IMS/CRM).
-- STD-13 Expand-and-Contract: all new tables, no existing tables modified.

-- ── Session status enum ───────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE nlcb_session_status AS ENUM ('OPEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Settlement status enum ────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE nlcb_settlement_status AS ENUM ('PENDING', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Expense status enum ───────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE nlcb_expense_status AS ENUM ('PENDING', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Games master ──────────────────────────────────────────────────────────────
-- Draw frequency reference only (not used for scheduling).
-- commission_rate stored per game — NLCB may pay different rates per product.

CREATE TABLE IF NOT EXISTS nlcb_games (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID    NOT NULL,
  name            VARCHAR(100) NOT NULL,
  draw_frequency  VARCHAR(20)  NOT NULL,   -- e.g. '4X_DAILY', 'DAILY', 'WEEKLY'
  commission_rate NUMERIC(5,2) NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 100),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_modified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_modified_by UUID
);

ALTER TABLE nlcb_games ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nlcb_games
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_nlcb_games_tenant ON nlcb_games(tenant_id);

-- Seed standard T&T NLCB games for the NLCB tenant.
INSERT INTO nlcb_games (tenant_id, name, draw_frequency, commission_rate) VALUES
  ('00000000-0000-0000-0001-000000000007', 'Play Whe',    '4X_DAILY', 5.00),
  ('00000000-0000-0000-0001-000000000007', 'Cash Pot',    '4X_DAILY', 5.00),
  ('00000000-0000-0000-0001-000000000007', 'Pick 2',      '4X_DAILY', 5.00),
  ('00000000-0000-0000-0001-000000000007', 'Lotto Plus',  'WEEKLY',   5.00),
  ('00000000-0000-0000-0001-000000000007', 'Super Lotto', 'WEEKLY',   5.00),
  ('00000000-0000-0000-0001-000000000007', 'Whe Whe',     'DAILY',    5.00)
ON CONFLICT DO NOTHING;

-- ── Daily trading sessions ────────────────────────────────────────────────────
-- One session per trading day. Captures opening and closing cash float.

CREATE TABLE IF NOT EXISTS nlcb_daily_sessions (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID    NOT NULL,
  session_date     DATE    NOT NULL,
  opened_by        UUID    NOT NULL,
  cash_float_open  NUMERIC(12,2) NOT NULL CHECK (cash_float_open >= 0),
  cash_float_close NUMERIC(12,2)           CHECK (cash_float_close >= 0),
  status           nlcb_session_status NOT NULL DEFAULT 'OPEN',
  notes            TEXT,
  opened_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  closed_at        TIMESTAMP WITH TIME ZONE,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_modified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_modified_by UUID,
  CONSTRAINT nlcb_one_session_per_day UNIQUE (tenant_id, session_date)
);

ALTER TABLE nlcb_daily_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nlcb_daily_sessions
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_nlcb_sessions_tenant ON nlcb_daily_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_sessions_date   ON nlcb_daily_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_nlcb_sessions_status ON nlcb_daily_sessions(status);

-- ── Sales entries ─────────────────────────────────────────────────────────────
-- One row per game per session. commission_amount auto-computed on insert.
-- commission_rate snapshot preserved — rate may change on the game later.

CREATE TABLE IF NOT EXISTS nlcb_sales (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID    NOT NULL,
  session_id       UUID    NOT NULL REFERENCES nlcb_daily_sessions(id),
  game_id          UUID    NOT NULL REFERENCES nlcb_games(id),
  gross_sales      NUMERIC(12,2) NOT NULL CHECK (gross_sales >= 0),
  commission_rate  NUMERIC(5,2)  NOT NULL CHECK (commission_rate >= 0),
  commission_amount NUMERIC(12,2) NOT NULL CHECK (commission_amount >= 0),
  idempotency_key  UUID    NOT NULL UNIQUE,
  created_by       UUID    NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE nlcb_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nlcb_sales
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_nlcb_sales_tenant      ON nlcb_sales(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_sales_session     ON nlcb_sales(session_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_sales_idempotent  ON nlcb_sales(idempotency_key);

-- ── Prize payouts ─────────────────────────────────────────────────────────────
-- Cash paid to winners at the booth. Claimed back from NLCB via weekly settlement.

CREATE TABLE IF NOT EXISTS nlcb_payouts (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID    NOT NULL,
  session_id      UUID    NOT NULL REFERENCES nlcb_daily_sessions(id),
  game_id         UUID    NOT NULL REFERENCES nlcb_games(id),
  payout_amount   NUMERIC(12,2) NOT NULL CHECK (payout_amount > 0),
  ticket_ref      VARCHAR(100),
  notes           TEXT,
  idempotency_key UUID    NOT NULL UNIQUE,
  created_by      UUID    NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE nlcb_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nlcb_payouts
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_nlcb_payouts_tenant     ON nlcb_payouts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_payouts_session    ON nlcb_payouts(session_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_payouts_idempotent ON nlcb_payouts(idempotency_key);

-- ── Weekly settlements ────────────────────────────────────────────────────────
-- Net owed to NLCB = gross_sales - payouts - commission.
-- Positive = Brian pays NLCB. Negative = NLCB owes Brian (unusual but possible).

CREATE TABLE IF NOT EXISTS nlcb_weekly_settlements (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID    NOT NULL,
  week_start        DATE    NOT NULL,
  week_end          DATE    NOT NULL,
  total_sales       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_payouts     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_commission  NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_owed          NUMERIC(12,2) NOT NULL DEFAULT 0,  -- sales - payouts - commission
  status            nlcb_settlement_status NOT NULL DEFAULT 'PENDING',
  paid_at           TIMESTAMP WITH TIME ZONE,
  paid_amount       NUMERIC(12,2),
  reference_number  VARCHAR(100),
  notes             TEXT,
  idempotency_key   UUID    NOT NULL UNIQUE,
  created_by        UUID    NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT nlcb_one_settlement_per_week UNIQUE (tenant_id, week_start)
);

ALTER TABLE nlcb_weekly_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nlcb_weekly_settlements
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_nlcb_settlements_tenant     ON nlcb_weekly_settlements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_settlements_week       ON nlcb_weekly_settlements(week_start);
CREATE INDEX IF NOT EXISTS idx_nlcb_settlements_status     ON nlcb_weekly_settlements(status);
CREATE INDEX IF NOT EXISTS idx_nlcb_settlements_idempotent ON nlcb_weekly_settlements(idempotency_key);

-- ── Booth expenses ────────────────────────────────────────────────────────────
-- Operating costs: rent, utilities, supplies, staff, other.

CREATE TABLE IF NOT EXISTS nlcb_expenses (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID    NOT NULL,
  expense_date    DATE    NOT NULL,
  category        VARCHAR(50)   NOT NULL
                  CHECK (category IN ('RENT', 'UTILITY', 'SUPPLIES', 'STAFF', 'OTHER')),
  description     TEXT    NOT NULL,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  vat_amount      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  vendor_name     VARCHAR(200),
  status          nlcb_expense_status NOT NULL DEFAULT 'PENDING',
  paid_at         TIMESTAMP WITH TIME ZONE,
  notes           TEXT,
  idempotency_key UUID    NOT NULL UNIQUE,
  created_by      UUID    NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE nlcb_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nlcb_expenses
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_nlcb_expenses_tenant     ON nlcb_expenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_expenses_date       ON nlcb_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_nlcb_expenses_idempotent ON nlcb_expenses(idempotency_key);
