---
name: project-jabco-bonds-insurance-asset-labels
description: JABCO tender/performance bonds now linked to fin_insurance_policies via PROJECT asset type; Finance Insurance list resolves insured_asset_ref to a human label
metadata: 
  node_type: memory
  type: project
  originSessionId: 4860253d-375b-44ac-845d-3cd0d34cb0d2
---

Added 2026-07-05 (session 32/33): `insurance_asset_type` enum (jag_family) gained a `PROJECT` value (migration `020_insurance_project_asset_type.sql`, applied via `sudo -u postgres psql` — ALTER TYPE ADD VALUE cannot run in a transaction, same pattern as migration 018). JABCO project detail page ([JABCO.tsx](../../../../Documents/Claude/Projects/JAG%20Holdings/jag-web/src/pages/JABCO.tsx)) gained a **Bonds** tab (`BondsTab` component) that lists/adds `fin_insurance_policies` rows filtered by `insured_asset_ref = project.id`, `insured_asset_type = 'PROJECT'`, `owner_entity_id = JABCO_ENTITY_ID` — mirrors the existing Properties/Vehicles insurance-tab pattern. Policy types offered there are restricted to `SURETY_BOND` / `PERFORMANCE_BOND` / `OTHER`.

Also fixed a pre-existing display gap in the main Finance → Insurance list ([InsurancePanel.tsx](../../../../Documents/Claude/Projects/JAG%20Holdings/jag-web/src/components/finance/InsurancePanel.tsx)): the Asset column now resolves `insured_asset_ref` to a real label (vehicle plate + make/model, property name, or project code) via client-side lookup maps built from `imsApi.getVehicles`/`propertiesApi.getProperties`/`jabcoApi.getProjects`, instead of just showing the generic asset-type word. The Add Policy modal also gained a conditional "Linked Vehicle/Property/Project" picker so new general-tab policies can be tied to a specific asset (previously only the per-module tabs could set `insured_asset_ref`).

**Why:** Robert pointed out the Insurance list showed "Vehicle" with no way to tell which vehicle — `insured_asset_ref` was already being stored correctly by the Properties/Vehicles tabs, but nothing resolved it to a label, and the general Add Policy form had no way to set it at all.

**How to apply:** [[feedback-zod-limit-and-response-keys]] bit us again here — the vehicle/project picker queries need `limit: 100` not `500` (those two backend schemas were never raised). If `PROJECT` asset-type policies ever need their own dedicated column/filter elsewhere (e.g. a JABCO-wide bonds report), reuse `insured_asset_type = 'PROJECT'` as the filter, same as `VEHICLE`/`PROPERTY`.

**Note on migration numbering:** production's jag_family `__migrations` table already had a `019_expense_linked_record.sql` registered (from session 30) with **no corresponding file in the repo** — it was applied via raw psql and never committed. This migration used `020` to avoid collision. This gap should be reconciled at some point (either recreate the missing 019 file from what's live in prod, or document it as an intentional exception).
