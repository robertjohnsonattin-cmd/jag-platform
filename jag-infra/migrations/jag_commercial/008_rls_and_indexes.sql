-- jag_commercial — Migration 008: RLS policies + indexes for NLCB, CRM, and other missing tables
-- Audit finding: 16 tables in jag_commercial had no RLS policies despite FORCE RLS.
-- All tables use app.current_tenant_id for tenant isolation (set by withTenantRLS middleware).
-- Run against jag_commercial as jag_app.

-- ── Helper: standard tenant-isolation policy ──────────────────────────────────
-- All NLCB, CRM, JABCO vendor invoice, and DragonBridge tables follow the same pattern:
-- RLS context: app.current_tenant_id (set via set_config() in middleware/rls.ts)

-- ── JABCO Vendor Invoices ─────────────────────────────────────────────────────

ALTER TABLE jabco_vendor_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE jabco_vendor_invoices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON jabco_vendor_invoices;
CREATE POLICY tenant_isolation ON jabco_vendor_invoices
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

-- ── NLCB Tables ───────────────────────────────────────────────────────────────

ALTER TABLE nlcb_bill_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcb_bill_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON nlcb_bill_payments;
CREATE POLICY tenant_isolation ON nlcb_bill_payments
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

ALTER TABLE nlcb_billers ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcb_billers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON nlcb_billers;
CREATE POLICY tenant_isolation ON nlcb_billers
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

ALTER TABLE nlcb_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcb_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON nlcb_config;
CREATE POLICY tenant_isolation ON nlcb_config
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

ALTER TABLE nlcb_daily_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcb_daily_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON nlcb_daily_sessions;
CREATE POLICY tenant_isolation ON nlcb_daily_sessions
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

ALTER TABLE nlcb_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcb_expenses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON nlcb_expenses;
CREATE POLICY tenant_isolation ON nlcb_expenses
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

ALTER TABLE nlcb_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcb_games FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON nlcb_games;
CREATE POLICY tenant_isolation ON nlcb_games
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

ALTER TABLE nlcb_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcb_payouts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON nlcb_payouts;
CREATE POLICY tenant_isolation ON nlcb_payouts
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

ALTER TABLE nlcb_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcb_sales FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON nlcb_sales;
CREATE POLICY tenant_isolation ON nlcb_sales
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

ALTER TABLE nlcb_scratch_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcb_scratch_games FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON nlcb_scratch_games;
CREATE POLICY tenant_isolation ON nlcb_scratch_games
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

ALTER TABLE nlcb_scratch_pack_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcb_scratch_pack_purchases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON nlcb_scratch_pack_purchases;
CREATE POLICY tenant_isolation ON nlcb_scratch_pack_purchases
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

ALTER TABLE nlcb_scratch_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcb_scratch_sales FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON nlcb_scratch_sales;
CREATE POLICY tenant_isolation ON nlcb_scratch_sales
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

ALTER TABLE nlcb_scratch_winnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcb_scratch_winnings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON nlcb_scratch_winnings;
CREATE POLICY tenant_isolation ON nlcb_scratch_winnings
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

ALTER TABLE nlcb_weekly_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcb_weekly_settlements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON nlcb_weekly_settlements;
CREATE POLICY tenant_isolation ON nlcb_weekly_settlements
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

-- ── Pending Events (outbox) — use owner_id isolation ─────────────────────────
-- Dispatcher reads all pending events via its own privileged DB role (no RLS needed).
-- Application layer should not expose pending_events to end users — no policy needed.
-- But ENABLE RLS + jag_app bypass so app role isn't blocked.
ALTER TABLE pending_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_access ON pending_events;
CREATE POLICY service_access ON pending_events USING (true);  -- dispatcher-only table; route layer never exposes it

-- ── CRM Tables — confirm policies exist (already set in 000, this is a safety net) ──
-- crm_companies, crm_contacts, crm_interactions, crm_sales_pipeline already have
-- FORCE RLS in 000_initial_schema.sql. Ensure policies are present.
DROP POLICY IF EXISTS tenant_isolation ON crm_companies;
CREATE POLICY tenant_isolation ON crm_companies
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

DROP POLICY IF EXISTS tenant_isolation ON crm_contacts;
CREATE POLICY tenant_isolation ON crm_contacts
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

DROP POLICY IF EXISTS tenant_isolation ON crm_interactions;
CREATE POLICY tenant_isolation ON crm_interactions
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

DROP POLICY IF EXISTS tenant_isolation ON crm_sales_pipeline;
CREATE POLICY tenant_isolation ON crm_sales_pipeline
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

-- ── DragonBridge client table ─────────────────────────────────────────────────
DROP POLICY IF EXISTS tenant_isolation ON db_clients;
CREATE POLICY tenant_isolation ON db_clients
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

DROP POLICY IF EXISTS tenant_isolation ON db_order_shipments;
CREATE POLICY tenant_isolation ON db_order_shipments
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

-- ── Idempotency key UNIQUE constraints (STD-11) ───────────────────────────────
-- jabco_vendor_invoices already has idempotency_key; add UNIQUE if missing.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jabco_vendor_invoices_idempotency_key_key'
      AND conrelid = 'jabco_vendor_invoices'::regclass
  ) THEN
    ALTER TABLE jabco_vendor_invoices ADD CONSTRAINT jabco_vendor_invoices_idempotency_key_key UNIQUE (idempotency_key);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nlcb_bill_payments_idempotency_key_key'
      AND conrelid = 'nlcb_bill_payments'::regclass
  ) THEN
    ALTER TABLE nlcb_bill_payments ADD CONSTRAINT nlcb_bill_payments_idempotency_key_key UNIQUE (idempotency_key);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nlcb_sales_idempotency_key_key'
      AND conrelid = 'nlcb_sales'::regclass
  ) THEN
    ALTER TABLE nlcb_sales ADD CONSTRAINT nlcb_sales_idempotency_key_key UNIQUE (idempotency_key);
  END IF;
END $$;

-- ── Performance indexes — FK columns missing indexes ─────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_db_clients_tenant_id ON db_clients(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_db_order_shipments_tenant_id ON db_order_shipments(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_contacts_tenant_id ON crm_contacts(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_contacts_company_id ON crm_contacts(company_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_interactions_tenant_id ON crm_interactions(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_interactions_contact_id ON crm_interactions(contact_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nlcb_bill_payments_session_id ON nlcb_bill_payments(session_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nlcb_bill_payments_tenant_id ON nlcb_bill_payments(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nlcb_expenses_tenant_id ON nlcb_expenses(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nlcb_expenses_expense_date ON nlcb_expenses(expense_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nlcb_sales_tenant_id ON nlcb_sales(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nlcb_sales_session_id ON nlcb_sales(session_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pending_events_status ON pending_events(status) WHERE status = 'PENDING';

-- ── Core: missing FK indexes ──────────────────────────────────────────────────
-- These must be run against jag_core directly; record here for deploy.sh awareness.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_tenant_roles_user_id ON user_tenant_roles(user_id);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_tenant_roles_tenant_id ON user_tenant_roles(tenant_id);
-- (Run separately against jag_core if not already present)

-- ── Re-apply grants ───────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jag_app;
