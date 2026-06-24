# JAG Commercial — Full Project Lifecycle Build Specification
**Opportunity Intake → Tender → Award/Loss Gate → Execution → Closeout → Intelligence Loop-Back**
**For Claude Code implementation**
**Owner:** Robert Johnson-Attin | JAG Holdings
**Version:** 1.0 | **Date:** 2026-06-16
**Target modules:** `jag-api/` + `jag-web/` + `jag-infra/`

---

## OVERVIEW

This spec extends the existing JABCO + CRM modules so a construction opportunity flows through one continuous, auditable pipeline:

**Lead → Go/No-Go Gate → BOQ Estimation → Submission → Win/Loss Gate → Mobilization → Execution (progress, VOs, safety, quality) → Closeout/Handover Gate → Historical Intelligence**

It does **not** introduce a new module. It wires together tables and routes that already exist (`crm_sales_pipeline`, `jabco_projects`, `jabco_boq_items`, `jabco_variation_orders`, `jabco_progress_claims`, `jabco_payment_certificates`) and adds the missing pieces: gated state transitions, a bid-intelligence log, task/punch-list/incident/quality tracking, and a client-history query endpoint.

All engineering standards STD-01 through STD-13 apply to every line of code.
All new schema changes are plain numbered `.sql` files in `jag-infra/migrations/jag_commercial/`, run manually and recorded in `__migrations` — **this matches the actual convention already in use in this repo** (016, 017, 018… following 015_vehicles_sim_number.sql), not the node-pg-migrate TS convention CLAUDE.md describes for the platform in general. No raw SQL on production outside this migration runner.
All new financial-relevant writes carry idempotency keys.
All new routes at `/api/v1/`.
`jag_commercial` uses **tenant RLS** (`withTenantRLS`, GUC `app.current_tenant_id`) — NOT owner RLS. Every new table gets a `tenant_id` column and policy, following the pattern in `008_rls_and_indexes.sql`, not the `jag_properties`/`jag_family` owner pattern.

---

## SUGGESTED IMPROVEMENTS, TWEAKS & ADDITIONS TO THE ORIGINAL 6-PHASE PLAN

These are the deltas applied to your draft, and why. The spec below already incorporates all of them — this section exists so you can see what changed before reading 900 lines of SQL and routes.

1. **Don't build a new "Opportunities" table — `crm_sales_pipeline` already is one.** It has `stage` (`pipeline_stage` enum: LEAD/QUALIFIED/PROPOSAL/NEGOTIATION/WON/LOST), `company_id`, `contact_id`, `estimated_value`, `assigned_to`, `idempotency_key`. Your Phase 1 "Opportunity Intake" is just: add two enum values (`SUBMITTED`, `NO_GO`) and a Go/No-Go gate endpoint. Building a parallel table would violate Golden Rule #1 (Enter Once) and STD-01.

2. **`jabco_projects` already has `client_company_id`** (migration `013_jabco_crm_client_fk.sql`, nullable FK → `crm_companies`). Your plan didn't reference this. The Go-decision endpoint should set it automatically from the pipeline record's `company_id` — this is what makes the Phase 6 Intelligence Loop-Back queryable by client without any new linking table.

3. **One bid-intelligence table, not three.** Your plan implies separate tracking for No-Go reasons, Lost-bid post-mortems, and rate-variance flags. These are all "a decision was logged against a client/project at a point in time" — collapsed into one append-only `jabco_bid_log` table with a `log_type` discriminator (`NO_GO`, `LOST_BID`, `RATE_VARIANCE`, `POST_MORTEM`). This is also what makes Phase 6's historical query a single `WHERE client_company_id = $1` scan instead of three UNIONs.

4. **No separate "market rate" reference table.** Your Phase 6 wants to warn when a bid rate is off-market. Rather than maintaining a market-rate database that needs its own data-entry workflow (violates Enter Once), `RATE_VARIANCE` rows accumulate organically every time a bid is lost with rate detail supplied — the table becomes its own market-rate history per `work_package_tag`. Simpler, and the data source is always "a real lost bid," not a guess typed into a maintenance screen.

5. **`AWARDED` needs to be its own `project_status`, not folded into `ACTIVE`.** Your plan jumps from Win to "project execution" — but mobilization (permits, site office, baseline schedule) happens before real site activity, and you'll want a project to sit in a clearly-not-yet-active state with its own checklist. Added `AWARDED` between `TENDER` and `ACTIVE` in the enum.

6. **Variation Order approval should auto-roll the contract value and end date.** Today, approving a VO (`PATCH /variation-orders/:voId`) only flips status — `jabco_projects.contract_value` and `expected_end_date` are never touched, so the "contract value" reported elsewhere in Finance silently drifts from reality every time a VO is approved. This spec adds `time_extension_days` to VOs and updates the approval transaction to roll both fields on the project, in the same DB transaction (matches the existing pattern where cert creation flips claim status in the same `withTenantRLS` callback).

7. **Closeout gate enforced server-side, not just a UI checklist.** Your Phase 5 describes a punch list and handover doc but doesn't say what stops someone from marking a project `CLOSED` with neither done. Added a hard guard in the existing `PATCH /projects/:id` handler: transitioning to `CLOSED` requires zero open punch-list items and a non-null handover document URL, or it 409s. This is the same "state-gated UPDATE" pattern already used for VO approval (`WHERE status = 'PENDING'`) and progress claim certification.

8. **Closeout fires the existing retention-release outbox event instead of inventing a new one.** `jabco_subcontractor_retention` and the `pending_events` outbox already exist. Closeout should `INSERT INTO pending_events (... event_type ...) VALUES (..., 'jabco.project_closed', ...)` so `jag-event-dispatcher` can notify Finance to review retention release — no new infrastructure needed, just a new event type, consistent with the existing `'jabco.claim_certified'` / `'crm.lead_won'` examples already documented in the dbml.

9. **BOQ items need three new columns for margin tracking, but only during TENDER — and they're nullable so EXECUTION-phase BOQ rows (created before this feature existed) are unaffected.** `internal_cost_rate`, `markup_percent`, `final_bid_rate` added to `jabco_boq_items`. On Win, a one-time script sets `unit_rate = final_bid_rate` for that project's BOQ lines so the budget the execution team works against reflects what was actually bid, not the internal cost estimate.

10. **`crm_sales_pipeline` is documented as "JABCO tendering AND DragonBridge deal tracking," but DragonBridge has its own `db_*` tables already (clients, orders, quotes) per the dbml.** In practice nothing currently writes DragonBridge rows into `crm_sales_pipeline`. Rather than risk the Go/No-Go gate logic firing for a future DragonBridge record, this spec adds a `pipeline_type` column (`varchar`, default `'JABCO_TENDER'`, backfilled to that value for all existing rows) so the gate endpoints can filter on it defensively. Cheap insurance, no behavior change today.

11. **Idempotency keys added only where STD-11 actually requires them** — the Go/No-Go gate (creates a `jabco_projects` row) and the Win/Loss gate (creates bid-log rows + mobilization tasks + outbox events). The Submission endpoint just flips a stage and timestamp; no financial or duplicate-creation risk, so no idempotency key required there — avoids over-applying the rule where it adds friction without protecting anything.

12. **i18n namespace `tender` reserved**, not `pipeline` — `pipeline` is already used by the Properties acquisition pipeline per the existing namespace map in CLAUDE.md. New JABCO panels (Tasks, Punch List, Incidents, Quality) extend the existing `jabco` namespace.

13. **Test plan added (none existed in the original draft).** Jest is the existing framework (`npm test` in `jag-api/`, plus `test:rls` for isolation tests) — this spec's test section follows that, not a generic "write tests" instruction.

---

## DATABASE MIGRATIONS — `jag_commercial`

All files go in `jag-infra/migrations/jag_commercial/`, applied in order, each recorded in `__migrations` after running. Enum `ADD VALUE` statements are isolated into their own migration files and never combined with a migration that uses the new value, to avoid any same-transaction visibility edge cases.

### Migration 016 — Pipeline & Project Status Enum Extensions
```sql
-- Pipeline gains SUBMITTED (post-proposal-sent) and NO_GO (killed before bidding).
-- Project gains AWARDED (won, pre-mobilization-complete, not yet ACTIVE).
ALTER TYPE pipeline_stage ADD VALUE 'SUBMITTED';
ALTER TYPE pipeline_stage ADD VALUE 'NO_GO';
ALTER TYPE project_status ADD VALUE 'AWARDED' AFTER 'TENDER';
```

### Migration 017 — Pipeline Tender Fields
```sql
-- STD-13 Expand: all nullable, zero-risk to existing rows.
ALTER TABLE crm_sales_pipeline
  ADD COLUMN pipeline_type        VARCHAR(20) NOT NULL DEFAULT 'JABCO_TENDER'
    CHECK (pipeline_type IN ('JABCO_TENDER','DRAGONBRIDGE_DEAL')),
  ADD COLUMN bid_deadline         DATE,
  ADD COLUMN source_url           TEXT,
  ADD COLUMN assigned_estimator_id UUID,           -- cross-db ref: jag_core.users.id
  ADD COLUMN proposal_document_url TEXT,
  ADD COLUMN submitted_at         TIMESTAMPTZ,
  ADD COLUMN linked_project_id    UUID REFERENCES jabco_projects(id);

CREATE INDEX idx_pipeline_type ON crm_sales_pipeline (pipeline_type);
CREATE INDEX idx_pipeline_linked_project ON crm_sales_pipeline (linked_project_id)
  WHERE linked_project_id IS NOT NULL;

COMMENT ON COLUMN crm_sales_pipeline.linked_project_id IS
  'Set on Go decision — links the opportunity to the jabco_projects row created for it.';
```

### Migration 018 — Bid Intelligence Log
```sql
-- Append-only. One row per gate decision or rate-variance flag.
-- Collapses No-Go reasons, Lost-bid post-mortems, and rate-variance warnings
-- into a single queryable table (see improvement #3/#4 above).
CREATE TABLE jabco_bid_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  log_type            VARCHAR(20) NOT NULL
    CHECK (log_type IN ('NO_GO','LOST_BID','RATE_VARIANCE','POST_MORTEM')),
  pipeline_id         UUID REFERENCES crm_sales_pipeline(id) ON DELETE SET NULL,
  project_id          UUID REFERENCES jabco_projects(id) ON DELETE SET NULL,
  client_company_id   UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  reason_category     VARCHAR(30)
    CHECK (reason_category IN ('RESOURCE_CONSTRAINTS','HIGH_RISK','LOW_MARGIN','STRATEGIC_MISFIT','CLIENT_RELATIONSHIP','SCHEDULE_CONFLICT','OTHER')),
  reason_text         TEXT,
  competitor_name     VARCHAR(200),
  winning_total_price NUMERIC,
  our_total_price     NUMERIC,
  technical_score     NUMERIC,
  financial_score     NUMERIC,
  work_package_tag    VARCHAR(100),
  our_rate            NUMERIC,
  market_rate         NUMERIC,
  variance_pct        NUMERIC,
  logged_by           UUID NOT NULL,  -- cross-db ref: jag_core.users.id
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE jabco_bid_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY jabco_bid_log_tenant ON jabco_bid_log
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE INDEX idx_bid_log_tenant   ON jabco_bid_log (tenant_id);
CREATE INDEX idx_bid_log_client   ON jabco_bid_log (client_company_id);
CREATE INDEX idx_bid_log_type     ON jabco_bid_log (log_type);
CREATE INDEX idx_bid_log_package  ON jabco_bid_log (work_package_tag);
CREATE INDEX idx_bid_log_created  ON jabco_bid_log (created_at DESC);
```

### Migration 019 — BOQ Margin Columns
```sql
ALTER TABLE jabco_boq_items
  ADD COLUMN internal_cost_rate NUMERIC,
  ADD COLUMN markup_percent     NUMERIC,
  ADD COLUMN final_bid_rate     NUMERIC,
  ADD COLUMN work_package_tag   VARCHAR(100);

CREATE INDEX idx_boq_work_package ON jabco_boq_items (work_package_tag)
  WHERE work_package_tag IS NOT NULL;

COMMENT ON COLUMN jabco_boq_items.work_package_tag IS
  'e.g. Concrete, Earthworks, Electrical — used to group historical rate variance by trade.';
```

### Migration 020 — Variation Order Time Extension
```sql
ALTER TABLE jabco_variation_orders
  ADD COLUMN time_extension_days INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN jabco_variation_orders.time_extension_days IS
  'Days added to jabco_projects.expected_end_date on approval. 0 = no schedule impact.';
```

### Migration 021 — Project Tasks (Mobilization + Post-Mortem Checklists)
```sql
CREATE TABLE jabco_project_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  project_id        UUID NOT NULL REFERENCES jabco_projects(id) ON DELETE CASCADE,
  task_type         VARCHAR(20) NOT NULL CHECK (task_type IN ('MOBILIZATION','POST_MORTEM','GENERAL')),
  title             VARCHAR(200) NOT NULL,
  description       TEXT,
  assigned_to       UUID,  -- cross-db ref: jag_core.users.id
  due_date          DATE,
  status            VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','DONE')),
  completed_at      TIMESTAMPTZ,
  last_modified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE jabco_project_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY jabco_project_tasks_tenant ON jabco_project_tasks
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE INDEX idx_tasks_tenant  ON jabco_project_tasks (tenant_id);
CREATE INDEX idx_tasks_project ON jabco_project_tasks (project_id);
CREATE INDEX idx_tasks_status  ON jabco_project_tasks (status);
```

### Migration 022 — Punch List, Site Incidents, Quality Inspections
```sql
CREATE TABLE jabco_punch_list_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  project_id       UUID NOT NULL REFERENCES jabco_projects(id) ON DELETE CASCADE,
  description      TEXT NOT NULL,
  location         VARCHAR(200),
  trade            VARCHAR(100),
  status           VARCHAR(20) NOT NULL DEFAULT 'IDENTIFIED'
    CHECK (status IN ('IDENTIFIED','RECTIFIED','VERIFIED')),
  identified_by    UUID NOT NULL,
  identified_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  rectified_date   DATE,
  verified_by      UUID,
  verified_date    DATE,
  photo_url        TEXT,
  last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE jabco_site_incidents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  project_id       UUID NOT NULL REFERENCES jabco_projects(id) ON DELETE CASCADE,
  incident_date    DATE NOT NULL,
  incident_type    VARCHAR(30) NOT NULL
    CHECK (incident_type IN ('NEAR_MISS','MINOR_INJURY','MAJOR_INJURY','PROPERTY_DAMAGE','ENVIRONMENTAL','OTHER')),
  severity         VARCHAR(10) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  description      TEXT NOT NULL,
  reported_by      UUID NOT NULL,
  corrective_action TEXT,
  status           VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  closed_date      DATE,
  photos           JSONB DEFAULT '[]',
  last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE jabco_quality_inspections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  project_id        UUID NOT NULL REFERENCES jabco_projects(id) ON DELETE CASCADE,
  inspection_date   DATE NOT NULL,
  inspector_name    VARCHAR(200) NOT NULL,
  area_inspected    VARCHAR(200) NOT NULL,
  checklist_result  VARCHAR(15) NOT NULL CHECK (checklist_result IN ('PASS','FAIL','CONDITIONAL')),
  defects_noted     TEXT,
  follow_up_required BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up_date    DATE,
  photos            JSONB DEFAULT '[]',
  last_modified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE jabco_punch_list_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE jabco_site_incidents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE jabco_quality_inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY jabco_punch_tenant      ON jabco_punch_list_items    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY jabco_incidents_tenant  ON jabco_site_incidents      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY jabco_quality_tenant    ON jabco_quality_inspections USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE INDEX idx_punch_project     ON jabco_punch_list_items (project_id);
CREATE INDEX idx_punch_status      ON jabco_punch_list_items (status);
CREATE INDEX idx_incidents_project ON jabco_site_incidents (project_id);
CREATE INDEX idx_quality_project   ON jabco_quality_inspections (project_id);
```

### Migration 023 — Closeout Fields on Projects
```sql
ALTER TABLE jabco_projects
  ADD COLUMN handover_document_url TEXT;

COMMENT ON COLUMN jabco_projects.handover_document_url IS
  'MinIO URL for signed handover certificate. Required (along with zero open punch-list items) before status can transition to CLOSED.';
```

---

## BACKEND ROUTES

Follow the exact pattern already established in `routes/jabco/payment-certs.ts`: Zod `.strict()` schemas, `ProjectParam`/`VOParam`-style param validation, `withTenantRLS(client, req.rlsCtx, ...)`, dual `ok()`/`err()` response helpers (new style: `ok(data)` / `err(message, code)`), `logger.info({entity:'JABCO', action, user_id, tenant_id})`, and a separate `corePool` transaction for `audit_log` inserts on every create/state-change.

### 1. `routes/crm/pipeline.ts` (NEW FILE)

Mounted at `/api/v1/crm/pipeline`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List opportunities, filterable by `stage`, `pipeline_type`, `assigned_to` |
| GET | `/:id` | Single opportunity detail, including linked project if any |
| POST | `/` | Create a new LEAD (existing-style create, `idempotency_key` required) |
| PATCH | `/:id` | Edit general fields (title, estimated_value, bid_deadline, source_url, notes) — only while stage is LEAD/QUALIFIED/PROPOSAL |
| POST | `/:id/go-no-go` | **Go/No-Go gate** (see logic below) |
| POST | `/:id/submit` | **Submission** (see logic below) |
| POST | `/:id/decide` | **Win/Loss gate** (see logic below) |
| GET | `/intelligence` | **Historical bid intelligence** (see logic below) |

**`POST /:id/go-no-go`** — body:
```ts
const GoNoGoSchema = z.object({
  decision:         z.enum(['GO', 'NO_GO']),
  reason_category:  z.enum(['RESOURCE_CONSTRAINTS','HIGH_RISK','LOW_MARGIN','STRATEGIC_MISFIT','CLIENT_RELATIONSHIP','SCHEDULE_CONFLICT','OTHER']).optional(),
  reason_text:       z.string().max(2000).optional(),
  project_code:       z.string().min(1).max(50).optional(),   // required if decision === 'GO'
  client_type:        z.enum(['GOVERNMENT','PRIVATE']).optional(), // required if decision === 'GO'
  contract_currency:  z.string().length(3).default('TTD'),
  idempotency_key:    z.string().uuid(),
}).strict().refine(
  (b) => b.decision === 'GO' ? !!b.project_code && !!b.client_type
                              : !!b.reason_category && !!b.reason_text,
  { message: 'GO requires project_code + client_type; NO_GO requires reason_category + reason_text' },
);
```
Logic, inside one `withTenantRLS` callback on `commercialPool`:
- Load the pipeline row by id; 404 if missing or `pipeline_type !== 'JABCO_TENDER'`; 409 if `stage` is not `LEAD` or `QUALIFIED`.
- Check `idempotency_key` against `jabco_bid_log` (for NO_GO) / `jabco_projects` (for GO) first, same pattern as `payment-certs.ts`.
- **On GO:** `INSERT INTO jabco_projects (tenant_id, project_code, name, client_name, client_type, status, contract_value, contract_currency, client_company_id, project_manager_id, idempotency_key) VALUES (..., status='TENDER', contract_value=COALESCE(pipeline.estimated_value,0), client_company_id=pipeline.company_id, ...)`. Then `UPDATE crm_sales_pipeline SET stage='QUALIFIED', linked_project_id=$newProjectId WHERE id=$1`. Return `{ pipeline, project }`.
- **On NO_GO:** `INSERT INTO jabco_bid_log (tenant_id, log_type, pipeline_id, client_company_id, reason_category, reason_text, logged_by) VALUES (..., 'NO_GO', ...)`. Then `UPDATE crm_sales_pipeline SET stage='NO_GO', assigned_estimator_id=NULL WHERE id=$1` (releases the estimator). Return `{ pipeline, bid_log_entry }`.
- Audit log to `corePool`: action `GO_NO_GO_DECIDED`.

**`POST /:id/submit`** — body: `{ proposal_document_url: string, submitted_at?: ISO date (default now) }`. Requires `stage IN ('QUALIFIED','PROPOSAL','NEGOTIATION')`; state-gated `UPDATE ... WHERE id=$1 AND stage IN (...) RETURNING *`, sets `stage='SUBMITTED'`. No idempotency key (see improvement #11). 404/409 if row missing or in the wrong stage.

**`POST /:id/decide`** — body:
```ts
const DecideSchema = z.object({
  decision:            z.enum(['WON', 'LOST']),
  competitor_name:      z.string().max(200).optional(),
  winning_total_price:  z.number().positive().optional(),
  our_total_price:      z.number().positive().optional(),
  technical_score:      z.number().optional(),
  financial_score:      z.number().optional(),
  package_variances:    z.array(z.object({
                           work_package_tag: z.string().max(100),
                           our_rate:         z.number(),
                           market_rate:      z.number(),
                         })).optional(),
  idempotency_key:      z.string().uuid(),
}).strict().refine(
  (b) => b.decision === 'WON' || (!!b.competitor_name && b.winning_total_price !== undefined),
  { message: 'LOST requires competitor_name + winning_total_price' },
);
```
Requires `stage = 'SUBMITTED'` and `linked_project_id IS NOT NULL` (it always will be — Go always precedes Submit). Logic:
- **On WON:** `UPDATE jabco_projects SET status='AWARDED' WHERE id=$linkedProjectId AND status='TENDER' RETURNING *` (409 if not in TENDER — protects against double-decide). `UPDATE crm_sales_pipeline SET stage='WON'`. Auto-insert `jabco_project_tasks` rows, `task_type='MOBILIZATION'`: "Secure Permits", "Establish Site Office", "Finalize Baseline Schedule", "Mobilize Initial Crew" (configurable array constant `MOBILIZATION_CHECKLIST_TEMPLATE` at top of file). `INSERT INTO pending_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('jabco_project', $projectId, 'jabco.project_awarded', jsonb_build_object('project_id', $projectId))`.
- **On LOST:** `UPDATE jabco_projects SET status='CANCELLED' WHERE id=$linkedProjectId AND status='TENDER'`. `UPDATE crm_sales_pipeline SET stage='LOST'`. `INSERT INTO jabco_bid_log (log_type='LOST_BID', ...)` with competitor/price/score fields. For each entry in `package_variances`, compute `variance_pct = ROUND(((our_rate - market_rate) / market_rate) * 100, 2)` in application code (use `parseFloat` per the numeric-as-string gotcha) and insert a `RATE_VARIANCE` row only when `abs(variance_pct) > 10`. Auto-insert one `jabco_project_tasks` row, `task_type='POST_MORTEM'`, assigned to `pipeline.assigned_estimator_id`, title "Post-Mortem Review — [project_code]".
- Both branches: same `idempotency_key` duplicate-check pattern as `payment-certs.ts` (check `jabco_bid_log` for LOST, check `jabco_project_tasks` insert marker for WON — or simplest: add `idempotency_key UUID UNIQUE` to `jabco_bid_log` too and always write a bid_log row on decide, even for WON with a minimal `log_type` — recommend adding a `'WON'` value to the `log_type` CHECK list in migration 018 if you want a single idempotency anchor for both branches; otherwise gate on the project status transition itself since it's already `WHERE status='TENDER'`-guarded and naturally idempotent).

**`GET /intelligence`** — query params `client_company_id` (required, uuid) + optional `work_package_tags` (comma-separated). Returns:
```json
{
  "win_loss_ratio": { "won": 3, "lost": 1, "ratio": 0.75 },
  "no_go_history": [ { "reason_category", "reason_text", "created_at" } ],
  "lost_bid_history": [ { "competitor_name", "winning_total_price", "our_total_price", "created_at" } ],
  "package_rate_warnings": [
    { "work_package_tag": "Concrete", "avg_variance_pct": 14.2, "sample_size": 3,
      "warning": "Our Concrete rates have historically run 14.2% above market across 3 past bids for this client." }
  ]
}
```
Query: `SELECT log_type, reason_category, reason_text, competitor_name, winning_total_price, our_total_price, work_package_tag, variance_pct, created_at FROM jabco_bid_log WHERE tenant_id = $1 AND client_company_id = $2 ORDER BY created_at DESC`, then group in application code (don't push the aggregation into SQL — the row counts here will always be small enough that application-side grouping is simpler to read and test than a `GROUP BY` + `array_agg`). `win_loss_ratio` comes from a second small query against `jabco_projects WHERE client_company_id = $2 AND status IN ('AWARDED','ACTIVE','PRACTICAL_COMPLETION','DEFECTS_LIABILITY','CLOSED','CANCELLED')` — count `CANCELLED-via-LOST` vs the rest is ambiguous (CANCELLED can also mean a withdrawn awarded project), so instead derive win/loss directly from `jabco_bid_log` row counts (`log_type='LOST_BID'` count vs. count of WON pipeline rows for that client) — simpler and matches the single-source-of-truth principle from improvement #3.

### 2. `routes/jabco/project-tasks.ts` (NEW FILE)
Mounted at `/api/v1/jabco/projects/:projectId/tasks`.
- `GET /` — list tasks for project, optional `?task_type=` filter.
- `POST /` — create task (no idempotency key needed — not financial, not duplicate-risk; matches improvement #11 reasoning).
- `PATCH /:id` — update `status`/`due_date`/`assigned_to`; when `status` set to `DONE`, set `completed_at = now()` server-side regardless of body.

### 3. `routes/jabco/punch-list.ts` (NEW FILE)
Mounted at `/api/v1/jabco/projects/:projectId/punch-list`.
- `GET /` — list, optional `?status=` filter.
- `POST /` — create (`status` defaults `IDENTIFIED`).
- `PATCH /:id` — state-gated transitions only: `IDENTIFIED → RECTIFIED` (sets `rectified_date`), `RECTIFIED → VERIFIED` (sets `verified_by`, `verified_date`). Reject any other transition with 409 `INVALID_TRANSITION`.

### 4. `routes/jabco/site-incidents.ts` + `routes/jabco/quality-inspections.ts` (NEW FILES)
Standard CRUD, mounted at `/api/v1/jabco/projects/:projectId/incidents` and `/api/v1/jabco/projects/:projectId/quality-inspections`. Photos handled via existing MinIO presigned-URL helper in `routes/files/` (same pattern as Properties documents) — array of URLs stored in the `photos` JSONB column.

### 5. Extend `routes/jabco/projects.ts` — `PATCH /:id`
Add a guard before the existing status-update logic:
```ts
if (body.status === 'CLOSED') {
  const openPunch = await c.query(
    `SELECT COUNT(*)::int AS n FROM jabco_punch_list_items WHERE project_id = $1 AND status != 'VERIFIED'`,
    [id],
  );
  const project = await c.query(`SELECT handover_document_url FROM jabco_projects WHERE id = $1`, [id]);
  if (openPunch.rows[0].n > 0) { err(res, 409, 'PUNCH_LIST_INCOMPLETE', `${openPunch.rows[0].n} punch-list item(s) not yet VERIFIED.`); return; }
  if (!project.rows[0]?.handover_document_url) { err(res, 409, 'HANDOVER_DOC_MISSING', 'Handover document must be uploaded before closeout.'); return; }
}
```
On successful transition to `CLOSED`, in the same transaction: `INSERT INTO pending_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('jabco_project', $1, 'jabco.project_closed', jsonb_build_object('project_id', $1))` — Finance picks this up to review `jabco_subcontractor_retention` release (existing table, no new work needed there).

### 6. Extend `routes/jabco/payment-certs.ts` — VO approval
In the `jabcoVOActionRouter.patch('/:voId', ...)` handler, after the existing `UPDATE jabco_variation_orders ... WHERE status='PENDING'` succeeds with `action === 'APPROVED'`, add in the same transaction:
```sql
UPDATE jabco_projects
SET contract_value     = contract_value + $1,
    expected_end_date  = expected_end_date + ($2 || ' days')::interval,
    last_modified_at   = now()
WHERE id = $3
```
using the VO's `amount` and `time_extension_days`. This closes improvement #6 — contract value and schedule now stay accurate automatically.

---

## FRONTEND (`jag-web/`)

- **CRM.tsx** — new "Tender Pipeline" tab. Kanban columns by `stage` (LEAD/QUALIFIED/PROPOSAL/SUBMITTED/NEGOTIATION/WON/LOST/NO_GO). Card click opens detail drawer with Go/No-Go button (opens modal: decision toggle + conditional reason fields), Submit button (modal: proposal doc upload via existing MinIO presigned pattern), Win/Loss button (modal: decision toggle + conditional competitor/price/score fields + dynamic package-variance row adder). When opening the Go/No-Go modal for an opportunity with a `company_id`, fire `GET /crm/pipeline/intelligence?client_company_id=...` in the background and show a small "Past history with this client" card if any rows return — non-blocking, just context.
- **Jabco.tsx** — new tabs: **BOQ** gains columns for `internal_cost_rate`/`markup_percent`/`final_bid_rate`/`work_package_tag` (only editable while project status is `TENDER`); **Tasks** (mobilization + post-mortem checklist, simple list with status toggle); **Punch List** (table with Identify/Rectify/Verify action buttons matching the state machine); **Site Incidents** and **Quality Inspections** (simple log + create forms with photo upload); **Closeout** panel on the project detail page showing punch-list completion count and handover-document upload, with the Close Project button disabled (greyed, with a tooltip) until both conditions are met client-side — mirrors but does not replace the server-side gate.
- **i18n**: new namespace `tender` for the pipeline panel (per improvement #12); extend `jabco` namespace for Tasks/Punch List/Incidents/Quality/Closeout strings. Build English first, translate as a batch at the end per existing workflow. No `t` as a parameter name anywhere (shadowing gotcha). Use stable English keys for any list rendered by translated label (e.g. punch-list status badges).
- **Mobile**: BOQ and Punch List tables get `overflow-x-auto rounded-lg border border-slate-700` wrappers (not `overflow-hidden`). Kanban board on CRM Tender Pipeline tab: on mobile, render as a single-column stage-filtered list with a stage `<select>` instead of side-scrolling columns — better usability on a phone than horizontal Kanban scroll.

---

## TESTING

Framework: Jest (`npm test` in `jag-api/`; RLS-specific suite via `npm run test:rls`). New tests go in `jag-api/src/__tests__/`.

1. **`jabco-lifecycle.test.ts`** (integration, supertest against the Express app) — full happy path: create pipeline LEAD → `go-no-go` GO (assert `jabco_projects` row created with `status='TENDER'` and `client_company_id` set) → add BOQ items → `submit` → `decide` WON (assert `status='AWARDED'`, 4 mobilization tasks created, `pending_events` row inserted) → PATCH project to `ACTIVE` → add a progress claim + cert (existing flow) → approve a VO with `amount=5000, time_extension_days=10` (assert `contract_value` increased by 5000 and `expected_end_date` advanced by 10 days) → add punch-list items → attempt PATCH to `CLOSED` with one item not `VERIFIED` (expect 409 `PUNCH_LIST_INCOMPLETE`) → verify all items, upload handover doc URL, retry PATCH to `CLOSED` (expect 200, assert `pending_events` row with `event_type='jabco.project_closed'`).
2. **`jabco-no-go.test.ts`** — NO_GO without `reason_category`/`reason_text` returns 422; valid NO_GO sets `stage='NO_GO'`, clears `assigned_estimator_id`, inserts `jabco_bid_log` row.
3. **`jabco-lost-bid-variance.test.ts`** — LOST decision with `package_variances` containing one entry at +14% and one at +3%: assert exactly one `RATE_VARIANCE` row inserted (the +14% one), none for the +3% (below the 10% threshold).
4. **`jabco-intelligence.test.ts`** — seed 2 WON + 1 LOST + 1 NO_GO for the same `client_company_id`; assert `GET /intelligence` returns correct `win_loss_ratio`, correct history arrays, and a `package_rate_warnings` entry only for tags with `abs(avg_variance_pct) > 10`.
5. **`test:rls`** — add this module's new tables to the existing tenant-isolation suite: confirm a request scoped to JABCO's tenant cannot read another tenant's `jabco_bid_log`/`jabco_project_tasks`/`jabco_punch_list_items` rows.

---

## DEPLOYMENT

Standard pattern from CLAUDE.md, nothing new:
1. Run migrations 016–023 against production (manual numbered-SQL runner, record each in `__migrations`).
2. `npm run build:prod` in `jag-api/` → SCP `dist/` → `docker compose build api && up -d api`.
3. `npm run build` in `jag-web/` → SCP `dist/` (no container rebuild).
4. `deploy.sh` for the full 7-step gate (TypeScript compile → frontend build → VM check → dist upload → health check → ZAP baseline → frontend upload) — run as-is, no changes needed to the script itself.
5. Robert sign-off per STD-12 before this goes live, since it changes the `project_status` and `pipeline_stage` enums in production.

---

## DECISIONS NEEDED FROM ROBERT BEFORE BUILD STARTS

1. **Mobilization checklist template** — the four default tasks above ("Secure Permits", "Establish Site Office", "Finalize Baseline Schedule", "Mobilize Initial Crew") are placeholders. Confirm or replace with JABCO's actual standard mobilization checklist.
2. **Idempotency anchor for the Win/Loss `decide` endpoint** — add `'WON'` to the `jabco_bid_log.log_type` CHECK list so both WON and LOST always write one row and share one idempotency mechanism (recommended), or rely on the `status='TENDER'`-guarded project update as the sole duplicate-guard (simpler migration, slightly less explicit audit trail for wins). Pick one.
3. **Rate-variance threshold** — this spec hardcodes 10% as the "worth flagging" line for `RATE_VARIANCE` rows. Confirm that's the right number for JABCO's trades, or supply a different threshold.
4. **DragonBridge pipeline_type** — confirm DragonBridge deals genuinely don't use `crm_sales_pipeline` today (this spec assumes they don't, per the `db_*` tables already existing) so the `pipeline_type` column is purely defensive and not closing off something already in use.
