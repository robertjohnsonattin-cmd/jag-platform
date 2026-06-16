-- jag_properties — Migration 012: Property valuation history
-- Run against jag_properties as jag_app.
--
-- Adds prop_valuation_history — append-only snapshot log.
-- A row is inserted every time prop_properties is PATCH'd with current_valuation,
-- and can also be backfilled manually via POST /properties/:id/valuation-history.
--
-- Tracks valuation_ttd per date.
-- as_of_date = CURRENT_DATE unless overridden in the backfill form.
--
-- RLS: same owner_id guard as prop_properties (withOwnerRLS).

CREATE TABLE prop_valuation_history (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    UUID          NOT NULL
    REFERENCES prop_properties(id) ON DELETE CASCADE,
  owner_id       UUID          NOT NULL,
  as_of_date     DATE          NOT NULL,
  valuation_ttd  NUMERIC(20,2) NOT NULL,
  notes          TEXT,
  recorded_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX ON prop_valuation_history (property_id, as_of_date DESC);
CREATE INDEX ON prop_valuation_history (owner_id, as_of_date DESC);

ALTER TABLE prop_valuation_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY prop_valuation_history_owner ON prop_valuation_history
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);
