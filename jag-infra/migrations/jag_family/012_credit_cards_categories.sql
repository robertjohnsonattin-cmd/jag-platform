-- jag_family — Migration 012: Credit cards table + extended expense categories
-- Run against jag_family as jag_app.

-- ── Extend expense categories ──────────────────────────────────────────────────

ALTER TABLE fin_expenses DROP CONSTRAINT IF EXISTS fin_expenses_category_check;

ALTER TABLE fin_expenses ADD CONSTRAINT fin_expenses_category_check
  CHECK (category IN (
    'SALARY','DIVIDEND','RENTAL_INCOME','INTEREST_INCOME','TRANSFER_IN',
    'OPERATING_EXPENSE','PAYROLL','TAX_PAYMENT','LOAN_REPAYMENT',
    'INVESTMENT_PURCHASE','INVESTMENT_SALE','TRANSFER_OUT',
    'PERSONAL_EXPENSE','UTILITIES','INSURANCE','ENTERTAINMENT',
    'TRAVEL','MEDICAL','EDUCATION','CHARITY','UNCLASSIFIED',
    'GROCERIES','FUEL','DINING','MAINTENANCE','SUBSCRIPTIONS','TRANSPORT','CLOTHING'
  ));

-- ── fin_credit_cards ───────────────────────────────────────────────────────────

CREATE TABLE fin_credit_cards (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID          NOT NULL,
  card_name   VARCHAR(100)  NOT NULL,
  last_four   CHAR(4),
  card_type   VARCHAR(20),
  is_active   BOOLEAN       NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_cards_owner ON fin_credit_cards(owner_id) WHERE is_active;

ALTER TABLE fin_credit_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY credit_cards_owner_isolation ON fin_credit_cards
  USING  (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

-- ── Add card_id to fin_expenses ────────────────────────────────────────────────

ALTER TABLE fin_expenses
  ADD COLUMN card_id UUID REFERENCES fin_credit_cards(id) ON DELETE SET NULL;

CREATE INDEX idx_exp_card ON fin_expenses(card_id) WHERE card_id IS NOT NULL;
