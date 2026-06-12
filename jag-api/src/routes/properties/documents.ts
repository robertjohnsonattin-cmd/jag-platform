// GET    /api/v1/properties/:propertyId/documents
// POST   /api/v1/properties/:propertyId/documents
// DELETE /api/v1/properties/:propertyId/documents/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { deleteObject, BUCKET_DOCUMENTS } from '../../lib/minio';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const documentsRouter = Router({ mergeParams: true });

const PropertyParam = z.object({ propertyId: z.string().uuid() });
const RecordParam   = z.object({ propertyId: z.string().uuid(), id: z.string().uuid() });

const DocTypeEnum = z.enum([
  'TITLE_DEED', 'TENANCY_AGREEMENT', 'INSURANCE_CERTIFICATE',
  'INSPECTION_REPORT', 'PERMIT', 'INVOICE', 'OTHER',
]);

const CreateDocSchema = z.object({
  label:           z.string().min(1).max(300),
  document_type:   DocTypeEnum.default('OTHER'),
  minio_object_key: z.string().min(1),
  file_name:       z.string().min(1).max(500),
  file_size_bytes: z.number().int().positive().optional(),
  mime_type:       z.string().max(100).optional(),
  lease_id:        z.string().uuid().optional(),
  notes:           z.string().max(2000).optional(),
}).strict();

// ── GET ───────────────────────────────────────────────────────────────────────

documentsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PropertyParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, label, document_type, minio_object_key, file_name,
                  file_size_bytes, mime_type, lease_id, notes, created_at
           FROM   prop_documents
           WHERE  property_id = $1
           ORDER  BY created_at DESC`,
          [parsed.data.propertyId],
        ).then(r => r.rows),
      );
      logger.info({ entity: 'PROPERTIES', action: 'DOCUMENTS_LIST', user_id: req.rlsCtx.userId, count: rows.length });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST ──────────────────────────────────────────────────────────────────────

documentsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = PropertyParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const bodyParsed = CreateDocSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const b = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;
    const { propertyId } = paramParsed.data;

    const client = await propertiesPool.connect();
    try {
      const doc = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const prop = await c.query(`SELECT id FROM prop_properties WHERE id = $1 AND is_active = true`, [propertyId]);
        if (prop.rows.length === 0) throw Object.assign(new Error('Property not found.'), { status: 404, code: 'PROPERTY_NOT_FOUND' });

        const result = await c.query(
          `INSERT INTO prop_documents
             (owner_id, property_id, lease_id, document_type, label,
              minio_object_key, file_name, file_size_bytes, mime_type, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            ownerId, propertyId, b.lease_id ?? null, b.document_type, b.label,
            b.minio_object_key, b.file_name, b.file_size_bytes ?? null,
            b.mime_type ?? null, b.notes ?? null,
          ],
        );
        return result.rows[0];
      });

      logger.info({ entity: 'PROPERTIES', action: 'DOCUMENT_CREATED', user_id: ownerId, record_id: doc.id });
      ok(res, doc, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE ────────────────────────────────────────────────────────────────────

documentsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = RecordParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid path parameters.'); return; }

    const { propertyId, id } = parsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const deleted = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const doc = await c.query(
          `DELETE FROM prop_documents WHERE id = $1 AND property_id = $2 RETURNING minio_object_key`,
          [id, propertyId],
        );
        return doc.rows[0] ?? null;
      });

      if (!deleted) { err(res, 404, 'DOCUMENT_NOT_FOUND', 'Document not found.'); return; }

      // Delete the MinIO object — best-effort; don't fail the request if storage deletion fails
      try {
        await deleteObject(BUCKET_DOCUMENTS, deleted.minio_object_key);
      } catch (e) {
        logger.warn({ entity: 'PROPERTIES', action: 'DOCUMENT_MINIO_DELETE_FAILED', key: deleted.minio_object_key, error: (e as Error).message });
      }

      logger.info({ entity: 'PROPERTIES', action: 'DOCUMENT_DELETED', user_id: ownerId, record_id: id });
      ok(res, { id });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
