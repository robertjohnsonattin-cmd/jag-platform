-- Migration 024: Add crm_contact_id to prop_contractors for CRM cross-linking
-- Nullable UUID — no FK constraint (cross-DB reference to jag_commercial.crm_contacts)

ALTER TABLE prop_contractors
  ADD COLUMN IF NOT EXISTS crm_contact_id UUID;

COMMENT ON COLUMN prop_contractors.crm_contact_id IS 'Optional link to crm_contacts.id in jag_commercial';
