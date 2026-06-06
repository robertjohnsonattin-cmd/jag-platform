// JAG AI Context Summary Generator v2.1
// Robert Johnson-Attin / Johnson Attin Group
// Generated: May 23, 2026
// Reflects: Master Architecture v1.9 — all 10 final decisions locked + 6 Gemini/Claude review patches
// Patches vs v2.0: Cloudflare Origin Pull (PRE-0B), STD-13 Expand-and-Contract, Keycloak succession
//                  parallel provisioning fix, Loki 14-day retention + large file streaming,
//                  Ollama/Inspiron machine boundary, last_modified_at offline conflict protocol
// SANITISED — safe for AI sessions and external channels
// Does NOT contain: account numbers, ownership %, succession detail, lawyer identities,
//                   net worth figures, asset valuations, TINs

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
            children: [new TextRun({ text: "Architecture v1.9  |  Pre-Build Phase  |  May 2026", size: 22, color: WHITE, font: "Arial" })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 160 },
            children: [new TextRun({ text: "All 10 final architectural decisions locked + 6 Gemini/Claude review patches applied", size: 22, color: JAG_GOLD, font: "Arial", italics: true })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 400 },
            children: [new TextRun({ text: "READY FOR PRE-BUILD", bold: true, size: 24, color: WHITE, font: "Arial" })] }),
        ]
      })]})]}),
    spacer(),

    colorBox(
      "OPSEC NOTICE: This document is the ONLY version to be shared with AI systems, external consultants, or any digital channel. " +
      "It contains NO account numbers, succession instructions, ownership percentages, lawyer identities, or specific financial values. " +
      "The full classified Master Architecture document (JAG_Master_Architecture_v1.9.docx) must remain offline at all times.",
      JAG_RED_L, "8B0000"),
    spacer(),
    colorBox(
      "HOW TO USE THIS DOCUMENT: Load it at the start of every Claude session before any build work. " +
      "It gives Claude the full architectural context needed to write correct, consistent code. " +
      "For code and architecture changes, Claude reads generator scripts directly from the JAG Holdings folder — " +
      "the Master Architecture .docx never needs to be uploaded.",
      JAG_LIGHT),
    spacer(),

    // ── SECTION 1 — PROJECT OVERVIEW ─────────────────────────────────────
    sectionHeader("1. PROJECT OVERVIEW"),
    spacer(),
    body("The JAG Integrated Business Platform is a self-hosted, modular enterprise management system being designed and built by Robert Johnson-Attin for the Johnson Attin Group — a diversified family conglomerate based in Trinidad and Tobago. The platform consolidates operations across 12+ business entities into a single authenticated system with a central financial backbone (JAG Holdings)."),
    spacer(),
    body("THREE GOLDEN RULES (architectural mandates):", { bold: true }),
    bullet("Enter Once — no data is entered twice across any module"),
    bullet("Same Language — all inter-module communication uses the same data structures and APIs"),
    bullet("You Own Everything — self-hosted, no vendor lock-in, no SaaS dependency, complete data sovereignty"),
    spacer(),
    body("Tech stack: PostgreSQL 16 + RLS + pgcrypto, Node.js/TypeScript, Docker + Docker Compose, Caddy + Let's Encrypt, MinIO (self-hosted object storage), Progressive Web App (PWA), Keycloak (self-hosted SSO — decided v1.8), Ollama (local AI model on main Windows workstation — NOT the Dell Inspiron), Loki + Grafana (observability). Hosted on Oracle Cloud Free Tier ARM VM. Local Dell Inspiron = passive WAL streaming target + async MinIO file sync only. Main workstation = dev environment + Ollama AI compute."),
    spacer(),
    body("COMPANION DOCUMENT — load alongside this summary at every build session:", { bold: true }),
    bullet("JAG_Engineering_Standards_v1.0.docx — 13 non-negotiable engineering standards (STD-01 through STD-13). Violations are build defects, not style issues."),
    spacer(),

    // ── SECTION 2 — BUSINESS ENTITIES ────────────────────────────────────
    sectionHeader("2. BUSINESS ENTITIES"),
    spacer(),
    colorBox(
      "CRITICAL — BAR and Members Club are ONE merged module (JAG Entertainment Ops) with a mandatory entity tag per transaction. " +
      "They remain SEPARATE financial entities — independent P&L, revenue, and accounts. Non-negotiable reporting requirement.",
      JAG_RED_L, "8B0000"),
    spacer(),
    colorBox(
      "CRITICAL — Members Club is a PRIVATE SOCIAL CLUB, not a regulated casino. " +
      "Compliance scope: visitor log, chip float open/close reconciliation, cash tracking, annual license renewal alert, standard audit trail. " +
      "NO AML tags, NO Gaming Commission export format, NO hash-chained audit log, NO dual-signature requirements.",
      JAG_GOLD_L),
    spacer(),
    makeTable(
      ["Entity", "Type", "Notes", "Phase"],
      [
        ["JABCO Limited", "Civil engineering & contracting", "Primary revenue entity. Full construction PM: BOQ, variation orders, progress claims, subcontractor retention, Gantt, foreman site diary. Government and private contracts.", "1B, 2"],
        ["JAG Properties", "Property management & acquisition", "Active rental portfolio + Property Pipeline module. Rebuilt on IMS architecture.", "2"],
        ["DragonBridge", "China sourcing, forex, logistics", "Caribbean last-mile delivery concept. Sub-architecture design session required before Phase 3. Spanish customer strings needed Phase 3.", "3"],
        ["JAG Entertainment — BAR", "Food and beverage operations", "Merged with Members Club in one module. Offline-critical (cash logging). Mandatory entity tag per transaction.", "3 (merged)"],
        ["JAG Entertainment — Members Club", "Private members social club", "Simplified spec only. Annual license. Chip float, visitor log, cash tracking. NOT a regulated casino.", "3 (merged)"],
        ["JAG Finance", "Consolidated wealth & banking", "20+ accounts, investments, FX, family net worth, mortgages. Core schema Phase 1B; full UI Phase 4.", "1B / 4"],
        ["IMS", "Inventory & asset management", "Cross-entity barcode/QR standard. Offline-critical for barcode scanning.", "1B+"],
        ["JAG CRM", "Customer relationship management", "Contact master, JABCO sales pipeline, DragonBridge pricing tiers, loyalty.", "1B, 3, 4"],
        ["JAG Lifestyle", "Personal loyalty & rewards tracker", "Cruise, airline, hotel, credit card reward programmes for family members.", "2-4"],
        ["JAG DocVault", "Document management & e-signatures", "DocuSeal (self-hosted). Data Room mode per entity for sale-readiness.", "2"],
        ["JAG Succession Planning", "Estate & access planning module", "Built into JAG Holdings core. Succession activation: parallel Co-Owner provisioning to wife's account; Robert's account never demoted. Annual renewal.", "2"],
        ["Brian's Portal", "Isolated family member portal", "Full mirror of JAG ecosystem scoped to Brian's entities only. Robert sees all.", "3"],
        ["JAG Holdings", "Central financial backbone", "Unified ledger, SSO, insurance, intercompany eliminations. Core schema Phase 1B; full UI Phase 5.", "1B / 5"],
        ["JAG Plantations", "Agricultural land", "Future entity.", "7"],
        ["JAG Trading", "POS retail — online + physical", "Future entity.", "7"],
      ],
      [2160, 1800, 3600, 900]
    ),
    spacer(),

    // ── SECTION 3 — ARCHITECTURE DECISIONS ───────────────────────────────
    sectionHeader("3. ARCHITECTURE DECISIONS — ALL LOCKED (v1.9)"),
    spacer(),
    body("All decisions below are final as of v1.9. Do not re-propose alternatives unless explicitly instructed by Robert.", { bold: true }),
    spacer(),
    makeTable(
      ["Decision", "Chosen Approach", "Status"],
      [
        // ── v1.8 decisions (carried forward) ──
        ["Database engine", "PostgreSQL 16 — self-hosted, five logical databases", "LOCKED"],
        ["Database isolation", "Five logical DBs: jag_core / jag_commercial / jag_entertainment / jag_family / jag_properties. Cross-DB queries via postgres_fdw in JAG Holdings only.", "LOCKED"],
        ["Containerisation", "Docker + Docker Compose", "LOCKED"],
        ["Web server / TLS", "Caddy + Let's Encrypt with Cloudflare DNS-01 wildcard certs. NOT Duck DNS.", "LOCKED"],
        ["DNS (Phase 0-1)", "Existing JABCO domain migrated to Cloudflare Free Tier. Zero cost.", "LOCKED"],
        ["DNS (Before Phase 2)", "Register JAG Holdings domain (~USD 25-50 one-time). All external subdomains build on permanent address from Phase 2.", "LOCKED"],
        ["Authentication", "KEYCLOAK (self-hosted Docker container). Single realm: jag-platform. One client per module. Full role matrix configured in Pre-Build. Replaces Keycloak-or-custom-JWT deferral. Custom JWT rejected.", "LOCKED v1.8"],
        ["Succession activation", "On activation: parallel Co-Owner access provisioned to wife's Keycloak account only. Robert's Owner account is NEVER programmatically demoted or restricted — catastrophic single-point-of-failure risk eliminated (v1.9 fix). True account decommissioning is always a deliberate manual operation requiring direct infrastructure access. Annual credential renewal. DR runbook covers incapacitation fallback.", "LOCKED v1.9"],
        ["Password hashing", "Argon2id — server-side only. NOT on mobile PWA client.", "LOCKED"],
        ["2FA", "TOTP + WebAuthn biometrics for Owner and Domain Admin.", "LOCKED"],
        ["Database migrations", "node-pg-migrate — configured for all five databases before Phase 1 code.", "LOCKED"],
        ["Internal event bus", "Outbox Table Pattern (pending_events table in each of the five databases) + jag-event-dispatcher Docker container polling every 5 seconds. LISTEN/NOTIFY retained for within-database use only. Idempotency keys on all financial endpoints. 3+ retry failures = Tier 1 immediate alert.", "LOCKED v1.8 — replaces cross-DB LISTEN/NOTIFY"],
        ["Notification architecture", "Tiered: Tier 1 immediate (in-app + WhatsApp link) for critical events; Tier 2 daily 7am digest for operational; Tier 3 weekly Monday for administrative. Quiet hours 10pm-6am. Unified notification centre in JAG Holdings dashboard. Phase 1B.", "LOCKED v1.8"],
        ["Backup strategy", "WAL streaming (continuous, all 5 DBs to Dell Inspiron PC mirror) + async MinIO file sync + nightly Restic AES-256 snapshot. NOT hourly full mirrors.", "LOCKED"],
        ["PC mirror spec gate", "Dell Inspiron specs must be verified Pre-Build Day 1 (PRE-0A — min 8GB RAM, 500GB SSD, Win10+). If fails: activate Hetzner/Vultr warm standby (USD 5-6/month) with zero code rework.", "LOCKED v1.8"],
        ["Machine role boundary", "Dell Inspiron = passive WAL streaming target + async MinIO file sync ONLY. It never runs AI workloads. Ollama (Mistral 7B) runs exclusively on Robert's main Windows workstation as a nightly batch agent. Dev environment is also on the main workstation. The three roles (WAL target / AI compute / dev) never run on the same machine.", "LOCKED v1.9"],
        ["Warm standby VPS", "DEFERRED but defined: Hetzner or Vultr ~USD 5-6/month. Zero code rework to activate if Inspiron fails spec check.", "LOCKED"],
        ["AI extraction engine", "Ollama (self-hosted on main Windows workstation — NOT Inspiron), Mistral 7B. Nightly 2am batch. Confidence below 85% = Pending Review queue. Optional per-item external API escalation (opt-in, consent notice shown). CSV/Excel bypass AI entirely. Bank data never leaves infrastructure automatically.", "LOCKED v1.8"],
        ["Object storage", "MinIO — self-hosted, S3-compatible", "LOCKED"],
        ["Observability", "Loki + Grafana in Docker on Oracle VM. Structured JSON logs per module. Loki retention: 14 days maximum (336h, configured in Docker Compose from Phase 1B — enforced from Day 1, not retrofitted). Large DWG/PDF files streamed to PC mirror immediately on upload; compressed web-view stub on VM. Docker images pruned monthly.", "LOCKED v1.9"],
        ["Offline capability", "Offline-critical modules: BAR cash logging, JABCO site diary, IMS barcode scanning. On reconnect: non-conflicting updates auto-merge; conflicts route to Conflict Review queue. Non-financial master records (vendors, suppliers, vehicles) carry last_modified_at + last_modified_by — competing modifications on reconnect route to existing Conflict Review queue with field-level diff. Nothing financial auto-posts on conflict. Client-side idempotency key prevents double-posting.", "LOCKED v1.9"],
        ["JABCO construction PM", "Full lifecycle: BOQ (budgeted vs actual), variation orders, progress claims + payment certificate workflow, subcontractor retention (configurable %, release on PC + defects liability expiry), Gantt programme vs actuals, foreman site diary (mobile PWA, offline). Government and private contracts. Phase 2.", "LOCKED v1.8"],
        ["WiPay integration", "Sandbox POC required in Pre-Build: test confirmed/failed/replay webhook, document payload format, build manual Pending Verification fallback. Full integration Phase 1B.", "LOCKED v1.8"],
        ["i18n", "English + Mandarin Chinese from Phase 1. Framework supports all three languages from Phase 1A. DragonBridge Spanish (customer-facing) Phase 3 mini-sprint. Full platform Spanish Phase 6. Manual translation for all financial/legal/compliance/alert strings. Machine translation for navigation only.", "LOCKED v1.8"],
        ["Members Club spec", "Simplified only: visitor log, chip float open/close reconciliation, cash tracking, annual license alert, standard audit trail. No AML, no Gaming Commission, no hash-chain.", "LOCKED"],
        ["Entertainment reporting", "BAR and Members Club: separate financial entities, mandatory entity tag per transaction (not optional), independent P&L and accounts in JAG Finance.", "LOCKED"],
        ["Build model", "Option C: AI-assisted build, Robert as architect/reviewer/approver. Protected weekly time block. Each phase ends with documented handoff state.", "LOCKED"],
        ["Failover runbook", "Step-by-step, executable by designated family member without Robert present. Includes Keycloak admin reset procedure. Written in Pre-Build.", "LOCKED"],
        // ── v1.9 new decisions ──
        ["Cloudflare Origin Pull (PRE-0B)", "Caddy validates Cloudflare Authenticated Origin Pull certificate. Oracle VM inbound 443 restricted to Cloudflare published IP ranges via Oracle Security List. Direct HTTPS requests to VM public IP that bypass Cloudflare are rejected. Configured PRE-0B — Day 1, before any application code is deployed. Prevents origin bypass if VM IP is discovered.", "LOCKED v1.9"],
        ["Schema migration safety", "STD-13 Expand-and-Contract — columns and tables are never renamed or dropped in a single deployment cycle. 5-step pattern: (1) add new column alongside old, (2) write to both, (3) backfill old data, (4) read from new only, (5) remove old column in a separate migration cycle. Prevents API worker crashes during Docker Compose rolling restarts. HARD RULE.", "LOCKED v1.9"],
      ],
      [2340, 5580, 1440]
    ),
    spacer(),

    // ── SECTION 4 — ROLE MATRIX ───────────────────────────────────────────
    sectionHeader("4. ROLE MATRIX — SINGLE SIGN-ON"),
    spacer(),
    makeTable(
      ["Role", "Access Scope", "Notes"],
      [
        ["Owner", "Full access — all entities, all data, all modules", "Robert Johnson-Attin"],
        ["Domain Admin", "Full CRUD within assigned entity only", "Trusted manager per business unit"],
        ["Operator / Staff", "Scan, log, count, transfer — no delete, no valuations", "Foremen, bar staff, warehouse clerks"],
        ["Auditor", "Read-only, export reports only", "External accountant, insurance broker"],
        ["External Advisor", "Time-limited, scoped read/export only. Auto-expiry. Cannot see outside assigned entity.", "Lawyers (estate review), potential buyers (Data Room mode)"],
        ["Family Member — Emergency Designate", "Full read-only all entities. Can direct staff using complete system visibility.", "Wife — Mandarin Chinese default UI"],
        ["Brian", "Separate portal — his entities only. Cannot see JAG operations.", "Robert's brother"],
        ["System", "API access only — scheduled jobs, integrations, FX pulls, backups", "Automated processes"],
      ],
      [2160, 4320, 2880]
    ),
    spacer(),

    // ── SECTION 5 — PHASE PLAN ────────────────────────────────────────────
    sectionHeader("5. PHASE PLAN"),
    spacer(),
    makeTable(
      ["Phase", "Scope", "Duration"],
      [
        ["Pre-Build (NOW)", "DAY 1: (PRE-0A) Check Dell Inspiron specs. (PRE-0B) Configure Cloudflare Origin Pull on Oracle VM — restrict inbound 443 to Cloudflare IPs, configure Caddy Origin Pull cert, test direct IP access rejected. THEN: ERD/DBML (all 5 DBs incl. pending_events outbox tables). OpenAPI YAML contract. Keycloak config. jag-event-dispatcher deployment + test. WiPay sandbox POC. Bank statement parser POC (Ollama vs real T&T bank PDFs). Cloudflare DNS migration. DR failover runbook (incl. Keycloak admin reset). DragonBridge sub-architecture.", "3-4 weeks"],
        ["Phase 0", "Oracle VM provisioned. Docker + PostgreSQL (5 logical DBs). Caddy + Cloudflare DNS. WAL streaming to PC mirror. Keycloak container. jag-event-dispatcher container. GitHub Actions deploy script.", "1 week"],
        ["Phase 1A", "Keycloak: realm + clients + full role matrix configured. WebAuthn biometric. RLS per database. i18n engine (English + Mandarin; framework supports Spanish from day one). node-pg-migrate on all five databases. Cross-tenant penetration test. MUST COMPLETE before any business module.", "2 weeks"],
        ["Phase 1B", "IMS core (HOME Barataria + Fyzabad, JABCO tool crib, JABCO FLEET, Personal FLEET). JAG Finance core schema + basic ledger (schema complete, UI minimal). JAG CRM contact master + JABCO sales pipeline. Backup system. PWA English + Mandarin. Notification centre (Phase 1B). Loki/Grafana observability (Loki 14-day retention configured from Day 1).", "8-10 weeks"],
        ["Phase 2", "JABCO full construction PM (BOQ, VOs, progress claims, retention, Gantt, site diary). JAG Properties (active management + Property Pipeline). JAG DocVault. JAG Succession Planning module. JAG Lifestyle data entry + member registry. External Advisor auth role. Register JAG Holdings domain before Phase 2.", "6-8 weeks"],
        ["Phase 3", "Brian's Portal. DragonBridge (sub-arch required first). JAG Entertainment Ops (BAR + Members Club merged). NLCB booth. JAG Lifestyle full tracker. DragonBridge Spanish mini-sprint (customer-facing strings).", "6-8 weeks"],
        ["Phase 4", "JAG Finance full UI (20+ accounts, investments, family net worth, mortgages, retirement). AI extraction engine (Ollama on main workstation — nightly batch via Oracle VM intake folder). CRM finance auto-link. JAG Lifestyle net worth integration.", "8-10 weeks"],
        ["Phase 5", "JAG Holdings unified ledger UI. Insurance module. Expense management. Intercompany eliminations. Accountant read-only portal. MS Project sync.", "4-6 weeks"],
        ["Phase 6", "JAG HR (OrangeHRM). NFC fully wired. Spanish full rollout (all remaining modules — DragonBridge already done from Phase 3). OWASP ZAP security audit. Twilio automated messaging.", "4-6 weeks"],
        ["Phase 7", "JAG Plantations. JAG Trading (POS + online retail). New Entity Onboarding workflow.", "12-16 weeks"],
      ],
      [1260, 6660, 1440]
    ),
    spacer(),

    // ── SECTION 6 — ENGINEERING STANDARDS SUMMARY ────────────────────────
    sectionHeader("6. ENGINEERING STANDARDS — QUICK REFERENCE"),
    spacer(),
    body("These 13 standards apply to every line of code across all phases. Full detail in JAG_Engineering_Standards_v1.0.docx. STD-13 added in v1.9.", { italics: true }),
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
        ["STD-13", "Expand-and-Contract Migrations — columns/tables never renamed or dropped in a single cycle. 5-step: add new alongside old > write to both > backfill > read from new only > remove old in separate cycle. Prevents API crashes during Docker Compose rolling restarts.", "HARD RULE — added v1.9"],
      ],
      [540, 6660, 2160]
    ),
    spacer(),

    // ── SECTION 7 — PRE-BUILD CHECKLIST ──────────────────────────────────
    sectionHeader("7. PRE-BUILD CHECKLIST"),
    spacer(),
    makeTable(
      ["#", "Task", "Owner", "Status"],
      [
        ["0A", "Check Dell Inspiron specs (RAM, storage, OS) — WAL streaming target gate. Day 1, 5 minutes. Min: 8GB RAM, 500GB SSD, Win10+.", "Robert", "PENDING — DAY 1"],
        ["0B", "Cloudflare Origin Pull — Day 1 SECURITY CRITICAL. Restrict Oracle VM inbound 443 to Cloudflare IP ranges (Oracle Security List). Configure Caddy to validate Origin Pull certificate. Test: direct HTTPS to VM public IP must be rejected. Must complete before any app code is deployed.", "Robert + Claude", "PENDING — DAY 1"],
        ["1",  "ERD/DBML for all 5 databases (incl. pending_events outbox table in each DB)", "Robert + Claude", "Pending"],
        ["2",  "OpenAPI YAML contract for all API endpoints (idempotency keys on all financial endpoints)", "Robert + Claude", "Pending"],
        ["3",  "Deploy outbox table schema + jag-event-dispatcher Docker container. Test cross-DB event delivery.", "Robert + Claude", "Pending"],
        ["4",  "Configure Keycloak: jag-platform realm, clients per module, full role matrix. Test SSO.", "Robert + Claude", "Pending"],
        ["5",  "WiPay sandbox POC: test confirmed/failed/replay webhooks, document payload, define manual fallback", "Robert + Claude", "Pending"],
        ["6",  "Bank statement parser POC: Ollama vs real T&T bank PDFs (all 6 banks)", "Robert + Claude", "Pending"],
        ["7",  "Migrate JABCO domain to Cloudflare Free Tier (replaces Duck DNS)", "Robert", "Pending"],
        ["8",  "DR failover runbook (Oracle VM to PC mirror + Keycloak admin reset procedure)", "Robert + Claude", "Pending"],
        ["9",  "node-pg-migrate tooling configured for all 5 databases", "Robert + Claude", "Pending"],
        ["10", "Dev/staging/production pipeline + GitHub Actions deploy script + rollback", "Robert + Claude", "Pending"],
        ["11", "Curate Mandarin translations — financial/legal/compliance/alert term list", "Robert", "Pending"],
        ["12", "DragonBridge sub-architecture document (order-to-delivery, customs, landed cost, HS codes)", "Robert + Claude", "Pending"],
        ["13", "Consolidated lawyer meeting (wills, POAs, buy-sell agreement, trustee clauses)", "Robert", "Pending"],
        ["14", "Auth decision (Keycloak vs custom JWT)", "Robert", "DONE — Keycloak v1.8"],
        ["15", "Members Club simplified spec", "Robert + Claude", "DONE — v1.7"],
        ["16", "Five-database isolation architecture", "Robert + Claude", "DONE — v1.7"],
        ["17", "JABCO construction PM specification", "Robert + Claude", "DONE — v1.8"],
        ["18", "Event bus cross-DB gap resolved (outbox pattern)", "Robert + Claude", "DONE — v1.8"],
        ["19", "Offline conflict resolution protocol defined", "Robert + Claude", "DONE — v1.8"],
        ["20", "Notification architecture defined", "Robert + Claude", "DONE — v1.8"],
        ["21", "AI extraction engine specified (Ollama hybrid)", "Robert + Claude", "DONE — v1.8"],
        ["22", "i18n revised (DragonBridge Phase 3 Spanish)", "Robert + Claude", "DONE — v1.8"],
        ["23", "Succession credential custody defined", "Robert", "DONE — v1.8"],
        ["24", "Create sanitised AI Context Summary", "Robert + Claude", "DONE — v2.0"],
        ["25", "Cloudflare Origin Pull defined (PRE-0B)", "Robert + Claude", "DONE — v1.9"],
        ["26", "STD-13 Expand-and-Contract Migrations defined", "Robert + Claude", "DONE — v1.9"],
        ["27", "Keycloak succession parallel provisioning fix applied", "Robert + Claude", "DONE — v1.9"],
        ["28", "Loki 14-day retention + large file streaming defined", "Robert + Claude", "DONE — v1.9"],
        ["29", "Ollama/Inspiron machine role boundary clarified", "Robert + Claude", "DONE — v1.9"],
        ["30", "last_modified_at offline master record conflict protocol defined", "Robert + Claude", "DONE — v1.9"],
      ],
      [360, 4680, 1440, 2880]
    ),
    spacer(),

    // ── SECTION 8 — OPEN DESIGN QUESTIONS ────────────────────────────────
    sectionHeader("8. OPEN DESIGN QUESTIONS"),
    spacer(),
    body("The items below remain unresolved. Each needs a dedicated design session before the relevant phase begins."),
    spacer(),
    makeTable(
      ["Question", "Needed Before", "Notes"],
      [
        ["DragonBridge full sub-architecture", "Phase 3", "China-to-TT order workflow, customs, HS codes, duty calculation, container tracking, landed cost across CNY/USD/TTD. Robert described as most operationally complex entity — thinnest specification in the architecture."],
        ["Daughter's inheritance designation per entity", "Phase 2 (Succession module)", "Which entities, what percentage, at what age trigger. Deferred by Robert — to be resolved in lawyer session."],
        ["Specific growth targets per entity", "Phase 3 (CRM build)", "Revenue targets, hiring triggers, capacity thresholds per entity. Needed to configure CRM growth alerts."],
        ["JAG Lifestyle: programme details", "Phase 2", "Programme names, member numbers, tiers, approximate point balances, credit card reward categories and earn rates per card. Robert to gather and load on first run."],
        ["Exact mortgage and loan count", "Phase 1B (Finance schema)", "Robert estimated ~4 mortgages/business loans, ~8-10 total including credit cards. Exact count needed to size the loan register schema."],
        ["Dell Inspiron specs", "Pre-Build Day 1", "RAM, storage size/type, OS version. Determines whether PC mirror or Hetzner/Vultr is the WAL target. 5-minute check — PRE-0A."],
      ],
      [2700, 1800, 4860]
    ),
    spacer(),

    // ── SECTION 9 — WHAT THIS DOCUMENT DOES NOT CONTAIN ──────────────────
    sectionHeader("9. WHAT THIS DOCUMENT DOES NOT CONTAIN"),
    spacer(),
    colorBox(
      "The following information exists in the full classified Master Architecture only (JAG_Master_Architecture_v1.9.docx). " +
      "That document is OFFLINE ONLY. NEVER share it with any AI system, cloud service, or external consultant.",
      JAG_RED_L, "8B0000"),
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

    // ── SECTION 10 — SESSION INSTRUCTIONS ────────────────────────────────
    sectionHeader("10. SESSION INSTRUCTIONS FOR CLAUDE"),
    spacer(),
    colorBox(
      "At the start of every build session: (1) Load this document. (2) Load JAG_Engineering_Standards_v1.0.docx and paste the Quick Reference block into your session prompt. " +
      "(3) State the phase and module you are building. Claude will read the relevant generator/source files directly from the JAG Holdings folder — no sensitive files need to be uploaded.",
      JAG_GREEN_L),
    spacer(),
    body("What Claude should do in every session:", { bold: true }),
    bullet("Apply all 13 engineering standards (STD-01 through STD-13) from JAG_Engineering_Standards_v1.0.docx to every line of code written"),
    bullet("Never re-propose architecture decisions listed as LOCKED in Section 3"),
    bullet("Write node-pg-migrate files for every schema change — never raw SQL on production. Apply STD-13 Expand-and-Contract for any column rename or drop."),
    bullet("Include idempotency keys on all financial write endpoints"),
    bullet("Write pending_events outbox table entries within the same transaction as financial events — never separately"),
    bullet("Scope all database queries with the correct tenant — never query across database boundaries without postgres_fdw through JAG Holdings"),
    bullet("Use Keycloak JWT claims for role — never trust application-layer role claims alone"),
    bullet("Add last_modified_at + last_modified_by to all shared master record tables (vendors, suppliers, customers, vehicles, assets, projects)"),
    bullet("End every session with a handoff note: what was built, what was tested, what the next session should start with"),
    spacer(),

    divider(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: "Johnson Attin Group  |  JAG Platform Context Summary v2.1  |  Reflects Architecture v1.9  |  Confidential — For AI Session and External Channel Use Only  |  May 2026",
        size: 18, font: "Arial", color: "888888"
      })]
    }),

  ]}]
});

Packer.toBuffer(doc).then(buffer => {
  const outputPath = process.argv[2] || './JAG_AI_Context_Summary_v2.1.docx';
  fs.writeFileSync(outputPath, buffer);
  console.log('Done: ' + outputPath);
});
