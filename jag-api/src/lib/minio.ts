// MinIO client singleton + bucket bootstrap.
//
// Usage:
//   import { minioClient, BUCKET_RECEIPTS, ensureBucket, mediaObjectKey } from '../lib/minio';
//   await ensureBucket(BUCKET_RECEIPTS);
//   const key = mediaObjectKey(ownerId, 'expenses', expenseId, file.originalname);
//   await minioClient.putObject(BUCKET_RECEIPTS, key, buffer, size, { 'Content-Type': mime });

import { Client as MinioClient } from 'minio';
import type { Readable } from 'stream';
import { logger } from './logger';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

// ── Bucket names ──────────────────────────────────────────────────────────────
export const BUCKET_STATEMENTS = process.env['MINIO_BUCKET_STATEMENTS'] ?? 'jag-bank-statements';
export const BUCKET_RECEIPTS   = process.env['MINIO_BUCKET_RECEIPTS']   ?? 'jag-receipts';
export const BUCKET_DOCUMENTS  = process.env['MINIO_BUCKET_DOCUMENTS']  ?? 'jag-documents';
export const BUCKET_PHOTOS     = process.env['MINIO_BUCKET_PHOTOS']     ?? 'jag-photos';

export const ALL_BUCKETS = [BUCKET_STATEMENTS, BUCKET_RECEIPTS, BUCKET_DOCUMENTS, BUCKET_PHOTOS] as const;
export type KnownBucket = typeof ALL_BUCKETS[number];

export const minioClient = new MinioClient({
  endPoint:  requireEnv('MINIO_ENDPOINT'),
  port:      parseInt(process.env['MINIO_PORT'] ?? '9000', 10),
  useSSL:    process.env['MINIO_USE_SSL'] === 'true',
  accessKey: requireEnv('MINIO_ACCESS_KEY'),
  secretKey: requireEnv('MINIO_SECRET_KEY'),
});

// ── Bucket bootstrap ──────────────────────────────────────────────────────────
// ensureBucket is idempotent — safe to call on every upload. Results are cached
// per process so only the first call per bucket hits MinIO.
const ensuredBuckets = new Set<string>();

export async function ensureBucket(bucket: string): Promise<void> {
  if (ensuredBuckets.has(bucket)) return;
  try {
    const exists = await minioClient.bucketExists(bucket);
    if (!exists) {
      await minioClient.makeBucket(bucket, 'us-east-1');
      logger.info({ entity: 'MINIO', action: 'BUCKET_CREATED', bucket });
    }
    ensuredBuckets.add(bucket);
  } catch (e) {
    logger.error({ entity: 'MINIO', action: 'BUCKET_ENSURE_FAILED', bucket, error: (e as Error).message });
    throw e;
  }
}

// ── Object key builders ───────────────────────────────────────────────────────

// Generic key: owners/{ownerId}/{module}/{entityId}/{ts}_{safeFilename}
// All object keys are scoped under owners/{ownerId}/ — enforced on download.
export function mediaObjectKey(ownerId: string, module: string, entityId: string, filename: string): string {
  const ts   = Date.now();
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `owners/${ownerId}/${module}/${entityId}/${ts}_${safe}`;
}

// Legacy key builder kept for bank-statements (existing stored keys use this format).
export function statementObjectKey(ownerId: string, originalName: string): string {
  const now   = new Date();
  const year  = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ts    = now.getTime();
  const safe  = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `owners/${ownerId}/statements/${year}/${month}/${ts}_${safe}`;
}

// ── Object helpers ────────────────────────────────────────────────────────────

export async function getObjectStream(bucket: string, key: string): Promise<Readable> {
  return minioClient.getObject(bucket, key);
}

export async function getObjectStat(bucket: string, key: string): Promise<{ size: number; contentType: string }> {
  const stat = await minioClient.statObject(bucket, key);
  return {
    size: stat.size,
    contentType: (stat.metaData as Record<string, string>)['content-type'] ?? 'application/octet-stream',
  };
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  try {
    await minioClient.removeObject(bucket, key);
    logger.info({ entity: 'MINIO', action: 'OBJECT_DELETED', bucket, key });
  } catch (e) {
    logger.error({ entity: 'MINIO', action: 'OBJECT_DELETE_FAILED', bucket, key, error: (e as Error).message });
    throw e;
  }
}
