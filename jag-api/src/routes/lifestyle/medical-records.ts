// GET    /api/v1/lifestyle/medical-records
// GET    /api/v1/lifestyle/medical-records/:id
// POST   /api/v1/lifestyle/medical-records
// PATCH  /api/v1/lifestyle/medical-records/:id
// POST   /api/v1/lifestyle/medical-records/:id/approve
// POST   /api/v1/lifestyle/medical-records/:id/reject
// DELETE /api/v1/lifestyle/medical-records/:id
//
// Records land at status='REVIEW' on creation and require explicit approval before
// being treated as confirmed. Approving a record whose `details.lifestyle_metrics`
// array contains recognized fam_lifestyle_tracker metric readings (e.g. lab values
// pulled from a blood test PDF) also inserts those into fam_lifestyle_tracker, so
// the AI Fitness Coach picks them up automatically — no coach changes needed.
//
// Source documents are never uploaded here — source_file_name is a plain local
// filename/path reference for traceability only.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const medicalRecordsRouter = Router();

const UUIDParam = z.object({ id: z.string().uuid() });

const RecordTypeEnum = z.enum([
  'LAB_RESULT', 'IMAGING', 'PRESCRIPTION', 'CLINIC_CARD', 'REFERRAL',
  'DISCHARGE_SUMMARY', 'VISIT_NOTE', 'IMMUNIZATION', 'DEVICE_EQUIPMENT',
  'INVOICE', 'CHRONOLOGY_SUMMARY', 'OTHER',
]);
const MetricEnum = z.enum(['WEIGHT_KG', 'STEPS', 'SLEEP_HOURS', 'CALORIES', 'EXERCISE_MINUTES', 'BLOOD_PRESSURE_SYSTOLIC', 'BLOOD_PRESSURE_DIASTOLIC', 'RESTING_HEART_RATE', 'CHOLESTEROL_TOTAL', 'CHOLESTEROL_LDL', 'CHOLESTEROL_HDL', 'TRIGLYCERIDES', 'BLOOD_GLUCOSE', 'OTHER']);
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const LifestyleMetricSchema = z.object({
  metric_type: MetricEnum,
  value: z.number(),
  unit: z.string().min(1).max(20),
  entry_date: DateStr,
}).strict();

const CreateRecordSchema = z.object({
  family_member_id: z.string().uuid(),
  record_type: RecordTypeEnum,
  specialty: z.string().max(50).optional(),
  provider_name: z.string().max(200).optional(),
  facility_name: z.string().max(200).optional(),
  record_date: DateStr.optional(),
  record_date_end: DateStr.optional(),
  title: z.string().min(1).max(300),
  summary: z.string().max(5000).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  source_file_name: z.string().max(500).optional(),
  extracted_by: z.enum(['CLAUDE', 'OLLAMA', 'MANUAL']).optional(),
}).strict();

const PatchRecordSchema = CreateRecordSchema.partial().refine(o => Object.keys(o).length > 0);

const DiagnosisSchema = z.object({
  name: z.string().min(1).max(200),
  since: z.string().max(20).optional(),
  status: z.string().max(50).optional(),
  notes: z.string().max(1000).optional(),
}).strict();
const MedicationSchema = z.object({
  name: z.string().min(1).max(200),
  dose: z.string().max(100).optional(),
  frequency: z.string().max(100).optional(),
  prescribed_by: z.string().max(200).optional(),
  since: z.string().max(20).optional(),
}).strict();
const AllergySchema = z.object({
  allergen: z.string().min(1).max(200),
  reaction: z.string().max(300).optional(),
}).strict();
const CareTeamSchema = z.object({
  name: z.string().min(1).max(200),
  specialty: z.string().max(100).optional(),
  facility: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
}).strict();

const PutProfileSchema = z.object({
  active_diagnoses: z.array(DiagnosisSchema).optional(),
  current_medications: z.array(MedicationSchema).optional(),
  allergies: z.array(AllergySchema).optional(),
  care_team: z.array(CareTeamSchema).optional(),
  summary_notes: z.string().max(10000).optional(),
}).strict();

const FamilyMemberParam = z.object({ familyMemberId: z.string().uuid() });

// ── GET /lifestyle/medical-records ──────────────────────────────────────────

medicalRecordsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const memberFilter = req.query.family_member_id as string | undefined;
    const statusFilter = req.query.status as string | undefined;
    const typeFilter = req.query.record_type as string | undefined;
    const specialtyFilter = req.query.specialty as string | undefined;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (memberFilter) conditions.push(`family_member_id = ${push(memberFilter)}`);
        if (statusFilter) conditions.push(`status = ${push(statusFilter)}`);
        if (typeFilter) conditions.push(`record_type = ${push(typeFilter)}`);
        if (specialtyFilter) conditions.push(`specialty = ${push(specialtyFilter)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT * FROM fam_medical_records ${where}
           ORDER  BY status = 'REVIEW' DESC, record_date DESC NULLS LAST, created_at DESC`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /lifestyle/medical-records/:id ──────────────────────────────────────

medicalRecordsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fam_medical_records WHERE id = $1`, [idP.data.id]).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'RECORD_NOT_FOUND', 'Medical record not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /lifestyle/medical-records ─────────────────────────────────────────

medicalRecordsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateRecordSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fam_medical_records
             (owner_id, family_member_id, record_type, specialty, provider_name, facility_name,
              record_date, record_date_end, title, summary, details, source_file_name,
              extracted_by, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [ownerId, body.family_member_id, body.record_type, body.specialty ?? null,
           body.provider_name ?? null, body.facility_name ?? null, body.record_date ?? null,
           body.record_date_end ?? null, body.title, body.summary ?? null,
           JSON.stringify(body.details ?? {}), body.source_file_name ?? null,
           body.extracted_by ?? 'CLAUDE', ownerId],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'LIFESTYLE', action: 'MEDICAL_RECORD_CREATED', user_id: ownerId, record_id: rec.id });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /lifestyle/medical-records/:id ────────────────────────────────────

medicalRecordsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = PatchRecordSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const { userId: ownerId } = req.rlsCtx;
    const setCols: string[] = ['last_modified_at = now()', `last_modified_by = $1`];
    const params: unknown[] = [ownerId];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (body.record_type !== undefined) setCols.push(`record_type = ${push(body.record_type)}`);
    if (body.specialty !== undefined) setCols.push(`specialty = ${push(body.specialty)}`);
    if (body.provider_name !== undefined) setCols.push(`provider_name = ${push(body.provider_name)}`);
    if (body.facility_name !== undefined) setCols.push(`facility_name = ${push(body.facility_name)}`);
    if (body.record_date !== undefined) setCols.push(`record_date = ${push(body.record_date)}`);
    if (body.record_date_end !== undefined) setCols.push(`record_date_end = ${push(body.record_date_end)}`);
    if (body.title !== undefined) setCols.push(`title = ${push(body.title)}`);
    if (body.summary !== undefined) setCols.push(`summary = ${push(body.summary)}`);
    if (body.details !== undefined) setCols.push(`details = ${push(JSON.stringify(body.details))}`);
    if (body.source_file_name !== undefined) setCols.push(`source_file_name = ${push(body.source_file_name)}`);
    if (body.family_member_id !== undefined) setCols.push(`family_member_id = ${push(body.family_member_id)}`);
    params.push(idP.data.id);
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE fam_medical_records SET ${setCols.join(',')} WHERE id = $${params.length} RETURNING *`, params).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'RECORD_NOT_FOUND', 'Medical record not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /lifestyle/medical-records/:id/approve ─────────────────────────────

medicalRecordsRouter.post('/:id/approve', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query(`SELECT * FROM fam_medical_records WHERE id = $1`, [idP.data.id]);
        if (existing.rows.length === 0) return null;
        const record = existing.rows[0];

        const updated = await c.query(
          `UPDATE fam_medical_records
           SET status = 'APPROVED', reviewed_at = now(), last_modified_at = now(), last_modified_by = $1
           WHERE id = $2 RETURNING *`,
          [ownerId, idP.data.id],
        );

        // Push any recognized lab readings into fam_lifestyle_tracker so the AI Coach picks them up.
        const details = record.details as { lifestyle_metrics?: unknown };
        const metricsParsed = z.array(LifestyleMetricSchema).safeParse(details?.lifestyle_metrics ?? []);
        if (metricsParsed.success) {
          for (const m of metricsParsed.data) {
            await c.query(
              `INSERT INTO fam_lifestyle_tracker (owner_id, entry_date, metric_type, value, unit, family_member_id, source, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [ownerId, m.entry_date, m.metric_type, m.value, m.unit, record.family_member_id,
               'Medical Records', `From: ${record.title}`],
            );
          }
        }

        return updated.rows[0];
      });
      if (!rec) { err(res, 404, 'RECORD_NOT_FOUND', 'Medical record not found.'); return; }
      logger.info({ entity: 'LIFESTYLE', action: 'MEDICAL_RECORD_APPROVED', user_id: ownerId, record_id: rec.id });
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /lifestyle/medical-records/:id/reject ──────────────────────────────

medicalRecordsRouter.post('/:id/reject', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE fam_medical_records
           SET status = 'REJECTED', reviewed_at = now(), last_modified_at = now(), last_modified_by = $1
           WHERE id = $2 RETURNING *`,
          [ownerId, idP.data.id],
        ).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'RECORD_NOT_FOUND', 'Medical record not found.'); return; }
      logger.info({ entity: 'LIFESTYLE', action: 'MEDICAL_RECORD_REJECTED', user_id: ownerId, record_id: rec.id });
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /lifestyle/medical-records/profile/:familyMemberId ──────────────────
// Synthesized summary — separate from the raw per-document log above.

medicalRecordsRouter.get('/profile/:familyMemberId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramP = FamilyMemberParam.safeParse(req.params);
    if (!paramP.success) { err(res, 422, 'VALIDATION_ERROR', 'Family member ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fam_medical_profile WHERE family_member_id = $1`, [paramP.data.familyMemberId])
          .then(r => r.rows[0] ?? null),
      );
      ok(res, rec ?? {
        family_member_id: paramP.data.familyMemberId,
        active_diagnoses: [], current_medications: [], allergies: [], care_team: [],
        summary_notes: null, last_synthesized_at: null,
      });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PUT /lifestyle/medical-records/profile/:familyMemberId ──────────────────
// Upsert — full replace of the synthesized profile (re-derive from approved records).

medicalRecordsRouter.put('/profile/:familyMemberId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramP = FamilyMemberParam.safeParse(req.params);
    if (!paramP.success) { err(res, 422, 'VALIDATION_ERROR', 'Family member ID must be a valid UUID.'); return; }
    const bodyP = PutProfileSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fam_medical_profile
             (owner_id, family_member_id, active_diagnoses, current_medications, allergies, care_team,
              summary_notes, last_synthesized_at, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$1)
           ON CONFLICT (family_member_id) DO UPDATE SET
             active_diagnoses    = EXCLUDED.active_diagnoses,
             current_medications = EXCLUDED.current_medications,
             allergies            = EXCLUDED.allergies,
             care_team            = EXCLUDED.care_team,
             summary_notes        = EXCLUDED.summary_notes,
             last_synthesized_at  = now(),
             last_modified_at     = now(),
             last_modified_by     = $1
           RETURNING *`,
          [ownerId, paramP.data.familyMemberId,
           JSON.stringify(body.active_diagnoses ?? []), JSON.stringify(body.current_medications ?? []),
           JSON.stringify(body.allergies ?? []), JSON.stringify(body.care_team ?? []),
           body.summary_notes ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'LIFESTYLE', action: 'MEDICAL_PROFILE_SYNTHESIZED', user_id: ownerId, record_id: rec.id });
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /lifestyle/medical-records/:id ───────────────────────────────────

medicalRecordsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const result = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM fam_medical_records WHERE id = $1`, [idP.data.id]),
      );
      if (result.rowCount === 0) { err(res, 404, 'RECORD_NOT_FOUND', 'Medical record not found.'); return; }
      logger.info({ entity: 'LIFESTYLE', action: 'MEDICAL_RECORD_DELETED', user_id: req.rlsCtx.userId, record_id: idP.data.id });
      ok(res, { deleted: true });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
