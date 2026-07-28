---
name: project_health_connect_biometrics_sync
description: "Samsung Health → JAG Biometrics auto-sync via Android Health Connect, built and verified live 2026-07-27; four silent-failure gotchas"
metadata: 
  node_type: memory
  type: project
  originSessionId: de250725-ec39-4153-8881-dbdb865244aa
  modified: 2026-07-28T00:58:13.595Z
---

Robert's Samsung S24 Ultra now auto-populates steps/distance/calories (and sleep/active-minutes/floors when available) into Lifestyle → Medical Records → Biometrics. Built and verified live 2026-07-27; confirmed twice — first pass landed 3 days, then widened to a **7-day backfill window** (`BACKFILL_DAYS` in `healthConnect.ts`) and re-confirmed with 22 rows spanning a full week, including an EXERCISE_MINUTES entry that only appeared once the window widened past 3 days. Server-side entry cap raised 50→200 alongside the widening (7 days × 6 metrics = 42 left almost no headroom for future metric types).

**Why it must live in `jag-mobile`:** Samsung has no cloud API. Android **Health Connect** is an on-device broker only — it collects nothing itself; Samsung Health is what runs the sensor algorithms and writes into it. So there is no server-side polling option; the phone is the only thing that can read this. Robert asked directly "why go through Samsung if Android already has the sensors" — the answer is they're the same step, not two.

Full technical writeup (data flow, migration 038's partial unique index, multi-source double-count guard) is in CLAUDE.md → "Samsung Health → Biometrics auto-sync via Android Health Connect".

**The four gotchas — all silent, none gave a useful error:**
1. `HealthConnectPermissionDelegate.setPermissionDelegate(this)` must be in `MainActivity.onCreate` (native Kotlin) or the app hard-crashes on launch with `UninitializedPropertyAccessException`.
2. **Android 14+ needs a `ViewPermissionUsageActivity` activity-alias** (`VIEW_PERMISSION_USAGE` + `category.HEALTH_PERMISSIONS`). This was the long dead-end: without it Health Connect opens its PermissionsActivity and kills it ~100ms later without rendering, returns "denied", and the app never appears in Health Connect's app list. The older `ACTION_SHOW_PERMISSIONS_RATIONALE` filter is Android 13-and-below only and is NOT a substitute.
3. Android allows only one permission dialog in flight — notifee's notification request was starving the Health Connect one (`W Activity: Can request only one set of permissions at a time`). Health Connect sync is delayed ~4s after auth.
4. `minSdkVersion` 24 → 26 required.

**Why:** every one of these fails silently. Diagnosing #2 required watching `PermissionsActivity` open+close in raw logcat — no amount of reading JS-side return values would have found it.

**How to apply:** when a mobile feature "does nothing" with no error, add step-by-step diagnostic logging *before* attempting another speculative fix, and check raw logcat for system-level activity lifecycle, not just the app's own JS logs. Strip health-data logging before shipping — logcat is readable via adb. See [[feedback_expo_router_navigation_readiness]] for the pre-existing navigation bug this work surfaced.

**Sleep specifically not syncing — investigated 2026-07-27, left unresolved/paused per Robert:** Robert logged a nap in Samsung Health (1h20m, visible on its own home dashboard) but it never appeared in Biometrics. Ruled out, in order: (1) Health Connect permissions — confirmed fine, Samsung Health has "Allow all" including Sleep, and JAG Mobile has allowed access under Health Connect's App permissions screen. (2) The sync-only-fires-on-cold-start behavior documented above (gotcha #3 area) — confirmed real: `_layout.tsx`'s Health Connect `useEffect` is keyed on `authed`, so switching back to an already-running app does NOT re-trigger a sync, only a full close+relaunch does. Robert did a full relaunch and the sync engine visibly ran again (other metrics' values updated in the DB — confirmed via direct query, though note `fam_lifestyle_tracker` has no `updated_at` column, so an unchanged `created_at` on a Health Connect row does NOT mean no sync happened, it could just be an upsert that didn't change `created_at`). (3) `healthConnect.ts`'s `summarizeDay()` sleep-window logic (12h lookback) was re-read and looks correct for a same-day 5:40-7pm session. Despite all of this, zero `SLEEP_HOURS` rows ever landed in the DB (confirmed via direct query both before and after the relaunch).

**Most likely remaining explanation (unconfirmed):** Samsung Health's own dashboard may show a session before it's actually been written into Health Connect's on-device data store — that hand-off is a separate background process on Samsung's side and can lag. Asked Robert to check the **Health Connect app itself** (not Samsung Health) → Data and access → Sleep, to see if the session appears there at all — if not, it's a Samsung-side lag, not a JAG bug; if it does appear there but JAG still isn't picking it up, the query/window logic needs a real second look. **Robert paused the investigation here** rather than checking that — pick this up next time sleep data is reported missing, starting from "did you check Health Connect's own Sleep data view" before re-diagnosing from scratch.
