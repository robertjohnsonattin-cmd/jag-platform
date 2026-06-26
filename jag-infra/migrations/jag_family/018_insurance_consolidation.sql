-- jag_family — Migration 018: Insurance consolidation
-- Extends fin_insurance_policies to become the single source of truth for all
-- insurance across vehicles, properties, and entertainment bonds.
--
-- IMPORTANT: The ALTER TYPE ADD VALUE statements cannot run inside a transaction.
-- Run this file with: psql -h 127.0.0.1 -U jag_app -d jag_family -f 018_insurance_consolidation.sql
-- (Do NOT wrap in BEGIN/COMMIT — node-pg-migrate must use noTransaction mode for this file)

-- ── New policy_type values ────────────────────────────────────────────────────
-- Property sub-types (formerly prop_insurance.insurance_type)
ALTER TYPE insurance_policy_type ADD VALUE IF NOT EXISTS 'BUILDING';
ALTER TYPE insurance_policy_type ADD VALUE IF NOT EXISTS 'CONTENTS';
ALTER TYPE insurance_policy_type ADD VALUE IF NOT EXISTS 'FLOOD';
ALTER TYPE insurance_policy_type ADD VALUE IF NOT EXISTS 'FIRE';
ALTER TYPE insurance_policy_type ADD VALUE IF NOT EXISTS 'COMPREHENSIVE';

-- Entertainment / business bonds
ALTER TYPE insurance_policy_type ADD VALUE IF NOT EXISTS 'SURETY_BOND';
ALTER TYPE insurance_policy_type ADD VALUE IF NOT EXISTS 'PERFORMANCE_BOND';

-- ── sub_type — free-text sub-classification ───────────────────────────────────
-- Optional extra detail (e.g. "Third-party only", "All-risks", "TWOC")
ALTER TABLE fin_insurance_policies ADD COLUMN IF NOT EXISTS sub_type VARCHAR(50);

-- ── Harden RLS with NULLIF (GUC empty-string safety) ─────────────────────────
DROP POLICY IF EXISTS ins_pol_owner_isolation ON fin_insurance_policies;
CREATE POLICY ins_pol_owner_isolation ON fin_insurance_policies
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

DROP POLICY IF EXISTS ins_prem_owner_isolation ON fin_insurance_premiums;
CREATE POLICY ins_prem_owner_isolation ON fin_insurance_premiums
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

DROP POLICY IF EXISTS ins_claim_owner_isolation ON fin_insurance_claims;
CREATE POLICY ins_claim_owner_isolation ON fin_insurance_claims
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

DROP POLICY IF EXISTS fin_insurance_policy_history_owner ON fin_insurance_policy_history;
CREATE POLICY fin_insurance_policy_history_owner ON fin_insurance_policy_history
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);
