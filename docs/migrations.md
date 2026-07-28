# Migration inventory (all five databases)

> Split out of CLAUDE.md. **Every new migration gets an entry here the moment the file is created — see the registration rule in CLAUDE.md.**

### Phase 7 Migrations (jag_commercial)

| File | Changes |
|---|---|
| `009_ims_suppliers_pos.sql` | ims_suppliers, ims_purchase_orders tables |
| `010_ims_stock_takes.sql` | ims_stock_takes, ims_stock_take_lines |
| `011_ims_depreciation.sql` | ims_depreciation_schedules, ims_depreciation_entries |
| `012_vehicles_owner_service.sql` | owner_entity, last_service_date, next_service_date, service_interval_days on ims_vehicles; location_id nullable on ims_items |
| `013_jabco_crm_client_fk.sql` | FK from jabco tables to crm_contacts for client linkage |
| `014_crm_contact_phone2.sql` | Adds phone2 VARCHAR(50) to crm_contacts |
| `015_vehicles_sim_number.sql` | Adds sim_number column to ims_vehicles |
| `016_pipeline_project_status_enums.sql` | pipeline_stage ADD VALUE SUBMITTED/NO_GO; project_status ADD VALUE AWARDED |
| `017_pipeline_tender_fields.sql` | 7 new columns on crm_sales_pipeline (pipeline_type, bid_deadline, source_url, proposal_document_url, submitted_at, linked_project_id) |
| `018_bid_intelligence_log.sql` | jabco_bid_log append-only table; log_type: NO_GO/LOST_BID/RATE_VARIANCE/POST_MORTEM/WON; idempotency_key UNIQUE; RLS |
| `019_boq_margin_columns.sql` | internal_cost_rate, markup_percent, final_bid_rate, work_package_tag on jabco_boq_items |
| `020_vo_time_extension.sql` | time_extension_days INTEGER on jabco_variation_orders |
| `021_project_tasks.sql` | jabco_project_tasks (MOBILIZATION/POST_MORTEM/GENERAL; OPEN/IN_PROGRESS/DONE); RLS |
| `022_punch_incidents_quality.sql` | jabco_punch_list_items (IDENTIFIED→RECTIFIED→VERIFIED), jabco_site_incidents, jabco_quality_inspections; all RLS |
| `023_project_closeout_fields.sql` | handover_document_url TEXT on jabco_projects |
| `028_crm_interaction_calendar_event_id.sql` | `calendar_event_id TEXT` on `crm_interactions` — stores Google Calendar event ID for follow-up date sync |
| `029_vehicle_calendar_service_log.sql` | `cal_service_event_id`, `cal_insurance_event_id`, `cal_registration_event_id TEXT` on `ims_vehicles` (NOTE: `cal_insurance_event_id` was dropped by migration 037 in session 28); `ims_vehicle_service_log` append-only table; RLS tenant policy |
| `030_vms_vehicle_enhancements.sql` | `status` ENUM (ACTIVE/IN_MAINTENANCE/OFF_ROAD/DISPOSED), `dep_expense_account_code`, `acc_dep_account_code`, `disposal_value` on `ims_vehicles`; RLS tenant policy |
| `031_vms_work_orders_pm.sql` | `vms_work_orders` (wo_number seq, wo_type, status machine, totals); `vms_work_order_items` (PART/LABOUR/CONSUMABLE/SUBLET, line_total computed); `vms_pm_schedules` (DAYS/KM/HOURS intervals, last/next due tracking); all RLS |
| `032_vms_fuel_operating_costs.sql` | `vms_fuel_logs` (litres, price_per_litre, total_cost_ttd, full_tank flag); `vms_operating_costs` (TOLL/PARKING/CLEANING/ACCESSORIES/ADMIN/OTHER); both RLS |
| `033_vms_compliance_docs.sql` | `vms_compliance_docs` (doc_type ENUM, doc_number, expiry_date, file_path for MinIO); RLS |
| `034_vms_disposal_gl.sql` | `dep_expense_gl_account_id`, `acc_dep_gl_account_id` on `ims_depreciation_schedules`; `journal_entry_id` on `ims_depreciation_entries`; `vms_disposals` table (disposal_type, cost/dep/nbv snapshot, sale_price_ttd, gain_loss_ttd, tco_snapshot JSONB, journal_entry_id); UNIQUE(vehicle_id); RLS |
| `035_item_disposal_columns.sql` | `disposed_at TIMESTAMPTZ`, `disposal_type VARCHAR(20)` CHECK IN ('SALE','WRITE_OFF','TRANSFER'), `disposal_notes TEXT`, `sale_price_ttd NUMERIC(15,2)`, `buyer_name VARCHAR(200)`, `disposal_gl_entry_id UUID` added to `ims_items`; ran via psql on VM |
| `036_gps_trackers.sql` | `gps_trackers` registry (device_serial, model, protocol, traccar_device_id, sim_phone, status UNASSIGNED/ASSIGNED/RETIRED, vehicle_id soft-ref ON DELETE SET NULL, last_seen_at); tenant RLS; unique(tenant,device_serial); GRANT jag_app. Backs the GPS/Traccar integration — see "GPS vehicle tracking" rule |
| `037_gps_battery_log.sql` | `gps_battery_log` table (tenant_id, tracker_id FK gps_trackers, traccar_device_id, battery_level SMALLINT 0–100, is_charging BOOL, recorded_at); tenant RLS; GRANT jag_app. Populated hourly by `gps-battery-monitor.sh` cron + `POST /internal/gps/battery-sync` |

### Phase 7 Migrations (jag_family)

| File | Changes |
|---|---|
| `007_expense_receipt_bucket.sql` | MinIO bucket config for expense receipts |
| `008_document_jobs.sql` | ANNUITY added to `fin_investments` investment_type CHECK; `fin_document_jobs` table + RLS policy |
| `009_investment_valuations.sql` | `fin_investment_valuations` append-only table; FK → `fin_investments(id) ON DELETE CASCADE`; indexes on `(investment_id, as_of_date DESC)` and `(owner_id, as_of_date DESC)`; RLS using `NULLIF(current_setting('app.current_owner_id', true), '')::uuid` |
| `010_loan_balance_history.sql` | `fin_loan_balance_history` append-only table; FK → `fin_mortgages_loans(id) ON DELETE CASCADE`; tracks outstanding_balance, interest_rate, monthly_payment; same RLS + index pattern |
| `011_insurance_policy_history.sql` | `fin_insurance_policy_history` append-only table; FK → `fin_insurance_policies(id) ON DELETE CASCADE`; tracks coverage_amount_ttd, premium_amount_ttd, expiry_date; same RLS + index pattern |
| `012_credit_cards_categories.sql` | `fin_credit_cards` table (card_name, last_four, card_type, is_active); `card_id UUID` FK column on `fin_expenses`; expense category CHECK constraint expanded; applied via postgres superuser (jag_app not owner of fin_expenses) |
| `013_debit_card_payment_method.sql` | `ALTER TYPE expense_payment_method ADD VALUE 'DEBIT_CARD'` — enum extension for debit card support |
| `016_insurance_calendar_event_id.sql` | `calendar_event_id TEXT` on `fin_insurance_policies` — stores Google Calendar event ID for expiry date |
| `017_ownership_stakes.sql` | `fam_ownership_stakes` beneficial-ownership cap table (family_member_id, subject_kind ENTITY/PROPERTY/ITEM, subject_id, subject_label, ownership_percent CHECK 0-100); owner RLS; unique(member,kind,subject). Owned by postgres, GRANT to jag_app. Applied via psql on VM, registered in `__migrations` |
| `018_insurance_consolidation.sql` | **Session 28** — `ALTER TYPE insurance_policy_type ADD VALUE` for BUILDING, CONTENTS, FLOOD, FIRE, COMPREHENSIVE, SURETY_BOND, PERFORMANCE_BOND; `sub_type VARCHAR(50)` column added to `fin_insurance_policies`; all 4 RLS policies hardened with `NULLIF(..., '')::uuid`. Ran via `sudo -u postgres psql` (ALTER TYPE cannot run inside transaction). `insured_asset_ref UUID` used as soft cross-DB ref to link policies to properties or vehicles |
| `019_expense_linked_record.sql` | **Session 30** — `linked_record_type/id/label` + `fuel_litres/fuel_odometer_km/fuel_type` added to `fin_expenses`; soft cross-DB refs to VEHICLE/INSURANCE_POLICY/PROPERTY/FAMILY_MEMBER; fuel fields enable auto-sync to `vms_fuel_logs` on expense creation |
| `025_fitness_module.sql` | **Session 48** — new Fitness module: `fam_exercises` (shared library, seeded ~38 exercises), `fam_workout_programs`/`fam_program_workouts`/`fam_program_exercises` (plans), `fam_workout_sessions`/`fam_exercise_logs` (actual logging), `fam_personal_records` (auto-upserted PRs, unique per member+exercise+record_type). Owner RLS on top-level tables; child tables use join-to-parent RLS. See "Fitness module" section below |
| `026_ai_fitness_coach.sql` | **Session 48** — `fam_fitness_profiles` (1:1 per member — goal/fitness level/activity level/body stats/equipment/injuries), `fam_fitness_checkins` (append-only daily readiness log), `fam_workout_programs.ai_generated BOOLEAN` (additive, badges AI-suggested programs on the Programs tab) |
| `027_exercise_variety_and_health_context.sql` | **Session 48** — expanded exercise library 38→80, matched to Robert's actual home gym (cable multi-gym, dumbbells, barbell, bench w/ leg developer, treadmill, upright+recumbent bikes); corrected mislabeled `equipment` values (Lat Pulldown/Seated Row etc. were "Machine", now "Cable Tower"); `fam_fitness_profiles.biological_sex` (MALE/FEMALE/UNSPECIFIED, optional); `fam_exercise_logs.weight_unit` DEFAULT flipped to `'kg'` (was `'lb'` — corrected to metric-throughout per Robert's call) |
| `028_health_tracker_lab_markers.sql` | **Session 48** — `fam_lifestyle_tracker.metric_type` CHECK extended with `CHOLESTEROL_TOTAL`/`CHOLESTEROL_LDL`/`CHOLESTEROL_HDL`/`TRIGLYCERIDES`/`BLOOD_GLUCOSE` — first step toward the Health Tracker becoming a fuller personal health record (Robert's stated direction), with the AI coach already able to read any new metric type without further backend changes (its health-context query has no metric_type allowlist, only a display-label map) |
| `029_medical_records.sql` | **Session 49** — `fam_medical_records` — atomic per-document medical record log (record_type enum, specialty, details JSONB, source_file_name as a local path reference only, status REVIEW/APPROVED/REJECTED); owner RLS |
| `030_medical_profile.sql` | **Session 49** — `fam_medical_profile` — synthesized per-family-member summary (active_diagnoses/current_medications/allergies/care_team JSONB + narrative summary_notes), one row per family member, upserted via PUT; owner RLS |
| `031_medical_records_needs_verification.sql` | **Session 49** — `needs_verification BOOLEAN NOT NULL DEFAULT false` + partial index on `fam_medical_records` — lets a reviewer flag a record for follow-up verification against the original document, independent of REVIEW/APPROVED/REJECTED status |
| `032_lifestyle_tracker_lab_panel.sql` | **Session 49** — `fam_lifestyle_tracker.metric_type` CHECK extended with PSA/ESR/ACE_LEVEL/CREATININE/AST/ALT/WBC/HEMOGLOBIN/HBA1C/BUN/TSH/VITAMIN_B12 — first common lab panel beyond the session-48 cholesterol/glucose set |
| `033_lifestyle_tracker_cbc_full_panel.sql` | **2026-07-27** — extends `metric_type` with the full CBC differential + platelet indices (RBC/HCT/MCV/MCH/MCHC/RDW/PLATELETS/MPV), white-cell breakdown as % and absolute (NEUTROPHILS/LYMPHOCYTES/MONOCYTES/EOSINOPHILS/BASOPHILS), and remaining chemistry (ALKALINE_PHOSPHATASE/SODIUM/POTASSIUM/CHLORIDE/TOTAL_PROTEIN) — 47 metric types total |
| `034_lifestyle_tracker_free_t4.sql` | **2026-07-27** — adds `FREE_T4` — found alongside TSH in an already-captured 2020 thyroid panel that had never been backfilled |
| `035_medical_profile_blood_type.sql` | **2026-07-27** — adds `blood_type TEXT` to `fam_medical_profile` — Robert: "always include the individual's blood group type in the overview to the doctor" |
| `036_clinic_registrations.sql` | **2026-07-27** — `fam_clinic_registrations` (facility_name, department, registration_number, next_appointment_date, calendar_event_id, notes); owner RLS. Backs the new Clinics sub-tab + Google Calendar auto-sync |
| `037_lifestyle_tracker_entry_time.sql` | **2026-07-27** — `fam_lifestyle_tracker.entry_time TIME` (nullable, additive) — time-of-day for readings where it matters (BP varies morning vs evening) |
| `038_lifestyle_tracker_health_connect.sql` | **2026-07-27** — adds `DISTANCE_KM` + `FLOORS_CLIMBED` metric types, plus a **partial** unique index on `(family_member_id, entry_date, metric_type) WHERE source = 'HEALTH_CONNECT'` so the Samsung Health/Health Connect sync upserts one row per day per metric while leaving manual multi-reading-per-day entries unconstrained. See "Samsung Health → Biometrics auto-sync" above |

### Phase 7 Migrations (jag_properties)

| File | Changes |
|---|---|
| `003_insurance.sql` | `prop_insurance` table — **DROPPED by migration 034 (session 28)**; property insurance now in `fin_insurance_policies` with `insured_asset_ref = property.id` |
| `004_property_tax.sql` | prop_property_tax |
| `005_inspections.sql` | prop_inspections |
| `006_lease_deposit_refund.sql` | deposit refund fields on prop_lease_agreements |
| `007_utility_accounts.sql` | prop_utility_accounts |
| `008_late_fee_lease.sql` | late_fee_type/value/grace_days on leases |
| `009b_prop_properties_audit_cols.sql` | last_modified_at, last_modified_by audit columns on prop_properties |
| `009_units.sql` | prop_units table (property sub-unit tracking) |
| `010_mortgage_last_modified.sql` | last_modified_at, last_modified_by on mortgage table |
| `011_rent_payment_proof.sql` | proof_photo_url, proof_uploaded_at, proof_uploaded_by on rent payments; receipt token for shareable links |
| `012_valuation_history.sql` | `prop_valuation_history` append-only table; FK → `prop_properties(id) ON DELETE CASCADE`; tracks valuation_ttd; same RLS + index pattern |
| `013_enquiries.sql` | `prop_enquiries` — prospect enquiry tracking (channel, stage, phone, email) |
| `014_viewings.sql` | `prop_viewings` — scheduled viewings, Google Calendar event ID, status lifecycle |
| `015_applications.sql` | `prop_applications` — tenancy applications with employment/reference/income fields |
| `016_deposits.sql` | `prop_deposits` — security deposits with refund workflow |
| `017_rent_schedule.sql` | `prop_rent_schedule` — generated rent schedule periods, payment recording, reminder tracking |
| `018_handover_checklists.sql` | `prop_handover_checklists` — ENTRY/EXIT checklists with condition items JSONB, meter readings, key issuance |
| `019_maintenance_tickets.sql` | `prop_maintenance_tickets`, `prop_ticket_updates`, `prop_contractors` — P1–P4 tickets, SLA breach flag, update log, contractor directory |
| `020_whatsapp_messages.sql` | `prop_wa_conversations`, `prop_wa_messages` — WhatsApp thread + message store (INBOUND/OUTBOUND) |
| `021_renewal_notices.sql` | `prop_renewal_notices` — lease renewal tracking with D-60/D-30/D-14 notice timestamps |
| `022_unit_enhancements.sql` | `prop_units` additions: `listing_status`, `booking_slug` (unique), rent suggestion columns; `prop_broadcast_contacts` table |
| `023_tenant_phone2.sql` | phone2 on tenants |
| `024_contractor_crm_link.sql` | crm_contact_id FK on prop_contractors |
| `025_maintenance_contractor_assign.sql` | contractor assignment on maintenance tickets |
| `026_wa_pending_approvals.sql` | `prop_wa_pending_approvals` — manual-approve queue for RENT_FORMAL_DEMAND / RENT_LEGAL_NOTICE / DEPOSIT_RECON |
| `027_contact_log.sql` | `prop_contact_log` — call/note log entries in WA inbox timeline |
| `028_rent_schedule_reminder_cols.sql` | reminder tracking columns on rent schedule |
| `029_viewing_1h_reminder_col.sql` | 1h reminder sent flag on prop_viewings |
| `030_unit_stale_alert_col.sql` | stale_alert_sent_at on prop_units for dedup |
| `031_unit_photos.sql` | `listing_description TEXT` on prop_units; `prop_unit_photos` table (owner_id, unit_id FK, object_key, display_order, caption) — MinIO `jag-photos` bucket; RLS |
| `032_inspection_calendar_event_id.sql` | `calendar_event_id TEXT` on `prop_inspections` — stores Google Calendar event ID for inspection_date |
| `034_drop_prop_insurance.sql` | **Session 28** — `DROP TABLE IF EXISTS prop_insurance`; insurance consolidated into `fin_insurance_policies` (jag_family) |
| `043_esignature.sql` | **Session 38** — DocuSeal-era columns (`docuseal_submission_id`, `signature_status`, `signed_pdf_object_key`, `agreement_signed_at`) on `prop_lease_agreements` + `prop_handover_checklists`; DocuSeal itself replaced by Documenso in session 39 (see `044`), these columns left dead/unused |
| `044_documenso_columns.sql` | **Session 39** — adds `documenso_document_id` to `prop_lease_agreements` + `prop_handover_checklists` (additive per STD-13; old `docuseal_submission_id` columns from `043` untouched) |
| `045_enquiry_application_token.sql` | **Session 40** — adds `application_token`/`application_token_expires_at`/`application_submitted_at` to `prop_enquiries`; backs the public `/apply/<token>` Stage-2 rental application form |
| `052_deposit_application_tenant_link.sql` | **Session 44** — adds `application_id` + `tenant_id` (both nullable FK, ON DELETE SET NULL) to `prop_deposits`. Deposits previously only resolved to a tenant via `lease_id -> prop_lease_agreements.tenant_id`, so a deposit taken right after application approval (before any lease existed) neither sent its WhatsApp receipt nor showed under the Tenant record. `tenant_id` is now set immediately when a `lease_id` is given, or backfilled by `create-tenant` (via `application_id`) or by lease creation (see "Tenant record — deposit/lease/application linking" below) |
| `053_application_tenant_link.sql` | **Session 44** — adds `tenant_id` (nullable FK, ON DELETE SET NULL) to `prop_applications`. `create-tenant` only ever read FROM the application to build the tenant row; it never wrote a link back, so the trail from tenant -> originating application dead-ended the moment the tenant existed. Backfilled by `create-tenant` itself now. Ran via `sudo -u postgres psql` (jag_app not owner of `prop_applications`, same as `012_credit_cards_categories.sql`/`fin_expenses`) — migrations are **not** auto-applied on container start; every migration on this project has always been a manual step, confirmed this session after wrongly suspecting otherwise |
| `054_maintenance_ticket_tenant_link.sql` | **Session 44** — adds `tenant_id` (nullable FK, ON DELETE SET NULL) to `prop_maintenance_tickets`. Had a nullable `lease_id` the frontend never actually sends; `tenant_id` resolved from `lease_id` if given, else the unit's active lease, at ticket-creation time. Ran via `sudo -u postgres psql` (same ownership pattern as `053`) |
| `055_handover_tenant_link.sql` | **Session 44** — adds `tenant_id` (nullable FK, ON DELETE SET NULL) to `prop_handover_checklists`. Had an optional `lease_id` (frontend does collect it via a picker) but no general list route existed at all — only `GET /unit/:unitId`. `tenant_id` resolved the same way as `054`; new `GET /properties/handover?tenant_id=` added from scratch. Ran via `sudo -u postgres psql` |
| `056_tenant_document_expiry.sql` | **Backfilled into these docs 2026-07-28** (was missing) — adds `expiry_date DATE` + partial index to `prop_tenant_documents`; drives the expiry badges in the tenant Documents section and the Doc Expiry view |
| `057_scheduled_maintenance.sql` | **2026-07-21** — `prop_scheduled_maintenance` + `prop_scheduled_maintenance_log` — preventive/recurring maintenance scheduler, separate from reactive `prop_maintenance_tickets`. Owner RLS. See "Preventive/scheduled maintenance" row in the route table above for full detail. |
| `058_vendor_invoice_allocations.sql` | **Backfilled 2026-07-28** (was missing) — `prop_vendor_invoice_allocations` (invoice_id, unit_id, amount) with owner RLS; splits one vendor invoice across units. Part of the **vendor invoices** feature (`routes/properties/vendor-invoices.ts`, `prop_vendor_invoices`), which surfaces only inside property detail → Invoices |
| `059_rent_bank_matches.sql` | **Backfilled 2026-07-28** (was missing) — `prop_rent_bank_matches` (rent_schedule_id, bank_txn_id) with owner RLS; backs Reconciliation, matching `prop_rent_schedule` periods to bank transactions. **Note:** matches the *schedule* table, not `prop_rent_payments` — see the rent single-source-of-truth note in `docs/rules/properties.md` |
| `060_vendor_invoice_finance_link.sql` | **Backfilled 2026-07-28** (was missing) — `linked_expense_id UUID` on `prop_vendor_invoices`; bridges a property vendor invoice to a Finance-module expense |
| `061_vendor_invoice_settlement_link.sql` | **Backfilled 2026-07-28** (was missing) — `settlement_journal_entry_id UUID` on `prop_vendor_invoices`; writes back the GL entry raised when the invoice is settled |
| `062_scheduled_maintenance_fields.sql` | **Backfilled 2026-07-28** (was missing) — adds `category`, `priority` (LOW/MED/HIGH), `responsible` (IN_HOUSE/CONTRACTOR/TENANT/OFFICE), `trade`, `est_hours` to `prop_scheduled_maintenance`. **Distinct from** `prop_maintenance_tickets` priority (P1–P4) and from Inventory/VMS PM schedules |
| `063_tenancy_link_backfill.sql` | **2026-07-28 (session 50)** — data-only backfill, no schema change. Sets `tenant_id` on existing `prop_deposits`, `prop_maintenance_tickets` and `prop_handover_checklists` rows left NULL by `052`–`055`, which only ever populated it forward and only via a lease or application. Resolution order: `application_id` → `lease_id` → the unit's most relevant lease (ACTIVE preferred, else most recently started) via a temp `unit_latest_tenant` view. Idempotent — only touches `tenant_id IS NULL`. Unresolvable rows are left NULL and counted in a `RAISE NOTICE`. **`UPDATE … FROM LATERAL (…)` cannot reference the update target in PostgreSQL** (`invalid reference to FROM-clause entry`) — hence the `DISTINCT ON` view; validated against a throwaway `postgres:18` container before deploy. Run via `sudo -u postgres psql` (jag_app does not own `prop_applications`/`prop_maintenance_tickets`, same as `053`/`054`) and hand-register in `__migrations`. **Applied to production 2026-07-28 14:44 UTC, hand-registered.** Result: `UPDATE 0` on all seven statements — the single deposit and the single handover checklist already carried a `tenant_id`, and the 6 NULL maintenance tickets (4 `MNT-LEGACY-*`, 2 stubs) have **no `unit_id` and no `lease_id` at all**, so no resolution path exists for them. They are the documented unlinkable case and must be given a tenant by hand via the ticket form's new picker |
