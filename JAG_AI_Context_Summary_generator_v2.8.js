// JAG AI Context Summary Generator v2.8
// Robert Johnson-Attin / Johnson Attin Group
// Generated: June 12, 2026
// Reflects: Master Architecture v1.9 + ALL PHASES COMPLETE (0 through 7)
// Patches vs v2.7: Session 2 (2026-06-12) post-production housekeeping applied.
//   user_tenant_roles provisioned for Robert, Wife, Brian.
//   Wife jag_auditor Keycloak role assigned.
//   All 4 MinIO buckets created (jag-bank-statements, jag-receipts, jag-documents, jag-photos).
//   Grafana + Promtail containers started; logs flowing to Loki.
//   Oracle boot-volume Bronze backup policy applied.
//   Stale net worth snapshot (2026-06-11) deleted and regenerated.
//   Rent proof receipt endpoint DONE (live in routes/properties/properties.ts).
//   WebAuthn device registration added as PENDING open item.
//   Net Worth Snapshot stale data behaviour documented in critical rules.
//   Running containers list updated to include jag-grafana and jag-promtail.
// SANITISED — safe for AI sessions and external channels

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, LevelFormat
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
            children: [new TextRun({ text: "Architecture v1.9  |  ALL PHASES COMPLETE (0–7)  |  June 2026", size: 22, color: WHITE, font: "Arial" })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 400 },
            children: [new TextRun({ text: "Platform live in production at https://jagcorporate.com. Data population in progress.", size: 22, color: JAG_GOLD, font: "Arial", italics: true })] }),
        ]
      })]})]
    }),
    spacer(),

    // ── OPSEC + HOW TO USE ───────────────────────────────────────────────
    colorBox("OPSEC NOTICE: This document is the ONLY version to be shared with AI systems, external consultants, or any digital channel. It contains NO account numbers, succession instructions, ownership percentages, lawyer identities, or specific financial values. The full classified Master Architecture document (JAG_Master_Architecture_v1.9.docx) must remain offline at all times.", JAG_RED_L),
    spacer(),
    colorBox("HOW TO USE THIS DOCUMENT: Load it at the start of every Claude session before any work. It gives Claude the full architectural context needed to write correct, consistent code. For code and architecture changes, Claude reads the relevant source files directly from the JAG Holdings folder — the Master Architecture .docx never needs to be uploaded.", JAG_LIGHT),
    spacer(), divider(),

    // ── 1. PROJECT OVERVIEW ──────────────────────────────────────────────
    sectionHeader("1. PROJECT OVERVIEW & CURRENT STATE"),
    spacer(),
    body("The JAG Integrated Business Platform is a self-hosted, modular enterprise management system built by Robert Johnson-Attin for the Johnson Attin Group — a diversified family conglomerate based in Trinidad and Tobago. All phases (0 through 7) are now complete. The platform is live in production at https://jagcorporate.com."),
    spacer(),
    colorBox("PLATFORM STATUS: ALL PHASES COMPLETE. Production live June 2026. Data population in progress (Leases, Chart of Accounts, FX Rates pending). Next work: remaining data entry, WebAuthn device registration, future JAG Plantations / JAG Trading modules.", JAG_GREEN_L),
    spacer(),
    h2("THREE GOLDEN RULES (architectural mandates):"),
    bullet("Enter Once — no data is entered twice across any module"),
    bullet("Same Language — all inter-module communication uses the same data structures and APIs"),
    bullet("You Own Everything — self-hosted, no vendor lock-in, no SaaS dependency, complete data sovereignty"),
    spacer(),
    body("Tech stack: PostgreSQL 18 (five logical DBs) + RLS + pgcrypto, Node.js/TypeScript strict mode, Docker + Docker Compose, Caddy + Let's Encrypt + Cloudflare DNS-01, MinIO (self-hosted object storage), React 18 + TypeScript + Vite + TailwindCSS + React Query + Keycloak JS adapter, Keycloak 26.x (self-hosted SSO), Ollama (local AI on main Windows workstation), Loki + Grafana (observability). Hosted on Oracle Cloud Free Tier ARM VM (4 OCPU / 24 GB)."),
    spacer(), divider(),

    // ── 2. PHASE PLAN — ALL COMPLETE ────────────────────────────────────
    sectionHeader("2. PHASE PLAN — ALL COMPLETE"),
    spacer(),
    makeTable(
      ["Phase", "Scope", "Status"],
      [
        ["Pre-Build", "ERD/DBML, OpenAPI YAML, Keycloak config, jag-event-dispatcher, WiPay sandbox POC, bank statement parser POC, Cloudflare DNS, DR failover runbook, DragonBridge sub-architecture.", "COMPLETE"],
        ["Phase 0", "Oracle VM. Docker + PostgreSQL (5 logical DBs). Caddy + Cloudflare DNS. WAL streaming. Keycloak container. jag-event-dispatcher. GitHub Actions deploy script.", "COMPLETE"],
        ["Phase 1A", "Keycloak realm + clients + role matrix. WebAuthn biometric. RLS per database. i18n engine. node-pg-migrate on all 5 DBs. Cross-tenant penetration test.", "COMPLETE"],
        ["Phase 1B", "IMS core. JAG Finance core schema. JAG CRM. Backup. PWA EN+ZH. Notifications. Loki/Grafana.", "COMPLETE"],
        ["Phase 2", "JABCO full construction PM. JAG Properties. JAG DocVault. JAG Succession Planning. JAG Lifestyle data entry.", "COMPLETE"],
        ["Phase 3", "Brian's Portal. DragonBridge. JAG Entertainment Ops (BAR + Members Club). NLCB. JAG Lifestyle full tracker. ~122 endpoints live.", "COMPLETE"],
        ["Phase 4", "JAG Finance full routes (all 9 route groups). AI extraction engine (Ollama batch + fin_bank_statement_jobs + fin_pending_review_queue). 49/49 RLS tests passing.", "COMPLETE"],
        ["Phase 5", "JAG Holdings GL / Ledger UI. Insurance module. Expense management. Intercompany eliminations. Finance export (accountant read-only).", "COMPLETE"],
        ["Phase 6", "Oracle Cloud production deployment. Caddy + Cloudflare + Let's Encrypt. HTTPS live. OWASP ZAP security audit. All 5 DBs migrated on VM. Keycloak production config.", "COMPLETE"],
        ["Phase 7", "React 18 frontend (jag-web/). All 12 build steps done. Dashboard, Finance, Ledger, Expenses, Properties, JABCO, IMS, CRM, Lifestyle, Entertainment, DragonBridge, NLCB, DocVault, Reports, Brian Portal all live.", "COMPLETE"],
        ["Future", "JAG Plantations, JAG Trading (POS), New Entity Onboarding. Placeholder pages exist in frontend.", "UPCOMING"],
      ],
      [1000, 6560, 1800]
    ),
    spacer(), divider(),

    // ── 3. PRODUCTION ENDPOINTS ──────────────────────────────────────────
    sectionHeader("3. PRODUCTION ENDPOINTS & INFRASTRUCTURE"),
    spacer(),
    makeTable(
      ["Resource", "Value"],
      [
        ["Frontend", "https://jagcorporate.com"],
        ["API", "https://api.jagcorporate.com  (health: /health/ready)"],
        ["Auth (Keycloak)", "https://auth.jagcorporate.com"],
        ["VM SSH", "ssh -i ~/.ssh/jag_oracle2 ubuntu@150.136.151.64  (jag_oracle key does NOT work)"],
        ["Keycloak admin", "SSH tunnel to localhost:8080 — admin / (see Master Architecture)"],
        ["VM project root", "/opt/jag/"],
        ["Running containers", "jag-api, jag-keycloak, jag-minio, jag-loki, jag-event-dispatcher, jag-caddy, jag-grafana, jag-promtail"],
        ["Last ZAP scan", "2026-06-10 — FAIL-NEW: 0, WARN-NEW: 0, PASS: 62"],
      ],
      [2400, 6960]
    ),
    spacer(), divider(),

    // ── 4. FULL BACKEND ROUTE MAP ────────────────────────────────────────
    sectionHeader("4. FULL BACKEND ROUTE MAP (jag-api/src/routes/)"),
    spacer(),
    body("All routes prefixed /api/v1/. Protected by requireAuth() middleware. RLS set per route by withTenantRLS (jag_commercial / jag_entertainment / jag_core) or withOwnerRLS (jag_family / jag_properties).", { italics: true }),
    spacer(),
    makeTable(
      ["Module", "Directory / File", "Key Endpoints"],
      [
        ["Auth", "auth.ts", "POST /auth/sync-user"],
        ["Me", "me.ts", "GET /me"],
        ["Tenants", "tenants.ts", "GET /tenants"],
        ["Notifications", "notifications.ts", "GET/PATCH /notifications"],
        ["Finance — Accounts", "finance/accounts.ts", "GET/POST /finance/accounts, PATCH/DELETE /finance/accounts/:id"],
        ["Finance — Transactions", "finance/transactions.ts", "GET/POST /finance/transactions, PATCH /finance/transactions/:id"],
        ["Finance — Net Worth", "finance/net-worth.ts", "GET /finance/net-worth, POST /finance/net-worth/snapshot (cross-DB: IMS+JABCO+Entertainment+Properties)"],
        ["Finance — FX Rates", "finance/fx-rates.ts", "GET/POST /finance/fx-rates, GET /finance/fx-rates/:currency/latest"],
        ["Finance — Investments", "finance/investments.ts", "GET/POST/PATCH /finance/investments"],
        ["Finance — Loans", "finance/loans.ts", "GET/POST/PATCH /finance/loans"],
        ["Finance — Bank Statements", "finance/bank-statements.ts", "POST /finance/bank-statements/upload, GET /finance/bank-statements, GET/POST /finance/bank-statements/:id/requeue"],
        ["Finance — Pending Review", "finance/pending-review.ts", "GET/PATCH /finance/pending-review"],
        ["Finance — GL", "finance/gl.ts", "GET/POST /finance/gl (chart of accounts + journal entries)"],
        ["Finance — Expenses", "finance/expenses.ts", "GET/POST/PATCH /finance/expenses"],
        ["Finance — Intercompany", "finance/intercompany.ts", "GET/POST /finance/intercompany, POST /finance/intercompany/eliminations"],
        ["Finance — Insurance", "finance/insurance.ts", "GET/POST/PATCH/DELETE /finance/insurance"],
        ["Finance — Export", "finance/export.ts", "GET /finance/export/* (accountant read-only views)"],
        ["Finance — Reports", "finance/reports.ts", "GET /finance/reports/* (P&L, balance sheet, cash flow)"],
        ["Properties", "properties/properties.ts", "GET/POST /properties, PATCH /properties/:id"],
        ["Properties — Units", "properties/units.ts", "GET/POST/PATCH /properties/:id/units"],
        ["Properties — Tenants/Mortgage", "properties/tenants-mortgage.ts", "GET/POST /properties/:id/leases, rent payments, mortgage"],
        ["Properties — Maintenance", "properties/maintenance.ts", "GET/POST /properties/:id/maintenance"],
        ["Properties — Insurance", "properties/insurance.ts", "GET/POST/DELETE /properties/:id/insurance"],
        ["Properties — Tax", "properties/property-tax.ts", "GET/POST/PATCH /properties/:id/tax"],
        ["Properties — Inspections", "properties/inspections.ts", "GET/POST /properties/:id/inspections"],
        ["Properties — Utility Accounts", "properties/utility-accounts.ts", "GET/POST/DELETE /properties/:id/utility-accounts"],
        ["Properties — Documents", "properties/documents.ts", "GET/POST/DELETE /properties/:id/documents (MinIO-backed)"],
        ["Properties — Pipeline", "properties/pipeline.ts", "GET/POST/PATCH /properties/pipeline"],
        ["IMS — Items", "ims/items.ts", "GET/POST /ims/items, PATCH /ims/items/:id, POST /ims/locations"],
        ["IMS — Vehicles", "ims/vehicles.ts", "GET/POST /ims/vehicles, PATCH /ims/vehicles/:id"],
        ["IMS — Movements", "ims/movements.ts", "GET/POST /ims/movements"],
        ["IMS — Suppliers", "ims/suppliers.ts", "GET/POST /ims/suppliers"],
        ["IMS — Stock Takes", "ims/stocktakes.ts", "GET/POST/PATCH /ims/stock-takes"],
        ["IMS — Depreciation", "ims/depreciation.ts", "GET/POST /ims/depreciation"],
        ["JABCO — Projects", "jabco/projects.ts", "GET/POST/PATCH /jabco/projects"],
        ["JABCO — Payment Certs", "jabco/payment-certs.ts", "GET/POST/PATCH /jabco/payment-certs"],
        ["JABCO — Site Diary", "jabco/site-diary.ts", "GET/POST /jabco/site-diary"],
        ["JABCO — Gantt", "jabco/gantt.ts", "GET /jabco/gantt"],
        ["JABCO — Retention", "jabco/retention.ts", "GET/POST /jabco/retention"],
        ["JABCO — Vendor Invoices", "jabco/vendor-invoices.ts", "GET/POST/PATCH /jabco/vendor-invoices"],
        ["CRM", "crm/crm.ts", "GET/POST/PATCH /crm/contacts, /crm/pipeline, /crm/interactions"],
        ["BAR", "bar/", "GET/POST /bar/tabs, /bar/products, /bar/config"],
        ["Club (Members Club)", "club/", "GET/POST /club/members, /club/events, /club/credits, /club/chip-float, /club/visitor-log, /club/tiers, /club/memberships"],
        ["Entertainment", "entertainment/", "GET/POST /entertainment/supplier-invoices, /entertainment/utilities, /entertainment/reports"],
        ["DragonBridge", "dragonbridge/", "GET/POST /dragonbridge/clients, /orders, /quotes, /shipments, /products, /pricing-tiers, /suppliers, /reconciliations, /config"],
        ["NLCB", "nlcb/", "GET/POST /nlcb/sessions, /settlements, /games, /scratch-games, /scratch-consignments, /scratch-session, /scratch-pack-purchases, /billers, /expenses, /config"],
        ["Lifestyle", "lifestyle/index.ts", "GET/POST /lifestyle/*"],
        ["Brian", "brian/index.ts", "GET /brian/* (scoped to Brian's entities)"],
        ["Family", "family/index.ts", "GET/POST /family/*"],
        ["DocVault", "docvault/index.ts", "GET/POST /docvault/*"],
        ["Succession", "succession/index.ts", "GET/POST /succession/*"],
        ["Files", "files/index.ts", "GET /files/presigned-url (MinIO presigned URL generation)"],
      ],
      [2000, 2600, 4760]
    ),
    spacer(), divider(),

    // ── 5. FULL FRONTEND PAGE MAP ────────────────────────────────────────
    sectionHeader("5. FULL FRONTEND PAGE MAP (jag-web/src/)"),
    spacer(),
    makeTable(
      ["Page", "File", "Key panels / tabs"],
      [
        ["Dashboard", "pages/Dashboard.tsx", "Net worth summary, account balances, recent transactions, properties portfolio, IMS asset total"],
        ["Finance", "pages/Finance.tsx", "Accounts, transactions, net worth, FX rates, investments, loans, bank statements, pending review"],
        ["Ledger", "pages/Ledger.tsx", "Chart of accounts, journal entries, trial balance"],
        ["Expenses", "pages/Expenses.tsx", "Expense submission, approval workflow, receipt upload (MinIO)"],
        ["Properties", "pages/Properties.tsx", "Portfolio, leases, rent payments, maintenance, insurance, tax, inspections, units, documents, financials, deposit refunds"],
        ["Inventory", "pages/Inventory.tsx", "Items (edit modal), vehicles (edit modal), movements, stock takes, depreciation, valuation, suppliers, low stock"],
        ["JABCO", "pages/Jabco.tsx", "Projects, payment certificates, site diary, Gantt, vendor invoices, retention"],
        ["CRM", "pages/CRM.tsx", "Contacts, pipeline, interactions"],
        ["Lifestyle", "pages/Lifestyle.tsx", "Loyalty programmes (cruise, airline, hotel, credit card), health tracker"],
        ["Entertainment", "pages/Entertainment.tsx", "BAR tabs + products, Members Club chip float + visitor log + events, supplier invoices, reports"],
        ["DragonBridge", "pages/DragonBridge.tsx", "Clients, orders, quotes, shipments, products, pricing tiers, suppliers, reconciliations, config"],
        ["NLCB", "pages/NLCB.tsx", "Sessions, settlements, scratch games, consignments, billers, scratch session"],
        ["Brian Portal", "pages/BrianPortal.tsx", "Brian's scoped view (his entities only)"],
        ["Brian Admin", "pages/BrianAdmin.tsx", "Robert's admin view of Brian's portal"],
        ["DocVault", "pages/DocVault.tsx", "Document management with MinIO storage"],
        ["Reports", "pages/Reports.tsx", "Cross-module P&L, rent roll, occupancy, balance sheet, cash flow"],
        ["Purchasing", "pages/Purchasing.tsx", "IMS purchase orders"],
        ["Placeholder", "pages/Placeholder.tsx", "JAG Plantations, JAG Trading (future modules)"],
      ],
      [1800, 2800, 4760]
    ),
    spacer(),
    h2("Key frontend components"),
    makeTable(
      ["Component", "File", "Purpose"],
      [
        ["Finance panels", "components/finance/", "AccountsPanel, FxRatesPanel, InsurancePanel, IntercompanyPanel, InvestmentsPanel, LoansPanel, NetWorthPanel, TransactionsPanel"],
        ["Ledger panels", "components/ledger/", "ChartOfAccounts, JournalEntries, TrialBalance"],
        ["Properties panels", "components/properties/", "PropertiesPanel (12 sub-tabs + edit modal), TenantsPanel, PipelinePanel"],
        ["UI components", "components/ui/", "ConfirmDeleteModal, FileImage, FileUpload"],
        ["API clients", "api/", "brian, client, crm, dragonbridge, entertainment, expenses, files, finance, gl, ims, jabco, lifestyle, nlcb, properties"],
        ["Auth", "auth/AuthProvider.tsx", "Keycloak JS adapter — SSO, token refresh, protected routes"],
        ["Layout", "layout/AppShell.tsx", "Sidebar nav, top bar, route structure"],
        ["Hooks", "hooks/useFileUrl.ts", "MinIO presigned URL fetching"],
        ["Lib", "lib/entities.ts", "VEHICLE_OWNER_OPTIONS and entity constants"],
      ],
      [2000, 3000, 4360]
    ),
    spacer(), divider(),

    // ── 6. COMPLETE MIGRATION MAP ────────────────────────────────────────
    sectionHeader("6. COMPLETE MIGRATION INVENTORY"),
    spacer(),
    h2("jag_commercial (016 migrations: 000–015)"),
    makeTable(
      ["File", "Key tables / changes"],
      [
        ["000_initial_schema.sql", "All core IMS, JABCO, Entertainment (BAR+Club), CRM, NLCB tables"],
        ["001_jabco_vat.sql", "VAT fields on JABCO tables"],
        ["002_ims_sale_vat.sql", "VAT on IMS sales"],
        ["003_jabco_vendor_invoices.sql", "jabco_vendor_invoices table"],
        ["004_nlcb.sql", "nlcb_sessions, nlcb_settlements, nlcb_games"],
        ["005_nlcb_scratch_bills.sql", "Scratch ticket billing tables"],
        ["006_nlcb_scratch_redesign.sql", "Scratch game schema overhaul"],
        ["007_dragonbridge.sql", "All DragonBridge tables (clients, orders, quotes, shipments, products, etc.)"],
        ["008_rls_and_indexes.sql", "RLS policies + performance indexes across jag_commercial"],
        ["009_ims_suppliers_pos.sql", "ims_suppliers, ims_purchase_orders"],
        ["010_ims_stock_takes.sql", "ims_stock_takes, ims_stock_take_lines"],
        ["011_ims_depreciation.sql", "ims_depreciation_schedules, ims_depreciation_entries"],
        ["012_vehicles_owner_service.sql", "owner_entity, last_service_date, next_service_date, service_interval_days on ims_vehicles; location_id nullable on ims_items"],
        ["013_jabco_crm_client_fk.sql", "FK from JABCO projects to crm_contacts for client linkage"],
        ["014_crm_contact_phone2.sql", "phone2 VARCHAR(50) added to crm_contacts"],
        ["015_vehicles_sim_number.sql", "sim_number column added to ims_vehicles"],
      ],
      [3000, 6360]
    ),
    spacer(),
    h2("jag_family (008 migrations: 001–007 + 005b)"),
    makeTable(
      ["File", "Key tables / changes"],
      [
        ["001_initial_schema.sql", "Base family schema"],
        ["002_finance_schema.sql", "fin_accounts, fin_transactions, fin_fx_rates, fin_net_worth_snapshots"],
        ["003_fin_gl.sql", "fin_gl_accounts, fin_journal_entries"],
        ["004_fin_expenses.sql", "fin_expenses"],
        ["005_fin_intercompany.sql", "fin_intercompany_charges, fin_intercompany_eliminations"],
        ["005b_fdw_setup.sql", "postgres_fdw wrappers to commercialPool + propertiesPool for net-worth cross-DB queries"],
        ["006_fin_insurance.sql", "fin_insurance_policies, fin_insurance_premiums, fin_insurance_claims"],
        ["007_expense_receipt_bucket.sql", "MinIO bucket config for expense receipts"],
      ],
      [3000, 6360]
    ),
    spacer(),
    h2("jag_properties (012 migrations: 001–011 + extra 009)"),
    makeTable(
      ["File", "Key tables / changes"],
      [
        ["001_initial_schema.sql", "prop_properties, prop_lease_agreements, prop_rent_payments, prop_maintenance"],
        ["002_utilities_vendor_invoices.sql", "prop_utilities, prop_vendor_invoices"],
        ["003_insurance.sql", "prop_insurance_policies"],
        ["004_property_tax.sql", "prop_property_tax"],
        ["005_inspections.sql", "prop_inspections"],
        ["006_lease_deposit_refund.sql", "Deposit refund fields on prop_lease_agreements"],
        ["007_utility_accounts.sql", "prop_utility_accounts"],
        ["008_late_fee_lease.sql", "late_fee_type, late_fee_value, grace_period_days on leases"],
        ["009_prop_properties_audit_cols.sql", "last_modified_at, last_modified_by on prop_properties"],
        ["009_units.sql", "prop_units table for sub-unit tracking within properties"],
        ["010_mortgage_last_modified.sql", "last_modified_at, last_modified_by on mortgage table"],
        ["011_rent_payment_proof.sql", "proof_photo_url, proof_uploaded_at, proof_uploaded_by, receipt_token on rent payments"],
      ],
      [3000, 6360]
    ),
    spacer(),
    h2("jag_core (008 migrations: 000–007)"),
    makeTable(
      ["File", "Key tables / changes"],
      [
        ["000_initial_schema.sql", "users, tenants, user_tenant_roles, audit_log_access"],
        ["001_brian_portal.sql", "Brian portal entity seeding"],
        ["002_nlcb_tenant.sql", "NLCB tenant seeded"],
        ["003_dragonbridge_tenant.sql", "DragonBridge tenant seeded"],
        ["004_brian_new_modules.sql", "Brian's additional module permissions"],
        ["005_add_last_login_at.sql", "last_login_at timestamp on users"],
        ["006_missing_indexes.sql", "Performance indexes"],
        ["007_audit_log.sql", "audit_log table for security events"],
      ],
      [3000, 6360]
    ),
    spacer(),
    h2("jag_entertainment (005 migrations: 001–005)"),
    makeTable(
      ["File", "Key tables / changes"],
      [
        ["001_initial_schema.sql", "ent_tabs, ent_tab_items, ent_chip_float, ent_visitor_log, ent_members, ent_memberships, ent_tiers, ent_events, ent_credits"],
        ["002_vat_service_charge.sql", "VAT + service charge configuration"],
        ["003_utilities_supplier_invoices.sql", "ent_utilities, ent_supplier_invoices"],
        ["004_entity_tag_visitor_float.sql", "Mandatory entity tag (BAR / MEMBERS CLUB) on transactions + visitor float"],
        ["005_tabs_venue_not_null.sql", "venue column NOT NULL on ent_tabs"],
      ],
      [3000, 6360]
    ),
    spacer(), divider(),

    // ── 7. ENGINEERING STANDARDS ─────────────────────────────────────────
    sectionHeader("7. ENGINEERING STANDARDS — QUICK REFERENCE (STD-01 through STD-13)"),
    spacer(),
    body("These 13 standards apply to every line of code written for the JAG platform. Full detail in JAG_Engineering_Standards_v1.1.docx.", { bold: true }),
    spacer(),
    makeTable(
      ["ID", "Rule", "Severity"],
      [
        ["STD-01", "Module Isolation — modules communicate via JAG Holdings API only; never write directly to another module's database tables", "HARD RULE"],
        ["STD-02", "RLS First — tenant isolation enforced at PostgreSQL layer; app-layer filtering is second line of defence", "HARD RULE"],
        ["STD-03", "Test First — write a failing isolation/security test before coding any data-access feature", "HARD RULE"],
        ["STD-04", "Migration First — every schema change is a versioned node-pg-migrate file; never run raw SQL on production", "HARD RULE"],
        ["STD-05", "API Versioning — all endpoints at /api/v1/; breaking changes require /api/v2/", "ARCHITECTURE"],
        ["STD-06", "Error Envelope — all API responses: { success, data, error, code }; no raw stack traces to clients", "ARCHITECTURE"],
        ["STD-07", "No Secrets in Code — all credentials in Oracle Vault / env vars; never in code or Compose files", "HARD RULE"],
        ["STD-08", "Structured Logging — every log event is JSON: timestamp, entity, action, user_id, tenant_id, severity", "ARCHITECTURE"],
        ["STD-09", "TypeScript Strict Mode — strict: true in tsconfig.json; no 'any' types", "ARCHITECTURE"],
        ["STD-10", "Input Validation — all API inputs validated with Zod schemas server-side before touching DB", "HARD RULE"],
        ["STD-11", "Idempotent Financial Ops — all financial writes carry idempotency keys; duplicate delivery never double-posts", "HARD RULE"],
        ["STD-12", "Deploy Gate — production only via automated deploy script; tests pass + migrations run + Robert sign-off", "HARD RULE"],
        ["STD-13", "Expand-and-Contract Migrations — columns/tables never renamed or dropped in a single cycle; 5-step pattern (Expand → Dual-write → Backfill → Read switchover → Contract)", "HARD RULE"],
      ],
      [900, 6860, 1600]
    ),
    spacer(), divider(),

    // ── 8. CRITICAL IMPLEMENTATION RULES ─────────────────────────────────
    sectionHeader("8. CRITICAL IMPLEMENTATION RULES (learned from prior phases)"),
    spacer(),
    h2("PostgreSQL session variables"),
    colorBox("ALWAYS: SELECT set_config($1, $2, true)  |  NEVER: SET LOCAL x = $1  — PostgreSQL does not allow parameterised SET statements.", JAG_RED_L),
    spacer(),
    h2("Keycloak 26 User Profile schema"),
    body("Custom attributes MUST be declared via PUT /admin/realms/jag/users/profile BEFORE setting them. KC26 silently drops undeclared attributes (returns HTTP 204 but does NOT persist). The Attributes tab is hidden for admin-only attrs — always use REST API."),
    spacer(),
    h2("Finance RLS rules"),
    bullet("jag_family uses withOwnerRLS (app.current_owner_id) — NOT tenant-scoped"),
    bullet("jag_properties uses withOwnerRLS — prop_properties has NO entity/tenant column"),
    bullet("fin_fx_rates is a shared reference table — any non-null current_owner_id grants access"),
    bullet("fin_net_worth_snapshots.net_worth_ttd is a GENERATED column — never set it manually"),
    bullet("CONSOLIDATED pseudo-entity UUID: 00000000-0000-0000-0000-000000000000"),
    bullet("Net-worth snapshot queries 4 cross-DB sources: IMS items+vehicles, JABCO payment certs A/R, Entertainment chip float/tabs, Property valuations"),
    spacer(),
    h2("PostgreSQL GUC empty-string bug — CRITICAL"),
    body("Custom app.* GUC parameters revert to '' (empty string) NOT NULL after a transaction. A pool connection that previously ran withOwnerRLS then calls withTenantRLS — it sees app.current_owner_id = '' and throws 'invalid input syntax for type uuid: \"\"'."),
    bullet("Always use NULLIF(current_setting('app.xxx', true), '')::uuid in RLS policies — never raw current_setting(...)::uuid"),
    bullet("Always use the correct RLS wrapper: withTenantRLS for jag_commercial/jag_entertainment/jag_core; withOwnerRLS for jag_family/jag_properties"),
    spacer(),
    h2("node-pg numeric types"),
    body("PostgreSQL numeric/decimal columns arrive in Node.js as STRINGS. Always wrap with parseFloat(String(value ?? 0)) before arithmetic — '+' on two pg numeric values concatenates strings."),
    spacer(),
    h2("Deploy pattern — CRITICAL"),
    body("Dockerfile copies dist/ (pre-compiled TypeScript) — NOT src/. Uploading source changes has zero effect."),
    bullet("API changes: npm run build:prod → scp dist/ → docker compose build api && docker compose up -d api"),
    bullet("Frontend changes: npm run build → scp dist/ → no container rebuild (Caddy serves static files directly)"),
    bullet("deploy.sh at repo root handles both. Flags: --api-only, --frontend-only, --skip-typecheck, --skip-zap"),
    bullet("Deploy runs 7 steps: TypeScript compile → frontend build → VM check → dist upload → health check → ZAP baseline → frontend upload"),
    spacer(),
    h2("OWASP ZAP scanning"),
    bullet("security/zap-baseline.sh — passive scan ~5 min (deploy gate, Step 6)"),
    bullet("security/zap-full-scan.sh — active scan ~60 min (manual)"),
    bullet("security/zap_auth_hook.py — injects JWT Bearer + Cache-Control bypass into all ZAP requests"),
    bullet("security/zap-baseline.conf — 4 Cloudflare-artefact false positives documented as INFO"),
    bullet("Run: ZAP_SCAN_PASSWORD=<password> bash security/zap-baseline.sh"),
    spacer(),
    h2("Net Worth Snapshot — stale data behaviour"),
    body("POST /finance/net-worth/snapshot upserts on (owner_id, owner_entity_id, snapshot_date) — one row per entity per day. If property valuations are edited after a snapshot is taken on the same day, the snapshot will be stale."),
    bullet("Fix: DELETE FROM fin_net_worth_snapshots WHERE snapshot_date = 'YYYY-MM-DD', then retrigger from Finance -> Net Worth -> Take Snapshot"),
    bullet("This occurred 2026-06-11: JAG Properties Management and 62 Ariapita Avenue valuations cleared at 17:19 but snapshot was already taken at 06:36 — stale rows deleted and regenerated 2026-06-12"),
    spacer(),
    h2("Dashboard query limits"),
    body("Dashboard.tsx requests properties with limit: 100 (backend max is 500 per PropertiesQuerySchema). Never raise Dashboard limit above 500 without also raising the backend Zod schema."),
    spacer(), divider(),

    // ── 9. ARCHITECTURE DECISIONS — ALL LOCKED ──────────────────────────
    sectionHeader("9. ARCHITECTURE DECISIONS — ALL LOCKED (v1.9)"),
    spacer(),
    body("All decisions below are final. Do not re-propose alternatives.", { bold: true }),
    spacer(),
    makeTable(
      ["Decision", "Chosen Approach"],
      [
        ["Database", "PostgreSQL 18, five logical DBs: jag_core / jag_commercial / jag_entertainment / jag_family / jag_properties"],
        ["Cross-DB queries", "postgres_fdw in JAG Holdings only — never direct cross-DB SQL"],
        ["Containers", "Docker + Docker Compose"],
        ["Web server / TLS", "Caddy + Let's Encrypt + Cloudflare DNS-01 wildcard certs. NOT Duck DNS."],
        ["Auth", "Keycloak 26.x self-hosted. Realm: jag. Client: jag-api. Mappers: jag_user_id + jag_tenant_id."],
        ["Finance schema", "Option B — accounts scoped per entity via owner_entity_id (UUID matching jag_core.tenants.id)"],
        ["AI extraction", "Ollama on main Windows workstation only (NOT Dell Inspiron). mistral model. Nightly batch."],
        ["File storage", "MinIO self-hosted. Presigned URLs via files/ routes."],
        ["Succession activation", "Parallel Co-Owner access to wife's Keycloak account. Robert's Owner account NEVER demoted."],
        ["Observability", "Loki + Grafana in Docker on Oracle VM. Structured JSON logs. 14-day retention."],
        ["Offline-critical", "BAR cash logging, JABCO site diary, IMS barcode scanning."],
        ["Schema migrations", "STD-13 Expand-and-Contract — never rename or drop in one cycle."],
        ["Frontend", "React 18 + TypeScript + Vite + TailwindCSS + React Query + Keycloak JS adapter. Served as Caddy static files — NOT a separate Docker container."],
        ["WebAuthn rpId", "KC_WEBAUTHN_RP_ID=jabco.tt — bound at registration; cannot change after."],
      ],
      [2600, 6760]
    ),
    spacer(), divider(),

    // ── 10. TENANT UUIDs ─────────────────────────────────────────────────
    sectionHeader("10. TENANT UUIDs & ROLE MATRIX"),
    spacer(),
    makeTable(
      ["Entity Code", "UUID"],
      [
        ["JAG_HOLDINGS", "00000000-0000-0000-0001-000000000001"],
        ["JABCO", "00000000-0000-0000-0001-000000000002"],
        ["JAG_PROPERTIES", "00000000-0000-0000-0001-000000000003"],
        ["JAG_ENTERTAINMENT", "00000000-0000-0000-0001-000000000004"],
        ["JAG_FINANCE", "00000000-0000-0000-0001-000000000005"],
        ["DRAGONBRIDGE", "00000000-0000-0000-0001-000000000006"],
        ["NLCB", "00000000-0000-0000-0001-000000000007"],
        ["CONSOLIDATED (net worth pseudo-entity)", "00000000-0000-0000-0000-000000000000"],
      ],
      [3000, 6360]
    ),
    spacer(),
    makeTable(
      ["Role", "Access Scope"],
      [
        ["Owner", "Full access — all entities, all data, all modules (Robert)"],
        ["Domain Admin", "Full CRUD within assigned entity only"],
        ["Operator / Staff", "Scan, log, count, transfer — no delete, no valuations"],
        ["Auditor", "Read-only, export only"],
        ["External Advisor", "Time-limited, scoped read/export, auto-expiry"],
        ["Family Member — Emergency Designate", "Full read-only all entities (Wife — Mandarin Chinese default)"],
        ["Brian", "Separate portal — his entities only, cannot see JAG operations"],
        ["System", "API access only — scheduled jobs, integrations"],
      ],
      [3000, 6360]
    ),
    spacer(), divider(),

    // ── 11. DATA POPULATION STATUS ───────────────────────────────────────
    sectionHeader("11. DATA POPULATION STATUS (as of June 2026)"),
    spacer(),
    makeTable(
      ["Phase", "Module", "Status"],
      [
        ["A1", "CRM Contacts — 23 JAG Properties tenants", "DONE — posted to production"],
        ["B1", "Properties — 8 properties posted", "DONE — posted to production"],
        ["B2", "Property Units — 25 units across 6 properties", "DONE — posted to production"],
        ["B3", "Leases — all existing leases expired; new leases needed", "PENDING — need monthly rent amounts per unit"],
        ["A2", "Chart of Accounts", "PENDING"],
        ["A3", "FX Rates (TTD/USD/CNY)", "PENDING"],
        ["C1", "IMS Items — JABCO tools, HOME assets, vehicles", "NOT STARTED"],
        ["D1", "Finance accounts (bank accounts, investments, loans)", "NOT STARTED"],
      ],
      [800, 3800, 4760]
    ),
    spacer(), divider(),

    // ── 12. OPEN ITEMS ───────────────────────────────────────────────────
    sectionHeader("12. OPEN ITEMS"),
    spacer(),
    makeTable(
      ["Item", "Status", "Notes"],
      [
        ["Rent proof receipt endpoint", "DONE (2026-06-12)", "GET /properties/:propertyId/rent-payments/:paymentId/receipt live in routes/properties/properties.ts. Frontend copy/WhatsApp share in PropertiesPanel.tsx."],
        ["user_tenant_roles provisioning", "DONE (2026-06-12)", "Robert (Owner/JAG_HOLDINGS), Wife (Auditor/JAG_HOLDINGS), Brian (Staff/NLCB) all provisioned. Pre-existing rows for 6 other tenants confirmed active."],
        ["Wife jag_auditor Keycloak role", "DONE (2026-06-12)", "Assigned via admin API. Wife email confirmed: zhanghuachang22@gmail.com."],
        ["MinIO buckets", "DONE (2026-06-12)", "All 4 buckets created: jag-bank-statements, jag-receipts, jag-documents, jag-photos."],
        ["Grafana + Promtail startup", "DONE (2026-06-12)", "Containers were in Created state for 5 days; now running. Logs flowing to Loki."],
        ["Oracle boot-volume backup policy", "DONE (2026-06-12)", "Bronze policy applied to both boot volumes via Oracle Console."],
        ["WebAuthn device registration", "PENDING", "Required for Robert, Brian, and Wife. In-person browser session at https://auth.jagcorporate.com/realms/jag/account — Account security -> Signing in -> Set up security key."],
        ["Ollama activation", "DEFERRED", "DRY_RUN=false + ollama pull llama3.2 when ready. Batch processor at batch/bank-statement-batch.ts."],
        ["Data population — Leases", "PENDING", "Need monthly rent amounts per unit. All existing leases expired."],
        ["Data population — Chart of Accounts", "PENDING", "Not started."],
        ["Data population — FX Rates", "PENDING", "Not started."],
        ["JAG Plantations", "FUTURE", "Agricultural land module. Placeholder page exists in frontend."],
        ["JAG Trading", "FUTURE", "POS retail module. Placeholder page exists in frontend."],
        ["WiPay webhook", "REMOVED", "WiPay does not issue webhooks to individuals. Rents paid directly to personal bank accounts."],
      ],
      [2400, 1400, 5560]
    ),
    spacer(), divider(),

    // ── 13. SESSION INSTRUCTIONS FOR CLAUDE ─────────────────────────────
    sectionHeader("13. SESSION INSTRUCTIONS FOR CLAUDE"),
    spacer(),
    body("At the start of every session: (1) Load this document. (2) State the specific task. (3) Claude reads source files directly from the JAG Holdings folder as needed — no sensitive files need to be uploaded.", { bold: true }),
    spacer(),
    h2("What Claude must do in every session:"),
    bullet("Apply all 13 engineering standards (STD-01 through STD-13) to every line of code written"),
    bullet("Never re-propose architecture decisions listed as LOCKED in Section 9"),
    bullet("Write node-pg-migrate files for every schema change — never raw SQL on production"),
    bullet("Use SELECT set_config($1, $2, true) for PostgreSQL session variables — NEVER SET LOCAL x = $1"),
    bullet("Declare new Keycloak attributes in User Profile schema before setting them"),
    bullet("Include idempotency keys on all financial write endpoints"),
    bullet("Write pending_events outbox entries within the same transaction as financial events"),
    bullet("Scope all DB queries with correct owner/tenant — no cross-DB queries without postgres_fdw through JAG Holdings"),
    bullet("Use Keycloak JWT claims for role — never trust application-layer role claims alone"),
    bullet("Add last_modified_at + last_modified_by to all shared master record tables"),
    bullet("For API changes: npm run build:prod FIRST, then SCP dist/, then docker rebuild"),
    bullet("End every session with a handoff note: what was built, what was tested, what the next session should start with"),
    spacer(), divider(),

    // ── 14. WHAT THIS DOCUMENT DOES NOT CONTAIN ──────────────────────────
    sectionHeader("14. WHAT THIS DOCUMENT DOES NOT CONTAIN"),
    spacer(),
    body("The following information exists in the full classified Master Architecture only (JAG_Master_Architecture_v1.9.docx). That document is OFFLINE ONLY. NEVER share it with any AI system, cloud service, or external consultant.", { bold: true }),
    spacer(),
    bullet("Bank account numbers, account names, or financial institution details"),
    bullet("Ownership percentages or shareholding structures per entity"),
    bullet("Succession plan specifics — credential custodian identity, will instructions, POA holder, trustee, executor, beneficiary details"),
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
      children: [new TextRun({ text: "Johnson Attin Group  |  JAG Platform Context Summary v2.8  |  All Phases Complete  |  Confidential — For AI Session and External Channel Use Only  |  June 2026", size: 16, color: "888888", font: "Arial" })]
    }),

  ]}]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync('C:\\Users\\rober\\Documents\\Claude\\Projects\\JAG Holdings\\JAG_AI_Context_Summary_v2.8.docx', buffer);
  console.log('Written: JAG_AI_Context_Summary_v2.8.docx');
});
