// JAG AI Context Summary Generator v2.3
// Robert Johnson-Attin / Johnson Attin Group
// Generated: June 5, 2026
// Reflects: Master Architecture v1.9 + Phase 4 COMPLETE
// Patches vs v2.2: Phase 4 Finance fully complete — all 9 route groups live,
//                  49/49 RLS tests passing (fixes: PROP UUID bug d0000000,
//                  fin_fx_rates test date fixed to 2000-01-01),
//                  AI extraction engine live (Ollama batch + bank statement
//                  jobs + pending review queue),
//                  multer + pdf-parse added to jag-api dependencies,
//                  Phase 5 JAG Holdings unified ledger UI is next.
// SANITISED — safe for AI sessions and external channels

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType, LevelFormat
} = require('docx');
const fs = require('fs');

const JAG_BLUE    = "1F3864";
const JAG_GOLD    = "C9A84C";
const JAG_GOLD_L  = "FFF3CD";
const JAG_GREEN   = "1E6B3C";
const JAG_GREEN_L = "D4EDDA";
const JAG_LIGHT   = "D5E8F0";
const JAG_RED_L   = "FCE4D6";
const JAG_GREY    = "F2F2F2";
const WHITE       = "FFFFFF";
const BORDER_C    = "CCCCCC";

const border   = { style: BorderStyle.SINGLE, size: 1, color: BORDER_C };
const borders  = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0, color: WHITE };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

function h1(text) {
  return new Paragraph({
    spacing: { before: 360, after: 180 },
    children: [new TextRun({ text, bold: true, size: 32, color: JAG_BLUE, font: "Arial" })]
  });
}
function h2(text) {
  return new Paragraph({
    spacing: { before: 260, after: 140 },
    children: [new TextRun({ text, bold: true, size: 26, color: JAG_BLUE, font: "Arial" })]
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    children: [new TextRun({ text, size: 22, font: "Arial", ...opts })]
  });
}
function bullet(text, bold = false) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: 60, after: 60 },
    children: [new TextRun({ text, size: 22, font: "Arial", bold })]
  });
}
function spacer() {
  return new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun("")] });
}
function divider() {
  return new Paragraph({
    spacing: { before: 160, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: JAG_BLUE, space: 1 } },
    children: [new TextRun("")]
  });
}
function colorBox(text, fill, textColor = "000000") {
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders, width: { size: 9360, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR },
      margins: { top: 120, bottom: 120, left: 180, right: 180 },
      children: [new Paragraph({ children: [new TextRun({ text, size: 22, font: "Arial", color: textColor })] })]
    })]})]
  });
}
function sectionHeader(text) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: noBorders, width: { size: 9360, type: WidthType.DXA },
      shading: { fill: JAG_BLUE, type: ShadingType.CLEAR },
      margins: { top: 140, bottom: 140, left: 220, right: 220 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 26, color: WHITE, font: "Arial" })] })]
    })]})]
  });
}
function makeTable(headers, rows, colWidths) {
  const headerRow = new TableRow({
    children: headers.map((h, i) => new TableCell({
      borders, width: { size: colWidths[i], type: WidthType.DXA },
      shading: { fill: JAG_BLUE, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, color: WHITE, font: "Arial" })] })]
    }))
  });
  const dataRows = rows.map((row, ri) => new TableRow({
    children: row.map((cell, ci) => new TableCell({
      borders, width: { size: colWidths[ci], type: WidthType.DXA },
      shading: { fill: ri % 2 === 0 ? WHITE : JAG_GREY, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: cell, size: 20, font: "Arial" })] })]
    }))
  }));
  return new Table({
    width: { size: colWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows]
  });
}

const doc = new Document({
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ]
  },
  styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
  sections: [{ properties: {
    page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
  }, children: [

    // ── COVER ────────────────────────────────────────────────────────────
    new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
      rows: [new TableRow({ children: [new TableCell({
        borders: noBorders, shading: { fill: JAG_BLUE, type: ShadingType.CLEAR },
        margins: { top: 600, bottom: 600, left: 480, right: 480 },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 200 },
            children: [new TextRun({ text: "JOHNSON ATTIN GROUP", bold: true, size: 48, color: JAG_GOLD, font: "Arial" })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 200 },
            children: [new TextRun({ text: "JAG INTEGRATED BUSINESS PLATFORM", bold: true, size: 30, color: WHITE, font: "Arial" })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 200 },
            children: [new TextRun({ text: "AI SESSION CONTEXT SUMMARY", bold: true, size: 26, color: JAG_GOLD, font: "Arial" })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 160 },
            children: [new TextRun({ text: "Architecture v1.9  |  Phase 5 — JAG Holdings Ledger UI (next)  |  June 2026", size: 22, color: WHITE, font: "Arial" })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 400 },
            children: [new TextRun({ text: "Phase 4 Finance COMPLETE. 49/49 RLS tests passing. All finance routes live.", size: 22, color: JAG_GOLD, font: "Arial", italics: true })] }),
        ]
      })]})]
    }),
    spacer(),

    // ── OPSEC + HOW TO USE ───────────────────────────────────────────────
    colorBox("OPSEC NOTICE: This document is the ONLY version to be shared with AI systems, external consultants, or any digital channel. It contains NO account numbers, succession instructions, ownership percentages, lawyer identities, or specific financial values. The full classified Master Architecture document (JAG_Master_Architecture_v1.9.docx) must remain offline at all times.", JAG_RED_L),
    spacer(),
    colorBox("HOW TO USE THIS DOCUMENT: Load it at the start of every Claude session before any build work. It gives Claude the full architectural context needed to write correct, consistent code. For code and architecture changes, Claude reads generator scripts directly from the JAG Holdings folder — the Master Architecture .docx never needs to be uploaded.", JAG_LIGHT),
    spacer(), divider(),

    // ── 1. PROJECT OVERVIEW ──────────────────────────────────────────────
    sectionHeader("1. PROJECT OVERVIEW"),
    spacer(),
    body("The JAG Integrated Business Platform is a self-hosted, modular enterprise management system being designed and built by Robert Johnson-Attin for the Johnson Attin Group — a diversified family conglomerate based in Trinidad and Tobago. The platform consolidates operations across 12+ business entities into a single authenticated system with a central financial backbone (JAG Holdings)."),
    spacer(),
    h2("THREE GOLDEN RULES (architectural mandates):"),
    bullet("Enter Once — no data is entered twice across any module"),
    bullet("Same Language — all inter-module communication uses the same data structures and APIs"),
    bullet("You Own Everything — self-hosted, no vendor lock-in, no SaaS dependency, complete data sovereignty"),
    spacer(),
    body("Tech stack: PostgreSQL 18 (local dev) + RLS + pgcrypto, Node.js/TypeScript strict mode, Docker + Docker Compose, Caddy + Let's Encrypt, MinIO (self-hosted object storage), Progressive Web App (PWA), Keycloak 26.x (self-hosted SSO), Ollama (local AI model on main Windows workstation — NOT the Dell Inspiron), Loki + Grafana (observability — live from Phase 1B). Hosted on Oracle Cloud Free Tier ARM VM. Local Dell Inspiron = passive WAL streaming target + async MinIO file sync only. Main workstation = dev environment + Ollama AI compute."),
    spacer(),
    body("COMPANION DOCUMENT — load alongside this summary at every build session:", { bold: true }),
    body("JAG_Engineering_Standards_v1.1.docx — 13 non-negotiable engineering standards (STD-01 through STD-13). Violations are build defects, not style issues."),
    spacer(), divider(),

    // ── 2. BUSINESS ENTITIES ─────────────────────────────────────────────
    sectionHeader("2. BUSINESS ENTITIES"),
    spacer(),
    colorBox("CRITICAL — BAR and Members Club are ONE merged module (JAG Entertainment Ops) with a mandatory entity tag per transaction. They remain SEPARATE financial entities — independent P&L, revenue, and accounts. Non-negotiable reporting requirement.", JAG_GOLD_L),
    spacer(),
    colorBox("CRITICAL — Members Club is a PRIVATE SOCIAL CLUB, not a regulated casino. Compliance scope: visitor log, chip float open/close reconciliation, cash tracking, annual license renewal alert, standard audit trail. NO AML tags, NO Gaming Commission export format, NO hash-chained audit log, NO dual-signature requirements.", JAG_GOLD_L),
    spacer(),
    makeTable(
      ["Entity", "Type", "Notes", "Phase"],
      [
        ["JABCO Limited", "Civil engineering & contracting", "Primary revenue entity. Full construction PM: BOQ, variation orders, progress claims, subcontractor retention, Gantt, foreman site diary.", "1B, 2"],
        ["JAG Properties", "Property management & acquisition", "Active rental portfolio + Property Pipeline module. Rebuilt on IMS architecture.", "2"],
        ["DragonBridge", "China sourcing, forex, logistics", "Caribbean last-mile delivery concept. Spanish customer strings Phase 3.", "3"],
        ["JAG Entertainment — BAR", "Food and beverage operations", "Merged with Members Club. Offline-critical. Mandatory entity tag per transaction.", "3 (merged)"],
        ["JAG Entertainment — Members Club", "Private members social club", "Simplified spec. Annual license. Chip float, visitor log, cash tracking. NOT a regulated casino.", "3 (merged)"],
        ["JAG Finance", "Consolidated wealth & banking", "Option B: accounts scoped per entity (owner_entity_id). All 9 route groups live. Phase 4 COMPLETE.", "1B / 4"],
        ["IMS", "Inventory & asset management", "Cross-entity barcode/QR standard. Offline-critical for barcode scanning.", "1B+"],
        ["JAG CRM", "Customer relationship management", "Contact master, JABCO sales pipeline, DragonBridge pricing tiers, loyalty.", "1B, 3, 4"],
        ["JAG Lifestyle", "Personal loyalty & rewards tracker", "Cruise, airline, hotel, credit card reward programmes for family members.", "2-4"],
        ["JAG DocVault", "Document management & e-signatures", "DocuSeal (self-hosted). Data Room mode per entity for sale-readiness.", "2"],
        ["JAG Succession Planning", "Estate & access planning module", "Built into JAG Holdings core. Succession activation: parallel Co-Owner provisioning to wife's account; Robert's account never demoted.", "2"],
        ["Brian's Portal", "Isolated family member portal", "Full mirror of JAG ecosystem scoped to Brian's entities only. Robert sees all.", "3"],
        ["JAG Holdings", "Central financial backbone", "Unified ledger, SSO, insurance, intercompany eliminations. Core schema Phase 1B; full UI Phase 5.", "1B / 5"],
        ["JAG Plantations", "Agricultural land", "Future entity.", "7"],
        ["JAG Trading", "POS retail — online + physical", "Future entity.", "7"],
      ],
      [2000, 1600, 4160, 1600]
    ),
    spacer(), divider(),

    // ── 3. ARCHITECTURE DECISIONS ────────────────────────────────────────
    sectionHeader("3. ARCHITECTURE DECISIONS — ALL LOCKED (v1.9 + Phase 4)"),
    spacer(),
    body("All decisions below are final. Do not re-propose alternatives unless explicitly instructed by Robert.", { bold: true }),
    spacer(),
    makeTable(
      ["Decision", "Chosen Approach", "Status"],
      [
        ["Database engine", "PostgreSQL 18 (local dev) — self-hosted, five logical databases", "LOCKED"],
        ["Database isolation", "Five logical DBs: jag_core / jag_commercial / jag_entertainment / jag_family / jag_properties. Cross-DB queries via postgres_fdw in JAG Holdings only.", "LOCKED"],
        ["Containerisation", "Docker + Docker Compose", "LOCKED"],
        ["Web server / TLS", "Caddy + Let's Encrypt with Cloudflare DNS-01 wildcard certs. NOT Duck DNS.", "LOCKED"],
        ["Authentication", "KEYCLOAK 26.x (self-hosted Docker). Single realm: jag. One client: jag-api. Custom JWT mappers: jag_user_id + jag_tenant_id verified live. WebAuthn biometric flow configured.", "LOCKED v1.8 + Phase 3"],
        ["Keycloak 26 User Profile schema", "BREAKING CHANGE: custom user attributes MUST be declared via PUT /admin/realms/jag/users/profile BEFORE setting them. KC26 silently drops undeclared attributes. keycloak-mappers-setup.sh handles this automatically.", "LOCKED — Phase 3"],
        ["PostgreSQL session variables", "ALWAYS use SELECT set_config($1, $2, true). NEVER use SET LOCAL x = $1 — PostgreSQL does not allow parameterised SET statements.", "LOCKED — Phase 1B"],
        ["Finance schema — Option B", "Accounts scoped per JAG entity via owner_entity_id (UUID matching jag_core.tenants.id). Net worth consolidates via fin_net_worth_snapshots. CONSOLIDATED pseudo-entity: 00000000-0000-0000-0000-000000000000.", "LOCKED — Phase 4"],
        ["AI extraction engine", "Ollama (self-hosted on main Windows workstation), mistral model. Nightly 2am batch via npm run batch:statements. Confidence >= 0.85 = auto-import. < 0.85 = pending review queue. Bank data never leaves infrastructure.", "LOCKED — Phase 4"],
        ["File upload", "multer (multipart) in jag-api. Dev: local uploads/statements/ directory. Production: MinIO object storage (path stored in fin_bank_statement_jobs.storage_path).", "LOCKED — Phase 4"],
        ["Succession activation", "Parallel Co-Owner access provisioned to wife's Keycloak account only. Robert's Owner account is NEVER programmatically demoted.", "LOCKED v1.9"],
        ["Observability", "Loki + Grafana in Docker on Oracle VM. Structured JSON logs. 14-day retention. LIVE as of Phase 3.", "LOCKED v1.9"],
        ["Offline capability", "Offline-critical: BAR cash logging, JABCO site diary, IMS barcode scanning. Non-conflicting updates auto-merge; conflicts route to Conflict Review queue.", "LOCKED v1.9"],
        ["Schema migration safety", "STD-13 Expand-and-Contract — columns/tables never renamed or dropped in a single cycle. 5-step pattern.", "LOCKED v1.9"],
        ["Build model", "Option C: AI-assisted build, Robert as architect/reviewer/approver.", "LOCKED"],
      ],
      [2600, 5360, 1400]
    ),
    spacer(), divider(),

    // ── 4. ROLE MATRIX ───────────────────────────────────────────────────
    sectionHeader("4. ROLE MATRIX — SINGLE SIGN-ON"),
    spacer(),
    makeTable(
      ["Role", "Access Scope", "Notes"],
      [
        ["Owner", "Full access — all entities, all data, all modules", "Robert Johnson-Attin"],
        ["Domain Admin", "Full CRUD within assigned entity only", "Trusted manager per business unit"],
        ["Operator / Staff", "Scan, log, count, transfer — no delete, no valuations", "Foremen, bar staff, warehouse clerks"],
        ["Auditor", "Read-only, export reports only", "External accountant, insurance broker"],
        ["External Advisor", "Time-limited, scoped read/export only. Auto-expiry.", "Lawyers (estate review), potential buyers (Data Room mode)"],
        ["Family Member — Emergency Designate", "Full read-only all entities. Can direct staff using complete system visibility.", "Wife — Mandarin Chinese default UI"],
        ["Brian", "Separate portal — his entities only. Cannot see JAG operations.", "Robert's brother"],
        ["System", "API access only — scheduled jobs, integrations, FX pulls, backups", "Automated processes"],
      ],
      [2400, 4360, 2600]
    ),
    spacer(), divider(),

    // ── 5. PHASE PLAN ────────────────────────────────────────────────────
    sectionHeader("5. PHASE PLAN"),
    spacer(),
    makeTable(
      ["Phase", "Scope", "Status"],
      [
        ["Pre-Build", "PRE-0A/0B checklist. ERD/DBML. OpenAPI YAML. Keycloak config. jag-event-dispatcher. WiPay sandbox POC. Bank statement parser POC. Cloudflare DNS. DR failover runbook. DragonBridge sub-architecture.", "COMPLETE"],
        ["Phase 0", "Oracle VM provisioned. Docker + PostgreSQL. Caddy + Cloudflare DNS. WAL streaming. Keycloak container. jag-event-dispatcher. GitHub Actions deploy script.", "COMPLETE"],
        ["Phase 1A", "Keycloak realm + clients + role matrix. WebAuthn biometric. RLS per database. i18n engine (EN + ZH). node-pg-migrate on all five databases. Cross-tenant penetration test.", "COMPLETE"],
        ["Phase 1B", "IMS core. JAG Finance core schema. JAG CRM. Backup system. PWA EN + ZH. Notification centre. Loki/Grafana observability (live).", "COMPLETE"],
        ["Phase 2", "JABCO full construction PM. JAG Properties. JAG DocVault. JAG Succession Planning. JAG Lifestyle data entry.", "COMPLETE"],
        ["Phase 3", "Brian's Portal. DragonBridge. JAG Entertainment Ops (BAR + Members Club merged). NLCB booth. JAG Lifestyle full tracker. All migrations complete. ~122 endpoints live.", "COMPLETE"],
        ["Phase 4", "JAG Finance full UI. All 9 route groups live: accounts, transactions, net-worth, fx-rates, investments, loans, bank-statements, pending-review. AI extraction engine (Ollama batch + fin_bank_statement_jobs + fin_pending_review_queue). 49/49 RLS tests passing.", "COMPLETE"],
        ["Phase 5 (NOW)", "JAG Holdings unified ledger UI. Insurance module. Expense management. Intercompany eliminations. Accountant read-only portal. MS Project sync.", "NEXT"],
        ["Phase 6", "JAG HR (OrangeHRM). NFC fully wired. Spanish full rollout. OWASP ZAP security audit. Twilio automated messaging.", "UPCOMING"],
        ["Phase 7", "JAG Plantations. JAG Trading (POS + online retail). New Entity Onboarding workflow.", "UPCOMING"],
      ],
      [1200, 6160, 2000]
    ),
    spacer(), divider(),

    // ── 6. ENGINEERING STANDARDS ─────────────────────────────────────────
    sectionHeader("6. ENGINEERING STANDARDS — QUICK REFERENCE"),
    spacer(),
    body("These 13 standards apply to every line of code across all phases. Full detail in JAG_Engineering_Standards_v1.1.docx.", { bold: true }),
    spacer(),
    makeTable(
      ["ID", "Rule", "Severity"],
      [
        ["STD-01", "Module Isolation — modules communicate via JAG Holdings API only; never write directly to another module's database tables", "HARD RULE"],
        ["STD-02", "RLS First — tenant isolation enforced at PostgreSQL layer; app-layer filtering is second line of defence", "HARD RULE"],
        ["STD-03", "Test First — write a failing isolation/security test before coding any data-access feature", "HARD RULE"],
        ["STD-04", "Migration First — every schema change is a versioned node-pg-migrate file; never run raw SQL on production", "HARD RULE"],
        ["STD-05", "API Versioning — all endpoints prefixed /api/v1/ from day one; breaking changes require /api/v2/", "ARCHITECTURE"],
        ["STD-06", "Error Envelope — all API responses use { success, data, error, code }; no raw stack traces to clients", "ARCHITECTURE"],
        ["STD-07", "No Secrets in Code — all credentials stored in Oracle Vault / env vars; never in code or Compose files", "HARD RULE"],
        ["STD-08", "Structured Logging — every log event is JSON: timestamp, entity, action, user_id, tenant_id, severity", "ARCHITECTURE"],
        ["STD-09", "TypeScript Strict Mode — strict: true in tsconfig.json; no 'any' types", "ARCHITECTURE"],
        ["STD-10", "Input Validation — all API inputs validated with Zod schemas server-side before touching the database", "HARD RULE"],
        ["STD-11", "Idempotent Financial Ops — all financial writes carry idempotency keys; duplicate delivery never double-posts", "HARD RULE"],
        ["STD-12", "Deploy Gate — production only via automated deploy script; tests pass + migrations run + Robert sign-off", "HARD RULE"],
        ["STD-13", "Expand-and-Contract Migrations — columns/tables never renamed or dropped in a single cycle. 5-step pattern.", "HARD RULE — added v1.9"],
      ],
      [1000, 6760, 1600]
    ),
    spacer(), divider(),

    // ── 7. KEY IMPLEMENTATION FINDINGS ───────────────────────────────────
    sectionHeader("7. KEY IMPLEMENTATION FINDINGS (Phase 3 & 4)"),
    spacer(),
    body("KEYCLOAK 26 BREAKING CHANGE — Declarative User Profile:", { bold: true }),
    body("Custom user attributes (e.g. jag_tenant_id) MUST be declared in the realm User Profile schema via PUT /admin/realms/jag/users/profile BEFORE setting them on any user. KC26 silently drops undeclared attributes — returns HTTP 204 but does NOT persist the value. Script keycloak-mappers-setup.sh handles declaration automatically. The Attributes tab in the KC26 Admin Console is hidden for admin-only attributes — always use the REST API or scripts."),
    spacer(),
    body("POSTGRESQL SESSION VARIABLES:", { bold: true }),
    body("ALWAYS use: SELECT set_config($1, $2, true)   NEVER use: SET LOCAL x = $1 — PostgreSQL does not allow parameterised SET statements. is_local=true scopes the setting to the current transaction. This applies everywhere: withTenantRLS, withOwnerRLS, test setup, migration scripts, batch processor."),
    spacer(),
    body("WebAuthn rpId constraint:", { bold: true }),
    body("KC_WEBAUTHN_RP_ID is bound to the credential at registration time and CANNOT be changed after. Run keycloak-webauthn-setup.sh with KC_WEBAUTHN_RP_ID=jabco.tt BEFORE any user registers a biometric device on the production domain."),
    spacer(),
    body("Finance module RLS pattern:", { bold: true }),
    bullet("jag_family uses withOwnerRLS (app.current_owner_id). Finance tables follow owner-scoped isolation — not tenant-scoped."),
    bullet("fin_fx_rates is a shared reference table — all authenticated owners can read and write. RLS policy: any non-null current_owner_id grants access."),
    bullet("fin_net_worth_snapshots.net_worth_ttd is a PostgreSQL GENERATED column (total_assets_ttd - total_liabilities_ttd STORED). Never set it manually."),
    bullet("CONSOLIDATED net worth row uses pseudo-entity UUID: 00000000-0000-0000-0000-000000000000."),
    spacer(),
    body("AI extraction engine (Phase 4):", { bold: true }),
    bullet("Ollama runs on the main Windows workstation (http://localhost:11434). Model: mistral."),
    bullet("Batch: npm run batch:statements (or node dist/batch/bank-statement-batch.js in prod). Requires BATCH_OWNER_ID and DATABASE_URL_FAMILY env vars."),
    bullet("Confidence >= 0.85 = auto-import as UNCLASSIFIED transaction. < 0.85 = imported with is_pending_review=true + entry in fin_pending_review_queue."),
    bullet("File upload: multer, 20MB limit, PDF/CSV/TXT only. Dev: uploads/statements/ directory. Prod: swap storage_path for MinIO object key."),
    bullet("RLS test fix (Phase 4 close): PROP block UUIDs changed p0->d0 (p is not valid hex). FX rate test changed CURRENT_DATE to fixed date 2000-01-01."),
    spacer(), divider(),

    // ── 8. FINANCE ROUTES — COMPLETE REFERENCE ───────────────────────────
    sectionHeader("8. FINANCE ROUTES — COMPLETE REFERENCE (Phase 4)"),
    spacer(),
    body("All routes under /api/v1/finance/. Protected by requireAuth() + brianPortalGate('FINANCE'). RLS set by withOwnerRLS.", { italics: true }),
    spacer(),
    makeTable(
      ["Route Group", "Endpoints", "File"],
      [
        ["Accounts", "GET/POST /accounts, GET/PATCH/DELETE /accounts/:id", "routes/finance/accounts.ts"],
        ["Transactions", "GET/POST /transactions, GET/PATCH /transactions/:id", "routes/finance/transactions.ts"],
        ["Net Worth", "GET /net-worth, POST /net-worth/snapshot", "routes/finance/net-worth.ts"],
        ["FX Rates", "GET /fx-rates, POST /fx-rates, GET /fx-rates/:currency/latest, GET /fx-rates/:currency", "routes/finance/fx-rates.ts"],
        ["Investments", "GET/POST /investments, GET/PATCH /investments/:id", "routes/finance/investments.ts"],
        ["Loans", "GET/POST /loans, GET/PATCH /loans/:id", "routes/finance/loans.ts"],
        ["Bank Statements", "POST /bank-statements/upload, GET /bank-statements, GET /bank-statements/:id, POST /bank-statements/:id/requeue", "routes/finance/bank-statements.ts"],
        ["Pending Review", "GET /pending-review, GET /pending-review/:id, PATCH /pending-review/:id", "routes/finance/pending-review.ts"],
        ["Batch Processor", "npm run batch:statements (nightly 2am)", "batch/bank-statement-batch.ts"],
      ],
      [2000, 4560, 2800]
    ),
    spacer(), divider(),

    // ── 9. OPEN DESIGN QUESTIONS ─────────────────────────────────────────
    sectionHeader("9. OPEN DESIGN QUESTIONS"),
    spacer(),
    makeTable(
      ["Question", "Needed Before", "Notes"],
      [
        ["DragonBridge full sub-architecture", "Phase 3", "China-to-TT order workflow, customs, HS codes, duty calculation, container tracking, landed cost across CNY/USD/TTD. Most operationally complex entity."],
        ["Daughter's inheritance designation per entity", "Phase 2 (Succession module)", "Which entities, what percentage, at what age trigger. Deferred — to be resolved in lawyer session."],
        ["Specific growth targets per entity", "Phase 3 (CRM build)", "Revenue targets, hiring triggers, capacity thresholds per entity. Needed to configure CRM growth alerts."],
        ["JAG Lifestyle: programme details", "Phase 2", "Programme names, member numbers, tiers, approximate point balances, credit card reward categories and earn rates."],
        ["Finance schema: Option B confirmed", "Phase 4", "RESOLVED — Option B confirmed June 2026. Entity-scoped accounts via owner_entity_id."],
        ["WIPAY_WEBHOOK_SECRET", "Phase 4 (payments)", "Robert to retrieve from WiPay dashboard."],
        ["WIPAY_DEFAULT_OWNER_ID", "Phase 4 (payments)", "Set to Robert's real users.id after first Keycloak login via POST /api/v1/auth/sync-user."],
        ["Real Keycloak users", "Phase 4 / Phase 5", "Create Robert, Wife, Brian, operators in Keycloak. Run bash scripts/set-user-tenant.sh <kc-uuid> <tenant-uuid> for each."],
        ["Production WebAuthn rpId", "Before any user registers biometric on jabco.tt", "Run KC_WEBAUTHN_RP_ID=jabco.tt bash scripts/keycloak-webauthn-setup.sh BEFORE first device registration. Cannot change after."],
        ["MinIO integration for bank statement upload", "Phase 5", "Replace local uploads/statements/ with MinIO. Update storage_path in fin_bank_statement_jobs to MinIO object key. Zero code rework — just swap the multer storage engine."],
        ["Phase 5 ledger UI design", "Phase 5 start", "JAG Holdings unified ledger: chart of accounts, intercompany eliminations, insurance module, expense management scope."],
      ],
      [2400, 2000, 4960]
    ),
    spacer(), divider(),

    // ── 10. TENANT UUIDS ─────────────────────────────────────────────────
    sectionHeader("10. TENANT UUIDs (jag_core.tenants)"),
    spacer(),
    makeTable(
      ["Code", "UUID"],
      [
        ["JAG_HOLDINGS", "00000000-0000-0000-0001-000000000001"],
        ["JABCO", "00000000-0000-0000-0001-000000000002"],
        ["JAG_PROPERTIES", "00000000-0000-0000-0001-000000000003"],
        ["JAG_ENTERTAINMENT", "00000000-0000-0000-0001-000000000004"],
        ["JAG_FINANCE", "00000000-0000-0000-0001-000000000005"],
        ["DRAGONBRIDGE", "00000000-0000-0000-0001-000000000006"],
        ["NLCB", "00000000-0000-0000-0001-000000000007"],
        ["CONSOLIDATED (net worth)", "00000000-0000-0000-0000-000000000000"],
      ],
      [3000, 6360]
    ),
    spacer(), divider(),

    // ── 11. SESSION INSTRUCTIONS ─────────────────────────────────────────
    sectionHeader("11. SESSION INSTRUCTIONS FOR CLAUDE"),
    spacer(),
    body("At the start of every build session: (1) Load this document. (2) Load JAG_Engineering_Standards_v1.1.docx. (3) State the phase and module you are building. Claude will read the relevant source files directly from the JAG Holdings folder — no sensitive files need to be uploaded.", { bold: true }),
    spacer(),
    h2("What Claude must do in every session:"),
    bullet("Apply all 13 engineering standards (STD-01 through STD-13) to every line of code written"),
    bullet("Never re-propose architecture decisions listed as LOCKED in Section 3"),
    bullet("Write node-pg-migrate files for every schema change — never raw SQL on production. Apply STD-13 Expand-and-Contract for any column rename or drop."),
    bullet("Use SELECT set_config($1, $2, true) for PostgreSQL session variables — NEVER SET LOCAL x = $1"),
    bullet("Before setting any new Keycloak custom attribute: declare it in the User Profile schema first. KC26 silently drops undeclared attributes."),
    bullet("Include idempotency keys on all financial write endpoints"),
    bullet("Write pending_events outbox table entries within the same transaction as financial events — never separately"),
    bullet("Scope all database queries with the correct owner/tenant — never query across database boundaries without postgres_fdw through JAG Holdings"),
    bullet("Use Keycloak JWT claims for role — never trust application-layer role claims alone"),
    bullet("Add last_modified_at + last_modified_by to all shared master record tables"),
    bullet("End every session with a handoff note: what was built, what was tested, what the next session should start with"),
    spacer(),
    h2("Current session context (Phase 5 start):"),
    bullet("Phase 4 Finance: COMPLETE. All 9 route groups live. 49/49 RLS tests passing."),
    bullet("AI extraction engine: Ollama batch processor live (batch/bank-statement-batch.ts). Requires BATCH_OWNER_ID + DATABASE_URL_FAMILY."),
    bullet("jag-api new dependencies: multer ^2.1.1, pdf-parse ^2.4.5"),
    bullet("Next: Phase 5 — JAG Holdings unified ledger UI. Insurance module. Expense management. Intercompany eliminations. Accountant read-only portal."),
    spacer(), divider(),

    // ── 12. WHAT THIS DOCUMENT DOES NOT CONTAIN ──────────────────────────
    sectionHeader("12. WHAT THIS DOCUMENT DOES NOT CONTAIN"),
    spacer(),
    body("The following information exists in the full classified Master Architecture only (JAG_Master_Architecture_v1.9.docx). That document is OFFLINE ONLY. NEVER share it with any AI system, cloud service, or external consultant.", { bold: true }),
    spacer(),
    bullet("Bank account numbers, account names, or financial institution details"),
    bullet("Ownership percentages or shareholding structures per entity"),
    bullet("Succession plan specifics — credential custodian identity, will instructions, POA holder names, trustee clauses, executor designations, beneficiary details"),
    bullet("Specific net worth figures, asset valuations, or investment balances"),
    bullet("Legal entity registration numbers or Tax Identification Numbers (TINs)"),
    bullet("Lawyer identities, firm names, or engagement details"),
    bullet("Family member full names beyond Robert Johnson-Attin"),
    bullet("Property addresses, title details, or mortgage lender names"),
    spacer(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 300, after: 0 },
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: JAG_BLUE, space: 4 } },
      children: [new TextRun({ text: "Johnson Attin Group  |  JAG Platform Context Summary v2.3  |  Reflects Architecture v1.9 + Phase 4 COMPLETE  |  Confidential — For AI Session and External Channel Use Only  |  June 2026", size: 16, color: "888888", font: "Arial" })]
    }),

  ]}]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync('C:\\Users\\rober\\Documents\\Claude\\Projects\\JAG Holdings\\JAG_AI_Context_Summary_v2.3.docx', buffer);
  console.log('Written: JAG_AI_Context_Summary_v2.3.docx');
});
