import 'dotenv/config';
import { extractText } from './extractText';
import { parseWithLlm } from './parseWithLlm';
import { postProcess } from './postProcess';
import { config } from './config';

async function main(): Promise<void> {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: npm run parse <path-to-statement.pdf|.csv|.txt>');
    console.error('');
    console.error('Output: structured JSON to stdout. Redirect to file:');
    console.error('  npm run parse statement.pdf > parsed.json');
    process.exit(1);
  }

  console.error(`[jag-bank-parser] File: ${filePath}`);

  const extracted = await extractText(filePath);
  console.error(
    `[jag-bank-parser] Format: ${extracted.format} | Pages: ${extracted.pageCount} | ` +
      `Source hash: ${extracted.sourceHash.slice(0, 16)}...`
  );

  let text = extracted.text;
  if (text.length > config.maxTextChars) {
    console.error(
      `[jag-bank-parser] WARNING: Statement text is ${text.length} chars — exceeds MAX_TEXT_CHARS ` +
        `(${config.maxTextChars}). Truncating. Long statements may require chunking for full accuracy.`
    );
    text = text.slice(0, config.maxTextChars);
  }

  console.error(
    `[jag-bank-parser] Calling Ollama: model=${config.ollamaModel} url=${config.ollamaUrl}`
  );
  const raw = await parseWithLlm(text);

  const result = postProcess(raw, extracted.sourceHash);
  console.error(
    `[jag-bank-parser] Done: ${result.transactions.length} transactions | ` +
      `confidence=${result.parsing_confidence} | account=${result.account_reference ?? 'unknown'}`
  );

  // Structured JSON to stdout — pipe to file or Phase 1 reconciliation script
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: Error) => {
  console.error('[jag-bank-parser] Fatal:', err.message);
  process.exit(1);
});
