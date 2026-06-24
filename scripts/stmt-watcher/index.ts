/**
 * JAG Statement Watcher — Local Extraction
 *
 * Scans configured local folders for bank statement files (PDF, CSV, TXT).
 * Extracts transactions locally via pdf-parse + Ollama, then POSTs the data
 * directly to the JAG API.  The original file never leaves the laptop.
 *
 * Flow:
 *   Drop file into watch folder
 *   → extract text (pdf-parse for PDF, raw for CSV)
 *   → CSV deterministic parser OR Ollama for unrecognised formats
 *   → POST /api/v1/finance/bank-statements/import
 *   → file moved to Archive/
 *   → failures moved to _failed/ with .error file
 *
 * Config:  watch-config.json   (folder → account_id mappings)
 * Secrets: .env.stmt-watcher   (KC credentials, API URL, Ollama URL)
 */

import * as fs     from 'fs';
import * as path   from 'path';
import * as crypto from 'crypto';

// ── Env ───────────────────────────────────────────────────────────────────────

function loadEnv(): void {
  const envFile = path.resolve(__dirname, '..', '.env.stmt-watcher');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

const KC_URL       = process.env['KC_URL']       ?? 'https://auth.jagcorporate.com';
const KC_REALM     = process.env['KC_REALM']     ?? 'jag';
const KC_CLIENT    = process.env['KC_CLIENT']    ?? 'jag-api';
const KC_SECRET    = process.env['KC_SECRET']    ?? '';
const KC_USERNAME  = process.env['KC_USERNAME']  ?? '';
const KC_PASSWORD  = process.env['KC_PASSWORD']  ?? '';
const API_URL      = process.env['JAG_API_URL']  ?? 'https://api.jagcorporate.com';
const LLM_URL      = process.env['LLM_URL']      ?? 'http://localhost:11434';
const LLM_MODEL    = process.env['LLM_MODEL']    ?? 'llama3.2';
const DRY_RUN      = process.env['DRY_RUN'] === 'true';

// ── Config ────────────────────────────────────────────────────────────────────

interface WatchFolder {
  path:         string;
  account_id:   string;
  account_name: string;
}

interface Config {
  watch_folders: WatchFolder[];
  archive_base:  string;
}

function loadConfig(): Config {
  const cfgFile = path.resolve(__dirname, '..', 'watch-config.json');
  if (!fs.existsSync(cfgFile)) throw new Error(`watch-config.json not found at ${cfgFile}`);
  return JSON.parse(fs.readFileSync(cfgFile, 'utf8')) as Config;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

interface TokenCache { token: string; expiresAt: number; }
let tokenCache: TokenCache | null = null;

async function getToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 30_000) return tokenCache.token;
  const body = new URLSearchParams({
    grant_type: 'password', client_id: KC_CLIENT, client_secret: KC_SECRET,
    username: KC_USERNAME, password: KC_PASSWORD,
  });
  const res = await fetch(`${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  if (!res.ok) throw new Error(`KC token failed: HTTP ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return tokenCache.token;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedTransaction {
  transaction_date:   string;
  amount:             number;
  currency:           string;
  description:        string;
  merchant_name:      string | null;
  reference_number:   string | null;
  suggested_category: string;
  confidence:         number;
}

// ── PDF text extraction ───────────────────────────────────────────────────────

async function extractPdfText(buf: Buffer): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('pdf-parse');
  const fn = (typeof mod === 'function' ? mod : mod?.default) as
    ((b: Buffer) => Promise<{ text: string }>) | null;
  if (!fn) throw new Error('pdf-parse not callable — run npm install in scripts/stmt-watcher');
  const { text } = await fn(buf);
  const trimmed  = text.trim();
  const readable = (trimmed.match(/[a-zA-Z0-9]{3,}/g) ?? []).join('').length;
  if (readable < 100) return null; // image-only PDF
  console.log(`     pdf-parse: ${trimmed.length} chars (${readable} readable) ✓`);
  return trimmed.slice(0, 40_000);
}

// ── Scotia Mastercard deterministic parser ────────────────────────────────────
// Parses the text layer extracted from Scotiabank TT Mastercard e-statements.
// Format (PDF text, no whitespace between fields):
//   DD-Mon-YYYYDD-Mon-YYYY<refNo><description>$<amount>
// Returns null if the text doesn't look like a Scotia statement.

function parseScotiaStatement(text: string): ParsedTransaction[] | null {
  const HEADER = 'TRANSACTION DATEPOSTING DATEREFERENCE NO.TRANSACTION / DESCRIPTIONDEBIT/CREDIT AMOUNT';
  if (!text.includes(HEADER)) return null;

  const MON    = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
  const DATE   = `\\d{2}-(?:${MON})-\\d{4}`;
  // Two dates + ref number (7–13 digits) + description (may wrap lines, no $) + $amount
  const ROW_RE = new RegExp(
    `(${DATE})(${DATE})(\\d{7,13})([\\s\\S]+?)\\$(-?[\\d,]+\\.\\d{2})`,
    'g',
  );

  const txns: ParsedTransaction[] = [];
  let m: RegExpExecArray | null;

  while ((m = ROW_RE.exec(text)) !== null) {
    const [, txDate, , refNo, rawDesc, rawAmt] = m;
    const amount = parseFloat(rawAmt.replace(/,/g, ''));
    // Collapse multi-line descriptions into a single clean string
    const desc   = rawDesc.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    txns.push({
      transaction_date:   parseDateTT(txDate) ?? txDate,
      // PDF sign: positive = debit/purchase, negative = credit/payment
      // Store debits as negative (money out), credits as positive (money in)
      amount:             -amount,
      currency:           'TTD',
      description:        desc,
      merchant_name:      desc.split(',')[0].trim() || null,
      reference_number:   refNo,
      suggested_category: 'UNCLASSIFIED',
      confidence:         1.0,
    });
  }

  return txns.length > 0 ? txns : null;
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseDateTT(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  const MON: Record<string,string> = {
    jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
    jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
  };
  const dMonY = s.match(/^(\d{1,2})[\/\- ]([A-Za-z]{3})[\/\- ](\d{4})$/);
  if (dMonY) { const m = MON[dMonY[2].toLowerCase()]; if (m) return `${dMonY[3]}-${m}-${dMonY[1].padStart(2,'0')}`; }
  const monDY = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monDY) { const m = MON[monDY[1].toLowerCase()]; if (m) return `${monDY[3]}-${m}-${monDY[2].padStart(2,'0')}`; }
  return null;
}

function parseAmountStr(raw: string): number {
  if (!raw?.trim()) return 0;
  let s = raw.trim();
  const neg = (s.startsWith('(') && s.endsWith(')')) || s.startsWith('-');
  s = s.replace(/[()$£€\s]/g,'').replace(/,/g,'').replace(/^-/,'');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : (neg && n > 0 ? -n : n);
}

function parseCsvRaw(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i+1] === '"') { cell += '"'; i++; } else { inQ = !inQ; }
    } else if (ch === ',' && !inQ) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !inQ) {
      if (ch === '\r' && text[i+1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim())) rows.push(row);
      row = [];
    } else { cell += ch; }
  }
  if (cell || row.length) { row.push(cell); if (row.some(c => c.trim())) rows.push(row); }
  return rows;
}

function parseCsvStatement(text: string): ParsedTransaction[] | null {
  const rows = parseCsvRaw(text);
  if (rows.length < 2) return null;

  let headerIdx = -1; let hdr: string[] = [];
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const cells = rows[i];
    if (cells.filter(c => c.trim()).length >= 3 && cells.join(' ').toLowerCase().includes('date')) {
      headerIdx = i; hdr = cells; break;
    }
  }
  if (headerIdx < 0) return null;

  const h = hdr.map(c => c.toLowerCase().replace(/[^a-z0-9]/g,''));
  const find = (...terms: string[]): number => {
    for (const t of terms) { const i = h.findIndex(c => c.includes(t)); if (i >= 0) return i; }
    return -1;
  };

  const dateIdx  = find('date','transdate','txndate','valuedate','postdate','postingdate');
  const descIdx  = find('description','narration','particulars','narrative','details','memo','remarks');
  const debitIdx = find('debit','withdrawal','withdraw','dr','payment','charge');
  const creditIdx= find('credit','deposit','cr','receipt');
  const amtIdx   = find('amount','transactionamount','txnamount','value','net');
  const refIdx   = find('reference','refno','refnumber','chequenumber','cheque','check');
  const mchIdx   = find('merchant','payee','beneficiary','counterparty');

  if (dateIdx < 0 || descIdx < 0) return null;
  if (debitIdx < 0 && creditIdx < 0 && amtIdx < 0) return null;

  const txns: ParsedTransaction[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const dateStr = parseDateTT(row[dateIdx]?.trim() ?? '');
    if (!dateStr) continue;
    const amount = amtIdx >= 0
      ? parseAmountStr(row[amtIdx] ?? '')
      : Math.abs(parseAmountStr(row[creditIdx!] ?? '')) - Math.abs(parseAmountStr(row[debitIdx!] ?? ''));
    const description = (row[descIdx] ?? '').trim();
    if (!description && amount === 0) continue;
    txns.push({
      transaction_date:   dateStr, amount, currency: 'TTD', description,
      merchant_name:      mchIdx >= 0 ? ((row[mchIdx] ?? '').trim() || null) : null,
      reference_number:   refIdx  >= 0 ? ((row[refIdx!] ?? '').trim() || null) : null,
      suggested_category: 'UNCLASSIFIED', confidence: 0.85,
    });
  }
  return txns.length > 0 ? txns : null;
}

// ── Ollama extraction ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a financial data extraction assistant for a Caribbean family office.
Extract all bank transactions from the statement text provided and return them as a JSON array.

Each transaction object must have:
  transaction_date   string  YYYY-MM-DD
  amount             number  positive=credit, negative=debit (in the statement currency)
  currency           string  ISO 4217 (e.g. TTD, USD)
  description        string  raw description from statement
  merchant_name      string|null  cleaned merchant/payee name, null if unknown
  reference_number   string|null  cheque number, ref code, or null
  suggested_category string  one of: SALARY, DIVIDEND, RENTAL_INCOME, INTEREST_INCOME,
                             TRANSFER_IN, OPERATING_EXPENSE, PAYROLL, TAX_PAYMENT,
                             LOAN_REPAYMENT, INVESTMENT_PURCHASE, INVESTMENT_SALE,
                             TRANSFER_OUT, PERSONAL_EXPENSE, UTILITIES, INSURANCE,
                             ENTERTAINMENT, TRAVEL, MEDICAL, EDUCATION, CHARITY, UNCLASSIFIED
  confidence         number  0.0–1.0

Return ONLY the JSON array with no markdown fences, no commentary, no extra text.
If no transactions are found return an empty array [].`;

// Extract all complete JSON objects from a potentially truncated/prefixed response.
// Handles: prose before the array, truncated arrays (Ollama hit token limit),
// and markdown fences.
function extractJsonObjects(raw: string): Record<string, unknown>[] {
  // Strip markdown fences, then find first '['
  let s = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  const start = s.indexOf('[');
  if (start >= 0) s = s.slice(start);

  // Fast path — well-formed response
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr as Record<string, unknown>[];
  } catch { /* fall through to depth scanner */ }

  // Slow path — truncated response: collect every complete {...} object
  const objs: Record<string, unknown>[] = [];
  let depth = 0, objStart = -1, inStr = false, escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape)              { escape = false; continue; }
    if (ch === '\\' && inStr){ escape = true;  continue; }
    if (ch === '"')          { inStr = !inStr;  continue; }
    if (inStr) continue;
    if (ch === '{') { if (depth++ === 0) objStart = i; }
    else if (ch === '}') {
      if (--depth === 0 && objStart >= 0) {
        try { objs.push(JSON.parse(s.slice(objStart, i + 1)) as Record<string, unknown>); } catch { /* skip malformed */ }
        objStart = -1;
      }
    }
  }
  return objs;
}

// Strip trailing dollar-amount artifacts from PDF text layout.
// e.g. "N.MAHARAJ SERV, CORNER PUNDIT$218.99" → "N.MAHARAJ SERV, CORNER PUNDIT"
function cleanDescription(desc: string): string {
  return desc.replace(/\$-?[\d,]+\.?\d*$/, '').trim();
}

const VALID_CATEGORIES = new Set([
  'SALARY','DIVIDEND','RENTAL_INCOME','INTEREST_INCOME','TRANSFER_IN',
  'OPERATING_EXPENSE','PAYROLL','TAX_PAYMENT','LOAN_REPAYMENT',
  'INVESTMENT_PURCHASE','INVESTMENT_SALE','TRANSFER_OUT','PERSONAL_EXPENSE',
  'UTILITIES','INSURANCE','ENTERTAINMENT','TRAVEL','MEDICAL','EDUCATION',
  'CHARITY','UNCLASSIFIED',
]);

function normalizeCategory(raw: string): string {
  const upper = raw.toUpperCase().trim();
  return VALID_CATEGORIES.has(upper) ? upper : 'UNCLASSIFIED';
}

async function extractWithOllama(text: string): Promise<ParsedTransaction[]> {
  // OpenAI-compatible chat completions — works with both LM Studio and Ollama (v0.1.24+)
  // Retry up to 3 times with exponential backoff (LM Studio can drop connection under memory pressure)
  let lastErr: Error = new Error('unreachable');
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const waitMs = attempt * 8_000;
      console.log(`     Retry ${attempt}/2 — waiting ${waitMs / 1000}s …`);
      await new Promise(r => setTimeout(r, waitMs));
    }
    try {
      const res = await fetch(`${LLM_URL}/v1/chat/completions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          model:       LLM_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user',   content: `---STATEMENT---\n${text.slice(0, 30_000)}` },
          ],
          temperature: 0.1,
          max_tokens:  8192,
          stream:      false,
        }),
        signal: AbortSignal.timeout(600_000),
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${await res.text()}`);

      const body = await res.json() as { choices: { message: { content: string } }[] };
      const raw  = body.choices?.[0]?.message?.content ?? '';
      const objs = extractJsonObjects(raw);
      if (!objs.length) throw new Error(`No JSON objects found in LLM response: ${raw.slice(0, 200)}`);

      return objs
        .filter(r => r['transaction_date'] && typeof r['amount'] === 'number')
        .map(r => {
          const rawDate = String(r['transaction_date']);
          const date    = parseDateTT(rawDate) ?? rawDate;
          const desc    = cleanDescription(String(r['description'] ?? ''));
          return {
            transaction_date:   date,
            amount:             Number(r['amount']),
            currency:           String(r['currency'] ?? 'TTD'),
            description:        desc,
            merchant_name:      r['merchant_name'] ? String(r['merchant_name']) : null,
            reference_number:   r['reference_number'] ? String(r['reference_number']) : null,
            suggested_category: normalizeCategory(String(r['suggested_category'] ?? '')),
            confidence:         Number(r['confidence'] ?? 0.5),
          };
        });
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr;
}

// ── API import ────────────────────────────────────────────────────────────────

async function importTransactions(
  accountId: string,
  fileHash:  string,
  txns:      ParsedTransaction[],
): Promise<{ imported: number; skipped: number }> {
  const token = await getToken();

  const payload = {
    transactions: txns.map(tx => ({
      account_id:         accountId,
      transaction_date:   tx.transaction_date,
      amount:             tx.amount,
      currency:           tx.currency,
      description:        tx.description,
      merchant_name:      tx.merchant_name,
      reference_number:   tx.reference_number,
      suggested_category: tx.suggested_category,
      confidence:         tx.confidence,
      // Idempotency key — re-running on the same file won't double-import
      idempotency_key: crypto
        .createHash('sha256')
        .update(`local:${accountId}:${fileHash}:${tx.transaction_date}:${tx.amount}:${tx.description.slice(0, 50)}`)
        .digest('hex')
        .slice(0, 64),
    })),
  };

  const res = await fetch(`${API_URL}/api/v1/finance/bank-statements/import`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Import API HTTP ${res.status}: ${await res.text()}`);

  const result = (await res.json()) as { data: { imported: number; skipped: number } };
  return result.data;
}

// ── File helpers ──────────────────────────────────────────────────────────────

const ALLOWED_EXT = new Set(['.pdf', '.csv', '.txt']);

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(n => ALLOWED_EXT.has(path.extname(n).toLowerCase()) && fs.statSync(path.join(dir, n)).isFile())
    .map(n => path.join(dir, n));
}

function archiveDest(cfg: Config, folder: WatchFolder, fileName: string): string {
  const now  = new Date();
  const ym   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const safe = folder.account_name.replace(/[/\\:*?"<>|]/g, '_');
  return path.join(cfg.archive_base, safe, ym, fileName);
}

function moveToArchive(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
}

function moveToFailed(filePath: string, error: Error): void {
  const dir = path.join(path.dirname(filePath), '_failed');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(filePath));
  try { fs.renameSync(filePath, dest); } catch { /* already moved */ }
  fs.writeFileSync(dest + '.error', `${new Date().toISOString()}\n${error.message}\n`);
}

// ── Per-file processor ────────────────────────────────────────────────────────

async function processFile(filePath: string, folder: WatchFolder, cfg: Config): Promise<void> {
  const fileName = path.basename(filePath);
  const ext      = path.extname(fileName).toLowerCase();
  console.log(`  → ${fileName}`);

  // Read file and compute hash for idempotency keys
  const buf      = fs.readFileSync(filePath);
  const fileHash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

  // ── Extract transactions ────────────────────────────────────────────────────
  let txns: ParsedTransaction[];

  if (ext === '.csv' || ext === '.txt') {
    const text    = buf.toString('utf8');
    const csvTxns = parseCsvStatement(text);
    if (csvTxns) {
      console.log(`     CSV parser: ${csvTxns.length} transactions (deterministic)`);
      txns = csvTxns;
    } else {
      console.log(`     CSV unrecognised format — calling LLM (${LLM_MODEL}) …`);
      txns = await extractWithOllama(text);
      console.log(`     Ollama: ${txns.length} transactions`);
    }
  } else {
    // PDF
    const text = await extractPdfText(buf);
    if (!text) {
      throw new Error(
        'Image-only (scanned) PDF — no text layer found. ' +
        'Download the digital e-statement from your bank portal, or export as CSV.',
      );
    }
    const scotiaResult = parseScotiaStatement(text);
    if (scotiaResult) {
      console.log(`     Scotia parser: ${scotiaResult.length} transactions (deterministic)`);
      txns = scotiaResult;
    } else {
      console.log(`     Calling LLM (${LLM_MODEL}) …`);
      txns = await extractWithOllama(text);
      console.log(`     LLM: ${txns.length} transactions`);
    }
  }

  if (!txns.length) throw new Error('No transactions extracted.');

  // ── Submit to API ───────────────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log(`     DRY RUN — ${txns.length} transactions ready, not submitting`);
    console.log(`     Sample:`, JSON.stringify(txns.slice(0, 2), null, 2));
    return;
  }

  const { imported, skipped } = await importTransactions(folder.account_id, fileHash, txns);
  console.log(`     ✓  imported ${imported}  skipped ${skipped}`);

  // ── Archive file ────────────────────────────────────────────────────────────
  const dest = archiveDest(cfg, folder, fileName);
  moveToArchive(filePath, dest);
  console.log(`     archived → ${dest}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n========================================`);
  console.log(`JAG Statement Watcher  ${new Date().toISOString()}`);
  console.log(`DryRun: ${DRY_RUN}`);
  console.log(`========================================`);

  const cfg     = loadConfig();
  let totalOk   = 0;
  let totalFail = 0;

  for (const folder of cfg.watch_folders) {
    const files = listFiles(folder.path);
    if (!files.length) { console.log(`\n[${folder.account_name}]  no new files`); continue; }
    console.log(`\n[${folder.account_name}]  ${files.length} file(s)`);

    for (const filePath of files) {
      try {
        await processFile(filePath, folder, cfg);
        totalOk++;
      } catch (e) {
        console.error(`     ✗  ${(e as Error).message}`);
        if (!DRY_RUN) moveToFailed(filePath, e as Error);
        totalFail++;
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`Done.  Processed: ${totalOk}  Failed: ${totalFail}`);
  console.log(`========================================\n`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
