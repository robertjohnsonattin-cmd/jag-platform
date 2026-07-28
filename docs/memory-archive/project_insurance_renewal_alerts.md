---
name: project-insurance-renewal-alerts
description: "Insurance renewal notification system — JAG bell reminders only, not calendar or auto-rollover — deployed 2026-07-06"
metadata: 
  node_type: memory
  type: project
  originSessionId: f93fc52c-148a-4331-8d59-7d56d87251cf
---

Insurance policies previously had **no working renewal notification** despite looking like they did: `GET /finance/insurance/policies/expiring` fired a `RENEWAL_ALERT` write to the `pending_events` outbox only when a human opened the Insurance panel, and that outbox had no unique constraint (so the misleading "ON CONFLICT DO NOTHING dedup" comment did nothing) and no consumer — the separate `jag-event-dispatcher` service's handler map only covers `vehicle.*`/`loyalty.*`/etc. event names, all still `console.log` stubs, and never included insurance at all.

**Fixed 2026-07-06:** Robert chose "reminders only" (not auto-rollover of the policy itself — insurers change premiums/terms at renewal, so the record still requires a manual PATCH once terms are confirmed).

- Migration `jag-infra/migrations/jag_family/021_insurance_renewal_notices.sql` — adds `renewal_notice_sent_at` / `renewal_notice_urgent_sent_at` to `fin_insurance_policies`.
- `routes/finance/insurance.ts`: new `POST /finance/insurance/policies/check-renewals` (cron-driven) fires a real JAG bell notification via `enqueueNotification()` — Tier 2 (standard) once a policy enters its `renewal_alert_days` window, Tier 1 (urgent) once ≤7 days from expiry or already expired. Each tier fires exactly once per cycle. `PATCH /policies/:id` resets both dedup columns to NULL whenever `expiry_date` changes (i.e. the policy was renewed), re-arming the next cycle. `GET /policies/expiring` is now a pure read with no side effects (used by the UI/dashboard only).
- New cron `jag-infra/scripts/insurance-renewal-alerts.sh` (daily 08:00 UTC), registered on the VM crontab sourcing `.cron-secrets` for `KC_PASSWORD` (same pattern as `sla-monitor.sh`).

**Separate, pre-existing feature (unrelated to the above):** `expiry_date` already creates/updates an all-day Google Calendar event on policy create and on any PATCH that changes `expiry_date` (`createAllDayCalendarEvent`/`deleteCalendarEvent`, `calendar_event_id` column). That calendar sync was already working before this session.

**Added same session (2026-07-06, follow-up):** the standard-tier renewal notice now *also* creates a second, distinct all-day calendar event ("Insurance Renewal Reminder: ...", dated the day the alert fires) via `createRenewalReminderCalendarEvent()`, id stored in new column `renewal_notice_calendar_event_id` (migration `022_insurance_renewal_calendar_event.sql`). This is separate from the existing expiry-date event — you'll see both on the calendar: one for "renewal window opened" (created day-of-alert) and one for "actual expiry date" (fixed). PATCH deletes and nulls this event id whenever `expiry_date` changes, alongside the existing dedup-column reset, so a fresh reminder event is created next cycle.

See [[feedback-migration-runner]] for the directory-collision gotcha hit while building this (`jag-infra/migrations/` vs `jag-api/migrations/`).

**Follow-up (2026-07-06, later session):** Robert reported expiry-date calendar events "not working" for existing policies. Root cause: the create/PATCH calendar sync only fires going forward — any policy created before that code existed (or untouched since) never gets an event, since there was no one-time sweep. The fix already existed as a shared endpoint (`POST /api/v1/admin/calendar/backfill`, owner-only, in `routes/admin/calendar-backfill.ts`) covering vehicles + property inspections + **all** insurance policy types (no `policy_type` filter) — but it was only wired to a button on Inventory → Vehicles tab, not discoverable from Insurance. Added a matching "📅 Sync to Calendar" button directly to `InsurancePanel.tsx` (same `tenantApi('...0001').post('/admin/calendar/backfill', {})` pattern), deployed and confirmed live. Run it once after adding/importing policies in bulk (e.g. via the Path 2 local import script, which also doesn't create calendar events) to catch anything the auto-create/PATCH path missed.
