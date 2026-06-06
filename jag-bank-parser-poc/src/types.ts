export interface ParsedTransaction {
  date: string;             // ISO date YYYY-MM-DD
  description: string;
  reference: string | null; // cheque number, online reference, etc.
  debit: number | null;     // money out (positive)
  credit: number | null;    // money in (positive)
  balance: number | null;   // running balance after transaction
  raw_line: string;         // original text from statement for audit
}

export interface ParsedStatement {
  account_reference: string | null;    // last 4 digits only — OPSEC (STD-04)
  bank_name: string | null;
  statement_period_start: string | null; // YYYY-MM-DD
  statement_period_end: string | null;   // YYYY-MM-DD
  transactions: ParsedTransaction[];
  parsing_confidence: 'high' | 'medium' | 'low';
  source_hash: string;  // SHA-256 of raw source bytes — use for deduplication
  parsed_at: string;    // ISO timestamp
}

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  format: 'json';
  stream: false;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
}

export interface OllamaGenerateResponse {
  response: string;
  done: boolean;
}
