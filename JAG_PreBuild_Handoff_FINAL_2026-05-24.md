# JAG Holdings Platform — Pre-Build Complete Handover
**Date:** 2026-05-24  
**Status:** ALL PRE-BUILD TASKS COMPLETE — Phase 1A begins next  
**For:** New Claude session — load this document + `JAG_Engineering_Standards_v1.1.docx` at the start of every build session.

---

## Project Context

JAG Holdings is a multi-tenant family-of-businesses platform built by Robert Johnson-Attin (Trinidad and Tobago). Work is organised into pre-build phases followed by numbered build phases. All project files live in:

```
C:\Users\rober\Documents\Claude\Projects\JAG Holdings\
```

Robert works session-by-session with Claude Code. He provides a handover doc at the start of each session. He is the sole decision-maker; Claude implements.

---

## Databases (from PRE-1)

| Database | Module |
|---|---|
| `jag_core` | Users, tenants, roles, notifications, audit log, i18n |
| `jag_commercial` | IMS (inventory), JABCO PM (construction), CRM |
| `jag_entertainment` | Bar operations + Members Club |
| `jag_family` | Family members, vehicles, lifestyle, docvault |
| `jag_properties` | Properties, leases, rent payments, maintenance, mortgages |

All 5 databases are in a **single PostgreSQL 16 cluster** on the Oracle AMD VM, streamed to the Ampere VM via WAL replication. After the first failover, Ampere becomes the permanent primary (more resources).

---

## Pre-Build Task Status — ALL COMPLETE

| ID | Task | Status |
|----|------|--------|
| PRE-0A | WAL target decision | ✅ LOCKED — Second Oracle Always Free Ampere VM (4 OCPU, 24 GB RAM) |
| PRE-0B | Cloudflare Authenticated Origin Pull guide | ✅ DONE (content in PRE-7 Step 6) |
| PRE-1 | ERD/DBML — all 5 databases | ✅ DONE — 5 `.dbml` files |
| PRE-2 | OpenAPI YAML contract | ✅ DONE — `jag_api_contract_v1.yaml` (8,286 lines, 140 endpoints) |
| PRE-3 | Outbox migrations + jag-event-dispatcher | ✅ DONE — `jag-event-dispatcher/` |
| PRE-4 | Keycloak realm + clients + roles | ✅ DONE — `jag_keycloak_realm_v1.json` + setup guide |
| PRE-5 | WiPay sandbox POC | ✅ DONE — `jag-wipay-poc/` + migration 00002 |
| PRE-6 | Bank statement parser POC (Ollama/Mistral 7B) | ✅ DONE — `jag-bank-parser-poc/` |
| PRE-7 | Migrate JABCO domain to Cloudflare Free Tier | ✅ DONE — migration runbook |
| PRE-8 | DR failover runbook (incl. Keycloak incapacitation reset) | ✅ DONE — full runbook + Section 8 |
| PRE-9 | Oracle Cloud + Docker setup (Phase 0) | ✅ DONE — `jag-infra/` + Dockerfiles |
| PRE-10 | Consolidated lawyer meeting | ✅ DONE — briefing doc (OFFLINE ONLY) |

---

## What Was Built — PRE-5 Through PRE-10

### PRE-5 — WiPay Sandbox POC

**Decision locked:** `pending_review_queue` → 202 Accepted for non-success and unmatched webhook events (never 422).

**New files:**
- `jag-event-dispatcher/migrations/jag_properties/20260524000002_create_pending_review_queue.ts` — migration
- `jag-wipay-poc/src/middleware/verifyWiPaySignature.ts` — HMAC-SHA256 middleware, production-ready, copy to Phase 1 API
- `jag-wipay-poc/src/routes/webhooks.ts` — full handler: duplicate check → non-success → pending_review_queue (202) → lease lookup → INSERT rent_payment + outbox event (200), all in one BEGIN/COMMIT
- `jag-wipay-poc/scripts/send-test-webhook.ts` — 6-scenario test harness
- `jag_properties.dbml` — updated: added `pending_review_status` enum + `prop_pending_review_queue` table
- `jag_api_contract_v1.yaml` — updated: 409/422 removed from `POST /webhooks/wipay`, 202 added

**Phase 0 limitation:** Lease correlation uses `metadata.lease_id` in the WiPay payload. Phase 1 replaces this with a `prop_wipay_payment_orders` lookup table. Commented as `TODO Phase 1` in `webhooks.ts`.

---

### PRE-6 — Bank Statement Parser POC

**Output:** `jag-bank-parser-poc/` — TypeScript CLI: bank statement (PDF/CSV/TXT) → structured JSON via Ollama/Mistral 7B.

| File | Role |
|---|---|
| `src/extractText.ts` | PDF via `pdf-parse` (CommonJS require, not import); CSV/TXT pass-through; SHA-256 source hash |
| `src/parseWithLlm.ts` | Ollama `/api/generate`, `format: "json"`, temperature 0.1 |
| `src/postProcess.ts` | Date normalisation (DD/MM/YYYY, DD-Mon-YY → ISO), OPSEC account masking (`****1234`), amount cleanup |
| `src/index.ts` | Progress to stderr, structured JSON to stdout |

**Run:** `ollama pull mistral` → `npm install` → `npm run parse statement.pdf > parsed.json`

**Key fields in output:** `account_reference` (last 4 digits only, OPSEC), `source_hash` (for deduplication in Phase 1), `parsing_confidence`, `transactions[]`, `raw_line` per transaction for audit.

**Known gaps:** No chunking for statements > 24K chars (warns and truncates). Scanned PDFs need OCR (Phase 1). No DB writes — pure parsing POC.

---

### PRE-7 — Cloudflare Migration Runbook

**File:** `JAG_PreBuild_PRE7_Cloudflare_Migration.md`

**Key decisions:**
- All 4 subdomains proxied (orange cloud): `jabco.tt`, `www`, `api.jabco.tt`, `auth.jabco.tt`
- SSL/TLS: Full (Strict) — Cloudflare Origin CA certificate on Oracle VM
- Authenticated Origin Pull enabled **after** DNS cutover confirmed
- Keycloak requires `KC_PROXY=edge` + `KC_HOSTNAME=auth.jabco.tt` + `$http_cf_connecting_ip` in nginx — without this, OAuth redirect URLs break
- `.tt` domain propagation: 12–48 hours (TTNIC is slow)
- 5 WAF rules: block Keycloak admin console, block scanner UAs, managed-challenge non-TT on auth paths, block empty UA on API, block unknown Host headers
- WiPay webhook (`/api/v1/webhooks/wipay`) is unaffected by WAF — auth subdomain rules don't apply to it

---

### PRE-8 — DR Failover Runbook

**File:** `JAG_PreBuild_PRE8_DR_Failover_Runbook.md`

**Architecture:** AMD (primary, 1 OCPU/6 GB) → async WAL streaming → Ampere (standby, 4 OCPU/24 GB). After first failover, **keep Ampere as permanent primary** — do not switch back.

**RTO:** ~10–15 min (manual). **RPO:** < 1 second async / 0 sync.

**Failover in 5 steps:**
1. `pg_ctl promote -D /var/lib/postgresql/16/main` on Ampere
2. Update 4 Cloudflare A records to Ampere IP (< 1 min propagation)
3. `docker compose up -d` on Ampere (keycloak → dispatcher → API)
4. Verify `curl https://api.jabco.tt/health`
5. After AMD recovers: wipe it, `pg_basebackup -Xs -R` from Ampere, start as new standby

**Section 8 — Keycloak incapacitation reset (added PRE-10 session):**
- Sealed envelope contains: Keycloak admin credentials + SSH key + `.env` location
- Scenario A: login to `https://auth.jabco.tt/auth/admin` with sealed envelope creds → grant `emergency_designate` role / reset passwords / remove TOTP
- Scenario B (credentials expired): stop container, restart with `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD` env override → reset main admin via temporary bootstrap user → restart normally
- Scenario C: container down → `docker compose restart keycloak`
- Scenario D: full VM down → follow Section 3 (failover to Ampere) first
- Sealed envelope renewed annually every January — checklist in Section 8

---

### PRE-9 — Oracle Cloud + Docker Setup

**New directory: `jag-infra/`**

| File | Purpose |
|---|---|
| `docker-compose.yml` | Keycloak 26.x + jag-event-dispatcher + MinIO; all ports bound to `127.0.0.1` |
| `.env.example` | All env vars — copy to `.env` and fill before `docker compose up` |
| `postgresql/bootstrap.sql` | Roles (`jag_app`, `keycloak_user`, `replicator`), 6 databases, extensions (`pgcrypto`, `postgres_fdw` on `jag_core`) |
| `postgresql/primary-amd.conf` | Tuned for 6 GB: `shared_buffers=1536MB`, WAL streaming on, async replication |
| `postgresql/primary-ampere.conf` | Tuned for 24 GB: `shared_buffers=6144MB`, 4-way parallelism — apply after first failover |
| `postgresql/pg_hba.conf.append` | App access (`jag_app`, `keycloak_user` from `172.16.0.0/12`) + replication rule |
| `nginx/nginx.conf` | Global: AOP (`ssl_verify_client on`), rate-limit zones, `$http_cf_connecting_ip` for real IP |
| `nginx/sites-available/api.jabco.tt.conf` | Proxy to port 3001; webhook path exempt from rate limit; `proxy_request_buffering on` for HMAC |
| `nginx/sites-available/auth.jabco.tt.conf` | Proxy to port 8080; large buffers for JWT; WebSocket upgrade map; tight rate limit on token endpoint |
| `nginx/sites-available/jabco.tt.conf` | Static file server at `/var/www/jabco.tt` |
| `systemd/jag-stack.service` | Auto-starts Docker Compose after PostgreSQL on every boot |

**Also:** `jag-event-dispatcher/Dockerfile` added (multi-stage, `node:20-alpine`). Fixed `package.json` start script from `dist/index.js` → `dist/src/index.js` (matches tsconfig `rootDir: "."`).

**Setup order:** VCN/security lists → OS setup (both VMs) → PostgreSQL install → primary config + bootstrap SQL → pg_basebackup to Ampere → Docker install → deploy code → configure `.env` → `docker compose up` → nginx + SSL certs → run migrations → Keycloak realm import (PRE-4) → MinIO buckets → systemd enable → smoke test.

---

### PRE-10 — Consolidated Lawyer Meeting

**File:** `JAG_PreBuild_PRE10_Lawyer_Meeting_Briefing.md` — OFFLINE ONLY, do not share digitally.

Structured briefing for a single consolidated lawyer session covering four areas: Robert's estate (Will, Primary POA to wife for JABCO/DragonBridge, Backup POA to brother), Wife's estate (her own Will, BAR/CASINO trustee clause, her POA), Brian's estate (his Will, executor, POA), and property/financial instruments (buy-sell agreement for JAG Properties, father's bank accounts). Includes documents-to-bring checklist, information-still-to-gather list, and post-meeting platform action items (DocVault storage paths, JAG Family module records).

---

## Non-Negotiable Architecture Decisions (carry always)

1. **`entity_tag: BAR | MEMBERS_CLUB`** — mandatory on every Entertainment transaction row and API request/response. Sole P&L separation mechanism.
2. **No DB-level FK across databases** — logical UUID references only. `postgres_fdw` in `jag_core` is the only cross-DB query path.
3. **RLS columns** — `tenant_id` on `jag_core`, `jag_commercial`, `jag_entertainment`; `owner_id` on `jag_family`, `jag_properties`.
4. **Mortgage OPSEC** — `account_reference` is partial only (last 4 digits). Full account numbers never stored. Same rule applied to bank statement parser output.
5. **`audit_log` is append-only** — no UPDATE or DELETE from application code.
6. **Succession rule** — wife's `owner` grant is additive. Robert's `owner` record is never revoked or demoted. `emergency_designate` role activates in parallel.
7. **`pending_review_queue` is locked** — WiPay non-success payments and unmatched success events → INSERT `prop_pending_review_queue` + return 202. Never 422 to WiPay.
8. **STD-13: Expand-and-contract migrations** — columns/tables never renamed or dropped in a single migration cycle. 5-step pattern mandatory for all destructive schema changes.
9. **Replication slots** — Ampere standby uses `ampere_slot` on the primary to prevent WAL gaps. Monitor `pg_replication_slots` to ensure WAL doesn't pile up if Ampere is down.
10. **Keycloak admin reset sealed envelope** — renewed annually every January. Contains admin credentials + SSH key. Never stored digitally.

---

## Infrastructure

| Item | Detail |
|---|---|
| Production | Oracle Cloud AMD micro VM (1 OCPU, 6 GB RAM) |
| WAL target / DR | Oracle Ampere VM (4 OCPU, 24 GB RAM) — becomes permanent primary after first failover |
| Auth | Keycloak 26.x, Docker, realm `jag`, `auth.jabco.tt` |
| API base URL | `https://api.jabco.tt/api/v1` |
| Dev | `http://localhost:3000/api/v1` |
| Storage | MinIO (Docker, ports 9000/9001 on `127.0.0.1` only) |
| Migrations | node-pg-migrate (TypeScript), runner in `jag-event-dispatcher/` |
| Validation | Zod (server-side, Phase 1) |
| Payments | WiPay (HMAC webhook, `X-WiPay-Signature: sha256=<hex>`) |
| Events | `jag-event-dispatcher` polls `pending_events` every 5 s across all 5 DBs |
| DNS/CDN | Cloudflare Free Tier, proxied, Authenticated Origin Pull enabled |
| Reverse proxy | nginx, native on Oracle VMs, `ssl_verify_client on` |
| Bank parsing | Ollama/Mistral 7B, local, `http://localhost:11434` |

---

## Complete File List

```
C:\Users\rober\Documents\Claude\Projects\JAG Holdings\
│
├── SCHEMAS (PRE-1)
│   ├── jag_core.dbml
│   ├── jag_commercial.dbml
│   ├── jag_entertainment.dbml
│   ├── jag_family.dbml
│   └── jag_properties.dbml                    ← updated PRE-5: pending_review_queue table
│
├── API CONTRACT (PRE-2)
│   └── jag_api_contract_v1.yaml               ← updated PRE-5: webhook 202/422 resolved
│
├── AUTH (PRE-4)
│   ├── jag_keycloak_realm_v1.json
│   └── JAG_PreBuild_PRE4_Keycloak_Setup.md
│
├── EVENT DISPATCHER (PRE-3)
│   └── jag-event-dispatcher/
│       ├── Dockerfile                          ← NEW PRE-9
│       ├── package.json                        ← fixed start script PRE-9
│       ├── src/  (config, db, types, alerts, dispatcher, index, handlers/)
│       ├── migrations/
│       │   ├── jag_core/20260524000001_create_pending_events.ts
│       │   ├── jag_commercial/20260524000001_create_pending_events.ts
│       │   ├── jag_entertainment/20260524000001_create_pending_events.ts
│       │   ├── jag_family/20260524000001_create_pending_events.ts
│       │   └── jag_properties/
│       │       ├── 20260524000001_create_pending_events.ts
│       │       └── 20260524000002_create_pending_review_queue.ts  ← NEW PRE-5
│       └── scripts/migrate.ts
│
├── WIPAY POC (PRE-5)
│   └── jag-wipay-poc/
│       ├── src/
│       │   ├── index.ts
│       │   ├── config.ts
│       │   ├── db.ts
│       │   ├── types.ts
│       │   ├── middleware/verifyWiPaySignature.ts   ← copy to Phase 1 API
│       │   └── routes/webhooks.ts
│       └── scripts/send-test-webhook.ts
│
├── BANK PARSER POC (PRE-6)
│   └── jag-bank-parser-poc/
│       ├── src/ (index, config, types, extractText, parseWithLlm, postProcess)
│       └── sample/README.md
│
├── INFRASTRUCTURE (PRE-9)
│   └── jag-infra/
│       ├── docker-compose.yml
│       ├── .env.example
│       ├── postgresql/
│       │   ├── bootstrap.sql
│       │   ├── primary-amd.conf
│       │   ├── primary-ampere.conf
│       │   └── pg_hba.conf.append
│       ├── nginx/
│       │   ├── nginx.conf
│       │   └── sites-available/ (jabco.tt, api.jabco.tt, auth.jabco.tt)
│       └── systemd/jag-stack.service
│
├── HANDOVER DOCS
│   ├── JAG_PreBuild_Handoff_PRE1_2026-05-23.md
│   ├── JAG_PreBuild_Handoff_PRE2_2026-05-23.md
│   ├── JAG_PreBuild_PRE4_Keycloak_Setup.md
│   ├── JAG_PreBuild_PRE5_WiPay_POC.md
│   ├── JAG_PreBuild_PRE6_BankParser_POC.md
│   ├── JAG_PreBuild_PRE7_Cloudflare_Migration.md
│   ├── JAG_PreBuild_PRE8_DR_Failover_Runbook.md    ← Section 8 added PRE-10 session
│   ├── JAG_PreBuild_PRE9_Oracle_Docker_Setup.md
│   ├── JAG_PreBuild_PRE10_Lawyer_Meeting_Briefing.md  ← OFFLINE ONLY
│   └── JAG_PreBuild_Handoff_FINAL_2026-05-24.md    ← THIS FILE
│
└── MASTER DOCS (load every session)
    ├── JAG_Master_Architecture_v1.9.docx          ← classified master
    ├── JAG_AI_Context_Summary_v2.1.docx            ← sanitised AI version
    └── JAG_Engineering_Standards_v1.1.docx         ← STD-01 through STD-13
```

---

## What Comes Next — Phase 1A

**Phase 1A: Keycloak + RLS + i18n + jag-event-dispatcher integration + pen test**

Per the master architecture, Phase 1A is the first build phase. Load `JAG_Master_Architecture_v1.9.docx` + `JAG_Engineering_Standards_v1.1.docx` at the start of that session.

Phase 1A likely covers:
- **API server scaffolding** — TypeScript/Express project structure, middleware stack (JWT verification via Keycloak, Zod validation, RLS context injection)
- **RLS migrations** — `CREATE POLICY` statements for all 5 databases (columns exist in DBML; policies not yet written)
- **i18n framework** — `jag_core.i18n_strings` table seeding for en, zh-CN, es
- **jag-event-dispatcher handler stubs → real handlers** — Phase 1 wires the `TODO Phase 1` stubs in `src/handlers/*.ts` to actual business logic
- **Pen test** — basic security review of the Keycloak + nginx + Cloudflare WAF stack before any live traffic

The OpenAPI YAML (`jag_api_contract_v1.yaml`) is the blueprint for all Phase 1 endpoint implementations. The DBML files are the blueprint for all schema decisions. Neither should be changed without updating both.
