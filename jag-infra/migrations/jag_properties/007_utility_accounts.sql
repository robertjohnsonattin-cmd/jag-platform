-- Migration: 007_utility_accounts
-- Utility service accounts per property (avoids re-entering provider/account number on every bill).

CREATE TABLE IF NOT EXISTS prop_utility_accounts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID        NOT NULL,
  property_id      UUID        NOT NULL REFERENCES prop_properties(id) ON DELETE CASCADE,
  utility_type     TEXT        NOT NULL CHECK (utility_type IN ('ELECTRICITY','WATER','GAS','INTERNET','OTHER')),
  provider         TEXT        NOT NULL,
  account_number   TEXT,
  account_name     TEXT,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE prop_utility_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY prop_utility_accounts_owner ON prop_utility_accounts
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid);

-- Expand: link individual bills to an account (nullable — existing bills unaffected).
ALTER TABLE prop_utility_bills
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES prop_utility_accounts(id) ON DELETE SET NULL;
