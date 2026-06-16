-- Migration 022: Unit listing/utility fields

ALTER TABLE prop_units
  ADD COLUMN IF NOT EXISTS wasa_included                  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS electricity_included           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS internet_included              BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS listing_status                 VARCHAR(20) DEFAULT 'VACANT'
    CHECK (listing_status IN ('VACANT','LISTED','OCCUPIED','MAINTENANCE')),
  ADD COLUMN IF NOT EXISTS facebook_listing_id            VARCHAR(200),
  ADD COLUMN IF NOT EXISTS facebook_listed_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suggested_rent_min_ttd         NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS suggested_rent_max_ttd         NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS suggested_rent_recommended_ttd NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS days_on_market                 INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS listed_at                      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS booking_slug                   VARCHAR(100) UNIQUE;

-- prop_broadcast_contacts: SMS broadcast list (never hardcode phone numbers)
CREATE TABLE prop_broadcast_contacts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL,
  name       VARCHAR(200) NOT NULL,
  phone      VARCHAR(30) NOT NULL,
  category   VARCHAR(50),
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_broadcast_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_broadcast_contacts_owner ON prop_broadcast_contacts
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);
