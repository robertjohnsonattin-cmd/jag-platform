import { createHash } from 'crypto';
import { readFile, stat } from 'fs/promises';
import path from 'path';

export interface ExtractResult {
  text: string;
  sourceHash: string;
  pageCount: number;
  format: 'pdf' | 'csv' | 'txt';
}

// Absolute directory all statement files must reside in.
// Prevents path traversal: filePath must be under this prefix.
const UPLOADS_ROOT = path.resolve(process.env['UPLOADS_DIR'] ?? path.join(process.cwd(), 'uploads'));
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB — matches multer limit

export async function extractText(filePath: string): Promise<ExtractResult> {
  // Guard against path traversal (e.g. ../../etc/passwd)
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(UPLOADS_ROOT + path.sep) && resolved !== UPLOADS_ROOT) {
    throw new Error(`File path outside allowed directory: ${filePath}`);
  }

  // Enforce size limit before reading entire file into memory
  const { size } = await stat(resolved);
  if (size > MAX_FILE_BYTES) {
    throw new Error(`File too large: ${size} bytes (max ${MAX_FILE_BYTES})`);
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!['.pdf', '.csv', '.txt'].includes(ext)) {
    throw new Error(`Unsupported file extension: ${ext}`);
  }

  const fileBytes = await readFile(resolved);
  const sourceHash = createHash('sha256').update(fileBytes).digest('hex');

  if (ext === '.pdf') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (
      buf: Buffer,
    ) => Promise<{ text: string; numpages: number }>;
    try {
      const data = await pdfParse(fileBytes);
      return { text: data.text, sourceHash, pageCount: data.numpages, format: 'pdf' };
    } catch (e: unknown) {
      throw new Error(`PDF parsing failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const text = fileBytes.toString('utf8');
  const format = ext === '.csv' ? 'csv' : 'txt';
  return { text, sourceHash, pageCount: 1, format };
}
