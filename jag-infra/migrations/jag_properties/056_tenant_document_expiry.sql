-- Migration 056: expiry-date tracking on the tenant document vault
--
-- prop_tenant_documents has no way to flag that an uploaded ID/certificate
-- has an expiry (passports, driver's licences, police certificates). Adds a
-- nullable expiry_date so the UI can warn on upload and flag docs that are
-- expiring soon or already expired, without requiring re-upload to correct.

ALTER TABLE prop_tenant_documents
  ADD COLUMN expiry_date DATE;

CREATE INDEX idx_prop_tenant_documents_expiry ON prop_tenant_documents(expiry_date)
  WHERE expiry_date IS NOT NULL;
