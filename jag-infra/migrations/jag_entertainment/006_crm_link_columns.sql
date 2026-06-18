-- Migration 006: Add crm_contact_id to ent_members for CRM cross-linking
-- Nullable UUID — no FK constraint (cross-DB reference to jag_commercial.crm_contacts)

ALTER TABLE ent_members
  ADD COLUMN IF NOT EXISTS crm_contact_id UUID;

COMMENT ON COLUMN ent_members.crm_contact_id IS 'Optional link to crm_contacts.id in jag_commercial';
