# API & backend conventions

> Split out of CLAUDE.md. Read this before writing a new route.

### response.ts dual-mode helpers
`ok()` and `err()` in `src/lib/response.ts` support **two calling conventions**:
- Old routes (most of codebase): `ok(res, data, status?)` → sends response directly
- New tenancy routes: `ok(data)` → returns `{success:true, data}` envelope for `res.json(ok(data))`
- Old: `err(res, status, code, message)` → sends response
- New: `err(message, code)` → returns envelope for `res.status(N).json(err('msg','CODE'))`

Detection at runtime: first arg is a `Response` if it has a `.json` function; first arg is a `string` → new-style `err`. Both compile cleanly via TypeScript overloads. When writing new routes, use the **new style** (single-arg `ok` / two-arg `err`) — it is cleaner.

### In-app notifications (session 26)
`notification_queue` (jag_core, user_id RLS) is fed by `enqueueNotification()` in `jag-api/src/lib/notifications.ts` — owner-recipient by default (`NOTIFY_OWNER_USER_ID` env, fallback = Robert's jag_core users.id), **non-blocking** (try/catch + `logger.warn`; always call as `void enqueueNotification(...)`). RLS insert works because `withOwnerRLS(corePool, recipient, ...)` sets `app.current_user_id` = recipient (the `user_isolation` USING clause doubles as the INSERT WITH CHECK under FORCE RLS). **Live producers (4):** expense submit (tier 1), P1/P2 maintenance ticket create (tier 1), maintenance SLA breach in `/check-sla` (tier 1), new tenancy enquiry (tier 2). API: `GET /notifications/unread-count`, `PATCH /notifications/read-all` (plus pre-existing `GET /` + `PATCH /:id/read`). Frontend: `NotificationBell` in AppShell (sidebar desktop + mobile top bar, 60s badge poll). **Deferred producer:** document/bank-statement → REVIEW (set by external Ollama batch `scripts/ollama-batch/index.ts`, no API hook).

### Keycloak 26 user attributes
Custom attributes **MUST** be declared via `PUT /admin/realms/jag/users/profile` **BEFORE** setting them. KC26 silently drops undeclared attributes (returns HTTP 204 but does NOT persist). The Attributes tab is hidden for admin-only attrs — always use REST API.

### WebAuthn
`KC_WEBAUTHN_RP_ID` is bound at registration and **cannot be changed**. Run `keycloak-webauthn-setup.sh` with `KC_WEBAUTHN_RP_ID=jabco.tt` before any user registers a device on production.
