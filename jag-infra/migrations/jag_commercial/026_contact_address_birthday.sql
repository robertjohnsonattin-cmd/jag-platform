-- Migration 026: Add address fields + birthday to crm_contacts
-- notes already exists from initial schema; phone2 already exists from migration 014

ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS address_line1  VARCHAR(200),
  ADD COLUMN IF NOT EXISTS address_line2  VARCHAR(200),
  ADD COLUMN IF NOT EXISTS city           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state_province VARCHAR(100),
  ADD COLUMN IF NOT EXISTS postal_code    VARCHAR(20),
  ADD COLUMN IF NOT EXISTS birthday       DATE;
