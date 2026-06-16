// GET    /api/v1/properties/applications
// POST   /api/v1/properties/applications
// GET    /api/v1/properties/applications/:id
// PATCH  /api/v1/properties/applications/:id
// POST   /api/v1/properties/applications/:id/decide
// POST   /api/v1/properties/applications/:id/upload-doc

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { getPresignedPutUrl } from '../../lib/minio';
import { sendTemplate } from '../../lib/whatsapp';

export const applicationsRouter = Router();

const IdParam = z.object({ id: z.string().uuid() });

const EmploymentTypeEnum = z.enum(['EMPLOYED','SELF_EMPLOYED','CONTRACT','RETIRED','UNEMPLOYED','OTHER']);
const AppStatusEnum      = z.enum(['PENDING','UNDER_REVIEW','APPROVED','REJECTED','WITHDRAWN']);
const DocTypeEnum        = z.enum(['national_id','payslip_1','payslip_2','payslip_3','employment_letter']);

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

applicationsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const unitId = req.query['unit_id'] as string | undefined;
    const status = req.query['status'] as string | undefined;

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const conds: string[] = [];
      const vals: unknown[] = [ownerId];
      if (unitId) { vals.push(unitId); conds.push(`a.unit_id = $${vals.length}`); }
      if (status) { vals.push(status); conds.push(`a.status = $${vals.length}`); }
      const where = conds.length ? ' AND ' + conds.join(' AND ') : '';
      const { rows: r } = await client.query(
        `SELECT a.*, u.unit_number, p.name AS property_name
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
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
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
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `SELECT a.*, u.unit_number, p.name AS property_name
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
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
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
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
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
      const tpl = decision === 'APPROVED' ? 'prop_app_approved' : 'prop_app_rejected';
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

applicationsRouter.post('/:id/upload-doc', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const { doc_type } = UploadDocSchema.parse(req.body);

    const key = `applications/${id}/${doc_type}-${Date.now()}.pdf`;
    const url = await getPresignedPutUrl('jag-documents', key, 900);
    res.json(ok({ upload_url: url, object_key: key }));
  } catch (e) { next(e); }
});
