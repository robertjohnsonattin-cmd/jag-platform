-- Migration: 043_esignature
-- Adds self-hosted e-signature tracking (DocuSeal) to leases and handover
-- condition checklists. Additive only (STD-13) — existing manual
-- tenant_signed/manager_signed boolean flags on prop_handover_checklists
-- stay as an offline fallback; they get set automatically by the DocuSeal
-- completion webhook going forward instead of a manual PATCH toggle.

ALTER TABLE prop_lease_agreements
  ADD COLUMN IF NOT EXISTS docuseal_submission_id TEXT,
  ADD COLUMN IF NOT EXISTS signature_status TEXT NOT NULL DEFAULT 'UNSIGNED'
    CHECK (signature_status IN ('UNSIGNED','SENT','PARTIALLY_SIGNED','SIGNED','DECLINED','EXPIRED')),
  ADD COLUMN IF NOT EXISTS signed_pdf_object_key TEXT,
  ADD COLUMN IF NOT EXISTS agreement_signed_at TIMESTAMPTZ;

ALTER TABLE prop_handover_checklists
  ADD COLUMN IF NOT EXISTS docuseal_submission_id TEXT,
  ADD COLUMN IF NOT EXISTS signed_pdf_object_key TEXT;
