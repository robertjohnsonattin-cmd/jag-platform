#!/usr/bin/env node
/**
 * JAG Document Extractor — Path 2 (local hard drive → Ollama → API)
 *
 * Reads a document directly from the local filing system, extracts structured
 * data with Ollama, and POSTs it to the JAG API. The file never leaves the
 * local machine.
 *
 * Usage:
 *   node dist/extract.js --type <type> --file "path/to/document.pdf" [options]
 *
 * Types:
 *   bank-statement   → Finance → Transactions (pending review)
 *   loan             → Finance → Loans
 *   investment       → Finance → Investments (supports multi-holding statements)
 *                        — TTCD/TTSE depository PDF statements and Interactive Brokers
 *                          "Open Positions" Activity Flex Query CSV exports are parsed
 *                          programmatically (no Ollama) for 100% accuracy. Anything else
 *                          falls back to Ollama text extraction.
 *   insurance        → Finance → Insurance
 *
 * Options:
 *   --entity <uuid>       owner_entity_id (defaults to DEFAULT_OWNER_ENTITY_ID in .env)
 *   --account <uuid>      account_id for bank-statement and loan types
 *   --ibkr-account <id>   filter an IBKR Flex CSV down to one IBKR account (e.g. U4022018)
 *                            before import — use when a single Flex Query export covers
 *                            multiple sub-accounts that belong to different owner entities.
 *                            Re-run once per sub-account with matching --entity.
 *   --dry-run             parse and print without posting to API
 *
 * Config: .env.doc-import in this directory (same level as dist/)
 */

import * as fs   from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

// ── Config ────────────────────────────────────────────────────────────────────

function loadEnv(): void {
  const envFile = path.resolve(__dirname, '..', '.env.doc-import');
  if (!fs.existsSync(envFile)) {
    console.warn(`[warn] No .env.doc-import found at ${envFile} — using process.env only`);
    return;
  }
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const CONFIG = {
  kcUrl:           env('KC_URL',           'https://auth.jagcorporate.com'),
  kcRealm:         env('KC_REALM',         'jag'),
  kcClientId:      env('KC_CLIENT_ID',     'jag-api'),
  kcClientSecret:  env('KC_CLIENT_SECRET'),
  kcUsername:      env('KC_USERNAME'),
  kcPassword:      env('KC_PASSWORD'),
  apiUrl:          env('JAG_API_URL',      'https://api.jagcorporate.com'),
  ollama:          env('OLLAMA_URL',       'http://localhost:11434'),
  model:           env('OLLAMA_MODEL',     'llama3.2'),
  defaultEntityId: env('DEFAULT_OWNER_ENTITY_ID', '00000000-0000-0000-0001-000000000001'),
};

// ── CLI args ──────────────────────────────────────────────────────────────────

type DocType = 'bank-statement' | 'loan' | 'investment' | 'insurance';

function parseArgs(): { type: DocType; file: string; entity: string; account?: string; ibkrAccount?: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  const type        = get('--type') as DocType | undefined;
  const file         = get('--file');
  const entity       = get('--entity') ?? CONFIG.defaultEntityId;
  const account      = get('--account');
  const ibkrAccount  = get('--ibkr-account');
  const dryRun       = args.includes('--dry-run');

  const valid: DocType[] = ['bank-statement', 'loan', 'investment', 'insurance'];
  if (!type || !valid.includes(type)) {
    console.error(`Usage: node dist/extract.js --type <${valid.join('|')}> --file <path> [--entity <uuid>] [--account <uuid>] [--ibkr-account <id>] [--dry-run]`);
    process.exit(1);
  }
  if (!file) {
    console.error('--file is required');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  return { type, file, entity, account, ibkrAccount, dryRun };
}

// ── Text extraction ───────────────────────────────────────────────────────────

async function extractText(filePath: string): Promise<string> {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.csv' || ext === '.txt') {
    return buf.toString('utf8');
  }

  if (ext === '.pdf') {
    const data = await pdfParse(buf);
    return data.text.slice(0, 40_000);
  }

  return buf.toString('utf8', 0, Math.min(buf.length, 40_000));
}

// ── TTCD statement pre-parser ─────────────────────────────────────────────────
// Parses the Trinidad & Tobago Central Depository statement layout where each
// holding block looks like:
//   {TICKER}{COMPANY NAME}
//   Net Movement:
//   Price TTD: {price}Value TTD:
//   Closing Balance:
//   {net_movement}
//   {closing_units}   ← units_held
//   {value_ttd}
//   Opening Balance{opening_units}
//
// Returns null if the text doesn't look like a TTCD statement.
interface TtcdHolding {
  ticker: string;
  name: string;
  units: number;
  price: number | null;
  value: number;
}

interface TtcdStatement {
  institution: string | null;
  asOfDate: string | null;
  holdings: TtcdHolding[];
}

function parseTtcd(text: string): TtcdStatement | null {
  if (!text.includes('Closing Balance:') || !text.includes('Net Movement:')) return null;

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Extract institution (broker/member line — appears multiple times, take first)
  let institution: string | null = null;
  const memberIdx = lines.findIndex(l => /BROKERAGE|ADVISORY|SECURITIES|INVESTMENTS/i.test(l) && l.length > 10);
  if (memberIdx !== -1) institution = lines[memberIdx];

  // Extract as_of_date from "Date Range: ... to {end_date}"
  let asOfDate: string | null = null;
  const dateRangeLine = lines.find(l => /\d{2}-[A-Za-z]{3}-\d{4}to\d{2}-[A-Za-z]{3}-\d{4}/.test(l));
  if (dateRangeLine) {
    const m = dateRangeLine.match(/to(\d{2}-[A-Za-z]{3}-(\d{4}))/);
    if (m) {
      const months: Record<string, string> = {
        Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
        Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12',
      };
      const [day, mon, yr] = m[1].split('-');
      if (months[mon]) asOfDate = `${yr}-${months[mon]}-${day.padStart(2, '0')}`;
    }
  }

  // Known TTSE tickers — ordered longest-first to avoid prefix ambiguity (e.g. SBT vs SBTT)
  const TTSE_TICKERS = [
    'AGOSTINI','JMMBGL','NCBFG','PLIPDECO','BOURSE','CENCORP',
    'SBTT','RFHL','MASSY','AMCL','FIRST','HPHL','CINV','EFCL','BPTT',
    'AHL','NEL','NFM','PLD','UCL','WCO','GHL','ONE','MRC','TBL','FCI','CNC','MHL',
  ];

  function splitTickerName(raw: string): { ticker: string; name: string } | null {
    // Try known TTSE tickers first (most reliable)
    for (const t of TTSE_TICKERS) {
      if (raw.startsWith(t)) {
        const name = raw.slice(t.length).trim();
        if (name.length > 0) return { ticker: t, name };
      }
    }
    // Fallback: greedy from longest — take uppercase prefix where remainder is multi-word
    for (const len of [6, 5, 4, 3, 2]) {
      const t    = raw.slice(0, len);
      const name = raw.slice(len).trim();
      if (/^[A-Z][A-Z0-9]+$/.test(t) && /^[A-Z]/.test(name) && name.includes(' ')) {
        return { ticker: t, name };
      }
    }
    return null;
  }

  const holdings: TtcdHolding[] = [];
  const parseNum = (s: string) => parseFloat(s.replace(/,/g, ''));

  let i = 0;
  while (i < lines.length) {
    // Look for a "Net Movement:" line — the holding name is the line just before it
    if (lines[i] === 'Net Movement:') {
      const nameLine = i > 0 ? lines[i - 1] : '';
      const parsed = splitTickerName(nameLine);
      if (!parsed) { i++; continue; }

      // After "Net Movement:" we expect:
      // i+1: "Price TTD: {price}Value TTD:"
      // i+2: "Closing Balance:"
      // i+3: net_movement (number, usually 0)
      // i+4: closing_units
      // i+5: value_ttd
      const priceLabel = lines[i + 1] ?? '';
      const closingLabel = lines[i + 2] ?? '';

      if (closingLabel !== 'Closing Balance:') { i++; continue; }

      // Extract price from "Price TTD: 11.05Value TTD:"
      const priceM = priceLabel.match(/Price TTD:\s*([\d.,]+)/);
      const price = priceM ? parseNum(priceM[1]) : null;

      // i+3 is net_movement, i+4 is closing_units, i+5 is value_ttd
      const unitsStr = lines[i + 4] ?? '';
      const valueStr = lines[i + 5] ?? '';

      const units = parseNum(unitsStr);
      const value = parseNum(valueStr);

      if (!isNaN(units) && !isNaN(value) && value > 0) {
        holdings.push({ ticker: parsed.ticker, name: parsed.name, units, price, value });
      }

      i += 6;
    } else {
      i++;
    }
  }

  if (holdings.length === 0) return null;
  return { institution, asOfDate, holdings };
}

// ── Interactive Brokers Open Positions Flex Query pre-parser ─────────────────
// Parses the CSV export of an Activity Flex Query scoped to the "Open Positions"
// section (Summary level). Field selection expected (UI labels — exact CSV header
// text varies by IBKR account/version, so matching is normalized and tolerant):
//   Account ID, Symbol, Description, Asset Class, Currency, FX Rate To Base,
//   Quantity, Mark Price, Position Value, Cost Basis Price, Cost Basis Money,
//   Unrealized P/L, Report Date
//
// Returns null if the text doesn't look like an IBKR Flex CSV.

interface IbkrHolding {
  accountId: string | null;
  symbol: string;
  description: string;
  assetClass: string;
  currency: string;
  quantity: number;
  markPrice: number | null;
  positionValue: number | null;
  costBasisPrice: number | null;
  costBasisMoney: number | null;
  unrealizedPnl: number | null;
  reportDate: string | null;
}

interface IbkrStatement {
  holdings: IbkrHolding[];
}

interface IbkrCashBalance {
  accountId:  string | null;
  fxCurrency: string;
  quantity:   number;
  value:      number | null;
  reportDate: string | null;
}

interface IbkrForexStatement {
  balances: IbkrCashBalance[];
}

// Minimal RFC4180-ish CSV line splitter — handles quoted fields containing commas.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const normalizeHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '');

// Each logical field maps to a set of normalized header aliases (covers both the
// UI label and the internal Flex field name, which differ across IBKR versions).
const IBKR_FIELD_ALIASES: Record<string, string[]> = {
  accountId:      ['accountid', 'clientaccountid', 'acctid'],
  symbol:         ['symbol'],
  description:    ['description'],
  assetClass:     ['assetclass'],
  currency:       ['currency'],
  quantity:       ['quantity', 'position'],
  markPrice:      ['markprice'],
  positionValue:  ['positionvalue'],
  costBasisPrice: ['costbasisprice'],
  costBasisMoney: ['costbasismoney'],
  unrealizedPnl:  ['fifopnlunrealized', 'unrealizedpl', 'unrealizedp_l'],
  reportDate:     ['reportdate'],
};

const IBKR_FOREX_FIELD_ALIASES: Record<string, string[]> = {
  accountId:  ['accountid', 'clientaccountid', 'acctid'],
  fxCurrency: ['fxcurrency'],
  quantity:   ['quantity'],
  value:      ['value'],
  reportDate: ['reportdate'],
};

function parseIbkrForexBalances(text: string): IbkrForexStatement | null {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);

  // Find a header row that has 'fxcurrency' and 'quantity' but NOT 'symbol' or 'markprice'
  // (to avoid confusing with the Open Positions header).
  let headerIdx = -1;
  let headerCols: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]).map(normalizeHeader);
    if (cols.includes('fxcurrency') && cols.includes('quantity') && !cols.includes('symbol') && !cols.includes('markprice')) {
      headerIdx = i;
      headerCols = cols;
      break;
    }
  }
  if (headerIdx === -1) return null;

  const colIndex: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(IBKR_FOREX_FIELD_ALIASES)) {
    const idx = headerCols.findIndex(c => aliases.includes(c));
    if (idx !== -1) colIndex[field] = idx;
  }
  if (colIndex.fxCurrency === undefined || colIndex.quantity === undefined) return null;

  const parseNum = (s: string | undefined): number | null => {
    if (s === undefined || s.trim() === '') return null;
    const n = parseFloat(s.replace(/,/g, ''));
    return isNaN(n) ? null : n;
  };

  const balances: IbkrCashBalance[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols      = splitCsvLine(lines[i]);
    const fxCurrency = colIndex.fxCurrency !== undefined ? (cols[colIndex.fxCurrency] ?? '').trim().toUpperCase() : '';
    // Skip totals, summaries, and blank currency fields
    if (!fxCurrency || /^(total|base_summary)$/i.test(fxCurrency)) continue;
    // Stop if we hit another section's header (non-numeric quantity)
    const quantity  = parseNum(colIndex.quantity !== undefined ? cols[colIndex.quantity] : undefined);
    if (quantity === null || quantity === 0) continue;

    balances.push({
      accountId:  colIndex.accountId  !== undefined ? (cols[colIndex.accountId]  ?? '').trim() || null : null,
      fxCurrency,
      quantity,
      value:      colIndex.value      !== undefined ? parseNum(cols[colIndex.value])       : null,
      reportDate: colIndex.reportDate !== undefined ? (cols[colIndex.reportDate]  ?? '').trim() || null : null,
    });
  }

  if (balances.length === 0) return null;
  return { balances };
}

function parseIbkrPositions(text: string): IbkrStatement | null {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return null;

  // Find the header row: the first line whose normalized fields contain both
  // "symbol" and ("quantity" or "position") and "markprice".
  let headerIdx = -1;
  let headerCols: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]).map(normalizeHeader);
    if (cols.includes('symbol') && (cols.includes('quantity') || cols.includes('position')) && cols.includes('markprice')) {
      headerIdx = i;
      headerCols = cols;
      break;
    }
  }
  if (headerIdx === -1) return null;

  // Build column index lookup per logical field.
  const colIndex: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(IBKR_FIELD_ALIASES)) {
    const idx = headerCols.findIndex(c => aliases.includes(c));
    if (idx !== -1) colIndex[field] = idx;
  }
  if (colIndex.symbol === undefined || colIndex.quantity === undefined) return null;

  const parseNum = (s: string | undefined): number | null => {
    if (s === undefined || s.trim() === '') return null;
    const n = parseFloat(s.replace(/,/g, ''));
    return isNaN(n) ? null : n;
  };

  const holdings: IbkrHolding[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    // Skip Flex "Total"/summary rows and rows that don't have a usable symbol.
    const symbol = colIndex.symbol !== undefined ? (cols[colIndex.symbol] ?? '').trim() : '';
    if (!symbol || /^total/i.test(symbol)) continue;

    const quantity = parseNum(colIndex.quantity !== undefined ? cols[colIndex.quantity] : undefined);
    if (quantity === null) continue;

    holdings.push({
      accountId:      colIndex.accountId      !== undefined ? (cols[colIndex.accountId] ?? '').trim() || null : null,
      symbol,
      description:    colIndex.description    !== undefined ? (cols[colIndex.description] ?? '').trim() || symbol : symbol,
      assetClass:     colIndex.assetClass      !== undefined ? (cols[colIndex.assetClass] ?? '').trim().toUpperCase() : 'STK',
      currency:       colIndex.currency        !== undefined ? (cols[colIndex.currency] ?? '').trim().toUpperCase() || 'USD' : 'USD',
      quantity,
      markPrice:      colIndex.markPrice       !== undefined ? parseNum(cols[colIndex.markPrice])      : null,
      positionValue:  colIndex.positionValue   !== undefined ? parseNum(cols[colIndex.positionValue])  : null,
      costBasisPrice: colIndex.costBasisPrice  !== undefined ? parseNum(cols[colIndex.costBasisPrice]) : null,
      costBasisMoney: colIndex.costBasisMoney  !== undefined ? parseNum(cols[colIndex.costBasisMoney]) : null,
      unrealizedPnl:  colIndex.unrealizedPnl   !== undefined ? parseNum(cols[colIndex.unrealizedPnl])  : null,
      reportDate:     colIndex.reportDate      !== undefined ? (cols[colIndex.reportDate] ?? '').trim() || null : null,
    });
  }

  if (holdings.length === 0) return null;
  return { holdings };
}

// Maps IBKR's AssetClass code to a fin_investments investment_type. Derivative/
// complex instrument classes (options, futures, warrants, etc.) are intentionally
// left unmapped — those rows are skipped on import rather than mis-tagged.
const IBKR_ASSET_CLASS_MAP: Record<string, string> = {
  STK:  'EQUITY',
  ETF:  'ETF',
  FUND: 'MUTUAL_FUND',
  BOND: 'BOND',
  CASH: 'CASH_EQUIVALENT',
};

// ── Keycloak auth (Resource Owner Password Credentials) ──────────────────────

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at - 30_000) {
    return cachedToken.access_token;
  }

  const url  = `${CONFIG.kcUrl}/realms/${CONFIG.kcRealm}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type:    'password',
    client_id:     CONFIG.kcClientId,
    client_secret: CONFIG.kcClientSecret,
    username:      CONFIG.kcUsername,
    password:      CONFIG.kcPassword,
  });

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keycloak auth failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    access_token: data.access_token,
    expires_at:   Date.now() + (data.expires_in * 1000),
  };
  return cachedToken.access_token;
}

// ── API client ────────────────────────────────────────────────────────────────

async function apiPost(endpoint: string, body: unknown): Promise<unknown> {
  const token = await getToken();
  const url   = `${CONFIG.apiUrl}/api/v1${endpoint}`;

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json() as { success: boolean; data?: unknown; error?: string };
  if (!res.ok || !data.success) {
    throw new Error(`API ${endpoint} failed (${res.status}): ${data.error ?? JSON.stringify(data)}`);
  }
  return data.data;
}

async function apiGet(endpoint: string): Promise<{ ok: boolean; data?: unknown; status: number }> {
  const token = await getToken();
  const url   = `${CONFIG.apiUrl}/api/v1${endpoint}`;

  const res = await fetch(url, {
    method:  'GET',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json() as { success: boolean; data?: unknown; error?: string };
  return { ok: res.ok && data.success, data: data.data, status: res.status };
}

// Looks up the latest TTD rate for a 3-letter currency via /finance/fx-rates/:currency/latest.
// Returns 1 for TTD itself, or null if no rate is on file (caller should warn and skip conversion).
const fxRateCache = new Map<string, number | null>();
async function getLatestTtdRate(currency: string): Promise<number | null> {
  if (currency === 'TTD') return 1;
  if (fxRateCache.has(currency)) return fxRateCache.get(currency)!;
  const resp = await apiGet(`/finance/fx-rates/${currency}/latest`);
  const rate = resp.ok ? Number((resp.data as { rate_to_ttd?: unknown } | undefined)?.rate_to_ttd ?? NaN) : NaN;
  const result = !isNaN(rate) && rate > 0 ? rate : null;
  fxRateCache.set(currency, result);
  return result;
}

// ── Ollama prompts ────────────────────────────────────────────────────────────

const PROMPTS: Record<DocType, string> = {
  'bank-statement': `You are a financial data extraction assistant for a Caribbean family office.
Extract all bank transactions from the statement text and return a JSON array.

Each item must have:
  transaction_date   string  YYYY-MM-DD
  amount             number  positive=credit negative=debit
  currency           string  ISO 4217 (TTD, USD, etc.)
  description        string  raw description from statement
  merchant_name      string|null
  reference_number   string|null
  suggested_category string  one of: SALARY, DIVIDEND, RENTAL_INCOME, INTEREST_INCOME,
                             TRANSFER_IN, OPERATING_EXPENSE, PAYROLL, TAX_PAYMENT,
                             LOAN_REPAYMENT, INVESTMENT_PURCHASE, INVESTMENT_SALE,
                             TRANSFER_OUT, PERSONAL_EXPENSE, UTILITIES, INSURANCE,
                             ENTERTAINMENT, TRAVEL, MEDICAL, EDUCATION, CHARITY, UNCLASSIFIED
  confidence         number  0.0–1.0

Return ONLY the JSON array. If no transactions found return [].`,

  loan: `You are a financial data extraction assistant for a Caribbean family office.
Extract loan or mortgage details and return a single JSON object.
Return ONLY the JSON — no markdown fences, no commentary.

{
  "lender_name":            string,
  "loan_type":              "MORTGAGE"|"CAR_LOAN"|"PERSONAL_LOAN"|"BUSINESS_LOAN"|"OVERDRAFT"|"OTHER",
  "original_principal":     number,
  "outstanding_balance":    number,
  "currency":               string,
  "interest_rate":          number,
  "interest_type":          "FIXED"|"VARIABLE",
  "monthly_payment":        number|null,
  "start_date":             "YYYY-MM-DD"|null,
  "maturity_date":          "YYYY-MM-DD"|null,
  "collateral_description": string|null
}`,

  investment: `You are a financial data extraction assistant for a Caribbean family office.
Extract investment portfolio holdings and return a JSON object.
Return ONLY the JSON — no markdown fences, no commentary.

IMPORTANT — TTCD / TTSE depository statement format:
The text from these statements has a specific layout per holding:
  {TICKER}{COMPANY NAME}          ← ticker and name are joined with NO space, e.g. "AHLANGOSTURA HOLDINGS LIMITED"
  Net Movement:
  Price TTD: {price}Value TTD:    ← price and label joined, ignore "Value TTD:" label
  Closing Balance:
  {net_movement_units}            ← usually 0 if no trades
  {closing_balance_units}         ← THIS is units_held (may have commas, e.g. "187,840")
  {value_ttd}                     ← current_value_ttd (e.g. "702,521.60")
  Opening Balance{opening_units}  ← ignore this line

Split ticker from name: the ticker is the ALL-CAPS prefix before the first mixed-case or lowercase letter.
Examples: "AHLANGOSTURA" → ticker=AHL, name="ANGOSTURA HOLDINGS LIMITED"
          "AMCLANSA McAL" → ticker=AMCL, name="ANSA McAL LIMITED"
          "MASSYMASSY HOLDINGS" → ticker=MASSY, name="MASSY HOLDINGS LTD."
          "RFHLREPUBLIC FINANCIAL" → ticker=RFHL, name="REPUBLIC FINANCIAL HOLDINGS LIMITED"
          "SBTTSCOTIABANK" → ticker=SBTT, name="SCOTIABANK TRINIDAD AND TOBAGO LIMITED"

The institution_name is the BROKER/MEMBER listed near the bottom of each page (e.g. "FIRST CITIZENS BROKERAGE & ADVISORY SERVICES LIMITED"), NOT a stock name.
The as_of_date is the END date of the "Date Range" period shown on the statement (e.g. "01-Jul-2025 to 30-Sep-2025" → "2025-09-30").
The Grand Total line near the end is the portfolio total — do not create a holding for it.

{
  "institution_name": string,
  "as_of_date":       "YYYY-MM-DD"|null,
  "holdings": [
    {
      "asset_name":        string,
      "investment_type":   "EQUITY"|"BOND"|"MUTUAL_FUND"|"ETF"|"UNIT_TRUST"|"ANNUITY"|"CASH_EQUIVALENT"|"OTHER",
      "ticker_symbol":     string|null,
      "units_held":        number,
      "current_price":     number|null,
      "currency":          string,
      "current_value_ttd": number|null,
      "purchase_date":     "YYYY-MM-DD"|null,
      "maturity_date":     "YYYY-MM-DD"|null
    }
  ]
}`,

  insurance: `You are a financial data extraction assistant for a Caribbean family office.
Extract insurance policy details and return a single JSON object.
Return ONLY the JSON — no markdown fences, no commentary.

{
  "policy_number":      string,
  "insurer_name":       string,
  "broker_name":        string|null,
  "policy_type":        "PROPERTY"|"VEHICLE"|"LIABILITY"|"LIFE"|"HEALTH"|"BUSINESS_INTERRUPTION"|"MARINE"|"PROFESSIONAL_INDEMNITY"|"OTHER",
  "insured_asset_type": "VEHICLE"|"PROPERTY"|"BUSINESS"|"PERSON"|"OTHER",
  "coverage_amount":    number,
  "currency":           string,
  "premium_amount":     number,
  "premium_frequency":  "MONTHLY"|"QUARTERLY"|"SEMI_ANNUAL"|"ANNUAL"|"ONE_OFF",
  "start_date":         "YYYY-MM-DD",
  "expiry_date":        "YYYY-MM-DD"
}`,
};

// ── Ollama call ───────────────────────────────────────────────────────────────

async function callOllamaOnce(type: DocType, text: string): Promise<unknown> {
  const prompt = PROMPTS[type];
  const body   = JSON.stringify({
    model:  CONFIG.model,
    prompt: `${prompt}\n\n---DOCUMENT---\n${text.slice(0, 30_000)}`,
    stream: false,
    options: { temperature: 0, seed: 42, num_predict: 4096, num_ctx: 16384 },
  });

  console.log(`  Calling Ollama (${CONFIG.model}) …`);
  const res = await fetch(`${CONFIG.ollama}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(600_000),
  });

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);

  const data = await res.json() as { response: string };

  // Find the outermost JSON object or array, ignoring any surrounding prose or fences
  const raw = data.response;
  const start = raw.search(/[\[{]/);
  if (start === -1) throw new Error(`Ollama returned no JSON: ${raw.slice(0, 300)}`);

  const opener = raw[start] as '{' | '[';
  const closer = opener === '{' ? '}' : ']';
  let depth = 0, end = -1;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === opener) depth++;
    else if (raw[i] === closer) { depth--; if (depth === 0) { end = i; break; } }
  }

  const jsonStr = end !== -1 ? raw.slice(start, end + 1) : raw.slice(start);

  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error(`Ollama non-JSON response: ${raw.slice(0, 300)}`);
  }
}

// ── Handlers per type ─────────────────────────────────────────────────────────

async function handleBankStatement(extracted: unknown, args: ReturnType<typeof parseArgs>): Promise<void> {
  if (!Array.isArray(extracted)) throw new Error('Expected array of transactions from Ollama');

  if (!args.account) {
    console.error('--account <uuid> is required for bank-statement type');
    process.exit(1);
  }

  const transactions = (extracted as Record<string, unknown>[]).map((tx, i) => ({
    account_id:         args.account!,
    transaction_date:   String(tx['transaction_date'] ?? ''),
    amount:             Number(tx['amount'] ?? 0),
    currency:           String(tx['currency'] ?? 'TTD'),
    description:        String(tx['description'] ?? ''),
    merchant_name:      tx['merchant_name'] ? String(tx['merchant_name']) : null,
    reference_number:   tx['reference_number'] ? String(tx['reference_number']) : null,
    suggested_category: String(tx['suggested_category'] ?? 'UNCLASSIFIED'),
    confidence:         Number(tx['confidence'] ?? 0.5),
    idempotency_key:    `local-import:${args.account}:${tx['transaction_date']}:${tx['amount']}:${i}:${Date.now()}`,
  }));

  console.log(`  ${transactions.length} transactions extracted`);
  const result = await apiPost('/finance/bank-statements/import', { transactions }) as { imported: number; skipped: number };
  console.log(`  ✓ Imported ${result.imported}, skipped ${result.skipped}`);
}

async function handleLoan(extracted: unknown, args: ReturnType<typeof parseArgs>): Promise<void> {
  const d = extracted as Record<string, unknown>;
  const payload = {
    owner_entity_id:        args.entity,
    account_id:             args.account,
    loan_type:              d['loan_type']              ?? 'OTHER',
    lender_name:            d['lender_name']            ?? 'Unknown',
    original_principal:     Number(d['original_principal']  ?? 0),
    outstanding_balance:    Number(d['outstanding_balance']  ?? 0),
    currency:               d['currency']               ?? 'TTD',
    interest_rate:          Number(d['interest_rate']   ?? 0),
    interest_type:          d['interest_type']          ?? 'FIXED',
    monthly_payment:        d['monthly_payment']        ? Number(d['monthly_payment']) : undefined,
    start_date:             d['start_date']             ?? new Date().toISOString().slice(0, 10),
    maturity_date:          d['maturity_date']          ?? undefined,
    collateral_description: d['collateral_description'] ?? undefined,
    idempotency_key:        `local-import:loan:${Date.now()}`,
  };

  console.log('  Extracted loan:', JSON.stringify(payload, null, 2));
  const result = await apiPost('/finance/loans/import', payload);
  console.log(`  ✓ Loan created:`, (result as Record<string, unknown>)['id']);
}

async function handleInvestment(
  extracted: unknown,
  args: ReturnType<typeof parseArgs>,
  ttcd?: TtcdStatement,
  ibkr?: IbkrStatement,
  ibkrForex?: IbkrForexStatement,
): Promise<void> {
  let d: { institution_name?: string; as_of_date?: string; holdings?: Record<string, unknown>[] };
  let holdings: Record<string, unknown>[];

  if (ibkr) {
    const ts = Date.now();
    const items: Record<string, unknown>[] = [];
    let skipped = 0;

    for (let i = 0; i < ibkr.holdings.length; i++) {
      const h = ibkr.holdings[i];
      const investmentType = IBKR_ASSET_CLASS_MAP[h.assetClass];
      if (!investmentType) {
        console.warn(`  ⚠  Skipping ${h.symbol} — unmapped asset class "${h.assetClass}" (likely a derivative; not tracked in fin_investments)`);
        skipped++; continue;
      }
      if (h.quantity <= 0) {
        console.warn(`  ⚠  Skipping ${h.symbol} — non-positive quantity (${h.quantity}; short or closed position)`);
        skipped++; continue;
      }

      const rate = await getLatestTtdRate(h.currency);
      if (rate === null) {
        console.warn(`  ⚠  No FX rate on file for ${h.currency} — current_value_ttd/unrealised_gain_ttd will be left blank for ${h.symbol}. Run POST /finance/fx-rates/sync or add a manual rate, then fix up via the Update modal.`);
      }

      const accountTag = h.accountId ? ` (${h.accountId})` : '';
      items.push({
        owner_entity_id:       args.entity,
        account_id:            args.account,
        investment_type:       investmentType,
        asset_name:            h.description.slice(0, 200),
        ticker_symbol:         h.symbol.slice(0, 20),
        units_held:            h.quantity,
        average_cost_per_unit: h.costBasisPrice && h.costBasisPrice > 0 ? h.costBasisPrice : undefined,
        current_price:         h.markPrice && h.markPrice > 0 ? h.markPrice : undefined,
        currency:              h.currency,
        current_value_ttd:     rate !== null && h.positionValue !== null ? Math.round(h.positionValue * rate * 100) / 100 : undefined,
        unrealised_gain_ttd:   rate !== null && h.unrealizedPnl !== null ? Math.round(h.unrealizedPnl * rate * 100) / 100 : undefined,
        institution_name:      `Interactive Brokers${accountTag}`,
        notes:                 h.reportDate ? `Imported from IBKR Open Positions Flex Query (Report Date: ${h.reportDate})` : 'Imported from IBKR Open Positions Flex Query',
        idempotency_key:       `local-import:investment:ibkr:${h.symbol}:${i}:${ts}`,
      });
    }

    // Append cash balances from Forex Balances section (if present in the same CSV)
    if (ibkrForex) {
      const filteredBalances = args.ibkrAccount
        ? ibkrForex.balances.filter(b => b.accountId === args.ibkrAccount)
        : ibkrForex.balances;

      for (let i = 0; i < filteredBalances.length; i++) {
        const b    = filteredBalances[i];
        const rate = await getLatestTtdRate(b.fxCurrency);
        if (rate === null) {
          console.warn(`  ⚠  No FX rate for ${b.fxCurrency} — current_value_ttd will be blank for cash balance. Sync FX rates and update via Investments panel.`);
        }
        const accountTag = b.accountId ? ` (${b.accountId})` : '';
        items.push({
          owner_entity_id:   args.entity,
          account_id:        args.account,
          investment_type:   'CASH_EQUIVALENT',
          asset_name:        `${b.fxCurrency} Cash`,
          ticker_symbol:     b.fxCurrency,
          units_held:        b.quantity,
          current_price:     1,
          currency:          b.fxCurrency,
          current_value_ttd: rate !== null && b.value !== null ? Math.round(b.value * rate * 100) / 100
                           : rate !== null ? Math.round(b.quantity * rate * 100) / 100
                           : undefined,
          institution_name:  `Interactive Brokers${accountTag}`,
          notes:             b.reportDate ? `Cash balance from IBKR Forex Balances (Report Date: ${b.reportDate})` : 'Cash balance from IBKR Forex Balances',
          idempotency_key:   `local-import:investment:ibkr:cash:${b.fxCurrency}:${i}:${ts}`,
        });
      }
      if (filteredBalances.length > 0) {
        console.log(`  + ${filteredBalances.length} cash balance(s) from Forex Balances section`);
      }
    }

    if (items.length === 0) {
      console.error('  No importable holdings after filtering. Check warnings above.');
      process.exit(1);
    }

    console.log(`  ${items.length} holding(s) to import, ${skipped} skipped`);
    items.forEach((item, i) =>
      console.log(`    [${i + 1}] ${item.ticker_symbol} — ${item.asset_name} | ${item.units_held} units, ${item.currency} ${item.current_price ?? '?'} → TTD ${item.current_value_ttd ?? '(no FX rate)'}`));

    if (args.dryRun) { console.log('\nDRY RUN — skipping API post.'); return; }

    const result = await apiPost('/finance/investments/import', { items }) as unknown[];
    console.log(`  ✓ ${result.length} investment record(s) created`);
    return;
  }

  if (ttcd) {
    // TTCD path — names already clean, skip stripTicker / parseNum, build items directly
    const ts = Date.now();
    const items = ttcd.holdings.map((h, i) => ({
      owner_entity_id:   args.entity,
      account_id:        args.account,
      investment_type:   'EQUITY' as const,
      asset_name:        h.name,
      ticker_symbol:     h.ticker,
      units_held:        h.units,
      current_price:     h.price ?? undefined,
      currency:          'TTD',
      current_value_ttd: h.value,
      institution_name:  ttcd.institution ?? undefined,
      idempotency_key:   `local-import:investment:${i}:${ts}`,
    }));

    console.log(`  ${items.length} holding(s) extracted`);
    items.forEach((item, i) =>
      console.log(`    [${i + 1}] ${item.asset_name} (${item.investment_type}) — TTD ${item.current_value_ttd}`));

    const result = await apiPost('/finance/investments/import', { items }) as unknown[];
    console.log(`  ✓ ${result.length} investment record(s) created`);
    return;
  }

  d = extracted as { institution_name?: string; as_of_date?: string; holdings?: Record<string, unknown>[] };
  holdings = d.holdings ?? [];

  if (!holdings.length) {
    console.error('  No holdings found in Ollama response. Check the document or add manually.');
    process.exit(1);
  }

  const parseNum = (v: unknown) =>
    v != null && v !== '' ? parseFloat(String(v).replace(/,/g, '')) : undefined;

  // Strip ticker prefix from asset_name when it equals the leading ALL-CAPS run
  const stripTicker = (name: string, ticker: string | undefined): string => {
    if (!ticker) return name;
    if (name.startsWith(ticker)) return name.slice(ticker.length).trim();
    // Fallback: strip any leading ALL-CAPS prefix (handles ticker extracted wrong)
    return name.replace(/^[A-Z0-9]+(?=[A-Z][a-z]|[a-z])/, '').trim();
  };

  const ts = Date.now();
  const items = holdings.map((h, i) => {
    const ticker   = h['ticker_symbol'] ? String(h['ticker_symbol']) : undefined;
    const rawName  = String(h['asset_name'] ?? 'Unknown');
    const assetName = stripTicker(rawName, ticker);
    return {
      owner_entity_id:   args.entity,
      account_id:        args.account,
      investment_type:   h['investment_type']  ?? 'OTHER',
      asset_name:        assetName,
      ticker_symbol:     ticker,
      units_held:        parseNum(h['units_held'])        ?? 0,
      current_price:     parseNum(h['current_price']),
      currency:          h['currency']                    ?? 'TTD',
      current_value_ttd: parseNum(h['current_value_ttd']),
      institution_name:  d.institution_name               ?? undefined,
      purchase_date:     h['purchase_date']               ?? undefined,
      maturity_date:     h['maturity_date']               ?? undefined,
      idempotency_key:   `local-import:investment:${i}:${ts}`,
    };
  });

  console.log(`  ${items.length} holding(s) extracted`);
  items.forEach((item, i) => console.log(`    [${i + 1}] ${item.asset_name} (${item.investment_type}) — ${item.currency} ${item.current_value_ttd ?? '?'}`));

  const result = await apiPost('/finance/investments/import', { items }) as unknown[];
  console.log(`  ✓ ${result.length} investment record(s) created`);
}

async function handleInsurance(extracted: unknown, args: ReturnType<typeof parseArgs>): Promise<void> {
  const d = extracted as Record<string, unknown>;
  const currency      = String(d['currency'] ?? 'TTD').toUpperCase();
  const coverageAmt   = Number(d['coverage_amount'] ?? 0);
  const premiumAmt    = Number(d['premium_amount']  ?? 0);

  const payload = {
    owner_entity_id:      args.entity,
    policy_number:        d['policy_number']      ?? 'UNKNOWN',
    insurer_name:         d['insurer_name']        ?? 'Unknown',
    broker_name:          d['broker_name']         ?? undefined,
    policy_type:          d['policy_type']         ?? 'OTHER',
    insured_asset_type:   d['insured_asset_type']  ?? 'OTHER',
    coverage_amount:      coverageAmt,
    currency,
    coverage_amount_ttd:  currency === 'TTD' ? coverageAmt : coverageAmt,
    premium_amount:       premiumAmt,
    premium_amount_ttd:   currency === 'TTD' ? premiumAmt  : premiumAmt,
    premium_frequency:    d['premium_frequency']   ?? 'ANNUAL',
    start_date:           d['start_date']          ?? new Date().toISOString().slice(0, 10),
    expiry_date:          d['expiry_date']         ?? new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    renewal_alert_days:   60,
    idempotency_key:      `local-import:insurance:${Date.now()}`,
  };

  console.log('  Extracted policy:', JSON.stringify(payload, null, 2));

  if (currency !== 'TTD') {
    console.warn(`  ⚠  Currency is ${currency} — coverage_amount_ttd and premium_amount_ttd set to raw amounts.`);
    console.warn('     Update these values manually after import if FX conversion is needed.');
  }

  const result = await apiPost('/finance/insurance/policies/import', payload);
  console.log(`  ✓ Policy created:`, (result as Record<string, unknown>)['id']);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  console.log(`\n========================================`);
  console.log(`JAG Document Extractor — Path 2`);
  console.log(`Type:    ${args.type}`);
  console.log(`File:    ${args.file}`);
  console.log(`Entity:  ${args.entity}`);
  if (args.account)     console.log(`Account: ${args.account}`);
  if (args.ibkrAccount) console.log(`IBKR Acct Filter: ${args.ibkrAccount}`);
  if (args.dryRun)  console.log(`Mode:    DRY RUN`);
  console.log(`========================================\n`);

  const text = await extractText(args.file);
  console.log(`Extracted ${text.length} chars of text from document`);

  async function callOllama(type: DocType, docText: string): Promise<unknown> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await callOllamaOnce(type, docText);
      } catch (e) {
        if (attempt === 2) throw e;
        console.warn(`  Ollama attempt ${attempt} failed (${(e as Error).message.slice(0, 80)}) — retrying …`);
      }
    }
    throw new Error('unreachable');
  }

  // For investment statements, try the programmatic pre-parsers first (100% reliable,
  // no Ollama): TTCD/TTSE depository PDF layout, then Interactive Brokers Flex CSV.
  let ttcdResult: TtcdStatement | null = null;
  let ibkrResult: IbkrStatement | null = null;
  let ibkrForexResult: IbkrForexStatement | null = null;
  if (args.type === 'investment') {
    ttcdResult = parseTtcd(text);
    if (ttcdResult) {
      console.log(`\n  TTCD format detected — ${ttcdResult.holdings.length} holdings parsed programmatically`);
      console.log(`  Institution: ${ttcdResult.institution ?? '(not found)'}`);
      console.log(`  As-of date:  ${ttcdResult.asOfDate ?? '(not found)'}`);
      ttcdResult.holdings.forEach((h, i) =>
        console.log(`    [${i + 1}] ${h.ticker} — ${h.name} | ${h.units.toLocaleString()} units @ TTD ${h.price ?? '?'} = TTD ${h.value.toLocaleString('en', { minimumFractionDigits: 2 })}`));
    } else {
      ibkrResult = parseIbkrPositions(text);
      if (ibkrResult) {
        console.log(`\n  Interactive Brokers Flex CSV detected — ${ibkrResult.holdings.length} open position(s) parsed programmatically`);

        if (args.ibkrAccount) {
          const allAccountIds = [...new Set(ibkrResult.holdings.map(h => h.accountId).filter((a): a is string => !!a))];
          const filtered = ibkrResult.holdings.filter(h => h.accountId === args.ibkrAccount);
          if (filtered.length === 0) {
            console.error(`  No holdings found for IBKR account "${args.ibkrAccount}". Accounts present in this file: ${allAccountIds.join(', ') || '(none — AccountID column missing from export)'}`);
            process.exit(1);
          }
          console.log(`  Filtered to IBKR account ${args.ibkrAccount}: ${filtered.length} of ${ibkrResult.holdings.length} holding(s) (other accounts in file: ${allAccountIds.filter(a => a !== args.ibkrAccount).join(', ') || 'none'})`);
          ibkrResult = { holdings: filtered };
        }

        ibkrResult.holdings.forEach((h, i) =>
          console.log(`    [${i + 1}] ${h.symbol} — ${h.description} | ${h.quantity.toLocaleString()} units @ ${h.currency} ${h.markPrice ?? '?'} (asset class ${h.assetClass})`));

        // Also try to parse a Forex Balances section in the same CSV
        ibkrForexResult = parseIbkrForexBalances(text);
        if (ibkrForexResult) {
          const cashRows = args.ibkrAccount
            ? ibkrForexResult.balances.filter(b => b.accountId === args.ibkrAccount)
            : ibkrForexResult.balances;
          console.log(`\n  Forex Balances section detected — ${cashRows.length} cash balance(s):`);
          cashRows.forEach(b =>
            console.log(`    ${b.fxCurrency}  ${b.quantity.toLocaleString('en', { minimumFractionDigits: 2 })}${b.value !== null ? `  (base value: ${b.value.toLocaleString('en', { minimumFractionDigits: 2 })})` : ''}`));
        }
      }
    }
  }

  let extracted: unknown = null;
  if (!ttcdResult && !ibkrResult) {
    extracted = await callOllama(args.type, text);
    console.log(`\nOllama response:`);
    console.log(JSON.stringify(extracted, null, 2));
  }

  if (args.dryRun) {
    console.log('\nDRY RUN — skipping API post. Review the extracted data above.');
    return;
  }

  console.log('\nPosting to JAG API …');
  switch (args.type) {
    case 'bank-statement': await handleBankStatement(extracted, args);                                          break;
    case 'loan':           await handleLoan(extracted, args);                                                   break;
    case 'investment':     await handleInvestment(extracted, args, ttcdResult ?? undefined, ibkrResult ?? undefined, ibkrForexResult ?? undefined); break;
    case 'insurance':      await handleInsurance(extracted, args);                                              break;
  }

  console.log('\n✓ Done. File remains on local hard drive.');
  console.log(`========================================\n`);
}

main().catch((e) => {
  console.error('Fatal error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
