-- jag_entertainment — Migration 001: Initial schema
-- BAR (single location) + Members Club
-- Run against jag_entertainment as jag_app.

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Sequences ─────────────────────────────────────────────────────────────────
CREATE SEQUENCE ent_member_number_seq START 1 INCREMENT 1;

-- ── Products ──────────────────────────────────────────────────────────────────
CREATE TABLE ent_products (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  name        text        NOT NULL,
  category    text        NOT NULL CHECK (category IN ('DRINK','FOOD','MERCHANDISE','OTHER')),
  price       numeric(10,2) NOT NULL CHECK (price >= 0),
  cost        numeric(10,2)            CHECK (cost >= 0),
  sku         text,
  stock_qty   integer,          -- NULL = unlimited
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Membership tiers ──────────────────────────────────────────────────────────
CREATE TABLE ent_membership_tiers (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  name                  text        NOT NULL,
  monthly_fee           numeric(10,2) NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
  bar_discount_pct      numeric(5,2)  NOT NULL DEFAULT 0 CHECK (bar_discount_pct >= 0 AND bar_discount_pct <= 100),
  guest_passes_per_month integer     NOT NULL DEFAULT 0,
  credit_on_join        numeric(10,2) NOT NULL DEFAULT 0,
  is_active             boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ── Members ───────────────────────────────────────────────────────────────────
CREATE TABLE ent_members (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  member_number     text        NOT NULL UNIQUE,
  first_name        text        NOT NULL,
  last_name         text        NOT NULL,
  email             text,
  phone             text,
  date_of_birth     date,
  photo_url         text,
  emergency_contact jsonb,
  notes             text,
  credit_balance    numeric(10,2) NOT NULL DEFAULT 0,
  status            text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','EXPIRED')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── Memberships ───────────────────────────────────────────────────────────────
CREATE TABLE ent_memberships (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  member_id        uuid        NOT NULL REFERENCES ent_members(id),
  tier_id          uuid        NOT NULL REFERENCES ent_membership_tiers(id),
  started_at       date        NOT NULL,
  expires_at       date,
  status           text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','EXPIRED')),
  idempotency_key  text        NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Tabs ──────────────────────────────────────────────────────────────────────
CREATE TABLE ent_tabs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  tab_number    integer     NOT NULL GENERATED ALWAYS AS IDENTITY,
  customer_name text,
  member_id     uuid        REFERENCES ent_members(id),
  table_ref     text,
  status        text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','SETTLED','VOIDED')),
  discount_pct  numeric(5,2) NOT NULL DEFAULT 0,
  subtotal      numeric(10,2) NOT NULL DEFAULT 0,
  total         numeric(10,2) NOT NULL DEFAULT 0,
  staff_user_id text        NOT NULL,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  settled_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Tab items ─────────────────────────────────────────────────────────────────
CREATE TABLE ent_tab_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  tab_id      uuid        NOT NULL REFERENCES ent_tabs(id),
  product_id  uuid        NOT NULL REFERENCES ent_products(id),
  quantity    integer     NOT NULL CHECK (quantity > 0),
  unit_price  numeric(10,2) NOT NULL,   -- price snapshot at order time
  notes       text,
  voided      boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Tab payments ──────────────────────────────────────────────────────────────
CREATE TABLE ent_tab_payments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  tab_id           uuid        NOT NULL REFERENCES ent_tabs(id),
  method           text        NOT NULL CHECK (method IN ('CASH','CARD','MEMBER_CREDIT','COMPLIMENTARY')),
  amount           numeric(10,2) NOT NULL CHECK (amount > 0),
  reference        text,
  idempotency_key  text        NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Member credit ledger ──────────────────────────────────────────────────────
CREATE TABLE ent_member_credits (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  member_id        uuid        NOT NULL REFERENCES ent_members(id),
  amount           numeric(10,2) NOT NULL,   -- positive = credit added, negative = debit
  description      text        NOT NULL,
  tab_payment_id   uuid        REFERENCES ent_tab_payments(id),
  idempotency_key  text        NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Events ────────────────────────────────────────────────────────────────────
CREATE TABLE ent_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  title         text        NOT NULL,
  description   text,
  venue         text        NOT NULL CHECK (venue IN ('BAR','CLUB','BOTH')),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz,
  capacity      integer,
  ticket_price  numeric(10,2) NOT NULL DEFAULT 0,
  member_price  numeric(10,2) NOT NULL DEFAULT 0,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Event bookings ────────────────────────────────────────────────────────────
CREATE TABLE ent_event_bookings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  event_id         uuid        NOT NULL REFERENCES ent_events(id),
  member_id        uuid        NOT NULL REFERENCES ent_members(id),
  guests           integer     NOT NULL DEFAULT 0 CHECK (guests >= 0),
  amount_paid      numeric(10,2) NOT NULL DEFAULT 0,
  payment_method   text        NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH','CARD','MEMBER_CREDIT','COMPLIMENTARY')),
  status           text        NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','WAITLISTED','CANCELLED')),
  idempotency_key  text        NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX ON ent_products        (tenant_id, is_active);
CREATE INDEX ON ent_membership_tiers(tenant_id, is_active);
CREATE INDEX ON ent_members         (tenant_id, status);
CREATE INDEX ON ent_members         (member_number);
CREATE INDEX ON ent_memberships     (tenant_id, member_id);
CREATE INDEX ON ent_memberships     (member_id, status);
CREATE INDEX ON ent_tabs            (tenant_id, status);
CREATE INDEX ON ent_tabs            (tenant_id, opened_at DESC);
CREATE INDEX ON ent_tab_items       (tab_id);
CREATE INDEX ON ent_tab_payments    (tab_id);
CREATE INDEX ON ent_member_credits  (member_id, created_at DESC);
CREATE INDEX ON ent_events          (tenant_id, starts_at);
CREATE INDEX ON ent_event_bookings  (event_id, member_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE ent_products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ent_membership_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ent_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ent_memberships      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ent_tabs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ent_tab_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ent_tab_payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ent_member_credits   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ent_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ent_event_bookings   ENABLE ROW LEVEL SECURITY;

-- tenant-scoped: jag_entertainment uses withTenantRLS (app.current_tenant_id)
CREATE POLICY ent_tenant_isolation ON ent_products
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY ent_tenant_isolation ON ent_membership_tiers
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY ent_tenant_isolation ON ent_members
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY ent_tenant_isolation ON ent_memberships
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY ent_tenant_isolation ON ent_tabs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY ent_tenant_isolation ON ent_tab_items
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY ent_tenant_isolation ON ent_tab_payments
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY ent_tenant_isolation ON ent_member_credits
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY ent_tenant_isolation ON ent_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY ent_tenant_isolation ON ent_event_bookings
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
