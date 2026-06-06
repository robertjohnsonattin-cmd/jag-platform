import { config } from './config';
import type { OllamaGenerateRequest, OllamaGenerateResponse, ParsedStatement } from './types';

const SYSTEM_PROMPT = `You are a financial data extraction assistant for a property management system in Trinidad and Tobago.
Extract all transactions from the bank statement text below and return a single valid JSON object.

Output ONLY the JSON object — no preamble, no explanation, no markdown code fences:
{
  "account_reference": "<last 4 digits of account number only, or null>",
  "bank_name": "<bank name, e.g. Republic Bank, First Citizens, Scotiabank, RBC — or null>",
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
- Convert all dates to YYYY-MM-DD format (input may be DD/MM/YYYY, DD-Mon-YYYY, or DD-Mon-YY)
- All amounts are plain numbers — strip TTD symbol, dollar signs, and commas — always positive
- debit = money leaving the account; credit = money entering the account
- account_reference: ONLY the last 4 digits of any account number — never the full number
- parsing_confidence: high = clean digital PDF, medium = ambiguous formatting, low = poor quality or scanned image
- Omit no transactions — include every row from the statement body
- If a field cannot be determined, use null`;

export async function parseWithLlm(
  statementText: string
): Promise<Omit<ParsedStatement, 'source_hash' | 'parsed_at'>> {
  const prompt = `${SYSTEM_PROMPT}\n\n---\nBANK STATEMENT TEXT:\n${statementText}\n---`;

  const body: OllamaGenerateRequest = {
    model: config.ollamaModel,
    prompt,
    format: 'json',
    stream: false,
    options: {
      temperature: 0.1,  // low for deterministic extraction
      num_predict: 8192,
    },
  };

  let response: Response;
  try {
    response = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      `Cannot reach Ollama at ${config.ollamaUrl}. ` +
        `Make sure Ollama is running (ollama serve) and the model is pulled (ollama pull ${config.ollamaModel}).`
    );
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const result = (await response.json()) as OllamaGenerateResponse;

  let parsed: Omit<ParsedStatement, 'source_hash' | 'parsed_at'>;
  try {
    parsed = JSON.parse(result.response) as typeof parsed;
  } catch {
    throw new Error(
      `Ollama response was not valid JSON. First 500 chars:\n${result.response.slice(0, 500)}`
    );
  }

  return parsed;
}
