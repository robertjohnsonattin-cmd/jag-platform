---
name: project-properties-scheduled-maintenance
description: "Properties module has its own Preventive/Scheduled Maintenance feature, distinct from Inventory's VMS PM schedules and from Properties' reactive maintenance tickets"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3ec07024-25b3-450f-8ea3-182af6ba2ce8
  modified: 2026-07-28T01:21:46.493Z
---

Properties has a dedicated **preventive/scheduled maintenance** feature (recurring planned upkeep — e.g. "service the AC every 3 months") that is completely separate from two other maintenance-sounding features:
- `prop_maintenance_tickets` — reactive, tenant/landlord-reported issues (P1-P4 tickets)
- `vms_pm_schedules` (Inventory → Vehicles) — vehicle preventive maintenance, a different module entirely

**Scheduled Maintenance specifics:**
- Backend: `jag-api/src/routes/properties/scheduled-maintenance.ts` — CRUD + `POST /:id/complete` (logs completion to `prop_scheduled_maintenance_log`, auto-advances `next_due_date` by `frequency`: WEEKLY/MONTHLY/QUARTERLY/BIANNUAL/ANNUAL/ONE_TIME)
- DB: migration `057_scheduled_maintenance.sql` (jag_properties) — `prop_scheduled_maintenance` + `prop_scheduled_maintenance_log`, owner RLS
- Frontend: `jag-web/src/components/properties/PropertiesScheduledMaintenancePanel.tsx`, mounted as the `sched_maintenance` tab in `Properties.tsx`
- Status: deployed to production 2026-07-21; a NaN-days due-badge display bug was fixed the same window (commit `d35a617`)
- Real data: Robert's actual PM schedule was loaded into production on 2026-07-23 via `scripts/load-pm-schedule-api.js` (reads a JSON export from his Google Drive `RJA/JAG Real Estate/Maintenance/pm_schedule_load.json`, idempotent, bearer-token auth copied from browser devtools)

**Why this memory exists:** Robert pointed out (2026-07-27) that this feature — built and shipped in production — was completely unknown to Claude in a fresh session; asking about it got "there is no preventive maintenance feature in properties." Root cause: it was never written into CLAUDE.md (jag_properties migration table stopped at 055, skipping 057) or into any memory file. Now fixed in both CLAUDE.md and here. See [[feedback-feature-documentation-gap]] for the standing process fix.
