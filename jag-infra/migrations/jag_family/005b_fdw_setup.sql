-- jag_family — FDW setup for consolidated P&L (Phase 5)
-- Run against jag_family as the SUPERUSER (postgres), not jag_app.
--
-- This creates foreign servers pointing at jag_commercial and jag_entertainment
-- on the same PostgreSQL instance, exposes read-only views of key revenue/expense
-- tables, and builds a consolidated_pl_view that the /finance/intercompany/consolidated
-- endpoint queries.
--
-- Prerequisites:
--   Migration 005_fin_intercompany.sql must be applied first (as jag_app).
--
-- Run:
--   JAG_APP_PASSWORD=$JAG_APP_PASSWORD psql $DATABASE_URL_FAMILY_SUPERUSER \
--     --variable=JAG_APP_PASSWORD="$JAG_APP_PASSWORD" \
--     -f 005b_fdw_setup.sql
--
-- JAG_APP_PASSWORD must match the jag_app PostgreSQL role password (from Oracle Vault / env).
-- Never hardcode the password here — the variable is injected at run time (STD-07).
--
-- To rotate the password after a jag_app credential change:
--   bash jag-infra/scripts/fdw-rotate-password.sh
--
-- All foreign tables are in schema 'fdw' to keep them separate from local tables.

CREATE EXTENSION IF NOT EXISTS postgres_fdw;

CREATE SCHEMA IF NOT EXISTS fdw;

-- ── Foreign servers ───────────────────────────────────────────────────────────
-- Same PostgreSQL instance — connect via localhost.

DO $$ BEGIN
  CREATE SERVER jag_commercial_fdw
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host 'localhost', port '5432', dbname 'jag_commercial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE SERVER jag_entertainment_fdw
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host 'localhost', port '5432', dbname 'jag_entertainment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── User mappings — jag_app in jag_family reads as jag_app in remote DBs ─────

DO $$ BEGIN
  CREATE USER MAPPING FOR jag_app
    SERVER jag_commercial_fdw
    OPTIONS (user 'jag_app', password :'JAG_APP_PASSWORD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE USER MAPPING FOR jag_app
    SERVER jag_entertainment_fdw
    OPTIONS (user 'jag_app', password :'JAG_APP_PASSWORD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Grant schema usage to jag_app
GRANT USAGE ON SCHEMA fdw TO jag_app;

-- ── jag_commercial foreign tables ─────────────────────────────────────────────

-- JABCO payment certificates (revenue)
CREATE FOREIGN TABLE IF NOT EXISTS fdw.jabco_payment_certificates (
  id             UUID,
  tenant_id      UUID,
  project_id     UUID,
  cert_date      DATE,
  cert_value     NUMERIC(18,2),
  currency       CHAR(3),
  created_at     TIMESTAMPTZ
) SERVER jag_commercial_fdw OPTIONS (schema_name 'public', table_name 'jabco_payment_certificates');

-- JABCO vendor invoices (expenses)
CREATE FOREIGN TABLE IF NOT EXISTS fdw.jabco_vendor_invoices (
  id             UUID,
  tenant_id      UUID,
  invoice_date   DATE,
  total_amount   NUMERIC(18,2),
  currency       CHAR(3),
  is_paid        BOOLEAN,
  created_at     TIMESTAMPTZ
) SERVER jag_commercial_fdw OPTIONS (schema_name 'public', table_name 'jabco_vendor_invoices');

-- NLCB daily sessions (net gaming revenue)
CREATE FOREIGN TABLE IF NOT EXISTS fdw.nlcb_daily_sessions (
  id             UUID,
  tenant_id      UUID,
  session_date   DATE,
  total_sales    NUMERIC(18,2),
  total_payouts  NUMERIC(18,2),
  net_revenue    NUMERIC(18,2),
  created_at     TIMESTAMPTZ
) SERVER jag_commercial_fdw OPTIONS (schema_name 'public', table_name 'nlcb_daily_sessions');

-- DragonBridge invoices (revenue)
CREATE FOREIGN TABLE IF NOT EXISTS fdw.db_invoices (
  id             UUID,
  tenant_id      UUID,
  invoice_date   DATE,
  total_amount   NUMERIC(18,2),
  currency       CHAR(3),
  status         TEXT,
  created_at     TIMESTAMPTZ
) SERVER jag_commercial_fdw OPTIONS (schema_name 'public', table_name 'db_invoices');

-- ── jag_entertainment foreign tables ──────────────────────────────────────────

-- BAR + Members Club sessions (revenue proxy: closing_float delta)
CREATE FOREIGN TABLE IF NOT EXISTS fdw.ent_bar_sessions (
  id             UUID,
  tenant_id      UUID,
  entity_tag     TEXT,
  session_date   DATE,
  opening_float  NUMERIC(18,2),
  closing_float  NUMERIC(18,2),
  cash_removed   NUMERIC(18,2),
  created_at     TIMESTAMPTZ
) SERVER jag_entertainment_fdw OPTIONS (schema_name 'public', table_name 'ent_bar_sessions');

-- Entertainment supplier invoices (expenses)
CREATE FOREIGN TABLE IF NOT EXISTS fdw.ent_supplier_invoices (
  id             UUID,
  tenant_id      UUID,
  entity_tag     TEXT,
  invoice_date   DATE,
  total_amount   NUMERIC(18,2),
  currency       CHAR(3),
  is_paid        BOOLEAN,
  created_at     TIMESTAMPTZ
) SERVER jag_entertainment_fdw OPTIONS (schema_name 'public', table_name 'ent_supplier_invoices');

-- Entertainment utility bills (expenses)
CREATE FOREIGN TABLE IF NOT EXISTS fdw.ent_utility_bills (
  id             UUID,
  tenant_id      UUID,
  entity_tag     TEXT,
  bill_date      DATE,
  amount         NUMERIC(18,2),
  currency       CHAR(3),
  is_paid        BOOLEAN,
  created_at     TIMESTAMPTZ
) SERVER jag_entertainment_fdw OPTIONS (schema_name 'public', table_name 'ent_utility_bills');

GRANT SELECT ON ALL TABLES IN SCHEMA fdw TO jag_app;

-- ── Consolidated P&L view ─────────────────────────────────────────────────────
-- Aggregates revenue and expenses per entity per month.
-- The /finance/intercompany/consolidated endpoint queries this view, then
-- deducts intercompany eliminations for the requested period.

CREATE OR REPLACE VIEW fdw.consolidated_pl AS

  -- JAG Holdings — from GL journal entries (source of truth for Holdings entity)
  SELECT
    '00000000-0000-0000-0001-000000000001'::UUID AS entity_id,
    'JAG_HOLDINGS'                               AS entity_name,
    je.period_year,
    je.period_month,
    COALESCE(SUM(CASE WHEN ga.account_type = 'REVENUE' THEN jel.credit_ttd - jel.debit_ttd ELSE 0 END), 0) AS revenue_ttd,
    COALESCE(SUM(CASE WHEN ga.account_type IN ('EXPENSE','OTHER_EXPENSE') THEN jel.debit_ttd - jel.credit_ttd ELSE 0 END), 0) AS expenses_ttd
  FROM  fin_journal_entries je
  JOIN  fin_journal_entry_lines jel ON jel.journal_entry_id = je.id
  JOIN  fin_gl_accounts         ga  ON ga.id = jel.gl_account_id
  WHERE je.status = 'POSTED'
    AND je.owner_entity_id = '00000000-0000-0000-0001-000000000001'
  GROUP BY je.period_year, je.period_month

UNION ALL

  -- JABCO — payment certs as revenue, vendor invoices as expenses
  SELECT
    '00000000-0000-0000-0001-000000000002'::UUID AS entity_id,
    'JABCO'                                       AS entity_name,
    EXTRACT(YEAR  FROM d.period_date)::SMALLINT  AS period_year,
    EXTRACT(MONTH FROM d.period_date)::SMALLINT  AS period_month,
    COALESCE(SUM(d.revenue_ttd),  0)             AS revenue_ttd,
    COALESCE(SUM(d.expenses_ttd), 0)             AS expenses_ttd
  FROM (
    SELECT cert_date AS period_date, cert_value AS revenue_ttd, 0 AS expenses_ttd
    FROM fdw.jabco_payment_certificates
    UNION ALL
    SELECT invoice_date, 0, total_amount
    FROM fdw.jabco_vendor_invoices
  ) d
  GROUP BY EXTRACT(YEAR FROM d.period_date), EXTRACT(MONTH FROM d.period_date)

UNION ALL

  -- JAG Entertainment (BAR + Members Club combined)
  SELECT
    '00000000-0000-0000-0001-000000000004'::UUID AS entity_id,
    'JAG_ENTERTAINMENT'                           AS entity_name,
    EXTRACT(YEAR  FROM d.period_date)::SMALLINT  AS period_year,
    EXTRACT(MONTH FROM d.period_date)::SMALLINT  AS period_month,
    COALESCE(SUM(d.revenue_ttd),  0)             AS revenue_ttd,
    COALESCE(SUM(d.expenses_ttd), 0)             AS expenses_ttd
  FROM (
    -- Net takings: cash removed from sessions is realised revenue
    SELECT session_date AS period_date, COALESCE(cash_removed, 0) AS revenue_ttd, 0 AS expenses_ttd
    FROM fdw.ent_bar_sessions
    UNION ALL
    SELECT invoice_date, 0, total_amount
    FROM fdw.ent_supplier_invoices
    UNION ALL
    SELECT bill_date, 0, amount
    FROM fdw.ent_utility_bills
  ) d
  GROUP BY EXTRACT(YEAR FROM d.period_date), EXTRACT(MONTH FROM d.period_date)

UNION ALL

  -- NLCB — net gaming revenue
  SELECT
    '00000000-0000-0000-0001-000000000007'::UUID AS entity_id,
    'NLCB'                                        AS entity_name,
    EXTRACT(YEAR  FROM session_date)::SMALLINT   AS period_year,
    EXTRACT(MONTH FROM session_date)::SMALLINT   AS period_month,
    COALESCE(SUM(net_revenue), 0)                AS revenue_ttd,
    0                                            AS expenses_ttd
  FROM fdw.nlcb_daily_sessions
  GROUP BY EXTRACT(YEAR FROM session_date), EXTRACT(MONTH FROM session_date)

UNION ALL

  -- DragonBridge — invoiced revenue only (expenses tracked separately via IMS)
  SELECT
    '00000000-0000-0000-0001-000000000006'::UUID AS entity_id,
    'DRAGONBRIDGE'                                AS entity_name,
    EXTRACT(YEAR  FROM invoice_date)::SMALLINT   AS period_year,
    EXTRACT(MONTH FROM invoice_date)::SMALLINT   AS period_month,
    COALESCE(SUM(CASE WHEN status IN ('PAID','PARTIAL') THEN total_amount ELSE 0 END), 0) AS revenue_ttd,
    0 AS expenses_ttd
  FROM fdw.db_invoices
  GROUP BY EXTRACT(YEAR FROM invoice_date), EXTRACT(MONTH FROM invoice_date);

GRANT SELECT ON fdw.consolidated_pl TO jag_app;

COMMENT ON VIEW fdw.consolidated_pl IS
  'Cross-database consolidated P&L. Excludes intercompany eliminations — '
  'the /finance/intercompany/consolidated API endpoint deducts them at query time.';
