-- jag_family — Migration 010: Loan balance history
-- Run against jag_family as jag_app.
--
-- Adds fin_loan_balance_history — append-only snapshot log.
-- A row is inserted every time fin_mortgages_loans is PATCH'd via the API,
-- and can also be backfilled manually via POST /finance/loans/:id/history.
--
-- Tracks outstanding_balance, interest_rate, monthly_payment per date.
-- as_of_date = CURRENT_DATE unless overridden in the backfill form.
--
-- RLS: same owner_id guard as fin_mortgages_loans (withOwnerRLS).

CREATE TABLE fin_loan_balance_history (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id              UUID          NOT NULL
    REFERENCES fin_mortgages_loans(id) ON DELETE CASCADE,
  owner_id             UUID          NOT NULL,
  as_of_date           DATE          NOT NULL,
  outstanding_balance  NUMERIC(20,2) NOT NULL,
  interest_rate        NUMERIC(6,4),
  monthly_payment      NUMERIC(20,2),
  notes                TEXT,
  recorded_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX ON fin_loan_balance_history (loan_id, as_of_date DESC);
CREATE INDEX ON fin_loan_balance_history (owner_id, as_of_date DESC);

ALTER TABLE fin_loan_balance_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY fin_loan_balance_history_owner ON fin_loan_balance_history
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);
