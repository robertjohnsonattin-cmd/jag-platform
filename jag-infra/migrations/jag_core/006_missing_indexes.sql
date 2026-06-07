-- jag_core — Migration 006: Missing FK indexes + audit_log idempotency key
-- Audit finding: user_id and tenant_id FK columns have no indexes, causing seq scans on auth middleware.
-- Also adds idempotency_key to audit_log so webhook retries don't create duplicate audit entries.

-- ── audit_log: optional idempotency_key for webhook/external callers ──────────
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_log_idempotency_key ON audit_log(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_tenant_roles_user_id   ON user_tenant_roles(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_tenant_roles_tenant_id ON user_tenant_roles(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_tenant_roles_active     ON user_tenant_roles(user_id, tenant_id) WHERE is_active = true;

-- Audit log: tenant_id filter is common in admin queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_user_id   ON audit_log(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_entity     ON audit_log(entity, record_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
