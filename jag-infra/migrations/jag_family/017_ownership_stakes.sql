-- jag_family — Migration 017: Beneficial-ownership cap table
-- Run against jag_family as jag_app.
--
-- Adds fam_ownership_stakes — records which family member(s) beneficially own each
-- business entity and each personally-held asset, with a percentage share.
--
--   subject_kind = 'ENTITY'   → subject_id is an owner_entity_id UUID
--                               (business tenant 001-007 OR personal finance entity 008-013)
--   subject_kind = 'PROPERTY' → subject_id is prop_properties.id (jag_properties, soft ref)
--   subject_kind = 'ITEM'     → subject_id is ims_items.id      (jag_commercial, soft ref;
--                               vehicles are ims_items with is_asset = true)
--
-- Cross-DB references are soft (no FK) per STD-01. subject_label is denormalised for display.
-- A person's estate share of an ENTITY = ownership_percent × that entity's net_worth_ttd.
-- A directly-owned PROPERTY/ITEM is attributed to the owner and excluded from its entity's
-- net-worth total (see routes/finance/net-worth.ts) so nothing is double-counted.
--
-- RLS: owner-scoped (withOwnerRLS — app.current_owner_id), same guard as every fam_* table.

CREATE TABLE fam_ownership_stakes (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           UUID          NOT NULL,
  family_member_id   UUID          NOT NULL,   -- soft ref → fam_family_members(id)
  subject_kind       TEXT          NOT NULL
    CHECK (subject_kind IN ('ENTITY','PROPERTY','ITEM')),
  subject_id         TEXT          NOT NULL,   -- owner_entity_id UUID, or cross-DB asset UUID
  subject_label      VARCHAR(200)  NOT NULL,
  ownership_percent  NUMERIC(5,2)  NOT NULL
    CHECK (ownership_percent > 0 AND ownership_percent <= 100),
  notes              VARCHAR(2000),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- One person should not hold two stake rows in the same subject.
CREATE UNIQUE INDEX uq_ownership_stake_member_subject
  ON fam_ownership_stakes (family_member_id, subject_kind, subject_id);

CREATE INDEX idx_ownership_stake_member  ON fam_ownership_stakes (family_member_id);
CREATE INDEX idx_ownership_stake_subject ON fam_ownership_stakes (subject_kind, subject_id);

ALTER TABLE fam_ownership_stakes ENABLE ROW LEVEL SECURITY;

CREATE POLICY fam_ownership_stakes_owner ON fam_ownership_stakes
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

-- Table is owned by postgres (so RLS ENABLE enforces against jag_app — the app role).
GRANT SELECT, INSERT, UPDATE, DELETE ON fam_ownership_stakes TO jag_app;
