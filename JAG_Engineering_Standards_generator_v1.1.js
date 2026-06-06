// JAG Engineering Standards Generator v1.1
// Robert Johnson-Attin / Johnson Attin Group
// Generated: May 23, 2026
// Changes from v1.0: Added STD-13 Expand-and-Contract Migrations (from Gemini/Claude joint review)

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType, PageBreak, LevelFormat
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

function h2(text) {
  return new Paragraph({
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
function code(text) {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    children: [new TextRun({ text, size: 18, font: "Courier New", color: "1F3864" })]
  });
}
function spacer() {
  return new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun("")] });
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
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders, width: { size: 9360, type: WidthType.DXA },
      shading: { fill: fillColor, type: ShadingType.CLEAR },
      margins: { top: 120, bottom: 120, left: 180, right: 180 },
      children: [new Paragraph({ children: [new TextRun({ text, size: 22, font: "Arial", color: textColor })] })]
    })] })]
  });
}
function sectionHeader(text) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: noBorders, width: { size: 9360, type: WidthType.DXA },
      shading: { fill: JAG_BLUE, type: ShadingType.CLEAR },
      margins: { top: 160, bottom: 160, left: 240, right: 240 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 28, color: WHITE, font: "Arial" })] })]
    })] })]
  });
}
function makeTable(headers, rows, colWidths) {
  const headerRow = new TableRow({ children: headers.map((h, i) => new TableCell({
    borders, width: { size: colWidths[i], type: WidthType.DXA },
    shading: { fill: JAG_BLUE, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, color: WHITE, font: "Arial" })] })]
  })) });
  const dataRows = rows.map((row, ri) => new TableRow({ children: row.map((cell, ci) => new TableCell({
    borders, width: { size: colWidths[ci], type: WidthType.DXA },
    shading: { fill: ri % 2 === 0 ? WHITE : JAG_GREY, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: cell, size: 20, font: "Arial" })] })]
  })) }));
  return new Table({ width: { size: colWidths.reduce((a,b)=>a+b,0), type: WidthType.DXA }, columnWidths: colWidths, rows: [headerRow, ...dataRows] });
}

// Standard block: renders a full standard with header, rule, rationale, bad/good examples
function stdBlock(id, title, category, severity, origin, why, rules, badLabel, badCode, goodLabel, goodCode) {
  const headerColor = severity === "HARD RULE" ? "8B0000" : JAG_BLUE;
  const headerFill = severity === "HARD RULE" ? JAG_RED_LIGHT : JAG_LIGHT_BLUE;
  return [
    new Table({
      width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
      rows: [new TableRow({ children: [new TableCell({
        borders, shading: { fill: headerFill, type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 120, left: 180, right: 180 },
        children: [new Paragraph({ children: [
          new TextRun({ text: `${id}  ${title}   `, bold: true, size: 26, font: "Arial", color: headerColor }),
          new TextRun({ text: `[${severity}]`, bold: true, size: 22, font: "Arial", color: severity === "HARD RULE" ? "8B0000" : JAG_BLUE }),
        ] }),
        new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: `Category: ${category}   Origin: ${origin}`, size: 18, font: "Arial", color: "555555", italics: true })] })
        ]
      })] })]
    }),
    spacer(),
    body("WHY THIS RULE EXISTS", { bold: true }),
    body(why),
    spacer(),
    body("THE RULES", { bold: true }),
    ...rules.map(r => bullet(r)),
    spacer(),
    colorBox(badLabel, JAG_RED_LIGHT, "8B0000"),
    ...badCode.map(l => code(l)),
    spacer(),
    colorBox(goodLabel, JAG_GREEN_LIGHT),
    ...goodCode.map(l => code(l)),
    spacer(),
  ];
}

const doc = new Document({
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ]
  },
  styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
  sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children: [

    // COVER PAGE
    new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
      rows: [new TableRow({ children: [new TableCell({
        borders: noBorders, shading: { fill: JAG_BLUE, type: ShadingType.CLEAR },
        margins: { top: 720, bottom: 720, left: 480, right: 480 },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 480, after: 240 }, children: [new TextRun({ text: "JOHNSON ATTIN GROUP", bold: true, size: 48, color: JAG_GOLD, font: "Arial" })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 240 }, children: [new TextRun({ text: "JAG INTEGRATED BUSINESS PLATFORM", bold: true, size: 32, color: WHITE, font: "Arial" })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 240 }, children: [new TextRun({ text: "ENGINEERING STANDARDS", bold: true, size: 48, color: JAG_GOLD, font: "Arial" })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 480 }, children: [new TextRun({ text: "& CODING CONSTRAINTS", bold: true, size: 36, color: JAG_LIGHT_BLUE, font: "Arial" })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: "Version 1.1  |  May 23, 2026", size: 22, color: WHITE, font: "Arial" })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 120 }, children: [new TextRun({ text: "13 non-negotiable standards  |  STD-13 Expand-and-Contract added", size: 22, color: JAG_GOLD, font: "Arial", italics: true })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 480 }, children: [new TextRun({ text: "Owner: Robert Johnson-Attin  |  Barataria, Trinidad & Tobago", size: 22, color: JAG_LIGHT_BLUE, font: "Arial" })] }),
        ]
      })] })]
    }),
    spacer(),
    colorBox("SHARE THIS DOCUMENT AT THE START OF EVERY CLAUDE SESSION", JAG_GOLD, "000000"),
    spacer(),
    colorBox("CONFIDENTIAL — Internal use only. This document defines the non-negotiable engineering rules for the JAG Integrated Business Platform build. Every rule in this document applies regardless of which phase is being built, who is building it, or what time pressure exists. There are no exceptions without a written change request from Robert Johnson-Attin.", JAG_RED_LIGHT, "8B0000"),
    spacer(),
    body("HOW TO USE: Paste this document — or the Quick Reference in Section 2 — into your Claude session context alongside the JAG Master Architecture document. Say: \"Apply all JAG Engineering Standards (STD-01 through STD-13) to every piece of code you write in this session.\" Claude will apply these rules consistently. Without this context, AI coding assistants will make locally reasonable choices that are globally inconsistent across sessions."),
    pageBreak(),

    // SECTION 1
    sectionHeader("1. WHY THIS DOCUMENT EXISTS"),
    spacer(),
    body("The JAG platform will be built over 7 phases across an estimated 18-24 months. Multiple Claude sessions will contribute code across that timeline. Each session starts fresh — it shares the master architecture document but has no memory of the specific coding decisions made in prior sessions."),
    spacer(),
    body("Without explicit, written engineering constraints, this creates a consistency risk: a module written in month three may handle tenant data filtering differently than the one written in month one. A security check implemented one way in JAG Properties may be skipped or implemented differently in DragonBridge. Over time, the codebase becomes a patchwork of locally sensible but globally inconsistent patterns."),
    spacer(),
    body("This document solves that problem. It defines 13 non-negotiable engineering standards that apply to every line of code written for the JAG platform, regardless of phase, module, or session. When these standards are shared with Claude at the start of every session, the AI applies them consistently — exactly as a senior developer would enforce coding standards on a team."),
    spacer(),
    colorBox("THE CORE RISK THIS DOCUMENT PREVENTS: AI-assisted development produces inconsistent code quality as sessions accumulate and original context drifts. A codebase built over 18 months without enforced standards will be harder to debug, harder to audit, harder to extend, and harder to hand off than one built with them from day one.", JAG_GOLD_LIGHT),
    pageBreak(),

    // SECTION 2 — QUICK REFERENCE
    sectionHeader("2. QUICK REFERENCE — PASTE INTO EVERY CLAUDE SESSION"),
    spacer(),
    body("Copy the block below and paste it into your Claude session prompt alongside the JAG Master Architecture document. This is the minimum context Claude needs to apply all 13 standards."),
    spacer(),
    new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
      rows: [new TableRow({ children: [new TableCell({
        borders, shading: { fill: "F8F8F8", type: ShadingType.CLEAR },
        margins: { top: 160, bottom: 160, left: 240, right: 240 },
        children: [
          new Paragraph({ children: [new TextRun({ text: "=== JAG ENGINEERING STANDARDS — APPLY TO ALL CODE IN THIS SESSION ===", bold: true, size: 20, font: "Courier New", color: JAG_BLUE })] }),
          new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: "STD-01 MODULE ISOLATION: Modules communicate via JAG Holdings API only.", size: 20, font: "Courier New" })] }),
          new Paragraph({ children: [new TextRun({ text: "         Never write directly to another module's database tables.", size: 20, font: "Courier New" })] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "STD-02 RLS FIRST: Tenant isolation is enforced at the PostgreSQL layer.", size: 20, font: "Courier New" })] }),
          new Paragraph({ children: [new TextRun({ text: "         Application-layer filtering is a second line of defence, not the first.", size: 20, font: "Courier New" })] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "STD-03 TEST FIRST (SECURITY): Write a failing tenant-isolation test before", size: 20, font: "Courier New" })] }),
          new Paragraph({ children: [new TextRun({ text: "         building any data-access feature. Ship only when the test passes.", size: 20, font: "Courier New" })] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "STD-04 MIGRATION FIRST: Every schema change is a migration file.", size: 20, font: "Courier New" })] }),
          new Paragraph({ children: [new TextRun({ text: "         No ad-hoc SQL on the live database. Ever.", size: 20, font: "Courier New" })] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "STD-05 API VERSIONING: All endpoints are /api/v1/. No breaking changes", size: 20, font: "Courier New" })] }),
          new Paragraph({ children: [new TextRun({ text: "         without a version increment.", size: 20, font: "Courier New" })] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "STD-06 ERROR ENVELOPE: All API errors return:", size: 20, font: "Courier New" })] }),
          new Paragraph({ children: [new TextRun({ text: "         { success, data, error, code }. No raw stack traces to client.", size: 20, font: "Courier New" })] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "STD-07 NO SECRETS IN CODE: All credentials live in env vars or Oracle Vault.", size: 20, font: "Courier New" })] }),
          new Paragraph({ children: [new TextRun({ text: "         Zero exceptions.", size: 20, font: "Courier New" })] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "STD-08 STRUCTURED LOGGING: Every server event logs JSON with:", size: 20, font: "Courier New" })] }),
          new Paragraph({ children: [new TextRun({ text: "         entity, action, user_id, tenant_id, timestamp, severity.", size: 20, font: "Courier New" })] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "STD-09 TYPESCRIPT STRICT: tsconfig strict:true always. No any types.", size: 20, font: "Courier New" })] }),
          new Paragraph({ children: [new TextRun({ text: "         No implicit returns.", size: 20, font: "Courier New" })] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "STD-10 INPUT VALIDATION: Validate and sanitise all user input server-side", size: 20, font: "Courier New" })] }),
          new Paragraph({ children: [new TextRun({ text: "         before touching the database. Use Zod schemas.", size: 20, font: "Courier New" })] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "STD-11 IDEMPOTENT FINANCIAL OPS: All financial write operations carry", size: 20, font: "Courier New" })] }),
          new Paragraph({ children: [new TextRun({ text: "         an idempotency key. Duplicate submissions must never double-post.", size: 20, font: "Courier New" })] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "STD-12 DEPLOY GATE: No code goes to production without:", size: 20, font: "Courier New" })] }),
          new Paragraph({ children: [new TextRun({ text: "         (a) passing all tests, (b) running migrations, (c) Robert sign-off.", size: 20, font: "Courier New" })] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "STD-13 EXPAND-AND-CONTRACT: Columns and tables are never renamed or dropped", size: 20, font: "Courier New", bold: true, color: "8B0000" })] }),
          new Paragraph({ children: [new TextRun({ text: "         in a single deployment. Use the 5-step Expand-and-Contract pattern.", size: 20, font: "Courier New", bold: true, color: "8B0000" })] }),
          new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: "=== END JAG ENGINEERING STANDARDS ===", bold: true, size: 20, font: "Courier New", color: JAG_BLUE })] }),
        ]
      })] })]
    }),
    pageBreak(),

    // SECTION 3 — FULL STANDARDS
    sectionHeader("3. FULL STANDARDS — DETAILED SPECIFICATION"),
    spacer(),
    body("Each standard below includes the rule, the rationale, a bad example, and the correct implementation. Read this section once thoroughly. Use the Quick Reference in Section 2 for ongoing session prompting."),
    spacer(),

    // STD-01
    ...stdBlock("STD-01", "MODULE ISOLATION", "Security", "HARD RULE",
      "Enforced by: Third Architect (primary) + Claude (confirmed)",
      "The JAG platform has 12+ business entities. If modules can write directly to each other's database tables, a bug in one module can corrupt data in another. A JABCO foreman's mobile app should never be able to — even accidentally — modify a BAR cash float or a tenant's rent record. Module isolation makes each entity's data physically protected from lateral corruption.",
      [
        "Every business module (JABCO, BAR, Members Club, DragonBridge, Properties, Brian's Portal, etc.) is a self-contained unit.",
        "Modules may READ shared master data (vendors, customers, FX rates, users) from jag_core via API calls only.",
        "Modules must NEVER write directly to another module's database tables — not even to jag_core. All writes to shared data go through the JAG Holdings API, which validates, logs, and posts the change.",
        "Shared master records (e.g. a vendor that exists in both JABCO and DragonBridge) are owned by jag_core. Modules reference them by foreign key. Modules do not duplicate them.",
        "Inter-module data flows are events posted to the JAG Holdings API — never direct SQL INSERTs or UPDATEs across database boundaries.",
      ],
      "NEVER DO THIS:",
      ["// BAD: JABCO module writing directly to Properties table", "await db.query(\"INSERT INTO jag_properties.rents ...\");"],
      "ALWAYS DO THIS:",
      ["// GOOD: JABCO posts an event to Holdings API", "await api.post('/api/v1/holdings/events', { type: 'intercompany_charge', ... });"]
    ),

    // STD-02
    ...stdBlock("STD-02", "RLS FIRST — DATABASE-LAYER TENANT ISOLATION", "Security", "HARD RULE",
      "Enforced by: Third Architect (primary) + Gemini (confirmed) + Claude (confirmed)",
      "Application-layer filtering (WHERE tenant_id = $1 in your Node.js code) can be bypassed by a bug, a missing WHERE clause, or a future developer who forgets the rule. PostgreSQL Row-Level Security cannot be bypassed by application code — it is enforced at the database engine level. Brian's data must be physically unreachable from a JABCO connection, not just filtered by application logic.",
      [
        "Every table in every JAG database has a PostgreSQL RLS policy enforced at the database level.",
        "Application-layer tenant filtering (WHERE tenant_id = $1) is ALSO required — it is the second line of defence, not the first.",
        "Never assume that because the application filters correctly, the database does not need RLS. Both layers must be active simultaneously.",
        "Brian's portal databases (jag_brian) are fully air-gapped: no connection string from any JAG operational module can reach jag_brian.",
        "After every schema migration, run the cross-tenant isolation test suite (STD-03) to verify RLS is still enforced correctly.",
        "Superuser database connections are used only for migrations and emergency recovery — never for application runtime queries.",
      ],
      "NEVER DO THIS:",
      ["// BAD: Relying only on app-layer filtering", "const rents = await db.query('SELECT * FROM rents WHERE tenant_id = $1', [tenantId]);"],
      "ALWAYS DO THIS:",
      [
        "// GOOD: RLS enforced at DB + app filter as second layer",
        "// DB connection established with: SET LOCAL app.current_tenant = $tenantId;",
        "// RLS policy: CREATE POLICY tenant_isolation ON rents",
        "//   USING (tenant_id = current_setting('app.current_tenant')::uuid);",
        "// App still adds WHERE clause as defence-in-depth",
      ]
    ),

    // STD-03
    ...stdBlock("STD-03", "TEST FIRST — SECURITY BEFORE FEATURE", "Testing", "HARD RULE",
      "Enforced by: Third Architect (primary)",
      "The most common way security checks get skipped is time pressure. When a feature is needed urgently, a developer writes the feature first and plans to 'add the security test later.' Later never comes. By requiring the security test to be written FIRST — and to fail before the feature exists — this rule makes it structurally impossible to ship a feature without its security verification.",
      [
        "Before writing any code for a new data-access feature, write a test that proves an unauthorised user CANNOT access the data. This test must fail before the feature is built.",
        "Write the feature. The test must now pass. If the test cannot be made to pass, the feature does not ship.",
        "Every API endpoint that reads or writes data gets at minimum: (1) authorised-access test, (2) unauthorised-access test with wrong tenant, (3) unauthorised-access test with wrong role.",
        "Financial calculation tests (reconciliation, FX conversion, intercompany elimination) are written before the calculation function is implemented.",
        "Tests live in a /tests directory at the module level. They run automatically on every deployment via the deploy script (STD-12).",
      ],
      "NEVER DO THIS:",
      ["// BAD: Build the feature, plan to test later", "async function getRents(tenantId) { return db.query('SELECT * FROM rents'); }"],
      "ALWAYS DO THIS:",
      [
        "// GOOD: Test written first (fails), then feature built until test passes",
        "test('rejects wrong tenant', async () => {",
        "  const res = await api.get('/api/v1/rents', { headers: { tenant: 'WRONG_ID' } });",
        "  expect(res.status).toBe(403);",
        "});",
      ]
    ),

    // STD-04
    ...stdBlock("STD-04", "MIGRATION FIRST — ALL SCHEMA CHANGES ARE FILES", "Data", "HARD RULE",
      "Enforced by: Claude",
      "A database schema is a living document across 7 phases and 18+ months. Without migration files, nobody knows which SQL was run on the live server versus the development machine. By month 6, you will have schema drift. This makes every future change a gamble.",
      [
        "Every schema change — new table, new column, index, constraint, RLS policy change — is a migration file created using node-pg-migrate.",
        "Migration files are numbered sequentially and committed to the git repository before any application code that depends on them.",
        "No manual SQL is ever run on the live production database outside of a migration file. No exceptions.",
        "Migration files run automatically as part of the deploy script (STD-12) before the application restarts.",
        "Rollback migrations are written alongside forward migrations for every change that could destroy data.",
        "Migrations run against all five logical databases as appropriate — a migration for jag_commercial does not touch jag_core unless explicitly required.",
      ],
      "NEVER DO THIS:",
      ["// BAD: Running ad-hoc SQL directly on production", "psql -c \"ALTER TABLE rents ADD COLUMN late_fee NUMERIC;\""],
      "ALWAYS DO THIS:",
      [
        "// GOOD: Create a migration file",
        "// migrations/20260522_001_add_late_fee_to_rents.js",
        "exports.up = async (db) => {",
        "  await db.addColumn('rents', 'late_fee', { type: 'numeric', notNull: false });",
        "};",
        "exports.down = async (db) => { await db.removeColumn('rents', 'late_fee'); };",
      ]
    ),

    // STD-05
    ...stdBlock("STD-05", "API VERSIONING — ALL ENDPOINTS AT /api/v1/", "API", "ARCHITECTURE",
      "Enforced by: Claude",
      "Phase 1 endpoints will still be in use when Phase 4 modules are added. If an endpoint signature changes without versioning, existing integrations break silently. With 12+ modules all talking to JAG Holdings, a single unversioned breaking change can cascade across the entire platform.",
      [
        "All API endpoints are prefixed with /api/v1/ from day one.",
        "Breaking changes (changed response shape, removed fields, changed authentication) require a new version prefix (/api/v2/).",
        "Old versions remain functional for a minimum of one full phase after the new version is released.",
        "Internal module-to-module API calls follow the same versioning rules as external-facing APIs.",
        "API contract changes are documented in the changelog before code is written.",
      ],
      "NEVER DO THIS:",
      ["// BAD: Unversioned endpoint", "app.get('/rents', getRents);"],
      "ALWAYS DO THIS:",
      ["// GOOD: Versioned from day one", "app.get('/api/v1/properties/rents', getRents);"]
    ),

    // STD-06
    ...stdBlock("STD-06", "ERROR ENVELOPE — STANDARD API ERROR FORMAT", "API", "ARCHITECTURE",
      "Enforced by: Claude",
      "When errors are returned inconsistently — sometimes as plain strings, sometimes as HTTP status codes only, sometimes as raw stack traces — client code cannot reliably handle them. Mobile PWA users see cryptic errors. Raw stack traces exposed to clients are also a security risk.",
      [
        "All API responses — success or error — use the standard JAG envelope format.",
        "Success: { success: true, data: { ... } }",
        "Error: { success: false, data: null, error: 'Human-readable message', code: 'ERROR_CODE_CONSTANT' }",
        "HTTP status codes are used correctly: 200, 400, 401, 403, 404, 500.",
        "Raw stack traces, database error messages, and internal paths are never included in API error responses sent to clients.",
        "Detailed errors are logged server-side (STD-08) with full stack trace. The client receives only the human-readable message and error code.",
      ],
      "NEVER DO THIS:",
      ["// BAD: Raw error thrown to client", "res.status(500).json({ error: err.stack });"],
      "ALWAYS DO THIS:",
      [
        "// GOOD: Standard envelope",
        "res.status(500).json({",
        "  success: false, data: null,",
        "  error: 'Failed to retrieve rent records. Please try again.',",
        "  code: 'RENTS_FETCH_ERROR'",
        "});",
      ]
    ),

    // STD-07
    ...stdBlock("STD-07", "NO SECRETS IN CODE — ALL CREDENTIALS IN ENV / VAULT", "Security", "HARD RULE",
      "Enforced by: Claude",
      "A single API key committed to a git repository can compromise an entire system. Oracle Vault exists specifically to store credentials securely. Credentials in code or in Docker Compose files are exposed to anyone who can read those files.",
      [
        "All credentials, API keys, database passwords, JWT secrets, WiPay tokens, and encryption keys live in environment variables or Oracle Vault.",
        "The .env file is in .gitignore. It is never committed to the git repository under any circumstances.",
        "Docker Compose files reference env variables (${VARIABLE_NAME}) — they never contain literal credential values.",
        "A git pre-commit hook scans for common credential patterns and blocks commits that contain them.",
        "If a credential is accidentally committed, it is rotated immediately — not just removed from history.",
      ],
      "NEVER DO THIS:",
      ["// BAD: Hardcoded credential", "const client = new WiPayClient({ apiKey: 'sk_live_abc123xyz' });"],
      "ALWAYS DO THIS:",
      ["// GOOD: From environment", "const client = new WiPayClient({ apiKey: process.env.WIPAY_API_KEY });"]
    ),

    // STD-08
    ...stdBlock("STD-08", "STRUCTURED LOGGING — JSON WITH REQUIRED FIELDS", "Logging", "ARCHITECTURE",
      "Enforced by: Claude",
      "When the tenant portal fails at 11pm or JAG Finance silently stops pulling FX rates, the diagnostic trail is everything. Unstructured log strings cannot be searched, filtered, or alerted on. Structured JSON logs can be aggregated by Loki, alerted on by Grafana, and filtered by any dimension.",
      [
        "Every server-side log event is a JSON object — never a plain string.",
        "Required fields on every log entry: timestamp (ISO 8601), severity (DEBUG/INFO/WARN/ERROR), entity, action, user_id, tenant_id.",
        "Errors include: error_code, error_message, stack (server-side only — never sent to client per STD-06).",
        "Financial events are always logged at INFO level with full transaction details — amount, currency, entity, account.",
        "No console.log() in production code. Use the JAG logger module (structured JSON wrapper) exclusively.",
      ],
      "NEVER DO THIS:",
      ["// BAD: Unstructured string log", "console.log('Error: rent payment failed for tenant 456');"],
      "ALWAYS DO THIS:",
      [
        "// GOOD: Structured JSON via JAG logger",
        "logger.error({",
        "  entity: 'PROPS', action: 'RENT_PAYMENT_FAILED',",
        "  user_id: userId, tenant_id: tenantId,",
        "  error_code: 'WIPAY_WEBHOOK_TIMEOUT',",
        "  amount: 2500.00, currency: 'TTD'",
        "});",
      ]
    ),

    // STD-09
    ...stdBlock("STD-09", "TYPESCRIPT STRICT MODE — NO EXCEPTIONS", "Data", "ARCHITECTURE",
      "Enforced by: Claude",
      "TypeScript strict mode catches entire classes of bugs at compile time: null pointer exceptions, type mismatches, missing return paths, implicit any types. In a financial system handling 20+ bank accounts, multiple currencies, and complex intercompany transactions, type safety is not optional.",
      [
        "tsconfig.json has strict: true in all projects — no exceptions.",
        "No any types anywhere in the codebase. Use unknown and narrow types explicitly.",
        "No non-null assertions (!.) unless accompanied by a comment explaining why the value is guaranteed non-null.",
        "All database query results are typed using generated types from the schema.",
        "Financial amounts are always typed as number in TypeScript and NUMERIC in PostgreSQL — never string, never float for currency.",
      ],
      "NEVER DO THIS:",
      ["// BAD: Implicit any, no type safety", "function processPayment(data: any) { return data.amount * data.rate; }"],
      "ALWAYS DO THIS:",
      [
        "// GOOD: Strict typing",
        "interface PaymentData { amount: number; currency: 'TTD' | 'USD' | 'CNY'; exchangeRate: number; }",
        "function processPayment(data: PaymentData): number {",
        "  return data.amount * data.exchangeRate;",
        "}",
      ]
    ),

    // STD-10
    ...stdBlock("STD-10", "INPUT VALIDATION — ZOD SCHEMAS ON ALL USER INPUT", "Security", "HARD RULE",
      "Enforced by: Claude",
      "SQL injection, malformed financial amounts, invalid tenant IDs, and date format attacks all exploit unvalidated input. In a system where JABCO foremen scan QR codes on mobile, Brian uploads bank statements, and tenants submit rent payments, user input comes from many sources with varying reliability.",
      [
        "All API endpoint inputs (body, query params, path params) are validated with a Zod schema before any business logic runs.",
        "Validation happens server-side always — client-side validation is UX convenience only, not security.",
        "Invalid input returns HTTP 400 with a descriptive error message (STD-06 envelope) listing what failed validation.",
        "Financial amounts are validated as positive numbers with maximum precision of 2 decimal places.",
        "File uploads (bank statements, photos, AutoCAD drawings) are validated for MIME type, file size limit, and entity ownership before processing.",
      ],
      "NEVER DO THIS:",
      ["// BAD: Direct DB insert from unvalidated input", "await db.query('INSERT INTO payments (amount) VALUES ($1)', [req.body.amount]);"],
      "ALWAYS DO THIS:",
      [
        "// GOOD: Zod validation before DB",
        "const PaymentSchema = z.object({",
        "  amount: z.number().positive().multipleOf(0.01),",
        "  currency: z.enum(['TTD', 'USD', 'CNY']),",
        "});",
        "const parsed = PaymentSchema.safeParse(req.body);",
        "if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.message, code: 'VALIDATION_ERROR' });",
      ]
    ),

    // STD-11
    ...stdBlock("STD-11", "IDEMPOTENT FINANCIAL OPERATIONS", "Data", "HARD RULE",
      "Enforced by: Claude",
      "Financial operations are the highest-risk category for duplicate execution. A WiPay webhook may fire twice if the first delivery times out. A user may double-tap a payment button on mobile. A retry after a network failure may re-submit a transaction. Without idempotency keys, these scenarios double-post financial records.",
      [
        "Every financial write operation (payment received, expense posted, intercompany charge, FX conversion) includes a client-generated idempotency key.",
        "The server stores idempotency keys with a TTL of 24 hours. If the same key arrives twice, the second request returns the result of the first — without executing the operation again.",
        "WiPay webhooks, bank statement imports, and manual transaction entries all carry idempotency protection.",
        "Idempotency keys are UUIDs generated by the client — never generated by the server.",
        "Failed financial operations are retried with the same idempotency key — never with a new one.",
      ],
      "NEVER DO THIS:",
      ["// BAD: No idempotency — double webhook fires twice", "await db.query('INSERT INTO payments (amount, tenant) VALUES ($1, $2)', [amount, tenantId]);"],
      "ALWAYS DO THIS:",
      [
        "// GOOD: Idempotency key check before insert",
        "const existing = await db.query('SELECT id FROM payments WHERE idempotency_key = $1', [key]);",
        "if (existing.rows.length > 0) return res.json({ success: true, data: existing.rows[0] });",
        "await db.query('INSERT INTO payments (amount, tenant, idempotency_key) VALUES ($1, $2, $3)', [amount, tenantId, key]);",
      ]
    ),

    // STD-12
    ...stdBlock("STD-12", "DEPLOY GATE — THREE CONDITIONS TO SHIP", "Deployment", "HARD RULE",
      "Enforced by: Claude",
      "Manual deployments under time pressure produce the most bugs. A 'quick fix' pushed directly to production at 9pm that skips tests and migrations is the most common cause of data corruption and extended outages. The deploy gate makes it structurally impossible to ship code that hasn't been validated.",
      [
        "Code goes to production only via the automated deploy script — never via manual git pull and docker restart.",
        "The deploy script enforces three gates in sequence: (1) all automated tests pass, (2) database migrations run successfully, (3) Robert has approved the deployment.",
        "If any gate fails, the deployment stops and rolls back automatically to the last known-good state.",
        "Hotfixes follow the same gate process — the only difference is that Robert approves verbally and documents it within 24 hours.",
        "Every deployment is logged with: timestamp, deployer, git commit hash, modules changed, migration files run, test results.",
        "The deploy script runs against staging first. Production deployment requires staging to be green.",
      ],
      "NEVER DO THIS:",
      ["// BAD: Manual hotfix under pressure", "ssh oracle-vm && git pull origin main && docker compose restart api"],
      "ALWAYS DO THIS:",
      [
        "// GOOD: Gate-enforced deploy",
        "./scripts/deploy.sh --env production",
        "# Script runs: tests -> migrations -> health check -> restart -> verify",
        "# Rolls back automatically if any step fails",
      ]
    ),

    pageBreak(),

    // STD-13 — NEW
    sectionHeader("STD-13  EXPAND-AND-CONTRACT MIGRATIONS   [HARD RULE]"),
    spacer(),
    colorBox("ADDED IN v1.1 — SOURCE: Gemini/Claude joint architectural review (May 23, 2026). This standard closes the gap between STD-04 (migration files required) and safe zero-downtime deployment. STD-04 governs HOW changes are tracked. STD-13 governs HOW destructive changes are executed without crashing running services.", JAG_GOLD_LIGHT),
    spacer(),
    body("Category: Data   Origin: Gemini architectural review + Claude (confirmed)   Severity: HARD RULE", { italics: true }),
    spacer(),
    body("WHY THIS RULE EXISTS", { bold: true }),
    body("The JAG platform runs on Docker Compose with a single production database instance per module. When a destructive migration (DROP COLUMN, RENAME COLUMN, RENAME TABLE) is applied while the current application container is still running, the running API workers crash immediately — they reference columns and tables that no longer exist. With Docker Compose rolling restarts, there is a window where old and new code run simultaneously against the same database. A column that is removed in one migration can crash old code still in flight."),
    spacer(),
    body("This is not a theoretical risk. It is the most common cause of self-inflicted production downtime in single-instance deployments. The Expand-and-Contract pattern eliminates this class of downtime entirely."),
    spacer(),
    body("THE RULES", { bold: true }),
    bullet("Columns and tables are NEVER renamed or dropped in a single deployment cycle alongside the code that removes the reference."),
    bullet("Any schema change that removes, renames, or restructures existing columns or tables must follow the 5-step Expand-and-Contract pattern (see below)."),
    bullet("New columns (ADD COLUMN) with no existing code dependency are safe to deploy in a single step — this rule applies only to destructive changes."),
    bullet("The full 5-step cycle may span multiple deployment sessions. Each step is a separate migration file committed and deployed independently."),
    bullet("Document the current step (1 through 5) in a comment at the top of each migration file so future sessions know where the cycle stands."),
    spacer(),
    colorBox("THE 5-STEP EXPAND-AND-CONTRACT PATTERN", JAG_BLUE, WHITE),
    spacer(),
    makeTable(
      ["Step", "Migration Action", "Code Action", "Safe to Deploy?"],
      [
        ["1 — Expand", "Add new column alongside old column (both exist)", "No code change — old column still used", "Yes — purely additive"],
        ["2 — Dual-write", "No migration needed", "Update code to write to BOTH old and new column simultaneously", "Yes — backwards compatible"],
        ["3 — Backfill", "Run background script to copy old column data to new column for existing rows", "No code change", "Yes — additive data operation"],
        ["4 — Read switchover", "No migration needed", "Update code to read from new column only; stop reading from old column", "Yes — new column has all data"],
        ["5 — Contract", "DROP old column (safe — no code references it)", "No code change", "Yes — old column is now dead code"],
      ],
      [540, 2880, 2880, 2160]
    ),
    spacer(),
    body("WORKED EXAMPLE — Renaming payments.amount to payments.amount_ttd", { bold: true }),
    spacer(),
    colorBox("NEVER DO THIS — Single destructive migration crashes running API workers:", JAG_RED_LIGHT, "8B0000"),
    code("// BAD: Single migration renames column while old code still runs"),
    code("exports.up = async (db) => {"),
    code("  await db.renameColumn('payments', 'amount', 'amount_ttd');  // CRASHES running workers"),
    code("};"),
    spacer(),
    colorBox("ALWAYS DO THIS — Expand-and-Contract across 5 safe deployments:", JAG_GREEN_LIGHT),
    code("// STEP 1 migration: add new column (old column stays)"),
    code("await db.addColumn('payments', 'amount_ttd', { type: 'numeric' });"),
    code(""),
    code("// STEP 2 code: write to both columns"),
    code("await db.query('INSERT INTO payments (amount, amount_ttd) VALUES ($1, $1)', [value]);"),
    code(""),
    code("// STEP 3 migration: backfill existing rows"),
    code("await db.query('UPDATE payments SET amount_ttd = amount WHERE amount_ttd IS NULL');"),
    code(""),
    code("// STEP 4 code: read from new column only"),
    code("await db.query('SELECT amount_ttd FROM payments WHERE ...');"),
    code(""),
    code("// STEP 5 migration: drop old column (safe — nothing references it)"),
    code("await db.removeColumn('payments', 'amount');"),
    spacer(),
    colorBox("DECISION LOCKED (v1.9 Architecture + v1.1 Standards): Expand-and-Contract is a HARD RULE for all destructive schema changes across all JAG modules, all phases, all Claude sessions.", JAG_GREEN_LIGHT),

    pageBreak(),

    // SECTION 4 — SUMMARY TABLE
    sectionHeader("4. STANDARDS SUMMARY TABLE"),
    spacer(),
    makeTable(
      ["ID", "Standard", "Category", "Severity", "Origin"],
      [
        ["STD-01", "Module Isolation — no cross-module direct DB writes", "Security", "HARD RULE", "Third Architect"],
        ["STD-02", "RLS First — database-layer tenant isolation before app layer", "Security", "HARD RULE", "Third Architect + All"],
        ["STD-03", "Test First — write failing security test before feature", "Testing", "HARD RULE", "Third Architect"],
        ["STD-04", "Migration First — all schema changes are versioned files", "Data", "HARD RULE", "Claude"],
        ["STD-05", "API Versioning — all endpoints at /api/v1/", "API", "ARCHITECTURE", "Claude"],
        ["STD-06", "Error Envelope — standard { success, data, error, code }", "API", "ARCHITECTURE", "Claude"],
        ["STD-07", "No Secrets in Code — all credentials in env / Oracle Vault", "Security", "HARD RULE", "Claude"],
        ["STD-08", "Structured Logging — JSON with entity, action, user, tenant, timestamp", "Logging", "ARCHITECTURE", "Claude"],
        ["STD-09", "TypeScript Strict — strict:true, no any types", "Data", "ARCHITECTURE", "Claude"],
        ["STD-10", "Input Validation — Zod schemas on all user input server-side", "Security", "HARD RULE", "Claude"],
        ["STD-11", "Idempotent Financial Ops — idempotency keys on all financial writes", "Data", "HARD RULE", "Claude"],
        ["STD-12", "Deploy Gate — tests + migrations + sign-off before production", "Deployment", "HARD RULE", "Claude"],
        ["STD-13", "Expand-and-Contract — destructive schema changes use 5-step pattern; never rename or drop in a single deployment", "Data", "HARD RULE", "Gemini + Claude"],
      ],
      [468, 4680, 936, 936, 1340]
    ),
    spacer(),
    body("HARD RULE = Non-negotiable. A violation is a build defect, not a style preference. Roll back and fix before proceeding."),
    body("ARCHITECTURE = Strong architectural guidance. Deviations require a written change request from Robert before the code is merged."),
    pageBreak(),

    // SECTION 5 — PHASE GUIDANCE
    sectionHeader("5. HOW TO APPLY THESE STANDARDS AT EACH BUILD PHASE"),
    spacer(),
    makeTable(
      ["Phase", "Standards Most Critical", "Verification Step"],
      [
        ["Pre-Build", "STD-01 (module boundaries defined), STD-02 (RLS policies drafted), STD-04 (migration tool configured), STD-13 (Expand-and-Contract pattern documented in team knowledge)", "ERD reviewed against STD-01 module boundaries before coding starts"],
        ["Phase 1A (Security Foundation)", "STD-02, STD-03, STD-07, STD-09, STD-10", "Cross-tenant penetration tests written (STD-03) and passing before Phase 1B begins"],
        ["Phase 1B (IMS, JABCO, CRM)", "STD-01, STD-03, STD-04, STD-05, STD-06, STD-08, STD-13", "Every JABCO API endpoint has authorised + unauthorised test. Every financial calc has a unit test. First migration files use STD-13 pattern for any destructive changes."],
        ["Phase 2 (Properties, DocVault)", "STD-03, STD-10, STD-11, STD-12, STD-13", "Rent payment flow tested for idempotency (STD-11). Any schema evolution uses Expand-and-Contract (STD-13)."],
        ["Phase 3 (Brian, DragonBridge, BAR)", "STD-01, STD-02, STD-11, STD-13", "Brian portal air-gap verified. Any column renames use full 5-step STD-13 cycle."],
        ["Phase 4 (Finance, Wealth)", "STD-09, STD-11, STD-06, STD-13", "All FX conversion calculations typed. Financial schema changes strictly follow STD-13 — no direct column drops on payment tables."],
        ["Phase 5+ (Holdings, HR, Export)", "STD-05, STD-08, STD-12, STD-13", "All APIs versioned. Staging deployment gate tested. Logging verified across all modules. Any schema refactors use Expand-and-Contract."],
      ],
      [1440, 4140, 3780]
    ),
    pageBreak(),

    // SECTION 6 — CHANGE CONTROL
    sectionHeader("6. CHANGE CONTROL FOR THIS DOCUMENT"),
    spacer(),
    body("These standards are not suggestions. They are the engineering constitution of the JAG platform. Changes require the following process:"),
    spacer(),
    bullet("Written change request submitted by Robert Johnson-Attin stating: which standard, what change, and why."),
    bullet("Impact assessment: which existing code would the change affect? What migration or refactor would be required?"),
    bullet("Version number increment on this document. New version shared at all subsequent Claude sessions."),
    bullet("No standard is removed — only amended or superseded. The change log tracks every revision."),
    spacer(),
    makeTable(
      ["Version", "Date", "Changes"],
      [
        ["1.0", "May 22, 2026", "Initial release. 12 standards established. STD-01 through STD-03 originated from Third Architect review. STD-04 through STD-12 from Claude assessment."],
        ["1.1", "May 23, 2026", "STD-13 Expand-and-Contract Migrations added. Source: Gemini/Claude joint architectural review of JAG Master Architecture v1.8. Closes the gap between STD-04 (migration tracking) and safe zero-downtime deployment for destructive schema changes. Quick Reference, Summary Table, Phase Guidance, and document count updated to reflect 13 standards."],
      ],
      [936, 1440, 6984]
    ),
    spacer(),
    divider(),
    spacer(),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Johnson Attin Group  |  JAG Engineering Standards v1.1  |  Confidential  |  May 23, 2026  |  Share at every Claude session", size: 18, font: "Arial", color: "888888" })] }),

  ]}]
});

Packer.toBuffer(doc).then(buffer => {
  const outputPath = process.argv[2] || './JAG_Engineering_Standards_v1.1.docx';
  fs.writeFileSync(outputPath, buffer);
  console.log('Done: ' + outputPath);
});
