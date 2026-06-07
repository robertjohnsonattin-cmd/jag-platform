-- jag_core initial schema
-- Core identity layer: users, tenants, roles, user_tenant_roles, RLS policies, and seed data.
-- This migration MUST run before all other jag_core migrations.

-- ── Extensions ────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id         UUID        PRIMARY KEY,
  code       VARCHAR(50) UNIQUE NOT NULL,
  name       VARCHAR(100) NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id   UUID        PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  keycloak_id  UUID        UNIQUE NOT NULL,
  email        VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_tenant_roles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id     UUID        NOT NULL REFERENCES roles(id)   ON DELETE CASCADE,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  granted_by  UUID        REFERENCES users(id),
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id, role_id)
);

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE user_tenant_roles ENABLE ROW LEVEL SECURITY;

-- user_self_access: users can only see their own rows.
-- app.current_user_id is set via set_config() at the start of each transaction.
DROP POLICY IF EXISTS user_self_access ON user_tenant_roles;
CREATE POLICY user_self_access ON user_tenant_roles
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- Allow jag_app to bypass RLS for admin-level queries (e.g. auditor resolution).
ALTER TABLE user_tenant_roles FORCE ROW LEVEL SECURITY;

-- ── Grants ────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jag_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO jag_app;

-- ── Seed data: Roles ──────────────────────────────────────────────────────────

INSERT INTO roles (id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Owner'),
  ('00000000-0000-0000-0000-000000000002', 'Auditor'),
  ('00000000-0000-0000-0000-000000000003', 'Staff')
ON CONFLICT (id) DO NOTHING;

-- ── Seed data: Tenants ────────────────────────────────────────────────────────

INSERT INTO tenants (id, code, name, is_active) VALUES
  ('00000000-0000-0000-0001-000000000001', 'JAG_HOLDINGS',    'JAG Holdings',       true),
  ('00000000-0000-0000-0001-000000000002', 'JABCO',           'JABCO',              true),
  ('00000000-0000-0000-0001-000000000003', 'JAG_PROPERTIES',  'JAG Properties',     true),
  ('00000000-0000-0000-0001-000000000004', 'JAG_ENTERTAINMENT','JAG Entertainment',  true),
  ('00000000-0000-0000-0001-000000000005', 'JAG_FINANCE',     'JAG Finance',        true),
  ('00000000-0000-0000-0001-000000000006', 'DRAGONBRIDGE',    'Dragonbridge',       true)
ON CONFLICT (id) DO NOTHING;

-- ── Seed data: Initial users ──────────────────────────────────────────────────

-- testuser@jag.test — Robert's dev account (keycloak_id updated once real account is created)
INSERT INTO users (id, keycloak_id, email, display_name, is_active)
VALUES (
  'c36b9245-a819-4f6d-9a53-44026b573920',
  '00000000-0000-0000-0099-000000000001',  -- placeholder: update to real Keycloak UUID
  'testuser@jag.test',
  'Robert Johnson-Attin',
  true
)
ON CONFLICT (email) DO NOTHING;

-- Robert's Owner role on JAG Holdings
INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, granted_by)
VALUES (
  'c36b9245-a819-4f6d-9a53-44026b573920',
  '00000000-0000-0000-0001-000000000001',
  '00000000-0000-0000-0000-000000000001',
  true,
  'c36b9245-a819-4f6d-9a53-44026b573920'
)
ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING;
