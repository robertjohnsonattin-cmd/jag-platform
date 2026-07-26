-- jag_family — Migration 029: Medical Records
-- Run against jag_family as postgres (owned by postgres so RLS enforces against jag_app).
--
-- Broadens the Lifestyle "Health Tracker" into "Medical Records": fam_lifestyle_tracker
-- stays as-is (simple metric/value/unit time series the AI Fitness Coach already reads),
-- and this adds fam_medical_records for everything that doesn't fit that shape — lab
-- reports, prescriptions, imaging, clinic cards, referrals, discharge summaries, etc.
--
-- Source documents stay on Robert's local hard drive by design — never uploaded to
-- MinIO/the VM. Only extracted structured data is stored here; source_file_name is a
-- plain filename/path reference for traceability, not an object key (no FK, no bucket).
--
-- Records land at status='REVIEW' when extracted and require explicit approval before
-- being treated as confirmed — extraction (currently done by Claude reading the source
-- PDF directly, not a local Ollama/LM Studio pipeline) is not assumed reliable enough
-- for medical data to auto-commit, especially on handwritten scans.

CREATE TABLE fam_medical_records (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID          NOT NULL,
  family_member_id  UUID          NOT NULL REFERENCES fam_family_members(id),
  record_type       VARCHAR(30)   NOT NULL
    CHECK (record_type IN (
      'LAB_RESULT','IMAGING','PRESCRIPTION','CLINIC_CARD','REFERRAL',
      'DISCHARGE_SUMMARY','VISIT_NOTE','IMMUNIZATION','DEVICE_EQUIPMENT',
      'INVOICE','CHRONOLOGY_SUMMARY','OTHER'
    )),
  specialty         VARCHAR(50),   -- free text — Back, Dental, Eye, Heart, Rheumatology, Urology, General, etc.
  provider_name     VARCHAR(200),  -- treating physician
  facility_name     VARCHAR(200),  -- hospital/clinic/lab
  record_date       DATE,
  record_date_end   DATE,          -- for records spanning a range (e.g. a chronology summary)
  title             VARCHAR(300)  NOT NULL,
  summary           TEXT,
  details           JSONB         NOT NULL DEFAULT '{}'::jsonb, -- type-specific structured fields
  source_file_name  VARCHAR(500),  -- local filename/path reference only — never an uploaded object
  status            VARCHAR(20)   NOT NULL DEFAULT 'REVIEW'
    CHECK (status IN ('REVIEW','APPROVED','REJECTED')),
  extracted_by      VARCHAR(20)   NOT NULL DEFAULT 'CLAUDE'
    CHECK (extracted_by IN ('CLAUDE','OLLAMA','MANUAL')),
  reviewed_at       TIMESTAMPTZ,
  last_modified_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_modified_by  UUID,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_fam_medical_records_member   ON fam_medical_records (family_member_id, record_date DESC);
CREATE INDEX idx_fam_medical_records_status   ON fam_medical_records (status);
CREATE INDEX idx_fam_medical_records_specialty ON fam_medical_records (specialty);

ALTER TABLE fam_medical_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY fam_medical_records_owner ON fam_medical_records
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON fam_medical_records TO jag_app;
