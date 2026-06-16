-- jag_family — Migration 011: Insurance policy history
-- Run against jag_family as jag_app.
--
-- Adds fin_insurance_policy_history — append-only snapshot log.
-- A row is inserted every time fin_insurance_policies is PATCH'd via the API,
-- and can also be backfilled manually via POST /finance/insurance/policies/:id/history.
--
-- Tracks coverage_amount_ttd, premium_amount_ttd, expiry_date per date.
-- as_of_date = CURRENT_DATE unless overridden in the backfill form.
--
-- RLS: same owner_id guard as fin_insurance_policies (withOwnerRLS).

CREATE TABLE fin_insurance_policy_history (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id            UUID          NOT NULL
    REFERENCES fin_insurance_policies(id) ON DELETE CASCADE,
  owner_id             UUID          NOT NULL,
  as_of_date           DATE          NOT NULL,
  coverage_amount_ttd  NUMERIC(20,2) NOT NULL,
  premium_amount_ttd   NUMERIC(20,2) NOT NULL,
  expiry_date          DATE,
  notes                TEXT,
  recorded_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX ON fin_insurance_policy_history (policy_id, as_of_date DESC);
CREATE INDEX ON fin_insurance_policy_history (owner_id, as_of_date DESC);

ALTER TABLE fin_insurance_policy_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY fin_insurance_policy_history_owner ON fin_insurance_policy_history
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);
