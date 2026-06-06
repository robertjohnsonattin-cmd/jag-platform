import type { ParsedStatement, ParsedTransaction } from './types';

export function postProcess(
  raw: Omit<ParsedStatement, 'source_hash' | 'parsed_at'>,
  sourceHash: string
): ParsedStatement {
  return {
    account_reference: maskAccountRef(raw.account_reference),
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

// OPSEC (STD-04): never store full account numbers — keep last 4 digits only
function maskAccountRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const digits = ref.replace(/\D/g, '');
  if (digits.length === 0) return null;
  return `****${digits.slice(-4)}`;
}

function normalizeDate(date: string | null | undefined): string | null {
  if (!date) return null;

  // Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;

  // DD/MM/YYYY or D/M/YYYY
  const dmy = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD-Mon-YYYY or DD-Mon-YY (e.g. 15-Jan-2026, 15-Jan-26)
  const monthNames: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const monMatch = date.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})$/);
  if (monMatch) {
    const [, d, mon, y] = monMatch;
    const month = monthNames[mon.toLowerCase()];
    if (month) {
      const year = y.length === 2 ? `20${y}` : y;
      return `${year}-${month}-${d.padStart(2, '0')}`;
    }
  }

  return date; // return as-is if format unrecognised — LLM may have already normalised
}

function toPositiveNumber(val: unknown): number | null {
  if (val == null) return null;
  const cleaned = typeof val === 'string' ? val.replace(/[$,TTD\s]/g, '') : String(val);
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : Math.abs(n);
}
