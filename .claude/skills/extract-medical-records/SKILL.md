---
name: extract-medical-records
description: End-to-end workflow for reading a folder of a family member's medical documents (PDFs/scans/photos) and turning them into structured JAG Medical Records data — records, biometric trend metrics, a synthesized profile, and clinic registrations. Use when the user points at a folder of medical documents/scans and wants them digested into the JAG platform, or asks to process/extract/review someone's medical records or "digest their medical history."
---

# Extract medical records into JAG Medical Records

Full workflow developed processing Phillip Ajack Johnson-Attin's medical folder (session 49, 2026-07-26/27) — ~50 source documents (chronology PDFs, clinic cards, lab reports, prescriptions, X-ray/ultrasound photos) turned into 72 structured records, 122 biometric trend entries across 47 metric types, a synthesized clinical-overview profile, and 9 clinic registrations. See [[project_medical_records_module]] and [[feedback_pdf_extraction_at_scale]] in memory for the full incident history behind the rules below — several were learned the hard way after gaps were caught by the user.

**No local-model or automated pipeline exists for this.** This is a one-time-per-folder manual process: Claude reads every source document directly (same vision capability as this chat) and writes structured extractions via direct SQL. Source documents **never leave the local machine** — nothing gets uploaded to MinIO or anywhere else. Only extracted structured data goes into JAG. See [[feedback_medical_extraction_approach]] for why (tested worse on local vision models than Claude's own vision, and this isn't a recurring job that would justify building pipeline infrastructure).

## Step 0 — Standing rule: full discovery before starting

**Do this proactively, every time — not as a reactive fix after something looks incomplete:**

[clinical detail purged from history 2026-07-27 - see docs/rules/health-medical.md]
2. Read every page of every document — never rely on a first-page skim or an extraction tool's page cap as a shortcut.
3. Before declaring the batch done, diff the full recursive file list against `SELECT DISTINCT source_file_name FROM fam_medical_records WHERE family_member_id = '<id>'` on the VM. Anything in the folder listing with no matching `source_file_name` substring was never opened.

This generalizes to any future folder-of-documents task on this platform, not just medical records.

## Step 1 — Identify the family member

Confirm the exact person (voice-to-text garbles names) and get their `fam_family_members.id`:

```bash
ssh -i ~/.ssh/jag_oracle2 ubuntu@150.136.151.64 "sudo -u postgres psql -d jag_family -c \"SELECT id, first_name, last_name, date_of_birth FROM fam_family_members WHERE last_name ILIKE '%<surname>%';\""
```

Also get Robert's `owner_id` (`jag_core users.id`, `95ca3f77-60ba-4a0f-af70-2832b247b525` as of this writing — confirm in CLAUDE.md's USER ACCOUNTS section, don't hardcode blindly) — every insert needs both IDs.

## Step 2 — Read every document

PDF/image handling notes (full detail in [[feedback_pdf_extraction_at_scale]]):

- The `Read` tool has a **20MB size cap**; full (no-`pages`) reads work up to that cap, but the `pages` param frequently errors with "pdftoppm is not installed" on this machine.
- For anything over 20MB: `pip install pypdf`, check `PdfReader(path).pages[i].extract_text()` first — if real text comes back, pull all pages as plain text in one pass (far cheaper than image reads). If genuinely image-only, split into one-page-per-file PDFs with `PdfWriter` and `Read` each individually.
- **Blank/garbled extracted text does NOT mean the page is blank.** It means that specific page has no OCR text layer (a scanned photo/form mixed into an otherwise-text PDF). Split and visually review every such page as an image — don't skip it.
- **Reading is not the same as recording.** On a long document, it's easy to mentally note a finding while skimming and never actually write the SQL for it. Do a final page-by-page reconciliation pass (re-read + confirm a corresponding DB row exists) before declaring a file done, not just a first read-through.
- Photograph-only images (ultrasound/X-ray film photos, prescription slips) — read them individually with the `Read` tool same as any other image.

## Step 3 — Write structured records (`fam_medical_records`)

No live API token is normally available in-session, so records are inserted directly:

```bash
cat file.sql | ssh -i ~/.ssh/jag_oracle2 -o ConnectTimeout=10 ubuntu@150.136.151.64 "sudo -u postgres psql -d jag_family"
```

**Schema reference** (`fam_medical_records`, migration 029 + 031):
- `record_type`: `LAB_RESULT | IMAGING | PRESCRIPTION | CLINIC_CARD | REFERRAL | DISCHARGE_SUMMARY | VISIT_NOTE | IMMUNIZATION | DEVICE_EQUIPMENT | INVOICE | CHRONOLOGY_SUMMARY | OTHER`
- `specialty`: free text matching the source folder structure (Back/Eye/Heart/Rheumatology/Urology/etc.)
- `details JSONB`: type-specific fields, transcribed as close to the source as possible (keep the original field names/units visible — don't silently normalize a value without also keeping a note of the original)
- `details.lifestyle_metrics` (optional array): `[{metric_type, value, unit, entry_date}]` — see Step 4, this is what feeds Biometrics
- `status`: always `'REVIEW'` for extracted records (never `'APPROVED'` — that's a human sign-off step in the app, done via the Medical Records → Records tab Approve button, or the ✎ Edit form if a correction is needed first)
- `needs_verification BOOLEAN` (migration 031): set `true` on anything transcribed with genuine uncertainty (poor scan quality, ambiguous handwriting, conflicting dates) — don't silently guess and assert as fact
- `source_file_name`: the local filename/relative path — **never** an uploaded object reference

**SQL apostrophe gotcha**: double every literal apostrophe in a string (`doctor''s`, `form''s`) — a single stray `'` breaks the whole batch. Grep before running: `grep -noE "[a-zA-Z]'[a-zA-Z]" file.sql` and check every match is either intentional (properly doubled) or inside a `-- comment` (harmless).

**Not every document is a result.** Order/request forms (blood test requests, imaging requests) with no actual values get `record_type = 'OTHER'` and an explicit `"note": "Order form only, no results in this file"` — don't misclassify as `LAB_RESULT`.

**Watch for duplicate scans** of the same physical card under different filenames — consolidate into one record. Check afterward: `SELECT record_date, title, count(*) FROM fam_medical_records WHERE family_member_id = '<id>' GROUP BY record_date, title HAVING count(*) > 1;`

**Don't clinically interpret raw imaging films** (X-rays/ultrasound photos) yourself when there's no accompanying written radiology report — catalog them (date, body region, patient ID) and say so explicitly.

## Step 4 — Push numeric values to Biometrics (`fam_lifestyle_tracker`)

Any repeatable numeric lab/vitals value goes in `details.lifestyle_metrics` on the record AND gets inserted directly into `fam_lifestyle_tracker` (in normal app operation, the `/approve` endpoint does this automatically on `LifestyleMetricSchema`-matching entries — since inserts here bypass that endpoint, insert into both places yourself).

**Current metric type coverage is comprehensive (47 types as of migration 034)** — vitals (weight/BP/resting HR/sleep/etc.), lipids, glucose/HbA1c, PSA/ESR/ACE/TSH/Free T4, full CBC differential (RBC/HCT/MCV/MCH/MCHC/RDW/platelets/MPV, neutrophil/lymphocyte/monocyte/eosinophil/basophil as both % and absolute), and remaining chemistry (creatinine/BUN/AST/ALT/alkaline phosphatase/sodium/potassium/chloride/total protein). Check the current list before assuming something is missing:

```bash
grep -o "MetricEnum = z.enum(\[[^]]*\])" jag-api/src/routes/lifestyle/medical-records.ts
```

If a genuinely new value type turns up (find gaps with `SELECT jsonb_object_keys(details) FROM fam_medical_records WHERE record_type='LAB_RESULT' GROUP BY 1` diffed against the enum — don't guess at what a "standard panel" contains), add it: extend the CHECK constraint in a new migration (`jag_family`, `DROP CONSTRAINT IF EXISTS fam_lifestyle_tracker_metric_type_check` then re-`ADD CONSTRAINT` with the full list), then update `MetricEnum` in **both** `routes/lifestyle/medical-records.ts` **and** `routes/lifestyle/index.ts` (they're separate copies that must match), then the frontend `MetricType` union in `api/lifestyle.ts` plus `METRIC_LABELS`/`METRIC_ICONS`/`METRIC_DEFAULT_UNIT` in `pages/Lifestyle.tsx`. Build both `jag-api` and `jag-web`, then deploy (`./deploy.sh --no-commit --no-push --skip-zap` for a data-population session, no need to commit/push mid-session).

**Unit consistency is not enforced by the schema** — the CHECK constraint validates the metric type, not a sane value range or unit. If a source report uses a different unit convention than every other entry for that metric (e.g. one lab reports MCHC/haemoglobin in g/L while every other panel on file uses g/dL), **convert before inserting**, and note the conversion in the row's `notes` field — otherwise it silently creates a 10x-off outlier in the trend chart with no error anywhere.

**Check for accidental duplicates after each SQL batch**, especially if you're running multiple correction passes in one session: `SELECT entry_date, metric_type, count(*) FROM fam_lifestyle_tracker WHERE family_member_id='<id>' GROUP BY 1,2 HAVING count(*) > 1;` — dedupe with a self-join delete keeping the lowest `id` if any turn up.

## Step 5 — Clinic registrations (`fam_clinic_registrations`)

While reading through clinic cards, collect facility name + registration number + department for each distinct clinic enrollment (migration 036 table). Registration numbers are often shared hospital-wide across departments (e.g. one number covers Rheumatology, Urology, Spine, Eye at the same hospital) — don't assume a separate number per department without evidence.

**Be honest about "next appointment."** Every appointment date on a physical clinic card is a **historical log entry** (the last known visit), not a scheduled future one. Do not populate `next_appointment_date` from historical data — leave it null and tell the user there's no real upcoming-appointment data captured, so they know to enter one when an actual appointment is scheduled (the app's Sync-to-Calendar button then pushes it to Google Calendar).

## Step 6 — Synthesize the profile (`fam_medical_profile`)

This is a **narrative synthesis Claude writes by reading across the approved/extracted records** — never mechanically auto-computed by SQL, the underlying data is too heterogeneous. Fields: `active_diagnoses`/`current_medications`/`allergies`/`care_team` (JSONB arrays) + `blood_type` (migration 035 — **always include this**, pull it from a Blood Group & Rh Typing record if one exists) + `summary_notes` (narrative text).

[clinical detail purged from history 2026-07-27 - see docs/rules/health-medical.md]

Keep `summary_notes` as a clean clinical narrative for a reader (including a doctor, via the Print-for-Doctor view) — don't let session/extraction process commentary ("found on page 47 during re-review...") leak into the narrative itself; that provenance detail belongs in the individual record's `notes` field, not the profile summary.

`last_synthesized_at` makes staleness visible. Re-synthesizing after new records are approved or corrected is a manual step — ask Claude to do it, it doesn't happen automatically.

## Step 7 — Final verification pass

1. Confirm total counts: `SELECT count(*) FROM fam_medical_records WHERE family_member_id='<id>';` and `SELECT count(*) FROM fam_lifestyle_tracker WHERE family_member_id='<id>';`
2. Run the folder-vs-database diff from Step 0.3 one more time.
3. Check for duplicate records and duplicate tracker rows (queries above).
4. Tell the user plainly what's flagged `needs_verification=true` and why — don't bury it in a wall of text; they need to actually go check those against the original documents (via the app's Edit form, which can also correct the value directly).
5. Point them at the **Print for Doctor** views (Profile summary + Biometrics trend tables, both under Lifestyle → Medical Records) if they mention wanting to share the data with a practitioner.
