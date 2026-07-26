// GET  /api/v1/lifestyle/loyalty
// POST /api/v1/lifestyle/loyalty
// PATCH /api/v1/lifestyle/loyalty/:id
// GET  /api/v1/lifestyle/loyalty/:id/transactions
// POST /api/v1/lifestyle/loyalty/:id/transactions   (STD-11 idempotency)
// GET  /api/v1/lifestyle/tracker
// POST /api/v1/lifestyle/tracker

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { fitnessRouter } from './fitness';
import { medicalRecordsRouter } from './medical-records';

export const lifestyleRouter = Router();
lifestyleRouter.use(requireAuth());
lifestyleRouter.use(brianPortalGate('LIFESTYLE'));
lifestyleRouter.use('/fitness', fitnessRouter);
lifestyleRouter.use('/medical-records', medicalRecordsRouter);

const UUIDParam = z.object({ id: z.string().uuid() });
const ProgrammeParam = z.object({ programmeId: z.string().uuid() });

const ProgTypeEnum = z.enum(['AIRLINE','HOTEL','CRUISE','CREDIT_CARD','RETAIL','DINING','OTHER']);
const TxTypeEnum   = z.enum(['EARN','REDEEM','EXPIRE','TRANSFER_IN','TRANSFER_OUT','BONUS','REINSTATEMENT']);
const MetricEnum   = z.enum(['WEIGHT_KG','STEPS','SLEEP_HOURS','CALORIES','EXERCISE_MINUTES','BLOOD_PRESSURE_SYSTOLIC','BLOOD_PRESSURE_DIASTOLIC','RESTING_HEART_RATE','CHOLESTEROL_TOTAL','CHOLESTEROL_LDL','CHOLESTEROL_HDL','TRIGLYCERIDES','BLOOD_GLUCOSE','OTHER']);

const CreateProgrammeSchema = z.object({
  programme_type:   ProgTypeEnum,
  provider_name:    z.string().min(1).max(200),
  membership_number:z.string().max(100).optional(),
  tier:             z.string().max(50).optional(),
  points_balance:   z.number().min(0).default(0),
  miles_balance:    z.number().min(0).default(0),
  expiry_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  family_member_id: z.string().uuid().nullable().optional(),
  notes:            z.string().max(2000).optional(),
}).strict();

const PatchProgrammeSchema = CreateProgrammeSchema.partial().refine(o => Object.keys(o).length > 0);

const CreateTransactionSchema = z.object({
  transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  transaction_type: TxTypeEnum,
  points_amount:    z.number().default(0),
  miles_amount:     z.number().default(0),
  description:      z.string().min(1).max(300),
  reference_number: z.string().max(100).optional(),
  idempotency_key:  z.string().uuid(),
}).strict();

const CreateTrackerSchema = z.object({
  entry_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  metric_type:      MetricEnum,
  value:            z.number(),
  unit:             z.string().min(1).max(20),
  family_member_id: z.string().uuid().optional(),
  notes:            z.string().max(500).optional(),
  source:           z.string().max(50).optional(),
}).strict();

// ── GET /lifestyle/loyalty ────────────────────────────────────────────────────

lifestyleRouter.get('/loyalty', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const memberFilter = req.query.family_member_id as string | undefined;
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const conditions: string[] = [];
        if (memberFilter) { params.push(memberFilter); conditions.push(`family_member_id = $${params.length}`); }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT id, programme_type, provider_name, membership_number, tier,
                  points_balance, miles_balance, expiry_date, family_member_id,
                  last_modified_at, created_at
           FROM   fam_loyalty_programmes ${where}
           ORDER  BY programme_type, provider_name`,
          params,
        ).then(r => r.rows);
      });
      logger.info({ entity: 'LIFESTYLE', action: 'LOYALTY_LIST', user_id: req.rlsCtx.userId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /lifestyle/loyalty ───────────────────────────────────────────────────

lifestyleRouter.post('/loyalty', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateProgrammeSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fam_loyalty_programmes
             (owner_id, programme_type, provider_name, membership_number, tier,
              points_balance, miles_balance, expiry_date, family_member_id, notes, last_modified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) RETURNING *`,
          [ownerId, body.programme_type, body.provider_name, body.membership_number ?? null,
           body.tier ?? null, body.points_balance, body.miles_balance,
           body.expiry_date ?? null, body.family_member_id ?? null, body.notes ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'LIFESTYLE', action: 'PROGRAMME_CREATED', user_id: ownerId, record_id: rec.id });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /lifestyle/loyalty/:id ─────────────────────────────────────────────

lifestyleRouter.patch('/loyalty/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = PatchProgrammeSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const setCols: string[] = ['last_modified_at = now()', 'updated_at = now()'];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (body.tier            !== undefined) setCols.push(`tier            = ${push(body.tier)}`);
    if (body.points_balance  !== undefined) setCols.push(`points_balance  = ${push(body.points_balance)}`);
    if (body.miles_balance   !== undefined) setCols.push(`miles_balance   = ${push(body.miles_balance)}`);
    if (body.expiry_date     !== undefined) setCols.push(`expiry_date     = ${push(body.expiry_date)}`);
    if (body.membership_number !== undefined) setCols.push(`membership_number = ${push(body.membership_number)}`);
    if (body.family_member_id !== undefined) setCols.push(`family_member_id = ${push(body.family_member_id)}`);
    if (body.notes           !== undefined) setCols.push(`notes           = ${push(body.notes)}`);
    params.push(idP.data.id);
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE fam_loyalty_programmes SET ${setCols.join(',')} WHERE id = $${params.length} RETURNING *`, params).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'PROGRAMME_NOT_FOUND', 'Loyalty programme not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /lifestyle/loyalty/:id/transactions ───────────────────────────────────

lifestyleRouter.get('/loyalty/:programmeId/transactions', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ProgrammeParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Programme ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, transaction_date, transaction_type, points_amount, miles_amount,
                  description, reference_number, created_at
           FROM   fam_loyalty_transactions WHERE programme_id = $1
           ORDER  BY transaction_date DESC, created_at DESC`,
          [parsed.data.programmeId],
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /lifestyle/loyalty/:id/transactions ──────────────────────────────────

lifestyleRouter.post('/loyalty/:programmeId/transactions', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramP = ProgrammeParam.safeParse(req.params);
    if (!paramP.success) { err(res, 422, 'VALIDATION_ERROR', 'Programme ID must be a valid UUID.'); return; }
    const bodyP = CreateTransactionSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const { userId: ownerId } = req.rlsCtx;
    const { programmeId } = paramP.data;

    const client = await familyPool.connect();
    try {
      const { tx, created } = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM fam_loyalty_transactions WHERE idempotency_key = $1`, [body.idempotency_key],
        );
        if (existing.rows.length > 0) {
          const dup = await c.query(`SELECT * FROM fam_loyalty_transactions WHERE id = $1`, [existing.rows[0].id]);
          return { tx: dup.rows[0], created: false };
        }

        // Verify programme exists.
        const prog = await c.query<{ id: string }>(`SELECT id FROM fam_loyalty_programmes WHERE id = $1`, [programmeId]);
        if (prog.rows.length === 0) throw Object.assign(new Error('PROGRAMME_NOT_FOUND'), { httpStatus: 404 });

        const result = await c.query(
          `INSERT INTO fam_loyalty_transactions
             (owner_id, programme_id, transaction_date, transaction_type,
              points_amount, miles_amount, description, reference_number, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [ownerId, programmeId, body.transaction_date, body.transaction_type,
           body.points_amount, body.miles_amount, body.description,
           body.reference_number ?? null, body.idempotency_key],
        );

        // Update programme balance.
        await c.query(
          `UPDATE fam_loyalty_programmes
           SET points_balance = points_balance + $1,
               miles_balance  = miles_balance  + $2,
               last_modified_at = now(), updated_at = now()
           WHERE id = $3`,
          [body.points_amount, body.miles_amount, programmeId],
        );

        return { tx: result.rows[0], created: true };
      });

      logger.info({ entity: 'LIFESTYLE', action: created ? 'TX_CREATED' : 'TX_DUPLICATE', user_id: ownerId, record_id: tx.id });
      ok(res, tx, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'PROGRAMME_NOT_FOUND', 'Loyalty programme not found.'); return; }
    next(e);
  }
});

// ── GET /lifestyle/tracker ────────────────────────────────────────────────────

lifestyleRouter.get('/tracker', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const memberFilter = req.query.family_member_id as string | undefined;
    const metricFilter = req.query.metric_type as string | undefined;
    const fromDate     = req.query.from_date as string | undefined;
    const toDate       = req.query.to_date as string | undefined;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (memberFilter) conditions.push(`family_member_id = ${push(memberFilter)}`);
        if (metricFilter) conditions.push(`metric_type = ${push(metricFilter)}`);
        if (fromDate)     conditions.push(`entry_date >= ${push(fromDate)}`);
        if (toDate)       conditions.push(`entry_date <= ${push(toDate)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT id, entry_date, metric_type, value, unit, family_member_id, source, notes, created_at
           FROM   fam_lifestyle_tracker ${where}
           ORDER  BY entry_date DESC, metric_type`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /lifestyle/tracker ───────────────────────────────────────────────────

lifestyleRouter.post('/tracker', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateTrackerSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fam_lifestyle_tracker
             (owner_id, entry_date, metric_type, value, unit, family_member_id, notes, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [ownerId, body.entry_date, body.metric_type, body.value, body.unit,
           body.family_member_id ?? null, body.notes ?? null, body.source ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'LIFESTYLE', action: 'TRACKER_ENTRY', user_id: ownerId, record_id: rec.id });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
