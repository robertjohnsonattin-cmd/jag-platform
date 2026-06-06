-- jag_entertainment — Migration 004
-- STD-13 Expand-and-Contract: adds venue tag to ent_tabs (Step 1 + Step 3).
-- Step 5 (NOT NULL enforcement) is in migration 005.
-- Also adds: visitor log, chip float, license expiry dates on ent_config.

-- ── Step 1 (E&C): Add venue column to ent_tabs (nullable) ────────────────────
ALTER TABLE ent_tabs ADD COLUMN venue VARCHAR(10)
  CHECK (venue IN ('BAR', 'CLUB'));

-- ── Step 3 (E&C): Backfill — all tabs created before this migration are BAR ──
UPDATE ent_tabs SET venue = 'BAR' WHERE venue IS NULL;

-- ── License expiry dates on ent_config ───────────────────────────────────────
-- Notification escalation (handled by jag-event-dispatcher reading these dates):
--   90+ days: no alert
--   90 days:  Tier 3 weekly
--   30 days:  Tier 2 daily
--   7 days:   Tier 1 immediate
ALTER TABLE ent_config
  ADD COLUMN IF NOT EXISTS bar_license_expiry  DATE,
  ADD COLUMN IF NOT EXISTS club_license_expiry DATE;

-- ── Visitor log ───────────────────────────────────────────────────────────────
-- Members Club only. All visitors must be signed in by a member or staff.
-- member_id: the sponsoring member (required — club allows members + invited guests only).
-- id_type: government-issued ID presented on arrival.

CREATE TABLE IF NOT EXISTS ent_visitor_log (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL,
  member_id       UUID         REFERENCES ent_members(id),
  visitor_name    TEXT         NOT NULL,
  id_type         TEXT         NOT NULL
                  CHECK (id_type IN ('NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE', 'OTHER')),
  id_number       TEXT         NOT NULL,
  address         TEXT         NOT NULL,
  admitted_by     UUID         NOT NULL,
  time_in         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  time_out        TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE ent_visitor_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY ent_tenant_isolation ON ent_visitor_log
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_ent_visitor_log_tenant   ON ent_visitor_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ent_visitor_log_date     ON ent_visitor_log(time_in DESC);
CREATE INDEX IF NOT EXISTS idx_ent_visitor_log_member   ON ent_visitor_log(member_id);

-- ── Chip float ────────────────────────────────────────────────────────────────
-- One record per calendar day (UNIQUE on tenant_id + float_date).
-- cash_variance:  closing_cash − (opening_cash + CASH tab payments for CLUB that day).
--                 Zero = balanced; negative = cash short; positive = cash over.
-- chips_variance: closing_chips − opening_chips.
--                 Non-zero indicates chips added to or removed from circulation.
-- Both variances computed by the application on close.

CREATE TABLE IF NOT EXISTS ent_chip_float (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID          NOT NULL,
  float_date       DATE          NOT NULL,
  status           TEXT          NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN', 'CLOSED')),
  opening_cash     NUMERIC(12,2) NOT NULL CHECK (opening_cash >= 0),
  opening_chips    NUMERIC(12,2) NOT NULL CHECK (opening_chips >= 0),
  closing_cash     NUMERIC(12,2) CHECK (closing_cash >= 0),
  closing_chips    NUMERIC(12,2) CHECK (closing_chips >= 0),
  cash_in_ttd      NUMERIC(12,2),  -- sum of CLUB CASH tab payments on float_date (computed on close)
  cash_variance    NUMERIC(12,2),  -- closing_cash − (opening_cash + cash_in_ttd)
  chips_variance   NUMERIC(12,2),  -- closing_chips − opening_chips
  opened_by        UUID          NOT NULL,
  closed_by        UUID,
  notes            TEXT,
  idempotency_key  UUID          NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  opened_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, float_date)
);

ALTER TABLE ent_chip_float ENABLE ROW LEVEL SECURITY;
CREATE POLICY ent_tenant_isolation ON ent_chip_float
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_ent_chip_float_tenant ON ent_chip_float(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ent_chip_float_date   ON ent_chip_float(float_date DESC);
