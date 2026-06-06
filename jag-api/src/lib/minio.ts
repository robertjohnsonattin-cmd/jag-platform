// MinIO client singleton + bucket bootstrap.
//
// Usage:
//   import { minioClient, BUCKET_STATEMENTS } from '../lib/minio';
//   await minioClient.putObject(BUCKET_STATEMENTS, objectKey, buffer, size, { 'Content-Type': mime });
//
// Bucket is created on first use if it does not already exist (idempotent).

import { Client as MinioClient } from 'minio';
import { logger } from './logger';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const BUCKET_STATEMENTS = process.env['MINIO_BUCKET_STATEMENTS'] ?? 'jag-bank-statements';

export const minioClient = new MinioClient({
  endPoint:  requireEnv('MINIO_ENDPOINT'),
  port:      parseInt(process.env['MINIO_PORT'] ?? '9000', 10),
  useSSL:    process.env['MINIO_USE_SSL'] === 'true',
  accessKey: requireEnv('MINIO_ACCESS_KEY'),
  secretKey: requireEnv('MINIO_SECRET_KEY'),
});

// Ensures a bucket exists. Called once per upload to handle cold-start gracefully.
// MinIO makeBucket is idempotent — safe to call repeatedly.
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

// Build a deterministic object key: owners/{ownerId}/statements/{year}/{month}/{ts}_{filename}
export function statementObjectKey(ownerId: string, originalName: string): string {
  const now  = new Date();
  const year  = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ts    = now.getTime();
  const safe  = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `owners/${ownerId}/statements/${year}/${month}/${ts}_${safe}`;
}
