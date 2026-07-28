// GET    /api/v1/properties/applications
// POST   /api/v1/properties/applications
// GET    /api/v1/properties/applications/:id
// PATCH  /api/v1/properties/applications/:id
// POST   /api/v1/properties/applications/:id/decide
// POST   /api/v1/properties/applications/:id/upload-doc
// GET    /api/v1/properties/applications/:id/documents
// POST   /api/v1/properties/applications/:id/create-tenant
// GET    /api/v1/properties/applications/form.pdf

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { minioClient, getObjectStream, getObjectStat, ensureBucket, mediaObjectKey, BUCKET_DOCUMENTS } from '../../lib/minio';
import { sendTemplate } from '../../lib/whatsapp';
import { generateApplicationFormPDF } from '../../lib/application-form-pdf';

export const applicationsRouter = Router();

const IdParam = z.object({ id: z.string().uuid() });

const EmploymentTypeEnum = z.enum(['EMPLOYED','SELF_EMPLOYED','CONTRACT','RETIRED','UNEMPLOYED','OTHER']);
const AppStatusEnum      = z.enum(['PENDING','UNDER_REVIEW','APPROVED','REJECTED','WITHDRAWN']);
const DocTypeEnum        = z.enum(['national_id','drivers_permit','passport','payslip_1','payslip_2','payslip_3','employment_letter']);

const CreateApplicationSchema = z.object({
  unit_id:              z.string().uuid(),
  enquiry_id:           z.string().uuid().optional(),
  full_name:            z.string().min(1).max(200),
  date_of_birth:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  national_id:          z.string().max(50).optional(),
  email:                z.string().email().max(200).optional(),
  phone:                z.string().max(30).optional(),
  employer_name:        z.string().max(200).optional(),
  employment_type:      EmploymentTypeEnum.optional(),
  monthly_income_ttd:   z.number().positive().optional(),
  reference_1_name:     z.string().max(200).optional(),
  reference_1_phone:    z.string().max(30).optional(),
  reference_1_relation: z.string().max(100).optional(),
  reference_2_name:     z.string().max(200).optional(),
  reference_2_phone:    z.string().max(30).optional(),
  reference_2_relation: z.string().max(100).optional(),
  prior_landlord_name:  z.string().max(200).optional(),
  prior_landlord_phone: z.string().max(30).optional(),
  notes:                z.string().optional(),
}).strict();

const PatchApplicationSchema = z.object({
  status:               AppStatusEnum.optional(),
  notes:                z.string().nullable().optional(),
  employer_name:        z.string().max(200).nullable().optional(),
  employment_type:      EmploymentTypeEnum.nullable().optional(),
  monthly_income_ttd:   z.number().positive().nullable().optional(),
  submitted_at:         z.string().optional(),
}).strict();

const DecideSchema = z.object({
  decision:         z.enum(['APPROVED','REJECTED']),
  rejection_reason: z.string().optional(),
}).strict();

const UploadDocSchema = z.object({
  doc_type: DocTypeEnum,
}).strict();

const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

applicationsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const unitId = req.query['unit_id'] as string | undefined;
    const status = req.query['status'] as string | undefined;
    const tenantId = req.query['tenant_id'] as string | undefined;

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const conds: string[] = [];
      const vals: unknown[] = [ownerId];
      if (unitId) { vals.push(unitId); conds.push(`a.unit_id = $${vals.length}`); }
      if (status) { vals.push(status); conds.push(`a.status = $${vals.length}`); }
      if (tenantId) { vals.push(tenantId); conds.push(`a.tenant_id = $${vals.length}`); }
      const where = conds.length ? ' AND ' + conds.join(' AND ') : '';
      const { rows: r } = await client.query(
        `SELECT a.*, u.unit_number, u.property_id, p.name AS property_name
         FROM prop_applications a
         JOIN prop_units u ON u.id = a.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE a.owner_id = $1${where}
         ORDER BY a.created_at DESC LIMIT 200`,
        vals,
      );
      return r;
    });
    res.json(ok(rows));
  } catch (e) { next(e); }
});

applicationsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const body = CreateApplicationSchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `INSERT INTO prop_applications (owner_id, unit_id, enquiry_id, full_name, date_of_birth, national_id,
           email, phone, employer_name, employment_type, monthly_income_ttd,
           reference_1_name, reference_1_phone, reference_1_relation,
           reference_2_name, reference_2_phone, reference_2_relation,
           prior_landlord_name, prior_landlord_phone, notes, submitted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW()) RETURNING *`,
        [ownerId, body.unit_id, body.enquiry_id ?? null, body.full_name,
         body.date_of_birth ?? null, body.national_id ?? null,
         body.email ?? null, body.phone ?? null,
         body.employer_name ?? null, body.employment_type ?? null,
         body.monthly_income_ttd ?? null,
         body.reference_1_name ?? null, body.reference_1_phone ?? null, body.reference_1_relation ?? null,
         body.reference_2_name ?? null, body.reference_2_phone ?? null, body.reference_2_relation ?? null,
         body.prior_landlord_name ?? null, body.prior_landlord_phone ?? null,
         body.notes ?? null],
      );
      return rows[0];
    });
    logger.info({ entity: 'PROPERTIES', action: 'APPLICATION_CREATED', record_id: row.id, user_id: ownerId });
    res.status(201).json(ok(row));
  } catch (e) { next(e); }
});

applicationsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `SELECT a.*, u.unit_number, u.property_id, p.name AS property_name
         FROM prop_applications a
         JOIN prop_units u ON u.id = a.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE a.id = $1 AND a.owner_id = $2`,
        [id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Application not found', 'NOT_FOUND'));
    res.json(ok(row));
  } catch (e) { next(e); }
});

applicationsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = PatchApplicationSchema.parse(req.body);
    if (Object.keys(body).length === 0) return void res.status(400).json(err('No fields to update', 'VALIDATION_ERROR'));

    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      vals.push(v); sets.push(`${k} = $${vals.length}`);
    }
    vals.push(id); vals.push(ownerId);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_applications SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND owner_id = $${vals.length} RETURNING *`,
        vals,
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Application not found', 'NOT_FOUND'));
    res.json(ok(row));
  } catch (e) { next(e); }
});

applicationsRouter.post('/:id/decide', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const { decision, rejection_reason } = DecideSchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_applications
         SET status = $1, rejection_reason = $2, decision_at = NOW(), decided_by = $3
         WHERE id = $4 AND owner_id = $5 RETURNING *`,
        [decision, rejection_reason ?? null, ownerId, id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Application not found', 'NOT_FOUND'));

    if (row.phone) {
      const tpl = decision === 'APPROVED' ? 'jag_enq_approved' : 'jag_enq_declined';
      try {
        await sendTemplate({ to: row.phone, templateName: tpl,
          components: [{ type: 'body', parameters: [{ type: 'text', text: row.full_name }] }] });
      } catch (e) {
        logger.warn({ entity: 'PROPERTIES', action: 'WA_DECIDE_FAILED', error_message: (e as Error).message });
      }
    }
    res.json(ok(row));
  } catch (e) { next(e); }
});

// POST /api/v1/properties/applications/:id/send-lease-signed
// Fires jag_onb_lease_ready template when tenancy agreement is sent to tenant for signing
applicationsRouter.post('/:id/send-lease-signed', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `SELECT a.full_name, a.phone, u.unit_number, p.name AS property_name
         FROM prop_applications a
         JOIN prop_units u ON u.id = a.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE a.id = $1 AND a.owner_id = $2 AND a.status = 'APPROVED'`,
        [id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Approved application not found', 'NOT_FOUND'));
    if (!row.phone) return void res.status(400).json(err('No phone number on application', 'VALIDATION_ERROR'));

    // NOTE: the jag_onb_lease_ready template now carries a "Review & Sign" URL button
    // whose link comes from the Documenso signing submission. That submission is
    // created by the canonical lease send-for-signing flow
    // (properties.ts → POST /:propertyId/leases/:leaseId/send-for-signing), which
    // also sends this template WITH the signing link. This endpoint has no signing
    // submission, so it no longer sends the template (doing so would emit a broken
    // button). Create + send the lease for signing from the Properties → Lease screen.
    logger.info({ entity: 'PROPERTIES', action: 'WA_LEASE_SIGNED_NOOP', application_id: id, user_id: ownerId });
    res.json(ok({ sent: false, reason: 'Use lease send-for-signing (creates the signing link + sends jag_onb_lease_ready).' }));
  } catch (e) { next(e); }
});

// POST /:id/upload-doc — multipart/form-data (file + doc_type)
applicationsRouter.post('/:id/upload-doc', docUpload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const file = req.file;
    if (!file) return void res.status(422).json(err('No file provided', 'VALIDATION_ERROR'));

    const docTypeResult = UploadDocSchema.safeParse({ doc_type: req.body['doc_type'] });
    if (!docTypeResult.success) return void res.status(422).json(err('Invalid doc_type', 'VALIDATION_ERROR'));
    const { doc_type } = docTypeResult.data;

    const key = mediaObjectKey(ownerId, 'app-docs', id, `${doc_type}_${file.originalname}`);
    await ensureBucket(BUCKET_DOCUMENTS);
    await minioClient.putObject(BUCKET_DOCUMENTS, key, file.buffer, file.size, { 'Content-Type': file.mimetype });

    const doc = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `INSERT INTO prop_application_documents (owner_id, application_id, doc_type, label, minio_object_key, file_name)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [ownerId, id, doc_type, doc_type.replace(/_/g, ' '), key, file.originalname],
      );
      return rows[0];
    });

    logger.info({ entity: 'PROPERTIES', action: 'APP_DOC_UPLOADED', application_id: id, doc_type, user_id: ownerId });
    res.status(201).json(ok(doc));
  } catch (e) { next(e); }
});

// GET /:id/documents — list application docs
applicationsRouter.get('/:id/documents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: r } = await client.query(
        `SELECT id, doc_type, label, file_name, created_at
         FROM prop_application_documents WHERE application_id = $1 ORDER BY created_at ASC`,
        [id],
      );
      return r;
    });

    res.json(ok(rows));
  } catch (e) { next(e); }
});

// GET /:id/documents/:docId/download — stream application doc from MinIO
applicationsRouter.get('/:id/documents/:docId/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const { docId } = z.object({ docId: z.string().uuid() }).parse(req.params);

    const docRows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `SELECT minio_object_key, file_name FROM prop_application_documents WHERE id = $1 AND application_id = $2`,
        [docId, id],
      );
      return rows;
    });
    const doc = docRows[0];
    if (!doc) return void res.status(404).json(err('Document not found', 'NOT_FOUND'));

    const [stream, stat] = await Promise.all([
      getObjectStream(BUCKET_DOCUMENTS, doc.minio_object_key as string),
      getObjectStat(BUCKET_DOCUMENTS, doc.minio_object_key as string),
    ]);

    res.set({
      'Content-Type': stat.contentType ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.file_name as string)}"`,
      'Content-Length': String(stat.size),
      'Cache-Control': 'private, no-cache',
    });
    stream.pipe(res);
  } catch (e) { next(e); }
});

const CreateTenantFromAppSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name:  z.string().max(100).optional(),
}).strict();

const DOC_TYPE_MAP: Record<string, string> = {
  payslip_1: 'payslip', payslip_2: 'payslip', payslip_3: 'payslip',
};

// POST /api/v1/properties/applications/:id/create-tenant
// Creates a prop_property_tenants record from an APPROVED application and
// copies all prop_application_documents into prop_tenant_documents.
applicationsRouter.post('/:id/create-tenant', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = CreateTenantFromAppSchema.parse(req.body);

    const result = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: appRows } = await client.query(
        `SELECT * FROM prop_applications WHERE id = $1 AND owner_id = $2`,
        [id, ownerId],
      );
      const app = appRows[0];
      if (!app) throw Object.assign(new Error('Application not found'), { status: 404, code: 'NOT_FOUND' });
      if (app.status !== 'APPROVED') throw Object.assign(new Error('Application must be APPROVED before creating a tenant'), { status: 409, code: 'INVALID_STATUS' });

      // Derive first/last name — use body override if provided, else split full_name on first space
      const fullName: string = app.full_name ?? '';
      const spaceIdx = fullName.indexOf(' ');
      const derivedFirst = spaceIdx > 0 ? fullName.slice(0, spaceIdx) : fullName;
      const derivedLast  = spaceIdx > 0 ? fullName.slice(spaceIdx + 1) : null;
      const firstName = body.first_name ?? derivedFirst;
      const lastName  = body.last_name  !== undefined ? (body.last_name || null) : derivedLast;

      const { rows: tenantRows } = await client.query(
        `INSERT INTO prop_property_tenants
           (owner_id, first_name, last_name, phone, email, identification_number,
            date_of_birth, employer_name, employment_type,
            nationality, permanent_address, occupation, work_address, work_telephone, whatsapp_alt,
            occupants_count, occupants_detail,
            emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
            emergency_contact_2_name, emergency_contact_2_phone, emergency_contact_2_relation,
            last_modified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW())
         RETURNING *`,
        [ownerId, firstName, lastName, app.phone ?? null, app.email ?? null, app.national_id ?? null,
         app.date_of_birth ?? null, app.employer_name ?? null, app.employment_type ?? null,
         app.nationality ?? null, app.permanent_address ?? null, app.occupation ?? null,
         app.work_address ?? null, app.work_telephone ?? null, app.whatsapp_alt ?? null,
         app.occupants_count ?? null, app.occupants_detail ?? null,
         app.emergency_contact_name ?? null, app.emergency_contact_phone ?? null, app.emergency_contact_relation ?? null,
         app.emergency_contact_2_name ?? null, app.emergency_contact_2_phone ?? null, app.emergency_contact_2_relation ?? null],
      );
      const tenant = tenantRows[0];

      // Copy application documents → tenant vault
      const { rows: appDocs } = await client.query(
        `SELECT * FROM prop_application_documents WHERE application_id = $1`,
        [id],
      );
      for (const doc of appDocs) {
        const mappedType: string = DOC_TYPE_MAP[doc.doc_type as string] ?? (doc.doc_type as string);
        await client.query(
          `INSERT INTO prop_tenant_documents
             (owner_id, tenant_id, doc_type, label, minio_object_key, file_name, source, application_id)
           VALUES ($1,$2,$3,$4,$5,$6,'APPLICATION',$7)`,
          [ownerId, tenant.id, mappedType, doc.label, doc.minio_object_key, doc.file_name, id],
        );
      }

      // Any deposit taken right after approval (linked via application_id, before
      // this tenant record existed) now has somewhere to point -- see prop_deposits
      // migration 052 and the deposit-creation resolution in deposits.ts.
      await client.query(
        `UPDATE prop_deposits SET tenant_id = $1 WHERE application_id = $2 AND tenant_id IS NULL`,
        [tenant.id, id],
      );

      // Link the application itself back to the tenant it produced -- otherwise
      // this trail dead-ends the moment the tenant exists (see migration 053).
      await client.query(`UPDATE prop_applications SET tenant_id = $1 WHERE id = $2`, [tenant.id, id]);

      logger.info({ entity: 'PROPERTIES', action: 'TENANT_FROM_APPLICATION', application_id: id, tenant_id: tenant.id, docs_copied: appDocs.length, user_id: ownerId });
      return { tenant, docs_copied: appDocs.length };
    });

    res.status(201).json(ok(result));
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) return void res.status(404).json(err(ex.message, 'NOT_FOUND'));
    if (ex.status === 409) return void res.status(409).json(err(ex.message, ex.code ?? 'CONFLICT'));
    next(e);
  }
});

// ── Static PDF application form (public, no auth required) ──────────────────────
applicationsRouter.get('/form.pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = generateApplicationFormPDF();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="JAG_Properties_Rental_Application.pdf"');
    doc.pipe(res);
    doc.end();
  } catch (e) { next(e); }
});
