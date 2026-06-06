-- jag_properties — Migration 001: Initial schema
-- STD-04: All schema changes are migration files. This file captures the
-- jag_properties schema that was previously bootstrapped outside of migrations.
-- Run against jag_properties as jag_app. Run BEFORE 002_utilities_vendor_invoices.sql.
--
-- Tables:
--   prop_properties          — property portfolio register
--   prop_property_tenants    — tenants (people/companies who pay rent)
--   prop_lease_agreements    — lease/tenancy agreements
--   prop_rent_payments       — rent payment ledger (STD-11 idempotency)
--   prop_maintenance_requests— maintenance tracking
--   prop_mortgage_register   — mortgage & loan register (STD-11 idempotency)
--   prop_property_pipeline   — acquisition pipeline / deal tracking
--   prop_pending_review_queue— data quality review queue
--
-- RLS: owner-scoped (withOwnerRLS) — app.current_owner_id

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO jag_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO jag_app;

-- ── prop_properties ───────────────────────────────────────────────────────────

CREATE TABLE prop_properties (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID        NOT NULL,
  property_code       VARCHAR(20) NOT NULL UNIQUE,
  name                VARCHAR(200) NOT NULL,
  address_line1       VARCHAR(300),
  address_line2       VARCHAR(300),
  city                VARCHAR(100),
  country             VARCHAR(100) NOT NULL DEFAULT 'Trinidad and Tobago',
  property_type       TEXT        NOT NULL
    CHECK (property_type IN ('RESIDENTIAL','COMMERCIAL','LAND','MIXED','AGRICULTURAL')),
  tenure_type         TEXT        NOT NULL DEFAULT 'FREEHOLD'
    CHECK (tenure_type IN ('FREEHOLD','LEASEHOLD','STATE_LAND')),
  bedrooms            INTEGER,
  bathrooms           NUMERIC(3,1),
  lot_size_sqm        NUMERIC(10,2),
  floor_area_sqm      NUMERIC(10,2),
  is_rented           BOOLEAN     NOT NULL DEFAULT false,
  current_valuation   NUMERIC(14,2),
  valuation_date      DATE,
  purchase_price      NUMERIC(14,2),
  purchase_date       DATE,
  notes               TEXT,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  last_modified_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── prop_property_tenants ─────────────────────────────────────────────────────

CREATE TABLE prop_property_tenants (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                UUID        NOT NULL,
  first_name              VARCHAR(100) NOT NULL,
  last_name               VARCHAR(100),
  company_name            VARCHAR(200),
  is_company              BOOLEAN     NOT NULL DEFAULT false,
  phone                   VARCHAR(30),
  email                   TEXT,
  identification_type     TEXT
    CHECK (identification_type IN ('TT_NIC','PASSPORT','COMPANY_REG','DRIVERS_LICENCE','OTHER')),
  identification_number   VARCHAR(50),
  emergency_contact_name  VARCHAR(100),
  emergency_contact_phone VARCHAR(30),
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── prop_lease_agreements ─────────────────────────────────────────────────────

CREATE TABLE prop_lease_agreements (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID        NOT NULL,
  property_id         UUID        NOT NULL REFERENCES prop_properties(id),
  tenant_id           UUID        NOT NULL REFERENCES prop_property_tenants(id),
  lease_type          TEXT        NOT NULL DEFAULT 'RESIDENTIAL'
    CHECK (lease_type IN ('RESIDENTIAL','COMMERCIAL','SHORT_TERM','OTHER')),
  start_date          DATE        NOT NULL,
  end_date            DATE,
  monthly_rent        NUMERIC(10,2) NOT NULL CHECK (monthly_rent > 0),
  currency            CHAR(3)     NOT NULL DEFAULT 'TTD',
  security_deposit    NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (security_deposit >= 0),
  payment_due_day     INTEGER     NOT NULL DEFAULT 1 CHECK (payment_due_day BETWEEN 1 AND 28),
  status              TEXT        NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','EXPIRED','TERMINATED','PENDING')),
  notes               TEXT,
  last_modified_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── prop_rent_payments ────────────────────────────────────────────────────────
-- STD-11: idempotency_key on every write.

CREATE TABLE prop_rent_payments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID        NOT NULL,
  lease_id         UUID        NOT NULL REFERENCES prop_lease_agreements(id),
  payment_date     DATE        NOT NULL,
  period_month     SMALLINT    NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year      SMALLINT    NOT NULL CHECK (period_year >= 2020),
  amount_due       NUMERIC(10,2) NOT NULL CHECK (amount_due > 0),
  amount_paid      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  late_fee_charged NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (late_fee_charged >= 0),
  payment_method   TEXT        NOT NULL
    CHECK (payment_method IN ('CASH','BANK_TRANSFER','CHEQUE','WIPAY','OTHER')),
  receipt_number   VARCHAR(100),
  notes            VARCHAR(1000),
  idempotency_key  TEXT        NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── prop_maintenance_requests ─────────────────────────────────────────────────
-- STD-11: idempotency_key on every write.

CREATE TABLE prop_maintenance_requests (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id             UUID        NOT NULL,
  property_id          UUID        NOT NULL REFERENCES prop_properties(id),
  lease_id             UUID        REFERENCES prop_lease_agreements(id),
  reported_by_tenant_id UUID       REFERENCES prop_property_tenants(id),
  category             TEXT        NOT NULL
    CHECK (category IN ('PLUMBING','ELECTRICAL','STRUCTURAL','HVAC','APPLIANCE',
                        'PEST_CONTROL','SECURITY','GARDEN','PAINTING','ROOFING','OTHER')),
  description          TEXT        NOT NULL,
  priority             TEXT        NOT NULL DEFAULT 'MEDIUM'
    CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')),
  status               TEXT        NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','ASSIGNED','IN_PROGRESS','AWAITING_PARTS',
                      'COMPLETED','CLOSED','CANNOT_REPRODUCE')),
  assigned_to          VARCHAR(200),
  estimated_cost       NUMERIC(10,2) CHECK (estimated_cost > 0),
  actual_cost          NUMERIC(10,2) CHECK (actual_cost > 0),
  reported_date        DATE        NOT NULL,
  scheduled_date       DATE,
  completed_date       DATE,
  completion_notes     VARCHAR(2000),
  idempotency_key      TEXT        NOT NULL UNIQUE,
  last_modified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── prop_mortgage_register ────────────────────────────────────────────────────
-- STD-11: idempotency_key on every write.

CREATE TABLE prop_mortgage_register (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id               UUID        NOT NULL,
  property_id            UUID        NOT NULL REFERENCES prop_properties(id),
  lender_name            VARCHAR(200) NOT NULL,
  account_reference      VARCHAR(50),           -- partial only — OPSEC
  mortgage_type          TEXT        NOT NULL
    CHECK (mortgage_type IN ('FIXED_RATE','VARIABLE_RATE','INTEREST_ONLY')),
  original_amount        NUMERIC(14,2) NOT NULL CHECK (original_amount > 0),
  currency               CHAR(3)     NOT NULL DEFAULT 'TTD',
  outstanding_balance    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (outstanding_balance >= 0),
  interest_rate_percent  NUMERIC(6,4) NOT NULL CHECK (interest_rate_percent > 0),
  start_date             DATE        NOT NULL,
  maturity_date          DATE,
  monthly_payment        NUMERIC(10,2) NOT NULL CHECK (monthly_payment > 0),
  payment_due_day        INTEGER     NOT NULL DEFAULT 1 CHECK (payment_due_day BETWEEN 1 AND 28),
  status                 TEXT        NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','PAID_OFF','REFINANCED','DEFAULTED')),
  notes                  TEXT,
  idempotency_key        TEXT        NOT NULL UNIQUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── prop_property_pipeline ────────────────────────────────────────────────────

CREATE TABLE prop_property_pipeline (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                 UUID        NOT NULL,
  name                     VARCHAR(200) NOT NULL,
  address                  VARCHAR(500),
  property_type            TEXT        NOT NULL
    CHECK (property_type IN ('RESIDENTIAL','COMMERCIAL','LAND','MIXED','AGRICULTURAL')),
  asking_price             NUMERIC(14,2) CHECK (asking_price > 0),
  estimated_value          NUMERIC(14,2) CHECK (estimated_value > 0),
  currency                 CHAR(3)     NOT NULL DEFAULT 'TTD',
  lot_size_sqm             NUMERIC(10,2),
  floor_area_sqm           NUMERIC(10,2),
  estimated_monthly_rent   NUMERIC(10,2),
  stage                    TEXT        NOT NULL DEFAULT 'WATCH'
    CHECK (stage IN ('WATCH','INTERESTED','OFFER_MADE','DUE_DILIGENCE','CONTRACT','ACQUIRED','PASSED')),
  source                   TEXT
    CHECK (source IN ('AGENT','PRIVATE_SELLER','AUCTION','ONLINE_LISTING','REFERRAL','OTHER')),
  agent_name               VARCHAR(100),
  agent_phone              VARCHAR(30),
  analysis_notes           TEXT,
  last_modified_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── prop_pending_review_queue ─────────────────────────────────────────────────
-- Data quality queue — records that could not be auto-resolved during import
-- or that require Owner review before posting (STD-02 defence-in-depth).

CREATE TABLE prop_pending_review_queue (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID        NOT NULL,
  source           VARCHAR(100) NOT NULL,       -- which process/module raised this
  raw_payload      JSONB       NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','RESOLVED','DISMISSED')),
  resolution_notes VARCHAR(1000),
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID                         -- users.id
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX ON prop_properties          (owner_id, is_active, is_rented);
CREATE INDEX ON prop_property_tenants    (owner_id);
CREATE INDEX ON prop_lease_agreements    (owner_id, property_id, status);
CREATE INDEX ON prop_lease_agreements    (tenant_id);
CREATE INDEX ON prop_rent_payments       (owner_id, lease_id, period_year, period_month);
CREATE INDEX ON prop_maintenance_requests(owner_id, property_id, status);
CREATE INDEX ON prop_maintenance_requests(owner_id, priority, status);
CREATE INDEX ON prop_mortgage_register   (owner_id, property_id, status);
CREATE INDEX ON prop_property_pipeline   (owner_id, stage);
CREATE INDEX ON prop_pending_review_queue(owner_id, status, received_at);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- jag_properties uses withOwnerRLS — sets app.current_owner_id.
-- Fail-closed: missing setting casts to null, matches no rows.

ALTER TABLE prop_properties           ENABLE ROW LEVEL SECURITY;
ALTER TABLE prop_property_tenants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prop_lease_agreements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prop_rent_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE prop_maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE prop_mortgage_register    ENABLE ROW LEVEL SECURITY;
ALTER TABLE prop_property_pipeline    ENABLE ROW LEVEL SECURITY;
ALTER TABLE prop_pending_review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY prop_owner_isolation ON prop_properties
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY prop_owner_isolation ON prop_property_tenants
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY prop_owner_isolation ON prop_lease_agreements
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY prop_owner_isolation ON prop_rent_payments
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY prop_owner_isolation ON prop_maintenance_requests
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY prop_owner_isolation ON prop_mortgage_register
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY prop_owner_isolation ON prop_property_pipeline
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);

CREATE POLICY prop_owner_isolation ON prop_pending_review_queue
  USING (owner_id = current_setting('app.current_owner_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.current_owner_id', true)::uuid);
