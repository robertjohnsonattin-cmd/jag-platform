-- jag_core — Migration 007: audit_log table
-- Creates the audit log table that all API routes write to for compliance tracking.
-- Also applies RLS: users see their own-tenant rows; Owner (bypass_rls=true) sees all.

CREATE TABLE IF NOT EXISTS audit_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        REFERENCES tenants(id) ON DELETE SET NULL,
  user_id          UUID        REFERENCES users(id)   ON DELETE SET NULL,
  entity           VARCHAR(100) NOT NULL,
  action           VARCHAR(100) NOT NULL,
  record_id        UUID,
  old_values       JSONB,
  new_values       JSONB,
  source           VARCHAR(50)  NOT NULL DEFAULT 'API',
  idempotency_key  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_log_idempotency_key
  ON audit_log(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id   ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_id ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity    ON audit_log(entity, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_tenant_access ON audit_log;
CREATE POLICY audit_log_tenant_access ON audit_log
  USING (
    -- Owner with bypass_rls sees all rows
    current_setting('app.bypass_rls', true) = 'true'
    OR
    -- Users see own-tenant rows and system rows (null tenant)
    tenant_id = current_setting('app.current_tenant_id', true)::uuid
    OR tenant_id IS NULL
  );

-- Allow jag_app to write audit entries across all tenants
GRANT SELECT, INSERT ON audit_log TO jag_app;
