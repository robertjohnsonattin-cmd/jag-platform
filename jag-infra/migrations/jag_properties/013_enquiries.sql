-- Migration 013: Enquiries & Lead Capture
-- prop_enquiries: one record per inbound prospect contact

CREATE TABLE prop_enquiries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL,
  unit_id          UUID REFERENCES prop_units(id) ON DELETE SET NULL,
  property_id      UUID REFERENCES prop_properties(id) ON DELETE SET NULL,
  prospect_name    VARCHAR(200),
  prospect_phone   VARCHAR(30),
  prospect_email   VARCHAR(200),
  channel          VARCHAR(20) NOT NULL CHECK (channel IN ('WHATSAPP','SMS','EMAIL','PHONE','WALK_IN','FACEBOOK')),
  initial_message  TEXT,
  stage            VARCHAR(30) NOT NULL DEFAULT 'NEW_LEAD'
    CHECK (stage IN ('NEW_LEAD','VIEWING_SCHEDULED','VIEWED','APPLICATION_SENT','APPLICATION_RECEIVED','SCREENING','APPROVED','REJECTED','WITHDRAWN','CONVERTED')),
  no_show          BOOLEAN DEFAULT FALSE,
  flagged          BOOLEAN DEFAULT FALSE,
  flag_reason      TEXT,
  wa_thread_id     VARCHAR(100),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_contact_at  TIMESTAMPTZ
);

ALTER TABLE prop_enquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_enquiries_owner ON prop_enquiries
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_enquiries_unit   ON prop_enquiries(unit_id);
CREATE INDEX idx_prop_enquiries_stage  ON prop_enquiries(stage);
CREATE INDEX idx_prop_enquiries_phone  ON prop_enquiries(prospect_phone);
