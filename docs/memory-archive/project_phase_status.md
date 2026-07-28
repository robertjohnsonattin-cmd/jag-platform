---
name: project-phase-status
description: "Current build phase, completed work, next steps, open items, test credentials — updated 2026-07-01 session 31"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8000aa2e-2843-4b36-a3bd-3210ba23493e
---

**ALL PHASES COMPLETE as of 2026-06-11. Session 31 (2026-07-01): CRM quick-log, HR payroll finalize/GL/per-entry-pay fixes, HR time clock. Session 28 (2026-06-26): Insurance consolidation. See below.**
- Phase 0–5: Infrastructure, all backend modules, security hardening — COMPLETE
- Phase 6: Oracle Cloud production deployment, HTTPS, ZAP security audit — COMPLETE
- Phase 7: React frontend (all 12 build steps) — COMPLETE
- Tenancy lifecycle (session 11): Full Advertising → Enquiry → Viewing → Application → Handover → Rent → Maintenance → Renewal/Exit — COMPLETE. Commit `02ea1f2`. 50 files, 5866 insertions. Migrations 013–022 applied on VM. 5 cron scripts registered.
- Mobile responsive (session 12): 16 frontend files updated — Dashboard grids, PropertiesPanel mobile stack pattern, all data tables `overflow-x-auto`. No backend changes. Frontend-only deploy (SCP only). `common.back`/`返回` added to locale files.
- JABCO Commercial Lifecycle (session 13): Full bid pipeline Lead→Go/No-Go→BOQ→Submit→Win/Loss→Mobilization→Execution→Closeout. 8 migrations (016–023 jag_commercial). 5 new backend routes. `crm/pipeline.ts` with bid intelligence loop-back. CRM Tender Pipeline kanban tab. JABCO project detail gains 5 tabs: Tasks, Punch List, Incidents, Quality, Closeout. Commit `60be2f3`. 26 files, 4258 insertions. Deployed 2026-06-16.

- Session 15 (2026-06-17): IBKR 3-account investment import (U21242678 Phillip, U2428207 + U4022018 Robert). `parseIbkrForexBalances()` added. InvestmentsPanel FX display fixed (AddModal + UpdateValueModal now work in native currency, convert on save). Dashboard investments total bug fixed (was multiplying already-TTD values by FX rate, inflating ~6.77x). IMS valuation double-counting fixed (assets now excluded from stock total; asset total now uses qty × unit_value). See [[feedback-investment-fx-pattern]].
- Session 16 (2026-06-17): CRM contact detail fields (address, birthday, notes, land/cell labels), ContactPanel master-detail, `CrmContactPicker` search-as-you-type component, `CrmContactBadge`. `crm_contact_id` soft ref wired into prop_contractors/ent_members/db_clients (migrations 024/006/027). Commit `7d72654`.
- Session 17 (2026-06-18): JAG Mobile Android app built — React Native 0.76.3 / Expo 52 bare workflow, expo-router v4, Keycloak PKCE auth, persistent notification widget (`@notifee/react-native`), BootReceiver.kt, receipt camera upload, submit from mobile, splash screen, live FX rates. Credit/debit cards API (`routes/finance/credit-cards.ts`) deployed. Migrations 012/013 applied to jag_family (fin_credit_cards table; DEBIT_CARD enum). See [[project-mobile-app]].
- Session 18 (2026-06-22): WhatsApp template gap analysis — 17 new template triggers wired to backend events. `prop_wa_pending_approvals` + `prop_contact_log` tables (migrations 026–027). `routes/properties/wa-approvals.ts` (pending approval queue + approve-and-send + dismiss) and `routes/properties/wa-inbox.ts` (unified conversation timeline — WA messages + contact log). PropertiesWhatsAppPanel updated: Inbox + Pending Approvals tabs. Contractor field added to maintenance tickets (migration 025). 3 template names corrected to match Meta approved names: `jag_adv_stale_alert`, `jag_mnt_sla_breach`, `jag_onb_lease_ready`. `stale-listing-alert.sh` cron added (09:00 UTC). Additional migrations: 028 (rent_schedule_reminder_cols), 029 (viewing_1h_reminder_col), 030 (unit_stale_alert_col). All deployed.
- Session 19 (2026-06-22): Unit photo upload + auto-listing + Gemini AI rent suggestion.
- Session 20 (2026-06-22): CRM Google Calendar follow-up sync. `createAllDayCalendarEvent()`. Migration 028 (calendar_event_id on crm_interactions). Backfill endpoint. ✓/⚠ sync indicator. Google service account key moved to volume-mounted file.
- Session 21 (2026-06-22): CRM WhatsApp inbox + contact panel improvements (see sessions 18–20 merged in prior context).
- Session 28 (2026-06-26): Insurance consolidation. `fin_insurance_policies` is now single source of truth for ALL insurance. `prop_insurance` table dropped (migration 034 jag_properties). Vehicle insurance columns dropped from `ims_vehicles` (migration 037 jag_commercial). 7 new policy types + `sub_type` column (migration 018 jag_family). Per-section Insurance tabs restored in Properties panel and Vehicles Manage modal — both filter `fin_insurance_policies` by `insured_asset_ref`. Finance Insurance remains master view. No data lost (both old tables were empty). Key pattern: `insured_asset_ref UUID` soft-ref per STD-01. `coverage_amount`/`premium_amount` must be positive (Zod rejects 0). Frontend uses plain async/await for insurance saves (not useMutation — was silently swallowing errors). Commits: `0321007`.
- Session 22 (2026-06-18): 5 bug fixes + 2 new pipeline features. (1) Pipeline kanban empty — `GET /pipeline` returned `{ pipeline: rows }` but client expected `{ opportunities: [...] }`, key renamed. (2) Companies dropdown empty — `CompaniesQuerySchema` limit max(100)→max(500). (3) New Opportunity save — `assigned_to ?? null` violated NOT NULL, changed to `?? userId`. (4) Pipeline list limit — `PipelineQuerySchema` max(100)→max(500). (5) Tenants company field — always visible (not hidden behind is_company checkbox). New: `POST /pipeline/:id/advance` (PREQUALIFICATION→LEAD) + `DELETE /pipeline/:id` (blocked for WON/LOST/NO_GO). OppDetail gains green "Advance to Lead" + inline red Delete confirm. Commits: `12c93c4`, `4a18052`, `55e9fb9`, `6e2dedf`, `422cb5c`, `4f7b927`. See [[feedback-zod-limit-and-response-keys]]. Migration 031 (jag_properties): `listing_description` on prop_units + `prop_unit_photos` table with RLS. 5 new endpoints on listing.ts (GET/POST photos, upload-url presigned PUT, DELETE photo, PATCH listing-info). `getPresignedGetUrl()` added to minio.ts. `triggerAutoListing()` exported — called by handover.ts on EXIT sign-off (idempotent, skips if already LISTED); manual /list also fetches photos for Facebook (7-day presigned GET URLs). Public booking page returns photos. ManageListingModal in PropertiesPanel: 3-col photo gallery (hover-to-delete), description, asking rent, utilities checkboxes, AI Suggest Price. Replaced Ollama with Gemini (`responseSchema` — no regex parsing needed); `GEMINI_API_KEY` + `GEMINI_MODEL=gemini-3.5-flash` set on VM `/opt/jag/.env`. Field name mismatch (min_ttd/max_ttd vs min/max) fixed. Deployed.

**Why:** Full platform built in phases from May–June 2026. Tenancy and commercial lifecycle built in subsequent sessions.
**How to apply:** Platform is now in production with live data. Next work: fill in unit listing content (25 VACANT units need photos/description/rent via Properties → Units → Listing), create new leases (need rent amounts from Robert), configure WhatsApp env vars (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID), Google Calendar env vars (GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_CALENDAR_ID). JAG Plantations / JAG Trading are future phases.

---

## Full Backend Route Map (jag-api/src/routes/)

| Module | Directory | Key routes |
|---|---|---|
| Auth | `auth.ts` | `/auth/sync-user` |
| Me | `me.ts` | `/me` |
| Tenants | `tenants.ts` | `/tenants` |
| Notifications | `notifications.ts` | `/notifications` |
| Finance | `finance/` | accounts, transactions, net-worth, fx-rates, investments, loans, bank-statements, document-jobs, pending-review, gl, expenses, intercompany, insurance, export, reports; `/import` endpoints on loans/investments/insurance/bank-statements (Path 2 local script); `GET/POST /finance/investments/:id/valuations`; `GET/POST /finance/loans/:id/history`; `GET/POST /finance/insurance/policies/:id/history` |
| Internal (webhook) | `internal/minio-audit.ts` | MinIO audit log webhook — `/internal/minio-audit`; no Keycloak; Docker-network-only |
| Properties | `properties/` | properties, units, tenants-mortgage, maintenance, pipeline, property-tax, inspections, utility-accounts, utilities, vendor-invoices, documents; `GET/POST /properties/:id/valuation-history`; listing (photos, auto-listing, suggest-price, listing-info); wa-approvals; wa-inbox. NOTE: `routes/properties/insurance.ts` DELETED session 28 — property insurance now via Finance Insurance API filtered by `insured_asset_ref` |
| IMS / VMS | `ims/` | items, vehicles (+ Manage modal: photos, work orders, PM schedules, fuel logs, operating costs, TCO, compliance docs, 🛡 Insurance tab, disposal + GL, GPS), movements, suppliers, stocktakes, depreciation |
| JABCO | `jabco/` | projects, payment-certs, vendor-invoices, site-diary, gantt, retention, project-tasks, punch-list, site-incidents, quality-inspections |
| CRM | `crm/` | contacts, pipeline, interactions, pipeline (tender bid lifecycle — go-no-go, submit, decide, intelligence) |
| BAR | `bar/` | products, tabs, config |
| Club (Members Club) | `club/` | members, memberships, tiers, events, credits, chip-float, visitor-log |
| Entertainment | `entertainment/` | supplier-invoices, utilities, reports |
| DragonBridge | `dragonbridge/` | clients, orders, quotes, shipments, products, pricing-tiers, suppliers, reconciliations, config |
| NLCB | `nlcb/` | sessions, settlements, games, scratch-games, scratch-consignments, scratch-session, scratch-pack-purchases, billers, expenses, config |
| Lifestyle | `lifestyle/` | index |
| Brian | `brian/` | index |
| Family | `family/` | index |
| DocVault | `docvault/` | index |
| Succession | `succession/` | index |
| Files | `files/` | MinIO presigned URL helpers |

---

## Full Frontend Page Map (jag-web/src/pages/)

| Page | File | Key panels / tabs |
|---|---|---|
| Dashboard | `Dashboard.tsx` | Net worth, accounts, recent transactions, properties summary, IMS summary |
| Finance | `Finance.tsx` | Accounts, transactions, bank statements, documents (Path 1 upload + review), investments, loans, insurance, intercompany, net worth, FX rates, Cards (credit/debit card management) |
| Ledger | `Ledger.tsx` | Chart of accounts, journal entries, trial balance |
| Expenses | `Expenses.tsx` | Expense submission, approval workflow, receipt upload |
| Properties | `Properties.tsx` | Portfolio, leases, rent payments, maintenance, insurance, tax, inspections, units (with Listing modal — photos/description/rent/utilities/AI suggest), documents, financials, deposit refunds; WhatsApp tab (Inbox + Pending Approvals) |
| Inventory | `Inventory.tsx` | Items, vehicles, movements, stock takes, depreciation, valuation, suppliers, low stock |
| JABCO | `Jabco.tsx` | Projects, payment certs, site diary, Gantt, vendor invoices, retention; project detail tabs: Tasks, Punch List, Incidents, Quality, Closeout (session 13) |
| CRM | `CRM.tsx` | Contacts, pipeline, interactions; Tender Pipeline kanban tab (session 13) |
| Lifestyle | `Lifestyle.tsx` | Loyalty programmes, health tracker |
| Entertainment | `Entertainment.tsx` | BAR tabs, Members Club chip float, visitor log, supplier invoices, reports |
| DragonBridge | `DragonBridge.tsx` | Clients, orders, quotes, shipments, products, pricing tiers, suppliers, reconciliations |
| NLCB | `NLCB.tsx` | Sessions, settlements, scratch games, consignments |
| Brian Portal | `BrianPortal.tsx` | Brian's scoped view |
| Brian Admin | `BrianAdmin.tsx` | Admin for Brian's portal |
| DocVault | `DocVault.tsx` | Document management |
| Reports | `Reports.tsx` | Cross-module reports |
| Purchasing | `Purchasing.tsx` | IMS purchase orders |
| Placeholder | `Placeholder.tsx` | JAG Plantations, JAG Trading (future) |

---

## Complete Migration Map

### jag_commercial (034 files, incl. VMS migrations 030–034)
| # | File | Key tables/changes |
|---|---|---|
| 000 | initial_schema.sql | All core IMS + JABCO + entertainment + CRM tables |
| 001 | jabco_vat.sql | VAT fields on JABCO |
| 002 | ims_sale_vat.sql | VAT on IMS sales |
| 003 | jabco_vendor_invoices.sql | Vendor invoice tables |
| 004 | nlcb.sql | NLCB sessions, settlements, games |
| 005 | nlcb_scratch_bills.sql | Scratch ticket billing |
| 006 | nlcb_scratch_redesign.sql | Scratch game schema overhaul |
| 007 | dragonbridge.sql | DragonBridge tables |
| 008 | rls_and_indexes.sql | RLS policies + performance indexes |
| 009 | ims_suppliers_pos.sql | ims_suppliers, ims_purchase_orders |
| 010 | ims_stock_takes.sql | ims_stock_takes, ims_stock_take_lines |
| 011 | ims_depreciation.sql | ims_depreciation_schedules, ims_depreciation_entries |
| 012 | vehicles_owner_service.sql | owner_entity, service dates/interval on ims_vehicles |
| 013 | jabco_crm_client_fk.sql | FK linking JABCO projects to crm_contacts |
| 014 | crm_contact_phone2.sql | phone2 VARCHAR(50) on crm_contacts |
| 015 | vehicles_sim_number.sql | sim_number column on ims_vehicles |
| 016 | pipeline_project_status_enums.sql | pipeline_stage ADD VALUE SUBMITTED/NO_GO; project_status ADD VALUE AWARDED |
| 017 | pipeline_tender_fields.sql | 7 new columns on crm_sales_pipeline |
| 018 | bid_intelligence_log.sql | jabco_bid_log append-only table; RLS |
| 019 | boq_margin_columns.sql | internal_cost_rate, markup_percent, final_bid_rate, work_package_tag on jabco_boq_items |
| 020 | vo_time_extension.sql | time_extension_days INTEGER on jabco_variation_orders |
| 021 | project_tasks.sql | jabco_project_tasks; RLS |
| 022 | punch_incidents_quality.sql | jabco_punch_list_items, jabco_site_incidents, jabco_quality_inspections; all RLS |
| 023 | project_closeout_fields.sql | handover_document_url TEXT on jabco_projects |

### jag_family (015 files)
| # | File | Key tables/changes |
|---|---|---|
| 001 | initial_schema.sql | Base family schema |
| 002 | finance_schema.sql | fin_accounts, fin_transactions, fin_fx_rates, fin_net_worth_snapshots |
| 003 | fin_gl.sql | fin_gl_accounts, fin_journal_entries |
| 004 | fin_expenses.sql | fin_expenses |
| 005 | fin_intercompany.sql | fin_intercompany_charges, fin_intercompany_eliminations |
| 005b | fdw_setup.sql | postgres_fdw to commercialPool + propertiesPool |
| 006 | fin_insurance.sql | fin_insurance_policies, fin_insurance_premiums, fin_insurance_claims |
| 007 | expense_receipt_bucket.sql | MinIO bucket config for expense receipts |
| 008 | document_jobs.sql | ANNUITY added to fin_investments CHECK; fin_document_jobs table + RLS |
| 009 | investment_valuations.sql | fin_investment_valuations append-only; FK → fin_investments; RLS via NULLIF pattern |
| 010 | loan_balance_history.sql | fin_loan_balance_history; FK → fin_mortgages_loans |
| 011 | insurance_policy_history.sql | fin_insurance_policy_history; FK → fin_insurance_policies |
| 012 | credit_cards_categories.sql | fin_credit_cards table; card_id FK on fin_expenses; category CHECK expanded |
| 013 | debit_card_payment_method.sql | ALTER TYPE expense_payment_method ADD VALUE 'DEBIT_CARD' |
| 014 | transaction_categories.sql | Adds GROCERIES, FUEL, DINING, HARDWARE, LOAN_PAYMENT |
| 015 | transaction_tagging.sql | ADD COLUMNS: subcategory, entity_id UUID, project_ref, property_ref, cost_centre, billable, notes, tags TEXT[] |
| 016 | insurance_calendar_event_id.sql | calendar_event_id on fin_insurance_policies |
| 017 | ownership_stakes.sql | `fam_ownership_stakes` cap table (family_member_id, subject_kind ENTITY/PROPERTY/ITEM, subject_id, subject_label, ownership_percent); owner RLS; unique(member,kind,subject); owned by postgres + GRANT jag_app — session 26 |

### jag_properties (031 files)
| # | File | Key tables/changes |
|---|---|---|
| 001 | initial_schema.sql | prop_properties, prop_lease_agreements, prop_rent_payments, prop_maintenance |
| 002 | utilities_vendor_invoices.sql | prop_utilities, prop_vendor_invoices |
| 003 | insurance.sql | prop_insurance_policies |
| 004 | property_tax.sql | prop_property_tax |
| 005 | inspections.sql | prop_inspections |
| 006 | lease_deposit_refund.sql | deposit refund fields on leases |
| 007 | utility_accounts.sql | prop_utility_accounts |
| 008 | late_fee_lease.sql | late_fee_type/value/grace_days on leases |
| 009a | prop_properties_audit_cols.sql | last_modified_at, last_modified_by on prop_properties |
| 009b | units.sql | prop_units |
| 010 | mortgage_last_modified.sql | last_modified_at/by on mortgage table |
| 011 | rent_payment_proof.sql | proof_photo_url, proof_uploaded_at/by, receipt token on rent payments |
| 012 | valuation_history.sql | prop_valuation_history; FK → prop_properties; tracks valuation_ttd |
| 013 | enquiries.sql | prop_enquiries — prospect enquiry tracking |
| 014 | viewings.sql | prop_viewings — scheduled viewings, Google Calendar event ID, status lifecycle |
| 015 | applications.sql | prop_applications — tenancy applications |
| 016 | deposits.sql | prop_deposits — security deposits with refund workflow |
| 017 | rent_schedule.sql | prop_rent_schedule — generated rent schedule, payment recording |
| 018 | handover_checklists.sql | prop_handover_checklists — ENTRY/EXIT checklists |
| 019 | maintenance_tickets.sql | prop_maintenance_tickets, prop_ticket_updates, prop_contractors |
| 020 | whatsapp_messages.sql | prop_wa_conversations, prop_wa_messages |
| 021 | renewal_notices.sql | prop_renewal_notices |
| 022 | unit_enhancements.sql | prop_units: listing_status, booking_slug, rent suggestion columns; prop_broadcast_contacts |
| 023 | tenant_phone2.sql | phone2 on tenants |
| 024 | contractor_crm_link.sql | crm_contact_id FK on prop_contractors |
| 025 | maintenance_contractor_assign.sql | contractor assignment on maintenance tickets |
| 026 | wa_pending_approvals.sql | prop_wa_pending_approvals — manual-approve queue |
| 027 | contact_log.sql | prop_contact_log — call/note log entries |
| 028 | rent_schedule_reminder_cols.sql | reminder tracking columns on rent schedule |
| 029 | viewing_1h_reminder_col.sql | 1h reminder sent flag on prop_viewings |
| 030 | unit_stale_alert_col.sql | stale_alert_sent_at on prop_units for dedup |
| 031 | unit_photos.sql | listing_description TEXT on prop_units; prop_unit_photos table (owner_id, unit_id FK, object_key, display_order, caption); RLS |

### jag_core (008 files)
| # | File | Key tables/changes |
|---|---|---|
| 000 | initial_schema.sql | users, tenants, user_tenant_roles, audit_log_access |
| 001 | brian_portal.sql | Brian portal entities |
| 002 | nlcb_tenant.sql | NLCB tenant seeded |
| 003 | dragonbridge_tenant.sql | DragonBridge tenant seeded |
| 004 | brian_new_modules.sql | Brian's new module permissions |
| 005 | add_last_login_at.sql | last_login_at on users |
| 006 | missing_indexes.sql | Performance indexes |
| 007 | audit_log.sql | audit_log table for security events |

### jag_entertainment (005 files)
| # | File | Key tables/changes |
|---|---|---|
| 001 | initial_schema.sql | BAR + Club tables |
| 002 | vat_service_charge.sql | VAT + service charge config |
| 003 | utilities_supplier_invoices.sql | ent_utilities, ent_supplier_invoices |
| 004 | entity_tag_visitor_float.sql | Mandatory entity tag on transactions + visitor float |
| 005 | tabs_venue_not_null.sql | venue NOT NULL constraint on tabs |

---

## Data Population Status (as of 2026-06-22)

| Phase | Module | Status |
|---|---|---|
| A1 | CRM Contacts (23 JAG Properties tenants) | DONE |
| B1 | Properties (8 properties) | DONE |
| B2 | Property Units (25 units across 5 properties) | DONE — all VACANT |
| B3 | Leases | PENDING — all leases expired; need monthly rent amounts per unit from Robert |
| A2 | Chart of Accounts | DONE 2026-06-12 — 150 accounts across 7 entities |
| A3 | FX Rates | DONE 2026-06-12 — daily cron via fx-rates-sync.sh; 1 USD = 6.7829 TTD |
| Unit listings | Photos, description, rent, utilities for each of 25 units | PENDING — manual via Properties → Units → Listing |

### Production Property IDs
| Property | ID |
|---|---|
| 45 Eleventh St, Barataria | `e1557e0b-2a9d-43a3-8fd2-6f3df7b08bda` |
| 74 Tenth St, Barataria | `4003e68a-40cc-4aae-90a1-56034e0bcbfb` |
| 23 Fairley St, Tunapuna | `d142a3cc-208f-40a1-ba16-8447eabbb376` |
| 1 Cassleton, Trincity | `9b1a1e70-af49-4d5f-b009-36fc71a08931` |
| 4 Skinner Tce, Diego Martin | `70cf2238-3cc7-4106-a4e3-8790d54730b6` |
| 7 Tenth St, Barataria | `26bdc689-a7c3-4753-aaf3-b00c7f5073c6` |
| 274 Guapo Main Rd, Fyzabad | `619dc07c-f898-4e2a-a95f-0503e01f9f91` |
| Mundo Nuevo, Talparo | `eadf06f7-6526-4e05-a417-20bd5dc8fe37` |

---

## VM Status (as of 2026-06-23 session 24)

- Oracle Cloud VM: `ubuntu@150.136.151.64` (ARM, 4 OCPU / 24 GB)
- Project root on VM: `/opt/jag/`
- All containers running: jag-api, jag-keycloak, jag-minio, jag-loki, jag-event-dispatcher, jag-caddy, jag-grafana, jag-promtail
- `https://api.jagcorporate.com/health/ready` → `{"status":"ready"}`
- Frontend live: `https://jagcorporate.com`
- Boot volume: 200 GB (8% used); Oracle Bronze backup policy applied
- MinIO: all 4 buckets SSE-S3 encrypted; jag_app user + jag-app-buckets policy active; audit log → Loki
- **PostgreSQL is a NATIVE SERVICE, not Docker.** Connect via TCP: `PGPASSWORD='...' psql -U postgres -h 127.0.0.1 -d <db>`
- `GEMINI_API_KEY` set in `/opt/jag/.env`; `GEMINI_MODEL=gemini-3.5-flash`

---

- Session 23 (2026-06-23): (1) Google Calendar backfill — `POST /api/v1/admin/calendar/backfill` (owner-only) + `POST /internal/calendar/backfill` (Docker-network-only); all date columns cast with `::text` to prevent JS Date object coercion bug ("Invalid time value"); 6 vehicle calendar events created. (2) Vehicle consolidation — vehicles hidden from Items & Assets tab via `is_vehicle` EXISTS subquery flag on `ims_items` list; `EditVehicleModal` gains `item_name` field at top (saves via both `updateVehicle` + `updateItem`); `VehicleManageModal` gains **📷 Photos** tab as first tab (reuses item photo API via `vehicle.item_id`). (3) `Personal — Phillip` added to `VEHICLE_OWNER_OPTIONS`. (4) Vehicle edit form fixes: vin/engine_number added to `PatchVehicleSchema`; all date columns cast `::text` in GET/PATCH queries; SIM number field added. (5) Container rebuild race condition — API SCP and docker build must be sequenced (SCP completes first, then rebuild).

- Session 24 (2026-06-23): (1) **VMS frontend** — `VehicleManageModal` (max-w-4xl, 90vh) added to Inventory → Vehicles tab via "Manage ›" button. 4 tabs: Maintenance (work orders + expandable line items + add WO + status advance + PM schedule CRUD), Fuel & Costs (TCO cards + fuel log table + operating costs table, all with add/delete), Compliance (expiry-aware doc vault with red/orange alert banners + add/delete), Disposal (existing disposal record shown with gain/loss + GL journal posted status, or form for ACTIVE vehicles — SALE/WRITE_OFF/TRANSFER). New types: `WorkOrder`, `WorkOrderItem`, `PMSchedule`, `FuelLog`, `OperatingCost`, `VehicleTCO`, `ComplianceDoc`, `VehicleDisposal`, `VehicleStatus` in `types/ims.ts`. All VMS CRUD API methods added to `api/ims.ts`. (2) **Credit/Debit Cards web UI** — `CardsPanel.tsx` created; Finance → Cards tab wired in (i18n en "Cards" / zh-CN "银行卡"). Card grid (1→3 col responsive), Add/Edit modals, inline deactivate confirm (soft-delete — existing expenses unaffected). `CreditCard` interface in `types/finance.ts`; `getCreditCards`/`createCreditCard`/`updateCreditCard`/`deleteCreditCard` in `api/finance.ts`. Frontend deployed (SCP only — no API changes).

- Session 26 (2026-06-24): **Frontend gap-audit follow-through + in-app notifications.** Audited backend endpoints lacking UI; built & deployed 4 items. (1) **Pending-review → Transactions** — AI `suggested_category`/`confidence` surfaced in TransactionsPanel review modal; orphaned `fin_pending_review_queue` row now closed on PATCH (was leaking). (2) **Accountant Export page** (`pages/Export.tsx`, nav `/export`) — 7 read-only views (trial balance, GL, expenses, insurance, premiums, claims, intercompany) with per-view CSV (`lib/csv.ts`, RFC-4180 + BOM via `String.fromCharCode(0xfeff)`). (3) **Succession page** (`pages/Succession.tsx`, nav `/succession`) over `fam_succession_documents` + new `GET /succession/documents/:id` (returns storage_path for download). (4) **IMS photo 401 fix** — `<img src>` against header-only auth-gated streaming route 401'd; new `AuthedImg` component + `api.objectUrl()` fetch→blob; `imsApi.photoDownloadUrl` made BASE-relative (also killed a double `/api/v1` prefix). See [[feedback-authed-streaming-assets]]. (5) **In-app notifications** — `notification_queue` (jag_core) already had table + GET/PATCH read API but NO producer and NO UI. Added `lib/notifications.ts` `enqueueNotification()` (owner-recipient default via `NOTIFY_OWNER_USER_ID` env, fallback = Robert's jag_core id; RLS insert via `withOwnerRLS(corePool, recipient,...)` which sets app.current_user_id); wired 4 `void`-fire producers: expense submit (tier1), P1/P2 maintenance ticket create (tier1), SLA breach in `/check-sla` (tier1), new enquiry (tier2). Added `GET /notifications/unread-count` + `PATCH /notifications/read-all`. Frontend `NotificationBell` (badge polls 60s + dropdown, mark-read/all) mounted in AppShell sidebar (desktop) + mobile top bar; `api/notifications.ts`; `notifications` i18n namespace both locales. **DEFERRED 5th producer:** document/bank-statement → REVIEW (transition is in external Ollama batch `scripts/ollama-batch/index.ts:864`, direct DB write, no API/HTTP access — needs internal endpoint + batch HTTP client). All deployed via `./deploy.sh` (no migrations). Bell live; endpoints 401-gated; `NOTIFY_OWNER_USER_ID` env optional (fallback works).

- Session 26 cont. (2026-06-24): **Family Registry page** — frontend-only over existing `fam_family_members` CRUD (`routes/family/index.ts`, GET/POST/PATCH, no DELETE). New `pages/Family.tsx` (standalone **Family** nav item after Succession) + `api/family.ts` (list/create/update — no delete to match backend). Card grid (relationship badge, age from DOB, 🛡 emergency-designate, 🔑 platform-access via keycloak_user_id, contact, birthday); summary chips (emergency designate count, birthdays within 30 days); add/edit modal with DOB date-guard (`.slice(0,10)` + regex). `nav.family` + `family` i18n namespace both locales (relationship + language enum labels; plurals use project `_one`/`_other` convention). Deployed frontend-only. **Out of scope:** DELETE (FK RESTRICT from docvault/loyalty/lifestyle); DocVault/loyalty linkage by `family_member_id`; Keycloak provisioning. This clears the last deferred frontend gap-audit item.

- Session 26 cont. (2026-06-24): **DocVault ↔ Family linkage** — turned the Family registry into a document index. Backend was already `family_member_id`-aware (list filter + register + return); added `PATCH /docvault/files/:id` (`routes/docvault/index.ts`) to assign/clear `family_member_id` (+ title/notes/document_type/expires_date) on **existing** docs — `withOwnerRLS`, null clears, 404 RLS-safe, audit_log UPDATE row. Frontend (`pages/DocVault.tsx`): "Belongs to" picker on upload, assign/reassign `<select>` on detail panel, family-member filter in filter bar; shared `useFamilyMembers()` hook (cached `['family-members']`). Frontend (`pages/Family.tsx`): per-card "📄 N" badge (grouped from one `['docvault-files']` fetch) + Documents section in member modal with authenticated `api.download`. i18n: `docvault.belongsTo`/`unassigned`/`filterByMember` + `family.documents`/`noDocuments`/`download` both locales. Deployed (API + frontend). **Out of scope:** same FK linkage for `fam_loyalty_programmes`/`fam_lifestyle_tracker` (identical pattern, follow-up).

- Session 26 cont. (2026-06-24): **Lifestyle ↔ Family linkage** — completed the registry-as-index loop across all 3 personal modules. Backend (`routes/lifestyle/index.ts`): both `fam_loyalty_programmes` + `fam_lifestyle_tracker` were already `family_member_id`-aware (GET filter + POST accept); extended the loyalty PATCH to set `family_member_id` (nullable to clear → reassignable). Tracker is append-only (no PATCH; assign-on-create). Frontend (`pages/Lifestyle.tsx`): "Belongs to" picker on AddProgramme/EditProgramme/AddTracker modals; member filter `<select>` in both LoyaltyTab + TrackerTab; assignee (👤 name) shown on loyalty cards; shared `useFamilyMembers()` hook. `api/lifestyle.ts` `updateProgramme` type gained `family_member_id`. Frontend (`pages/Family.tsx`): per-card "✈ N" loyalty badge; member modal gains Loyalty programmes section (from page `['lifestyle-programmes']` fetch) + Health metrics section (lazy `['lifestyle-tracker', memberId]` fetch, recent 8). i18n: `lifestyle.belongsTo`/`unassigned`/`allMembers` + `family.loyalty`/`healthMetrics` both locales. Deployed (API + frontend). **Resolves open item #12.**

- Session 26 cont. (2026-06-24): **Beneficial-ownership cap table + per-person estate rollup (succession).** Answers "who owns what" across the whole platform — incl. business entities (e.g. BAR+Club registered solely under Zhanghua Chang). **Model (locked w/ Robert):** cap table with % shares; transitive rollup (own an entity → its whole asset base attributes to you). **Migration 017 (jag_family):** `fam_ownership_stakes` (family_member_id soft-ref, subject_kind ENTITY|PROPERTY|ITEM, subject_id = owner_entity_id UUID or cross-DB asset id, subject_label denormalized, ownership_percent NUMERIC CHECK 0-100; owner-scoped RLS; unique(member,kind,subject)). Applied as postgres on VM (owner=postgres so RLS enforces vs jag_app), registered in __migrations, GRANT to jag_app. **Backend** `routes/family/ownership.ts` (mounted 2nd at /api/v1/family): CRUD + `/ownership/subjects` (entities constant 001-013 + properties from propertiesPool + is_asset items from commercialPool per-tenant) + `/ownership/allocation` (Σ% per subject) + `/members/:id/holdings` (rollup: ENTITY via latest `fin_net_worth_snapshots.net_worth_ttd × %`, PROPERTY/ITEM via asset value × %). **Net-worth guard** (`routes/finance/net-worth.ts`): excludes assets with a direct PROPERTY/ITEM stake from their entity's physical/property sum (`AND NOT (id = ANY($1::uuid[]))`) — no double counting, consolidated unchanged. **Frontend** `pages/Ownership.tsx` (nav `/ownership`): By Entity (cap-table editor, Σ% chip green@100%) + By Person (estate rollup per member); `api/ownership.ts`. Family member modal gains an Estate section (lazy holdings). i18n `ownership` namespace + `nav.ownership` + `family.estate` both locales. Deployed (API + frontend + migration 017). **Resolves the cross-module "who owns what" gap.**

- Session 32 (2026-07-05): **Maintenance consolidation.** Properties had two parallel, non-cross-linked maintenance systems: a legacy per-property tab (`prop_maintenance_requests`, `routes/properties/maintenance.ts`) with no WhatsApp/contractor/SLA wiring, and the portfolio-wide tab (`prop_maintenance_tickets`, `routes/properties/maintenance-tickets.ts`) which is the one tied into WhatsApp, contractors, and SLA tracking (P1-P4, `sla-monitor.sh`). Consolidated onto the portfolio system and removed the per-property tab entirely. Migration 035 (jag_properties): `unit_id` on `prop_maintenance_tickets` made nullable (property-level/whole-building tickets have no unit) + category CHECK expanded to include the legacy categories (HVAC/SECURITY/GARDEN/PAINTING/ROOFING) + backfilled the 4 live legacy rows (ticket_ref `MNT-LEGACY-000N`, priority/status/category remapped, estimated cost folded into description text since the new schema has no separate field for it). Migration 036: dropped `prop_vendor_invoices_maintenance_request_id_fkey` (converted to unenforced soft-ref, 0 rows used it) then dropped `prop_maintenance_requests`. Backend: 3 queries (`GET /maintenance`, `GET /maintenance/:id`, `POST /maintenance/check-sla`) changed from `JOIN prop_units` to `LEFT JOIN` (was silently excluding null-unit tickets, including from SLA monitoring) + added `COALESCE(u.unit_number, p.name)` location-label fallback; `CreateTicketSchema.unit_id` made optional with a refine requiring `unit_id` or `property_id`. Frontend: deleted `AddMaintenanceModal`/`UpdateMaintModal` + the whole Maintenance detail-tab from `PropertiesPanel.tsx`; `PropertiesMaintenancePanel.tsx`'s create-ticket form gained a Property picker + conditional Unit picker (replacing a raw hand-typed "Unit ID" UUID text box) and the expanded category list. Deployed via `deploy.sh --no-commit --no-push` (unrelated session-30/31 WIP was in the tree). See [[feedback-deploy-no-commit-with-wip]]. **Follow-up same session:** category list was still the narrow 11-value tenant-ticket set; expanded to a 19-value rental/property taxonomy (migration 037: PLUMBING, ELECTRICAL, HVAC, APPLIANCE, STRUCTURAL, ROOFING, PAINTING, FLOORING, DOORS_WINDOWS, LOCKS_KEYS, PEST, SECURITY, GARDEN, FENCING, DRAINAGE, WASTE_DISPOSAL, SMOKE_DETECTOR, CLEANING, OTHER) — CHECK constraint, Zod `CategoryEnum`, and frontend `CATEGORIES` const all updated together. Deployed.

- Session 32 cont. (2026-07-05): **CRITICAL bug found + fixed: the entire tenancy-lifecycle module was silently 401ing on every request since it was built (session 11).** Discovered while debugging "7 Tenth Street maintenance tickets not showing" — DB/RLS were fine, but `requireAuth()` (`middleware/auth.ts`) only ever populates `req.rlsCtx.userId`; it never sets `req.user`. Yet 12 files across `routes/properties/` (maintenance-tickets, contractors, enquiries, applications, listing, viewings, handover, wa-inbox, wa-approvals, deposits, renewals, rent-schedule, whatsapp-send) — 80 call sites total — read the owner ID via `(req as Request & { user?: {...} }).user?.jag_user_id`, which is always `undefined`, so every one of those routes hit `if (!ownerId) return 401` on every single call. Frontend `useQuery` calls all destructure `data = []` on error with no error surfaced, so this presented as silent empty lists everywhere (maintenance tickets, enquiries, viewings, applications, deposits, rent schedule, WA inbox/approvals, unit listing/photos/AI pricing) rather than a visible auth failure. **Likely explains** why "all leases expired" and "25 units all VACANT" open items never got worked through — the whole workflow was invisible. Fixed via mechanical `sed` replace of all 80 occurrences → `req.rlsCtx.userId`. Typechecked clean, deployed (`--no-commit --no-push`, unrelated WIP in tree). **Action for Robert:** go re-check Enquiries/Viewings/Applications/Deposits/Rent Schedule/Renewals/WA Inbox/WA Approvals/Unit Listing tabs — there may be real data or workflows that were invisible until now. See [[feedback-req-user-vs-rlsctx]]. **Decision (confirmed, don't re-propose):** no tenant-facing login portal — WhatsApp (auto-ticket-creation via keyword classifier on inbound messages matching an active lease's tenant_phone) remains the sole tenant-initiated maintenance-request channel. A real portal (Keycloak tenant role, tenant-scoped routes, ticket status/history UI) would be new work, not something partially built — `report_channel = 'PORTAL'` is just an unused enum value today, no actual portal exists.

- Session 31 (2026-07-01): CRM Call/WhatsApp/Email links now auto-log a `crm_interactions` row (non-blocking, fires alongside the native `tel:`/`wa.me:`/`mailto:` link). HR Payroll had two dormant bugs since the session-30 advances/loans feature shipped — Finalize always 400'd (missing required `pay_date` in request body) and the entries table always rendered empty (frontend hit a non-existent `/entries` sub-route) — both fixed. Finalize dialog now also collects 6 GL account mappings (2 required, cached per entity in localStorage) so payroll actually posts to the ledger. Added a per-employee "Edit pay" override (DRAFT runs only) for actual amounts paid (base salary/overtime/bonus/allowances/deductions/unpaid-leave/status), auto-recalculating statutory deductions on save. Added a Clock In/Clock Out time-clock widget to HR Attendance (backend `clock_in`/`clock_out`/`break_minutes` columns existed but had no UI). Also fixed an app-wide bug: `common.noRecords` i18n key never existed (was nested under `propertiesPanel` instead), so every empty-list state in the app showed the literal key text — added to `common` in both locale files. All changes frontend-only except none (no migrations); see CLAUDE.md OPEN ITEMS for full technical detail — not duplicated here.

## Open Items (as of 2026-06-24 session 26)

1. **Unit listing content** — 25 units all VACANT; photos, description, asking rent, utilities need filling in via Properties → Units → Listing button for each unit
2. **Leases (B3)** — all expired; need monthly rent amounts per unit from Robert
3. **WebAuthn device registration (Brian, Wife)** — each needs in-person browser session at `https://auth.jagcorporate.com/realms/jag/account`
4. **Ollama vision (llava)** — run `ollama pull llava` (~4.7 GB) to enable scanned-PDF extraction
5. **WhatsApp env vars** — WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID not yet set on VM
6. **Google Calendar env vars** — GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_CALENDAR_ID not yet set on VM
7. **Samsung boot receiver** — set Settings → Apps → JAG Mobile → Battery → Unrestricted to restore notification after restart
8. **Money Manager import** — MM Excel export (Date/Account/Category/Subcategory/Note/TTD/Income-Expense columns); reconcile against 54 existing bank statement transactions; build scripts/mm-import/. See [[project-money-manager-import]].
9. **JAG Plantations / JAG Trading** — future Phase 8; placeholder pages exist
10. **Notifications — document/bank-statement REVIEW producer** — deferred (session 26). Needs the Ollama batch (`scripts/ollama-batch/index.ts:864`, direct DB write, no HTTP) to call a new internal notify endpoint after setting REVIEW, OR a cross-DB insert into jag_core.notification_queue. Other 4 producers (expense/ticket/SLA/enquiry) are live.
11. **Notifications — follow-ups** — tier 2/3 scheduled digests (daily 7am / weekly) via `scheduled_for` + dispatcher quiet-hours not wired (all current notifications are immediate IN_APP); replacing dispatcher stub business handlers is the long-term "correct" producer path; jag-mobile notifications separate. Optional: set `NOTIFY_OWNER_USER_ID` in VM `/opt/jag/.env` (fallback constant works without it).
12. ~~**Family ↔ loyalty/lifestyle linkage**~~ — **DONE 2026-06-24 (session 26)**: loyalty + health-metric assignment + member filters + Family-side Loyalty/Health-metrics sections shipped. See session 26 entry above.
13. **Ownership cap table — follow-ups** (base shipped session 26): (a) time-versioned ownership history (`fam_ownership_history` audit table); (b) per-owner liabilities/encumbrances (mortgage attribution by person — rollup is currently asset/net-worth based, no liability split); (c) inline ownership assignment from each module's own edit screen (Properties/IMS) — currently managed centrally on the Ownership page; (d) auto-derive entity ownership from registration docs. Estate rollup needs a fresh net-worth snapshot to value entities (Finance → Net Worth → Take Snapshot) — entities with no snapshot show 0 attributed value until then.

---

## Credentials (production)

- **SSH:** `~/.ssh/jag_oracle2` to `ubuntu@150.136.151.64`
- **Keycloak admin:** SSH tunnel localhost:8080 — `admin` / `JU1BbyB13tWV0MPf3bK89cWZ`
- **jag-api client secret:** `FIjMqEPT35gr3TRvh6FDdCTnMAX2FAGMjTVHuljqcBU`
- **PG superuser:** `postgres` / `PgSuperAdmin2026`
- **jag_app PG user:** `fz4liKWoRn0a81GluZxI9pIHEacrBN5F`
- **MinIO root:** `jag_minio_admin` / `EsvMOHas4ASnWY9f1M9rTV2rQByRsqAz`
- **MinIO jag_app:** access key `aVl4SrRl0YtilT55zCNe` / secret `gjdzq9IH8IZM0MSlazE8szxH67kz2VYtbWavQe29`
- **MinIO audit token:** stored in VM `/opt/jag/.env` as `MINIO_AUDIT_TOKEN`
- **Gemini API key:** stored in VM `/opt/jag/.env` as `GEMINI_API_KEY`; model: `GEMINI_MODEL=gemini-3.5-flash`
- **Robert (Owner):** `robertjohnsonattin@gmail.com` at `https://auth.jagcorporate.com`
