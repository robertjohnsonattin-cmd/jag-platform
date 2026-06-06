// JAG Phase Close Review Generator v3.0
// Phase 4 Finance — COMPLETE
// June 5, 2026

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, LevelFormat
} = require('docx');
const fs = require('fs');
const path = require('path');

const JAG_BLUE   = "1F3864";
const JAG_GOLD   = "C9A84C";
const JAG_GREEN  = "1E6B3C";
const JAG_RED    = "C0392B";
const JAG_GREY   = "F2F2F2";
const JAG_LIGHT  = "D5E8F0";
const JAG_GOLD_L = "FFF3CD";
const JAG_GREEN_L= "D4EDDA";
const JAG_RED_L  = "FCE4D6";
const WHITE      = "FFFFFF";
const BORDER_C   = "CCCCCC";

const border    = { style: BorderStyle.SINGLE, size: 1, color: BORDER_C };
const borders   = { top: border, bottom: border, left: border, right: border };
const noBorder  = { style: BorderStyle.NONE, size: 0, color: WHITE };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

function p(children, opts = {}) {
  return new Paragraph({ spacing: { before: 80, after: 80 }, children, ...opts });
}
function t(text, opts = {}) { return new TextRun({ text, size: 22, font: "Arial", ...opts }); }
function spacer() { return p([t("")]); }
function divider() {
  return new Paragraph({
    spacing: { before: 160, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: JAG_BLUE, space: 1 } },
    children: [t("")]
  });
}
function sectionHeader(text) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: noBorders, shading: { fill: JAG_BLUE, type: ShadingType.CLEAR },
      margins: { top: 140, bottom: 140, left: 220, right: 220 },
      children: [p([t(text, { bold: true, size: 26, color: WHITE })])]
    })]})]
  });
}
function subsectionHeader(text, fill = JAG_LIGHT) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders, shading: { fill, type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 200, right: 200 },
      children: [p([t(text, { bold: true, size: 23, color: JAG_BLUE })])]
    })]})]
  });
}
function colorBox(text, fill, color = "000000") {
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders, shading: { fill, type: ShadingType.CLEAR },
      margins: { top: 120, bottom: 120, left: 180, right: 180 },
      children: [p([t(text, { color })])]
    })]})]
  });
}
function bullet(text, bold = false) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: 60, after: 60 },
    children: [t(text, { bold })]
  });
}
function makeTable(headers, rows, colWidths) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const hdrRow = new TableRow({
    children: headers.map((h, i) => new TableCell({
      borders, width: { size: colWidths[i], type: WidthType.DXA },
      shading: { fill: JAG_BLUE, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [p([t(h, { bold: true, size: 20, color: WHITE })])]
    }))
  });
  const dataRows = rows.map((row, ri) => new TableRow({
    children: row.map((cell, ci) => {
      const isStatus = typeof cell === 'string' && (cell === 'PASS' || cell === 'COMPLETE' || cell === 'LIVE' || cell === 'YES');
      const isWarn   = typeof cell === 'string' && (cell === 'WARN' || cell === 'PARTIAL');
      const isGold   = typeof cell === 'string' && (cell === 'N/A' || cell === 'DEFERRED');
      const fill = isStatus ? JAG_GREEN_L : isWarn ? JAG_GOLD_L : isGold ? JAG_GOLD_L : (ri % 2 === 0 ? WHITE : JAG_GREY);
      const color = isStatus ? JAG_GREEN : isWarn ? "7D5A00" : "000000";
      return new TableCell({
        borders, width: { size: colWidths[ci], type: WidthType.DXA },
        shading: { fill, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [p([t(cell, { size: 20, bold: isStatus, color })])]
      });
    })
  }));
  return new Table({ width: { size: totalW, type: WidthType.DXA }, columnWidths: colWidths, rows: [hdrRow, ...dataRows] });
}

const doc = new Document({
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }
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
          p([t("JOHNSON ATTIN GROUP", { bold: true, size: 52, color: JAG_GOLD })], { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 200 } }),
          p([t("JAG INTEGRATED BUSINESS PLATFORM", { bold: true, size: 30, color: WHITE })], { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 200 } }),
          p([t("PHASE CLOSE REVIEW", { bold: true, size: 28, color: JAG_GOLD })], { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 160 } }),
          p([t("PHASE 4 — FINANCE MODULE  |  June 5, 2026", { size: 24, color: WHITE })], { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 200 } }),
          p([t("PHASE STATUS: COMPLETE", { bold: true, size: 24, color: JAG_GOLD })], { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 160 } }),
          p([t("49 / 49 RLS tests passing  |  9 finance route groups live  |  AI extraction engine operational", { size: 20, color: WHITE, italics: true })], { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 400 } }),
        ]
      })]})]
    }),
    spacer(),

    // ── 1. PHASE SUMMARY ─────────────────────────────────────────────────
    sectionHeader("1. PHASE SUMMARY"),
    spacer(),
    p([t("Phase 4 delivered the complete JAG Finance module — all 9 route groups live under /api/v1/finance/, the AI bank statement extraction engine using Ollama (Mistral 7B) running locally on the main Windows workstation, and a full pending review queue workflow. The phase also resolved two long-standing test infrastructure bugs and achieved 100% RLS test pass rate (49/49).")]),
    spacer(),
    makeTable(
      ["Item", "Value"],
      [
        ["Phase", "Phase 4 — Finance Module"],
        ["Close Date", "June 5, 2026"],
        ["Phase Status", "COMPLETE"],
        ["RLS Test Suite", "49 / 49 PASSING"],
        ["New Route Groups", "6 (FX rates, investments, loans, bank statements, pending review, batch processor)"],
        ["Previously Live", "3 (accounts, transactions, net-worth — completed before this handover)"],
        ["Total Finance Routes", "9 route groups, ~30 endpoints"],
        ["New Dependencies", "multer ^2.1.1, pdf-parse ^2.4.5, @types/multer ^2.1.0, @types/pdf-parse ^1.1.5"],
        ["AI Engine", "Ollama (Mistral 7B) — self-hosted on main Windows workstation"],
        ["Next Phase", "Phase 5 — JAG Holdings unified ledger UI"],
      ],
      [3000, 6360]
    ),
    spacer(), divider(),

    // ── 2. DELIVERABLES ───────────────────────────────────────────────────
    sectionHeader("2. PHASE 4 DELIVERABLES"),
    spacer(),
    subsectionHeader("2.1 FX Rates  (routes/finance/fx-rates.ts)"),
    spacer(),
    makeTable(
      ["Endpoint", "Method", "Description", "Status"],
      [
        ["GET /fx-rates", "GET", "Latest rate per currency (DISTINCT ON, ordered by rate_date DESC)", "LIVE"],
        ["POST /fx-rates", "POST", "Upsert rate — ON CONFLICT (currency, rate_date) DO UPDATE", "LIVE"],
        ["GET /fx-rates/:currency/latest", "GET", "Single latest rate for one currency", "LIVE"],
        ["GET /fx-rates/:currency", "GET", "History with from_date / to_date / limit filters", "LIVE"],
      ],
      [2800, 800, 4560, 1200]
    ),
    spacer(),
    bullet("fin_fx_rates is a shared reference table — RLS policy: any non-null current_owner_id grants access (not owner-scoped)"),
    bullet("Idempotency: ON CONFLICT (currency, rate_date) DO UPDATE ensures safe duplicate posts"),
    spacer(),
    subsectionHeader("2.2 Investments  (routes/finance/investments.ts)"),
    spacer(),
    makeTable(
      ["Endpoint", "Method", "Description", "Status"],
      [
        ["GET /investments", "GET", "List with optional account_id / investment_type filter", "LIVE"],
        ["POST /investments", "POST", "Create — idempotency_key required", "LIVE"],
        ["GET /investments/:id", "GET", "Single record", "LIVE"],
        ["PATCH /investments/:id", "PATCH", "Update — explicit ALLOWED keys array (mass-assignment protection)", "LIVE"],
      ],
      [2800, 800, 4360, 1400]
    ),
    spacer(),
    p([t("Investment types: EQUITY, BOND, MUTUAL_FUND, ETF, UNIT_TRUST, REAL_ESTATE, PRIVATE_EQUITY, CASH_EQUIVALENT, OTHER")]),
    spacer(),
    subsectionHeader("2.3 Loans  (routes/finance/loans.ts)"),
    spacer(),
    makeTable(
      ["Endpoint", "Method", "Description", "Status"],
      [
        ["GET /loans", "GET", "List with optional account_id / loan_type filter", "LIVE"],
        ["POST /loans", "POST", "Create — idempotency_key required", "LIVE"],
        ["GET /loans/:id", "GET", "Single record", "LIVE"],
        ["PATCH /loans/:id", "PATCH", "Update — explicit ALLOWED keys, idempotency_key immutable", "LIVE"],
      ],
      [2800, 800, 4360, 1400]
    ),
    spacer(),
    p([t("Loan types: MORTGAGE, CAR_LOAN, PERSONAL_LOAN, BUSINESS_LOAN, OVERDRAFT, OTHER")]),
    p([t("Interest types: FIXED, VARIABLE")]),
    spacer(),
    subsectionHeader("2.4 AI Extraction Engine  (lib/extractor/ + batch/bank-statement-batch.ts)"),
    spacer(),
    p([t("Architecture:", { bold: true })]),
    bullet("lib/extractor/types.ts — ParsedTransaction and ParsedStatement TypeScript interfaces"),
    bullet("lib/extractor/extract.ts — SHA-256 source hash, pdf-parse for PDFs, plain text passthrough for CSV/TXT"),
    bullet("lib/extractor/parse.ts — Ollama /api/generate call (temperature=0.1, num_predict=8192, format='json'), postProcess() applies: maskRef (last-4 digits only per OPSEC), normalizeDate (DD/MM/YYYY, DD-Mon-YYYY, DD-Mon-YY), toPositiveNumber"),
    bullet("batch/bank-statement-batch.ts — Claims PENDING jobs, runs extraction, imports transactions with idempotency_key, routes low-confidence items to pending review"),
    spacer(),
    p([t("Confidence tiers:", { bold: true })]),
    makeTable(
      ["Score", "Tier", "Outcome"],
      [
        [">= 0.85", "HIGH (>= 0.85) / MEDIUM (>= 0.70 in batch)", "Auto-import as UNCLASSIFIED transaction, is_pending_review = false"],
        ["< 0.85", "LOW", "Import with is_pending_review = true + create fin_pending_review_queue entry"],
        ["< 0.40", "VERY LOW", "Import with is_pending_review = true + create fin_pending_review_queue entry"],
      ],
      [1400, 3560, 4400]
    ),
    spacer(),
    p([t("OPSEC compliance: account_reference is last 4 digits only (maskRef function). Bank data never leaves the local infrastructure — Ollama is self-hosted on the main Windows workstation.", { italics: true })]),
    spacer(),
    subsectionHeader("2.5 Bank Statements  (routes/finance/bank-statements.ts)"),
    spacer(),
    makeTable(
      ["Endpoint", "Method", "Description", "Status"],
      [
        ["POST /bank-statements/upload", "POST", "multer diskStorage — 20MB limit, PDF/CSV/TXT only. Creates fin_bank_statement_jobs record (PENDING).", "LIVE"],
        ["GET /bank-statements", "GET", "List jobs with optional account_id / status filter", "LIVE"],
        ["GET /bank-statements/:id", "GET", "Single job", "LIVE"],
        ["POST /bank-statements/:id/requeue", "POST", "Reset FAILED job to PENDING for retry", "LIVE"],
      ],
      [2800, 800, 4560, 1200]
    ),
    spacer(),
    subsectionHeader("2.6 Pending Review  (routes/finance/pending-review.ts)"),
    spacer(),
    makeTable(
      ["Endpoint", "Method", "Description", "Status"],
      [
        ["GET /pending-review", "GET", "Unresolved items (resolved_at IS NULL) — JOINed with fin_transactions", "LIVE"],
        ["GET /pending-review/:id", "GET", "Full detail including transaction fields", "LIVE"],
        ["PATCH /pending-review/:id", "PATCH", "Set transaction category, clear is_pending_review, set resolved_at. Returns 409 if already resolved.", "LIVE"],
      ],
      [2800, 800, 4560, 1200]
    ),
    spacer(), divider(),

    // ── 3. TEST RESULTS ───────────────────────────────────────────────────
    sectionHeader("3. TEST RESULTS"),
    spacer(),
    colorBox("RESULT: 49 / 49 RLS isolation tests PASSING. Zero failures. Zero skips.", JAG_GREEN_L, JAG_GREEN),
    spacer(),
    p([t("Two test infrastructure bugs were discovered and fixed during Phase 4 close:")]),
    spacer(),
    subsectionHeader("3.1 Bug Fix: PROP Block UUID — Invalid Hex Character"),
    spacer(),
    p([t("File: jag-api/src/__tests__/rls-isolation.test.ts")]),
    makeTable(
      ["Item", "Detail"],
      [
        ["Symptom", "PostgreSQL: 'invalid input syntax for type uuid: p0000000-...'"],
        ["Root cause", "PROP constant used prefix 'p0' — 'p' is not a valid hexadecimal character (valid: 0-9, a-f)"],
        ["Fix", "Changed UUID prefix: p0000000-0000-0000-0000-000000000000 → d0000000-0000-0000-0000-000000000000"],
        ["Scope", "Pre-existing bug, not introduced in Phase 4"],
      ],
      [2000, 7360]
    ),
    spacer(),
    subsectionHeader("3.2 Bug Fix: fin_fx_rates Test INSERT — Date Conflict"),
    spacer(),
    p([t("File: jag-api/src/__tests__/rls-isolation.test.ts")]),
    makeTable(
      ["Item", "Detail"],
      [
        ["Symptom", "Test failed with duplicate key on (currency='USD', rate_date=CURRENT_DATE)"],
        ["Root cause", "Test used CURRENT_DATE — conflicted with FX rate inserted during live Phase 4 build session that day"],
        ["Fix 1", "Changed test date from CURRENT_DATE to fixed historical date '2000-01-01'"],
        ["Fix 2", "Changed conflict target from ON CONFLICT (id) DO NOTHING to ON CONFLICT (currency, rate_date) DO UPDATE SET rate_to_ttd = EXCLUDED.rate_to_ttd"],
        ["Rationale", "Correct unique constraint is (currency, rate_date) not (id). Using a fixed date prevents future re-conflicts."],
      ],
      [2000, 7360]
    ),
    spacer(),
    subsectionHeader("3.3 RLS Coverage by Module"),
    spacer(),
    makeTable(
      ["Module / Table Group", "RLS Tests", "Result"],
      [
        ["Core tenants + users", "3", "PASS"],
        ["IMS (inventory)", "6", "PASS"],
        ["JABCO (construction)", "8", "PASS"],
        ["JAG Properties", "5", "PASS"],
        ["JAG Entertainment", "6", "PASS"],
        ["CRM", "4", "PASS"],
        ["JAG Finance (accounts, transactions, net-worth, fx-rates, investments, loans)", "12", "PASS"],
        ["JAG Lifestyle", "3", "PASS"],
        ["Brian portal isolation", "2", "PASS"],
        ["TOTAL", "49", "PASS"],
      ],
      [3600, 2000, 3760]
    ),
    spacer(), divider(),

    // ── 4. ENGINEERING STANDARDS COMPLIANCE ──────────────────────────────
    sectionHeader("4. ENGINEERING STANDARDS COMPLIANCE — PHASE 4"),
    spacer(),
    makeTable(
      ["STD", "Standard", "Phase 4 Evidence", "Status"],
      [
        ["STD-01", "Module Isolation", "Finance routes only read/write jag_family tables. No cross-DB writes.", "PASS"],
        ["STD-02", "RLS First", "All fin_* tables protected by withOwnerRLS. fin_fx_rates: shared policy (any non-null owner). 49/49 tests confirm.", "PASS"],
        ["STD-03", "Test First", "RLS tests written covering all new finance tables before route implementation.", "PASS"],
        ["STD-04", "Migration First", "All fin_bank_statement_jobs and fin_pending_review_queue tables created via node-pg-migrate files.", "PASS"],
        ["STD-05", "API Versioning", "All routes under /api/v1/finance/. No breaking changes to existing v1 endpoints.", "PASS"],
        ["STD-06", "Error Envelope", "All routes return { success, data, error, code } envelope. 409 on duplicate idempotency, 404 on not-found.", "PASS"],
        ["STD-07", "No Secrets in Code", "OLLAMA_MODEL, DATABASE_URL_FAMILY, BATCH_OWNER_ID all in env vars. No credentials in source.", "PASS"],
        ["STD-08", "Structured Logging", "Batch processor logs JSON with job_id, status, row counts, confidence tiers.", "PASS"],
        ["STD-09", "TypeScript Strict", "strict: true throughout. PoolClient imported from 'pg' (not inferred via conditional type) to avoid 'never' type error.", "PASS"],
        ["STD-10", "Input Validation", "Zod schemas on all POST/PATCH endpoints. multer file type/size validation on upload.", "PASS"],
        ["STD-11", "Idempotent Financial Ops", "All fin_transactions inserts carry idempotency_key. ON CONFLICT DO NOTHING for batch safe re-runs. POST /fx-rates uses ON CONFLICT DO UPDATE.", "PASS"],
        ["STD-12", "Deploy Gate", "No production deploy performed. Phase 4 close is dev-environment complete.", "N/A"],
        ["STD-13", "Expand-and-Contract", "No existing columns renamed or dropped in Phase 4. New tables only.", "PASS"],
      ],
      [800, 1800, 5160, 1600]
    ),
    spacer(), divider(),

    // ── 5. ARCHITECTURE DECISIONS CONFIRMED ──────────────────────────────
    sectionHeader("5. ARCHITECTURE DECISIONS CONFIRMED IN PHASE 4"),
    spacer(),
    makeTable(
      ["Decision", "Outcome", "Status"],
      [
        ["Finance schema Option B", "Entity-scoped accounts via owner_entity_id confirmed. CONSOLIDATED pseudo-entity 00000000-0000-0000-0000-000000000000 used for net-worth aggregation.", "LOCKED"],
        ["AI extraction: local Ollama only", "Mistral 7B on main Windows workstation (http://localhost:11434). Bank data never leaves infrastructure. External API (OpenAI etc.) explicitly rejected.", "LOCKED"],
        ["Confidence threshold 0.85", "Transactions >= 0.85 auto-import. < 0.85 routes to pending review queue for human classification.", "LOCKED"],
        ["File upload: multer + local dev", "multer diskStorage to uploads/statements/. Production: swap to MinIO by changing storage engine only — no route logic change required.", "LOCKED"],
        ["OPSEC: account last-4 only", "maskRef() enforced in parse.ts postProcess. account_number_last4 CHAR(4) on fin_accounts. Full account numbers never stored.", "LOCKED"],
        ["PostgreSQL session vars", "SELECT set_config($1, $2, true) confirmed in batch processor. SET LOCAL never used.", "LOCKED — Phase 1B"],
      ],
      [2800, 4360, 2200]
    ),
    spacer(), divider(),

    // ── 6. KNOWN GAPS AND DEFERRED ITEMS ─────────────────────────────────
    sectionHeader("6. KNOWN GAPS AND DEFERRED ITEMS"),
    spacer(),
    makeTable(
      ["Item", "Description", "Deferred To"],
      [
        ["MinIO production swap", "Bank statement uploads use local disk in dev. Swap multer storage engine for MinIO object storage in production. storage_path column already exists in fin_bank_statement_jobs.", "Phase 5 / pre-production"],
        ["Ollama batch scheduler", "npm run batch:statements must be triggered manually or via cron on the main Windows workstation. Recommend Windows Task Scheduler or cron entry at 2am.", "Phase 5 ops runbook"],
        ["WiPay WEBHOOK_SECRET", "Required for payment integration. Robert to retrieve from WiPay dashboard.", "Phase 5"],
        ["Real Keycloak user provisioning", "Robert, Wife, Brian, operators not yet created in Keycloak. Run set-user-tenant.sh after first login.", "Phase 5"],
        ["Production WebAuthn rpId", "keycloak-webauthn-setup.sh must be run with KC_WEBAUTHN_RP_ID=jabco.tt before any user registers a biometric device.", "Before Phase 5 production deploy"],
        ["Phase 5 ledger UI design", "JAG Holdings unified ledger, chart of accounts, intercompany eliminations, insurance module, expense management scope to be defined.", "Phase 5 start"],
        ["MS Project sync", "JABCO construction Gantt integration with MS Project. Deferred from Phase 2.", "Phase 5 / Phase 6"],
        ["Finance routes: DELETE /accounts/:id", "Soft-delete flag exists on fin_accounts. Hard-delete endpoint not implemented — deliberate (financial records must be preserved).", "By design — no action"],
      ],
      [2400, 5160, 1800]
    ),
    spacer(), divider(),

    // ── 7. DOCX TOOLING BUG (Phase 4 side task) ──────────────────────────
    sectionHeader("7. DOCX TOOLING BUG — SIDE TASK RESOLVED"),
    spacer(),
    p([t("JAG_Phase_Close_Review_v2.0.docx was corrupted and would not open in Word. Root cause investigation and fix completed during Phase 4 close.", { bold: true })]),
    spacer(),
    makeTable(
      ["Item", "Detail"],
      [
        ["Symptom", "Word: 'We found a problem with some content in JAG_Phase_Close_Review_v2.0.docx. Do you want us to try to recover as much as we can?'"],
        ["Root cause 1", "table() helper function called hdrRow() unconditionally even when headers array was empty — generated <w:tr> with zero <w:tc> cells. OOXML rule: every <w:tr> must have at least one <w:tc>. Word rejects the file."],
        ["Root cause 2", "PageNumber.CURRENT used inside a TextRun in the footer — docx-js wrote all four field char elements (begin, instrText, separate, end) into the same <w:r>. Word rejects this."],
        ["Fix 1 — empty table row", "Guard in table(): const tableRows = headers.length > 0 ? [hdrRow(headers, colWidths)] : [];"],
        ["Fix 2 — PageNumber in footer", "Removed page number from footer entirely (TextRun only). Cleaner than attempting to fix fldChar ordering."],
        ["File", "jag-infra/skills/docx/gen_pcr_v2.js (both fixes applied)"],
        ["Result", "JAG_Phase_Close_Review_v2.0.docx now opens correctly in Word."],
      ],
      [2200, 7160]
    ),
    spacer(), divider(),

    // ── 8. PHASE 5 HANDOVER ───────────────────────────────────────────────
    sectionHeader("8. PHASE 5 HANDOVER"),
    spacer(),
    colorBox("Phase 5: JAG Holdings unified ledger UI. Load JAG_AI_Context_Summary_v2.3.docx + JAG_Engineering_Standards_v1.1.docx at the start of the next session.", JAG_LIGHT),
    spacer(),
    p([t("Phase 4 state at close:", { bold: true })]),
    bullet("All 9 finance route groups live and RLS-protected"),
    bullet("AI extraction engine: batch/bank-statement-batch.ts — requires BATCH_OWNER_ID + DATABASE_URL_FAMILY"),
    bullet("Test suite: 49/49 passing"),
    bullet("New packages installed: multer, pdf-parse and their @types"),
    bullet("Generator scripts updated: JAG_AI_Context_Summary_generator_v2.3.js, gen_pcr_v3.js"),
    spacer(),
    p([t("Phase 5 priority order (suggested):", { bold: true })]),
    bullet("1. JAG Holdings chart of accounts + general ledger schema (fin_gl_accounts, fin_journal_entries)"),
    bullet("2. Expense management routes + approval workflow"),
    bullet("3. Intercompany eliminations — postgres_fdw queries across jag_commercial / jag_entertainment / jag_family"),
    bullet("4. Insurance module — policies, premiums, claims, renewal alerts"),
    bullet("5. Accountant read-only portal — Keycloak Auditor role, export-only endpoints"),
    bullet("6. MinIO swap for bank statement uploads"),
    bullet("7. Ollama batch scheduler setup (Windows Task Scheduler or Linux cron)"),
    spacer(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 300, after: 0 },
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: JAG_BLUE, space: 4 } },
      children: [t("Johnson Attin Group  |  JAG Platform Phase Close Review v3.0  |  Phase 4 Finance COMPLETE  |  Confidential  |  June 2026", { size: 16, color: "888888" })]
    }),

  ]}]
});

Packer.toBuffer(doc).then(buffer => {
  const outPath = path.join('C:\\Users\\rober\\Documents\\Claude\\Projects\\JAG Holdings', 'JAG_Phase_Close_Review_v3.0.docx');
  fs.writeFileSync(outPath, buffer);
  console.log('Written: JAG_Phase_Close_Review_v3.0.docx');
});
