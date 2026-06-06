-- jag_family — Migration 001: Initial schema
-- STD-04: All schema changes are migration files. This file captures the
-- jag_family schema that was previously bootstrapped outside of migrations.
-- Run against jag_family as jag_app.
--
-- Tables:
--   fam_family_members       — family member registry (root table)
--   fam_succession_documents — succession / legal document register
--   fam_docvault_files       — personal document vault (MinIO-backed)
--   fam_loyalty_programmes   — loyalty programme memberships (airline, hotel, CC, etc.)
--   fam_loyalty_transactions — loyalty points/miles transaction ledger
--   fam_lifestyle_tracker    — personal health & wellness metrics
--
-- RLS: owner-scoped (withOwnerRLS) — app.current_owner_id
-- All tables: jag_family is private to Robert. No multi-tenant isolation.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO jag_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO jag_app;

-- ── fam_family_members ────────────────────────────────────────────────────────

CREATE TABLE fam_family_members (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID        NOT NULL,
  relationship          TEXT        NOT NULL
    CHECK (relationship IN ('SELF','WIFE','DAUGHTER','FATHER','BROTHER','OTHER')),
  first_name            TEXT        NOT NULL,
  last_name             TEXT        NOT NULL,
  date_of_birth         DATE,
  email                 TEXT,
  phone                 VARCHAR(30),
  preferred_language    TEXT        NOT NULL DEFAULT 'en'
    CHECK (preferred_language IN ('en','zh','es')),
  is_emergency_designate BOOLEAN    NOT NULL DEFAULT false,
  keycloak_user_id      TEXT,                   -- set when family member has platform access
  notes                 VARCHAR(2000),
  last_modified_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── fam_succession_documents ──────────────────────────────────────────────────

CREATE TABLE fam_succession_documents (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID        NOT NULL,
  document_type         TEXT        NOT NULL
    CHECK (document_type IN ('WILL','TRUST','POWER_OF_ATTORNEY','INSURANCE_POLICY',
                             'TITLE_DEED','SHARE_CERTIFICATE','BANK_MANDATE',
                             'COMPANY_RESOLUTION','ADVANCE_DIRECTIVE','OTHER')),
  title                 VARCHAR(200) NOT NULL,
  description           VARCHAR(2000),
  document_date         DATE,
  storage_path          VARCHAR(500),           -- MinIO object path
  is_classified         BOOLEAN     NOT NULL DEFAULT true,
  governing_law         VARCHAR(100),
  lawyer_firm           VARCHAR(200),           -- firm name only — OPSEC: no individual names
  last_reviewed_date    DATE,
  review_reminder_date  DATE,
  notes                 VARCHAR(2000),
  last_modified_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── fam_docvault_files ────────────────────────────────────────────────────────

CREATE TABLE fam_docvault_files (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID        NOT NULL,
  family_member_id  UUID        REFERENCES fam_family_members(id),
  title             VARCHAR(200) NOT NULL,
  document_type     TEXT        NOT NULL
    CHECK (document_type IN ('NATIONAL_ID','PASSPORT','BIRTH_CERTIFICATE',
                             'MARRIAGE_CERTIFICATE','DEATH_CERTIFICATE','MEDICAL_RECORD',
                             'ACADEMIC_CERTIFICATE','PROFESSIONAL_LICENCE',
                             'FINANCIAL_STATEMENT','TAX_RETURN','INSURANCE_POLICY',
                             'PROPERTY_TITLE','LEGAL_AGREEMENT','OTHER')),
  file_name         VARCHAR(200) NOT NULL,
  storage_path      VARCHAR(500) NOT NULL,      -- MinIO object path
  mime_type         VARCHAR(100) NOT NULL,
  file_size_bytes   BIGINT      NOT NULL CHECK (file_size_bytes > 0),
  expires_date      DATE,
  is_data_room      BOOLEAN     NOT NULL DEFAULT false,
  data_room_entity  VARCHAR(50),                -- which entity's data room this belongs to
  uploaded_by       UUID        NOT NULL,       -- users.id of uploader
  notes             VARCHAR(2000),
  last_modified_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── fam_loyalty_programmes ────────────────────────────────────────────────────

CREATE TABLE fam_loyalty_programmes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID        NOT NULL,
  family_member_id  UUID        REFERENCES fam_family_members(id),
  programme_type    TEXT        NOT NULL
    CHECK (programme_type IN ('AIRLINE','HOTEL','CRUISE','CREDIT_CARD','RETAIL','DINING','OTHER')),
  provider_name     VARCHAR(200) NOT NULL,
  membership_number VARCHAR(100),
  tier              VARCHAR(50),
  points_balance    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  miles_balance     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (miles_balance >= 0),
  expiry_date       DATE,
  notes             VARCHAR(2000),
  last_modified_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── fam_loyalty_transactions ──────────────────────────────────────────────────
-- STD-11: idempotency_key on every write.

CREATE TABLE fam_loyalty_transactions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID        NOT NULL,
  programme_id     UUID        NOT NULL REFERENCES fam_loyalty_programmes(id),
  transaction_date DATE        NOT NULL,
  transaction_type TEXT        NOT NULL
    CHECK (transaction_type IN ('EARN','REDEEM','EXPIRE','TRANSFER_IN','TRANSFER_OUT','BONUS','REINSTATEMENT')),
  points_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
  miles_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  description      VARCHAR(300) NOT NULL,
  reference_number VARCHAR(100),
  idempotency_key  TEXT        NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── fam_lifestyle_tracker ─────────────────────────────────────────────────────

CREATE TABLE fam_lifestyle_tracker (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID        NOT NULL,
  family_member_id UUID        REFERENCES fam_family_members(id),
  entry_date       DATE        NOT NULL,
  metric_type      TEXT        NOT NULL
    CHECK (metric_type IN ('WEIGHT_KG','STEPS','SLEEP_HOURS','CALORIES','EXERCISE_MINUTES',
                           'BLOOD_PRESSURE_SYSTOLIC','BLOOD_PRESSURE_DIASTOLIC',
                           'RESTING_HEART_RATE','OTHER')),
  value            NUMERIC(10,4) NOT NULL,
  unit             VARCHAR(20) NOT NULL,
  source           VARCHAR(50),
  notes            VARCHAR(500),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX ON fam_family_members       (owner_id, relationship);
CREATE INDEX ON fam_succession_documents (owner_id, document_type);
CREATE INDEX ON fam_succession_documents (review_reminder_date) WHERE review_reminder_date IS NOT NULL;
CREATE INDEX ON fam_docvault_files       (owner_id, document_type);
CREATE INDEX ON fam_docvault_files       (family_member_id) WHERE family_member_id IS NOT NULL;
CREATE INDEX ON fam_docvault_files       (expires_date) WHERE expires_date IS NOT NULL;
CREATE INDEX ON fam_loyalty_programmes   (owner_id, programme_type);
CREATE INDEX ON fam_loyalty_programmes   (family_member_id) WHERE family_member_id IS NOT NULL;
CREATE INDEX ON fam_loyalty_transactions (programme_id, transaction_date DESC);
CREATE INDEX ON fam_lifestyle_tracker    (owner_id, entry_date DESC);
CREATE INDEX ON fam_lifestyle_tracker    (family_member_id, metric_type) WHERE family_member_id IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- jag_family uses withOwnerRLS — sets app.current_owner_id for the transaction.
-- Policy: row is visible only to its owner. Fail-closed: missing setting returns
-- null cast, which matches no rows.

ALTER TABLE fam_family_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fam_succession_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE fam_docvault_files       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fam_loyalty_programmes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fam_loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fam_lifestyle_tracker    ENABLE ROW LEVEL SECURITY;

CREATE POLICY fam_owner_isolation ON fam_family_members
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY fam_owner_isolation ON fam_succession_documents
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY fam_owner_isolation ON fam_docvault_files
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY fam_owner_isolation ON fam_loyalty_programmes
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY fam_owner_isolation ON fam_loyalty_transactions
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY fam_owner_isolation ON fam_lifestyle_tracker
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);
