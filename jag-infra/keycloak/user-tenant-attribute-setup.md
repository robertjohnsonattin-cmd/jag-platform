# Keycloak User Attribute Setup — jag_tenant_id

After running `./scripts/keycloak-mappers-setup.sh`, each Keycloak user needs
the `jag_tenant_id` attribute set to their default tenant UUID.

## Why this exists

The JAG API middleware reads `jag_tenant_id` from the JWT access token on every
request and sets `app.current_tenant_id` for RLS. Without this attribute, the
claim is absent from the token and the API rejects the request with 401.

## How to set it

Use the helper script — the Keycloak 26 Admin Console does not expose a visible
Attributes tab for this attribute type. The script handles it via the REST API:

```bash
bash scripts/set-user-tenant.sh <keycloak-user-uuid> <tenant-uuid>
```

Or set it manually via curl (replace UUIDs):

```bash
# 1. Get admin token
TOKEN=$(curl -sf -X POST http://localhost:8080/realms/master/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=admin-cli&username=admin&password=<password>" \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

# 2. Set attribute (replace USER_ID and TENANT_UUID)
curl -X PUT http://localhost:8080/admin/realms/jag/users/<USER_ID> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "attributes": { "jag_tenant_id": ["<TENANT_UUID>"] }
  }'
```

The claim will appear in the user's next access token automatically.

## Tenant UUIDs (run once to get them)

```sql
-- Run against jag_core as postgres or jag_app
SELECT id, code, name FROM tenants ORDER BY code;
```

## User → tenant mapping

| User | Role | jag_tenant_id value |
|------|------|---------------------|
| Robert | OWNER | JAG_HOLDINGS tenant UUID |
| Wife | FAMILY | FAMILY tenant UUID (or JAG_HOLDINGS) |
| Brian | DOMAIN_ADMIN | The tenant he manages most (can override per-request via X-Tenant-ID header) |
| JABCO operator | OPERATOR | JABCO tenant UUID |
| NLCB operator | OPERATOR | NLCB tenant UUID |
| DragonBridge operator | OPERATOR | DRAGONBRIDGE tenant UUID |

## Verification (after next login)

Copy the access token from any API response header or from the Keycloak token
endpoint, then decode it at [jwt.io](https://jwt.io). The payload should contain:

```json
{
  "jag_user_id":   "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "jag_tenant_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  ...
}
```

Both values must be present and match the expected UUIDs.

## Multi-tenant users (Robert / Brian)

Robert has OWNER access across all tenants. His `jag_tenant_id` defaults to the
JAG_HOLDINGS tenant. The API also accepts an `X-Tenant-ID` request header to
switch context for a specific call — useful in Brian's portal or when Robert
is managing a specific subsidiary.

The `user_tenant_roles` table in `jag_core` is the authoritative source of which
tenants a user can access. Keycloak's `jag_tenant_id` is only the *default*
context — it does not bypass the RLS / role checks in the API.
