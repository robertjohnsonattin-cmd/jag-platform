-- Migration: 014_crm_contact_phone2
-- Adds a secondary phone number column to crm_contacts.

ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS phone2 VARCHAR(50) NULL;

COMMENT ON COLUMN crm_contacts.phone2 IS 'Secondary / alternate phone number';
