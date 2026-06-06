# JAG Platform — Pre-Build Handoff | PRE-2 Session Start
**Date:** May 23, 2026 | **Author:** Robert Johnson-Attin | **Destination:** Claude Code session

---

## LOAD FIRST
Before anything else, read both of these documents in the JAG Holdings folder:
- `JAG_AI_Context_Summary_v2.1.docx` — full platform architecture (sanitised for AI sessions)
- `JAG_Engineering_Standards_v1.1.docx` — 13 non-negotiable standards (STD-01 through STD-13)

---

## CURRENT STATUS: PRE-BUILD PHASE IN PROGRESS

Architecture is finalised at v1.9. All 31 gaps resolved. Pre-Build phase is underway.

### Pre-Build Task Status
| ID | Task | Status |
|----|------|--------|
| PRE-0A | WAL target decision | ✅ LOCKED |
| PRE-0B | Cloudflare Authenticated Origin Pull guide | ✅ DONE — `JAG_PreBuild_PRE0B_v1.0.docx` |
| PRE-1 | ERD/DBML — all 5 databases | ✅ DONE — 5 `.dbml` files in JAG Holdings folder |
| PRE-2 | OpenAPI YAML contract | ⬅ THIS SESSION |
| PRE-3 | Deploy outbox table + jag-event-dispatcher | Pending |
| PRE-4 | Configure Keycloak realm + clients + roles | Pending |
| PRE-5 | WiPay sandbox POC | Pending |
| PRE-6 | Bank statement parser POC (Ollama/Mistral 7B) | Pending |
| PRE-7 | Migrate JABCO domain to Cloudflare Free Tier | Pending |
| PRE-8 | Write DR failover runbook | Pending |
| PRE-9 | Oracle Cloud + Docker setup (Phase 0) | Pending |

---

## PRE-1 COMPLETED — WHAT WAS BUILT

Five DBML schema files are saved in the JAG Holdings folder. **Read all five before writing any code or API contracts in this session.** They are the authoritative schema for PRE-2.

| File | Contents |
|------|----------|
| `jag_core.dbml` | pending_events, tenants, users, roles, user_tenant_roles, sessions, audit_log, notification_queue, i18n_translations, external_advisor_grants |
| `jag_commercial.dbml` | pending_events + 9 IMS tables (locations, categories, tags, items, vehicles, item_tags, barcodes, photos, stock_movements) + 8 JABCO PM tables (projects, boq_items, variation_orders, progress_claims, payment_certificates, subcontractor_retention, site_diary, project_gantt) + 4 CRM tables (companies, contacts, interactions, sales_pipeline) |
| `jag_entertainment.dbml` | pending_events, ent_bar_sessions, ent_bar_transactions, ent_members_registry, ent_member_visits, ent_chip_float_sessions, ent_cash_reconciliation, ent_license_renewals |
| `jag_family.dbml` | pending_events, fam_family_members, fam_personal_vehicles, fam_vehicle_maintenance, fam_lifestyle_tracker, fam_loyalty_programmes, fam_loyalty_transactions, fam_succession_documents, fam_docvault_files |
| `jag_properties.dbml` | pending_events, prop_properties, prop_property_tenants, prop_lease_agreements, prop_rent_payments, prop_maintenance_requests, prop_property_pipeline, prop_mortgage_register |

### Key Design Decisions from PRE-1 (carry these forward)

1. **Cross-DB FK strategy** — No DB-level FK constraints across databases. All cross-DB references are logical UUID columns with notes. `postgres_fdw` in `jag_core` is the only permitted cross-DB query path.

2. **Personal FLEET split** — `jag_commercial.ims_vehicles` (extends `ims_items`) is the canonical asset-tracking record for ALL vehicles (JABCO + personal). `jag_family.fam_personal_vehicles` is the family-admin view (insurance, registration, family assignment). Linked via logical `ims_item_id` cross-reference.

3. **RLS column** — `tenant_id` on `jag_core`, `jag_commercial`, `jag_entertainment`. `owner_id` on `jag_family`, `jag_properties`.

4. **`entity_tag`** — Typed enum (`BAR | MEMBERS_CLUB`) on every `jag_entertainment` transaction table. Non-negotiable. Every row must carry it.

5. **`audit_log` is append-only** — No `updated_at`. No UPDATE or DELETE by application DB role.

6. **`prop_property_tenants`** — "Property tenants" = rental tenants (people who pay rent). Distinct from `jag_core.tenants` (JAG business entities). Documented in DBML notes.

7. **Mortgage OPSEC** — `account_reference` only (partial). No full account numbers stored anywhere in the system.

8. **DragonBridge** — No dedicated tables yet. Uses `crm_companies` + `crm_sales_pipeline` via `tenant_id`. Sub-architecture session required before Phase 3.

9. **Gap flagged for PRE-2** — A `pending_review_queue` table may be needed (in `jag_core` or `jag_properties`) for failed/disputed WiPay webhook events. Raise during API contract design.

---

## THIS SESSION: PRE-2 — OpenAPI YAML CONTRACT

### Task
Design and produce a complete OpenAPI 3.1.0 YAML contract for the JAG platform API. Output should be a single file `jag_api_contract_v1.yaml` saved to the JAG Holdings folder, ready for import into Swagger UI, Stoplight, or similar tooling.

### Architecture Context for API Design

- **Base URL (production):** `https://api.jabco.tt/api/v1` (JABCO domain used during Pre-Build/Phase 0; JAG Holdings domain registered before Phase 2)
- **Base URL (development):** `http://localhost:3000/api/v1`
- **Auth:** Keycloak bearer JWT. All endpoints require `Authorization: Bearer <token>` except `/health`. No custom auth endpoints — Keycloak handles token issuance.
- **Versioning:** All endpoints at `/api/v1/` from day one (STD-05). Breaking changes → `/api/v2/`.
- **Error envelope (STD-06):** All responses use `{ success, data, error, code }`. Never raw stack traces.
- **Idempotency (STD-11):** All financial write endpoints require `Idempotency-Key: <uuid>` header. Duplicate key = return first result, no re-execution.
- **Pagination:** Standard `?page=&limit=&sort=&order=` on all list endpoints. Response includes `meta: { total, page, limit, pages }`.

### API Modules to Cover (7 tags)

| Tag | Path Prefix | Source DB |
|-----|-------------|-----------|
| Core | `/core/` | jag_core |
| IMS | `/ims/` | jag_commercial |
| JABCO | `/jabco/` | jag_commercial |
| CRM | `/crm/` | jag_commercial |
| Entertainment | `/entertainment/` | jag_entertainment |
| Family | `/family/` | jag_family |
| Properties | `/properties/` | jag_properties |
| Webhooks | `/webhooks/` | — |
| Health | — | — |

### Key Endpoints Required

**Health & System:**
- `GET /health`

**Core:**
- `GET POST /core/users`, `GET PUT DELETE /core/users/{id}`
- `GET POST /core/tenants`, `GET PUT /core/tenants/{id}`
- `GET POST /core/users/{id}/role-grants`, `DELETE /core/users/{id}/role-grants/{grantId}`
- `GET /core/notifications`, `PUT /core/notifications/{id}/read`, `POST /core/notifications/mark-all-read`
- `GET /core/i18n/{locale}`
- `GET /core/audit-log`

**IMS:**
- `GET POST /ims/locations`, `GET PUT /ims/locations/{id}`
- `GET POST /ims/categories`
- `GET POST /ims/items`, `GET PUT /ims/items/{id}`
- `POST /ims/items/{id}/photos`, `GET POST /ims/items/{id}/barcodes`
- `GET POST /ims/movements`
- `GET POST /ims/vehicles`, `GET PUT /ims/vehicles/{id}`

**JABCO:**
- `GET POST /jabco/projects`, `GET PUT /jabco/projects/{id}`
- `GET POST /jabco/projects/{id}/boq`, `PUT /jabco/projects/{id}/boq/{itemId}`
- `GET POST /jabco/projects/{id}/variation-orders`, `PUT .../variation-orders/{voId}`
- `GET POST /jabco/projects/{id}/progress-claims`, `PUT .../progress-claims/{claimId}`
- `POST /jabco/projects/{id}/progress-claims/{claimId}/payment-certificates`
- `GET POST /jabco/projects/{id}/subcontractor-retention`
- `GET POST /jabco/projects/{id}/site-diary`, `PUT .../site-diary/{entryId}`
- `GET POST /jabco/projects/{id}/gantt`

**CRM:**
- `GET POST /crm/companies`, `GET PUT DELETE /crm/companies/{id}`
- `GET POST /crm/contacts`, `GET PUT DELETE /crm/contacts/{id}`
- `GET POST /crm/contacts/{id}/interactions`
- `GET POST /crm/pipeline`, `GET PUT /crm/pipeline/{id}`

**Entertainment:**
- `GET POST /entertainment/bar/sessions`, `PUT /entertainment/bar/sessions/{id}/close`
- `GET POST /entertainment/bar/sessions/{id}/transactions`
- `GET POST /entertainment/members`, `GET PUT /entertainment/members/{id}`
- `POST /entertainment/members/{id}/visits`
- `GET POST /entertainment/chip-float/sessions`, `PUT .../chip-float/sessions/{id}/close`
- `POST /entertainment/cash-reconciliation`
- `GET PUT /entertainment/licenses/{id}`

**Family:**
- `GET /family/members`, `GET PUT /family/members/{id}`
- `GET POST /family/vehicles`, `GET PUT /family/vehicles/{id}`
- `GET POST /family/vehicles/{id}/maintenance`
- `GET POST /family/lifestyle`
- `GET POST /family/loyalty`, `GET PUT /family/loyalty/{id}`
- `POST /family/loyalty/{id}/transactions`
- `GET POST /family/succession`, `GET PUT /family/succession/{id}`
- `GET POST /family/docvault`, `GET /family/docvault/{id}`

**Properties:**
- `GET POST /properties`, `GET PUT /properties/{id}`
- `GET POST /properties/tenants`, `GET PUT /properties/tenants/{id}`
- `GET POST /properties/leases`, `GET PUT /properties/leases/{id}`
- `GET POST /properties/leases/{id}/payments`
- `GET POST /properties/maintenance`, `GET PUT /properties/maintenance/{id}`
- `GET POST /properties/pipeline`, `GET PUT /properties/pipeline/{id}`
- `GET POST /properties/mortgages`, `GET PUT /properties/mortgages/{id}`

**Webhooks:**
- `POST /webhooks/wipay` — WiPay payment notification. Validate HMAC signature. Idempotency-Key required. Pending Verification fallback if validation fails.

### Non-Negotiable Schema Requirements for the YAML

1. **Standard envelope** — All responses use the `ApiResponse` wrapper schema:
   - Success: `{ success: true, data: <schema>, meta?: <PaginationMeta> }`
   - Error: `{ success: false, data: null, error: string, code: string }`
2. **`Idempotency-Key` header** — Required on all POST/PUT endpoints that touch financial data (payments, transactions, claims, certificates, retention releases, mortgages). Define as a reusable header component.
3. **HTTP status codes** — 200 (ok), 201 (created), 400 (validation error), 401 (unauthenticated), 403 (unauthorised/wrong tenant), 404 (not found), 409 (idempotency conflict), 422 (business rule violation), 500 (internal).
4. **`entity_tag`** — All entertainment transaction request/response schemas must include `entity_tag: enum [BAR, MEMBERS_CLUB]` as a required field.
5. **WiPay webhook** — Include `wipay_reference` and document the HMAC signature validation header `X-WiPay-Signature`.

### Output Expected from PRE-2 Session
- `jag_api_contract_v1.yaml` — Complete OpenAPI 3.1.0 spec saved to JAG Holdings folder
- Brief note on any gaps or design decisions made

---

## ENGINEERING STANDARDS REMINDER (critical ones for API contract work)

- **STD-01:** Modules communicate via JAG Holdings API only — never cross-DB direct writes
- **STD-05:** All endpoints at `/api/v1/` — no unversioned paths
- **STD-06:** `{ success, data, error, code }` on every response — no raw errors
- **STD-10:** All inputs validated with Zod server-side — document validation rules in the YAML
- **STD-11:** Idempotency keys on all financial endpoints — `Idempotency-Key` header

Full standards in `JAG_Engineering_Standards_v1.1.docx`.

---

## CONTEXT: PRE-0A DECISION (WAL target)
**WAL streaming target = Second Oracle Always Free Ampere VM (FREE)**
- Dell Inspiron failed minimum spec (8GB RAM, 500GB SSD)
- Oracle Ampere quota (4 OCPU, 24GB RAM) is separate from the production AMD micro VM
- Migration path: when Robert acquires a local unit meeting spec, swap WAL target. One config change, ~2 hours.
