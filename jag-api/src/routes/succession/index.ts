// GET   /api/v1/succession/documents
// POST  /api/v1/succession/documents
// PATCH /api/v1/succession/documents/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const successionRouter = Router();
successionRouter.use(requireAuth());
successionRouter.use(brianPortalGate('SUCCESSION'));

const UUIDParam = z.object({ id: z.string().uuid() });

const DocTypeEnum = z.enum(['WILL','TRUST','POWER_OF_ATTORNEY','INSURANCE_POLICY','TITLE_DEED','SHARE_CERTIFICATE','BANK_MANDATE','COMPANY_RESOLUTION','ADVANCE_DIRECTIVE','OTHER']);

const CreateDocSchema = z.object({
  document_type:       DocTypeEnum,
  title:               z.string().min(1).max(200),
  description:         z.string().max(2000).optional(),
  document_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  storage_path:        z.string().max(500).optional(),   // MinIO path for the actual document
  is_classified:       z.boolean().default(true),
  governing_law:       z.string().max(100).optional(),
  lawyer_firm:         z.string().max(200).optional(),   // Firm name only — no individual names (OPSEC)
  last_reviewed_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  review_reminder_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:               z.string().max(2000).optional(),
}).strict();

const PatchDocSchema = CreateDocSchema.partial().refine(o => Object.keys(o).length > 0, { message: 'At least one field required.' });

// ── GET /succession/documents ─────────────────────────────────────────────────

successionRouter.get('/documents', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const typeFilter = req.query.document_type as string | undefined;
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const conditions: string[] = [];
        if (typeFilter) { params.push(typeFilter); conditions.push(`document_type = $${params.length}`); }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT id, document_type, title, description, document_date, is_classified,
                  governing_law, lawyer_firm, last_reviewed_date, review_reminder_date,
                  last_modified_at, created_at
           FROM   fam_succession_documents ${where}
           ORDER  BY document_type, document_date DESC NULLS LAST`,
          params,
        ).then(r => r.rows);
      });
      // Classified documents: strip storage_path from list view — only returned on direct GET by ID.
      logger.info({ entity: 'SUCCESSION', action: 'DOCS_LIST', user_id: req.rlsCtx.userId, count: rows.length });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /succession/documents ────────────────────────────────────────────────

successionRouter.post('/documents', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateDocSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fam_succession_documents
             (owner_id, document_type, title, description, document_date, storage_path,
              is_classified, governing_law, lawyer_firm, last_reviewed_date,
              review_reminder_date, notes, last_modified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()) RETURNING *`,
          [ownerId, body.document_type, body.title, body.description ?? null,
           body.document_date ?? null, body.storage_path ?? null, body.is_classified,
           body.governing_law ?? null, body.lawyer_firm ?? null,
           body.last_reviewed_date ?? null, body.review_reminder_date ?? null,
           body.notes ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'SUCCESSION', action: 'DOC_CREATED', user_id: ownerId, record_id: rec.id });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /succession/documents/:id ──────────────────────────────────────────

successionRouter.patch('/documents/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = PatchDocSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const setCols: string[] = ['last_modified_at = now()', 'updated_at = now()'];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (body.title                !== undefined) setCols.push(`title                 = ${push(body.title)}`);
    if (body.description          !== undefined) setCols.push(`description           = ${push(body.description)}`);
    if (body.document_date        !== undefined) setCols.push(`document_date         = ${push(body.document_date)}`);
    if (body.storage_path         !== undefined) setCols.push(`storage_path          = ${push(body.storage_path)}`);
    if (body.is_classified        !== undefined) setCols.push(`is_classified         = ${push(body.is_classified)}`);
    if (body.last_reviewed_date   !== undefined) setCols.push(`last_reviewed_date    = ${push(body.last_reviewed_date)}`);
    if (body.review_reminder_date !== undefined) setCols.push(`review_reminder_date  = ${push(body.review_reminder_date)}`);
    if (body.notes                !== undefined) setCols.push(`notes                 = ${push(body.notes)}`);
    if (body.lawyer_firm          !== undefined) setCols.push(`lawyer_firm           = ${push(body.lawyer_firm)}`);
    params.push(idP.data.id);
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE fam_succession_documents SET ${setCols.join(',')} WHERE id = $${params.length} RETURNING *`, params).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'DOC_NOT_FOUND', 'Succession document not found.'); return; }
      logger.info({ entity: 'SUCCESSION', action: 'DOC_UPDATED', user_id: req.rlsCtx.userId, record_id: idP.data.id });
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
