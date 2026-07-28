# Session Handoff — Properties Phase 3 built; Tenant 360 timeline bugs found and fixed (session 52)

> Supersedes the session-51 handoff. Its three open items are resolved: `f404c03` **was** pushed
> (`origin/main` is level), Robert **did** click Tenant 360 — which is how the bugs below were
> found — and the migration-documentation question is still unanswered, carried forward here.

## 1. Metadata

| | |
|---|---|
| **Date** | 2026-07-28 (session 52) |
| **Project path** | `C:\Users\rober\Documents\Claude\Projects\JAG Holdings` |
| **Git branch** | `main`, HEAD `f404c03`, level with `origin/main`. **18 uncommitted changes — nothing from this session is committed.** Branch `fix/properties-tenant-links` is merged and still deletable |
| **Context estimate** | Long. Phase 3 built end-to-end, three full builds, a nine-query production investigation. Approaching compaction |
| **Approved plan** | `C:\Users\rober\.claude\plans\validated-giggling-dahl.md` — authoritative for Phases 4–5 |

## 2. Current Objective

Finish the Properties repair-and-restructure. Phase 3 (navigation) is **built but not deployed and
not committed**. Mid-session Robert opened Tenant 360 for the first time and reported three things
wrong, which turned into a production data investigation — that investigation, not Phase 3, is now
the live thread. It surfaced one urgent operational gap: **Ashante Charles's lease starts 1 August
and she has no rent schedule, and the app has no button capable of creating one.**

## 3. Decisions Made & Rationale

**A record existing is not evidence the thing happened.** This is the root defect behind two of
Robert's three reports, and it is now a written rule in `docs/rules/properties.md`. The lifecycle
timeline marked Handover done because a checklist row existed, and labelled it with that row's
`created_at` — the day it was *drafted*, rendered on screen as the day the tenant moved in. Same
defect one step earlier: `latest_viewing_at` is `max(scheduled_at)` over all viewings regardless of
status, so a viewing booked for next week — or one already CANCELLED or NO_SHOW — marked Viewing
done. Both fixed.

**Handover completion must key off `completed_at`, never the signature flags.** This looked like a
toss-up when writing the fix and the production data settled it: the 13 July checklist has
`tenant_signed = true` and `manager_signed = true` from a test run, while `completed_at` is NULL.
A signature-based check would still be showing Ashante's handover as complete. `completed_at` was
the only honest signal in the row. Do not "improve" this later by adding the flags back.

**Listing readiness deliberately does not score utilities.** `wasa_included` /
`electricity_included` / `internet_included` are `BOOLEAN DEFAULT FALSE` (migration 022), so
"not included" and "nobody filled this in" are the same stored value. Same family as the rule
above — scoring it would state a guess as a fact.

**The Doc Expiry tab was kept, against the approved plan.** The plan retired it in favour of a
Phase 5 landing card, but Phase 5 is explicitly droppable, so retiring it now would make a working
deployed view unreachable. It sits under Tenants until that card exists. Deviation is recorded in
`docs/route-map.md` and the CHANGELOG.

**Tab ids are a public contract.** The notification bell, WhatsApp deep links and bookmarks all
arrive as `?tab=`. Renaming `pipeline` → `acquisitions` shipped with a `LEGACY_TAB_IDS` alias
applied both at mount and in the `?tab=` effect.

**`ManageListingModal` was exported rather than duplicated.** UnitsPanel needs the same ~250-line
listing form. It takes `propertyId` only to invalidate that property's nested units query; outside
callers pass the row's own `property_id` and invalidate their own key in `onChanged`.

**Two corrections made during the investigation, both stated to Robert.** (1) I suggested migration
063 mis-attached the handover checklist — wrong; 063 changed 0 rows precisely because that row
already had a `tenant_id`, so the link predates it (most likely the 052–055 backfill resolving
Apt C1 → most-recent lease → her). (2) I said it "needs unlinking regardless" — also wrong. Robert's
workflow is that the ENTRY checklist is prepared ahead and completed on move-in day when first
month's rent is paid, so the link is correct; only the row's *contents* are contaminated.

**Production DB access is blocked for Claude.** Both `Bash` and `PowerShell` SSH+psql attempts were
refused by the permission classifier. Every finding below came from Robert running queries manually
and pasting output. Expect to do the same, and hand him `-P pager=off` in psql commands — the
default pager trapped him once.

## 4. Active & Critical Files

Everything below is uncommitted. All build gates pass (`npx tsc -b` in `jag-api/` and `jag-web/`,
`npm run build` in `jag-web/`).

**New, untracked**
- `jag-api/src/routes/properties/units-list.ts` — `GET /properties/units`. Built, never called by a human.
- `jag-web/src/components/properties/UnitsPanel.tsx` — flat unit list + readiness column. Built, never clicked.
- `jag-web/src/components/properties/LeasesPanel.tsx` — flat lease list. Built, never clicked.

**Modified**
- `jag-web/src/components/properties/TenantTimeline.tsx` — the two bug fixes. **Highest-value review target.**
- `jag-api/src/routes/properties/enquiries.ts` — adds `completed_viewing_at` alongside `latest_viewing_at`; they are not interchangeable.
- `jag-api/src/routes/properties/index.ts` — mounts `unitsListRouter` at `/units` above `propRoutes`.
- `jag-web/src/pages/Properties.tsx` — six groups, `LEGACY_TAB_IDS`, `resolveTab()`.
- `jag-web/src/components/properties/PropertiesPanel.tsx` — one-word change: `ManageListingModal` is now exported.
- `jag-web/src/api/properties.ts`, `jag-web/src/types/properties.ts` — `listUnits()` + `UnitListRow`.
- `jag-web/src/locales/en.json`, `zh-CN.json` — Phase 3 keys plus 3 timeline keys.
- `docs/route-map.md`, `docs/CHANGELOG.md`, `docs/rules/properties.md`, `CLAUDE.md` — registered as the files were created, per the standing rule.

**Reference only, unmodified, central to what comes next**
- `jag-web/src/api/tenancy.ts:95` — `generateRentSchedule()` exists and **nothing in the frontend calls it**.
- `jag-api/src/routes/properties/rent-schedule.ts:182` — `POST /rent-schedule/generate`, working, never successfully run in production.
- `jag-api/src/routes/properties/applications.ts:412` — the only line that ever links an application to a tenant.
- `jag-web/src/components/properties/PropertiesPanel.tsx:2578-2607` — the lease action row (send for signature / download / upload signed / signed copy).

## 5. Immediate Next Steps

1. **Answer Robert's open question, then build it: where does the "Generate Rent Schedule" button
   go?** Claude recommended the lease row in property detail → Leases, beside Send for Signature,
   rather than Money → Rent. He has not answered. This is the urgent item — see §6.
2. **Ashante's rent schedule must exist before 1 Aug.** `prop_rent_schedule` has 0 rows for lease
   `8e5681b7-2889-4eef-9cc0-d654fad384fa`. Without it: no WhatsApp reminders, no arrears, nothing on
   the dashboard, and by Robert's workflow the handover checklist cannot complete because there is no
   first-month rent record to pay against.
3. **Clear the four contaminated fields on handover checklist `14df3fb1-6103-4df3-9f20-6e2a32d7508f`**,
   keeping all 26 condition items (they are real inspection work on Apt C1 — "Clean. Some mold",
   "No keys for bedrooms"). To clear: `tenant_signed`, `manager_signed` (both `true` from the test),
   `tec_meter_reading` (`12345.6`, placeholder), `wasa_account_number` (`7890.1` — a meter reading in
   the account-number field; `tec_account_number` and `wasa_meter_reading` are both empty, so the
   pairs are crossed). **Production write — Robert has not approved it.**
4. **Link Ashante's application to her tenant record.** Application `d35cf328-ac01-4b4f-b4a2-f67d01407f44`
   has `tenant_id` NULL; her tenant is `20e229a9-a249-4981-bd2f-d5439f3d9786`. Until then, Application
   and Approved show as not-done on her timeline even though the approval is real.
   **Unresolved sub-question:** her tenant record was created 26 seconds after approval, which looks
   like the `create-tenant` endpoint — but that endpoint sets `tenant_id` at `applications.ts:412`
   inside `withOwnerRLS`, and hers is NULL. Run this to tell the two cases apart:
   `SELECT doc_type, source, application_id FROM prop_tenant_documents WHERE tenant_id='20e229a9-a249-4981-bd2f-d5439f3d9786';`
   Rows with `source='APPLICATION'` → the endpoint ran and its UPDATE silently failed, which is a
   live bug hitting every future approval. No rows → she was added by hand and only the link is missing.
5. **Decide on the test records** — Hugh Smith (`40c49589`), Marcus Ramkissoon (`37167abc`), Test Tenant
   (Public Sim) (`d297b2ea`), Hugh's application `bb913441`. Marcus holds an **ACTIVE $2,700 lease on
   Apt B, signature SENT**, counting toward real occupancy and arrears. All three share phone
   `18682912787`, so never match these on phone alone. **Deletion needs Robert's explicit list and a
   confirmed backup restore point.**
6. **Commit and deploy Phase 3 + the timeline fixes.** Nothing is committed. `deploy.sh` cannot run
   from a Claude session (its STD-12 `read -p "type YES"` needs a TTY); run the eight steps manually or
   have Robert run the script. `git push` is also classifier-blocked.
7. **Update CLAUDE.md's stale open items** — it still says "all leases expired" and "25 units all
   VACANT". Two leases are ACTIVE (Ashante/Apt C1, Marcus/Apt B). The "Leases (B3)" item needs rewriting.
8. **Still unanswered from session 51:** close out migration documentation for `jag_commercial`
   (8 missing), `jag_family` (7), and `jag_core` + `jag_entertainment` (no table at all)?
9. Phase 4 (rent consolidation, STD-13 — **do not add readers of `prop_rent_payments`**) and Phase 5.

## 6. Key Patterns & Constraints

Established or confirmed this session:

- Before a derived step claims something is done, find the column that records *completion* and read
  that. If no such column exists, the step cannot be marked done — label the draft ("checklist started
  13 Jul", "booked 4 Aug") rather than showing a bare date, because a bare date under a step reads as
  the date it completed.
- Never add a field to a completeness score unless its schema can represent "not answered".
- A flat `/properties/x` route goes in its own file mounted in `index.ts` above `propRoutes`. Mounting
  `/units` there is safe alongside `POST /units/alert-stale` and `/units/:id` because the new router
  declares only `GET '/'` and everything else falls through. Multi-segment paths were never at risk.
- Never match a phone with `=`, and never match *only* on phone — three tenant records share
  `18682912787`. Name + phone together disambiguates.
- Loading, error and empty are three different things. Build gate is `npx tsc -b`, not `--noEmit`.
- i18n: English first, batch-translate. Never name an arrow-function param `t`; never use a translated
  string as a React key.
- Documentation registration is not optional and not deferred to end of session.

Explicit user constraints:

- Do not spawn subagents unless explicitly requested.
- Do not commit or push unless asked. **Nothing was committed this session — he has not been asked yet.**
- No production writes without explicit approval.
- Report honestly what was not verified. Phase 3 and the timeline fixes are **built, not deployed,
  never clicked**; say so.

## 7. Resumption Instruction

Read `handoff.md` and `C:\Users\rober\.claude\plans\validated-giggling-dahl.md` before touching
anything. Properties Phase 3 and two Tenant 360 timeline bug fixes are built, typechecked and
documented but **uncommitted, undeployed and never clicked by a human**. Your first move is to ask
Robert where the "Generate Rent Schedule" button belongs — Claude recommended the lease row in
property detail → Leases, beside Send for Signature — then build it, because Ashante Charles's lease
starts 1 August, her `prop_rent_schedule` is empty, and there is currently no way to create one from
the UI at all (`tenancyApi.generateRentSchedule()` exists and no component calls it). Do not
re-investigate the shadowed `/leases` route, the lease-as-hub data model, or whether the 13 July
handover belongs to Ashante — all three are diagnosed and written up in `docs/rules/properties.md`.
Claude cannot reach the production database; the classifier blocks SSH, so give Robert psql commands
with `-P pager=off` and read his pasted output.
