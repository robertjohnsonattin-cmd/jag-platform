-- Brian's Portal: placeholder user, portal config, and module permissions
-- Brian Johnson-Attin — full owner of NLCB, director on other entities.
-- Keycloak account not yet created; keycloak_id is a placeholder UUID.
-- Update keycloak_id when Brian's Keycloak account is provisioned.

-- ── Brian's user record ───────────────────────────────────────────────────────

INSERT INTO users (id, keycloak_id, email, display_name, is_active)
VALUES (
  '00000000-0000-0000-0002-000000000001',
  '00000000-0000-0000-0002-000000000099',  -- placeholder: update when Keycloak account created
  'brian.attin@jag.internal',
  'Brian Johnson-Attin',
  false  -- inactive until real Keycloak account is wired up
)
ON CONFLICT (email) DO NOTHING;

-- Give Brian the Owner role under JAG Holdings tenant (minimum needed for portal access).
-- Expand to additional tenants when NLCB tenant is created.
INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, granted_by)
VALUES (
  '00000000-0000-0000-0002-000000000001',
  '00000000-0000-0000-0001-000000000001',  -- JAG Holdings tenant
  '00000000-0000-0000-0000-000000000001',  -- Owner role
  false,  -- inactive until real account wired up
  (SELECT id FROM users WHERE email = 'testuser@jag.test' LIMIT 1)
)
ON CONFLICT DO NOTHING;

-- ── Portal config ─────────────────────────────────────────────────────────────
-- Single-row table: stores Brian's user ID so the API can resolve
-- the X-Act-As: brian header without hardcoding UUIDs.

CREATE TABLE IF NOT EXISTS brian_portal_config (
  brian_user_id     UUID NOT NULL REFERENCES users(id),
  -- Default tenant for X-Act-As context. Stored here to avoid querying RLS-protected tables.
  -- Update to Brian's NLCB tenant once that tenant is created.
  default_tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0001-000000000001',
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

INSERT INTO brian_portal_config (brian_user_id, default_tenant_id)
VALUES ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0001-000000000001')
ON CONFLICT DO NOTHING;

-- ── Module permissions ────────────────────────────────────────────────────────
-- Robert controls these via PATCH /api/v1/brian/permissions/:module.
-- All start NONE. NLCB starts WRITE — Brian is the owner.

CREATE TABLE IF NOT EXISTS brian_module_permissions (
  module        VARCHAR(50)  NOT NULL PRIMARY KEY,
  access_level  VARCHAR(5)   NOT NULL DEFAULT 'NONE'
                             CHECK (access_level IN ('NONE', 'READ', 'WRITE')),
  granted_by    UUID         REFERENCES users(id),
  granted_at    TIMESTAMP WITH TIME ZONE,
  notes         TEXT,
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

INSERT INTO brian_module_permissions (module, access_level) VALUES
  ('PROPERTIES', 'NONE'),
  ('JABCO',      'NONE'),
  ('IMS',        'NONE'),
  ('CRM',        'NONE'),
  ('FAMILY',     'NONE'),
  ('LIFESTYLE',  'NONE'),
  ('DOCVAULT',   'NONE'),
  ('SUCCESSION', 'NONE'),
  ('BAR',        'NONE'),
  ('CLUB',       'NONE'),
  ('NLCB',       'WRITE')
ON CONFLICT (module) DO NOTHING;
