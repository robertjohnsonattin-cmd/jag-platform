-- Migration 059: Bank statement <-> rent payment reconciliation (Phase 1, link-only)
--
-- Links a bank credit (fin_transactions, in the SEPARATE jag_family database)
-- to a rent period it pays for. Because the bank line lives in another database,
-- bank_txn_id is a plain UUID with NO foreign key -- referential integrity is
-- enforced in the application layer, and a denormalized snapshot of the bank
-- line is stored so the properties DB can render a match without a cross-DB read.
--
-- Phase 1 is link-only: creating a match does NOT change rent status, generate a
-- receipt, or notify the tenant. match_type records whether the link was created
-- by the auto-matcher or chosen by hand. A given bank credit can only be linked
-- to one rent period (UNIQUE bank_txn_id); a rent period may receive several
-- bank lines (partial payments), so rent_schedule_id is intentionally not unique.

CREATE TABLE prop_rent_bank_matches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID NOT NULL,
  rent_schedule_id  UUID NOT NULL REFERENCES prop_rent_schedule(id) ON DELETE CASCADE,
  bank_txn_id       UUID NOT NULL,                 -- lives in jag_family.fin_transactions; no FK
  bank_txn_date     DATE NOT NULL,
  bank_amount_ttd   NUMERIC(12,2) NOT NULL,
  bank_description  TEXT,
  match_type        VARCHAR(10) NOT NULL DEFAULT 'MANUAL' CHECK (match_type IN ('AUTO','MANUAL')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bank_txn_id)
);

ALTER TABLE prop_rent_bank_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_rent_bank_matches_owner ON prop_rent_bank_matches
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_rent_bank_matches_rent ON prop_rent_bank_matches(rent_schedule_id);
CREATE INDEX idx_prop_rent_bank_matches_txn  ON prop_rent_bank_matches(bank_txn_id);
