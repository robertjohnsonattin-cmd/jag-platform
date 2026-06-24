// GET    /api/v1/docvault/files
// POST   /api/v1/docvault/files        (register file metadata; actual upload via MinIO presigned URL)
// GET    /api/v1/docvault/files/:id
// DELETE /api/v1/docvault/files/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const docvaultRouter = Router();
docvaultRouter.use(requireAuth());
docvaultRouter.use(brianPortalGate('DOCVAULT'));

const UUIDParam = z.object({ id: z.string().uuid() });

const DocVaultQuerySchema = z.object({
  document_type:    z.enum(['NATIONAL_ID','PASSPORT','BIRTH_CERTIFICATE','MARRIAGE_CERTIFICATE','DEATH_CERTIFICATE','MEDICAL_RECORD','ACADEMIC_CERTIFICATE','PROFESSIONAL_LICENCE','FINANCIAL_STATEMENT','TAX_RETURN','INSURANCE_POLICY','PROPERTY_TITLE','LEGAL_AGREEMENT','OTHER']).optional(),
  family_member_id: z.string().uuid().optional(),
  is_data_room:     z.enum(['true','false']).optional(),
}).strict();

const RegisterFileSchema = z.object({
  title:            z.string().min(1).max(200),
  document_type:    z.enum(['NATIONAL_ID','PASSPORT','BIRTH_CERTIFICATE','MARRIAGE_CERTIFICATE','DEATH_CERTIFICATE','MEDICAL_RECORD','ACADEMIC_CERTIFICATE','PROFESSIONAL_LICENCE','FINANCIAL_STATEMENT','TAX_RETURN','INSURANCE_POLICY','PROPERTY_TITLE','LEGAL_AGREEMENT','OTHER']),
  file_name:        z.string().min(1).max(200),
  storage_path:     z.string().min(1).max(500).regex(/^[a-zA-Z0-9/_\-.]+$/, 'storage_path may only contain alphanumerics, slashes, hyphens, underscores and dots'),   // MinIO object path
  mime_type:        z.string().min(1).max(100),
  file_size_bytes:  z.number().int().positive(),
  family_member_id: z.string().uuid().optional(),
  expires_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  is_data_room:     z.boolean().default(false),
  data_room_entity: z.string().max(50).optional(),
  notes:            z.string().max(2000).optional(),
}).strict();

// ── GET /docvault/files ───────────────────────────────────────────────────────

docvaultRouter.get('/files', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = DocVaultQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { document_type, family_member_id, is_data_room } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (document_type)    conditions.push(`document_type = ${push(document_type)}`);
        if (family_member_id) conditions.push(`family_member_id = ${push(family_member_id)}`);
        if (is_data_room !== undefined) conditions.push(`is_data_room = ${push(is_data_room === 'true')}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT id, title, document_type, file_name, storage_path, mime_type,
                  file_size_bytes, family_member_id, expires_date,
                  is_data_room, data_room_entity, last_modified_at, created_at
           FROM   fam_docvault_files ${where}
           ORDER  BY created_at DESC`,
          params,
        ).then(r => r.rows);
      });
      logger.info({ entity: 'DOCVAULT', action: 'FILES_LIST', user_id: req.rlsCtx.userId, count: rows.length });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /docvault/files ──────────────────────────────────────────────────────

docvaultRouter.post('/files', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = RegisterFileSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fam_docvault_files
             (owner_id, family_member_id, title, document_type, file_name, storage_path,
              mime_type, file_size_bytes, expires_date, is_data_room, data_room_entity,
              uploaded_by, notes, last_modified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()) RETURNING *`,
          [ownerId, body.family_member_id ?? null, body.title, body.document_type,
           body.file_name, body.storage_path, body.mime_type, body.file_size_bytes,
           body.expires_date ?? null, body.is_data_room, body.data_room_entity ?? null,
           ownerId, body.notes ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'DOCVAULT', action: 'FILE_REGISTERED', user_id: ownerId, record_id: rec.id });

      // Audit — omit storage_path for brevity (MinIO path is not sensitive but noisy)
      const coreClient = await corePool.connect();
      try {
        await coreClient.query('BEGIN');
        await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_user_id', ownerId]);
        await coreClient.query(
          `INSERT INTO audit_log (user_id, entity, action, record_id, new_values, source) VALUES ($1,'DocVaultFile','REGISTER',$2,$3,'API')`,
          [ownerId, rec.id, JSON.stringify({ title: body.title, document_type: body.document_type, file_name: body.file_name })],
        );
        await coreClient.query('COMMIT');
      } catch (e) { await coreClient.query('ROLLBACK'); } finally { coreClient.release(); }

      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /docvault/files/:id ─────────────────────────────────────────────────
// Edit metadata — primarily to assign/clear family_member_id (tag a document to a
// person). family_member_id accepts null to clear the link.

const PatchFileSchema = z.object({
  family_member_id: z.string().uuid().nullable().optional(),
  title:            z.string().min(1).max(200).optional(),
  document_type:    z.enum(['NATIONAL_ID','PASSPORT','BIRTH_CERTIFICATE','MARRIAGE_CERTIFICATE','DEATH_CERTIFICATE','MEDICAL_RECORD','ACADEMIC_CERTIFICATE','PROFESSIONAL_LICENCE','FINANCIAL_STATEMENT','TAX_RETURN','INSURANCE_POLICY','PROPERTY_TITLE','LEGAL_AGREEMENT','OTHER']).optional(),
  expires_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes:            z.string().max(2000).nullable().optional(),
}).strict().refine(o => Object.keys(o).length > 0, { message: 'At least one field required.' });

docvaultRouter.patch('/files/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = PatchFileSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const { userId: ownerId } = req.rlsCtx;

    const setCols: string[] = ['last_modified_at = now()'];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (body.family_member_id !== undefined) setCols.push(`family_member_id = ${push(body.family_member_id)}`);
    if (body.title            !== undefined) setCols.push(`title            = ${push(body.title)}`);
    if (body.document_type    !== undefined) setCols.push(`document_type    = ${push(body.document_type)}`);
    if (body.expires_date     !== undefined) setCols.push(`expires_date     = ${push(body.expires_date)}`);
    if (body.notes            !== undefined) setCols.push(`notes            = ${push(body.notes)}`);
    params.push(idP.data.id);

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE fam_docvault_files SET ${setCols.join(', ')} WHERE id = $${params.length} RETURNING *`, params)
          .then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'FILE_NOT_FOUND', 'Document not found.'); return; }
      logger.info({ entity: 'DOCVAULT', action: 'FILE_UPDATED', user_id: ownerId, record_id: idP.data.id });

      // Audit — record the changed fields (mirrors the REGISTER audit on POST).
      const coreClient = await corePool.connect();
      try {
        await coreClient.query('BEGIN');
        await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_user_id', ownerId]);
        await coreClient.query(
          `INSERT INTO audit_log (user_id, entity, action, record_id, new_values, source) VALUES ($1,'DocVaultFile','UPDATE',$2,$3,'API')`,
          [ownerId, idP.data.id, JSON.stringify(body)],
        );
        await coreClient.query('COMMIT');
      } catch { await coreClient.query('ROLLBACK').catch(() => {}); } finally { coreClient.release(); }

      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /docvault/files/:id ───────────────────────────────────────────────────

docvaultRouter.get('/files/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fam_docvault_files WHERE id = $1`, [parsed.data.id]).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'FILE_NOT_FOUND', 'Document not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /docvault/files/:id ────────────────────────────────────────────────
// Removes the metadata record. Caller is responsible for deleting the MinIO object.

docvaultRouter.delete('/files/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const deleted = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM fam_docvault_files WHERE id = $1 RETURNING id, title, storage_path`, [parsed.data.id]).then(r => r.rows[0] ?? null),
      );
      if (!deleted) { err(res, 404, 'FILE_NOT_FOUND', 'Document not found.'); return; }
      logger.info({ entity: 'DOCVAULT', action: 'FILE_DELETED', user_id: ownerId, record_id: parsed.data.id, storage_path: deleted.storage_path });
      ok(res, { deleted: true, id: deleted.id, storage_path: deleted.storage_path });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
