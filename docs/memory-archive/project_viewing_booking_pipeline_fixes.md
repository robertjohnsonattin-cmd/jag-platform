---
name: project-viewing-booking-pipeline-fixes
description: "Property viewing booking pipeline had 3 stacked bugs (calendar events never created, no owner notification/confirm/reschedule, wrong displayed times) — all fixed and deployed 2026-07-18/19"
metadata: 
  node_type: memory
  type: project
  originSessionId: a3fec953-5bde-4b14-9b44-ca6d72aafd48
---

Robert reported "booked viewings don't show up on my Google Calendar and I get no chance to confirm or suggest a change." Investigation of `jag-api/src/routes/properties/viewings.ts` + `jag-api/src/lib/google-calendar.ts` found three independent, real bugs — all fixed and deployed same multi-session window (2026-07-18/19).

**Bug 1 — calendar event creation was 100% broken.** `createCalendarEvent()` passed an `attendees` list (booking prospect + `GOOGLE_CALENDAR_ID`). Confirmed via live production logs (`docker logs jag-api | grep CALENDAR_EVENT_FAILED`) that every single booking attempt failed with `403 forbiddenForServiceAccounts` — "Service accounts cannot invite attendees without Domain-Wide Delegation of Authority." The event was silently never created (caught, logged as WARN only). Fix: dropped `attendees` from `createCalendarEvent()` entirely — prospects are already notified via WhatsApp separately, so no functionality lost. Also added `updateCalendarEventTime()` for reschedules.

**Bug 2 — no owner notification, no Confirm/Reschedule action.** The public booking flow (`publicScheduleRouter.post('/:token')`) inserted the viewing and texted the prospect, but never called `enqueueNotification()` for the owner — Robert had no bell alert that a viewing was even booked, and the frontend (`PropertiesViewingsPanel.tsx`) only offered Mark Completed / No Show / Cancel, no Confirm or Reschedule despite the DB `status` enum already supporting `CONFIRMED`/`RESCHEDULED`. Fixed: added owner notification on booking; added Confirm button (PATCH status=CONFIRMED) and a Reschedule control (datetime picker → PATCH scheduled_at + status=RESCHEDULED, which now also calls `updateCalendarEventTime()` to keep the calendar in sync).

**Bug 3 — displayed/messaged times were wrong by the UTC/Trinidad offset.** See [[feedback-backend-timezone-display-bug]] — separate write-up since it's a distinct, likely-recurring pattern (not the date-only browser bug in [[feedback-date-display-timezone-bug]]). Found via the new owner-notification body showing "31/07/2026 04:30 pm" for a viewing actually stored at 12:30pm TT (16:30 UTC). Fixed in `viewings.ts` (owner notification, booking-confirmation WhatsApp, 24h/1h reminder WhatsApp — 5 call sites) and `maintenance-tickets.ts` (contractor-visit-time WhatsApp to tenant — 1 call site) via shared `fmtTTDate`/`fmtTTTime`/`fmtTTDateTime` helpers pinned to `America/Port_of_Spain`.

**Also changed (explicit Robert request, not a bug):** viewing availability windows changed from one continuous 7:30am–5:30pm range to three fixed daily windows — 7:30–8:30am, 12–1pm, 4–6pm (Sundays still skipped). Implemented as a hardcoded `VIEWING_WINDOWS` array in `google-calendar.ts`, replacing the old `GOOGLE_CALENDAR_WORK_START`/`GOOGLE_CALENDAR_WORK_END` env vars (no longer read anywhere — safe to ignore/remove from `.env` if noticed).

**Verification pattern used:** rather than trust the code read alone, checked live production `docker logs jag-api` for the actual 403 error text before writing the fix (confirmed root cause, not guessed); after deploying, ran the fixed formatter directly inside the container (`docker exec jag-api node -e "..."`) against a real stored `scheduled_at` to confirm the output matched the correct Trinidad wall-clock time before declaring it fixed.

**Status as of 2026-07-19:** all fixes deployed (commits across `2ee29fc`, `51aca06`, `97bd55d`). Checked all `prop_viewings`/`prop_applications` rows live — 3 completed viewings for Apt C1 (Jared Baptiste pending link-send via hourly cron, Ashante Charles link sent, Hugh Smith application APPROVED — the same test tenant with Robert's own email from [[project-lease-pdf-rendering-fixes]]). All 32 WhatsApp templates confirmed APPROVED by Meta (previously PENDING per [[project-whatsapp-business-registration]] — this has since resolved, worth updating that memory).
