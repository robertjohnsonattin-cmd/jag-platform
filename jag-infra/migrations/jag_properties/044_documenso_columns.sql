-- Migration: 044_documenso_columns
-- Switches e-signature integration from DocuSeal to Documenso (DocuSeal's free
-- self-hosted edition turned out to 404 "Pro Edition" on create-from-PDF;
-- Documenso's Community Edition was smoke-tested and confirmed to work).
-- The old docuseal_submission_id columns were never populated in production
-- (the send-for-signing call always failed before reaching that point), so
-- there is no data to migrate — additive only (STD-13); the dead docuseal_
-- columns are left in place for now and can be dropped in a future contract
-- migration once the Documenso integration has been live for a while.

ALTER TABLE prop_lease_agreements
  ADD COLUMN IF NOT EXISTS documenso_document_id TEXT;

ALTER TABLE prop_handover_checklists
  ADD COLUMN IF NOT EXISTS documenso_document_id TEXT;
