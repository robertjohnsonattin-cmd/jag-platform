-- NLCB tenant: create tenant, wire Brian's role, update portal config.
-- Brian Johnson-Attin is the Owner of the NLCB lottery booth.

-- ── NLCB tenant ───────────────────────────────────────────────────────────────

INSERT INTO tenants (id, code, name, is_active)
VALUES (
  '00000000-0000-0000-0001-000000000007',
  'NLCB',
  'NLCB Booth',
  true
)
ON CONFLICT (code) DO NOTHING;

-- ── Brian's role on the NLCB tenant ──────────────────────────────────────────
-- Brian is Owner of NLCB. Inactive until his Keycloak account is activated.

INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, granted_by)
VALUES (
  '00000000-0000-0000-0002-000000000001',             -- Brian
  '00000000-0000-0000-0001-000000000007',             -- NLCB tenant
  '00000000-0000-0000-0000-000000000001',             -- Owner role
  false,                                              -- inactive until Keycloak account wired up
  (SELECT id FROM users WHERE email = 'testuser@jag.test' LIMIT 1)
)
ON CONFLICT DO NOTHING;

-- ── Update Brian's portal default tenant to NLCB ──────────────────────────────
-- Now that NLCB exists, X-Act-As: brian will resolve to the NLCB tenant context.

UPDATE brian_portal_config
SET default_tenant_id = '00000000-0000-0000-0001-000000000007';
