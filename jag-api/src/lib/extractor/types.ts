export interface ParsedTransaction {
  date: string;             // YYYY-MM-DD
  description: string;
  reference: string | null;
  debit: number | null;     // money out (positive number)
  credit: number | null;    // money in (positive number)
  balance: number | null;
  raw_line: string;
}

export interface ParsedStatement {
  account_reference: string | null;       // last 4 digits only — OPSEC
  bank_name: string | null;
  statement_period_start: string | null;  // YYYY-MM-DD
  statement_period_end: string | null;    // YYYY-MM-DD
  transactions: ParsedTransaction[];
  parsing_confidence: 'high' | 'medium' | 'low';
  source_hash: string;                    // SHA-256 of raw file bytes — deduplication
  parsed_at: string;
}
