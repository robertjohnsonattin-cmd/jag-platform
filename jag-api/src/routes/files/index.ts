// File storage proxy — upload, download, delete via MinIO.
//
// POST   /api/v1/files/upload            — upload a file, get back { key, bucket, ... }
// GET    /api/v1/files/download          — proxy-download a file (?bucket=&key=)
// DELETE /api/v1/files                   — delete a stored file

import path from 'path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import {
  minioClient, ensureBucket, mediaObjectKey,
  getObjectStream, getObjectStat, deleteObject,
  BUCKET_RECEIPTS, BUCKET_DOCUMENTS, BUCKET_PHOTOS,
  ALL_BUCKETS,
} from '../../lib/minio';

export const filesRouter = Router();
filesRouter.use(requireAuth());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'application/pdf',
      'text/csv', 'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword', 'application/vnd.ms-excel',
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

// Map bucket name → allowed content type category for validation
const BUCKET_ALLOWED: Record<string, string[]> = {
  [BUCKET_PHOTOS]:    ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  [BUCKET_RECEIPTS]:  ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  [BUCKET_DOCUMENTS]: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword', 'application/vnd.ms-excel',
    'image/jpeg', 'image/png', 'image/webp',
    'text/csv', 'text/plain',
  ],
};

// Validates the key belongs to the requesting owner.
// All JAG object keys follow owners/{ownerId}/... — enforced at write time.
function ownsKey(ownerId: string, key: string): boolean {
  return key.startsWith(`owners/${ownerId}/`);
}

// ── POST /files/upload ────────────────────────────────────────────────────────

const UploadBodySchema = z.object({
  bucket:    z.enum(ALL_BUCKETS as unknown as [string, ...string[]]),
  module:    z.string().min(1).max(50),
  entity_id: z.string().uuid(),
}).strict();

filesRouter.post(
  '/upload',
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        err(res, 422, 'NO_FILE', 'No file attached. Use field name "file".');
        return;
      }

      const parsed = UploadBodySchema.safeParse(req.body);
      if (!parsed.success) {
        err(res, 422, 'VALIDATION_ERROR', 'bucket, module, and entity_id are required.');
        return;
      }

      const { bucket, module, entity_id } = parsed.data;
      const { ownerId } = req.rlsCtx;
      const mime = req.file.mimetype;

      // Validate content type is appropriate for the target bucket
      const allowed = BUCKET_ALLOWED[bucket] ?? [];
      if (allowed.length > 0 && !allowed.includes(mime)) {
        err(res, 422, 'UNSUPPORTED_FILE_TYPE', `File type ${mime} is not allowed in bucket ${bucket}.`);
        return;
      }

      const key = mediaObjectKey(ownerId, module, entity_id, req.file.originalname);

      await ensureBucket(bucket);
      await minioClient.putObject(
        bucket,
        key,
        req.file.buffer,
        req.file.size,
        { 'Content-Type': mime },
      );

      logger.info({ entity: 'FILES', action: 'UPLOADED', user_id: ownerId, bucket, key, size: req.file.size, module });

      ok(res, {
        key,
        bucket,
        original_name: req.file.originalname,
        size: req.file.size,
        content_type: mime,
      }, 201);
    } catch (e) { next(e); }
  },
);

// ── GET /files/download ───────────────────────────────────────────────────────
// Proxy-downloads a file from MinIO after verifying ownership.
// The response streams directly — no buffering in memory.

const DownloadQuerySchema = z.object({
  bucket: z.string().min(1),
  key:    z.string().min(1),
});

filesRouter.get('/download', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = DownloadQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      err(res, 422, 'VALIDATION_ERROR', 'bucket and key query params are required.');
      return;
    }

    const { bucket, key } = parsed.data;
    const { ownerId } = req.rlsCtx;

    if (!ownsKey(ownerId, key)) {
      err(res, 403, 'FORBIDDEN', 'You do not have access to this file.');
      return;
    }

    if (!ALL_BUCKETS.includes(bucket as typeof ALL_BUCKETS[number])) {
      err(res, 400, 'INVALID_BUCKET', 'Unknown bucket.');
      return;
    }

    // Get metadata first for Content-Type and Content-Length headers
    let stat: { size: number; contentType: string };
    try {
      stat = await getObjectStat(bucket, key);
    } catch {
      err(res, 404, 'FILE_NOT_FOUND', 'File not found.');
      return;
    }

    const filename = path.basename(key).replace(/^\d+_/, ''); // strip timestamp prefix
    const disposition = stat.contentType.startsWith('image/') ? 'inline' : 'attachment';

    res.setHeader('Content-Type', stat.contentType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=300'); // 5-min browser cache

    const stream = await getObjectStream(bucket, key);
    stream.on('error', (e) => {
      logger.error({ entity: 'FILES', action: 'STREAM_ERROR', key, error: (e as Error).message });
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);

    logger.info({ entity: 'FILES', action: 'DOWNLOADED', user_id: ownerId, bucket, key });
  } catch (e) { next(e); }
});

// ── DELETE /files ─────────────────────────────────────────────────────────────

const DeleteBodySchema = z.object({
  bucket: z.string().min(1),
  key:    z.string().min(1),
}).strict();

filesRouter.delete('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = DeleteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      err(res, 422, 'VALIDATION_ERROR', 'bucket and key are required.');
      return;
    }

    const { bucket, key } = parsed.data;
    const { ownerId } = req.rlsCtx;

    if (!ownsKey(ownerId, key)) {
      err(res, 403, 'FORBIDDEN', 'You do not have access to this file.');
      return;
    }

    if (!ALL_BUCKETS.includes(bucket as typeof ALL_BUCKETS[number])) {
      err(res, 400, 'INVALID_BUCKET', 'Unknown bucket.');
      return;
    }

    await deleteObject(bucket, key);
    ok(res, { deleted: true, key });
  } catch (e) { next(e); }
});
