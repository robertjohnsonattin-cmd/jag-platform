-- NLCB scratch redesign: presold pack model + cashing commission.
--
-- Scratch tickets are PRESOLD: agent pays NLCB cash upfront at delivery.
-- Pack purchase cost does NOT appear in weekly settlement.
-- Settlement only credits agent for: prize reimbursements + 1% cashing commission.
--
-- Cashing commission (1%) applies to ALL prize payouts (draw AND scratch)
-- when the agent pays the winner at the booth.
--
-- Payout limits are per-game (not a global threshold):
--   Play Whe / Cash Pot / Pick 2 / Whe Whe  →  $5,600
--   Lotto Plus / Super Lotto / all Scratch   →  $12,000
--
-- STD-13 note: nlcb_scratch_consignments and old nlcb_scratch_sales were created
-- in migration 005 (same session, no production data). Dropping and recreating
-- is safe — no data exists beyond the initial seed run in development.

-- ── Per-game payout limits on draw games ─────────────────────────────────────

ALTER TABLE nlcb_games
  ADD COLUMN IF NOT EXISTS max_agent_payout    NUMERIC(12,2) NOT NULL DEFAULT 5600.00,
  ADD COLUMN IF NOT EXISTS cashing_commission_rate NUMERIC(5,2) NOT NULL DEFAULT 1.00;

UPDATE nlcb_games SET max_agent_payout = 12000.00
WHERE name IN ('Lotto Plus', 'Super Lotto');
-- Play Whe, Cash Pot, Pick 2, Whe Whe remain at 5600.00 default.

-- ── Per-game payout limits on scratch games ───────────────────────────────────

ALTER TABLE nlcb_scratch_games
  ADD COLUMN IF NOT EXISTS max_agent_payout        NUMERIC(12,2) NOT NULL DEFAULT 12000.00,
  ADD COLUMN IF NOT EXISTS cashing_commission_rate NUMERIC(5,2)  NOT NULL DEFAULT 1.00;

-- All scratch games use $12,000 limit.

-- ── Cashing commission on draw payouts ───────────────────────────────────────
-- Recorded at time of payout; rate is a snapshot from nlcb_games.cashing_commission_rate.
-- is_large_win: true when amount > game.max_agent_payout (winner goes to NLCB office).

ALTER TABLE nlcb_payouts
  ADD COLUMN IF NOT EXISTS is_large_win               BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cashing_commission_rate    NUMERIC(5,2)  NOT NULL DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS cashing_commission_amount  NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ── Cashing commission on scratch winnings ────────────────────────────────────
-- Only applies when is_large_win = false (large wins go to NLCB office; agent pays nothing).

ALTER TABLE nlcb_scratch_winnings
  ADD COLUMN IF NOT EXISTS cashing_commission_rate    NUMERIC(5,2)  NOT NULL DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS cashing_commission_amount  NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ── Remove global scratch win threshold from config ───────────────────────────
-- Per-game max_agent_payout replaces it.

ALTER TABLE nlcb_config
  DROP COLUMN IF EXISTS scratch_win_threshold;

-- ── Drop old scratch tables (no production data) ──────────────────────────────

DROP TABLE IF EXISTS nlcb_scratch_sales;
DROP TABLE IF EXISTS nlcb_scratch_consignments;

-- ── Scratch pack purchases ────────────────────────────────────────────────────
-- Agent buys packs from NLCB at a discount. Commission is locked in at purchase.
-- purchase_price = (packs × tickets_per_pack × face_value_per_ticket) − commission_amount
-- This cash is paid to NLCB at delivery — it is NOT part of weekly settlement.

CREATE TABLE IF NOT EXISTS nlcb_scratch_pack_purchases (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID    NOT NULL,
  game_id               UUID    NOT NULL REFERENCES nlcb_scratch_games(id),
  purchase_date         DATE    NOT NULL,
  packs_purchased       INT     NOT NULL CHECK (packs_purchased > 0),
  tickets_per_pack      INT     NOT NULL DEFAULT 50 CHECK (tickets_per_pack > 0),
  total_tickets         INT     GENERATED ALWAYS AS (packs_purchased * tickets_per_pack) STORED,
  face_value_per_ticket NUMERIC(8,2)  NOT NULL CHECK (face_value_per_ticket > 0),
  total_face_value      NUMERIC(12,2) NOT NULL,  -- packs × tickets_per_pack × face_value (app-computed)
  commission_rate       NUMERIC(5,2)  NOT NULL,   -- snapshot from game at time of purchase
  commission_amount     NUMERIC(12,2) NOT NULL,   -- profit locked in = total_face_value × rate/100
  purchase_price        NUMERIC(12,2) NOT NULL,   -- cash paid = total_face_value − commission_amount
  delivery_ref          VARCHAR(100),
  received_by           UUID    NOT NULL,
  notes                 TEXT,
  created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE nlcb_scratch_pack_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nlcb_scratch_pack_purchases
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS idx_nlcb_scratch_purchases_tenant ON nlcb_scratch_pack_purchases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_scratch_purchases_game   ON nlcb_scratch_pack_purchases(game_id);
CREATE INDEX IF NOT EXISTS idx_nlcb_scratch_purchases_date   ON nlcb_scratch_pack_purchases(purchase_date);

-- ── Scratch sales (simplified — no commission computation) ────────────────────
-- Commission was captured at pack purchase time. Sales tracking is for cash-flow
-- reconciliation only: how much cash came in at the booth today from scratch sales.

CREATE TABLE IF NOT EXISTS nlcb_scratch_sales (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID    NOT NULL,
  session_id       UUID    NOT NULL REFERENCES nlcb_daily_sessions(id),
  game_id          UUID    NOT NULL REFERENCES nlcb_scratch_games(id),
  pack_purchase_id UUID    REFERENCES nlcb_scratch_pack_purchases(id),
  tickets_sold     INT     NOT NULL CHECK (tickets_sold > 0),
  gross_value      NUMERIC(12,2) NOT NULL CHECK (gross_value > 0),
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

-- ── Update settlement columns to match presold model ─────────────────────────
-- total_scratch_sales and total_scratch_commission are removed (pack cost paid upfront).
-- Settlement credits agent for prize reimbursements + cashing commission on both
-- draw and scratch payouts made at the booth.

ALTER TABLE nlcb_weekly_settlements
  DROP COLUMN IF EXISTS total_scratch_sales,
  DROP COLUMN IF EXISTS total_scratch_commission,
  ADD COLUMN IF NOT EXISTS total_draw_cashing_commission    NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_scratch_cashing_commission NUMERIC(12,2) NOT NULL DEFAULT 0;

-- net_owed formula (computed in application layer):
--   (total_sales − total_payouts − total_commission − total_draw_cashing_commission)
-- − (total_scratch_winnings_paid + total_scratch_cashing_commission)
-- + (total_bill_collections − total_bill_fees)
