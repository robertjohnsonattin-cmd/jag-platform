---
name: project-cron-ropc-auth-failures
description: "Cron scripts shared Robert's real Keycloak account for ROPC login causing intermittent auth_fail bursts; fixed 2026-07-22 by migrating all 10 VM-scheduled scripts to a dedicated jag-cron-service Keycloak client (client_credentials grant); also surfaced and fixed 2 unrelated pre-existing bugs"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6816c61a-9348-4984-b7c5-d7f906805904
  modified: 2026-07-22T15:35:48.737Z
---

Found while scoping the new Grafana backup-failure alert query (2026-07-22) — a real, pre-existing `auth_fail` ERROR turned up in `jag-post-viewing.log`, unrelated to backups. Investigated and fixed same session (2026-07-22).

**Root cause confirmed:** 10 VM-scheduled cron scripts (`fx-rates-sync.sh`, `rent-reminders.sh`, `post-viewing-app-link.sh`, `viewing-reminders.sh`, `renewal-notices.sh`, `sla-monitor.sh`, `rent-missed-d1.sh`, `rent-arrears-escalation.sh`, `stale-listing-alert.sh`, `insurance-renewal-alerts.sh`) all authenticated via **ROPC (`grant_type=password`)** using Robert's own real human Keycloak account. Ruled out stale credentials, WebAuthn/2FA interference, and an active brute-force lockout at investigation time — working theory was cross-script contention on Keycloak's per-user brute-force counter, since all ~13 scripts share one account.

**Fix — dedicated Keycloak service account:**
- New confidential client `jag-cron-service` (realm `jag`), `serviceAccountsEnabled: true`, standard-flow/direct-grants disabled. Client secret generated via `openssl`-equivalent kcadm output, stored only in VM `/opt/jag/jag-infra/.cron-secrets` as `KC_CRON_CLIENT_SECRET` (never committed).
- New realm role `jag_cron_service`, assigned to the client's service-account user (`service-account-jag-cron-service`).
- `jag_core.users` row inserted for the service account (`keycloak_id` = the service-account user's own Keycloak UUID), with a `user_tenant_roles` row (Staff @ JAG_PROPERTIES) — this satisfies `resolveUserFromKeycloakId()`'s NOT-provisioned check but is otherwise discarded.
- **`jag-api/src/middleware/auth.ts`** — added an `isCronService` branch (realm role `jag_cron_service`) mirroring the existing auditor-portal pattern: calls `resolveOwnerContext()` and sets `req.rlsCtx.userId = ownerCtx.userId` (Robert's actual `jag_core.users.id`). This was the key design constraint: `jag_properties`/`jag_family` RLS is owner-scoped keyed directly on `req.rlsCtx.userId` (not a separate tenant-role lookup), so the service account's own userId would return **zero rows** on every query unless remapped to Robert's real ID — same failure class as the "public route wrong owner" bug documented elsewhere in this project. The service account's own userId is preserved as `operatorId` for audit purposes. `RLSContext` gained `isCronService?: boolean`.
- All 10 scripts changed: `KC_CLIENT_ID="jag-cron-service"`, `KC_CLIENT_SECRET="${KC_CRON_CLIENT_SECRET:?...}"`, body `grant_type=client_credentials` (dropped `username`/`password` entirely). No crontab changes needed — entries already `. .cron-secrets &&`-source before running.
- Verified end-to-end: all 10 scripts run clean with real data through the actual production API (not just a synthetic test), zero `auth_fail`.

**Two unrelated, real bugs surfaced once the auth noise was gone (same session, same fix commit `3801eea`):**
1. `properties/viewings/send-reminders` (24h reminder) queried a nonexistent `v.reminder_sent_at` column (real column: `reminder_24h_sent_at`) — 500'd on every call, but `viewing-reminders.sh`'s own `api_post()` helper swallowed the failure (`|| echo '{}'`) and logged fake success (`sent:0`) with no error at all. 24h viewing reminders had likely never actually sent.
2. `properties/renewals/send-notices` + `/renew` + `/vacate` all referenced `tenant_name`/`tenant_email`/`tenant_phone` directly on `prop_lease_agreements` — those columns don't exist; tenant contact info was normalized onto `prop_property_tenants` (joined via `tenant_id`) in an earlier session, and every other route in `properties/` was updated to match except this one file. Renewal notices had been 500ing on every single daily run. Also found a second bug in the same query: `EXTRACT(DAY FROM (date - date))` — date-minus-date in Postgres is already an integer day count, not an interval, so `EXTRACT` errored; fixed to a plain cast.

**Pattern worth remembering:** fixing a masking bug (here: intermittent auth failures) can unmask real functional bugs that were failing silently underneath it the whole time — always spot-check the underlying endpoint's actual success, not just "no more auth errors," after a fix like this.
