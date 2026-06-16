-- jag_family — Migration 008: Document import jobs
-- Run against jag_family as jag_app.
--
-- Adds:
--   1. ANNUITY to fin_investments investment_type CHECK constraint
--   2. fin_document_jobs — async document extraction job tracker for
--      Path 1 (cloud upload → MinIO → Ollama batch → review → approve)
--      Covers doc types: LOAN, INVESTMENT, INSURANCE
--      Bank statements retain their own fin_bank_statement_jobs table.
--
-- Status lifecycle:
--   PENDING    → queued, file in MinIO, waiting for Ollama batch
--   PROCESSING → Ollama currently working on this job
--   REVIEW     → extracted_data populated, waiting for Robert to approve in UI
--   APPROVED   → data written to target table, target_record_ids populated
--   FAILED     → extraction failed, error_detail populated
--
-- RLS: withOwnerRLS — app.current_owner_id

-- ── 1. Add ANNUITY to fin_investments ─────────────────────────────────────────

ALTER TABLE fin_investments
  DROP CONSTRAINT IF EXISTS fin_investments_investment_type_check;

ALTER TABLE fin_investments
  ADD CONSTRAINT fin_investments_investment_type_check
  CHECK (investment_type IN (
    'EQUITY','BOND','MUTUAL_FUND','ETF','UNIT_TRUST',
    'REAL_ESTATE','PRIVATE_EQUITY','CASH_EQUIVALENT','ANNUITY','OTHER'
  ));

-- ── 2. fin_document_jobs ──────────────────────────────────────────────────────

CREATE TABLE fin_document_jobs (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID          NOT NULL,
  doc_type          TEXT          NOT NULL
    CHECK (doc_type IN ('LOAN', 'INVESTMENT', 'INSURANCE')),
  status            TEXT          NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'REVIEW', 'APPROVED', 'FAILED')),
  file_name         VARCHAR(300)  NOT NULL,
  storage_path      VARCHAR(500)  NOT NULL,        -- MinIO key in jag-documents bucket
  mime_type         VARCHAR(100)  NOT NULL,
  extracted_data    JSONB,                          -- Ollama output; structure varies by doc_type
  target_record_ids UUID[],                         -- IDs of records created on APPROVED
  error_detail      TEXT,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  idempotency_key   TEXT          NOT NULL UNIQUE,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX ON fin_document_jobs (owner_id, status);
CREATE INDEX ON fin_document_jobs (owner_id, doc_type);
CREATE INDEX ON fin_document_jobs (created_at DESC);

ALTER TABLE fin_document_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY fin_doc_jobs_owner_isolation ON fin_document_jobs
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);
