#!/usr/bin/env node
// JAG Holdings — Chart of Accounts population script
// Posts accounts to the live production API.
//
// Usage:
//   KEYCLOAK_PASSWORD=<robert_password> node migration/coa-populate.js
//
// Set DRY_RUN=true to preview without posting.

const API_BASE   = 'https://api.jagcorporate.com/api/v1';
const KC_URL     = 'https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token';
const KC_SECRET  = 'FIjMqEPT35gr3TRvh6FDdCTnMAX2FAGMjTVHuljqcBU';
const DRY_RUN    = process.env.DRY_RUN === 'true';

const ENTITIES = {
  JAG_HOLDINGS:    '00000000-0000-0000-0001-000000000001',
  JABCO:           '00000000-0000-0000-0001-000000000002',
  JAG_PROPERTIES:  '00000000-0000-0000-0001-000000000003',
  JAG_ENTERTAINMENT:'00000000-0000-0000-0001-000000000004',
  JAG_FINANCE:     '00000000-0000-0000-0001-000000000005',
  DRAGONBRIDGE:    '00000000-0000-0000-0001-000000000006',
  NLCB:            '00000000-0000-0000-0001-000000000007',
};

// ── Account definitions ────────────────────────────────────────────────────────
// Fields: [entity_key, code, name, type, normal_balance, allow_direct_posting, parent_code, description]
// parent_code references another account in the SAME entity.
// allow_direct_posting=false → header/summary account.

const ACCOUNTS = [

  // ══════════════════════════════════════════════════════════════════════════════
  // JAG_HOLDINGS — Consolidated group accounts
  // ══════════════════════════════════════════════════════════════════════════════

  // ── Assets ───────────────────────────────────────────────────────────────────
  ['JAG_HOLDINGS','1000','Current Assets',        'ASSET','DEBIT', false, null, 'All liquid and near-liquid group assets'],
  ['JAG_HOLDINGS','1010','Cash & Bank — Group',   'ASSET','DEBIT', true, '1000','Consolidated bank balances across all entities'],
  ['JAG_HOLDINGS','1020','Accounts Receivable',   'ASSET','DEBIT', true, '1000','Amounts owed to JAG Holdings'],
  ['JAG_HOLDINGS','1030','Intercompany Receivables','ASSET','DEBIT',true,'1000','Amounts owed between JAG entities'],
  ['JAG_HOLDINGS','1040','Prepaid Expenses',      'ASSET','DEBIT', true, '1000','Expenses paid in advance'],
  ['JAG_HOLDINGS','1050','VAT Receivable',        'ASSET','DEBIT', true, '1000','Input VAT recoverable from BIR'],

  ['JAG_HOLDINGS','1100','Non-Current Assets',    'ASSET','DEBIT', false, null, 'Long-term group assets'],
  ['JAG_HOLDINGS','1110','Investment Securities', 'ASSET','DEBIT', true, '1100','Bonds, equities, and listed securities'],
  ['JAG_HOLDINGS','1120','Unit Trust & Mutual Funds','ASSET','DEBIT',true,'1100','Unit trust and mutual fund holdings'],
  ['JAG_HOLDINGS','1130','Property Portfolio',    'ASSET','DEBIT', true, '1100','Investment properties at valuation'],
  ['JAG_HOLDINGS','1140','Vehicles & Equipment',  'ASSET','DEBIT', true, '1100','Vehicles and equipment at cost'],
  ['JAG_HOLDINGS','1150','Accumulated Depreciation','ASSET','CREDIT',true,'1100','Contra: accumulated depreciation on fixed assets'],

  // ── Liabilities ───────────────────────────────────────────────────────────────
  ['JAG_HOLDINGS','2000','Current Liabilities',   'LIABILITY','CREDIT',false,null,'Obligations due within 12 months'],
  ['JAG_HOLDINGS','2010','Accounts Payable',       'LIABILITY','CREDIT',true,'2000','Amounts owed to trade suppliers'],
  ['JAG_HOLDINGS','2020','Accrued Liabilities',    'LIABILITY','CREDIT',true,'2000','Expenses incurred but not yet invoiced'],
  ['JAG_HOLDINGS','2030','VAT Payable',            'LIABILITY','CREDIT',true,'2000','Output VAT collected, due to BIR'],
  ['JAG_HOLDINGS','2040','PAYE Payable',           'LIABILITY','CREDIT',true,'2000','Employee PAYE deductions due to BIR'],
  ['JAG_HOLDINGS','2050','NIS Payable',            'LIABILITY','CREDIT',true,'2000','NIS contributions due (employee + employer)'],
  ['JAG_HOLDINGS','2060','Intercompany Payables',  'LIABILITY','CREDIT',true,'2000','Amounts owed between JAG entities'],

  ['JAG_HOLDINGS','2100','Long-Term Liabilities',  'LIABILITY','CREDIT',false,null,'Obligations due beyond 12 months'],
  ['JAG_HOLDINGS','2110','Mortgage Loans',         'LIABILITY','CREDIT',true,'2100','Property mortgage balances outstanding'],
  ['JAG_HOLDINGS','2120','Vehicle Loans',          'LIABILITY','CREDIT',true,'2100','Vehicle hire-purchase / loan balances'],
  ['JAG_HOLDINGS','2130','Business Loans',         'LIABILITY','CREDIT',true,'2100','Other business loan facilities'],

  // ── Equity ────────────────────────────────────────────────────────────────────
  ['JAG_HOLDINGS','3000',"Owner's Equity",         'EQUITY','CREDIT',false,null,"Robert Johnson-Attin owner's equity"],
  ['JAG_HOLDINGS','3010',"Owner's Capital",        'EQUITY','CREDIT',true,'3000','Capital contributed by the owner'],
  ['JAG_HOLDINGS','3020','Retained Earnings',      'EQUITY','CREDIT',true,'3000','Accumulated profits from prior years'],
  ['JAG_HOLDINGS','3030','Current Year Earnings',  'EQUITY','CREDIT',true,'3000','Net income for the current financial year'],

  // ── Revenue ───────────────────────────────────────────────────────────────────
  ['JAG_HOLDINGS','4000','Revenue',                'REVENUE','CREDIT',false,null,'Consolidated group revenue'],
  ['JAG_HOLDINGS','4100','Rental Income',          'REVENUE','CREDIT',true,'4000','Income from residential and commercial properties'],
  ['JAG_HOLDINGS','4200','Construction Revenue',   'REVENUE','CREDIT',true,'4000','JABCO contract and progress billing revenue'],
  ['JAG_HOLDINGS','4300','Bar & Entertainment Revenue','REVENUE','CREDIT',true,'4000','BAR and Members Club trading revenue'],
  ['JAG_HOLDINGS','4400','NLCB Commission Income', 'REVENUE','CREDIT',true,'4000','NLCB lottery and scratch ticket commission'],
  ['JAG_HOLDINGS','4500','Trading & Sourcing Revenue','REVENUE','CREDIT',true,'4000','DragonBridge product and sourcing revenue'],
  ['JAG_HOLDINGS','4600','Intercompany Revenue',   'REVENUE','CREDIT',true,'4000','Revenue from intercompany charges'],

  // ── Expenses ──────────────────────────────────────────────────────────────────
  ['JAG_HOLDINGS','5000','Operating Expenses',     'EXPENSE','DEBIT',false,null,'Consolidated group operating costs'],
  ['JAG_HOLDINGS','5100','Cost of Sales',          'EXPENSE','DEBIT',true,'5000','Direct costs of goods and services sold'],
  ['JAG_HOLDINGS','5200','Employee Costs',         'EXPENSE','DEBIT',true,'5000','Salaries, NIS, health insurance across the group'],
  ['JAG_HOLDINGS','5300','Property Expenses',      'EXPENSE','DEBIT',true,'5000','Maintenance, insurance, tax on investment properties'],
  ['JAG_HOLDINGS','5400','Administrative Expenses','EXPENSE','DEBIT',true,'5000','Professional fees, office costs, subscriptions'],
  ['JAG_HOLDINGS','5500','Finance Costs',          'EXPENSE','DEBIT',true,'5000','Loan interest and bank charges'],
  ['JAG_HOLDINGS','5600','Depreciation',           'EXPENSE','DEBIT',true,'5000','Depreciation on vehicles, equipment, and fixtures'],

  // ── Other Income ──────────────────────────────────────────────────────────────
  ['JAG_HOLDINGS','6000','Other Income',           'OTHER_INCOME','CREDIT',false,null,'Non-trading income'],
  ['JAG_HOLDINGS','6010','Interest Income',        'OTHER_INCOME','CREDIT',true,'6000','Interest earned on deposits and balances'],
  ['JAG_HOLDINGS','6020','Dividend Income',        'OTHER_INCOME','CREDIT',true,'6000','Dividends from investments'],
  ['JAG_HOLDINGS','6030','FX Gains',               'OTHER_INCOME','CREDIT',true,'6000','Foreign exchange translation gains'],
  ['JAG_HOLDINGS','6040','Gain on Asset Disposal', 'OTHER_INCOME','CREDIT',true,'6000','Proceeds over book value on asset sales'],

  // ── Other Expenses ────────────────────────────────────────────────────────────
  ['JAG_HOLDINGS','7000','Other Expenses',         'OTHER_EXPENSE','DEBIT',false,null,'Non-operating expenses'],
  ['JAG_HOLDINGS','7010','Interest Expense',       'OTHER_EXPENSE','DEBIT',true,'7000','Interest paid on loans and mortgages'],
  ['JAG_HOLDINGS','7020','FX Losses',              'OTHER_EXPENSE','DEBIT',true,'7000','Foreign exchange translation losses'],
  ['JAG_HOLDINGS','7030','Loss on Asset Disposal', 'OTHER_EXPENSE','DEBIT',true,'7000','Book value over proceeds on asset sales'],

  // ══════════════════════════════════════════════════════════════════════════════
  // JABCO — Civil Engineering & Contracting
  // ══════════════════════════════════════════════════════════════════════════════
  ['JABCO','4000','Revenue',                 'REVENUE','CREDIT',false,null,'JABCO contract revenue'],
  ['JABCO','4100','Contract Revenue',        'REVENUE','CREDIT',true,'4000','Progress billing on active construction contracts'],
  ['JABCO','4110','Variation Order Revenue', 'REVENUE','CREDIT',true,'4000','Approved variation orders billed to clients'],
  ['JABCO','4120','Retention Released',      'REVENUE','CREDIT',true,'4000','Retention monies released on contract completion'],

  ['JABCO','5000','Direct Project Costs',    'EXPENSE','DEBIT',false,null,'JABCO direct costs of construction'],
  ['JABCO','5100','Materials & Supplies',    'EXPENSE','DEBIT',true,'5000','Construction materials purchased for projects'],
  ['JABCO','5110','Subcontractor Costs',     'EXPENSE','DEBIT',true,'5000','Payments to subcontractors'],
  ['JABCO','5120','Equipment Hire & Plant',  'EXPENSE','DEBIT',true,'5000','Hired plant and heavy equipment costs'],
  ['JABCO','5130','Site Labour',             'EXPENSE','DEBIT',true,'5000','Direct site wages and allowances'],

  ['JABCO','5200','Overhead Expenses',       'EXPENSE','DEBIT',false,null,'JABCO indirect and overhead costs'],
  ['JABCO','5210','Office & Admin',          'EXPENSE','DEBIT',true,'5200','Office supplies, stationery, admin costs'],
  ['JABCO','5220','Project Insurance',       'EXPENSE','DEBIT',true,'5200','Contract all-risk and liability insurance'],
  ['JABCO','5230','Vehicle & Transport',     'EXPENSE','DEBIT',true,'5200','Fuel, maintenance, and transport costs'],
  ['JABCO','5240','Staff Costs',             'EXPENSE','DEBIT',true,'5200','Salaries, NIS, and benefits for JABCO staff'],

  // ══════════════════════════════════════════════════════════════════════════════
  // JAG_PROPERTIES — Property Management
  // ══════════════════════════════════════════════════════════════════════════════
  ['JAG_PROPERTIES','4000','Rental Revenue',            'REVENUE','CREDIT',false,null,'Property rental income'],
  ['JAG_PROPERTIES','4100','Residential Rental Income', 'REVENUE','CREDIT',true,'4000','Rent from residential tenants'],
  ['JAG_PROPERTIES','4110','Commercial Rental Income',  'REVENUE','CREDIT',true,'4000','Rent from commercial tenants'],
  ['JAG_PROPERTIES','4120','Late Fees & Penalties',     'REVENUE','CREDIT',true,'4000','Late payment fees charged to tenants'],
  ['JAG_PROPERTIES','4130','Security Deposit Income',   'REVENUE','CREDIT',true,'4000','Deposits forfeited by departing tenants'],

  ['JAG_PROPERTIES','5000','Property Operating Expenses','EXPENSE','DEBIT',false,null,'Costs of managing and maintaining properties'],
  ['JAG_PROPERTIES','5100','Maintenance & Repairs',     'EXPENSE','DEBIT',true,'5000','General property maintenance and repair costs'],
  ['JAG_PROPERTIES','5110','Property Insurance',        'EXPENSE','DEBIT',true,'5000','Building and contents insurance premiums'],
  ['JAG_PROPERTIES','5120','Property Tax & Rates',      'EXPENSE','DEBIT',true,'5000','Municipal and land taxes on properties'],
  ['JAG_PROPERTIES','5130','Utility Expenses',          'EXPENSE','DEBIT',true,'5000','Electricity, water, and internet for properties'],
  ['JAG_PROPERTIES','5140','Letting & Management Fees', 'EXPENSE','DEBIT',true,'5000','Agent and management fees on rental income'],
  ['JAG_PROPERTIES','5150','Mortgage Interest',         'EXPENSE','DEBIT',true,'5000','Interest portion of mortgage payments'],

  // ══════════════════════════════════════════════════════════════════════════════
  // JAG_ENTERTAINMENT — BAR + Members Club
  // ══════════════════════════════════════════════════════════════════════════════
  ['JAG_ENTERTAINMENT','4000','Entertainment Revenue',    'REVENUE','CREDIT',false,null,'BAR and Members Club trading revenue'],
  ['JAG_ENTERTAINMENT','4100','Bar Sales',                'REVENUE','CREDIT',true,'4000','Liquor, beverage, and food sales at the BAR'],
  ['JAG_ENTERTAINMENT','4110','Members Club Dues',        'REVENUE','CREDIT',true,'4000','Annual and monthly membership subscription fees'],
  ['JAG_ENTERTAINMENT','4120','Event Revenue',            'REVENUE','CREDIT',true,'4000','Ticket and event hosting revenue'],
  ['JAG_ENTERTAINMENT','4130','Visitor Fees',             'REVENUE','CREDIT',true,'4000','Guest and visitor entry fees'],
  ['JAG_ENTERTAINMENT','4140','Credit Redemptions — Income','REVENUE','CREDIT',true,'4000','Member credit usage converted to revenue'],

  ['JAG_ENTERTAINMENT','5000','Entertainment Expenses',   'EXPENSE','DEBIT',false,null,'Direct and overhead costs of the entertainment operation'],
  ['JAG_ENTERTAINMENT','5100','Bar Purchases',            'EXPENSE','DEBIT',true,'5000','Stock purchased for bar resale'],
  ['JAG_ENTERTAINMENT','5110','Supplier Invoices',        'EXPENSE','DEBIT',true,'5000','Drinks, food, and consumables from suppliers'],
  ['JAG_ENTERTAINMENT','5120','Bar & Club Staff Costs',   'EXPENSE','DEBIT',true,'5000','Wages and benefits for bar and club staff'],
  ['JAG_ENTERTAINMENT','5130','Utilities — Entertainment','EXPENSE','DEBIT',true,'5000','Electricity, water, and internet for the venue'],
  ['JAG_ENTERTAINMENT','5140','Entertainment Insurance',  'EXPENSE','DEBIT',true,'5000','Public liability and venue insurance'],
  ['JAG_ENTERTAINMENT','5150','Marketing & Promotions',   'EXPENSE','DEBIT',true,'5000','Advertising, promotions, and events marketing'],

  // ══════════════════════════════════════════════════════════════════════════════
  // NLCB — National Lottery Agent
  // ══════════════════════════════════════════════════════════════════════════════
  ['NLCB','4000','NLCB Revenue',             'REVENUE','CREDIT',false,null,'NLCB agency commission and ticket revenue'],
  ['NLCB','4100','NLCB Commission Income',   'REVENUE','CREDIT',true,'4000','Commission earned on NLCB lottery sales'],
  ['NLCB','4110','Scratch Ticket Commission','REVENUE','CREDIT',true,'4000','Commission earned on scratch ticket sales'],
  ['NLCB','4120','Biller Commission Income', 'REVENUE','CREDIT',true,'4000','Commission from bill payment services'],

  ['NLCB','5000','NLCB Operating Expenses',  'EXPENSE','DEBIT',false,null,'Costs of running the NLCB agency'],
  ['NLCB','5100','NLCB Agent Expenses',      'EXPENSE','DEBIT',true,'5000','Terminal fees, supplies, and NLCB direct costs'],
  ['NLCB','5110','Staff Costs — NLCB',       'EXPENSE','DEBIT',true,'5000','Staff wages for NLCB operations'],
  ['NLCB','5120','Premises Expenses — NLCB', 'EXPENSE','DEBIT',true,'5000','Rent and utilities for the NLCB premises'],

  // ══════════════════════════════════════════════════════════════════════════════
  // DRAGONBRIDGE — China Sourcing & Forex
  // ══════════════════════════════════════════════════════════════════════════════
  ['DRAGONBRIDGE','4000','DragonBridge Revenue',      'REVENUE','CREDIT',false,null,'Trading, sourcing, and forex revenue'],
  ['DRAGONBRIDGE','4100','Product Sales Revenue',     'REVENUE','CREDIT',true,'4000','Revenue from product imports and resale'],
  ['DRAGONBRIDGE','4110','Sourcing Commission',       'REVENUE','CREDIT',true,'4000','Commission earned on client sourcing orders'],
  ['DRAGONBRIDGE','4120','Forex Trading Gains',       'REVENUE','CREDIT',true,'4000','Gains from USD/CNY/TTD currency conversions'],

  ['DRAGONBRIDGE','5000','DragonBridge Expenses',     'EXPENSE','DEBIT',false,null,'Cost of goods and operations for DragonBridge'],
  ['DRAGONBRIDGE','5100','Cost of Goods — Imports',   'EXPENSE','DEBIT',true,'5000','Purchase cost of imported goods (CIF)'],
  ['DRAGONBRIDGE','5110','Freight & Logistics',       'EXPENSE','DEBIT',true,'5000','Shipping, freight, and delivery costs'],
  ['DRAGONBRIDGE','5120','Customs Duties & Taxes',    'EXPENSE','DEBIT',true,'5000','Import duties, VAT, and customs clearance'],
  ['DRAGONBRIDGE','5130','Admin & Operations',        'EXPENSE','DEBIT',true,'5000','Overheads and admin for DragonBridge operations'],

  // ══════════════════════════════════════════════════════════════════════════════
  // JAG_FINANCE — Consolidated Wealth & Banking
  // ══════════════════════════════════════════════════════════════════════════════
  ['JAG_FINANCE','6000','Finance Income',            'OTHER_INCOME','CREDIT',false,null,'Investment and finance income'],
  ['JAG_FINANCE','6010','Interest Income',           'OTHER_INCOME','CREDIT',true,'6000','Interest earned on bank deposits and facilities'],
  ['JAG_FINANCE','6020','Investment Income',         'OTHER_INCOME','CREDIT',true,'6000','Returns from securities and unit trusts'],
  ['JAG_FINANCE','6030','Insurance Claim Proceeds',  'OTHER_INCOME','CREDIT',true,'6000','Insurance claim payouts received'],

  ['JAG_FINANCE','7000','Finance Expenses',          'OTHER_EXPENSE','DEBIT',false,null,'Finance and investment costs'],
  ['JAG_FINANCE','7010','Loan Interest Expense',     'OTHER_EXPENSE','DEBIT',true,'7000','Interest paid on all loan and mortgage facilities'],
  ['JAG_FINANCE','7020','Bank Charges',              'OTHER_EXPENSE','DEBIT',true,'7000','Monthly bank fees and transaction charges'],
  ['JAG_FINANCE','7030','Insurance Premiums — Group','OTHER_EXPENSE','DEBIT',true,'7000','Group-level insurance premium payments'],
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function getToken() {
  const pass = process.env.KEYCLOAK_PASSWORD;
  if (!pass) { console.error('ERROR: KEYCLOAK_PASSWORD env var not set'); process.exit(1); }

  const res = await fetch(KC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'password',
      client_id:     'jag-api',
      client_secret: KC_SECRET,
      username:      'robertjohnsonattin@gmail.com',
      password:      pass,
    }),
  });
  if (!res.ok) { console.error('Token error:', await res.text()); process.exit(1); }
  return (await res.json()).access_token;
}

async function createAccount(token, payload) {
  if (DRY_RUN) {
    console.log('DRY_RUN:', JSON.stringify(payload));
    return { id: `dry-${payload.account_code}-${payload.owner_entity_id}` };
  }
  const res = await fetch(`${API_BASE}/finance/gl/accounts`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok || !body.success) throw new Error(`POST failed: ${JSON.stringify(body)}`);
  return body.data;
}

async function main() {
  console.log(DRY_RUN ? 'DRY RUN — no accounts will be created\n' : 'Connecting to production API...\n');
  const token = DRY_RUN ? null : await getToken();

  // Map entity+code → created id (for parent_id resolution)
  const createdIds = new Map(); // key: `${entity_key}:${code}`

  let created = 0;
  let skipped = 0;
  let failed  = 0;

  for (const [entityKey, code, name, type, normalBalance, allowDirectPosting, parentCode, description] of ACCOUNTS) {
    const entity_id = ENTITIES[entityKey];
    const parent_id = parentCode ? (createdIds.get(`${entityKey}:${parentCode}`) ?? null) : null;

    const payload = {
      owner_entity_id:      entity_id,
      account_code:         code,
      account_name:         name,
      account_type:         type,
      normal_balance:       normalBalance,
      allow_direct_posting: allowDirectPosting,
      currency:             'TTD',
      ...(parent_id   && { parent_id }),
      ...(description && { description }),
    };

    try {
      const account = await createAccount(token, payload);
      createdIds.set(`${entityKey}:${code}`, account.id);
      console.log(`  ✓ [${entityKey}] ${code} — ${name}`);
      created++;
    } catch (e) {
      const msg = (e.message ?? String(e)).toLowerCase();
      if (msg.includes('duplicate') || msg.includes('unique') || msg.includes('already')) {
        console.log(`  ~ [${entityKey}] ${code} — already exists, skipping`);
        skipped++;
      } else {
        console.error(`  ✗ [${entityKey}] ${code} — ${msg}`);
        failed++;
      }
    }
  }

  console.log(`\nDone. Created: ${created}  Skipped: ${skipped}  Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
