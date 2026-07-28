# Database & RLS rules

> Split out of CLAUDE.md. Read this before touching any query, migration, or RLS policy.

### PostgreSQL session variables
```sql
-- ALWAYS:
SELECT set_config($1, $2, true)
-- NEVER:
SET LOCAL x = $1  -- PostgreSQL does not allow parameterised SET statements
```

### Finance RLS
- `jag_family` uses `withOwnerRLS` (`app.current_owner_id`), not tenant-scoped
- `jag_properties` uses `withOwnerRLS` (`app.current_owner_id`), NOT `withTenantRLS` — `prop_properties` has NO entity/tenant column
- `fin_fx_rates` is a shared reference table — any non-null `current_owner_id` grants access
- `fin_net_worth_snapshots.net_worth_ttd` is a `GENERATED` column — never set it manually
- CONSOLIDATED pseudo-entity UUID: `00000000-0000-0000-0000-000000000000`
- `property_assets_ttd` is populated by cross-DB queries to `commercialPool` (IMS) and `propertiesPool` (Properties)
- Properties snapshot uses ONE `withOwnerRLS` call — all property value attributed to JAG_PROPERTIES entity (`00000000-0000-0000-0001-000000000003`)

### PostgreSQL GUC session-level empty string — CRITICAL
Custom `app.*` GUC parameters revert to `''` (empty string) **not NULL** at session level after a transaction that set them commits. If a pool connection previously ran `withOwnerRLS` (which sets `app.current_owner_id`), the next `withTenantRLS` call on the SAME connection will see `app.current_owner_id = ''`. Then `current_setting('app.current_owner_id', true)::uuid` throws `invalid input syntax for type uuid: ""`.

**Rules:**
1. Always use `NULLIF(current_setting('app.xxx', true), '')::uuid` in RLS policies — never raw `current_setting(...)::uuid`
2. Always use the correct RLS wrapper for each database: `withTenantRLS` for `jag_commercial`/`jag_entertainment`/`jag_core`; `withOwnerRLS` for `jag_family`/`jag_properties`

### RLS and bare-connection UPDATEs — CRITICAL
Any `UPDATE` on an RLS-protected table run on a pool connection **without** first calling `withTenantRLS` (or `withOwnerRLS`) will silently update 0 rows — no error, no warning. This is the correct RLS behaviour but easy to miss in async `.then()` callbacks that acquire a fresh connection after the original RLS context has closed.

**Rule:** always wrap UPDATE/DELETE on tenant-scoped tables in `withTenantRLS(conn, ctx, ...)` even in fire-and-forget callbacks. Capture `req.rlsCtx` before the async boundary so it's available inside the `.then()`.

**Same bug, public-route flavour (session 36):** any route with no authenticated user at all — e.g. the public tenancy booking page (`/api/v1/public/book/:slug`) — is especially prone to this because there's no `req.rlsCtx` to reuse. If it queries on a bare `pool.connect()` with no owner/tenant context set at all, FORCE RLS returns zero rows for every request, not just some — looks identical to "record not found" from the outside. Since JAG is single-owner for `jag_properties`/`jag_family`, the fix is to scope public routes to the known platform owner (`process.env.NOTIFY_OWNER_USER_ID` fallback constant, same one `lib/notifications.ts` uses) via `withOwnerRLS`, never a raw connection.

### node-pg numeric types
PostgreSQL `numeric` / `decimal` columns arrive in Node.js as **strings**, not numbers. Always wrap with `parseFloat(String(value ?? 0))` before arithmetic — using `+` on two pg numeric values concatenates strings instead of adding numbers.

### Dashboard query limits
`jag-web/src/pages/Dashboard.tsx` requests properties with `limit: 100` (backend max is 500 per `PropertiesQuerySchema`). Never raise Dashboard limit above 500 without also raising the backend Zod schema.
