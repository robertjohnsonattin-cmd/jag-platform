-- Migration 027: Add crm_contact_id to db_clients for CRM cross-linking
-- Nullable UUID — no FK constraint (cross-DB reference to jag_commercial.crm_contacts)

ALTER TABLE db_clients
  ADD COLUMN IF NOT EXISTS crm_contact_id UUID;

COMMENT ON COLUMN db_clients.crm_contact_id IS 'Optional link to crm_contacts.id in jag_commercial';
