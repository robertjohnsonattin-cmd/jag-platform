-- NLCB: scratch tickets, bill payments, config, and commission rate correction.
-- STD-13 Expand-and-Contract: all new tables. Additive columns on
-- nlcb_weekly_settlements are safe (no existing code reads them yet).

-- ── Correct commission rate: 5% → 8% on all draw games ───────────────────────

UPDATE nlcb_games
SET commission_rate = 8.00, last_modified_at = now()
WHERE tenant_id = '00000000-0000-0000-0001-000000000007';

-- ── Booth configuration ───────────────────────────────────────────────────────
-- Single row per tenant. Stores the scratch win threshold — wins at or below
-- this amount are paid at the booth; wins above go to NLCB offices.
-- Robert updates this via PATCH /api/v1/nlcb/config once NLCB confirms the cutoff.

CREATE TABLE IF NOT EXISTS nlcb_config (
  tenant_id             UUID    PRIMARY KEY,
  scratch_win_threshold NUMERIC(12,2) NOT NULL DEFAULT 1000.00,
  updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by            UUID
);

ALTER TABLE nlcb_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nlcb_config
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

INSERT INTO nlcb_config (tenant_id)
VALUES ('00000000-0000-0000-0001-000000000007')
ON CONFLICT DO NOTHING;

-- ── Scratch game titles ───────────────────────────────────────────────────────
-- Each scratch game has a fixed ticket denomination (face value).
-- Commission rate is per-game — NLCB may pay different rates for different titles.

CREATE TABLE IF NOT EXISTS nlcb_scratch_games (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID    NOT NULL,
  name            VARCHAR(100)  NOT NULL,
  denomination    NUMERIC(8,2)  NOT NULL CHECK (denomination > 0),  -- ticket face value
  commission_rate NUMERIC(5,2)  NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 100),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_modified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_modified_by UUID
);

ALTER TABLE nlcb_scratch_games ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nlcb_scratch_games
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_nlcb_scratch_games_tenant ON nlcb_scratch_games(tenant_id);

-- Common scratch game denominations — names are illustrative; update as NLCB titles change.
INSERT INTO nlcb_scratch_games (tenant_id, name, denomination, commission_rate) VALUES
  ('00000000-0000-0000-0001-000000000007', 'Scratch Game $5',   5.00,  8.00),
  ('00000000-0000-0000-0001-000000000007', 'Scratch Game $10', 10.00,  8.00),
  ('00000000-0000-0000-0001-000000000007', 'Scratch Game $20', 20.00,  8.00),
  ('00000000-0000-0000-0001-000000000007', 'Scratch Game $50', 50.00,  8.00),
  ('00000000-0000-0000-0001-000000000007', 'Scratch Game $100',100.00, 8.00)
ON CONFLICT DO NOTHING;

-- ── Scratch book consignments ─────────────────────────────────────────────────
-- Records each delivery of scratch books from NLCB to the booth.
-- A consignment is a batch of books for one scratch game title.
-- total_tickets is computed: books_received × tickets_per_book.

CREATE TABLE IF NOT EXISTS nlcb_scratch_consignments (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID    NOT NULL,
  game_id          UUID    NOT NULL REFERENCES nlcb_scratch_games(id),
  delivery_date    DATE    NOT NULL,
  books_received   INT     NOT NULL CHECK (books_received > 0),
  tickets_per_book INT     NOT NULL DEFAULT 50 CHECK (tickets_per_book > 0),
  total_tickets    INT     GENERATED ALWAYS AS (books_received * tickets_per_book) STORED,
  delivery_ref     VARCHAR(100),
  received_by      UUID    NOT NULL,
  notes            TEXT,
  status           VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'CLOSED')),
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE nlcb_scratch_consignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nlcb_scratch_consignments
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_nlcb_scratch_consignments_tenant ON nlcb_scratch_consignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_scratch_consignments_game   ON nlcb_scratch_consignments(game_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_scratch_consignments_status ON nlcb_scratch_consignments(status);

-- ── Scratch sales ─────────────────────────────────────────────────────────────
-- One entry per session per scratch game. commission_amount auto-computed on insert.
-- consignment_id is optional — links sale to a specific delivery batch.

CREATE TABLE IF NOT EXISTS nlcb_scratch_sales (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID    NOT NULL,
  session_id       UUID    NOT NULL REFERENCES nlcb_daily_sessions(id),
  game_id          UUID    NOT NULL REFERENCES nlcb_scratch_games(id),
  consignment_id   UUID    REFERENCES nlcb_scratch_consignments(id),
  tickets_sold     INT     NOT NULL CHECK (tickets_sold > 0),
  gross_value      NUMERIC(12,2) NOT NULL CHECK (gross_value > 0),
  commission_rate  NUMERIC(5,2)  NOT NULL,
  commission_amount NUMERIC(12,2) NOT NULL CHECK (commission_amount >= 0),
  idempotency_key  UUID    NOT NULL UNIQUE,
  created_by       UUID    NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE nlcb_scratch_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nlcb_scratch_sales
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_nlcb_scratch_sales_tenant     ON nlcb_scratch_sales(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_scratch_sales_session    ON nlcb_scratch_sales(session_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_scratch_sales_idempotent ON nlcb_scratch_sales(idempotency_key);

-- ── Scratch winnings ──────────────────────────────────────────────────────────
-- Winning tickets presented at the booth.
-- is_large_win = true → amount exceeds scratch_win_threshold; customer is directed
-- to NLCB office. No cash leaves the float. Logged for reconciliation only.
-- is_large_win = false → paid at booth from float; included in settlement reimbursement.

CREATE TABLE IF NOT EXISTS nlcb_scratch_winnings (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID    NOT NULL,
  session_id      UUID    NOT NULL REFERENCES nlcb_daily_sessions(id),
  game_id         UUID    NOT NULL REFERENCES nlcb_scratch_games(id),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  ticket_ref      VARCHAR(100),
  is_large_win    BOOLEAN NOT NULL DEFAULT false,
  notes           TEXT,
  idempotency_key UUID    NOT NULL UNIQUE,
  created_by      UUID    NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE nlcb_scratch_winnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nlcb_scratch_winnings
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_nlcb_scratch_winnings_tenant     ON nlcb_scratch_winnings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_scratch_winnings_session    ON nlcb_scratch_winnings(session_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_scratch_winnings_idempotent ON nlcb_scratch_winnings(idempotency_key);

-- ── Bill payment billers ──────────────────────────────────────────────────────
-- Master list of billers the booth processes payments for.
-- flat_fee is the per-transaction fee earned — update via PATCH /api/v1/nlcb/billers/:id
-- once NLCB confirms the rates.

CREATE TABLE IF NOT EXISTS nlcb_billers (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID    NOT NULL,
  name            VARCHAR(100)  NOT NULL,
  flat_fee        NUMERIC(8,2)  NOT NULL DEFAULT 0.00 CHECK (flat_fee >= 0),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_modified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_modified_by UUID
);

ALTER TABLE nlcb_billers ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nlcb_billers
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_nlcb_billers_tenant ON nlcb_billers(tenant_id);

-- Common T&T utility billers — fees set to 0.00 placeholder until confirmed.
INSERT INTO nlcb_billers (tenant_id, name, flat_fee) VALUES
  ('00000000-0000-0000-0001-000000000007', 'T&TEC',   0.00),
  ('00000000-0000-0000-0001-000000000007', 'TSTT',    0.00),
  ('00000000-0000-0000-0001-000000000007', 'WASA',    0.00),
  ('00000000-0000-0000-0001-000000000007', 'NP',      0.00),
  ('00000000-0000-0000-0001-000000000007', 'Digicel', 0.00),
  ('00000000-0000-0000-0001-000000000007', 'bmobile', 0.00)
ON CONFLICT DO NOTHING;

-- ── Bill payments ─────────────────────────────────────────────────────────────
-- One entry per bill paid at the booth per session.
-- flat_fee is a snapshot of billers.flat_fee at time of payment.
-- customer_ref: customer account number or bill reference for reconciliation.

CREATE TABLE IF NOT EXISTS nlcb_bill_payments (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID    NOT NULL,
  session_id       UUID    NOT NULL REFERENCES nlcb_daily_sessions(id),
  biller_id        UUID    NOT NULL REFERENCES nlcb_billers(id),
  amount_collected NUMERIC(12,2) NOT NULL CHECK (amount_collected > 0),
  flat_fee         NUMERIC(8,2)  NOT NULL DEFAULT 0.00 CHECK (flat_fee >= 0),
  customer_ref     VARCHAR(100),
  idempotency_key  UUID    NOT NULL UNIQUE,
  created_by       UUID    NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE nlcb_bill_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nlcb_bill_payments
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_nlcb_bill_payments_tenant     ON nlcb_bill_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_bill_payments_session    ON nlcb_bill_payments(session_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_bill_payments_idempotent ON nlcb_bill_payments(idempotency_key);

-- ── Expand settlement to include scratch and bill streams ─────────────────────
-- STD-13: purely additive — new columns with defaults, no existing columns touched.
-- net_owed formula (computed in application layer):
--   (draw_sales - prize_payouts - draw_commission)
--   + (scratch_sales - scratch_winnings_paid - scratch_commission)
--   + (bill_collections - bill_fees)

ALTER TABLE nlcb_weekly_settlements
  ADD COLUMN IF NOT EXISTS total_scratch_sales          NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_scratch_winnings_paid  NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_scratch_commission     NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_bill_collections       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_bill_fees              NUMERIC(12,2) NOT NULL DEFAULT 0;
