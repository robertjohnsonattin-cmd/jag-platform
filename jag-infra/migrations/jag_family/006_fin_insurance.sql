-- jag_family — Migration 006: Insurance module (Phase 5)
-- Run against jag_family as jag_app.
--
-- Tables:
--   fin_insurance_policies  — master policy registry
--   fin_insurance_premiums  — premium payment schedule and tracking
--   fin_insurance_claims    — claims against policies
--
-- Renewal alerts: the GET /finance/insurance/policies/expiring endpoint returns
-- policies within their renewal_alert_days window and writes to pending_events
-- so the event dispatcher can notify Robert. The alert fires once per policy per
-- renewal cycle (deduplicated by idempotency on the outbox insert).
--
-- RLS: withOwnerRLS — app.current_owner_id

-- ── ENUMS ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE insurance_policy_type AS ENUM (
    'PROPERTY', 'VEHICLE', 'LIABILITY', 'LIFE', 'HEALTH',
    'BUSINESS_INTERRUPTION', 'MARINE', 'PROFESSIONAL_INDEMNITY', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE insurance_asset_type AS ENUM (
    'VEHICLE', 'PROPERTY', 'BUSINESS', 'PERSON', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE premium_frequency AS ENUM (
    'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'ONE_OFF'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE premium_status AS ENUM ('DUE', 'PAID', 'OVERDUE', 'WAIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE claim_status AS ENUM (
    'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SETTLED', 'WITHDRAWN'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── fin_insurance_policies ────────────────────────────────────────────────────

CREATE TABLE fin_insurance_policies (
  id                  UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID                   NOT NULL,
  owner_entity_id     UUID                   NOT NULL,   -- jag_core.tenants.id
  policy_number       VARCHAR(100)           NOT NULL,
  insurer_name        VARCHAR(200)           NOT NULL,
  broker_name         VARCHAR(200),
  policy_type         insurance_policy_type  NOT NULL,
  insured_asset_type  insurance_asset_type   NOT NULL,
  insured_asset_ref   UUID,                              -- logical FK: fam_personal_vehicles.id, prop_properties.id, etc.
  coverage_amount     NUMERIC(18,2)          NOT NULL,
  currency            CHAR(3)                NOT NULL DEFAULT 'TTD',
  coverage_amount_ttd NUMERIC(18,2)          NOT NULL,
  premium_amount      NUMERIC(18,2)          NOT NULL,
  premium_amount_ttd  NUMERIC(18,2)          NOT NULL,
  premium_frequency   premium_frequency      NOT NULL,
  start_date          DATE                   NOT NULL,
  expiry_date         DATE                   NOT NULL,
  renewal_alert_days  SMALLINT               NOT NULL DEFAULT 60,
  gl_expense_account_id UUID                 REFERENCES fin_gl_accounts(id),  -- premium expense account
  is_active           BOOLEAN                NOT NULL DEFAULT true,
  notes               TEXT,
  created_at          TIMESTAMPTZ            NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ            NOT NULL DEFAULT now(),

  CONSTRAINT chk_ins_dates CHECK (expiry_date > start_date),
  CONSTRAINT chk_ins_alert_days CHECK (renewal_alert_days BETWEEN 7 AND 365)
);

CREATE INDEX idx_ins_pol_owner        ON fin_insurance_policies(owner_id);
CREATE INDEX idx_ins_pol_entity       ON fin_insurance_policies(owner_entity_id);
CREATE INDEX idx_ins_pol_type         ON fin_insurance_policies(policy_type);
CREATE INDEX idx_ins_pol_expiry       ON fin_insurance_policies(expiry_date) WHERE is_active = true;
CREATE INDEX idx_ins_pol_asset_ref    ON fin_insurance_policies(insured_asset_ref) WHERE insured_asset_ref IS NOT NULL;

ALTER TABLE fin_insurance_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY ins_pol_owner_isolation ON fin_insurance_policies
  USING  (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

-- ── fin_insurance_premiums ────────────────────────────────────────────────────

CREATE TABLE fin_insurance_premiums (
  id               UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID             NOT NULL,
  policy_id        UUID             NOT NULL REFERENCES fin_insurance_policies(id) ON DELETE CASCADE,
  due_date         DATE             NOT NULL,
  paid_date        DATE,
  amount           NUMERIC(18,2)    NOT NULL,
  currency         CHAR(3)          NOT NULL DEFAULT 'TTD',
  amount_ttd       NUMERIC(18,2)    NOT NULL,
  fx_rate_used     NUMERIC(12,6),
  payment_method   TEXT             NOT NULL DEFAULT 'BANK_TRANSFER'
    CHECK (payment_method IN ('CASH','BANK_TRANSFER','CREDIT_CARD','CHEQUE','DIRECT_DEBIT','OTHER')),
  status           premium_status   NOT NULL DEFAULT 'DUE',
  gl_entry_id      UUID             REFERENCES fin_journal_entries(id),
  receipt_path     VARCHAR(500),
  receipt_filename VARCHAR(200),
  notes            TEXT,
  idempotency_key  TEXT             NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE INDEX idx_ins_prem_owner    ON fin_insurance_premiums(owner_id);
CREATE INDEX idx_ins_prem_policy   ON fin_insurance_premiums(policy_id);
CREATE INDEX idx_ins_prem_due_date ON fin_insurance_premiums(due_date);
CREATE INDEX idx_ins_prem_status   ON fin_insurance_premiums(status);
CREATE INDEX idx_ins_prem_idem     ON fin_insurance_premiums(idempotency_key);

ALTER TABLE fin_insurance_premiums ENABLE ROW LEVEL SECURITY;

CREATE POLICY ins_prem_owner_isolation ON fin_insurance_premiums
  USING  (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

-- ── fin_insurance_claims ──────────────────────────────────────────────────────

CREATE TABLE fin_insurance_claims (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID          NOT NULL,
  policy_id           UUID          NOT NULL REFERENCES fin_insurance_policies(id) ON DELETE CASCADE,
  claim_reference     VARCHAR(100),             -- insurer's reference number
  incident_date       DATE          NOT NULL,
  claim_date          DATE          NOT NULL,
  description         TEXT          NOT NULL,
  claimed_amount_ttd  NUMERIC(18,2) NOT NULL,
  settled_amount_ttd  NUMERIC(18,2),
  status              claim_status  NOT NULL DEFAULT 'SUBMITTED',
  settlement_date     DATE,
  gl_entry_id         UUID          REFERENCES fin_journal_entries(id),
  notes               TEXT,
  idempotency_key     TEXT          NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_ins_claim_owner    ON fin_insurance_claims(owner_id);
CREATE INDEX idx_ins_claim_policy   ON fin_insurance_claims(policy_id);
CREATE INDEX idx_ins_claim_status   ON fin_insurance_claims(status);
CREATE INDEX idx_ins_claim_date     ON fin_insurance_claims(claim_date);
CREATE INDEX idx_ins_claim_idem     ON fin_insurance_claims(idempotency_key);

ALTER TABLE fin_insurance_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY ins_claim_owner_isolation ON fin_insurance_claims
  USING  (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);
