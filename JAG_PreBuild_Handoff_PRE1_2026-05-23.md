# JAG Platform — Pre-Build Handoff | PRE-1 Session Start
**Date:** May 23, 2026 | **Author:** Robert Johnson-Attin | **Destination:** Claude Code session

---

## LOAD FIRST
Before anything else, read both of these documents in the JAG Holdings folder:
- `JAG_AI_Context_Summary_v2.1.docx` — full platform architecture (sanitised for AI sessions)
- `JAG_Engineering_Standards_v1.1.docx` — 13 non-negotiable standards (STD-01 through STD-13)

---

## CURRENT STATUS: PRE-BUILD PHASE IN PROGRESS

Architecture is finalised at v1.9. All 31 gaps resolved. Pre-Build phase has begun.

### Pre-Build Task Status
| ID | Task | Status |
|----|------|--------|
| PRE-0A | WAL target decision | ✅ LOCKED |
| PRE-0B | Cloudflare Authenticated Origin Pull guide | ✅ DONE — `JAG_PreBuild_PRE0B_v1.0.docx` |
| PRE-1 | ERD/DBML — all 5 databases | ⬅ THIS SESSION |
| PRE-2 | OpenAPI YAML contract | Pending |
| PRE-3 | Deploy outbox table + jag-event-dispatcher | Pending |
| PRE-4 | Configure Keycloak realm + clients + roles | Pending |
| PRE-5 | WiPay sandbox POC | Pending |
| PRE-6 | Bank statement parser POC (Ollama/Mistral 7B) | Pending |
| PRE-7 | Migrate JABCO domain to Cloudflare Free Tier | Pending |
| PRE-8 | Write DR failover runbook | Pending |
| PRE-9 | Oracle Cloud + Docker setup (Phase 0) | Pending |

---

## PRE-0A DECISION LOCKED
**WAL streaming target = Second Oracle Always Free Ampere VM (FREE)**
- Reason: Dell Inspiron failed minimum spec (8GB RAM, 500GB SSD)
- Hetzner/Vultr deferred — not needed
- Oracle Ampere quota (4 OCPU, 24GB RAM) is separate from the production AMD micro VM — untouched
- Migration path: when Robert acquires a local unit meeting spec, swap WAL target from Ampere VM to local machine. One config change, no code rework, ~2 hours.

---

## THIS SESSION: PRE-1 — ERD/DBML FOR ALL FIVE DATABASES

### Task
Design and produce complete ERD/DBML schemas for all five JAG databases. Output should be `.dbml` files (one per database) using standard DBML format, ready for import into dbdiagram.io or similar.

### Five Databases
| Database | Domain | Key Modules |
|----------|--------|-------------|
| `jag_core` | Platform-wide | Users, roles, tenants, audit log, notifications, i18n strings |
| `jag_commercial` | Business ops | IMS (inventory), CRM, JABCO construction PM, DragonBridge |
| `jag_entertainment` | Bar + Members Club | BAR transactions, members, chip float, cash reconciliation |
| `jag_family` | Personal/family | Personal FLEET, JAG Lifestyle, succession, DocVault |
| `jag_properties` | Property | Property records, pipeline, acquisition analysis, JAG Properties |

### Non-Negotiable Schema Requirements (from architecture v1.9)
1. **`pending_events` outbox table in EVERY database** — this is how cross-DB events are delivered via `jag-event-dispatcher`. Schema: `id (uuid PK), aggregate_type, aggregate_id, event_type, payload (jsonb), created_at, processed_at (nullable), retry_count, last_error (nullable)`
2. **Row-Level Security (RLS)** — every table that holds tenant/user data needs `tenant_id` or `owner_id` column for RLS enforcement
3. **`idempotency_key`** on all financial transaction tables
4. **`last_modified_at`** on all tables that sync offline (IMS, JABCO, BAR)
5. **`entity_tag`** on all BAR/Members Club transactions (mandatory — separates P&L per entity)
6. **STD-13 (Expand-and-Contract)** — all schema changes must be additive; no destructive migrations
7. **node-pg-migrate** is the migration tooling for all five databases

### Cross-DB Query Rule
Cross-database queries are only permitted via `postgres_fdw` and only from `jag_core` (the JAG Holdings unified view). No direct cross-DB joins from application code.

### Key Domain Details to Capture
**jag_core:** users, roles (Owner, Domain Admin, Operator, Viewer, External Advisor, Auditor — see role matrix in Context Summary), tenants, sessions, audit_log, notification_queue, i18n_translations

**jag_commercial / IMS:** locations (Barataria home, Fyzabad home, JABCO office), items, categories, tags, photos, barcodes, JABCO tool crib, personal FLEET (vehicles), JABCO FLEET. BOQ tables, variation_orders, progress_claims, subcontractor_retention, site_diary (JABCO construction PM)

**jag_commercial / CRM:** contacts, companies, interactions, sales_pipeline (JABCO), loyalty (JAG Lifestyle integration point)

**jag_entertainment:** bar_sessions, bar_transactions, member_registry, chip_float_open_close, cash_reconciliation, license_renewal_alerts. Every transaction row must carry `entity_tag` (BAR | MEMBERS_CLUB).

**jag_family:** vehicles (personal FLEET), lifestyle_tracker (health/fitness metrics), succession_documents, docvault_files, family_members (Father DOB 1940-02-16, Wife DOB 1974-12-22, Daughter DOB 2012-07-18, Brother Brian)

**jag_properties:** properties (Barataria, Fyzabad + others), tenants (rental), lease_agreements, maintenance_requests, property_pipeline (acquisition analysis), mortgage_register

### Language/i18n
All user-facing string keys go in `jag_core.i18n_translations`. Three languages from day one: `en`, `zh` (Mandarin), `es` (Spanish — content populated Phase 3 for DragonBridge, Phase 6 full platform). Keys follow pattern: `module.semantic_id` e.g. `finance.bir_threshold_alert`.

---

## ENGINEERING STANDARDS REMINDER (critical ones for schema work)
- **STD-01:** Every table gets `id uuid DEFAULT gen_random_uuid() PRIMARY KEY`
- **STD-02:** `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()` on every table
- **STD-05:** RLS enabled on all tenant-scoped tables — `ALTER TABLE x ENABLE ROW LEVEL SECURITY`
- **STD-09:** All migrations via node-pg-migrate, forward-only, never destructive
- **STD-13:** Expand-and-Contract pattern for all schema changes

Full standards in `JAG_Engineering_Standards_v1.1.docx`.

---

## OUTPUT EXPECTED FROM PRE-1 SESSION
- `jag_core.dbml`
- `jag_commercial.dbml`
- `jag_entertainment.dbml`
- `jag_family.dbml`
- `jag_properties.dbml`
- Brief note on any design decisions made (foreign key strategy across DBs, any gaps found)

Save all files to the JAG Holdings folder.
