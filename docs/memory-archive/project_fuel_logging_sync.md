---
name: project-fuel-logging-sync
description: "Fuel logging UX overhaul (web quick-entry + mobile) and the two-way Expense↔vms_fuel_logs sync, including two silent-failure bugs found and fixed"
metadata: 
  node_type: memory
  type: project
  originSessionId: f8d5bfa2-5771-44ee-a14f-76826021681d
---

Added session 34 (2026-07-05). Three related pieces of work:

## 1. Web quick fuel-entry redesign (Inventory → Vehicles → Manage → Fuel & Costs)
`NewFuelLogForm` in `jag-web/src/pages/Inventory.tsx` no longer asks for litres or price/litre from scratch every time. Primary fields are now Date, Odometer (pre-filled from `vehicle.current_mileage_km`), and Amount Paid. Price/litre pre-fills from the vehicle's most recent fill-up (`fuel_logs[0].cost_per_litre_ttd`) but stays editable; litres is always derived (`amount ÷ price`), never typed. Fuel type/station/notes moved behind a collapsed "more details" toggle, also defaulted from the last log.

**Bug fixed in the same pass:** the `FuelLog` TS type and the fuel-log display table were using wrong field names (`fill_date`/`price_per_litre`/`mileage_km`/`full_tank`) that never matched what `GET /ims/vehicles/:id/fuel-logs` actually returns (`log_date`/`cost_per_litre_ttd`/`odometer_km`/`is_full_tank`). The table had been silently rendering blank Date/Price/Odometer/Full-tank columns since this feature shipped. Fixed in `jag-web/src/types/ims.ts` and `jag-web/src/api/ims.ts`.

## 2. Mobile FUEL expense → vehicle linking (JAG Mobile)
`jag-mobile/app/expense-form.tsx`: picking category **Fuel** now shows a Vehicle picker (new `jag-mobile/src/api/vehicles.ts`). Selecting a vehicle prefills Odometer + Price/Litre + Fuel Type from its last fill-up; litres is derived from Amount ÷ Price, same pattern as the web redesign. On submit, if a vehicle + valid price are set, the expense carries `linked_record_type='VEHICLE'` + `fuel_litres`/`fuel_odometer_km`/`fuel_type`.

## 3. Bidirectional sync between `fin_expenses` (jag_family) and `vms_fuel_logs` (jag_commercial)
Two independent one-way syncs, now both fixed and both directions work:

**Expense → fuel log** (`autoInsertFuelLog()` in `jag-api/src/routes/finance/expenses.ts`, existed since session 30, never worked until session 34):
- **Bug 1 (fixed):** built `idempotency_key: 'exp-${expenseId}'` — a string — but `vms_fuel_logs.idempotency_key` is `uuid` (migration 032). Every insert threw `invalid input syntax for type uuid`, silently caught by the fire-and-forget try/catch. Fix: pass `expenseId` directly as `idempotency_key` (already a unique UUID, no need for the string prefix).
- **Bug 2 (fixed):** used `tenantId: b.owner_entity_id` (the expense's free-choice grouping field, which can be a personal entity like `Personal — Robert`) as the RLS tenant scope for the `vms_fuel_logs` insert, instead of the vehicle's real `tenant_id`. Fix: use `req.rlsCtx.tenantId` (the requester's actual authenticated tenant context) instead — matches how `GET /ims/vehicles` resolves the same vehicle.
- Trigger condition: `category==='FUEL' && linked_record_type==='VEHICLE' && linked_record_id && fuel_litres` truthy.

**Fuel log → expense** (`autoInsertFuelExpense()`, new in session 34, `jag-api/src/routes/ims/vms-costs.ts`): logging a fill-up directly on the vehicle's Fuel & Costs tab now also creates a matching `fin_expenses` row — `category: FUEL`, `status: SUBMITTED` (skips DRAFT, ready to Approve), `payment_method: CASH` (no way to know the real method from that form), `owner_entity_id` = the vehicle's own `tenant_id`, `linked_record_type/id/label` pointing back at the vehicle. Guarded by `!b.reference_type` so it only fires for fresh manual entries, not for rows created via the other sync direction (which would otherwise loop).

**Not backfilled:** fuel logs/expenses created before this fix (session 30 through early session 34) were NOT retroactively synced — only one test entry (TDM 9497, 2026-06-25, 17.01L diesel) was manually backfilled into `vms_fuel_logs` via direct SQL. If Robert asks why an old fuel log has no matching expense (or vice versa), that's why.

**Lesson for future cross-table auto-sync helpers:** always check the target column's actual Postgres type (not just the frontend type) before building a deterministic idempotency key — `uuid` columns reject non-UUID strings even when unique. And always derive tenant/RLS scope from the authenticated request's own context (`req.rlsCtx`) when writing into a *different* tenant-scoped table, never from a free-text/grouping field on the source row.

See also [[feedback-zod-limit-and-response-keys]] (a 3rd recurrence of the vehicle-picker `limit` cap bug was found and fixed in the same session, in `pages/Expenses.tsx`'s FUEL category vehicle picker).
