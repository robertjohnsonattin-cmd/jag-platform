import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';

export interface ExtractResult {
  text: string;
  sourceHash: string;
  pageCount: number;
  format: 'pdf' | 'csv' | 'txt';
}

export async function extractText(filePath: string): Promise<ExtractResult> {
  const ext = path.extname(filePath).toLowerCase();
  const fileBytes = await readFile(filePath);
  const sourceHash = createHash('sha256').update(fileBytes).digest('hex');

  if (ext === '.pdf') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (
      buf: Buffer,
    ) => Promise<{ text: string; numpages: number }>;
    const data = await pdfParse(fileBytes);
    return { text: data.text, sourceHash, pageCount: data.numpages, format: 'pdf' };
  }

  const text = fileBytes.toString('utf8');
  const format = ext === '.csv' ? 'csv' : 'txt';
  return { text, sourceHash, pageCount: 1, format };
}
