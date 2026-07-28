# VM cron jobs & local scripts

> Split out of CLAUDE.md.

### VM Cron Scripts (`jag-infra/scripts/`)

**Auth pattern (fixed session 2026-07-22):** all VM-scheduled scripts that call the JAG API now authenticate via the dedicated Keycloak client `jag-cron-service` (`client_credentials` grant, realm role `jag_cron_service`) — **never** ROPC (`grant_type=password`) against Robert's real account. The old ROPC pattern intermittently tripped Keycloak's per-user brute-force lockout across every script sharing that account. `auth.ts` maps the `jag_cron_service` realm role to Robert's real owner context (same pattern as the auditor-portal branch), so owner-scoped RLS behaves identically to Robert's own calls. **New scheduled scripts should follow this pattern from the start** — `KC_CLIENT_ID="jag-cron-service"`, `KC_CLIENT_SECRET="${KC_CRON_CLIENT_SECRET:?...}"`, body `grant_type=client_credentials` (no `username`/`password`). See [[project-cron-ropc-auth-failures]] in Claude's memory for full detail.

| Script | Schedule (UTC) | Schedule (TT) | Purpose |
|---|---|---|---|
| `backup-databases.sh` | 02:00 | 22:00 prev. day | pg_dump all 5 DBs |
| `fx-rates-sync.sh` | 10:00 | 06:00 | Seed USD + CNY → TTD rates from open.er-api.com |
| `cleanup-stale-statements.sh` | 07:00 | 03:00 | Delete PENDING bank statement jobs + MinIO objects older than 7 days |
| `rent-reminders.sh` | 07:00 | 03:00 | Two WhatsApp sends in one run: `jag_rent_reminder_d5` for periods due within **3 days** (script/column names say "D-5" — misleading, see gotcha below), resent daily until paid; `jag_rent_reminder_d1` once, the day before due |
| `rent-missed-d1.sh` | 09:00 | 05:00 | `jag_rent_missed_d1` — periods whose due date was yesterday and still show no payment recorded; dedup via `missed_d1_sent_at` |
| `viewing-reminders.sh` | 00:00 * | 20:00 * | Hourly — send WhatsApp viewing reminders for viewings in next 2h |
| `post-viewing-app-link.sh` | 00:30 * | 20:30 * | Hourly (at :30) — send application link to COMPLETED viewings in last 24h |
| `renewal-notices.sh` | 08:00 | 04:00 | Send D-60/D-30/D-14 WhatsApp renewal notices for expiring leases |
| `sla-monitor.sh` | */30 * | every 30 min | Mark open maintenance tickets where SLA hours exceeded; creates BREACH update log |
| `stale-listing-alert.sh` | 09:00 | 05:00 | WhatsApp alert to Robert for units LISTED >14 days without a booked viewing; deduped via `stale_alert_sent_at` on prop_units |
| `gps-battery-monitor.sh` | 0 * * * * | every hour | Poll Traccar positions API for batteryLevel on all non-RETIRED trackers; insert into `gps_battery_log`; fire low-battery JAG notification (≤20%, deduped 8h) |
| `setup-minio-policy.sh` | one-time | — | Create `jag-app-buckets` IAM policy + attach to jag_app user; re-run after MinIO data wipe |
| `fdw-rotate-password.sh` | manual | — | Resync FDW USER MAPPING passwords after jag_app PG credential rotation |

**"D-5" rent reminder is actually D-3 (found session 52, 2026-07-28).** `rent-reminders.sh`'s own
header comment says `jag_rent_reminder_d5 — 5 days before due date`, the WhatsApp template is named
`jag_rent_reminder_d5`, and the DB column is `reminder_d5_sent_at` — three independent places all
say 5. The endpoint's actual `WHERE` clause (`routes/properties/rent-schedule.ts` → `POST
/send-reminders`) checks `rs.due_date <= CURRENT_DATE + INTERVAL '3 days'`. It has always been 3,
the naming is just wrong everywhere and nobody has renamed it since. **Do not trust the name — read
the SQL** if a rent-reminder timing question ever depends on the exact day count. Left as-is rather
than "fixed" because renaming a column/template used by a live cron job and template registration is
a bigger change than the naming mismatch warrants; flag it to Robert if he wants it corrected properly.

### Local Extraction Script (`scripts/doc-import/`)
Path 2 local extraction — reads PDFs from local hard drive, Ollama extracts, posts to API. **File never uploaded to cloud.**
- Build: `npm install && npm run build` in `scripts/doc-import/` (uses local `npx tsc` — global tsc not required)
- Usage: `node dist/extract.js --type <bank-statement|loan|investment|insurance> --file "C:/JAG Filing/..." [--entity <uuid>] [--account <uuid>] [--dry-run]`
- Config: `scripts/doc-import/.env.doc-import` — `KC_USERNAME`, `KC_PASSWORD` (never commit), `JAG_API_URL`, `OLLAMA_URL`, `OLLAMA_MODEL`
- Auth: Keycloak ROPC (password grant) — token cached per run with 30s early-expiry buffer
- **PDF extraction:** uses `pdf-parse` v1.1.1 — handles FlateDecode-compressed PDFs (e.g. Microsoft Reporting Services output). The old latin1 byte-scan is replaced; raw binary PDFs now decode correctly.
- **TTCD pre-parser (investment type only):** if the PDF matches the Trinidad & Tobago Central Depository (TTCD/TTSE) statement layout (`Closing Balance:` + `Net Movement:` markers), the script bypasses Ollama entirely and parses all holdings programmatically — 100% accuracy, ~2 seconds. Known TTSE tickers hardcoded in `TTSE_TICKERS` array for clean name splitting (add new tickers there when encountered).
- **IBKR pre-parser (investment type only, added 2026-06-16, session 14):** if the input file is a CSV export of an Interactive Brokers **Activity Flex Query → Open Positions (Summary)**, the script bypasses Ollama entirely via `parseIbkrPositions()`. Header matching is normalized (case/space/punctuation-insensitive) to tolerate IBKR's varying column-name conventions.
  - **Required Flex Query field selection** (Performance & Reports → Flex Queries → Create Activity Flex Query → Open Positions, Summary level, output format CSV): Account ID, Symbol, Description, Asset Class, Currency, Quantity, Mark Price, Position Value, Cost Basis Price, Cost Basis Money, Unrealized P/L, Report Date.
  - **Asset class mapping** (`IBKR_ASSET_CLASS_MAP`): `STK→EQUITY`, `ETF→ETF`, `FUND→MUTUAL_FUND`, `BOND→BOND`, `CASH→CASH_EQUIVALENT`. Any other class (`OPT`, `FUT`, `FOP`, `WAR`, `CFD`, etc.) is skipped with a console warning — derivatives aren't tracked in `fin_investments`.
  - **Short/closed positions** (`quantity <= 0`) are skipped with a warning.
  - **FX conversion:** IBKR's `FXRateToBase` converts to the account's own base currency, not TTD, so it's ignored. The script instead calls `GET /finance/fx-rates/:currency/latest` per holding currency and converts `PositionValue`/`FifoPnlUnrealized` into `current_value_ttd`/`unrealised_gain_ttd`. If no TTD rate is on file for that currency, those two fields are left blank — sync first via `POST /finance/fx-rates/sync` or add a manual rate, then backfill via the Investments Update modal.
  - **Not idempotent across reruns:** like the TTCD path this is a plain `INSERT` via `/finance/investments/import` (`idempotency_key` is accepted by the Zod schema but not enforced against the table) — rerunning the same export creates duplicate rows. Use for point-in-time backfill, not a recurring sync. For ongoing valuation updates on holdings already imported, use the Investments panel Update modal (auto-logs to `fin_investment_valuations`).
  - Usage: `node dist/extract.js --type investment --file "C:/path/IBKR_OpenPositions.csv" --entity <uuid> [--dry-run]`
- **Ollama settings:** `num_ctx: 16384` (prevents truncation on longer prompts), timeout 600 s, 2-attempt retry, robust JSON extractor (brace-depth scanner handles prose before/after JSON).
- **Running KC_PASSWORD at runtime (don't store in file):** `$env:KC_PASSWORD = "xxx"; node dist/extract.js ...`
