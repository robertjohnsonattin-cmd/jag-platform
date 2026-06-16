-- jag_family — Migration 009: Investment valuation history
-- Run against jag_family as jag_app.
--
-- Adds fin_investment_valuations — append-only snapshot log.
-- A row is inserted every time fin_investments is PATCH'd via the API.
-- as_of_date = last_valued_at::date if supplied, otherwise CURRENT_DATE.
--
-- This gives a full monthly price / value history per holding without
-- overwriting the current values on the parent table.
--
-- RLS: same owner_id guard as fin_investments (withOwnerRLS).

CREATE TABLE fin_investment_valuations (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id        UUID          NOT NULL
    REFERENCES fin_investments(id) ON DELETE CASCADE,
  owner_id             UUID          NOT NULL,
  as_of_date           DATE          NOT NULL,
  units_held           NUMERIC(20,6),
  price_per_unit       NUMERIC(20,6),
  current_value_ttd    NUMERIC(20,2) NOT NULL,
  unrealised_gain_ttd  NUMERIC(20,2),
  notes                TEXT,
  recorded_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX ON fin_investment_valuations (investment_id, as_of_date DESC);
CREATE INDEX ON fin_investment_valuations (owner_id, as_of_date DESC);

ALTER TABLE fin_investment_valuations ENABLE ROW LEVEL SECURITY;

CREATE POLICY fin_investment_valuations_owner ON fin_investment_valuations
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);
