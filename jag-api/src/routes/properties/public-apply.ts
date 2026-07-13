// Public Stage-2 rental application form (no Keycloak auth).
// GET    /api/v1/public/apply/:token          → resolve enquiry → unit/property + prefill
// POST   /api/v1/public/apply/:token/upload-url → presigned PUT for a supporting doc
// POST   /api/v1/public/apply/:token           → submit application → prop_applications
//
// The token lives on prop_enquiries (migration 045), set by the post-viewing sender.
// All DB access is scoped to the single platform owner (jag_properties is single-owner)
// via withOwnerRLS — a public route has no req.rlsCtx, and a bare connection under
// FORCE RLS returns zero rows (see CLAUDE.md "public-route RLS" note).
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { BUCKET_DOCUMENTS, getPresignedPutUrl, mediaObjectKey } from '../../lib/minio';
import { enqueueNotification } from '../../lib/notifications';

export const publicApplyRouter = Router();

const PUBLIC_LISTING_OWNER_ID =
  process.env['NOTIFY_OWNER_USER_ID'] ?? '95ca3f77-60ba-4a0f-af70-2832b247b525';

const TokenParam = z.object({ token: z.string().min(10).max(64) });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DocSchema = z.object({
  doc_type:   z.string().min(1).max(50),
  label:      z.string().min(1).max(200),
  object_key: z.string().min(1),
  file_name:  z.string().min(1).max(300),
});

// Every field is required — the tenant must give a complete application in one
// pass. "N/A" is an acceptable answer for fields that may not apply (e.g. no
// prior landlord for a first-time renter); the point is nothing gets silently
// skipped.
const SubmitSchema = z.object({
  full_name:            z.string().min(1).max(200),
  date_of_birth:        z.string().regex(DATE_RE),
  national_id:          z.string().min(1).max(50),
  email:                z.string().email().max(200),
  phone:                z.string().min(1).max(30),
  employer_name:        z.string().min(1).max(200),
  employment_type:      z.enum(['EMPLOYED','SELF_EMPLOYED','CONTRACT','RETIRED','UNEMPLOYED','OTHER']),
  monthly_income_ttd:   z.coerce.number().nonnegative(),
  reference_1_name:     z.string().min(1).max(200),
  reference_1_phone:    z.string().min(1).max(30),
  reference_1_relation: z.string().min(1).max(100),
  reference_2_name:     z.string().min(1).max(200),
  reference_2_phone:    z.string().min(1).max(30),
  reference_2_relation: z.string().min(1).max(100),
  prior_landlord_name:  z.string().min(1).max(200),
  prior_landlord_phone: z.string().min(1).max(30),
  nationality:                  z.string().min(1).max(100),
  permanent_address:            z.string().min(1).max(2000),
  occupation:                   z.string().min(1).max(200),
  work_address:                 z.string().min(1).max(2000),
  work_telephone:               z.string().min(1).max(30),
  whatsapp_alt:                 z.string().min(1).max(30),
  occupants_count:              z.coerce.number().int().nonnegative(),
  occupants_detail:             z.string().min(1).max(2000),
  emergency_contact_name:       z.string().min(1).max(200),
  emergency_contact_phone:      z.string().min(1).max(30),
  emergency_contact_relation:   z.string().min(1).max(100),
  emergency_contact_2_name:     z.string().min(1).max(200),
  emergency_contact_2_phone:    z.string().min(1).max(30),
  emergency_contact_2_relation: z.string().min(1).max(100),
  // 2 ID documents × front+back, employment letter, payslip — 6 uploads
  // minimum. "Other relevant document" is a free-form optional extra, not
  // counted toward the minimum.
  documents: z.array(DocSchema).min(6).max(12),
}).strict();

// Resolve a live token → the enquiry row (unexpired, not yet submitted).
async function resolveToken(token: string): Promise<Record<string, unknown> | null> {
  return withOwnerRLS(propertiesPool, PUBLIC_LISTING_OWNER_ID, async client => {
    const { rows } = await client.query(
      `SELECT e.id AS enquiry_id, e.unit_id, e.property_id, e.prospect_name, e.prospect_phone,
              e.prospect_email, e.application_submitted_at,
              u.unit_number, u.bedrooms, u.bathrooms,
              p.name AS property_name, p.city
       FROM prop_enquiries e
       LEFT JOIN prop_units u ON u.id = e.unit_id
       LEFT JOIN prop_properties p ON p.id = e.property_id
       WHERE e.application_token = $1
         AND (e.application_token_expires_at IS NULL OR e.application_token_expires_at > NOW())`,
      [token],
    );
    return rows[0] ?? null;
  });
}

publicApplyRouter.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = TokenParam.parse(req.params);
    const enq = await resolveToken(token);
    if (!enq) return void res.status(404).json(err('This application link is invalid or has expired.', 'NOT_FOUND'));

    res.json(ok({
      already_submitted: enq['application_submitted_at'] != null,
      property_name: enq['property_name'] ?? '',
      area:          enq['city'] ?? '',
      unit_number:   enq['unit_number'] ?? '',
      bedrooms:      enq['bedrooms'] ?? null,
      bathrooms:     enq['bathrooms'] ?? null,
      prefill: {
        full_name: enq['prospect_name'] ?? '',
        phone:     enq['prospect_phone'] ?? '',
        email:     enq['prospect_email'] ?? '',
      },
    }));
  } catch (e) { next(e); }
});

publicApplyRouter.post('/:token/upload-url', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = TokenParam.parse(req.params);
    const { filename } = z.object({ filename: z.string().min(1).max(300) }).parse(req.body);
    const enq = await resolveToken(token);
    if (!enq) return void res.status(404).json(err('This application link is invalid or has expired.', 'NOT_FOUND'));

    const key = mediaObjectKey(PUBLIC_LISTING_OWNER_ID, 'applications', String(enq['enquiry_id']), filename);
    const upload_url = await getPresignedPutUrl(BUCKET_DOCUMENTS, key, 900);
    res.json(ok({ upload_url, object_key: key }));
  } catch (e) { next(e); }
});

publicApplyRouter.post('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = TokenParam.parse(req.params);
    const body = SubmitSchema.parse(req.body);
    const enq = await resolveToken(token);
    if (!enq) return void res.status(404).json(err('This application link is invalid or has expired.', 'NOT_FOUND'));
    if (enq['application_submitted_at'] != null) {
      return void res.status(409).json(err('An application has already been submitted for this link.', 'ALREADY_SUBMITTED'));
    }

    const ownerId = PUBLIC_LISTING_OWNER_ID;
    const applicationId = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [app] } = await client.query(
        `INSERT INTO prop_applications
           (owner_id, enquiry_id, unit_id, full_name, date_of_birth, national_id, email, phone,
            employer_name, employment_type, monthly_income_ttd,
            reference_1_name, reference_1_phone, reference_1_relation,
            reference_2_name, reference_2_phone, reference_2_relation,
            prior_landlord_name, prior_landlord_phone,
            nationality, permanent_address, occupation, work_address, work_telephone, whatsapp_alt,
            occupants_count, occupants_detail,
            emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
            emergency_contact_2_name, emergency_contact_2_phone, emergency_contact_2_relation,
            status, submitted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                 $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,'PENDING',NOW())
         RETURNING id`,
        [ownerId, enq['enquiry_id'], enq['unit_id'], body.full_name,
         body.date_of_birth, body.national_id, body.email, body.phone,
         body.employer_name, body.employment_type, body.monthly_income_ttd,
         body.reference_1_name, body.reference_1_phone, body.reference_1_relation,
         body.reference_2_name, body.reference_2_phone, body.reference_2_relation,
         body.prior_landlord_name, body.prior_landlord_phone,
         body.nationality, body.permanent_address, body.occupation,
         body.work_address, body.work_telephone, body.whatsapp_alt,
         body.occupants_count, body.occupants_detail,
         body.emergency_contact_name, body.emergency_contact_phone, body.emergency_contact_relation,
         body.emergency_contact_2_name, body.emergency_contact_2_phone, body.emergency_contact_2_relation],
      );
      const appId = app.id as string;

      for (const doc of body.documents) {
        await client.query(
          `INSERT INTO prop_application_documents (owner_id, application_id, doc_type, label, minio_object_key, file_name)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [ownerId, appId, doc.doc_type, doc.label, doc.object_key, doc.file_name],
        );
      }

      // One-time use: burn the token, stamp submission, advance the enquiry stage.
      await client.query(
        `UPDATE prop_enquiries
         SET application_submitted_at = NOW(), application_token = NULL, stage = 'APPLICATION_RECEIVED'
         WHERE id = $1`,
        [enq['enquiry_id']],
      );
      return appId;
    });

    logger.info({ entity: 'PROPERTIES', action: 'PUBLIC_APPLICATION_SUBMITTED', record_id: applicationId,
      enquiry_id: enq['enquiry_id'], severity: 'INFO' });

    void enqueueNotification({
      tier: 2,
      title: 'New rental application',
      body: `${body.full_name} submitted an application for ${String(enq['property_name'] ?? '')} — Unit ${String(enq['unit_number'] ?? '')}.`,
      payload: { module: 'PROPERTIES', kind: 'APPLICATION', application_id: applicationId },
    });

    res.status(201).json(ok({ application_id: applicationId }));
  } catch (e) { next(e); }
});
