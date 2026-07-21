// GET    /api/v1/properties/tenants
// POST   /api/v1/properties/tenants
// PATCH  /api/v1/properties/tenants/:id
// DELETE /api/v1/properties/tenants/:id  (Owner only — hard delete if no leases)
// GET    /api/v1/properties/tenants/:id/documents
// POST   /api/v1/properties/tenants/:id/documents/upload-url
// POST   /api/v1/properties/tenants/:id/documents
// PATCH  /api/v1/properties/tenants/:id/documents/:docId
// DELETE /api/v1/properties/tenants/:id/documents/:docId
// GET    /api/v1/properties/:propertyId/mortgage
// POST   /api/v1/properties/:propertyId/mortgage

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { minioClient, getObjectStream, getObjectStat, ensureBucket, mediaObjectKey, deleteObject, BUCKET_DOCUMENTS } from '../../lib/minio';

export const propTenantsRouter  = Router();
export const propMortgageRouter = Router({ mergeParams: true });

const UUIDParam      = z.object({ id: z.string().uuid() });
const PropertyParam  = z.object({ propertyId: z.string().uuid() });

// ── Schemas ───────────────────────────────────────────────────────────────────

const PatchTenantSchema = z.object({
  first_name:              z.string().min(1).max(100).optional(),
  last_name:               z.string().max(100).nullable().optional(),
  company_name:            z.string().max(200).nullable().optional(),
  is_company:              z.boolean().optional(),
  phone:                   z.string().max(30).nullable().optional(),
  email:                   z.string().email().nullable().optional(),
  identification_type:     z.enum(['TT_NIC','PASSPORT','COMPANY_REG','DRIVERS_LICENCE','OTHER']).nullable().optional(),
  identification_number:   z.string().max(50).nullable().optional(),
  emergency_contact_name:  z.string().max(100).nullable().optional(),
  emergency_contact_phone: z.string().max(30).nullable().optional(),
  phone2:                  z.string().max(30).nullable().optional(),
  notes:                   z.string().max(2000).nullable().optional(),
}).strict();

const CreateTenantSchema = z.object({
  first_name:              z.string().min(1).max(100),
  last_name:               z.string().max(100).optional(),
  company_name:            z.string().max(200).optional(),
  is_company:              z.boolean().default(false),
  phone:                   z.string().max(30).optional(),
  email:                   z.string().email().optional(),
  identification_type:     z.enum(['TT_NIC','PASSPORT','COMPANY_REG','DRIVERS_LICENCE','OTHER']).optional(),
  identification_number:   z.string().max(50).optional(),
  emergency_contact_name:  z.string().max(100).optional(),
  emergency_contact_phone: z.string().max(30).optional(),
  phone2:                  z.string().max(30).optional(),
  notes:                   z.string().max(2000).optional(),
}).strict();

const CreateMortgageSchema = z.object({
  lender_name:           z.string().min(1).max(200),
  account_reference:     z.string().max(50).optional(),  // PARTIAL only — OPSEC
  mortgage_type:         z.enum(['FIXED_RATE','VARIABLE_RATE','INTEREST_ONLY']),
  original_amount:       z.number().positive(),
  currency:              z.string().length(3).default('TTD'),
  outstanding_balance:   z.number().min(0),
  interest_rate_percent: z.number().positive(),
  start_date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maturity_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  monthly_payment:       z.number().positive(),
  payment_due_day:       z.number().int().min(1).max(28).default(1),
  notes:                 z.string().max(2000).optional(),
  idempotency_key:       z.string().uuid(),
}).strict();

async function auditLog(ownerId: string, entity: string, action: string, recordId: string, vals: unknown): Promise<void> {
  const client = await corePool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', ownerId]);
    await client.query(
      `INSERT INTO audit_log (user_id, entity, action, record_id, new_values, source) VALUES ($1,$2,$3,$4,$5,'API')`,
      [ownerId, entity, action, recordId, JSON.stringify(vals)],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); } finally { client.release(); }
}

// ── GET /properties/tenants ───────────────────────────────────────────────────
// List all property tenants (people/companies who pay rent). Supports search.

propTenantsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const search = (req.query.search as string | undefined)?.slice(0, 100);
    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (search) {
          const s = push(`%${search}%`);
          conditions.push(`(first_name ILIKE ${s} OR last_name ILIKE ${s} OR company_name ILIKE ${s} OR email ILIKE ${s})`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT id, first_name, last_name, company_name, is_company, phone, phone2, email,
                  last_modified_at, created_at
           FROM   prop_property_tenants ${where}
           ORDER  BY COALESCE(company_name, last_name, first_name) ASC`,
          params,
        ).then(r => r.rows);
      });

      logger.info({ entity: 'PROPERTIES', action: 'TENANTS_LIST', user_id: req.rlsCtx.userId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /properties/tenants ──────────────────────────────────────────────────

propTenantsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateTenantSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = parsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const newTenant = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO prop_property_tenants
             (owner_id, first_name, last_name, company_name, is_company, phone, phone2, email,
              identification_type, identification_number, emergency_contact_name,
              emergency_contact_phone, notes, last_modified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
           RETURNING *`,
          [ownerId, body.first_name, body.last_name ?? null, body.company_name ?? null,
           body.is_company, body.phone ?? null, body.phone2 ?? null, body.email ?? null,
           body.identification_type ?? null, body.identification_number ?? null,
           body.emergency_contact_name ?? null, body.emergency_contact_phone ?? null,
           body.notes ?? null],
        ).then(r => r.rows[0]),
      );

      logger.info({ entity: 'PROPERTIES', action: 'TENANT_CREATED', user_id: ownerId, record_id: newTenant.id });
      await auditLog(ownerId, 'PropertyTenant', 'CREATE', newTenant.id, body);
      ok(res, newTenant, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /properties/tenants/:id ────────────────────────────────────────────

propTenantsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = UUIDParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid tenant ID.'); return; }

    const bodyParsed = PatchTenantSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    if (Object.keys(bodyParsed.data).length === 0) { err(res, 422, 'VALIDATION_ERROR', 'No fields to update.'); return; }

    const { id } = paramParsed.data;
    const b = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const tenant = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const sets: string[] = ['last_modified_at = now()'];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (b.first_name              !== undefined) sets.push(`first_name = ${push(b.first_name)}`);
        if (b.last_name               !== undefined) sets.push(`last_name = ${push(b.last_name)}`);
        if (b.company_name            !== undefined) sets.push(`company_name = ${push(b.company_name)}`);
        if (b.is_company              !== undefined) sets.push(`is_company = ${push(b.is_company)}`);
        if (b.phone                   !== undefined) sets.push(`phone = ${push(b.phone)}`);
        if (b.email                   !== undefined) sets.push(`email = ${push(b.email)}`);
        if (b.identification_type     !== undefined) sets.push(`identification_type = ${push(b.identification_type)}`);
        if (b.identification_number   !== undefined) sets.push(`identification_number = ${push(b.identification_number)}`);
        if (b.emergency_contact_name  !== undefined) sets.push(`emergency_contact_name = ${push(b.emergency_contact_name)}`);
        if (b.emergency_contact_phone !== undefined) sets.push(`emergency_contact_phone = ${push(b.emergency_contact_phone)}`);
        if (b.phone2                  !== undefined) sets.push(`phone2 = ${push(b.phone2)}`);
        if (b.notes                   !== undefined) sets.push(`notes = ${push(b.notes)}`);

        params.push(id);
        const idxId = params.length;

        const result = await c.query(
          `UPDATE prop_property_tenants SET ${sets.join(', ')} WHERE id = $${idxId} RETURNING *`,
          params,
        );
        return result.rows[0] ?? null;
      });

      if (!tenant) { err(res, 404, 'NOT_FOUND', 'Tenant not found.'); return; }
      logger.info({ entity: 'PROPERTIES', action: 'TENANT_UPDATED', user_id: ownerId, record_id: id });
      await auditLog(ownerId, 'PropertyTenant', 'UPDATE', id, b);
      ok(res, tenant);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /properties/tenants/:id ───────────────────────────────────────────
// Owner only. Hard deletes if no lease agreements reference this tenant.

propTenantsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.rlsCtx.isOwner) { err(res, 403, 'FORBIDDEN', 'This action requires Owner role.'); return; }

    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Tenant ID must be a valid UUID.'); return; }

    const { id } = idParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const tenant = await c.query(
          `SELECT id, first_name, last_name, company_name FROM prop_property_tenants WHERE id = $1`, [id],
        ).then(r => r.rows[0] ?? null);
        if (!tenant) throw Object.assign(new Error('Tenant not found.'), { status: 404, code: 'TENANT_NOT_FOUND' });

        const leaseCount = await c.query<{ count: string }>(
          `SELECT count(*) FROM prop_lease_agreements WHERE tenant_id = $1`, [id],
        ).then(r => Number(r.rows[0].count));

        if (leaseCount > 0) {
          throw Object.assign(
            new Error('Tenant has lease agreements and cannot be deleted.'),
            { status: 409, code: 'DEPENDENCY_EXISTS', blocking: { leases: leaseCount } },
          );
        }

        await c.query(`DELETE FROM prop_property_tenants WHERE id = $1`, [id]);
        return tenant;
      }).then(async (tenant) => {
        logger.info({ entity: 'PROPERTIES', action: 'TENANT_DELETED', user_id: ownerId, record_id: id });
        await auditLog(ownerId, 'PropertyTenant', 'DELETE', id, {
          first_name: tenant.first_name, last_name: tenant.last_name, company_name: tenant.company_name,
        });
      });

      ok(res, { deleted: true, id });
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; blocking?: Record<string, number>; message: string };
    if (ex.status === 404) { err(res, 404, 'TENANT_NOT_FOUND', ex.message); return; }
    if (ex.status === 409) { res.status(409).json({ success: false, data: null, error: ex.message, code: ex.code, blocking: ex.blocking }); return; }
    next(e);
  }
});

// ── Tenant document vault ─────────────────────────────────────────────────────

const ALLOWED_DOC_TYPES = [
  'national_id','passport','drivers_licence','employment_letter','payslip',
  'company_reg','bank_statement','utility_bill','reference_letter','tenancy_agreement','other',
] as const;

const DocParam = z.object({ id: z.string().uuid(), docId: z.string().uuid() });

const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ExpiryDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const PatchTenantDocSchema = z.object({
  expiry_date: ExpiryDateSchema.nullable(),
}).strict();

// GET /:id/documents — list tenant docs (no presigned URLs; use /:id/documents/:docId/download)
propTenantsRouter.get('/:id/documents', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = UUIDParam.parse(req.params);
    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, tenant_id, doc_type, label, file_name,
                  file_size_bytes, mime_type, notes, source, application_id, expiry_date, created_at
           FROM prop_tenant_documents WHERE tenant_id = $1 ORDER BY created_at ASC`,
          [id],
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// POST /:id/documents — multipart/form-data upload (file + doc_type + optional notes)
propTenantsRouter.post('/:id/documents', docUpload.single('file'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = UUIDParam.parse(req.params);
    const file = req.file;
    if (!file) { err(res, 422, 'VALIDATION_ERROR', 'No file provided.'); return; }

    const docTypeResult = z.enum(ALLOWED_DOC_TYPES).safeParse(req.body['doc_type']);
    if (!docTypeResult.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid doc_type.'); return; }
    const docType = docTypeResult.data;
    const notes = typeof req.body['notes'] === 'string' ? req.body['notes'].slice(0, 2000) : null;

    let expiryDate: string | null = null;
    if (typeof req.body['expiry_date'] === 'string' && req.body['expiry_date'] !== '') {
      const expiryResult = ExpiryDateSchema.safeParse(req.body['expiry_date']);
      if (!expiryResult.success) { err(res, 422, 'VALIDATION_ERROR', 'expiry_date must be YYYY-MM-DD.'); return; }
      expiryDate = expiryResult.data;
    }

    const { userId: ownerId } = req.rlsCtx;

    const key = mediaObjectKey(ownerId, 'tenant-docs', id, `${docType}_${file.originalname}`);
    await ensureBucket(BUCKET_DOCUMENTS);
    await minioClient.putObject(BUCKET_DOCUMENTS, key, file.buffer, file.size, { 'Content-Type': file.mimetype });

    const client = await propertiesPool.connect();
    try {
      const doc = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO prop_tenant_documents
             (owner_id, tenant_id, doc_type, label, minio_object_key, file_name, file_size_bytes, mime_type, notes, expiry_date, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'MANUAL') RETURNING *`,
          [ownerId, id, docType, docType.replace(/_/g, ' '), key, file.originalname,
           file.size, file.mimetype, notes, expiryDate],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'PROPERTIES', action: 'TENANT_DOC_UPLOADED', tenant_id: id, record_id: doc.id, user_id: ownerId });
      ok(res, doc, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// PATCH /:id/documents/:docId — update expiry_date on an existing document
propTenantsRouter.patch('/:id/documents/:docId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, docId } = DocParam.parse(req.params);
    const bodyParsed = PatchTenantDocSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const doc = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE prop_tenant_documents SET expiry_date = $1
           WHERE id = $2 AND tenant_id = $3 RETURNING *`,
          [bodyParsed.data.expiry_date, docId, id],
        ).then(r => r.rows[0] ?? null),
      );
      if (!doc) { err(res, 404, 'NOT_FOUND', 'Document not found.'); return; }
      logger.info({ entity: 'PROPERTIES', action: 'TENANT_DOC_EXPIRY_UPDATED', tenant_id: id, record_id: docId, user_id: ownerId });
      ok(res, doc);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// GET /:id/documents/:docId/download — stream file from MinIO
propTenantsRouter.get('/:id/documents/:docId/download', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, docId } = DocParam.parse(req.params);

    const client = await propertiesPool.connect();
    let doc: { minio_object_key: string; file_name: string; mime_type: string | null } | null = null;
    try {
      doc = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT minio_object_key, file_name, mime_type
           FROM prop_tenant_documents WHERE id = $1 AND tenant_id = $2`,
          [docId, id],
        ).then(r => r.rows[0] ?? null),
      );
    } finally { client.release(); }

    if (!doc) { err(res, 404, 'NOT_FOUND', 'Document not found.'); return; }

    const [stream, stat] = await Promise.all([
      getObjectStream(BUCKET_DOCUMENTS, doc.minio_object_key),
      getObjectStat(BUCKET_DOCUMENTS, doc.minio_object_key),
    ]);

    res.set({
      'Content-Type': doc.mime_type ?? stat.contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.file_name)}"`,
      'Content-Length': String(stat.size),
      'Cache-Control': 'private, no-cache',
    });
    stream.pipe(res);
  } catch (e) { next(e); }
});

propTenantsRouter.delete('/:id/documents/:docId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, docId } = DocParam.parse(req.params);
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const deleted = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `DELETE FROM prop_tenant_documents WHERE id = $1 AND tenant_id = $2 RETURNING minio_object_key`,
          [docId, id],
        ).then(r => r.rows[0] ?? null),
      );
      if (!deleted) { err(res, 404, 'NOT_FOUND', 'Document not found.'); return; }
      try { await deleteObject(BUCKET_DOCUMENTS, deleted.minio_object_key); } catch (_) { /* best-effort */ }
      logger.info({ entity: 'PROPERTIES', action: 'TENANT_DOC_DELETED', tenant_id: id, record_id: docId, user_id: ownerId });
      ok(res, { deleted: true, id: docId });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /properties/:propertyId/mortgage ──────────────────────────────────────

propMortgageRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PropertyParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, lender_name, account_reference, mortgage_type, original_amount,
                  currency, outstanding_balance, interest_rate_percent, start_date,
                  maturity_date, monthly_payment, payment_due_day, status,
                  updated_at AS last_modified_at, created_at
           FROM   prop_mortgage_register
           WHERE  property_id = $1
           ORDER  BY created_at ASC`,
          [parsed.data.propertyId],
        ).then(r => r.rows),
      );

      logger.info({ entity: 'PROPERTIES', action: 'MORTGAGE_LIST', user_id: req.rlsCtx.userId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /properties/:propertyId/mortgage ─────────────────────────────────────

propMortgageRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = PropertyParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const bodyParsed = CreateMortgageSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;
    const { propertyId } = paramParsed.data;

    const client = await propertiesPool.connect();
    try {
      const { record, created } = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM prop_mortgage_register WHERE idempotency_key = $1`, [body.idempotency_key],
        );
        if (existing.rows.length > 0) {
          const dup = await c.query(`SELECT * FROM prop_mortgage_register WHERE id = $1`, [existing.rows[0].id]);
          return { record: dup.rows[0], created: false };
        }

        const result = await c.query(
          `INSERT INTO prop_mortgage_register
             (owner_id, property_id, lender_name, account_reference, mortgage_type,
              original_amount, currency, outstanding_balance, interest_rate_percent,
              start_date, maturity_date, monthly_payment, payment_due_day, notes, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING *`,
          [ownerId, propertyId, body.lender_name, body.account_reference ?? null,
           body.mortgage_type, body.original_amount, body.currency, body.outstanding_balance,
           body.interest_rate_percent, body.start_date, body.maturity_date ?? null,
           body.monthly_payment, body.payment_due_day, body.notes ?? null, body.idempotency_key],
        );
        return { record: result.rows[0], created: true };
      });

      logger.info({ entity: 'PROPERTIES', action: created ? 'MORTGAGE_CREATED' : 'MORTGAGE_DUPLICATE', user_id: ownerId, record_id: record.id });
      if (created) {
        // Audit — omit account_reference for OPSEC (don't log partial account numbers)
        const { account_reference: _omit, ...safeBody } = body;
        await auditLog(ownerId, 'MortgageRegister', 'CREATE', record.id, { ...safeBody, property_id: propertyId });
      }
      ok(res, record, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
