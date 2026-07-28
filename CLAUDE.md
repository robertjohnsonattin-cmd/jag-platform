# JAG Integrated Business Platform — Claude Session Context

**Owner:** Robert Johnson-Attin | Barataria, Trinidad & Tobago
**Architecture:** v1.9 | **Current Phase:** ALL PHASES COMPLETE — in production | **Updated:** 2026-07-27 (session 49)

---

## DOCUMENTATION MAP — READ THE RIGHT FILE BEFORE ANSWERING

This file is the **index**. It holds what is true *now* and what you must never get wrong.
Detail lives in `docs/` and is **read on demand** — that keeps every session's starting
context small. Splitting happened 2026-07-27; nothing was deleted, only moved.

| If you are about to… | Read first |
|---|---|
| Answer "does feature X exist / how does X work" | **`docs/route-map.md`** (routes + UI), then grep the code |
| Add or look up a migration | **`docs/migrations.md`** (all five DBs) |
| Write a query, migration, or RLS policy | `docs/rules/db-rls.md` |
| Deploy, add an env var, or touch a container | `docs/rules/deploy-infra.md` |
| Touch uploads, presigned URLs, or streamed assets | `docs/rules/storage-minio.md` |
| Touch investments, insurance, net worth, doc extraction | `docs/rules/finance.md` |
| Touch leases, tenants, receipts, the tenancy chain | `docs/rules/properties.md` |
| Build any React component | `docs/rules/frontend.md` |
| Write a new API route | `docs/rules/api-conventions.md` |
| Touch GPS / trackers / VMS | `docs/rules/vehicles-gps.md` |
| Touch Lifestyle, Biometrics, medical records, AI coach | `docs/rules/health-medical.md` |
| Work on the Android app | `docs/mobile-app.md` |
| Add or debug a cron job / local script | `docs/ops-scripts.md` |
| Add or change UI strings | `docs/i18n.md` |
| Find out how something came to be, or if a bug was already fixed | `docs/CHANGELOG.md` |

**These are not optional reads.** A denial ("no such feature") or a design decision made
without opening the relevant file above is exactly how this project has repeatedly shipped
duplicate or broken work. When in doubt, read the file — it costs one tool call.

---

## PLATFORM STATUS

| Phase | Scope | Status |
|---|---|---|
| 0–5 | Infrastructure, all backend modules, security hardening | **COMPLETE** |
| 6 | Oracle Cloud production deployment, HTTPS auth | **COMPLETE** |
| 7 | React frontend (`jag-web/`) | **COMPLETE** |

**Production endpoints:**
- API: `https://api.jagcorporate.com/health/ready` → `{"status":"ready"}`
- Auth: `https://auth.jagcorporate.com`
- VM SSH: `ssh -i ~/.ssh/jag_oracle2 ubuntu@150.136.151.64`

---

---

## THREE GOLDEN RULES

1. **Enter Once** — no data entered twice across any module
2. **Same Language** — all inter-module communication uses the same data structures and APIs
3. **You Own Everything** — self-hosted, no vendor lock-in, no SaaS dependency

---

---

## TECH STACK (ALL LOCKED)

| Component | Choice |
|---|---|
| Database | PostgreSQL 18, five logical DBs, RLS + pgcrypto |
| Backend | Node.js / TypeScript strict mode |
| Containers | Docker + Docker Compose |
| Web server | Caddy + Let's Encrypt + Cloudflare DNS-01 wildcard certs |
| Auth | Keycloak 26.x (self-hosted), realm: `jag`, client: `jag-api` |
| Object storage | MinIO (self-hosted) |
| Frontend | React 18 + TypeScript + Vite + TailwindCSS + React Query + Keycloak JS adapter + react-i18next (en / zh-CN) + Recharts (charts, added session 48) |
| AI | Ollama on main Windows workstation (NOT Dell Inspiron) |
| Observability | Loki + Grafana, 14-day retention, structured JSON logs |
| Migrations | node-pg-migrate on all five databases |

**Five logical databases:** `jag_core` / `jag_commercial` / `jag_entertainment` / `jag_family` / `jag_properties`

---

---

## ENGINEERING STANDARDS — APPLY TO ALL CODE (STD-01 through STD-13)

All are **HARD RULES** unless marked ARCHITECTURE. Violations are build defects, not style preferences.

| ID | Rule | Severity |
|---|---|---|
| STD-01 | **Module Isolation** — modules communicate via JAG Holdings API only; never write directly to another module's DB tables | HARD RULE |
| STD-02 | **RLS First** — tenant isolation enforced at PostgreSQL layer; app-layer filtering is second line of defence | HARD RULE |
| STD-03 | **Test First** — write a failing isolation/security test before coding any data-access feature | HARD RULE |
| STD-04 | **Migration First** — every schema change is a versioned node-pg-migrate file; never run raw SQL on production | HARD RULE |
| STD-05 | **API Versioning** — all endpoints at `/api/v1/`; breaking changes require `/api/v2/` | ARCHITECTURE |
| STD-06 | **Error Envelope** — all API responses: `{ success, data, error, code }`; no raw stack traces to clients | ARCHITECTURE |
| STD-07 | **No Secrets in Code** — all credentials in Oracle Vault / env vars; never in code or Compose files | HARD RULE |
| STD-08 | **Structured Logging** — every log event is JSON: `timestamp, entity, action, user_id, tenant_id, severity` | ARCHITECTURE |
| STD-09 | **TypeScript Strict** — `strict: true` in tsconfig.json; no `any` types | ARCHITECTURE |
| STD-10 | **Input Validation** — all API inputs validated with Zod schemas server-side before touching DB | HARD RULE |
| STD-11 | **Idempotent Financial Ops** — all financial writes carry idempotency keys; duplicate delivery never double-posts | HARD RULE |
| STD-12 | **Deploy Gate** — production only via automated deploy script; tests pass + migrations run + Robert sign-off | HARD RULE |
| STD-13 | **Expand-and-Contract Migrations** — columns/tables never renamed or dropped in a single cycle; use 5-step pattern | HARD RULE |

### STD-13 Five-Step Pattern (Expand-and-Contract)

| Step | Migration | Code |
|---|---|---|
| 1 — Expand | ADD new column (old stays) | No change |
| 2 — Dual-write | None | Write to BOTH columns |
| 3 — Backfill | Copy old → new for existing rows | No change |
| 4 — Read switchover | None | Read from new column only |
| 5 — Contract | DROP old column | No change |

---

---

## TOP GOTCHAS — THE ONES THAT KEEP RECURRING

Kept inline deliberately: these have each caused real production breakage more than once,
so they must not depend on remembering to open a file. Full detail is one `Read` away.

| Rule | Detail |
|---|---|
| `SELECT set_config($1,$2,true)` — **never** `SET LOCAL x = $1` (PG rejects parameterised SET) | `docs/rules/db-rls.md` |
| RLS policies must use `NULLIF(current_setting('app.x',true),'')::uuid` — bare `current_setting(...)::uuid` throws once a GUC has reverted to `''` | `docs/rules/db-rls.md` |
| Use `withTenantRLS` for `jag_commercial`/`jag_entertainment`/`jag_core`; `withOwnerRLS` for `jag_family`/`jag_properties`. UPDATE/DELETE on a bare connection silently affects **0 rows** | `docs/rules/db-rls.md` |
| **`req.user` does not exist anywhere in jag-api — always `req.rlsCtx.userId`.** Getting this wrong silently 401'd the entire tenancy module for 20+ sessions | `docs/rules/db-rls.md` |
| A new env var in `.env` does **nothing** until it is also listed in `docker-compose.yml`'s `environment:` block. Found broken **4 separate times**. `docker compose restart` does not pick up env changes — use `up -d --force-recreate` and verify with `docker exec <svc> printenv` | `docs/rules/deploy-infra.md` |
| API deploys ship `dist/` + `prod_modules/node_modules`, **not** `src/`. `npm run build:prod` first. Use `tar`-then-`scp`-single-file — `scp -r` on those paths silently stalls | `docs/rules/deploy-infra.md` |
| Presigned MinIO URLs must use the **public** endpoint client with `region` pinned; auth-gated streaming routes can never be a bare `<img src>`/`<a href>` (header-only auth → 401) | `docs/rules/storage-minio.md` |
| PG `numeric`/`decimal` arrive in Node as **strings** — always `parseFloat(String(v ?? 0))` before arithmetic | `docs/rules/db-rls.md` |
| `fin_investments.current_value_ttd` is **always TTD**. Divide by rate to display, multiply to save, never re-multiply when totalling | `docs/rules/finance.md` |
| Date-only values: parse Y/M/D manually — `new Date(iso).toLocaleDateString()` shifts back a day in Trinidad. Do **not** apply to real timestamps. Init date inputs with `.slice(0,10)` | `docs/rules/frontend.md` |
| Never name an arrow-function param `t` (shadows `useTranslation`); never use a translated string as a React key | `docs/i18n.md` |
| Migrations are **always applied manually** — nothing auto-applies on container start. Raw-psql migrations must be registered in `__migrations` by hand | `docs/migrations.md` |

---

## TENANT UUIDs

| Entity | UUID |
|---|---|
| JAG_HOLDINGS | `00000000-0000-0000-0001-000000000001` |
| JABCO | `00000000-0000-0000-0001-000000000002` |
| JAG_PROPERTIES | `00000000-0000-0000-0001-000000000003` |
| JAG_ENTERTAINMENT | `00000000-0000-0000-0001-000000000004` |
| JAG_FINANCE | `00000000-0000-0000-0001-000000000005` |
| DRAGONBRIDGE | `00000000-0000-0000-0001-000000000006` |
| NLCB | `00000000-0000-0000-0001-000000000007` |
| CONSOLIDATED (net worth) | `00000000-0000-0000-0000-000000000000` |
| Personal — Robert | `00000000-0000-0000-0001-000000000008` |
| Isabella Johnson-Attin | `00000000-0000-0000-0001-000000000009` |
| Phillip Ajack Johnson-Attin | `00000000-0000-0000-0001-000000000010` |
| Brian Johnson-Attin | `00000000-0000-0000-0001-000000000011` |
| Zhanghua Chang | `00000000-0000-0000-0001-000000000012` |
| Theresa Johnson-Attin | `00000000-0000-0000-0001-000000000013` |

**Note:** UUIDs 008–013 are personal/family owner entities used in `fin_accounts`, `fin_investments`, `fin_insurance_policies`, and `fin_mortgages_loans` (`owner_entity_id` grouping field only — no FK to tenants table, no RLS tenant scope, `jag_family` DB only).

---

---

## USER ACCOUNTS

### Robert (Owner)
| Field | Value |
|---|---|
| Email | `robertjohnsonattin@gmail.com` |
| Keycloak ID | `e58436eb-bcd9-40c4-95f6-251d77d0b001` |
| jag_core users.id | `95ca3f77-60ba-4a0f-af70-2832b247b525` |
| Role | Owner on all 7 tenants (JAG_HOLDINGS is default) |
| Keycloak realm roles | `default-roles-jag` |
| Token source | `https://auth.jagcorporate.com` (NOT localhost — issuer mismatch) |

### Wife (Emergency Designate — full read-only)
| Field | Value |
|---|---|
| Email | `zhanghuachang22@gmail.com` |
| Keycloak ID | `7b03b15d-f9e7-4000-8394-7e530d2ce35f` |
| jag_core users.id | `847d5964-302c-4513-b0c9-e54406c43e62` |
| Role | Auditor on JAG_HOLDINGS (auditor portal shows Robert's books) |
| Keycloak realm roles | `default-roles-jag`, `jag_auditor` |

### Brian
| Field | Value |
|---|---|
| Email | `brijohn929@gmail.com` |
| Keycloak ID | `566710e3-258c-4220-984c-bc1729417770` |
| jag_core users.id | `1b9f8e53-8f1e-4eb9-be81-83dc6d3f5670` |
| Role | Staff on NLCB (his own login); seed user `00000000-0000-0000-0002-000000000001` used by X-Act-As flow |
| Keycloak realm roles | `default-roles-jag`, `brian_portal` |
| Default tenant | NLCB (`00000000-0000-0000-0001-000000000007`) per `brian_portal_config` |

---

---

## KEY CREDENTIALS (VM / LOCAL)

| Resource | Value |
|---|---|
| SSH key | `~/.ssh/jag_oracle2` (jag_oracle does NOT work) |
| Keycloak admin | user `admin` — password ‹SECRETS VAULT›[^secrets] (via SSH tunnel to localhost:8080) |
| jag-api client secret | ‹SECRETS VAULT›[^secrets] |
| PG superuser | user `postgres` — password ‹SECRETS VAULT›[^secrets] |
| jag_app PG user | ‹SECRETS VAULT›[^secrets] |
| MinIO root | user `jag_minio_admin` — password ‹SECRETS VAULT›[^secrets] (admin only — console + mc) |
| MinIO jag_app | access key + secret ‹SECRETS VAULT›[^secrets] (scoped to 4 JAG buckets via `jag-app-buckets` policy) |
| MinIO audit token | stored in VM `.env` as `MINIO_AUDIT_TOKEN` — shared secret for MinIO→jag-api webhook |
| Gemini API key | stored in VM `.env` as `GEMINI_API_KEY` — used by listing.ts suggest-price endpoint |
| Gemini model | `GEMINI_MODEL=gemini-3.5-flash` in VM `.env` — change here to upgrade model without code deploy |
| Documenso owner account | `robertjohnsonattin@gmail.com` — password ‹SECRETS VAULT›[^secrets] (only needed to log into `sign.jagcorporate.com`'s dashboard directly, e.g. to manage the webhook; normal operation never surfaces this to tenants) |
| Documenso API key / webhook secret | stored in VM `.env` as `DOCUMENSO_API_KEY` / `DOCUMENSO_WEBHOOK_SECRET` |
| WhatsApp Cloud API token | stored in VM `.env` as `WHATSAPP_ACCESS_TOKEN` — permanent System User token (Meta Business Suite → System Users → jag-api), never expires |
| WhatsApp phone number 2FA PIN | `868-277-3726`'s Cloud API registration PIN — ‹SECRETS VAULT›[^secrets] (needed only if the number ever needs re-registering) |
| jag-cron-service client secret | stored in VM `/opt/jag/jag-infra/.cron-secrets` as `KC_CRON_CLIENT_SECRET` — Keycloak `client_credentials` secret for the dedicated cron automation client (see below) |

[^secrets]: **‹SECRETS VAULT›** — actual credential values are NOT stored in git (scrubbed 2026-06-24). Keep them in a password manager / the VM `/opt/jag/.env` only. Live values for the VM live in `/opt/jag/.env`; for admin creds use your password manager. **Note:** older git history (and several operational scripts) still embed some of these — the only complete remediation is to *rotate* the affected credentials (KC client secret, PG passwords, MinIO keys, keystore password). See OPEN ITEMS → "Secrets hygiene".

---

---

## ROLE MATRIX

| Role | Access |
|---|---|
| Owner | Full access — all entities, all data (Robert) |
| Domain Admin | Full CRUD within assigned entity |
| Operator / Staff | Scan, log, count, transfer — no delete, no valuations |
| Auditor | Read-only, export only |
| External Advisor | Time-limited scoped read/export, auto-expiry |
| Family Member — Emergency Designate | Full read-only all entities (Wife) |
| Brian | Separate portal — his entities only |
| System | API access only — scheduled jobs, integrations |

---

---

## BUSINESS ENTITIES

**CRITICAL:** BAR + Members Club = ONE merged module (JAG Entertainment Ops) with mandatory entity tag per transaction. Members Club is a **private social club** — NOT a regulated casino. No AML tags, no Gaming Commission export, no hash-chained audit log.

| Entity | Type | Phase |
|---|---|---|
| JABCO Limited | Civil engineering & contracting | 1B, 2 |
| JAG Properties | Property management | 2 |
| DragonBridge | China sourcing, forex, logistics | 3 |
| JAG Entertainment (BAR + Members Club) | F&B + private social club (merged) | 3 |
| JAG Finance | Consolidated wealth & banking | 1B/4 |
| IMS | Inventory & asset management | 1B+ |
| JAG CRM | Customer relationship management | 1B, 3, 4 |
| JAG Lifestyle | Personal loyalty & rewards tracker | 2–4 |
| JAG DocVault | Document management & e-signatures | 2 |
| JAG Succession Planning | Estate & access planning | 2 |
| Brian's Portal | Isolated family member portal | 3 |
| JAG Holdings | Central financial backbone / SSO | 1B/5 |
| JAG Plantations | Agricultural land | 7 |
| JAG Trading | POS retail | 7 |

---

---

## OPEN ITEMS

Only genuinely-open work lives here. Everything completed is in **`docs/CHANGELOG.md`**.

- **WebAuthn device registration (Brian, Wife)** — PENDING; each needs an in-person browser session at `https://auth.jagcorporate.com/realms/jag/account`; no fingerprint reader required — Windows Hello PIN works on any Windows 10/11 machine

- **Ollama vision** — `DRY_RUN=false` ✓; text-PDF extraction working; scanned PDFs use vision model. **Use `llava` not `llama3.2-vision`** — mllama architecture not supported by Ollama 0.30.8 on this machine (error: unknown model architecture 'mllama'). `.env.ollama-batch` already set to `OLLAMA_MODEL_VISION=llava`. Run `ollama pull llava` (~4.7GB) to enable scanned-PDF extraction. Until then, scanned docs land in REVIEW with nulls — fill manually in Finance → Documents.

- **JAG Plantations / JAG Trading** — future phases; placeholder pages exist in frontend

- **Leases (B3)** — PENDING: all leases expired; need monthly rent amounts per unit from Robert to create new leases (moved from above, still outstanding)

- **Unit listing content** — IN PROGRESS: 25 units all VACANT; Apt C1 (45 Eleventh Street) fully listed 2026-07-06 as the first real end-to-end listing (photos, description, rent, utilities, public booking link) — see "Tenancy listing pipeline" below for the infra work this uncovered. Remaining 24 units still need photos/descriptions/rent/utilities filled in manually via Properties → Units → Listing button.

- **Money Manager reconciliation import** — PENDING: `scripts/mm-import/` not yet built; all-source reconciliation (MM Excel + second Excel report + bank PDFs/CSVs) → single clean import into fin_transactions; 54 existing Scotia rows will be enriched not duplicated; RBC eSavings (`ffa985f6`, last4 3841, $53,755.57 TTD opening balance) and RBC Rewards Visa Platinum (`077b8014`, last4 0512) accounts already created in JAG; Cash account still needs creating; second Excel report contents TBD

---

---

## LOCKED ARCHITECTURE DECISIONS (do not re-propose)

- PostgreSQL 18, five logical DBs, cross-DB via `postgres_fdw` in JAG Holdings only
- Docker + Docker Compose
- Caddy + Let's Encrypt + Cloudflare DNS-01 (NOT Duck DNS)
- Keycloak 26.x, realm `jag`, client `jag-api`, mappers `jag_user_id` + `jag_tenant_id`
- Finance Option B — accounts scoped per entity via `owner_entity_id`
- Ollama on main Windows workstation only (NOT Dell Inspiron)
- Succession activation — parallel Co-Owner to wife's account; Robert's Owner account is NEVER programmatically demoted
- Offline-critical: BAR cash logging, JABCO site diary, IMS barcode scanning
- STD-13 Expand-and-Contract for all destructive schema changes
- `jag-web/` served as Caddy static files — NOT a separate Docker container

---

---

## KEEPING THIS FILE SMALL — MANDATORY ROUTING RULE

CLAUDE.md reached 226 KB (~80k tokens loaded into *every* session) because completed work
kept accumulating here. It was split on 2026-07-27. To stop it regrowing, every session
must route new documentation to the right file:

| What you are writing | Where it goes |
|---|---|
| A new route, panel, or module | one row in **`docs/route-map.md`** |
| A new migration | one row in **`docs/migrations.md`** (the moment the file is created) |
| A newly-learned gotcha / implementation rule | the matching **`docs/rules/*.md`** |
| A bug post-mortem, session narrative, or "what we did" writeup | **`docs/CHANGELOG.md`** |
| An item that just got finished | move the full write-up to **`docs/CHANGELOG.md`** and delete it from OPEN ITEMS here |
| Something genuinely open, or a rule that must never be missed | **here**, kept short |

**Do not paste session narratives into CLAUDE.md.** This file should stay roughly flat in
size. If an edit to CLAUDE.md would add more than a few lines, it almost certainly belongs
in `docs/` with a pointer here instead.

Registration is still not optional and still not the same step as "deploy it" — it just
lands in `docs/` now. When adding a migration, grep the **entire** table in
`docs/migrations.md` for that DB to confirm no numbered file is missing an entry; a skipped
number is exactly how features go undocumented for weeks. If a feature's name could collide
with a similarly-named one elsewhere (e.g. "maintenance" exists in Properties tickets,
Properties scheduled maintenance, *and* Inventory/VMS PM schedules — same for "insurance",
"tracking", "documents"), say so explicitly in the entry.

---

## WHAT CLAUDE MUST DO EVERY SESSION

- Apply STD-01 through STD-13 to every line of code
- Never re-propose locked architecture decisions
- Write node-pg-migrate files for every schema change — never raw SQL on production
- Use `SELECT set_config($1, $2, true)` for PG session variables — NEVER `SET LOCAL x = $1`
- Declare new Keycloak attributes in User Profile schema before setting them
- Include idempotency keys on all financial write endpoints
- Write `pending_events` outbox entries within the same transaction as financial events
- Scope all DB queries with correct owner/tenant — no cross-DB queries without `postgres_fdw` through JAG Holdings
- Use Keycloak JWT claims for role — never trust application-layer role claims alone
- Add `last_modified_at` + `last_modified_by` to all shared master record tables
- For API changes: `npm run build:prod` FIRST, then SCP `dist/`, then docker rebuild. If new npm packages were added, also run `node scripts/prod-install.js` and re-SCP `prod_modules/` — the Dockerfile copies `prod_modules/node_modules` not the host's `node_modules`
- For frontend changes: `npm run build` in `jag-web/`, then SCP `dist/` to VM
- **i18n**: never use `t` as an arrow-function parameter name in any component (shadows `useTranslation` `t`); never use translated strings as React list keys
- New modules: build in English first, translate as a batch when complete — missing keys degrade gracefully
- End every session with a handoff note
- **Feature registration is not optional, and it's not the same step as "deploy it."** Register into `docs/route-map.md` / `docs/migrations.md` the moment the file is created — see the routing rule section above for the full procedure.
- **Before answering "does feature X exist" or "how does X work," read `docs/route-map.md` and `docs/migrations.md`, then grep the codebase.** Never answer from recall alone — the docs have known gaps, so treat a denial as provisional until verified against actual code.
- **Keep CLAUDE.md flat.** Route new writeups to `docs/` per the routing rule above; move finished OPEN ITEMS to `docs/CHANGELOG.md`.
