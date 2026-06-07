import type { ParsedStatement, ParsedTransaction } from './types';

const OLLAMA_URL        = process.env['OLLAMA_URL']            ?? 'http://localhost:11434';
const OLLAMA_MODEL      = process.env['OLLAMA_MODEL']          ?? 'mistral';
const MAX_CHARS         = parseInt(process.env['OLLAMA_MAX_CHARS'] ?? '24000', 10);
const OLLAMA_TIMEOUT_MS = parseInt(process.env['OLLAMA_TIMEOUT_MS'] ?? '120000', 10); // 2 min

const SYSTEM_PROMPT = `You are a financial data extraction assistant for a business platform in Trinidad and Tobago.
Extract all transactions from the bank statement text below and return a single valid JSON object.

Output ONLY the JSON object — no preamble, no explanation, no markdown code fences:
{
  "account_reference": "<last 4 digits of account number only, or null>",
  "bank_name": "<bank name e.g. Republic Bank, First Citizens, Scotiabank, RBC — or null>",
  "statement_period_start": "<YYYY-MM-DD or null>",
  "statement_period_end": "<YYYY-MM-DD or null>",
  "transactions": [
    {
      "date": "<YYYY-MM-DD>",
      "description": "<full transaction description>",
      "reference": "<cheque number, online reference, or null>",
      "debit": <amount as plain number or null>,
      "credit": <amount as plain number or null>,
      "balance": <running balance as plain number or null>,
      "raw_line": "<original line(s) from statement>"
    }
  ],
  "parsing_confidence": "<high|medium|low>"
}

Rules:
- Convert all dates to YYYY-MM-DD (input may be DD/MM/YYYY, DD-Mon-YYYY, or DD-Mon-YY)
- All amounts are plain positive numbers — strip TTD, $, and commas
- debit = money leaving the account; credit = money entering the account
- account_reference: ONLY the last 4 digits — never the full number
- parsing_confidence: high = clean digital PDF, medium = ambiguous formatting, low = poor/scanned
- Include every transaction row — omit none
- Use null for any field that cannot be determined`;

export async function parseWithOllama(
  text: string,
): Promise<Omit<ParsedStatement, 'source_hash' | 'parsed_at'>> {
  const truncated = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
  const prompt = `${SYSTEM_PROMPT}\n\n---\nBANK STATEMENT TEXT:\n${truncated}\n---`;

  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        format: 'json',
        stream: false,
        options: { temperature: 0.1, num_predict: 8192 },
      }),
      signal: controller.signal,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error && e.name === 'AbortError'
      ? `Ollama timed out after ${OLLAMA_TIMEOUT_MS}ms`
      : `Cannot reach Ollama at ${OLLAMA_URL}. Ensure Ollama is running and model is pulled: ollama pull ${OLLAMA_MODEL}`;
    throw new Error(msg);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const result = (await response.json()) as { response: string };
  try {
    return JSON.parse(result.response) as Omit<ParsedStatement, 'source_hash' | 'parsed_at'>;
  } catch {
    throw new Error(`Ollama response was not valid JSON. First 500 chars:\n${result.response.slice(0, 500)}`);
  }
}

export function postProcess(
  raw: Omit<ParsedStatement, 'source_hash' | 'parsed_at'>,
  sourceHash: string,
): ParsedStatement {
  return {
    account_reference: maskRef(raw.account_reference),
    bank_name: raw.bank_name?.trim() ?? null,
    statement_period_start: normalizeDate(raw.statement_period_start),
    statement_period_end: normalizeDate(raw.statement_period_end),
    transactions: (raw.transactions ?? []).map(normalizeTx),
    parsing_confidence: raw.parsing_confidence ?? 'low',
    source_hash: sourceHash,
    parsed_at: new Date().toISOString(),
  };
}

function normalizeTx(tx: ParsedTransaction): ParsedTransaction {
  return {
    date: normalizeDate(tx.date) ?? tx.date,
    description: (tx.description ?? '').trim(),
    reference: tx.reference?.trim() ?? null,
    debit: toPositiveNumber(tx.debit),
    credit: toPositiveNumber(tx.credit),
    balance: toPositiveNumber(tx.balance),
    raw_line: (tx.raw_line ?? '').trim(),
  };
}

// OPSEC: never store full account numbers
function maskRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const digits = ref.replace(/\D/g, '');
  return digits.length > 0 ? `****${digits.slice(-4)}` : null;
}

function normalizeDate(d: string | null | undefined): string | null {
  if (!d) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;

  const dmy = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, day, mon, yr] = dmy;
    return `${yr}-${mon.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const MONTHS: Record<string, string> = {
    jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
    jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
  };
  const monM = d.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})$/);
  if (monM) {
    const [, day, mon, yr] = monM;
    const m = MONTHS[mon.toLowerCase()];
    if (m) return `${yr.length === 2 ? `20${yr}` : yr}-${m}-${day.padStart(2, '0')}`;
  }

  return d;
}

function toPositiveNumber(val: unknown): number | null {
  if (val == null) return null;
  const cleaned = typeof val === 'string' ? val.replace(/[$,TTD\s]/g, '') : String(val);
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : Math.abs(n);
}
