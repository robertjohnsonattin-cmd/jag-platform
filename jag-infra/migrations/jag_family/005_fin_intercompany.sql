-- jag_family — Migration 005: Intercompany charges + eliminations (Phase 5)
-- Run against jag_family as jag_app.
--
-- Design:
--   Intercompany charges record billing between JAG entities (e.g. JABCO pays a
--   management fee to JAG Holdings, Entertainment pays rent to Properties).
--   On elimination, a GL journal entry is posted with source='INTERCOMPANY' that
--   cancels the charge in the consolidated P&L view.
--
--   Lifecycle: DRAFT → POSTED → ELIMINATED
--     POSTED    = GL entries recorded in both entity books
--     ELIMINATED = elimination GL entry posted; charge cancelled for consolidation
--
-- RLS: withOwnerRLS — app.current_owner_id

-- ── ENUMS ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE intercompany_charge_type AS ENUM (
    'MANAGEMENT_FEE',
    'LOAN_INTEREST',
    'SHARED_SERVICE',
    'DIVIDEND',
    'RENT',
    'RECHARGE',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE intercompany_charge_status AS ENUM ('DRAFT', 'POSTED', 'ELIMINATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── fin_intercompany_charges ──────────────────────────────────────────────────

CREATE TABLE fin_intercompany_charges (
  id               UUID                       PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID                       NOT NULL,
  from_entity_id   UUID                       NOT NULL,   -- billing entity (jag_core.tenants.id)
  to_entity_id     UUID                       NOT NULL,   -- receiving entity
  charge_date      DATE                       NOT NULL,
  description      TEXT                       NOT NULL,
  charge_type      intercompany_charge_type   NOT NULL,
  amount_ttd       NUMERIC(18,2)              NOT NULL,
  currency         CHAR(3)                    NOT NULL DEFAULT 'TTD',
  amount_original  NUMERIC(18,2),
  fx_rate_used     NUMERIC(12,6),
  status           intercompany_charge_status NOT NULL DEFAULT 'DRAFT',
  -- GL entries — set when POSTED
  from_gl_entry_id UUID                       REFERENCES fin_journal_entries(id),  -- revenue/receivable in from_entity
  to_gl_entry_id   UUID                       REFERENCES fin_journal_entries(id),  -- expense/payable in to_entity
  notes            TEXT,
  idempotency_key  TEXT                       NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ                NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ                NOT NULL DEFAULT now(),

  CONSTRAINT chk_icc_different_entities CHECK (from_entity_id <> to_entity_id)
);

CREATE INDEX idx_icc_owner         ON fin_intercompany_charges(owner_id);
CREATE INDEX idx_icc_from_entity   ON fin_intercompany_charges(from_entity_id);
CREATE INDEX idx_icc_to_entity     ON fin_intercompany_charges(to_entity_id);
CREATE INDEX idx_icc_status        ON fin_intercompany_charges(status);
CREATE INDEX idx_icc_date          ON fin_intercompany_charges(charge_date);
CREATE INDEX idx_icc_idempotency   ON fin_intercompany_charges(idempotency_key);

ALTER TABLE fin_intercompany_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY icc_owner_isolation ON fin_intercompany_charges
  USING  (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

-- ── fin_intercompany_eliminations ─────────────────────────────────────────────

CREATE TABLE fin_intercompany_eliminations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID        NOT NULL,
  charge_id             UUID        NOT NULL REFERENCES fin_intercompany_charges(id),
  elimination_date      DATE        NOT NULL,
  period_month          SMALLINT    NOT NULL GENERATED ALWAYS AS (EXTRACT(MONTH FROM elimination_date)::SMALLINT) STORED,
  period_year           SMALLINT    NOT NULL GENERATED ALWAYS AS (EXTRACT(YEAR  FROM elimination_date)::SMALLINT) STORED,
  elimination_gl_entry_id UUID      NOT NULL REFERENCES fin_journal_entries(id),
  eliminated_by         UUID        NOT NULL,   -- jag_core.users.id (Owner only)
  notes                 TEXT,
  idempotency_key       TEXT        NOT NULL UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ice_owner    ON fin_intercompany_eliminations(owner_id);
CREATE INDEX idx_ice_charge   ON fin_intercompany_eliminations(charge_id);
CREATE INDEX idx_ice_period   ON fin_intercompany_eliminations(period_year, period_month);
CREATE INDEX idx_ice_idem     ON fin_intercompany_eliminations(idempotency_key);

ALTER TABLE fin_intercompany_eliminations ENABLE ROW LEVEL SECURITY;

CREATE POLICY ice_owner_isolation ON fin_intercompany_eliminations
  USING  (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);
