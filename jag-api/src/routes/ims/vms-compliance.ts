// VMS Increment 2 — Compliance Document Vault
//
// Documents stored in MinIO jag-documents bucket.
// Upload flow: get presigned PUT URL → client uploads → confirm with POST.
//
// GET    /api/v1/ims/vehicles/:id/compliance
// POST   /api/v1/ims/vehicles/:id/compliance/upload-url
// POST   /api/v1/ims/vehicles/:id/compliance
// PATCH  /api/v1/ims/vehicles/:id/compliance/:did
// GET    /api/v1/ims/vehicles/:id/compliance/:did/download
// DELETE /api/v1/ims/vehicles/:id/compliance/:did

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import {
  BUCKET_DOCUMENTS,
  getPresignedPutUrl,
  getPresignedGetUrl,
  deleteObject,
} from '../../lib/minio';

export const vmsComplianceRouter = Router();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const UUIDParam  = z.object({ id: z.string().uuid() });
const DocParams  = z.object({ id: z.string().uuid(), did: z.string().uuid() });

const DOC_TYPES = [
  'CERTIFICATE_OF_FITNESS',
  'INSURANCE_CERTIFICATE',
  'ROAD_TAX',
  'CUSTOMS_RELEASE',
  'IMPORT_PERMIT',
  'TITLE',
  'TYRE_CERT',
  'OTHER',
] as const;

const UploadUrlSchema = z.object({
  filename:     z.string().min(1).max(255),
  content_type: z.string().min(1).max(100),
}).strict();

const CreateComplianceDocSchema = z.object({
  doc_type:          z.enum(DOC_TYPES),
  title:             z.string().min(1).max(200),
  object_key:        z.string().min(1).max(1000).optional(),
  doc_number:        z.string().max(100).optional(),
  issuing_authority: z.string().max(200).optional(),
  issue_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiry_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:             z.string().max(5000).optional(),
}).strict();

const PatchComplianceDocSchema = z.object({
  doc_type:          z.enum(DOC_TYPES).optional(),
  title:             z.string().min(1).max(200).optional(),
  doc_number:        z.string().max(100).optional(),
  issuing_authority: z.string().max(200).optional(),
  issue_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiry_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:             z.string().max(5000).optional(),
}).strict().refine(o => Object.keys(o).length > 0, 'No fields to update');

// ── Helpers ───────────────────────────────────────────────────────────────────

const EXPIRY_WARN_DAYS = 30;

function expiryStatus(expiryDate: string | null): 'CURRENT' | 'EXPIRING_SOON' | 'EXPIRED' | null {
  if (!expiryDate) return null;
  const today = new Date().toISOString().split('T')[0];
  const daysLeft = Math.floor((new Date(expiryDate).getTime() - new Date(today).getTime()) / 86400000);
  if (daysLeft < 0)                  return 'EXPIRED';
  if (daysLeft <= EXPIRY_WARN_DAYS)  return 'EXPIRING_SOON';
  return 'CURRENT';
}

// ── GET /vehicles/:id/compliance ──────────────────────────────────────────────

vmsComplianceRouter.get('/:id/compliance', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }

    const vehicleId = idP.data.id;

    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, async (c) =>
        c.query(
          `SELECT id, doc_type, title, doc_number, issuing_authority,
                  issue_date, expiry_date, object_key IS NOT NULL AS has_file,
                  reminder_sent_at, notes, last_modified_at, created_at
           FROM vms_compliance_docs
           WHERE vehicle_id = $1
           ORDER BY
             CASE WHEN expiry_date IS NOT NULL THEN 0 ELSE 1 END,
             expiry_date ASC,
             doc_type, title`,
          [vehicleId],
        ).then(r => r.rows.map(row => ({
          ...row,
          expiry_status: expiryStatus(row.expiry_date as string | null),
          days_until_expiry: row.expiry_date
            ? Math.floor((new Date(row.expiry_date as string).getTime() - Date.now()) / 86400000)
            : null,
        }))),
      );

      res.json(ok({ compliance_docs: rows }));
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /vehicles/:id/compliance/upload-url ──────────────────────────────────
// Returns a presigned PUT URL. Client uploads the file, then calls POST /compliance.

vmsComplianceRouter.post('/:id/compliance/upload-url', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP   = UUIDParam.safeParse(req.params);
    if (!idP.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }
    const bodyP = UploadUrlSchema.safeParse(req.body);
    if (!bodyP.success) { res.status(422).json(err('Request body validation failed.', 'VALIDATION_ERROR')); return; }

    const vehicleId = idP.data.id;
    const { filename, content_type } = bodyP.data;
    const { userId } = req.rlsCtx;

    // Verify vehicle exists under this tenant before issuing a URL
    const client = await commercialPool.connect();
    try {
      const exists = await withTenantRLS(client, req.rlsCtx, async (c) =>
        c.query(`SELECT id FROM ims_vehicles WHERE id = $1`, [vehicleId]).then(r => r.rows.length > 0),
      );
      if (!exists) { res.status(404).json(err('Vehicle not found.', 'VEHICLE_NOT_FOUND')); return; }
    } finally { client.release(); }

    const ts   = Date.now();
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const object_key = `vehicles/${vehicleId}/compliance/${ts}_${safe}`;

    const upload_url = await getPresignedPutUrl(BUCKET_DOCUMENTS, object_key, 900);
    logger.info({ entity: 'VMS', action: 'COMPLIANCE_UPLOAD_URL_ISSUED', user_id: userId, vehicle_id: vehicleId });

    res.json(ok({ upload_url, object_key, content_type }));
  } catch (e) { next(e); }
});

// ── POST /vehicles/:id/compliance ─────────────────────────────────────────────
// Creates the DB record after the file has been uploaded to MinIO (or without a file).

vmsComplianceRouter.post('/:id/compliance', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP   = UUIDParam.safeParse(req.params);
    if (!idP.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }
    const bodyP = CreateComplianceDocSchema.safeParse(req.body);
    if (!bodyP.success) { res.status(422).json(err('Request body validation failed.', 'VALIDATION_ERROR')); return; }

    const b         = bodyP.data;
    const vehicleId = idP.data.id;
    const { tenantId, userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const veh = await c.query(`SELECT id FROM ims_vehicles WHERE id = $1`, [vehicleId]);
        if (veh.rows.length === 0) throw Object.assign(new Error('Vehicle not found.'), { status: 404, code: 'VEHICLE_NOT_FOUND' });

        return c.query(
          `INSERT INTO vms_compliance_docs
             (tenant_id, vehicle_id, doc_type, title, object_key,
              doc_number, issuing_authority, issue_date, expiry_date, notes, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [
            tenantId, vehicleId, b.doc_type, b.title,
            b.object_key ?? null,
            b.doc_number ?? null, b.issuing_authority ?? null,
            b.issue_date ?? null, b.expiry_date ?? null,
            b.notes ?? null, userId,
          ],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'VMS', action: 'COMPLIANCE_DOC_CREATED', user_id: userId, tenant_id: tenantId, record_id: row.id });
      res.status(201).json(ok(row));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    next(e);
  }
});

// ── PATCH /vehicles/:id/compliance/:did ───────────────────────────────────────

vmsComplianceRouter.patch('/:id/compliance/:did', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramsP = DocParams.safeParse(req.params);
    if (!paramsP.success) { res.status(422).json(err('Invalid path parameters.', 'VALIDATION_ERROR')); return; }
    const bodyP = PatchComplianceDocSchema.safeParse(req.body);
    if (!bodyP.success) { res.status(422).json(err('Request body validation failed.', 'VALIDATION_ERROR')); return; }

    const b   = bodyP.data;
    const { id: vehicleId, did } = paramsP.data;
    const { userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      await withTenantRLS(client, req.rlsCtx, async (c) => {
        const cols: string[] = ['last_modified_at = now()', `last_modified_by = '${userId}'`];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (b.doc_type          !== undefined) cols.push(`doc_type = ${push(b.doc_type)}`);
        if (b.title             !== undefined) cols.push(`title = ${push(b.title)}`);
        if (b.doc_number        !== undefined) cols.push(`doc_number = ${push(b.doc_number)}`);
        if (b.issuing_authority !== undefined) cols.push(`issuing_authority = ${push(b.issuing_authority)}`);
        if (b.issue_date        !== undefined) cols.push(`issue_date = ${push(b.issue_date)}`);
        if (b.expiry_date       !== undefined) {
          cols.push(`expiry_date = ${push(b.expiry_date)}`);
          // Reset reminder so the cron can re-fire when a new date is set
          cols.push(`reminder_sent_at = NULL`);
        }
        if (b.notes !== undefined) cols.push(`notes = ${push(b.notes)}`);

        params.push(did, vehicleId);
        const upd = await c.query(
          `UPDATE vms_compliance_docs SET ${cols.join(', ')}
           WHERE id = $${params.length - 1} AND vehicle_id = $${params.length}`,
          params,
        );
        if (upd.rowCount === 0) throw Object.assign(new Error('Compliance doc not found.'), { status: 404, code: 'NOT_FOUND' });
      });

      logger.info({ entity: 'VMS', action: 'COMPLIANCE_DOC_UPDATED', user_id: userId, record_id: did });
      res.json(ok({ updated: true }));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    next(e);
  }
});

// ── GET /vehicles/:id/compliance/:did/download ────────────────────────────────
// Returns a 1-hour presigned GET URL for the stored document.

vmsComplianceRouter.get('/:id/compliance/:did/download', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramsP = DocParams.safeParse(req.params);
    if (!paramsP.success) { res.status(422).json(err('Invalid path parameters.', 'VALIDATION_ERROR')); return; }

    const { id: vehicleId, did } = paramsP.data;

    const client = await commercialPool.connect();
    try {
      const object_key = await withTenantRLS(client, req.rlsCtx, async (c) =>
        c.query<{ object_key: string | null }>(
          `SELECT object_key FROM vms_compliance_docs WHERE id = $1 AND vehicle_id = $2`,
          [did, vehicleId],
        ).then(r => {
          if (r.rows.length === 0) throw Object.assign(new Error('Compliance doc not found.'), { status: 404, code: 'NOT_FOUND' });
          return r.rows[0].object_key;
        }),
      );

      if (!object_key) { res.status(404).json(err('No file attached to this document.', 'NO_FILE')); return; }

      const download_url = await getPresignedGetUrl(BUCKET_DOCUMENTS, object_key, 3600);
      res.json(ok({ download_url }));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    next(e);
  }
});

// ── DELETE /vehicles/:id/compliance/:did ──────────────────────────────────────
// Deletes the DB record and the MinIO object (if present).

vmsComplianceRouter.delete('/:id/compliance/:did', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramsP = DocParams.safeParse(req.params);
    if (!paramsP.success) { res.status(422).json(err('Invalid path parameters.', 'VALIDATION_ERROR')); return; }

    const { id: vehicleId, did } = paramsP.data;
    const { userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const object_key = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const res2 = await c.query<{ object_key: string | null }>(
          `DELETE FROM vms_compliance_docs WHERE id = $1 AND vehicle_id = $2 RETURNING object_key`,
          [did, vehicleId],
        );
        if (res2.rowCount === 0) throw Object.assign(new Error('Compliance doc not found.'), { status: 404, code: 'NOT_FOUND' });
        return res2.rows[0].object_key;
      });

      // Non-blocking MinIO cleanup
      if (object_key) {
        void deleteObject(BUCKET_DOCUMENTS, object_key).catch((e: unknown) => {
          logger.warn({ entity: 'VMS', action: 'COMPLIANCE_MINIO_DELETE_FAILED', key: object_key, error: (e as Error).message });
        });
      }

      logger.info({ entity: 'VMS', action: 'COMPLIANCE_DOC_DELETED', user_id: userId, record_id: did });
      res.json(ok({ deleted: true, id: did }));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    next(e);
  }
});
