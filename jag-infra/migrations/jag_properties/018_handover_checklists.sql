-- Migration 018: Handover Checklists (entry and exit)

CREATE TABLE prop_handover_checklists (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID NOT NULL,
  unit_id               UUID NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  lease_id              UUID REFERENCES prop_lease_agreements(id) ON DELETE SET NULL,
  type                  VARCHAR(10) NOT NULL CHECK (type IN ('ENTRY','EXIT')),
  tec_meter_reading     VARCHAR(50),
  tec_account_number    VARCHAR(50),
  wasa_meter_reading    VARCHAR(50),
  wasa_account_number   VARCHAR(50),
  -- [{"item":"Living Room Walls","condition":"Good","notes":"...","photo_urls":["..."]}]
  condition_items       JSONB NOT NULL DEFAULT '[]',
  -- [{"item":"Stove","qty":1,"condition":"Good","serial":"..."}]
  inventory_items       JSONB NOT NULL DEFAULT '[]',
  keys_issued           INT DEFAULT 0,
  keys_returned         INT,
  gate_remotes_issued   INT DEFAULT 0,
  gate_remotes_returned INT,
  photo_urls            JSONB NOT NULL DEFAULT '[]',
  tenant_signed         BOOLEAN DEFAULT FALSE,
  tenant_signed_at      TIMESTAMPTZ,
  manager_signed        BOOLEAN DEFAULT FALSE,
  manager_signed_at     TIMESTAMPTZ,
  handover_form_url     TEXT,
  notes                 TEXT,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_handover_checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_handover_checklists_owner ON prop_handover_checklists
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_handover_unit  ON prop_handover_checklists(unit_id);
CREATE INDEX idx_prop_handover_lease ON prop_handover_checklists(lease_id);
