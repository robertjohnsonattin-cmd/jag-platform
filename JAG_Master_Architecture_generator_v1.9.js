// JAG Master Architecture Generator v1.9
// Robert Johnson-Attin / Johnson Attin Group
// Generated: May 23, 2026
// Consolidates: v1.8 final + 6 Gemini/Claude joint review patches (Cloudflare Origin Pull security hardening,
// STD-13 Expand-and-Contract migrations, Keycloak succession parallel provisioning fix,
// Loki retention policy + large file streaming, Ollama/Inspiron role clarification,
// last_modified_at offline master record conflict protocol)

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  PageNumber, PageBreak, LevelFormat
} = require('docx');
const fs = require('fs');

const JAG_BLUE = "1F3864";
const JAG_LIGHT_BLUE = "D5E8F0";
const JAG_GOLD = "C9A84C";
const JAG_GOLD_LIGHT = "FFF3CD";
const JAG_GREEN = "1E6B3C";
const JAG_GREEN_LIGHT = "D4EDDA";
const JAG_GREY = "F2F2F2";
const JAG_RED_LIGHT = "FCE4D6";
const WHITE = "FFFFFF";
const BORDER_COLOR = "CCCCCC";

const border = { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    children: [new TextRun({ text, bold: true, size: 36, color: JAG_BLUE, font: "Arial" })]
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 160 },
    children: [new TextRun({ text, bold: true, size: 28, color: JAG_BLUE, font: "Arial" })]
  });
}

function h3(text) {
  return new Paragraph({
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text, bold: true, size: 24, color: JAG_GOLD, font: "Arial" })]
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

function subbullet(text) {
  return new Paragraph({
    numbering: { reference: "subbullets", level: 0 },
    spacing: { before: 40, after: 40 },
    children: [new TextRun({ text, size: 20, font: "Arial" })]
  });
}

function spacer() {
  return new Paragraph({ spacing: { before: 120, after: 120 }, children: [new TextRun("")] });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

function divider() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: JAG_BLUE, space: 1 } },
    children: [new TextRun("")]
  });
}

function colorBox(text, fillColor, textColor = "000000") {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        borders,
        width: { size: 9360, type: WidthType.DXA },
        shading: { fill: fillColor, type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 120, left: 180, right: 180 },
        children: [new Paragraph({
          children: [new TextRun({ text, size: 22, font: "Arial", color: textColor })]
        })]
      })]
    })]
  });
}

function makeTable(headers, rows, colWidths) {
  const headerRow = new TableRow({
    children: headers.map((h, i) => new TableCell({
      borders,
      width: { size: colWidths[i], type: WidthType.DXA },
      shading: { fill: JAG_BLUE, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({
        children: [new TextRun({ text: h, bold: true, size: 20, color: WHITE, font: "Arial" })]
      })]
    }))
  });
  const dataRows = rows.map((row, ri) => new TableRow({
    children: row.map((cell, ci) => new TableCell({
      borders,
      width: { size: colWidths[ci], type: WidthType.DXA },
      shading: { fill: ri % 2 === 0 ? WHITE : JAG_GREY, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({
        children: [new TextRun({ text: cell, size: 20, font: "Arial" })]
      })]
    }))
  }));
  return new Table({
    width: { size: colWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows]
  });
}

function sectionHeader(text) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        borders: noBorders,
        width: { size: 9360, type: WidthType.DXA },
        shading: { fill: JAG_BLUE, type: ShadingType.CLEAR },
        margins: { top: 160, bottom: 160, left: 240, right: 240 },
        children: [new Paragraph({
          children: [new TextRun({ text, bold: true, size: 28, color: WHITE, font: "Arial" })]
        })]
      })]
    })]
  });
}

// GAP block helper — title + description rendered as a small bordered box
function gapBlock(num, title, status, lines) {
  const headerCell = new TableCell({
    borders,
    width: { size: 9360, type: WidthType.DXA },
    shading: { fill: JAG_BLUE, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 160, right: 160 },
    children: [new Paragraph({
      children: [
        new TextRun({ text: `GAP ${num} — ${title}  `, bold: true, size: 22, color: WHITE, font: "Arial" }),
        new TextRun({ text: status, bold: true, size: 22, color: JAG_GOLD, font: "Arial" })
      ]
    })]
  });
  const bodyChildren = lines.map(line =>
    new Paragraph({
      numbering: { reference: "bullets", level: 0 },
      spacing: { before: 40, after: 40 },
      children: [new TextRun({ text: line, size: 20, font: "Arial" })]
    })
  );
  const bodyCell = new TableCell({
    borders,
    width: { size: 9360, type: WidthType.DXA },
    shading: { fill: WHITE, type: ShadingType.CLEAR },
    margins: { top: 120, bottom: 120, left: 200, right: 200 },
    children: bodyChildren
  });
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({ children: [headerCell] }),
      new TableRow({ children: [bodyCell] })
    ]
  });
}

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
      },
      {
        reference: "subbullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "○", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1080, hanging: 360 } } } }]
      },
      {
        reference: "numbers",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
      }
    ]
  },
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: JAG_BLUE },
        paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: JAG_BLUE },
        paragraph: { spacing: { before: 300, after: 160 }, outlineLevel: 1 } }
    ]
  },
  sections: [{
    properties: {
      page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
    },
    children: [

      // ===================== COVER PAGE =====================
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
        rows: [new TableRow({ children: [new TableCell({
          borders: noBorders, width: { size: 9360, type: WidthType.DXA },
          shading: { fill: JAG_BLUE, type: ShadingType.CLEAR },
          margins: { top: 720, bottom: 720, left: 480, right: 480 },
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 480, after: 240 },
              children: [new TextRun({ text: "JOHNSON ATTIN GROUP", bold: true, size: 56, color: JAG_GOLD, font: "Arial" })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 240 },
              children: [new TextRun({ text: "JAG", bold: true, size: 96, color: WHITE, font: "Arial" })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 480 },
              children: [new TextRun({ text: "MASTER ARCHITECTURE DOCUMENT", bold: true, size: 32, color: JAG_LIGHT_BLUE, font: "Arial" })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 120 },
              children: [new TextRun({ text: "Version 1.9  |  May 2026", size: 22, color: WHITE, font: "Arial" })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 240 },
              children: [new TextRun({ text: "All 31 gaps resolved  |  6 Gemini/Claude review patches applied  |  READY FOR PRE-BUILD", size: 22, color: JAG_GOLD, font: "Arial", italics: true })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 480 },
              children: [new TextRun({ text: "Owner: Robert Johnson-Attin  |  Barataria, Trinidad & Tobago", size: 22, color: JAG_LIGHT_BLUE, font: "Arial" })] }),
          ]
        })]
      })]
      }),
      spacer(),
      colorBox("CONFIDENTIAL — For internal use only. This document contains sensitive business architecture and financial information belonging to Robert Johnson-Attin and the Johnson Attin Group.", JAG_RED_LIGHT, "8B0000"),
      spacer(),
      new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "This document is the master blueprint for the JAG Integrated Business Platform.", size: 22, font: "Arial", italics: true })] }),
      new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "Share it at the start of every Claude session to maintain full context.", size: 22, font: "Arial", bold: true })] }),
      spacer(),
      colorBox(
        "CHANGE LOG: " +
        "v1.9 (May 23, 2026) — Six targeted patches from joint Gemini + Claude architectural review: (1) CLOUDFLARE ORIGIN PULL — Caddy enforces Cloudflare Authenticated Origin Pull; inbound 443 restricted to Cloudflare IP ranges on Oracle Security List; prevents origin bypass if VM IP is discovered; added as PRE-0B Day 1 before any code. (2) STD-13 EXPAND-AND-CONTRACT MIGRATIONS — columns and tables never renamed or dropped in a single cycle; 5-step pattern mandatory for all destructive schema changes. (3) KEYCLOAK SUCCESSION FIX — activation provisions parallel Co-Owner access to Wife's account only; Robert's account never programmatically demoted; decommissioning remains a deliberate manual process. (4) LOKI RETENTION POLICY — mandatory 14-day Loki retention from Day 1; DWG files and large PDFs streamed to PC mirror on upload; Docker image pruning monthly; storage risk updated to Year 3+. (5) OLLAMA/INSPIRON ROLE CLARIFICATION — Dell Inspiron = passive WAL target and file sync only; Ollama runs exclusively on main Windows workstation; roles never compete on same hardware. (6) OFFLINE MASTER RECORD CONFLICT PROTOCOL — Section 10B.3 added; all shared master record tables carry last_modified_at + last_modified_by; divergence routes to existing Conflict Review queue; no vector clocks needed. | " +
        "v1.8 (May 23, 2026) — Final pre-build architectural review. 10 decisions locked: (1) AUTH LOCKED — Keycloak self-hosted, single realm jag-platform, succession activation protocol added. (2) EVENT BUS CORRECTED — outbox table pattern replaces cross-DB LISTEN/NOTIFY; jag-event-dispatcher polls every 5 sec. (3) AI EXTRACTION SPECIFIED — Ollama local primary (Mistral 7B, nightly batch on PC mirror), opt-in per-item API escalation. (4) JABCO CONSTRUCTION PM ADDED — Section 10A: BOQ, variation orders, progress claims, subcontractor retention, Gantt vs actuals, foreman site diary. Phase 2. (5) OFFLINE CONFLICT RESOLUTION — Section 10B: BAR/JABCO/IMS offline-critical; Conflict Review queue; nothing financial auto-posts on conflict; client-side idempotency key. (6) INSPIRON SPEC GATE — Pre-Build Day 1: verify specs; if fail activate Hetzner/Vultr warm standby. (7) WIPAY PRE-BUILD POC — sandbox credentials, all webhook scenarios tested, manual Pending Verification fallback defined. (8) NOTIFICATION ARCHITECTURE — Section 12.6: Tier 1 immediate, Tier 2 daily 7am digest, Tier 3 weekly Monday; quiet hours 10pm-6am; unified notification centre. (9) SPANISH REVISED — DragonBridge customer strings Phase 3 mini-sprint; full platform Spanish Phase 6. i18n framework Phase 1A supports all three languages. (10) SUCCESSION CREDENTIAL — Wife-only sealed envelope; annual renewal; DR runbook covers incapacitation fallback. | v1.7 (May 2026) — All remaining Unified Architect Critique findings incorporated. New sections added: 4.2 i18n Specification (H-06 — manual translation standard for T&T financial/legal terms, Robert review process, translation management interface); 5.7 Dev/Staging/Production Pipeline (H-05 — three-environment model, GitHub Actions automation, mandatory deploy script, rollback procedure); 15A Testing Strategy (H-04 — Jest framework, financial calculation tests, integration tests, cross-tenant isolation tests, UAT sign-off gates per phase); 12.3 Data Quality Rules (M-02 — duplicate detection, mandatory fields, pending-review state for non-Owner entry); 12.4 Service Level Targets (M-04 — Tier 1/2/3 uptime targets with alert thresholds); 12.5 Data Archival Policy (M-05 — 24-month inactivity threshold, flag-based archival, financial records exempt); 16A Build Resource Model (H-10 — Option C confirmed, 10-15 hours/week, Robert role boundaries, pause/re-entry protocol). Role matrix updated: External Advisor role added (M-01 — time-limited, scoped, auto-expiry); Auditor role corrected (Gaming Commission reference removed). Loki + Grafana added to tech stack (H-07). GAP 10 archival definition updated to reference Section 12.5. Critique B-05 (event handling), H-01 (Finance core in Phase 1B), H-02 (Phase 1A/1B split), IMS table contradiction, and Gaming Commission risk row all corrected in prior pass. Original v1.7 critique incorporations: (1) DNS changed from Duck DNS to Cloudflare Free Tier — Phase 0-1 uses existing JABCO domain (zero cost); JAG Holdings domain to be registered before Phase 2 (~USD 25-50 one-time). (2) Backup strategy upgraded: WAL streaming (continuous, all 5 databases) + async MinIO file sync + nightly Restic snapshot — replaces hourly full mirror. (3) JAG Entertainment Ops module: BAR and Members Club merged operationally into one module; every transaction carries a mandatory entity tag (BAR or MEMBERS CLUB); separate chart of accounts, P&L, and revenue lines maintained per entity in JAG Finance. (4) Members Club compliance simplified: visitor log, chip float open/close reconciliation, cash tracking, annual license renewal alert, standard audit trail only — AML tags, Gaming Commission exports, hash-chained audit log, and dual-signature requirements removed as over-engineered for a private social club. (5) Twilio reclassified from optional upgrade to Phase 6 planned. (6) Five-database isolation architecture formalised: jag_core, jag_commercial, jag_entertainment, jag_family, jag_properties — cross-DB queries via postgres_fdw in JAG Holdings only. (7) Pre-Build phase added (3-4 weeks before Phase 0): ERD/DBML, OpenAPI contract, auth decision, migration tooling, Cloudflare DNS, DR failover runbook, bank parser POC. (8) OPSEC protocol implemented: Master Architecture classified offline-only; JAG_AI_Context_Summary_v1.0.docx is the only version for AI sessions and external channels. (9) VPS warm standby option documented (Hetzner/Vultr ~USD 5-6/month) — deferred, zero code rework to activate. (10) Build model confirmed as Option C — AI-assisted with Robert as architect/reviewer. (11) [POST-CRITIQUE CORRECTIONS] IMS domain table corrected — Members Club row now reflects simplified spec (visitor log, chip float, cash tracking only); AML/Gaming Commission/dual-signature language removed from IMS table to match Entertainment Ops section. (12) Phase table corrected — Phase 0 updated to Cloudflare DNS + five logical databases; Phase 1 split into 1A (auth/security foundation) and 1B (business modules + JAG Finance CORE SCHEMA added); Phase 4 clarified as Finance FULL UI only, built on Phase 1B schema. (13) Event handling architecture added (Critique B-05 BLOCKER): PostgreSQL LISTEN/NOTIFY internal event bus, dead-letter queue table, idempotency keys on all financial endpoints, race condition protection via advisory locks — eliminates silent data loss risk on webhook failure. (14) Section 1A added — Engineering Standards cross-reference: all 12 non-negotiable standards (STD-01 through STD-12) now enumerated in the architecture document with links to companion document JAG_Engineering_Standards_v1.0.docx; Claude session instruction embedded to load both documents together. " +
        "v1.6 (May 22, 2026) — Three architecture gaps closed: (1) GAP 31 R&D Pipeline assigned Phase 2 build slot. (2) Financial module completeness note added — Father's joint account conversion confirmed as open action; Wife's and Brian's personal accounts fully tracked. (3) Wife and Brian formally added as independent succession subjects with their own wills, beneficiaries, and executor structures — not only as roles in Robert's succession plan. Lawyer meeting agenda updated accordingly. " +
        "v1.5 (May 22, 2026) — All 31 architecture gaps resolved (GAPs 16-30 completed in session; GAP 31 added: New Entity Onboarding & R&D Pipeline). New JAG Lifestyle module added (personal loyalty cards + credit card rewards for family). CRM detail expanded per GAP 3. Specialized platforms table updated to include JAG CRM, JAG DocVault, JAG Succession Planning, JAG Lifestyle. Outstanding action items consolidated including JAG Properties buy-sell agreement and BAR/CASINO trustee clause. " +
        "v1.4 (May 21, 2026) — Clarified naming: Robert Johnson-Attin (personal name, hyphen retained) vs Johnson Attin Group (brand name, no hyphen). " +
        "v1.3 — Cover page hyphen fixed. All payment methods now universal (receive + pay) for all entities. USD accounts at local T&T banks added. Computershare CAD/USD noted with USD consolidation target. " +
        "v1.2 — Name corrected to Johnson Attin (no hyphen). Wife upgraded to full read-only access across ALL entities in Mandarin Chinese. Robert login now supports Mandarin Chinese as switchable language. Emergency designate role formally documented for wife. " +
        "v1.1 — Added Personal FLEET, Brian full mirror, Property Pipeline, enhanced security, external tools, full payment methods, foreign accounts, WhatsApp direct links, Mandarin Chinese from Phase 1.",
        JAG_GOLD_LIGHT),

      pageBreak(),

      // ===================== SECTION 1 — EXECUTIVE SUMMARY =====================
      sectionHeader("1. EXECUTIVE SUMMARY"),
      spacer(),
      body("The Johnson Attin Group (JAG) is a diversified conglomerate based in Trinidad & Tobago, owned and managed by Robert Johnson-Attin. The JAG Integrated Business Platform is a unified, self-hosted, zero-recurring-cost digital infrastructure designed to manage all aspects of Robert's business and personal affairs from one ecosystem."),
      spacer(),
      body("The platform is built on a modular architecture: specialized systems for each business domain, all connected to a central financial backbone (JAG Holdings), with a single login, no redundant data entry, and complete data sovereignty. The platform is fully bilingual (English + Mandarin Chinese) from Phase 1, with Spanish added in Phase 6."),
      spacer(),
      body("As of v1.9 (May 2026): all 31 architecture gaps are resolved, all Unified Architect Critique and Gemini/Claude joint review patches incorporated, 10 final architectural decisions locked, and 6 additional security and reliability patches applied (Cloudflare Origin Pull, STD-13 Expand-and-Contract, Keycloak succession parallel provisioning, Loki retention policy, Ollama/Inspiron role isolation, offline master record conflict protocol). The Pre-Build phase (3-4 weeks) may now begin."),
      spacer(),
      makeTable(
        ["Principle", "Value"],
        [
          ["Owner", "Robert Johnson-Attin"],
          ["Domicile", "Barataria, Trinidad & Tobago (alternate: Fyzabad)"],
          ["Architecture", "Modular — specialized platforms + central financial backbone"],
          ["Hosting", "Oracle Cloud Always Free VM + local PC mirror"],
          ["Cost", "Zero recurring cost (electricity only)"],
          ["Data ownership", "100% self-hosted — Robert owns every byte"],
          ["Privacy", "No third-party data sharing — fully private"],
          ["Access", "Progressive Web App (PWA) — any device, any location"],
          ["Languages", "English + Mandarin Chinese (Phase 1); Spanish (Phase 6)"],
          ["Gaps status", "All 31 gaps resolved"],
          ["Document version", "1.9 — May 2026 — FINAL PRE-BUILD"],
        ],
        [3120, 6240]
      ),

      pageBreak(),

      // ===================== SECTION 1A — ENGINEERING STANDARDS =====================
      sectionHeader("1A. ENGINEERING STANDARDS — COMPANION DOCUMENT"),
      spacer(),
      body("The JAG platform is built across 7 phases and an estimated 18-24 months. Multiple Claude sessions will contribute code across that timeline. To prevent inconsistency between sessions — where a module built in month three handles tenant isolation differently from one built in month one — a companion engineering standards document has been established."),
      spacer(),
      body("COMPANION DOCUMENT: JAG_Engineering_Standards_v1.1.docx"),
      spacer(),
      body("This document defines 13 non-negotiable engineering standards that apply to every line of code written for the JAG platform, regardless of phase, module, or Claude session. These are not style preferences — violations are build defects that must be rolled back and fixed before proceeding."),
      spacer(),
      body("INSTRUCTION FOR CLAUDE SESSIONS: Load JAG_Engineering_Standards_v1.1.docx alongside this architecture document at every build session. The standards document contains the full rule, rationale, a bad example, and a correct implementation for each standard. The Quick Reference block in Section 2 of that document should be pasted into your session prompt."),
      spacer(),
      makeTable(
        ["ID", "Standard", "Category", "Severity"],
        [
          ["STD-01", "Module Isolation — modules communicate via JAG Holdings API only; never write directly to another module's database tables", "Security", "HARD RULE"],
          ["STD-02", "RLS First — tenant isolation enforced at the PostgreSQL database layer; application-layer filtering is second line of defence, not the first", "Security", "HARD RULE"],
          ["STD-03", "Test First — write a failing tenant-isolation or security test before coding any data-access feature; ship only when the test passes", "Testing", "HARD RULE"],
          ["STD-04", "Migration First — every schema change (table, column, index, RLS policy) is a versioned node-pg-migrate file; never run raw SQL on production manually", "Data", "HARD RULE"],
          ["STD-05", "API Versioning — all endpoints prefixed /api/v1/ from day one; breaking changes require /api/v2/", "API", "ARCHITECTURE"],
          ["STD-06", "Error Envelope — all API responses use { success, data, error, code } format; no raw stack traces to clients", "API", "ARCHITECTURE"],
          ["STD-07", "No Secrets in Code — all credentials, API keys, JWT secrets, and tokens stored in Oracle Vault / environment variables; never in code or Docker Compose files", "Security", "HARD RULE"],
          ["STD-08", "Structured Logging — every server-side log event is a JSON object with: timestamp, entity, action, user_id, tenant_id, severity", "Logging", "ARCHITECTURE"],
          ["STD-09", "TypeScript Strict Mode — strict: true in tsconfig.json on all projects; no 'any' types permitted", "Data", "ARCHITECTURE"],
          ["STD-10", "Input Validation — all API inputs (body, query params, path params) validated with Zod schemas server-side before touching the database", "Security", "HARD RULE"],
          ["STD-11", "Idempotent Financial Ops — all financial write operations carry idempotency keys; duplicate webhook delivery or retry never produces duplicate postings", "Data", "HARD RULE"],
          ["STD-12", "Deploy Gate — code goes to production only via the automated deploy script; three conditions required: all tests pass, all migrations run, Robert sign-off", "Deployment", "HARD RULE"],
          ["STD-13", "Expand-and-Contract Migrations — columns and tables are never renamed or dropped in a single deployment cycle. Step 1: add new column alongside old. Step 2: write to both. Step 3: backfill old data. Step 4: read from new column only. Step 5: remove old column in a separate migration cycle. Prevents API worker crashes during Docker Compose rolling restarts.", "Data", "HARD RULE"],
        ],
        [468, 5148, 936, 936]
      ),
      spacer(),
      body("HARD RULE = Non-negotiable. A violation is a build defect — roll back and fix before continuing. ARCHITECTURE = Structural decision locked for the platform lifetime; changes require a written change request and version increment on the standards document."),
      spacer(),
      body("STD-01, STD-02, and STD-03 originated from the Third Architect review (Unified Architect Critique v1.0, May 2026). STD-04 through STD-12 were established by Claude and confirmed in the standards document v1.0 (May 22, 2026). STD-13 added in v1.9 following Gemini/Claude joint review (May 23, 2026)."),

      pageBreak(),

      // ===================== SECTION 2 — CORPORATE STRUCTURE =====================
      sectionHeader("2. JAG CORPORATE STRUCTURE"),
      spacer(),
      body("All entities sit under the Johnson Attin Group umbrella. JAG Holdings serves as the central financial backbone connecting all operating entities."),
      spacer(),

      h2("2.1 JAG Holdings (Central Financial Backbone)"),
      body("JAG Holdings is the financial and data orchestration layer consolidating all entities. It provides:"),
      bullet("One unified financial ledger across all businesses and personal accounts"),
      bullet("Complete family net worth dashboard (Robert + wife + daughter + father + Brian)"),
      bullet("Insurance management module across all entities"),
      bullet("Succession planning module covering Robert, Wife, Father, Brian, Daughter"),
      bullet("Single sign-on across all platforms"),
      bullet("Central backup and security layer"),
      bullet("No redundant data entry — master records shared across all systems"),
      bullet("Multi-language interface — English and Mandarin Chinese from day one"),
      spacer(),

      h2("2.2 Operating Entities"),
      spacer(),
      makeTable(
        ["Entity", "Code", "Type", "Ownership / Status"],
        [
          ["JABCO Limited", "JABCO", "Civil Engineering & Contracting", "Active — Robert sole owner; Wife & Brother directors only (no equity)"],
          ["DragonBridge", "DRAGON", "China Sourcing, Forex & Logistics", "Active — Robert"],
          ["JAG Properties", "PROPS", "Real Estate, Property Mgmt & Acquisition Pipeline", "Active — Robert + Brother + Father"],
          ["JAG Entertainment — BAR", "BAR", "Bar Operations", "Active — Wife's name"],
          ["JAG Entertainment — CASINO", "CASINO", "Gaming Operations", "Active — Wife's name"],
          ["JAG Impressions", "IMPRESS", "Printing & Branding", "Dormant — Robert"],
          ["JAG Finance", "FINANCE", "Investments, Banking & Family Wealth", "Active — Robert + Family"],
          ["JABCO FLEET", "FLEET-JABCO", "Vehicles registered & insured under JABCO", "Active"],
          ["Personal FLEET", "FLEET-PERS", "Vehicles owned personally by Robert & family", "Active"],
          ["HOME — Barataria", "HOME-BARA", "Personal Household Barataria", "Active"],
          ["HOME — Fyzabad", "HOME-FYZ", "Personal Household Fyzabad", "Active"],
          ["JAG Plantations", "PLANT", "Agricultural", "Future"],
          ["JAG Trading", "TRADE", "Retail / POS (online + brick & mortar)", "Future"],
        ],
        [2340, 1440, 2880, 2700]
      ),
      spacer(),
      body("Additional future entities will be added via the New Entity Onboarding workflow (see GAP 31).", { italics: true }),
      spacer(),

      h2("2.3 Brian's Portal (Full Mirror — Separate Access)"),
      body("Brian (Robert's brother) has a completely separate portal that mirrors the full JAG ecosystem scoped to his world. Robert has full visibility of Brian's data in JAG Holdings. Brian logs in separately and sees only his entities."),
      spacer(),
      makeTable(
        ["Brian's Domain", "Code", "Type", "Mirrors JAG Domain"],
        [
          ["Brian — Personal HOME", "BRIAN-HOME", "Personal household & all belongings", "HOME"],
          ["Brian — Personal FLEET", "BRIAN-FLEET", "Personal vehicles", "Personal FLEET"],
          ["Brian — Personal Accounts", "BRIAN-FIN", "Personal banking & investments", "JAG Finance"],
          ["Brian — Personal Insurance", "BRIAN-INS", "Personal insurance policies", "JAG Holdings Insurance"],
          ["Brian — Parlor", "BRIAN-PARLOR", "Retail convenience store — stock, sales, suppliers", "JAG Trading"],
          ["Brian — NLCB Lotto Booth", "BRIAN-NLCB", "Lottery retail — float, reconciliation, NLCB compliance", "JAG Entertainment"],
          ["Brian — Expenses", "BRIAN-EXP", "Personal and business expense tracking", "JAG Holdings Expenses"],
        ],
        [2340, 1440, 2700, 2880]
      ),
      spacer(),
      colorBox("Brian's portal is a complete, standalone experience. He can manage his entire life through it independently. All data flows up to Robert's JAG Holdings master view automatically.", JAG_GREEN_LIGHT),
      spacer(),

      h2("2.4 Family Members Tracked"),
      makeTable(
        ["Member", "Role in System", "Domains Visible", "Language"],
        [
          ["Robert Johnson-Attin", "Owner — full access everything", "All entities + Brian's portal", "English + Mandarin (switchable)"],
          ["Wife (b. Dec 22, 1974)", "Full read-only — all JAG entities + emergency designate", "All entities (read only)", "Mandarin Chinese (default)"],
          ["Daughter (13 years)", "Graduated 13 read-only HOME -> 16 operational HOME -> 18 full HOME -> 21 manage designated -> 25 full Owner", "Currently HOME only, expands with age", "English"],
          ["Father (86 years)", "Tracked entity — care information & assets, plus dependent in succession", "HOME only", "English"],
          ["Brian (brother)", "Separate portal — own entities only", "Brian's portfolio only", "English"],
        ],
        [2340, 2340, 2340, 2340]
      ),
      spacer(),
      colorBox("MANDARIN CHINESE: The entire platform UI is available in Mandarin Chinese from Phase 1. Robert's wife has full read-only access to ALL JAG entities with Mandarin Chinese as her default language — she can view the complete state of every business in an emergency without needing Robert present. Robert's own login also supports Mandarin Chinese as a switchable language. All menus, labels, reports, alerts, and dashboards translate instantly.", JAG_LIGHT_BLUE),

      pageBreak(),

      // ===================== SECTION 3 — PLATFORM ARCHITECTURE =====================
      sectionHeader("3. PLATFORM ARCHITECTURE"),
      spacer(),
      body("The JAG platform uses a modular architecture. Each business domain has a specialized system optimized for its specific workflows. All systems share the same underlying technology stack and connect to JAG Holdings via APIs."),
      spacer(),

      h2("3.1 The Three Golden Rules"),
      spacer(),
      colorBox("RULE 1: Enter data ONCE — master records are shared across all systems. No re-entry.", JAG_GREEN_LIGHT),
      spacer(),
      colorBox("RULE 2: Every system speaks the SAME language — same architecture, same APIs, same security model.", JAG_LIGHT_BLUE),
      spacer(),
      colorBox("RULE 3: You OWN everything — self-hosted, zero vendor lock-in, complete data sovereignty.", JAG_GOLD_LIGHT),
      spacer(),

      h2("3.2 Platform Naming"),
      body("All platform names are labels only — they can be renamed in the admin UI in under 30 seconds with zero impact on data, code, or integrations. No rebuilding required."),
      spacer(),

      h2("3.3 Specialized Platforms"),
      spacer(),
      makeTable(
        ["Platform", "Domains Served", "Key Features", "Phase"],
        [
          ["IMS (Inventory Management System)", "JABCO, DRAGON, HOME, BAR, Members Club, JABCO FLEET, Personal FLEET", "Asset register, barcode/QR, photos, multi-project allocation, compliance exports, vehicle tracking", "1-4"],
          ["JAG Properties", "PROPS", "Tenancy management, rent tracking, WiPay, BIR calculator, maintenance, inspections, tenant portal, Property Pipeline & acquisition analysis", "2"],
          ["JAG Entertainment Ops", "BAR + Members Club", "Single module — mandatory entity tag per transaction (BAR or MEMBERS CLUB). BAR: liquor stock, par levels. Members Club: visitor log, chip float open/close reconciliation, cash tracking, annual license renewal alert, standard audit trail. Separate P&L per entity in JAG Finance.", "3-4"],
          ["JAG CRM", "JABCO, DRAGON, BAR, Members Club, TRADING, Brian's", "Customer master, JABCO sales pipeline (tender-driven), DragonBridge pricing tiers, BAR/Members Club loyalty, segmentation, WhatsApp outreach", "1, 3, 4"],
          ["JAG Finance", "FINANCE + all entity financials", "20+ account aggregation, investment tracking, family net worth, FX (TTD/USD/CNY), foreign banks, mortgage & loan register, retirement projection", "4"],
          ["JAG Lifestyle", "Personal rewards (Robert, Wife, Daughter, Father, Brian)", "Loyalty programmes (cruise, airline, hotel), credit card rewards, spend optimiser, expiry alerts, net worth integration", "2-4"],
          ["JAG DocVault", "All entities", "OCR scanned PDFs, version control, Robert-only access, time-limited external share links, Data Room mode per entity", "2"],
          ["JAG Succession Planning", "Core module IN JAG Holdings", "Asset ownership, beneficiaries, access rights, signing authority, POA registry, will references", "2"],
          ["JAG HR", "All entities", "Staff register, NIS tracking, payroll (future) — OrangeHRM", "5-6"],
          ["Brian's Portal", "All Brian entities", "Full mirror — home inventory, vehicles, parlor, NLCB, accounts, expenses, insurance", "3"],
          ["JAG Plantations", "PLANT", "Crop tracking, harvest scheduling, yield management", "Future (7)"],
          ["JAG Trading", "TRADE", "POS, retail inventory, online + brick & mortar", "Future (7)"],
        ],
        [2340, 1800, 3600, 1080]
      ),
      spacer(),

      h2("3.4 Shared Master Data Layer"),
      body("These master records are entered once and referenced across all systems:"),
      spacer(),
      makeTable(
        ["Master Record", "Owned By", "Used By"],
        [
          ["Vendors & Suppliers", "IMS / JAG Finance", "JABCO, DRAGON, BAR, Members Club, JAG Trading, Brian's Parlor"],
          ["Customers & Tenants", "JAG CRM / JAG Properties / IMS", "PROPS, DRAGON, JAG Trading, JAG Finance, JABCO"],
          ["Bank Accounts (local + foreign)", "JAG Finance", "All entities for expense attribution and reconciliation"],
          ["Properties & Locations", "JAG Properties", "PROPS, HOME, IMS containers"],
          ["JABCO Vehicles", "JABCO FLEET", "JABCO projects, all entities for transport"],
          ["Personal Vehicles", "Personal FLEET", "HOME, JAG Finance (insurance, depreciation)"],
          ["Users & Roles", "JAG Holdings", "All platforms via single sign-on"],
          ["Insurance Policies", "JAG Holdings", "All entities for coverage tracking and gap analysis"],
          ["Projects (JABCO)", "IMS", "Equipment allocation, expense tracking, MS Project sync"],
          ["FX Rates (TTD/USD/CNY)", "JAG Finance", "IMS valuations, DRAGON landed costs, all financials"],
          ["AutoCAD Drawing Files", "JAG DocVault", "JABCO projects — attached as DWG files"],
          ["Loyalty Programmes & Cards", "JAG Lifestyle", "JAG Finance (rewards value -> net worth)"],
          ["Suppliers Performance Records", "JAG CRM / IMS", "Reorder prioritisation, rush-order preference"],
        ],
        [2880, 2340, 4140]
      ),

      pageBreak(),

      // ===================== SECTION 4 — TECHNOLOGY STACK =====================
      sectionHeader("4. TECHNOLOGY STACK"),
      spacer(),
      body("All platforms are built on the same technology stack, ensuring consistency, portability, and zero vendor lock-in."),
      spacer(),
      makeTable(
        ["Layer", "Technology", "Why"],
        [
          ["Database", "PostgreSQL 16 + Row-Level Security + pgcrypto", "Free, powerful, self-hostable, encrypted at column level"],
          ["Backend API", "Node.js / TypeScript", "Consistent with existing codebase"],
          ["Frontend", "Progressive Web App (PWA)", "Any device, any location — no app store fees"],
          ["Internationalisation", "i18n framework — English + Mandarin Chinese + Spanish", "Wife manages in Chinese, future Spanish markets"],
          ["Authentication", "Keycloak (self-hosted) + Argon2id + TOTP 2FA + WebAuthn biometric", "DECISION LOCKED v1.8: Keycloak is the identity provider. Single realm: jag-platform. One client per module. Roles map to role matrix. Keycloak handles token refresh, logout-everywhere, role propagation across all 7 phases. Argon2id for password hashing. TOTP 2FA for Owner and Domain Admin. WebAuthn biometric for mobile re-unlock. Custom JWT rejected."],
          ["File Storage", "MinIO (self-hosted)", "Free, S3-compatible, runs on same VM"],
          ["Containerisation", "Docker + Docker Compose", "Portable — runs on Oracle VM or any hardware"],
          ["Reverse Proxy / HTTPS", "Caddy + Let's Encrypt", "Free, automatic TLS 1.3 certificates"],
          ["Domain / DNS", "Cloudflare Free Tier", "Phase 0-1: existing JABCO domain on Cloudflare (zero cost). Before Phase 2: register JAG Holdings domain (~USD 25-50 one-time). Cloudflare provides DNS-01 wildcard TLS, DDoS protection, and commercial-use compliance. Duck DNS prohibited (ToS bars commercial use; no wildcard DNS-01 support)."],
          ["Backup encryption", "Restic AES-256", "Encrypted backups — useless if stolen"],
          ["Messaging — free", "WhatsApp Direct Links (wa.me)", "Free — user clicks to send. No third-party cost."],
          ["Messaging — automated", "Twilio (Phase 6 — planned)", "Fully automated background sending. Confirmed for Phase 6 — not optional."],
          ["Payments (T&T)", "WiPay", "Trinidad local online payment gateway"],
          ["Payments (ACH)", "TransACH / TTIPS", "Trinidad interbank electronic transfers"],
          ["E-Signatures", "DocuSeal (self-hosted)", "Free lease and contract signing"],
          ["Project Management", "MS Project (external sync)", "Complex JABCO projects via XML/CSV export"],
          ["Observability", "Loki + Grafana (self-hosted, free)", "Structured JSON logging per module centralised in Loki. Grafana dashboards for API error rate, backup job status, FX rate update failures, WiPay webhook activity. Alert thresholds: API error rate > 1%, backup failure, FX silence > 24 hours, WiPay webhook silence > 24 hours. Both run in Docker on the same Oracle VM — zero additional cost."],
          ["Internal Event Bus", "Outbox Table Pattern + jag-event-dispatcher (Docker) + LISTEN/NOTIFY (within-DB only)", "CORRECTED v1.8: LISTEN/NOTIFY cannot cross database boundaries — a notification in jag_properties cannot be heard by jag_core. Fix: pending_events outbox table in each database. Events written atomically with business record. jag-event-dispatcher Docker container polls each DB every 5 seconds, delivers to jag_core, marks delivered. 3+ retries = Tier 1 alert. LISTEN/NOTIFY retained within-database only. Dead-letter and idempotency key logic unchanged."],
          ["Integrations", "REST APIs + Webhooks + PostgreSQL LISTEN/NOTIFY", "Connects all platforms to JAG Holdings — with retry and dead-letter protection on all financial events"],
        ],
        [2340, 2700, 4320]
      ),
      spacer(),

      h2("4.1 External Tools Integration"),
      body("These desktop tools are used by Robert externally and integrate with the JAG platform as follows:"),
      spacer(),
      makeTable(
        ["Tool", "Integration Method", "Used For"],
        [
          ["MS Project", "XML/CSV export -> JAG Holdings monthly sync", "Complex JABCO project timelines, Gantt charts, resource planning"],
          ["AutoCAD", "DWG files stored in JAG DocVault", "JABCO engineering drawings attached to projects and properties"],
          ["Adobe Acrobat", "PDF viewing of JAG-generated reports and contracts", "Viewing documents generated by the platform"],
          ["Microsoft Excel", "CSV export from every JAG module", "Ad-hoc financial analysis, BIR tax preparation"],
          ["Microsoft Word", "DOCX export for contracts and reports", "Formal documents generated via DocuSeal"],
          ["Microsoft Office (general)", "Standard document viewing and editing", "Day-to-day office work outside the platform"],
        ],
        [2340, 3120, 3900]
      ),
      spacer(),
      colorBox("NOTE: None of these external tools need to be licensed or paid for within the JAG platform. They are used independently by Robert on his Windows PC. The platform generates compatible export formats for all of them.", JAG_GOLD_LIGHT),
      spacer(),

      h2("4.2 Internationalisation (i18n) Specification"),
      body("The platform is fully bilingual English + Mandarin Chinese from Phase 1. Spanish is added in two stages: DragonBridge customer-facing strings in Phase 3 (invoices, order confirmations, customer portal — needed within 12 months), and full platform rollout in Phase 6. The i18n framework is built Phase 1A to support all three languages from the start. This section defines the translation standard, review process, and scope — because machine translation of T&T-specific financial and legal terms produces errors that are unacceptable in a system Robert's wife uses for emergency business decisions."),
      spacer(),
      makeTable(
        ["Category", "Translation Approach", "Reviewer"],
        [
          ["Navigation, menus, labels, buttons", "Machine translation acceptable — Google Translate or DeepL as baseline", "Robert spot-checks on first release"],
          ["Financial terms (TTD, USD, CNY, FX, net worth, equity, ledger, reconciliation)", "Manual translation — curated before Phase 1A build", "Robert reviews and approves all"],
          ["T&T-specific legal/regulatory terms (BIR, LBT, PTT, NIS, VAT, TransACH, LINX, WiPay, TTSE, Gaming Act, NLCB)", "Manual translation — many have no direct Chinese equivalent; phonetic + explanatory translation used", "Robert reviews and approves all"],
          ["Compliance alerts (license renewal, tax deadlines, NIS filings)", "Manual translation — urgency and accuracy are critical", "Robert reviews and approves all"],
          ["Error messages and system alerts", "Manual translation — ambiguous machine translations can cause wrong actions", "Robert reviews and approves all"],
          ["Report headings (P&L, Rent Roll, Occupancy, Balance Sheet)", "Manual translation", "Robert reviews and approves all"],
        ],
        [2160, 3240, 2700]
      ),
      spacer(),
      bullet("All translations stored in JSON i18n files per language: en.json, zh.json, es.json (Phase 6). One file per module. Strings keyed by semantic ID (e.g. 'finance.bir_threshold_alert'), never by English text."),
      bullet("Translation management interface built in Phase 1A — Robert can update any string from the admin UI without a code deployment. New strings added by developers appear in a 'Pending Translation' queue."),
      bullet("Machine translation is never used for any string marked financial, legal, compliance, or alert. These categories require Robert's manual review before the string goes live."),
      bullet("T&T-specific terms with no direct Mandarin equivalent use the pattern: phonetic transliteration + bracketed explanation. Example: BIR -> Shuiwu Ju (Trinidad Tax Authority, phonetic Mandarin)."),
      bullet("On each phase release: Robert runs through the full Mandarin UI for new features and confirms all new strings are correct before go-live."),
      colorBox("BLOCKER RESOLVED (H-06): Multilingual build is now fully specified. The i18n framework is not a single line in the tech stack — it is a defined standard with clear scope, translation categories, review process, and a translation management interface.", JAG_GREEN_LIGHT),

      pageBreak(),

      // ===================== SECTION 5 — INFRASTRUCTURE =====================
      sectionHeader("5. INFRASTRUCTURE & HOSTING"),
      spacer(),

      h2("5.1 Primary Server — Oracle Cloud Always Free VM"),
      makeTable(
        ["Specification", "Value"],
        [
          ["CPU", "4 ARM cores (Ampere A1)"],
          ["RAM", "24 GB"],
          ["Boot disk", "50 GB"],
          ["Block storage", "150 GB"],
          ["Monthly cost", "USD $0.00 — permanently free"],
          ["OS", "Ubuntu 24.04 LTS"],
          ["Location", "US East (Ashburn) — closest free-tier region to Trinidad"],
          ["Setup guide", "IMS_Oracle_Cloud_Setup_v1.0.md (in your Inventory Management folder)"],
        ],
        [3120, 6240]
      ),
      spacer(),

      h2("5.2 Local Mirror — Robert's PC"),
      bullet("WAL streaming (continuous replication) from Oracle VM to Robert's Windows PC — all 5 databases (jag_core, jag_commercial, jag_entertainment, jag_family, jag_properties) replicated in near-real-time"),
      bullet("Complete data sovereignty — every byte exists locally at all times"),
      bullet("Disaster recovery — PC mirror promotes to primary in under 4 hours if Oracle goes down"),
      bullet("Offline access during internet outages — PWA caches data"),
      bullet("Photo archive — originals older than 12 months tier to PC mirror only"),
      colorBox("SPEC GATE (v1.8 — Pre-Build Day 1): Dell Inspiron specs must be verified before WAL streaming target is confirmed. Minimum: 8 GB RAM, 500 GB free storage (SSD preferred), Windows 10/11 or Ubuntu. If specs pass: proceed as designed. If specs fail: activate Hetzner or Vultr warm standby (USD 5-6/month) as primary WAL target — zero code rework, Docker config change only. Takes 5 minutes. Resolves the single largest infrastructure uncertainty before Pre-Build begins.", JAG_GOLD_LIGHT),
      spacer(),
      colorBox("MACHINE BOUNDARY (v1.9 — EXPLICIT): Dell Inspiron role = passive WAL streaming target + async MinIO file sync only. It never runs AI workloads. Ollama (Mistral 7B) runs exclusively on Robert''s main Windows workstation as a nightly batch agent. The two roles are on separate hardware and never compete for CPU. If the Inspiron fails the spec gate and is replaced by a warm standby, Ollama on the workstation is completely unaffected.", JAG_LIGHT_BLUE),
      spacer(),

      h2("5.3 Backup Strategy"),
      makeTable(
        ["Backup Type", "Frequency", "Destination", "Encryption", "Retention"],
        [
          ["WAL streaming (database)", "Continuous — real-time", "Robert's Windows PC (all 5 databases)", "Restic AES-256", "Full history — point-in-time recovery"],
          ["MinIO file sync", "Async — event-triggered on upload", "Robert's Windows PC", "Restic AES-256", "Full history"],
          ["Nightly Restic snapshot", "Nightly", "Oracle Object Storage (free) + Google Drive", "Restic AES-256", "30 days Oracle / 12 weeks Google Drive"],
        ],
        [1800, 1440, 2340, 2340, 1800]
      ),
      spacer(),
      colorBox("KEY ESCROW: Encryption keys and SSH private keys stored in Oracle Vault AND in a sealed physical envelope with Robert's lawyer. Required for disaster recovery.", JAG_GOLD_LIGHT),
      spacer(),

      h2("5.4 Disaster Recovery (GAP 6 outcome)"),
      bullet("Acceptable downtime: 4 hours in early phases, faster once WAL streaming is live"),
      bullet("Acceptable data loss: Near-zero — WAL streaming provides continuous replication (RPO < 5 minutes)"),
      bullet("DR drills run every 6 months"),
      bullet("Failover runbook to be documented during Pre-Build phase — procedure known by Robert, Wife, and Brother"),
      bullet("VPS warm standby option: Hetzner or Vultr ~USD 5-6/month — deferred until needed, zero code rework to activate"),
      bullet("Quarterly backup verification: Google Drive readable + Restic restore tested"),
      spacer(),

      h2("5.5 Future Hardware Upgrade Path"),
      bullet("NAS device (Synology or QNAP) — recommended for long-term reliability and 24/7 uptime"),
      bullet("Dedicated physical server in JABCO office"),
      bullet("Old Dell Inspiron (Intel Pentium) — suitable for development and testing"),
      body("Migration is straightforward — copy Docker stack and data to new hardware. Estimated 4 hours. No rebuilding required.", { italics: true }),
      spacer(),

      h2("5.6 Power Resilience (Trinidad)"),
      bullet("UPS (Uninterruptible Power Supply) — TTD $3,000 to $5,000 one-time investment for local server"),
      bullet("Oracle Cloud VM completely unaffected by local power outages in Trinidad"),
      bullet("PWA continues working offline during power/internet outages, syncs automatically when restored"),
      spacer(),

      h2("5.7 Development / Staging / Production Pipeline"),
      body("No code goes directly from a Claude session to production. Every change passes through three defined environments."),
      spacer(),
      makeTable(
        ["Environment", "Location", "Purpose", "Access"],
        [
          ["Development (dev)", "Robert's local Windows PC", "All new code written and tested here first. Claude sessions target dev. No live data.", "Robert only"],
          ["Staging (/staging)", "Oracle VM — separate Docker stack", "Integration testing against a production-identical environment with anonymised data. UAT sign-off happens here.", "Robert + Wife (read-only UAT)"],
          ["Production (/production)", "Oracle VM — live Docker stack", "Live system. No direct code changes. Only promote from staging after UAT sign-off.", "All authorised users"],
        ],
        [1800, 2160, 3240, 1800]
      ),
      spacer(),
      bullet("GitHub Actions (free) automates deployment: push to main branch triggers pull, migrate, build, restart on staging. One manual promotion step to production."),
      bullet("Deploy script includes one-command rollback to previous version — run before any deployment, verified working before Phase 1B go-live."),
      bullet("The Dell Inspiron serves as passive WAL streaming target + file sync mirror only — not as dev environment, not as AI compute host. Development happens on Robert's main workstation. Ollama AI batch processing also runs on the main workstation. These three roles (dev, WAL target, AI) are never combined on one machine."),
      bullet("Manual deployments (git pull, docker compose up by hand) are prohibited from Phase 2 onwards. All deployments go through the deploy script."),
      colorBox("BLOCKER RESOLVED (H-05): Dev/staging/production pipeline is now architecturally defined. No code touches production without passing through staging and UAT sign-off.", JAG_GREEN_LIGHT),

      pageBreak(),

      // ===================== SECTION 6 — SECURITY =====================
      sectionHeader("6. SECURITY & DATA PROTECTION"),
      spacer(),
      body("The JAG platform is designed with a defence-in-depth approach. Even if the server hardware were physically stolen or the database copied, the data would be unreadable without the encryption keys."),
      spacer(),

      h2("6.1 Encryption Layers"),
      makeTable(
        ["Layer", "Technology", "What It Protects"],
        [
          ["Data in transit", "TLS 1.3", "All data between browser/app and server is encrypted — cannot be intercepted"],
          ["Database columns", "pgcrypto AES-256", "PII, financial data, contact details encrypted at column level in PostgreSQL — unreadable even with raw DB access"],
          ["Passwords", "Argon2id hashing", "Passwords never stored in plain text — even if DB stolen, passwords cannot be recovered"],
          ["Backups", "Restic AES-256", "All backup files encrypted before leaving server — useless if intercepted or stolen"],
          ["SSH access", "Ed25519 key pair", "Server access requires private key — password login disabled entirely"],
          ["2FA", "TOTP (Google Authenticator style)", "Second factor required for Owner and Domain Admin logins"],
          ["Mobile biometric", "WebAuthn", "Fingerprint/Face ID for phone re-unlock"],
          ["Audit trail", "SHA-256 hash chain", "Append-only tamper-evident log — any modification is detectable"],
        ],
        [2340, 2340, 4680]
      ),
      spacer(),

      h2("6.2 Access Control"),
      makeTable(
        ["Control", "Implementation"],
        [
          ["Row-Level Security", "PostgreSQL RLS — database enforces tenant isolation. JABCO staff cannot see CASINO data even at DB level."],
          ["Role-based permissions", "Every page and action gated by role — Owner, Domain Admin, Operator, Auditor, Family, System"],
          ["Failed login lockout", "Account locked after repeated failed attempts — brute force protection"],
          ["Firewall", "Oracle VM: only ports 22 (SSH) and 443 (HTTPS) open. All other ports blocked. Inbound 443 restricted to Cloudflare published IP ranges ONLY — prevents origin bypass if VM public IP is discovered."],
          ["Cloudflare Origin Pull", "Caddy configured to validate Cloudflare Origin Pull certificate. Direct requests to the VM public IP that bypass Cloudflare are rejected. Configured PRE-0B — Day 1, before any application code is deployed."],
          ["Fail2ban", "Automatic IP banning after repeated failed SSH attempts"],
          ["No plain-text secrets", "All API keys, tokens, credentials stored in Oracle Vault — never in code or environment files"],
          ["Brian's isolation", "Brian's portal data is fully isolated from JAG operations — he cannot access Robert's business data"],
        ],
        [2340, 7020]
      ),
      spacer(),

      h2("6.3 Nuclear Scenario — What Happens If Server Is Stolen"),
      colorBox("Scenario: An attacker gains complete physical access to the Oracle VM or downloads the entire database.", JAG_RED_LIGHT, "8B0000"),
      spacer(),
      bullet("Raw database files: All sensitive columns encrypted with pgcrypto. Attacker sees encrypted binary blobs — unreadable without the encryption key."),
      bullet("Backup files: All encrypted with Restic AES-256 before storage. Useless without the master password."),
      bullet("Passwords: Argon2id hashes only. Original passwords cannot be recovered."),
      bullet("Encryption keys: Stored separately in Oracle Vault and with Robert's lawyer. Not on the server."),
      bullet("Business continuity: PC mirror has a complete copy. System restored on new hardware in under 4 hours."),
      spacer(),
      colorBox("RESULT: Stolen data is an encrypted blob. Without Robert's encryption keys (held separately), it has zero value to an attacker.", JAG_GREEN_LIGHT),
      spacer(),

      h2("6.4 Members Club — Compliance & Audit Scope"),
      body("The Members Club is a private social club, not a public gaming operation. The compliance scope is simplified accordingly:"),
      bullet("Visitor log — date, time, member ID for each entry"),
      bullet("Chip float: open balance recorded at session start, close balance reconciled at session end"),
      bullet("Cash tracking — all cash movements logged with standard transaction records"),
      bullet("Annual license renewal alert — system triggers 60-day and 30-day reminders"),
      bullet("Standard audit trail — all transactions timestamped and user-attributed"),
      bullet("Annual OWASP ZAP security scan recommended"),
      body("NOTE: AML tags, Gaming Commission export format, hash-chained audit log, and dual-signature requirements were evaluated and removed as over-engineered for a private social club. Standard audit trail is sufficient.", { italics: true }),

      pageBreak(),

      // ===================== SECTION 7 — PAYMENTS =====================
      sectionHeader("7. PAYMENT METHODS"),
      spacer(),
      body("The JAG platform supports all payment methods used across Trinidad & Tobago and internationally, covering both receiving payments and making payments."),
      spacer(),

      colorBox("ALL PAYMENT METHODS ARE AVAILABLE FOR BOTH RECEIVING AND MAKING PAYMENTS across all JAG entities. Full versatility — no restrictions on method, direction, or entity.", JAG_GREEN_LIGHT),
      spacer(),

      h2("7.1 Universal Payment Methods — Receive AND Pay (All Entities)"),
      makeTable(
        ["Method", "Receive", "Pay", "Integration / Tracking"],
        [
          ["Cash", "Yes", "Yes", "Receipt entry with auto-generated receipt number. Receipt scan + AI extraction for expenses."],
          ["WiPay (online card)", "Yes", "Yes", "HMAC webhook for incoming. Payment link generation for outgoing. Trinidad local gateway."],
          ["Bank transfer — TTD (local)", "Yes", "Yes", "Bank statement import — auto-matched on reconciliation"],
          ["Bank transfer — USD (local)", "Yes", "Yes", "USD accounts at local T&T banks (Republic, First Citizens, Scotiabank, RBC, JMMB) tracked in USD — converted to TTD at daily FX rate"],
          ["ACH / TransACH (TTIPS)", "Yes", "Yes", "Electronic interbank transfer — all major T&T banks. Matched via statement import."],
          ["LINX (local debit card)", "Yes", "Yes", "POS terminal for receiving. Debit card expense recorded for payments."],
          ["Cheque (local)", "Yes", "Yes", "Cheque number, bank, date recorded. Cleared on bank statement import."],
          ["Credit card (personal/business)", "Yes", "Yes", "Monthly statement PDF + AI extraction. All cards, all entities. Feeds JAG Lifestyle rewards tracking."],
          ["Foreign wire transfer (SWIFT)", "Yes", "Yes", "SWIFT reference, exchange rate on transfer date, fees tracked separately"],
          ["Online banking / bill pay", "Yes", "Yes", "Bank statement import auto-match. Utilities, insurance, subscriptions."],
          ["Foreign card / international gateway", "Yes", "Yes", "JAG Trading e-commerce and international supplier payments"],
          ["NLCB commission", "Yes", "N/A", "Weekly NLCB remittance matched against Brian's float reconciliation"],
        ],
        [2700, 720, 720, 5220]
      ),
      spacer(),

      h2("7.2 Messaging — WhatsApp Strategy (Zero Cost)"),
      colorBox("PRIMARY APPROACH: WhatsApp Direct Links (wa.me) — completely free. No Twilio. No third-party cost.", JAG_GREEN_LIGHT),
      spacer(),
      body("WhatsApp direct links use the format: https://wa.me/{phone}?text={message}"),
      bullet("Tenant rent reminders — system generates pre-written message, one click opens WhatsApp with message pre-filled"),
      bullet("Maintenance updates — staff notified via WhatsApp link"),
      bullet("Supplier communications — DragonBridge order confirmations"),
      bullet("Brian's parlor — supplier reorder notifications"),
      bullet("Compliance deadline alerts — escalating 2-month / 1-month / 2-week / 1-week WhatsApp reminders to Robert"),
      spacer(),
      body("PHASE 6 PLANNED: Twilio — fully automated background sending without any human click. Confirmed for Phase 6 build slot.", { italics: true }),

      pageBreak(),

      // ===================== SECTION 8 — JAG FINANCE =====================
      sectionHeader("8. JAG FINANCE — WEALTH & BANKING"),
      spacer(),
      body("JAG Finance is the comprehensive wealth management module within JAG Holdings. It consolidates all personal and business financial accounts, investments, and assets into one dashboard with complete multi-currency support."),
      spacer(),

      h2("8.1 Account Types Covered (20+ accounts)"),
      makeTable(
        ["Account Type", "Examples", "Currency", "Import Method"],
        [
          ["Trinidad Banks — TTD accounts", "Republic, First Citizens, Scotiabank, RBC, JMMB", "TTD", "PDF statement monthly"],
          ["Trinidad Banks — USD accounts", "Republic, First Citizens, Scotiabank, RBC, JMMB (USD-denominated)", "USD -> TTD at daily FX rate", "PDF statement monthly"],
          ["Foreign Banks", "US, China, UK, Canadian accounts", "USD, CNY, GBP, CAD", "PDF/CSV statement monthly"],
          ["International Brokerages", "Interactive Brokers (Flex Query CSV)", "USD", "CSV auto-import monthly"],
          ["International Brokerages", "Charles Schwab (CSV/JSON export)", "USD", "CSV auto-import monthly"],
          ["Share Registry", "Computershare (currently CAD + USD — target: USD only)", "USD (target) / CAD (current)", "PDF statement quarterly — consolidate to USD when restructured"],
          ["Credit Unions", "Massy Credit Union", "TTD", "PDF statement monthly"],
          ["Insurance / Annuities", "CLICO (annuities + life)", "TTD", "PDF annual statement"],
          ["Business Accounts", "All JAG entity accounts", "TTD/USD/CNY", "Automatic via platform"],
          ["Brian's Accounts", "Brian's personal + business", "TTD", "Brian uploads monthly"],
        ],
        [2340, 2340, 1440, 3240]
      ),
      spacer(),

      h2("8.2 Foreign Bank Accounts"),
      bullet("Foreign accounts tracked in native currency AND automatically converted to TTD and USD"),
      bullet("Daily FX rate updates (TTD/USD/CNY/GBP/CAD) from free exchange rate API"),
      bullet("DragonBridge China supplier payments tracked in CNY with exchange rate applied on transfer date"),
      bullet("Wire transfer fees tracked separately from principal amount"),
      bullet("FATCA/CRS reporting awareness — foreign account balances tracked for Trinidad BIR disclosure requirements"),
      bullet("Historical FX rate stored per transaction — accurate TTD value at time of transaction"),
      spacer(),

      h2("8.3 Investment Tracking"),
      bullet("Stocks (TTSE local + NYSE/NASDAQ international) — holdings, cost basis, current value, gain/loss"),
      bullet("Fixed deposits — all banks, maturity dates, interest rates, auto-renewal alerts"),
      bullet("Unit trusts and mutual funds"),
      bullet("Bonds and treasury bills (Trinidad and international)"),
      bullet("Annuities (CLICO) — current value, projected payout schedule"),
      bullet("Pension and retirement accounts"),
      bullet("Property equity — calculated from JAG Properties valuations minus mortgage balances"),
      bullet("Business equity — calculated from JAG Holdings consolidated balance sheet"),
      bullet("Loyalty programme value (JAG Lifestyle) — points balances valued in TTD/USD"),
      spacer(),

      h2("8.4 Mortgage & Loan Register (GAP 28 outcome)"),
      bullet("Approximately 4 active mortgages / business loans (exact count to be verified)"),
      bullet("Total active debt including credit cards: estimated 8-10"),
      bullet("Loan register fields: lender, original amount, interest rate, term, monthly payment, maturity date"),
      bullet("Credit cards included in JAG Finance but tracked SEPARATELY from mortgages and business loans"),
      bullet("Auto-alerts on payment due dates"),
      bullet("Early payoff scenario modelling per loan"),
      bullet("Track principal vs interest paid for equity calculation and tax deductibility"),
      spacer(),

      h2("8.5 Pension & Retirement Planning (GAP 29 outcome)"),
      bullet("One existing annuity tracked"),
      bullet("Project retirement income (pension + annuity + investments + rental) — even though Robert does not plan to retire"),
      bullet("Net worth tracking over time"),
      bullet("Wealth transfer scenario modelling — death-tomorrow scenario for Wife, daughter, father's estate, taxes"),
      bullet("Track Trinidad contribution limits where applicable"),
      spacer(),

      h2("8.6 Family Net Worth Dashboard"),
      bullet("Robert's complete personal and business net worth — real-time"),
      bullet("Wife's assets tracked separately with her consent"),
      bullet("Daughter's savings and assets"),
      bullet("Father's assets (for estate planning purposes — running value + transfer tax exposure estimate)"),
      bullet("Brian's net worth (separate — visible to Robert only in JAG Holdings master view)"),
      bullet("Total JAG Group consolidated value"),

      pageBreak(),

      // ===================== SECTION 9 — JAG PROPERTIES =====================
      sectionHeader("9. JAG PROPERTIES — PROPERTY MANAGEMENT & ACQUISITION"),
      spacer(),
      body("JAG Properties manages Robert's existing rental portfolio and includes a full Property Pipeline for evaluating and acquiring new properties. It is rebuilt on the IMS architecture (PostgreSQL + PWA + Oracle Cloud) for full integration with JAG Holdings."),
      spacer(),

      h2("9.1 Active Property Management"),
      bullet("Property and unit management with occupancy tracking"),
      bullet("Tenant profiles with KYC documents"),
      bullet("Lease management with auto-generated payment schedules"),
      bullet("Rent collection via WiPay, cash, bank transfer, ACH, cheque, LINX"),
      bullet("Maintenance requests, work orders, and vendor management"),
      bullet("Move-in / move-out inspections with inventory checklists"),
      bullet("Tenant portal — self-service rent payments and maintenance requests"),
      bullet("Broadcast alerts via WhatsApp direct links (free) or Twilio (optional)"),
      bullet("E-signatures via DocuSeal (self-hosted, free)"),
      bullet("Bank reconciliation with CSV import"),
      bullet("BIR Calculator — rental income tax with Trinidad 25%/30% bands, 20% repair allowance"),
      bullet("LBT (Land & Building Tax) and PTT (Property Transfer Tax) tracking"),
      bullet("Reports — P&L, Rent Roll, Overdue Aging, Occupancy, Tax Prep — CSV and PDF export"),
      spacer(),

      h2("9.2 Property Pipeline & Acquisition Analysis (Baked In From Phase 2)"),
      colorBox("This module must be designed from the start — it connects to financial analysis, due diligence documents, and post-acquisition management. Retrofitting later would require significant rework.", JAG_RED_LIGHT, "8B0000"),
      spacer(),
      bullet("Properties under consideration — address, asking price, photos, source (agent, auction, private)"),
      bullet("Pipeline status tracking — Considering > Due Diligence > Offer Made > Under Contract > Acquired > Rejected"),
      bullet("Financial analysis per property — projected rental yield, ROI, payback period, cash-on-cash return"),
      bullet("Comparable analysis — side-by-side comparison of multiple properties"),
      bullet("Due diligence checklist — title search, valuation report, survey, structural inspection, utility status"),
      bullet("Document store — all due diligence documents attached to property record"),
      bullet("Mortgage and financing scenarios — calculate impact of different loan structures"),
      bullet("Bid history and negotiation notes"),
      bullet("On acquisition — property automatically moves from pipeline to active management"),
      bullet("On rejection — property archived with reason for future reference"),
      spacer(),

      h2("9.3 Migration from Existing System"),
      body("The existing Electron desktop app (~99% complete, not yet live) will be rebuilt on the IMS architecture. Estimated 90-95% of logic transfers cleanly."),
      colorBox("DO NOT LAUNCH the existing Electron desktop app. Rebuild on IMS architecture first to avoid disconnected systems and data migration complexity.", JAG_RED_LIGHT, "8B0000"),

      pageBreak(),

      // ===================== SECTION 10 — IMS =====================
      sectionHeader("10. IMS — INVENTORY MANAGEMENT SYSTEM"),
      spacer(),
      body("The IMS tracks every physical asset, tool, vehicle, stock item, and consumable across all active business domains using one barcode/QR standard and one source of truth."),
      spacer(),
      makeTable(
        ["Domain", "Code", "Key Assets Tracked", "Special Features"],
        [
          ["JABCO Civil", "JABCO", "Tools, equipment, PPE, scaffold, generators, survey gear, consumables", "Project codes JABCO-YYYY-NNN, multi-project allocation, job costing, MS Project sync"],
          ["DragonBridge", "DRAGON", "Container manifests, warehouse stock, shipments, customs docs", "Bill of lading, container tracking, multi-currency landed cost, B2B + B2C customers, 6-week China lead time factored into reorder logic"],
          ["HOME Barataria", "HOME-BARA", "Electronics, appliances, valuables, pantry, medication, documents, heirlooms", "Insurance-ready export, father's medical supplies, daughter's items"],
          ["HOME Fyzabad", "HOME-FYZ", "All assets at Fyzabad property", "Separate location, same profile as HOME-BARA"],
          ["BAR", "BAR", "Liquor, beer, glassware, bar tools, kitchen consumables, refrigeration assets", "Par levels, POS reconciliation, liquor license tracking and renewal alerts"],
          ["MEMBERS CLUB", "CASINO", "Chip float, member records, cash floats, uniforms, furniture, bar equipment", "Visitor log (date, name, member ID), chip float open/close reconciliation, cash tracking, annual license renewal alert, standard audit trail only — AML tags, Gaming Commission exports, hash-chained log, and dual-signature requirements removed (over-engineered for a private social club)"],
          ["JABCO FLEET", "FLEET-JABCO", "All vehicles registered under JABCO", "Registration, insurance, COR, road tax, service history, driver assignment, fuel tracking"],
          ["Personal FLEET", "FLEET-PERS", "Vehicles owned personally by Robert and family", "Same tracking as JABCO FLEET but under personal ownership — depreciation to JAG Finance"],
          ["PROPS", "PROPS", "Fixtures and fittings per property", "Lightweight tenancy register, handover checklists, links to JAG Properties"],
        ],
        [1440, 1080, 3240, 3600]
      ),

      pageBreak(),

      // ===================== SECTION 10A — JABCO CONSTRUCTION PM =====================
      sectionHeader("10A. JABCO — CONSTRUCTION PROJECT LIFECYCLE MANAGEMENT"),
      spacer(),
      body("ADDED IN v1.8: JABCO is a civil engineering and general contracting firm requiring a full construction project lifecycle framework — not just a CRM. This section defines the complete JABCO construction PM architecture. Phase 2 build slot."),
      spacer(),
      colorBox("Phase 2: JABCO full construction PM built alongside JAG Properties. All financial data (progress claims, retention, BOQ variances) feeds JAG Holdings ledger via the outbox event bus.", JAG_GOLD_LIGHT),
      spacer(),
      h2("10A.1 Contract Register"),
      bullet("All contracts: contract number, client, type (government/private), contract sum, start/end dates, performance bond value and expiry"),
      bullet("Government (NHA, NIDCO, NIPDEC, HDC): tender reference, procurement method, statutory compliance fields, bond lodgement date"),
      bullet("Status: Tendering > Awarded > Active > Practical Completion > Defects Liability > Closed > Archived"),
      spacer(),
      h2("10A.2 Bill of Quantities (BOQ)"),
      bullet("Per-project line-item cost plan — materials, labour, equipment, subcontractors, preliminaries, contingency"),
      bullet("Budgeted vs actual per line item — variance alert when actual exceeds budget by configurable threshold (default 10%)"),
      bullet("BOQ drives progress claims and variation orders. Earned value: planned spend vs actual spend vs % complete."),
      bullet("BOQ auto-imports from MS Project XML export — manual override available"),
      spacer(),
      h2("10A.3 Variation Orders"),
      bullet("VO register per project: VO number, description, initiating party, BOQ line-item impact, adjusted contract sum"),
      bullet("Approval workflow: Submitted > Client Review > Approved / Rejected. Approved VOs update contract sum automatically."),
      bullet("Unapproved VOs tracked as exposure risk until approved"),
      spacer(),
      h2("10A.4 Progress Claims and Payment Certificates"),
      bullet("Monthly or milestone payment application — % complete per BOQ line item"),
      bullet("Workflow: Claim Submitted > Certified Amount > Invoice Issued > Payment Received > Retention Held"),
      bullet("Outstanding certified amounts auto-posted as receivables in JAG Holdings via outbox event"),
      bullet("Overdue certified payments flagged — escalating alerts at 30, 60, 90 days"),
      spacer(),
      h2("10A.5 Subcontractor Retention"),
      bullet("Retention % configurable per subcontractor per project (typical T&T range: 5-10%)"),
      bullet("Retention withheld automatically on every subcontractor payment"),
      bullet("Release triggered on Practical Completion AND end of Defects Liability Period (configurable)"),
      bullet("Total retention liability tracked in JAG Holdings as a future payable"),
      spacer(),
      h2("10A.6 Programme vs Actuals (Gantt)"),
      bullet("Gantt per project — planned vs actual activity dates. Progress feeds from foreman site diary."),
      bullet("Earned value dashboard: planned spend, actual spend, % complete, cost performance index"),
      bullet("Variance alerts: actual spend exceeds planned by 10% or milestone overdue by 5+ days"),
      bullet("Post-project profitability report: final margin vs bid margin, overrun categories"),
      spacer(),
      h2("10A.7 Foreman Site Diary (Mobile PWA — Offline Capable)"),
      bullet("Daily log: date, project, weather, labour headcount, plant on site, materials received, work completed, issues and instructions, safety incidents"),
      bullet("Foreman logs on phone — 5-10 minutes per day. Robert reviews in JAG Holdings."),
      bullet("Entries immutable once submitted — Robert can annotate but not edit (audit integrity)"),
      bullet("Site diary % complete estimates update the Gantt programme actuals automatically"),
      colorBox("DECISION LOCKED (v1.8 — Item 4): JABCO full construction PM — BOQ, variation orders, progress claims, subcontractor retention, Gantt vs actuals, foreman site diary. Government and private contracts supported. Phase 2.", JAG_GREEN_LIGHT),

      pageBreak(),

      // ===================== SECTION 10B — OFFLINE & PWA CONFLICT RESOLUTION =====================
      sectionHeader("10B. OFFLINE ACCESS AND PWA CONFLICT RESOLUTION"),
      spacer(),
      body("ADDED IN v1.8: The offline sync strategy previously said 'syncs automatically when restored' without defining conflict handling. Trinidad power and internet outages are weekly realities. This section locks scope and protocol."),
      spacer(),
      h2("10B.1 Offline-Critical Modules (Day 1)"),
      makeTable(
        ["Module", "Offline Capability", "Rationale"],
        [
          ["BAR cash logging", "Full offline writes — transactions, cash movements, session logs", "BAR operates Saturday nights — internet outage cannot stop sales logging or evening reconciliation"],
          ["JABCO site diary / foreman log", "Full offline writes — daily log entry, asset scans", "Construction sites across T&T frequently have poor or no mobile connectivity"],
          ["IMS barcode scanning", "Full offline writes — scan, count, transfer, movement log", "Warehouse and site scanning must work without internet"],
          ["JAG Properties rent receipts", "Online only — no offline writes", "Tenant payments at predictable times with internet available"],
        ],
        [2340, 3240, 3780]
      ),
      spacer(),
      h2("10B.2 Conflict Resolution Protocol"),
      colorBox("RULE: Nothing financial auto-posts when a conflict is detected. A wrong auto-post is worse than a delayed post.", JAG_RED_LIGHT, "8B0000"),
      spacer(),
      bullet("On reconnection all offline transactions enter a Pending Sync queue. Sync engine checks each against server state at the entry timestamp."),
      bullet("No conflict — auto-post immediately. No human action required."),
      bullet("Conflict detected — held in Conflict Review queue. Robert sees both records side-by-side. Robert approves one, discards the other, or merges. Nothing posts until Robert acts."),
      bullet("Conflict below TTD 5,000 = Tier 2 daily digest notification. Conflict above TTD 5,000 = Tier 1 immediate notification."),
      bullet("Client-side idempotency key (UUID + device ID + timestamp) generated at moment of offline entry. Prevents double-posting on reconnect even if network drops mid-sync."),
      colorBox("DECISION LOCKED (v1.8 — Item 5): Offline-critical modules (BAR, JABCO site diary, IMS scanning). Conflict Review queue for any conflicting record. Nothing financial auto-posts on conflict. Client-side idempotency key.", JAG_GREEN_LIGHT),
      spacer(),

      h2("10B.3 Non-Financial Master Record Conflict Protocol (v1.9)"),
      colorBox("GAP CLOSED (v1.9): The v1.8 conflict protocol covered financial transactions only. Non-financial master records (vendors, suppliers, vehicle assignments, equipment status) were unprotected against split-brain divergence during offline periods.", JAG_GOLD_LIGHT),
      spacer(),
      bullet("All shared master record tables (vendors, suppliers, customers, vehicles, assets, projects) carry two new system-managed fields: last_modified_at (timestamp with timezone) and last_modified_by (user_id)."),
      bullet("On reconnection sync: if the incoming offline record last_modified_at conflicts with the server record last_modified_at on the same primary key — both records route to the Conflict Review queue, identical to the financial conflict path."),
      bullet("Robert sees both versions side-by-side with the field-level diff highlighted. He approves one, discards the other, or merges manually."),
      bullet("Non-conflicting master record updates (no competing modification on server) auto-merge immediately with no human action required."),
      bullet("This approach uses the existing Conflict Review queue infrastructure — zero new systems. The same queue handles financial and non-financial conflicts with a type tag distinguishing them."),
      colorBox("DECISION LOCKED (v1.9): last_modified_at + last_modified_by on all shared master record tables. Conflicts route to existing Conflict Review queue. No vector clocks, no new infrastructure.", JAG_GREEN_LIGHT),

      // ===================== SECTION 11 — BUILD PHASES =====================
      sectionHeader("11. BUILD SEQUENCE & PHASES"),
      spacer(),
      makeTable(
        ["Phase", "Scope", "Duration", "Priority"],
        [
          ["Phase 0", "Oracle Cloud account + VM. Docker + PostgreSQL (five logical databases: jag_core, jag_commercial, jag_entertainment, jag_family, jag_properties). Caddy + Cloudflare DNS. WAL streaming to PC. PC Mirror Agent. i18n framework installed (English + Mandarin from day one). GitHub Actions deploy script. Guide: IMS_Oracle_Cloud_Setup_v1.0.md", "3-5 days", "NOW"],
          ["Phase 1A", "Auth service — KEYCLOAK (decided v1.8). Single realm jag-platform, one client per module, full role matrix. WebAuthn biometric. RLS per database. i18n engine English + Mandarin (framework also supports Spanish from day one — content populated Phase 3). node-pg-migrate on all five databases. jag-event-dispatcher container deployed and tested. Cross-tenant penetration test. MUST complete before any business module is built.", "2 weeks", "NOW"],
          ["Phase 1B", "IMS core — HOME (Barataria + Fyzabad) + JABCO (tool crib + JABCO FLEET). Barcode/QR, photos, personal FLEET. Backup system. PWA with English + Mandarin UI. JAG CRM contact master + JABCO sales pipeline. JAG Finance CORE SCHEMA + basic account ledger (accounts, transactions, FX rates, chart of accounts) — UI minimal, schema complete. Structured logging + Loki/Grafana observability.", "8-10 weeks", "HIGH"],
          ["Phase 2", "JAG Properties — rebuilt on IMS architecture. Active management + Property Pipeline & acquisition analysis. PROPS domain + personal FLEET full integration. JAG DocVault. JAG Succession Planning module. JAG Lifestyle data entry forms + member registry.", "6-8 weeks", "HIGH"],
          ["Phase 3", "Brian's Portal (full mirror). DragonBridge (DRAGON). BAR domain. NLCB booth module. JAG CRM loyalty + e-commerce. JAG Lifestyle full tracker (alerts + optimiser + Brian's portal access + dashboard widget). DragonBridge Spanish mini-sprint — customer-facing strings (invoices, order confirmations, customer portal, supplier communications) loaded into Phase 1A i18n framework.", "6-8 weeks", "MEDIUM"],
          ["Phase 4", "Members Club domain. JAG Finance FULL UI — 20+ account aggregation, foreign bank accounts, investment dashboard, family net worth, mortgage & loan register, retirement projection (built on core schema from Phase 1B — no data migration required). AI extraction engine (running on local PC, not Oracle VM). JAG Lifestyle net worth integration. JAG CRM finance auto-link.", "8-10 weeks", "MEDIUM"],
          ["Phase 5", "JAG Holdings central backbone — unified ledger, insurance module, expense management, single sign-on. MS Project integration. Accountant read-only portal.", "4-6 weeks", "MEDIUM"],
          ["Phase 6", "JAG HR (OrangeHRM). NFC fully wired. WhatsApp direct links across all modules. Spanish full rollout — all remaining modules (JAG Properties, JABCO, IMS, JAG Finance, JAG Lifestyle, Members Club, Brian's Portal). DragonBridge Spanish already live from Phase 3. Security audit (OWASP ZAP). Twilio automated messaging.", "4-6 weeks", "LOW"],
          ["Phase 7", "JAG Plantations. JAG Trading (POS + online retail). Twilio automated messaging (if needed).", "12-16 weeks", "FUTURE"],
        ],
        [900, 5040, 1440, 1440]
      ),

      pageBreak(),

      // ===================== SECTION 12 — INTEGRATION =====================
      sectionHeader("12. INTEGRATION ARCHITECTURE"),
      spacer(),
      makeTable(
        ["From", "To", "Data Flowing", "Method"],
        [
          ["IMS", "JAG Holdings", "Asset valuations, depreciation, project costs, equipment expenses", "API webhook on change"],
          ["JAG Properties", "JAG Holdings", "Rent collected, maintenance expenses, deposit liability, pipeline acquisitions", "API webhook on change"],
          ["JAG Entertainment", "JAG Holdings", "Bar sales, casino revenue, liquor costs, compliance reports", "Daily batch sync"],
          ["JAG CRM", "JAG Holdings", "Customer lifecycle events, JABCO pipeline status, DragonBridge tier changes", "API webhook on change"],
          ["JAG Finance", "JAG Holdings", "Account balances, investment valuations, FX rates, loan balances", "Daily pull"],
          ["JAG Lifestyle", "JAG Finance", "Loyalty points values -> personal net worth contribution", "Monthly sync"],
          ["JABCO + Personal FLEET", "JAG Holdings", "Vehicle depreciation, insurance, fuel costs", "Monthly sync"],
          ["Brian's Portal", "JAG Holdings", "All Brian entity data — visible to Robert only", "Real-time sync"],
          ["MS Project", "IMS + JAG Holdings", "Project budgets, timelines, resource costs", "XML/CSV monthly manual export"],
          ["AutoCAD", "JAG DocVault", "DWG drawing files attached to JABCO projects", "Manual file upload"],
          ["WiPay", "JAG Properties", "Payment confirmations, transaction logs", "HMAC webhook"],
          ["WhatsApp", "All modules", "Pre-filled message links opened by user", "wa.me direct links — free"],
          ["Foreign banks", "JAG Finance", "Account balances, transaction history", "PDF/CSV monthly upload"],
          ["Brian's statements", "JAG Finance (Brian)", "Personal account transactions", "Brian uploads PDF monthly"],
          ["External Accountant", "JAG Holdings (read-only)", "Read-only portal access for VAT/BIR returns (Phase 5+)", "Authenticated portal"],
        ],
        [1800, 1800, 3600, 2160]
      ),
      spacer(),

      h2("12.1 Event Handling & Reliability Architecture"),
      body("CORRECTED IN v1.8: PostgreSQL LISTEN/NOTIFY cannot cross database boundaries. A notification in jag_properties cannot be received by jag_core — they are separate databases. The five-database isolation model requires the outbox table pattern for cross-DB event delivery."),
      spacer(),
      bullet("Outbox table (pending_events) in each of the five databases — event written in the same transaction as the triggering business record. Atomic. No silent gaps between business event and notification."),
      bullet("Outbox table schema: id (UUID), event_type (text), payload (JSONB), idempotency_key (UNIQUE), created_at, delivered_at (NULL = pending), retry_count (int), last_error (text)."),
      bullet("jag-event-dispatcher — standalone Docker container on Oracle VM. Polls each database outbox every 5 seconds. Delivers events to JAG Holdings (jag_core). Marks each event delivered only after confirmed receipt. Restart-safe — on restart, picks up all undelivered events automatically."),
      bullet("Failed deliveries — retry_count increments on each failure. After 3+ retries: Tier 1 immediate alert to Robert (see Section 12.6). No silent data loss."),
      bullet("Idempotency keys on all financial endpoints — every rent payment, revenue sync, and cost posting carries a unique key from the originating endpoint. Duplicate delivery or retry never produces duplicate postings."),
      bullet("Race condition protection — concurrent updates to the same master record serialised using PostgreSQL advisory locks. Last write does not silently overwrite."),
      bullet("LISTEN/NOTIFY retained for within-database use only — e.g. real-time dashboard push updates within jag_core. Correct and supported use case."),
      colorBox("ARCHITECTURAL CORRECTION (v1.8): Outbox table pattern replaces cross-DB LISTEN/NOTIFY. At-least-once delivery preserved. Dead-letter alert logic unchanged. Transparent to all business modules — they write to their local outbox; the dispatcher handles delivery.", JAG_GREEN_LIGHT),
      spacer(),

      h2("12.2 Single Sign-On — Role Matrix"),
      makeTable(
        ["Role", "Access", "Assigned To"],
        [
          ["Owner", "Full access — all JAG entities, all data, Brian's summary", "Robert Johnson-Attin"],
          ["Domain Admin", "Full CRUD within assigned entity only", "Trusted managers per business"],
          ["Operator / Staff", "Scan, count, transfer, log movements — no delete, no valuations", "Foremen, bar staff, casino floor, warehouse clerks"],
          ["Auditor", "Read-only, export reports only", "External accountant, insurance broker"],
          ["External Advisor", "Time-limited, scoped read/export only. Maximum session duration configurable. Automatic expiry — access terminates without manual revocation. Cannot see data outside their assigned entity scope.", "Lawyers (estate review), insurance brokers (policy audit), potential buyers (Data Room mode per entity). Assigned per engagement, not permanent."],
          ["Family Member — Emergency Designate", "Full read-only — ALL entities, ALL data. Can view but not edit anything. Designated emergency administrator — can direct staff and advisors using complete system visibility.", "Wife (Mandarin Chinese default)"],
          ["Brian", "Separate portal — his entities only, cannot see JAG operations", "Robert's brother"],
          ["System", "API access only — scheduled jobs, integrations, FX pulls, backups", "Automated processes"],
        ],
        [1800, 3960, 3600]
      ),
      spacer(),

      h2("12.3 Data Quality & Integrity Rules"),
      body("With Brian uploading statements, JABCO foremen scanning equipment offline, BAR staff logging cash, and multiple people entering vendor names — data quality problems will appear within 60 days of go-live without defined rules."),
      spacer(),
      bullet("Duplicate detection — vendor and customer names are checked against existing master records on entry. Likely duplicates flagged for Robert's review before saving. Fuzzy match threshold: 85% similarity."),
      bullet("Mandatory fields enforced — no transaction can be saved without: date, amount, entity attribution, and category. Partial records land in a 'Pending Completion' queue visible to Robert."),
      bullet("Non-Owner data entry goes into a 'Pending Review' state — foremen, BAR staff, and Brian's entries are visible immediately but flagged until Robert or a Domain Admin approves them for financial reporting."),
      bullet("Entity attribution validation — if a transaction is posted from a JABCO account but attributed to BAR, the system flags it for confirmation. Cross-entity attributions require explicit override."),
      bullet("Monthly reconciliation report — auto-generated on the 1st of each month, flagging unmatched transactions, unapproved entries, and duplicate suspects from the prior month."),
      colorBox("GAP RESOLVED (M-02): Data quality rules are now architecturally defined. The 'one source of truth' principle is enforced by validation, not policy.", JAG_GREEN_LIGHT),
      spacer(),

      h2("12.4 Service Level Targets"),
      makeTable(
        ["Module Tier", "Examples", "Uptime Target", "Max Downtime/Month", "Alert Threshold"],
        [
          ["Core — Tier 1", "JAG Holdings financial ledger, auth, SSO, WAL streaming", "99.5%", "3.6 hours", "Any downtime > 15 min triggers immediate alert to Robert"],
          ["Operational — Tier 2", "IMS, JAG Properties, BAR/Members Club ops, JABCO, Brian's portal", "99.0%", "7.2 hours", "Downtime > 30 min triggers alert"],
          ["Reporting — Tier 3", "BI dashboards, report exports, JAG Lifestyle tracker", "Best effort", "No hard target", "Alert only if unavailable > 4 hours"],
        ],
        [1800, 2700, 1440, 1440, 2880]
      ),
      spacer(),
      bullet("If BAR or JAG Properties is down on a Saturday night or during a tenant payment window, Robert is alerted within 15 minutes via the observability stack (Loki + Grafana)."),
      bullet("Public status page — tenants and Brian see a 'System temporarily unavailable' message on login rather than an error screen."),
      colorBox("GAP RESOLVED (M-04): SLA/uptime targets are now defined per module tier. Monitoring alert thresholds are derived from these targets, not set by intuition.", JAG_GREEN_LIGHT),
      spacer(),

      h2("12.5 Data Archival & Lifecycle Policy"),
      bullet("Active vs. archived flag on all major entities — tenants, vendors, customers, assets, projects. Inactive for 24+ months triggers automatic archival flag."),
      bullet("Archived records remain queryable for reporting and tax purposes — they are never deleted. They are excluded from active dashboards and search results by default, with a 'Show archived' toggle."),
      bullet("Photo originals older than 12 months are tiered to the PC mirror only. A compressed 5KB thumbnail stub replaces the cloud asset. Mobile users see the thumbnail with a 'Request Original' button."),
      bullet("Financial transactions are never archived — they are retained indefinitely for BIR compliance, audit trail, and historical net worth tracking."),
      bullet("Quarterly archive review — Robert reviews the archived entity list each quarter and either confirms archival or restores to active."),
      spacer(),
      colorBox("STORAGE HARDENING ADDITIONS (v1.9 — enforced from Day 1):", JAG_GOLD_LIGHT),
      bullet("Loki log retention: maximum 14 days. Loki retention_period configured to 336h in Docker Compose from Phase 1B deployment. Grafana long-term dashboards use aggregated metrics only. Enforced from Day 1 — not retrofitted."),
      bullet("Large file streaming: raw DWG and multi-page PDF documents are streamed to the local PC mirror immediately upon upload to MinIO. A compressed web-view stub replaces the full asset on Oracle VM storage. Request Original button fetches from PC mirror on demand."),
      bullet("Docker image management: unused Docker images pruned monthly via automated cron job. Only the current and one previous image version retained per service."),
      colorBox("GAP RESOLVED (M-05 + v1.9 STORAGE HARDENING): With Loki 14-day retention, large file streaming, and Docker image pruning all enforced from Day 1, Oracle 200 GB ceiling risk is pushed to Year 3+ and manageable with monitoring.", JAG_GREEN_LIGHT),

      h2("12.6 Notification Architecture (v1.8)"),
      body("Multiple modules generate alerts. Without a unified architecture, Robert receives unmanageable volume within 60 days. Tiered delivery prevents alert fatigue while ensuring critical events are never missed."),
      spacer(),
      makeTable(
        ["Tier", "Delivery", "Timing", "Examples"],
        [
          ["Tier 1 — Immediate", "In-app bell + WhatsApp direct link", "Instant", "Payment failures, security events, system downtime, event dispatcher 3+ retry failures, compliance T-7 days or less"],
          ["Tier 2 — Daily Digest", "In-app bell only", "7:00 AM daily", "Maintenance requests, compliance reminders (30-60 day), archival flags, loyalty expiry warnings, reconciliation report, pending review queue count"],
          ["Tier 3 — Weekly Digest", "In-app bell only", "Monday 7:00 AM", "Archive review reminders, quarterly backup verification, system performance summary"],
        ],
        [1440, 2160, 1440, 4320]
      ),
      spacer(),
      bullet("Quiet hours: 10:00 PM to 6:00 AM — no Tier 1 or Tier 2 notifications delivered. Tier 1 events during quiet hours queued and delivered at 6:00 AM with original occurrence timestamp noted."),
      bullet("Unified notification centre: Bell icon in JAG Holdings dashboard. Shows all alerts with read/unread status, priority tier badge, and source module. Clicking navigates to the relevant record."),
      bullet("Robert may override quiet hours per-alert-type in Notification Preferences."),
      bullet("Built in Phase 1B alongside JAG Holdings core. All modules wire to notification centre from Phase 1B — no retrofit."),
      colorBox("DECISION LOCKED (v1.8 — Item 8): Tier 1 immediate, Tier 2 daily 7am, Tier 3 weekly Monday. Quiet hours 10pm-6am. Unified notification centre in JAG Holdings dashboard. Phase 1B.", JAG_GREEN_LIGHT),
      spacer(),

      pageBreak(),

      // ===================== SECTION 13 — EXPENSE MANAGEMENT =====================
      sectionHeader("13. EXPENSE MANAGEMENT"),
      spacer(),
      h2("13.1 Current State"),
      bullet("Scanned PDF receipts — partially collated"),
      bullet("Gemini AI extracted to Excel spreadsheet — entity attribution not yet reviewed"),
      bullet("Credit card transactions — not yet incorporated"),
      bullet("Bank statement transactions — not yet incorporated"),
      spacer(),

      h2("13.2 Target Monthly Process (~45-60 minutes total)"),
      bullet("Download statements from all 20+ accounts (banks, brokerages, credit cards, credit unions)"),
      bullet("Drop all PDFs and CSVs into one secure intake folder on Oracle VM"),
      bullet("AI extraction engine processes all documents — date, amount, vendor, category"),
      bullet("System auto-assigns to correct JAG entity based on account and transaction type"),
      bullet("Uncertain items (est. 15-20% initially) flagged for Robert's review"),
      bullet("Approved items post to JAG Holdings financial ledger"),
      bullet("Brian drops his statements in his designated folder — processed separately"),
      spacer(),

      h2("13.3 Existing Excel Data"),
      bullet("Migrate as opening dataset into JAG Holdings — do not discard"),
      bullet("Review entity attributions at own pace"),
      bullet("Use as historical baseline for trend analysis and tax preparation"),

      h2("13.4 AI Extraction Engine Specification (v1.8)"),
      body("All processing is local by default — bank statement data never leaves Robert's infrastructure automatically."),
      spacer(),
      makeTable(
        ["Format", "Processing Method", "AI Required?"],
        [
          ["Bank PDFs (downloaded)", "Ollama local model — text extraction + field parsing", "Yes — primary"],
          ["Scanned PDFs (phone/scanner)", "Ollama local model — OCR + field parsing", "Yes — primary"],
          ["CSV/Excel exports from bank portal", "Direct structured column mapping", "No — bypasses AI layer entirely"],
          ["Credit card statements (PDF)", "Ollama local model — text extraction + field parsing", "Yes — primary"],
        ],
        [3240, 3600, 2520]
      ),
      spacer(),
      bullet("Model: Ollama (self-hosted on Robert's main Windows workstation — NOT the Dell Inspiron), Mistral 7B or equivalent. Nightly 2:00 AM batch job against intake folder on Oracle VM. Statements synced to workstation for processing; extracted results synced back. The Inspiron is a passive WAL target only and never runs Ollama."),
      bullet("Confidence threshold: below 85% = Pending Review queue. Robert sees extracted text alongside the raw statement section. Estimated 15-20% in review initially, dropping to 5-10% within 3 months."),
      bullet("Optional API escalation: Robert clicks 'Get AI Assist' on any Pending Review item. Consent notice shown before transmission. Opt-in per item — never automatic."),
      bullet("CSV/Excel imports bypass AI layer entirely — structured column mapping. Zero AI compute for structured data."),
      bullet("Pre-Build POC: test Ollama against real T&T bank statements from all six banks before Phase 1B begins."),
      colorBox("DECISION LOCKED (v1.8 — Item 3): Hybrid AI extraction — Ollama local primary, opt-in external API per item. Zero automatic data leaving infrastructure. Bank statement POC required in Pre-Build.", JAG_GREEN_LIGHT),


      pageBreak(),

      // ===================== SECTION 14 — INSURANCE =====================
      sectionHeader("14. INSURANCE MANAGEMENT"),
      spacer(),
      body("The Insurance Management module lives within JAG Holdings and covers all personal and business policies across the JAG Group, including Brian's personal policies."),
      spacer(),
      makeTable(
        ["Feature", "Description"],
        [
          ["Policy register", "All current policies — vehicle, property, life, health, liability, directors & officers, professional indemnity, business interruption"],
          ["Renewal calendar", "90-day, 30-day, and 7-day advance WhatsApp alerts for every renewal"],
          ["Claims history", "Date, description, amount claimed, amount settled, supporting documents"],
          ["Premium tracking", "Premium cost per entity for tax deduction attribution"],
          ["Coverage gap analysis", "IMS automatically flags every uninsured asset — Robert sees what is and is not covered"],
          ["Priority ranking", "Uninsured assets ranked by value for coverage prioritisation"],
          ["Document store", "All policy PDFs stored and searchable"],
          ["Brian's policies", "Brian's personal insurance tracked separately in his portal, visible to Robert in JAG Holdings"],
        ],
        [2880, 6480]
      ),

      pageBreak(),

      // ===================== SECTION 15 — RISKS =====================
      sectionHeader("15. RISKS & MITIGATIONS"),
      spacer(),
      makeTable(
        ["Risk", "Likelihood", "Impact", "Mitigation"],
        [
          ["Oracle Always Free discontinued", "Very Low", "High", "PC mirror has every byte — re-host on any Linux box in 4 hours"],
          ["Oracle VM suspended for inactivity", "Low", "Medium", "Background worker keeps VM warm with periodic activity"],
          ["Power outage Trinidad", "Medium", "Low", "UPS for local server. Oracle VM unaffected. PWA works offline."],
          ["Robert's PC failure", "Medium", "Low", "Cloud is primary. PC mirror replaceable. Backups encrypted on Google Drive."],
          ["Internet outage", "Medium", "Low", "PWA caches, syncs when restored"],
          ["Data theft / server breach", "Very Low", "Critical", "pgcrypto column encryption + AES-256 backups + keys held separately = unreadable data"],
          ["Forgotten encryption password", "Low", "Critical", "Key escrow with Robert's lawyer — sealed envelope"],
          ["Members Club annual license audit", "Annual", "Low", "Visitor log, chip float open/close reconciliation, cash tracking, annual license renewal alert — standard audit trail is sufficient for a private social club"],
          ["Brian data entry inconsistency", "Medium", "Low", "Simple Brian portal UI minimises errors. Monthly reconciliation flags gaps."],
          ["Storage ceiling 200 GB", "Low (Year 3+ with controls)", "Medium", "Loki 14-day retention + DWG/PDF streaming to PC mirror + Docker image pruning + photo tiering — all enforced Day 1."],
          ["Trinidad bank API unavailable", "High (current)", "Low", "Semi-automated PDF/CSV monthly import — 45-60 min/month"],
          ["Scope creep", "High", "Medium", "This locked document + written change requests required"],
          ["Key person risk (Robert)", "Medium", "Critical", "Succession module + Wife emergency designate + Brother backup POA + lawyer sealed envelope"],
          ["Owner dependence flagged at sale", "Medium (per entity)", "Medium", "Documented processes + sale-readiness metrics tracked in Exit Strategy module"],
        ],
        [2700, 900, 900, 4860]
      ),

      pageBreak(),

      // ===================== SECTION 15A — TESTING STRATEGY =====================
      sectionHeader("15A. TESTING STRATEGY"),
      spacer(),
      body("The JAG platform handles financial data, family wealth, and compliance obligations across 12+ entities. Errors in financial calculations or cross-tenant data exposure are not acceptable. A minimum testing framework is mandatory before Phase 1B begins."),
      spacer(),

      h2("15A.1 Financial Calculation Tests — Mandatory"),
      bullet("Every financial calculation must have an automated test: rent arrears, FX conversion, intercompany elimination, loan amortisation, BIR tax bands (25%/30%), LBT, PTT, investment gain/loss, net worth aggregation."),
      bullet("A wrong consolidated figure in JAG Holdings may not surface for months without automated detection — these tests are non-negotiable."),
      bullet("Framework: Jest (Node.js) — already consistent with the existing stack. Test files live alongside each module."),
      spacer(),

      h2("15A.2 Integration Tests — API Endpoints"),
      bullet("Every JAG Holdings API endpoint must have an integration test covering: successful payload, malformed payload, missing auth token, and duplicate idempotency key (must not double-post)."),
      bullet("WiPay webhook integration test: simulate confirmed payment, failed payment, and replay — verify ledger state after each."),
      bullet("LISTEN/NOTIFY event bus test: publish event, kill consumer, verify dead-letter queue captures it, verify retry delivers it."),
      spacer(),

      h2("15A.3 Cross-Tenant Isolation Tests — After Every Migration"),
      bullet("After every schema migration across any of the five databases, run automated cross-tenant isolation tests before deploying to production."),
      bullet("Test suite verifies: a jag_commercial connection cannot read jag_entertainment data, a jag_family connection cannot read jag_core financial data, Brian's portal cannot access JAG operations data."),
      bullet("These tests must pass before any Phase transition is declared complete."),
      spacer(),

      h2("15A.4 UAT Sign-Off Checklist — Per Phase"),
      bullet("Each phase requires Robert's explicit sign-off before the next phase begins. Sign-off covers: all financial calculations verified against known test cases, all role-based access controls tested manually, all compliance exports generated and spot-checked, all mobile PWA workflows tested on Robert's phone."),
      bullet("No phase begins until the previous phase passes UAT. This is a discipline gate, not a suggestion."),
      spacer(),

      h2("15A.5 Security Testing"),
      bullet("Cross-tenant penetration test mandatory after Phase 1A before any business module is built. Run with a non-Owner test account and attempt to access data from a different database."),
      bullet("Annual OWASP ZAP security scan from Phase 6 onwards."),
      bullet("After any auth change: re-run the cross-tenant isolation test suite immediately."),
      colorBox("BLOCKER RESOLVED (H-04): Testing strategy is now architecturally specified. Jest framework, financial calculation tests, integration tests, cross-tenant isolation tests, and UAT sign-off gates are all defined before Phase 1B begins.", JAG_GREEN_LIGHT),

      pageBreak(),

      // ===================== SECTION 16 — CHANGE MANAGEMENT =====================
      sectionHeader("16. CHANGE MANAGEMENT"),
      spacer(),
      body("Any significant architectural change requires a written change request from Robert, a version number update, a change log entry, and re-acceptance by Robert."),
      spacer(),
      body("Minor additions (new entity, new bank account, new insurance policy, new staff member) are handled through the admin UI in under 30 minutes — no formal change request needed."),
      spacer(),
      body("New entity additions follow the GAP 31 New Entity Onboarding workflow (see Section 17)."),
      spacer(),
      colorBox("OPSEC NOTICE — CLASSIFIED DOCUMENT: This Master Architecture is for OFFLINE USE ONLY. Do NOT upload, paste, or share this document with any AI system, cloud service, or external consultant. For AI sessions and external channels, use JAG_AI_Context_Summary_v2.0.docx exclusively — the sanitised version that contains no account numbers, succession detail, ownership percentages, or lawyer identities.", JAG_RED_LIGHT, "8B0000"),
      spacer(),

      h2("16A. Build Resource Model"),
      body("The JAG platform is built under Option C: AI-assisted development with Robert as sole architect, reviewer, decision-maker, and context provider. This is not a zero-human-hours process. Robert's time is the critical path — not compute, not code generation."),
      spacer(),
      makeTable(
        ["Parameter", "Value"],
        [
          ["Weekly commitment", "10-15 hours per week — protected time, non-negotiable"],
          ["Session structure", "Claude session opened with JAG_AI_Context_Summary_v2.0.docx. One design decision or build milestone per session. Session ends with updated architecture or committed code — not open threads."],
          ["Robert's role", "Architect, reviewer, approver, UAT tester, context provider. Every module requires Robert's sign-off before the next begins."],
          ["Claude's role", "Code generation, architecture drafting, documentation, research. All output reviewed by Robert before merge to main."],
          ["Risk", "JABCO contract win or other business demand can pause the build. A 4-week pause on a complex codebase has real re-entry cost. Phase milestones are designed to be self-contained so a pause does not lose progress."],
          ["Mitigation", "Each phase ends with a documented handoff state: what was built, what was tested, what the next session should start with. Re-entry is a 30-minute context reload, not a rebuild."],
        ],
        [2700, 6660]
      ),
      spacer(),
      bullet("At 10-15 hours/week, Phase 1A (2 weeks) and Phase 1B (8-10 weeks) complete in approximately 3 months from Pre-Build completion."),
      bullet("If weekly hours drop below 8 consistently, phase timelines extend proportionally — the architecture does not change, only the calendar."),
      colorBox("GAP RESOLVED (H-10): Build resource model is now formally documented. Option C is defined with explicit time commitment, role boundaries, and pause/re-entry protocol. The single-person dependency risk is acknowledged and mitigated.", JAG_GREEN_LIGHT),

      pageBreak(),

      // ===================== SECTION 17 — GAP RESOLUTION TRACKER =====================
      sectionHeader("17. GAP RESOLUTION TRACKER — ALL 31 GAPS RESOLVED"),
      spacer(),
      body("This section documents every architecture gap reviewed and the decision reached. All 31 gaps are closed as of v1.5."),
      spacer(),

      gapBlock(1, "JAG DocVault", "RESOLVED", [
        "OCR for searchable scanned PDFs",
        "Version control for evolving documents",
        "Robert-only access; manual share to lawyer/accountant when needed",
        "Time-limited external share links",
        "Paper backlog digitisation phased",
        "Data Room mode per entity — pre-packaged folder (financials, contracts, licenses, asset register, customer list, sale-readiness report) with time-limited buyer link"
      ]),
      spacer(),
      gapBlock(2, "Business Continuity & Succession", "RESOLVED", [
        "Signing authority: Wife + Brother (Brother to be formalised)",
        "Robert's Will: TO BE CREATED — must reference all JAG entities and ownership (ACTION)",
        "POA: Wife primary (JABCO + DragonBridge); Brother backup contingency (ACTION)",
        "SUCCESSION ACTIVATION PROTOCOL (v1.9 CORRECTED): Keycloak master recovery credential held by Wife only in physically sealed envelope at home (deliberate family privacy decision). Annual review: Robert generates new credential, updates envelope. On activation: Wife uses credential via single-step UI — provisions parallel Co-Owner access to Wife's account. Robert's account is NOT demoted or restricted. Generates timestamped audit log entry. RATIONALE: programmatic demotion of the Owner account is a catastrophic single point of failure — a mistaken activation or Keycloak DB corruption would lock the Owner out of his own platform. True account decommissioning is always a deliberate manual process requiring direct infrastructure access. DR runbook documents Keycloak admin reset procedure for simultaneous incapacitation scenario, executable by qualified technician with physical server access.",
        "No automated death switch — manual activation by Wife via credential + single-step UI. Full runbook covers every step.",
        "Father's care: medical instructions + medications stored in system",
        "Father's assets: review properties + accounts, convert critical ones to joint (ACTION)",
        "Daughter graduated access: 13 read-only HOME -> 16 operational HOME -> 18 full HOME -> 21 manage designated -> 25 full Owner if designated",
        "JAG Succession Planning built INTO JAG Holdings core",
        "Health Management System separate, API-integrated",
        "--- INDEPENDENT SUCCESSION — WIFE (v1.6) ---",
        "Wife's own Will: TO BE CREATED — covers personal assets, BAR/CASINO (in her name), Chinese heritage considerations, and beneficiary designations independent of Robert's plan (ACTION)",
        "Wife's own executor designation: to be documented — Robert primary executor; contingency executor to be named (ACTION)",
        "Wife's beneficiaries: primary beneficiary = Robert; contingency = Daughter; to be formalised with lawyer (ACTION)",
        "Trustee clause in Wife's will: Robert manages BAR/CASINO until sale OR Daughter age 25, whichever first (already captured in GAP 16 — confirm inclusion in Wife's actual will at lawyer session)",
        "--- INDEPENDENT SUCCESSION — BRIAN / BROTHER (v1.6) ---",
        "Brian's own Will: TO BE CREATED — covers parlor, NLCB booth, personal vehicles, personal home assets, and any JAG Properties share held (ACTION)",
        "Brian's executor designation: to be documented — Robert suggested as executor; Brian to confirm (ACTION)",
        "Brian's beneficiaries: to be confirmed by Brian and documented in JAG Succession Planning module (ACTION)",
        "Brian's POA: person to act on Brian's behalf if incapacitated — to be designated and documented (ACTION)",
        "NOTE: Brian's succession plan is managed via his own portal and visible to Robert in JAG Holdings master view"
      ]),
      spacer(),
      gapBlock(3, "CRM", "RESOLVED", [
        "Approximately 10 customers currently across all entities; scale planning ahead of growth",
        "B2B 80% / B2C 20% mix",
        "JABCO pipeline: tender-driven, 1-2 month bid-to-contract; centralised tracking",
        "Segmentation: corporate / government / residential / one-off",
        "BAR/CASINO: build loyalty framework now, populate when POS goes live (currently cash-only)",
        "DragonBridge: customer-specific pricing tiers + payment terms",
        "Communication history: manual notes initially; Gmail API integration later",
        "Auto-alerts on customer milestones (lapsed, birthdays, VIPs)",
        "Phase placement: 1 (contact master + JABCO pipeline), 3 (loyalty + e-commerce), 4 (DragonBridge + finance auto-link)"
      ]),
      spacer(),
      gapBlock(4, "Tax Compliance", "RESOLVED", [
        "VAT: JABCO only currently; register others as they cross threshold",
        "Fiscal year-end: December 31 across all entities",
        "External accountant works from bank statements; future read-only portal (Phase 5+)",
        "QuickBooks Desktop skipped — JAG Finance replaces it",
        "Internal tax dashboard: VAT, corporate, landlord income, Gaming Act, NLCB — raw liability BEFORE accountant's strategy",
        "Multi-entity consolidated tax visibility"
      ]),
      spacer(),
      gapBlock(5, "Compliance Calendar", "RESOLVED", [
        "Critical showstoppers: JABCO VAT clearance, income tax certificate, NIS compliance, BAR yearly license, CASINO members club yearly",
        "Non-critical: project bonds, public health approvals",
        "Escalating alerts: 2 months -> 1 month -> 2 weeks -> 1 week",
        "Renewal lead time ~1 month",
        "No hard blocking — loud alarm + visual flag, override allowed",
        "Linked to JAG Finance for renewal fee accounts",
        "Brian's critical licenses visible in Robert's master view"
      ]),
      spacer(),
      gapBlock(6, "Disaster Recovery", "RESOLVED", [
        "Acceptable downtime: 4 hours early, faster after PC mirror",
        "Acceptable data loss: 1 hour (hourly backups)",
        "DR drills every 6 months",
        "Failover docs known by Robert, Wife, and Brother",
        "Backup testing quarterly"
      ]),
      spacer(),
      gapBlock(7, "Third-Party API Access", "RESOLVED", [
        "Accountant: broad read-only portal in Phase 5+",
        "Banks: PDF statements only — no API",
        "Insurance / lawyer: manual document sharing",
        "Only third-party portal: accountant"
      ]),
      spacer(),
      gapBlock(8, "Mobile-First Workflows", "RESOLVED", [
        "Robert: laptop + mobile. Wife, Brian, foremen, BAR/CASINO staff: phone primary",
        "Phone tasks: loyalty QR, expense approval, cash balance, customer messages",
        "Laptop tasks: reports, project planning, document editing, tender prep",
        "JABCO foremen: offline equipment logging, asset scans, daily reports — sync when reconnected",
        "Push notifications: compliance deadlines, loyalty, bid responses, cash deposits",
        "Wife: full remote mobile access"
      ]),
      spacer(),
      gapBlock(9, "Reporting & BI", "RESOLVED", [
        "Daily dashboard: cash balance, yesterday revenue, compliance alerts, JABCO bids, loyalty activity",
        "Weekly: revenue by entity, 2-week cash flow forecast, JABCO staff utilisation, compliance status, top customers",
        "Monthly: P&L per entity, CLV rankings, property occupancy",
        "Quarterly informal board with Wife + Brother",
        "Auto-alerts: low cash, customer churn (60+ days no-visit), JABCO win rate below target, compliance < 2 weeks",
        "All reports exportable to Excel and PDF"
      ]),
      spacer(),
      gapBlock(10, "Data Retention & Privacy", "RESOLVED", [
        "T&T Data Protection Act 2011: defer formal compliance, revisit later",
        "Customer / tenant / employee data retained indefinitely. Archived when inactive for 24+ months — flag-based (never deleted), excluded from active views, queryable for tax and audit purposes. Financial transactions exempt from archival — retained permanently. See Section 12.5 for full lifecycle policy.",
        "Privacy policy template generated by system, Robert customises",
        "Third-party data sharing: zero",
        "Consent: assumed on interaction"
      ]),
      spacer(),
      gapBlock(11, "Training & Onboarding", "RESOLVED", [
        "Wife: Mandarin video + written guides + hands-on",
        "Brian: written + hands-on (medium tech literacy)",
        "JABCO foremen: video + job aids",
        "BAR/CASINO staff: video + QR job aids",
        "Contextual help buttons on every screen",
        "Skip onboarding checklist (too much friction)"
      ]),
      spacer(),
      gapBlock(12, "Change Request System", "RESOLVED", [
        "Submission via email, WhatsApp, or built-in form",
        "Public bug reporting supported",
        "Priority levels: critical / high / medium / low",
        "Ticket numbers + status updates for reporters",
        "Auto-confirmation on receipt",
        "SLA tracking",
        "Robert personally reviews, prioritises, assigns"
      ]),
      spacer(),
      gapBlock(13, "Communications Strategy", "RESOLVED", [
        "Current channels: WhatsApp groups, email, SMS, in-person",
        "Updates: email + WhatsApp + in-app banner",
        "Critical fixes: forced immediate",
        "Planned maintenance: 24-hour notice",
        "Emergencies: WhatsApp + SMS simultaneously",
        "No newsletters / surveys / forums"
      ]),
      spacer(),
      gapBlock(14, "Financial Forecasting", "RESOLVED", [
        "Annual budgets per entity",
        "Budget vs actual month-by-month",
        "Cash flow forecast 30 / 60 / 90 days",
        "DragonBridge revenue projections",
        "Property acquisition mortgage modelling",
        "Break-even analysis",
        "Profitability per project (JABCO)",
        "Sensitivity analysis"
      ]),
      spacer(),
      gapBlock(15, "Performance Monitoring", "RESOLVED", [
        "Technical alerts: immediate via chat (not SMS)",
        "Email + dashboard with CPU, memory, disk, backup status",
        "Public status page so tenants see 'system down' on login",
        "Escalation: second alert after 1 hour",
        "No performance baselines yet — establish in Phase 1"
      ]),
      spacer(),

      pageBreak(),
      sectionHeader("17. GAP TRACKER (continued)"),
      spacer(),

      gapBlock(16, "Exit Strategy Per Entity", "RESOLVED", [
        "JABCO: hold for life",
        "DragonBridge: hold as long-term family asset",
        "JAG Properties: dynamic portfolio (selectively buy/sell; father's properties stay in family)",
        "BAR: eventually exit ~5 years (sooner if right buyer)",
        "CASINO: eventually exit ~5 years (sooner if right buyer)",
        "JAG Impressions: sell dormant assets, revive brand for new venture ~5 years",
        "JAG Finance: hold for life",
        "JAG Plantations + JAG Trading: hold long-term (pending future clarity)",
        "Valuation: quarterly all entities. JABCO uses EBITDA multiple + 10-20% reputational premium. JAG Properties: comparables + cap rate. BAR/CASINO: hybrid revenue multiple + asset-based. DragonBridge: baseline tracking, revisit post-launch",
        "Sale-readiness metrics flagged: customer concentration, owner dependence, recurring vs one-off revenue, books audit-ready, documented processes, key person risk",
        "Data Room mode in DocVault — pre-packaged per entity",
        "Co-owner agreements (URGENT): JAG Properties buy-sell agreement to be drafted; JABCO Wife+Brother directors only no equity; BAR/CASINO trustee clause in Wife's will — Robert manages until sale OR daughter age 25 whichever first",
        "Daughter's inheritance: sole heir; specific entity designation deferred",
        "Post-tax sale proceeds modelled under T&T rules",
        "JAG Impressions: track asset disposal as active project with buyer outreach log",
        "Father's estate: running value + transfer tax exposure estimate"
      ]),
      spacer(),
      gapBlock(17, "Intercompany Transactions", "RESOLVED", [
        "Automatic tracking chosen (visibility over simplicity)",
        "Current state: significant comingling across JABCO, Properties, BAR, CASINO, FLEET",
        "JABCO rents vehicles to other entities at actual operating cost + 20-30% markup",
        "BAR/CASINO: separate staff (no labour split)",
        "Shared overheads BAR+CASINO: electricity by meter; water 60% BAR / 40% CASINO; management 50/50",
        "JABCO crew on BAR/CASINO maintenance: cost + overhead, no external markup",
        "Auto-elimination in consolidated reporting",
        "Intercompany ledger maintains running record of who owes whom"
      ]),
      spacer(),
      gapBlock(18, "Growth Triggers", "RESOLVED", [
        "IT hire trigger: complexity threshold — system mgmt + online marketing + promotions begin to consume too much of Robert's time",
        "Growth priorities: JAG Trading + DragonBridge first; JABCO close behind",
        "Auto-flag capacity constraints (inventory, staffing, logistics)",
        "Track regulatory/tax differences per country for Caribbean expansion",
        "Growth roadmap per entity with milestones, revenue targets, hiring triggers, investment needs",
        "Specific per-entity targets: TBD"
      ]),
      spacer(),
      gapBlock(19, "Photography & Media", "RESOLVED", [
        "Currently casual snapshots — formalising",
        "Upload: Robert only initially",
        "Organised by entity AND project/campaign with cross-tagging",
        "\"Approved for public\" vs \"Internal only\" flag",
        "Auto-metadata (entity, date, location, project) with manual override",
        "30-day trash bin",
        "Integrated with DocVault — attach to projects and properties"
      ]),
      spacer(),
      gapBlock(20, "Health & Safety", "RESOLVED", [
        "JABCO: not currently tracked — formalise going forward",
        "Auto-alerts on safety certification expiry (equipment, crew training, site permits)",
        "BAR/CASINO incidents: not critical now",
        "Link safety records to insurance + expense tracking",
        "Compliance checklist per site (project sites + properties)"
      ]),
      spacer(),
      gapBlock(21, "Equipment Maintenance", "RESOLVED", [
        "Currently reactive — moving to preventive",
        "Both calendar AND hours-based scheduling, alert on whichever first",
        "Log downtime and cost per equipment (worth building early for future scale)",
        "Overdue maintenance alerts",
        "Integrate with JAG Finance — costs flow to equipment expense per entity",
        "Attach photos + notes to maintenance records"
      ]),
      spacer(),
      gapBlock(22, "Energy & Utility Management", "RESOLVED", [
        "Track electricity, water, fuel — bills, costs, trends",
        "Solar/generators: not currently, but solar planned for properties",
        "Auto-flag unusual consumption spikes",
        "Track utility costs against budgets",
        "Forecast future utility costs from historical trends"
      ]),
      spacer(),
      gapBlock(23, "Inventory Reordering Intelligence", "RESOLVED", [
        "Auto-suggest reorders",
        "Both fixed minimums AND demand forecasting",
        "DragonBridge: factor 6-week China shipment lead time",
        "Supplier performance tracking (on-time, quality, rush-order favourites)",
        "Auto-create POs for review and approval"
      ]),
      spacer(),
      gapBlock(24, "Customer Feedback & Reviews", "RESOLVED", [
        "Public review monitoring (Google, TripAdvisor, industry sites): future for BAR, CASINO, JAG Trading, DragonBridge",
        "Internal feedback: tenant complaints, JABCO client ratings",
        "Negative reviews auto-escalate to Robert",
        "Track response time + resolution log",
        "Satisfaction-to-revenue correlation: future enhancement"
      ]),
      spacer(),
      gapBlock(25, "Loyalty & Rewards", "RESOLVED", [
        "BAR/CASINO loyalty: future implementation",
        "JAG Trading: points-based or tiered at launch",
        "Loyalty data feeds inventory + reordering (high-frequency products)",
        "Track customer lifetime value"
      ]),
      spacer(),
      gapBlock(26, "Vendor & Supplier Performance", "RESOLVED", [
        "Auto-rate suppliers (delivery, quality, pricing, communication)",
        "Alert on poor performance (e.g., 3-of-3 late deliveries)",
        "Track cost savings from negotiations",
        "Performance feeds reorder system (prioritise reliable vendors for rush)",
        "Vendor contact + payment terms + contract renewal dates"
      ]),
      spacer(),
      gapBlock(27, "Project Profitability Analysis", "RESOLVED", [
        "Auto-calculate profit margin per JABCO project",
        "Compare actual vs estimated costs (bid accuracy, scope creep, labour overrun)",
        "Post-project profitability report",
        "Flag unprofitable project types (residential vs commercial margins)",
        "Profitability feeds proposal system — historical-margin-based pricing suggestions"
      ]),
      spacer(),
      gapBlock(28, "Mortgage & Loan Tracking", "RESOLVED", [
        "~4 active mortgages / business loans (verify exact count)",
        "Total debt incl credit cards: ~8-10",
        "Loan register: lender, amount, rate, term, monthly payment, maturity",
        "Credit cards included (feed JAG Finance) but tracked separately from mortgages/business loans",
        "Auto-alerts on payment due dates",
        "Early payoff scenario modelling",
        "Track principal vs interest paid for equity + tax deductibility"
      ]),
      spacer(),
      gapBlock(29, "Pension & Retirement Planning", "RESOLVED", [
        "One annuity to track",
        "Project retirement income (pension + annuity + investments + rental) even though Robert does not plan to retire",
        "Net worth tracking over time",
        "Wealth transfer scenario modelling (death-tomorrow scenario for Wife, daughter, father's estate, taxes)",
        "Track Trinidad contribution limits where applicable"
      ]),
      spacer(),
      gapBlock(30, "Charitable Giving & Sponsorships", "RESOLVED", [
        "Currently ad hoc — formalising",
        "List supported organisations with contact, donation history, tax receipts",
        "Year-end donation summary",
        "Annual charity budget setting + tracking",
        "Social impact tracking (manual input — outcomes per donation)"
      ]),
      spacer(),
      gapBlock(31, "New Entity Onboarding & R&D Pipeline (NEW)", "RESOLVED", [
        "Triggered by Robert noting the state company gas station franchise opportunity should have been a new entity, not bid under JABCO",
        "System guides new-entity onboarding workflow tailored to T&T (registration, tax ID, bank, insurance, licenses, statutory)",
        "Maintain pipeline of potential entities (exploration stage)",
        "Auto-generate compliance checklists per entity type",
        "'JAG Holdings — R&D' cost centre captures exploration expenses pre-launch",
        "On entity launch: decide whether R&D rolls into new entity as startup expense or stays in Holdings",
        "Track R&D spend per opportunity — NO threshold caps ('don't limit my potential')",
        "PHASE PLACEMENT (v1.6): Phase 2 — built alongside JAG Holdings dashboard. No dependency on any operating entity being live. R&D pipeline and entity onboarding workflow available from Phase 2 onwards."
      ]),

      pageBreak(),

      // ===================== SECTION 18 — JAG LIFESTYLE =====================
      sectionHeader("18. JAG LIFESTYLE — PERSONAL REWARDS & LOYALTY TRACKER"),
      spacer(),
      body("JAG Lifestyle is the family's loyalty card and credit card rewards tracker. It consolidates roughly 10 loyalty programmes (cruise lines, airlines, hotels) and approximately 4 credit card reward programmes into one secure module that recommends the best card for each spending category and prevents points expiry."),
      spacer(),

      h2("18.1 Scope"),
      bullet("Approximately 10 loyalty programmes — cruise (Royal Caribbean, MSC, Carnival), airlines, hotels"),
      bullet("Approximately 4 credit cards with reward programmes — Republic, Scotiabank, RBC, CIBC FirstCaribbean"),
      bullet("Members tracked: Robert, Wife, Daughter, Father, Brian"),
      bullet("Access: Robert (admin) sees all members; Brian sees only his own"),
      spacer(),

      h2("18.2 Features"),
      makeTable(
        ["Feature", "Description"],
        [
          ["Programme registry", "Name, company, tier, member number, points balance, expiry, value in TTD/USD"],
          ["Encrypted credential storage", "AES-256 — usernames and passwords for each loyalty programme stored securely"],
          ["Spend Optimiser", "Tells Robert which card earns most per category (fuel, dining, travel, groceries, online, business)"],
          ["Expiry alerts", "90 / 60 / 30 day advance notice before points expire"],
          ["Redemption logging", "Every redemption recorded for ROI analysis"],
          ["Points audit trail", "Every credit and debit logged — Robert can reconcile programme statements"],
          ["JAG Finance integration", "Points value feeds personal net worth dashboard (Phase 4)"],
          ["JAG Holdings dashboard widget", "Family rewards summary visible at-a-glance"],
        ],
        [2880, 6480]
      ),
      spacer(),

      h2("18.3 Phase Placement"),
      bullet("Phase 2: Data entry forms + member registry"),
      bullet("Phase 3: Full tracker + alerts + spend optimiser + Brian's portal access + dashboard widget"),
      bullet("Phase 4: Net worth integration"),
      spacer(),

      h2("18.4 Action Item Before Build"),
      colorBox("Robert to gather: programme names, member numbers, tiers, approximate point balances, credit card reward programmes and earn rates per category. This data populates the JAG Lifestyle module on first run.", JAG_GOLD_LIGHT),

      pageBreak(),

      // ===================== SECTION 19 — OUTSTANDING ACTION ITEMS =====================
      sectionHeader("19. OUTSTANDING ACTION ITEMS"),
      spacer(),
      body("Consolidated list of every open item — legal, informational, and technical — that must be closed before or during the v1.6 build."),
      spacer(),

      h2("19.1 Legal — Consolidated Lawyer Meeting (URGENT)"),
      body("Knock these out in one combined lawyer session:"),
      body("ROBERT'S ESTATE:", { bold: true }),
      bullet("Draft Robert's Will — must reference all JAG entities, ownership structure, and beneficiary designations"),
      bullet("Draft Primary POA — Wife (JABCO + DragonBridge)"),
      bullet("Draft Backup POA — Brother (contingency)"),
      bullet("Document Robert's executor designation"),
      body("WIFE'S ESTATE (v1.6 — NEW):", { bold: true }),
      bullet("Draft Wife's own Will — personal assets, BAR/CASINO (in her name), Chinese heritage considerations, beneficiary designations"),
      bullet("Confirm trustee clause in Wife's will: Robert manages BAR/CASINO until sale OR Daughter age 25, whichever first"),
      bullet("Designate Wife's executor — Robert primary; name contingency executor"),
      bullet("Confirm Wife's beneficiaries: Robert primary, Daughter contingency"),
      bullet("Wife's own POA — designate who acts on her behalf if incapacitated"),
      body("BRIAN'S ESTATE (v1.6 — NEW):", { bold: true }),
      bullet("Draft Brian's own Will — covers parlor, NLCB booth, personal vehicles, home assets, JAG Properties share"),
      bullet("Designate Brian's executor (confirm with Brian — Robert suggested)"),
      bullet("Confirm Brian's beneficiaries and document in JAG Succession Planning module"),
      bullet("Brian's own POA — designate person to act on his behalf if incapacitated"),
      body("PROPERTY & FINANCIAL:", { bold: true }),
      bullet("Buy-sell agreement for JAG Properties (Robert + Brother shares; father's properties stay in family)"),
      bullet("Review father's properties + bank accounts — convert critical ones to joint"),
      spacer(),

      h2("19.2 Information to Gather"),
      bullet("Exact count of active mortgages / business loans (Robert estimated ~4)"),
      bullet("Total active loans including credit cards (~8-10 estimated)"),
      bullet("Dell Inspiron specs (RAM, storage, OS) for PC mirror"),
      bullet("Daughter's inheritance designation per entity (deferred to future session)"),
      bullet("Specific growth targets per entity (deferred)"),
      bullet("JAG Lifestyle: programme names, member numbers, tiers, approximate point balances, credit card reward categories and earn rates"),
      spacer(),

      h2("19.3 Technical — Pre-Build Phase (IMMEDIATE — 3-4 weeks before Phase 0)"),
      colorBox("AUTH DECISION CLOSED (v1.8): Keycloak is the auth platform. No decision session needed — begin Keycloak configuration directly in Pre-Build.", JAG_GREEN_LIGHT),
      spacer(),
      bullet("PRE-0A — DAY 1: Check Dell Inspiron specs (RAM, storage, OS). If passes min spec (8GB RAM, 500GB SSD, Win10+): proceed with PC as WAL target. If fails: activate Hetzner/Vultr warm standby immediately. Takes 5 minutes."),
      bullet("PRE-0B — DAY 1 (v1.9 SECURITY CRITICAL): Configure Cloudflare Authenticated Origin Pull. Restrict Oracle VM inbound 443 to Cloudflare published IP ranges via Oracle Security List. Configure Caddy to validate Cloudflare Origin Pull certificate. Test: direct HTTPS request to VM public IP must be rejected. Must be done before any application is deployed."),
      bullet("Complete ERD/DBML for all five databases — include pending_events outbox table in each database as part of the initial schema"),
      bullet("Draft OpenAPI YAML contract for all API endpoints — include idempotency key specification on all financial endpoints"),
      bullet("Deploy outbox table schema (pending_events) in all five databases. Deploy jag-event-dispatcher Docker container. Test: write event to jag_properties outbox, verify delivery to jag_core within 5 seconds."),
      bullet("Configure Keycloak: create jag-platform realm, register one client per module, configure full role matrix. Test SSO across two modules."),
      bullet("WiPay Pre-Build POC: obtain WiPay Business sandbox credentials. Test confirmed payment webhook, failed payment webhook, and replay. Document exact payload format. Define manual 'Pending Verification' fallback flow."),
      bullet("Bank statement parser POC: test Ollama (Mistral 7B) against real T&T bank statement PDFs from all six banks. Catalogue format variations."),
      bullet("Set up node-pg-migrate tooling across all five databases"),
      bullet("Migrate existing JABCO domain to Cloudflare Free Tier (replaces Duck DNS)"),
      bullet("Write DR failover runbook — step-by-step Oracle VM to PC mirror promotion, plus Keycloak admin reset procedure for incapacitation scenario"),
      bullet("Draft DragonBridge sub-architecture document"),
      body("THEN Phase 0 (after Pre-Build is complete):", { bold: true }),
      bullet("Create Oracle Cloud Always Free account (use IMS_Oracle_Cloud_Setup_v1.0.md)"),
      bullet("Provision Ubuntu VM (4 CPU, 24 GB RAM)"),
      bullet("Install Docker + Docker Compose + Keycloak container + jag-event-dispatcher container"),
      bullet("Verify Oracle Cost Analysis shows $0.00"),

      pageBreak(),

      // ===================== SECTION 20 — IMMEDIATE NEXT STEPS =====================
      sectionHeader("20. IMMEDIATE NEXT STEPS"),
      spacer(),
      colorBox("YOUR SINGLE NEXT ACTION: Begin the Pre-Build phase. Day 1 has two non-negotiable security checks: (PRE-0A) verify Dell Inspiron specs and (PRE-0B) configure Cloudflare Origin Pull on the Oracle VM. Then proceed to ERD/DBML for all five databases and Cloudflare DNS migration. Takes 3-4 weeks at a protected weekly time block. Costs nothing.", JAG_BLUE, WHITE),
      spacer(),
      makeTable(
        ["Step", "Action", "Reference", "Time"],
        [
          ["PRE-0A", "Check Dell Inspiron specs — WAL target gate", "Right-click My Computer > Properties. Disk Management for storage.", "5 minutes — Day 1"],
          ["PRE-0B", "Cloudflare Origin Pull — restrict VM inbound 443 to Cloudflare IPs + Caddy Origin Pull cert validation + test direct IP access is rejected", "Oracle Security List + Cloudflare IP ranges + Caddy config. Critical — before any app deployment.", "1-2 hours — Day 1"],
          ["PRE-1", "ERD/DBML for all 5 databases — include pending_events outbox table", "New session with Claude — database design", "1-2 weeks"],
          ["PRE-2", "OpenAPI YAML contract for all endpoints (idempotency keys on all financial)", "New session with Claude — API design", "1 week"],
          ["PRE-3", "Deploy outbox table + jag-event-dispatcher. Test cross-DB delivery.", "New session with Claude — event dispatcher build", "1 session"],
          ["PRE-4", "Configure Keycloak realm + clients + roles. Test SSO. (Auth DECIDED.)", "New session with Claude — Keycloak setup guide", "1-2 days"],
          ["PRE-5", "WiPay sandbox POC — all webhook scenarios + payload format + manual fallback", "WiPay Business developer portal", "1 session"],
          ["PRE-6", "Bank statement parser POC — Ollama against all 6 T&T bank formats", "New session with Claude — parser build", "1-2 days"],
          ["PRE-7", "Migrate JABCO domain to Cloudflare Free Tier", "Cloudflare.com — free account + DNS transfer", "1-2 hours"],
          ["PRE-8", "Write DR failover runbook (incl. Keycloak admin reset procedure)", "New session with Claude — runbook drafting", "1 session"],
          ["PRE-9", "Set up Oracle Cloud + Docker (Phase 0 infrastructure)", "IMS_Oracle_Cloud_Setup_v1.0.md", "1.5 hours"],
          ["PRE-10", "Schedule consolidated lawyer meeting", "Section 19.1 above", "1 day prep"],
          ["1", "Start Phase 1A: Keycloak + RLS + i18n + jag-event-dispatcher + pen test", "Load this document + JAG_Engineering_Standards_v1.1.docx at every session", "Ongoing"],
        ],
        [540, 3600, 3060, 1620]
      ),
      spacer(),

      h2("20.1 Master File List — JAG Folder"),
      bullet("JAG_Master_Architecture_v1.9.docx — THIS FILE (OFFLINE ONLY — do NOT share digitally) — FINAL PRE-BUILD DOCUMENT"),
      bullet("JAG_Master_Architecture_generator_v1.9.js — regenerator script for this document"),
      bullet("JAG_Engineering_Standards_v1.1.docx — 13 non-negotiable engineering standards (STD-01 through STD-13); load at every build session alongside this document"),
      bullet("JAG_AI_Context_Summary_v2.1.docx — SANITISED VERSION for AI sessions and external channels (reflects v1.9 architecture — 6 Gemini/Claude patches applied — READY FOR PRE-BUILD)"),
      bullet("JAG_AI_Context_Summary_generator_v2.1.js — regenerator script for the AI Context Summary"),
      bullet("JAG_Unified_Architect_Critique_v1.0.docx — dual AI review (Claude + Gemini) of architecture"),
      bullet("JAG_Cowork_Handoff_2026-05-22.md — handoff document"),
      bullet("JAG_Session_Summary_2026-05-21.md"),
      bullet("IMS_Master_Prompt_v1.0.md"),
      bullet("IMS_Data_Model_v1.0.dbml"),
      bullet("IMS_Oracle_Cloud_Setup_v1.0.md"),
      bullet("IMS_Admin_Runbook_v1.0.docx"),
      bullet("IMS_Wireframes_v1.0.pdf"),
      bullet("IMS_Phase1_SOW.docx"),
      bullet("IMS_Profiles_Library_v1.0.yaml"),
      bullet("IMS_Tag_Catalog_v1.0.yaml"),
      bullet("IMS_Trinidad_Compliance_Map_v1.0.md"),
      bullet("JAGLifestyle.jsx (new module prototype)"),
      bullet("CLAUDE.md (property management system — existing)"),
      bullet("README.md (property management system — existing)"),
      bullet("Existing expense Excel spreadsheet"),
      spacer(),

      divider(),
      spacer(),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "JAG Master Architecture Document v1.9  |  Johnson Attin Group  |  Confidential — Offline Only  |  May 2026  |  FINAL PRE-BUILD", size: 18, font: "Arial", color: "888888" })]
      }),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  const outputPath = process.argv[2] || './JAG_Master_Architecture_v1.9.docx';
  fs.writeFileSync(outputPath, buffer);
  console.log('Done: ' + outputPath);
});
ath, buffer);
  console.log('Done: ' + outputPath);
});
