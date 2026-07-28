---
name: project-insurance-consolidation
description: "fin_insurance_policies is the single source of truth for ALL insurance — prop_insurance dropped, vehicle insurance columns dropped, per-section views filter by insured_asset_ref"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7ab227b7-486e-49d6-a5a8-f32bf904b96a
---

**Session 28 (2026-06-26):** Insurance consolidated into `fin_insurance_policies` (jag_family).

## What was removed
- `prop_insurance` table (jag_properties) — dropped via migration `034_drop_prop_insurance.sql`
- `routes/properties/insurance.ts` — deleted; no longer mounted
- `ims_vehicles` columns: `insurance_policy_number`, `insurance_provider`, `insurance_expiry`, `cal_insurance_event_id` — dropped via migration `037_vehicles_drop_insurance_cols.sql` (jag_commercial)

## What was added (migration 018_insurance_consolidation.sql — jag_family)
- 7 new `insurance_policy_type` enum values: BUILDING, CONTENTS, FLOOD, FIRE, COMPREHENSIVE, SURETY_BOND, PERFORMANCE_BOND
- `sub_type VARCHAR(50)` on `fin_insurance_policies` — optional free-text refinement
- All 4 RLS policies hardened with `NULLIF(..., '')::uuid`

## How it works now
- `fin_insurance_policies.insured_asset_ref UUID` = soft cross-DB ref (no FK per STD-01) pointing to `property.id` or `vehicle.id`
- `fin_insurance_policies.insured_asset_type` = PROPERTY | VEHICLE | OTHER
- **Properties → Insurance tab** queries `GET /finance/insurance/policies?insured_asset_ref=<property.id>`
- **Vehicles → Manage › → 🛡 Insurance tab** queries `GET /finance/insurance/policies?insured_asset_ref=<vehicle.id>`
- **Finance → Insurance** = master view, no filter, shows all policies

## Critical constraints
- `coverage_amount` and `premium_amount` use Zod `.positive()` — must be > 0; frontend defaults blank to 1
- `start_date` and `expiry_date` both required as `YYYY-MM-DD`; frontend defaults to today / +1 year
- `insured_asset_type` is required when `insured_asset_ref` is set
- `owner_entity_id` for property insurance = JAG_PROPERTIES (`00000000-0000-0000-0001-000000000003`)
- `owner_entity_id` for vehicle insurance = derived from `vehicle.owner_entity` string via `ENTITY_MAP` constant in `Inventory.tsx`

## No data was lost
Both `prop_insurance` and the vehicle insurance columns were empty at time of migration (0 rows migrated).

**Why:** User preferred "insurance under each relevant section and duplicated under finance" — per-section views are filtered reads of the same table, not duplication of data.
