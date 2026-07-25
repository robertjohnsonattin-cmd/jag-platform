// GET   /api/v1/lifestyle/fitness/exercises
// POST  /api/v1/lifestyle/fitness/exercises
// PATCH /api/v1/lifestyle/fitness/exercises/:id
//
// GET/POST/PATCH/DELETE /api/v1/lifestyle/fitness/programs[/:id]
// POST/PATCH/DELETE      /api/v1/lifestyle/fitness/programs/:programId/workouts[/:workoutId]
// POST/PATCH/DELETE      /api/v1/lifestyle/fitness/programs/:programId/workouts/:workoutId/exercises[/:id]
//
// GET/POST/PATCH/DELETE  /api/v1/lifestyle/fitness/sessions[/:id]
// POST/PATCH/DELETE      /api/v1/lifestyle/fitness/sessions/:sessionId/logs[/:logId]
//
// GET /api/v1/lifestyle/fitness/records
// GET /api/v1/lifestyle/fitness/progress

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { aiCoachRouter } from './ai-coach';

export const fitnessRouter = Router();
fitnessRouter.use('/ai', aiCoachRouter);

const UUIDParam = z.object({ id: z.string().uuid() });

const CategoryEnum      = z.enum(['STRENGTH', 'CARDIO', 'FLEXIBILITY', 'BALANCE', 'SPORT']);
const MuscleGroupEnum   = z.enum(['CHEST', 'BACK', 'LEGS', 'SHOULDERS', 'ARMS', 'CORE', 'FULL_BODY', 'CARDIO', 'OTHER']);
const TrackingTypeEnum  = z.enum(['REPS_WEIGHT', 'TIME', 'DISTANCE', 'REPS_ONLY']);
const GoalEnum          = z.enum(['STRENGTH', 'HYPERTROPHY', 'WEIGHT_LOSS', 'ENDURANCE', 'GENERAL_FITNESS', 'REHAB', 'OTHER']);
const ProgramStatusEnum = z.enum(['ACTIVE', 'COMPLETED', 'PAUSED', 'ARCHIVED']);
const SessionStatusEnum = z.enum(['IN_PROGRESS', 'COMPLETED']);
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

type TrackingType = z.infer<typeof TrackingTypeEnum>;

// ══════════════════════════════════════════════════════════════════════════
// Exercise library
// ══════════════════════════════════════════════════════════════════════════

const CreateExerciseSchema = z.object({
  name:          z.string().min(1).max(150),
  category:      CategoryEnum,
  muscle_group:  MuscleGroupEnum.default('OTHER'),
  tracking_type: TrackingTypeEnum,
  equipment:     z.string().max(100).optional(),
  instructions:  z.string().max(4000).optional(),
}).strict();

const PatchExerciseSchema = CreateExerciseSchema.partial().extend({
  is_active: z.boolean().optional(),
}).strict().refine(o => Object.keys(o).length > 0);

fitnessRouter.get('/exercises', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { category, muscle_group, active } = req.query as Record<string, string | undefined>;
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [`is_active = ${active === 'all' ? 'is_active' : 'true'}`];
        if (category)     conditions.push(`category = ${push(category)}`);
        if (muscle_group) conditions.push(`muscle_group = ${push(muscle_group)}`);
        return c.query(
          `SELECT * FROM fam_exercises WHERE ${conditions.join(' AND ')} ORDER BY category, name`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

fitnessRouter.post('/exercises', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateExerciseSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fam_exercises
             (owner_id, name, category, muscle_group, tracking_type, equipment, instructions, is_custom, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true,$1) RETURNING *`,
          [ownerId, body.name, body.category, body.muscle_group, body.tracking_type,
           body.equipment ?? null, body.instructions ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'FITNESS', action: 'EXERCISE_CREATED', user_id: ownerId, record_id: rec.id });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

fitnessRouter.patch('/exercises/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = PatchExerciseSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const { userId: ownerId } = req.rlsCtx;
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const setCols: string[] = ['last_modified_at = now()', `last_modified_by = ${push(ownerId)}`];
    for (const [k, v] of Object.entries(body)) setCols.push(`${k} = ${push(v)}`);
    params.push(idP.data.id);
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE fam_exercises SET ${setCols.join(',')} WHERE id = $${params.length} RETURNING *`, params).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'EXERCISE_NOT_FOUND', 'Exercise not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ══════════════════════════════════════════════════════════════════════════
// Programs / plans
// ══════════════════════════════════════════════════════════════════════════

const CreateProgramSchema = z.object({
  family_member_id: z.string().uuid(),
  name:             z.string().min(1).max(150),
  goal:             GoalEnum.default('GENERAL_FITNESS'),
  description:      z.string().max(2000).optional(),
  status:           ProgramStatusEnum.default('ACTIVE'),
  start_date:       DateStr,
  end_date:         DateStr.optional(),
}).strict();

const PatchProgramSchema = CreateProgramSchema.partial().strict().refine(o => Object.keys(o).length > 0);

fitnessRouter.get('/programs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { family_member_id, status } = req.query as Record<string, string | undefined>;
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (family_member_id) conditions.push(`family_member_id = ${push(family_member_id)}`);
        if (status)            conditions.push(`status = ${push(status)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(`SELECT * FROM fam_workout_programs ${where} ORDER BY start_date DESC`, params).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

fitnessRouter.post('/programs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateProgramSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fam_workout_programs
             (owner_id, family_member_id, name, goal, description, status, start_date, end_date, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$1) RETURNING *`,
          [ownerId, body.family_member_id, body.name, body.goal, body.description ?? null,
           body.status, body.start_date, body.end_date ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'FITNESS', action: 'PROGRAM_CREATED', user_id: ownerId, record_id: rec.id });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// Full program detail: program row + workouts[] each with exercises[] nested.
fitnessRouter.get('/programs/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const result = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const prog = await c.query(`SELECT * FROM fam_workout_programs WHERE id = $1`, [idP.data.id]);
        if (prog.rows.length === 0) return null;
        const workouts = await c.query(
          `SELECT * FROM fam_program_workouts WHERE program_id = $1 ORDER BY day_order`, [idP.data.id],
        );
        const exercises = await c.query(
          `SELECT pe.*, e.name AS exercise_name, e.tracking_type, e.muscle_group
           FROM   fam_program_exercises pe
           JOIN   fam_exercises e ON e.id = pe.exercise_id
           WHERE  pe.program_workout_id = ANY($1::uuid[])
           ORDER  BY pe.order_index`,
          [workouts.rows.map(w => w.id)],
        );
        return {
          ...prog.rows[0],
          workouts: workouts.rows.map(w => ({
            ...w,
            exercises: exercises.rows.filter(e => e.program_workout_id === w.id),
          })),
        };
      });
      if (!result) { err(res, 404, 'PROGRAM_NOT_FOUND', 'Programme not found.'); return; }
      ok(res, result);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

fitnessRouter.patch('/programs/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = PatchProgramSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const { userId: ownerId } = req.rlsCtx;
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const setCols: string[] = ['last_modified_at = now()', `last_modified_by = ${push(ownerId)}`];
    for (const [k, v] of Object.entries(body)) setCols.push(`${k} = ${push(v)}`);
    params.push(idP.data.id);
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE fam_workout_programs SET ${setCols.join(',')} WHERE id = $${params.length} RETURNING *`, params).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'PROGRAM_NOT_FOUND', 'Programme not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

fitnessRouter.delete('/programs/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM fam_workout_programs WHERE id = $1 RETURNING id`, [idP.data.id]).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'PROGRAM_NOT_FOUND', 'Programme not found.'); return; }
      ok(res, { deleted: true });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Program workouts (days) ──────────────────────────────────────────────────

const CreateProgramWorkoutSchema = z.object({
  name:      z.string().min(1).max(150),
  day_order: z.number().int().default(0),
  notes:     z.string().max(1000).optional(),
}).strict();

const PatchProgramWorkoutSchema = CreateProgramWorkoutSchema.partial().strict().refine(o => Object.keys(o).length > 0);

fitnessRouter.post('/programs/:programId/workouts', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramP = z.object({ programId: z.string().uuid() }).safeParse(req.params);
    if (!paramP.success) { err(res, 422, 'VALIDATION_ERROR', 'Programme ID must be a valid UUID.'); return; }
    const bodyP = CreateProgramWorkoutSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const prog = await c.query(`SELECT id FROM fam_workout_programs WHERE id = $1`, [paramP.data.programId]);
        if (prog.rows.length === 0) throw Object.assign(new Error('PROGRAM_NOT_FOUND'), { httpStatus: 404 });
        return c.query(
          `INSERT INTO fam_program_workouts (program_id, name, day_order, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
          [paramP.data.programId, body.name, body.day_order, body.notes ?? null],
        ).then(r => r.rows[0]);
      });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'PROGRAM_NOT_FOUND', 'Programme not found.'); return; }
    next(e);
  }
});

fitnessRouter.patch('/programs/:programId/workouts/:workoutId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramP = z.object({ programId: z.string().uuid(), workoutId: z.string().uuid() }).safeParse(req.params);
    if (!paramP.success) { err(res, 422, 'VALIDATION_ERROR', 'IDs must be valid UUIDs.'); return; }
    const bodyP = PatchProgramWorkoutSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const setCols: string[] = [];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    for (const [k, v] of Object.entries(body)) setCols.push(`${k} = ${push(v)}`);
    params.push(paramP.data.workoutId, paramP.data.programId);
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE fam_program_workouts SET ${setCols.join(',')} WHERE id = $${params.length - 1} AND program_id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'WORKOUT_NOT_FOUND', 'Workout day not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

fitnessRouter.delete('/programs/:programId/workouts/:workoutId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramP = z.object({ programId: z.string().uuid(), workoutId: z.string().uuid() }).safeParse(req.params);
    if (!paramP.success) { err(res, 422, 'VALIDATION_ERROR', 'IDs must be valid UUIDs.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `DELETE FROM fam_program_workouts WHERE id = $1 AND program_id = $2 RETURNING id`,
          [paramP.data.workoutId, paramP.data.programId],
        ).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'WORKOUT_NOT_FOUND', 'Workout day not found.'); return; }
      ok(res, { deleted: true });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Planned exercises within a workout day ───────────────────────────────────

const CreateProgramExerciseSchema = z.object({
  exercise_id:              z.string().uuid(),
  order_index:              z.number().int().default(0),
  target_sets:              z.number().int().positive().optional(),
  target_reps_min:          z.number().int().positive().optional(),
  target_reps_max:          z.number().int().positive().optional(),
  target_weight:            z.number().positive().optional(),
  target_duration_seconds:  z.number().int().positive().optional(),
  target_distance:          z.number().positive().optional(),
  rest_seconds:             z.number().int().positive().optional(),
  notes:                    z.string().max(500).optional(),
}).strict();

const PatchProgramExerciseSchema = CreateProgramExerciseSchema.partial().strict().refine(o => Object.keys(o).length > 0);

fitnessRouter.post('/programs/:programId/workouts/:workoutId/exercises', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramP = z.object({ programId: z.string().uuid(), workoutId: z.string().uuid() }).safeParse(req.params);
    if (!paramP.success) { err(res, 422, 'VALIDATION_ERROR', 'IDs must be valid UUIDs.'); return; }
    const bodyP = CreateProgramExerciseSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const wo = await c.query(
          `SELECT id FROM fam_program_workouts WHERE id = $1 AND program_id = $2`,
          [paramP.data.workoutId, paramP.data.programId],
        );
        if (wo.rows.length === 0) throw Object.assign(new Error('WORKOUT_NOT_FOUND'), { httpStatus: 404 });
        return c.query(
          `INSERT INTO fam_program_exercises
             (program_workout_id, exercise_id, order_index, target_sets, target_reps_min, target_reps_max,
              target_weight, target_duration_seconds, target_distance, rest_seconds, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [paramP.data.workoutId, body.exercise_id, body.order_index, body.target_sets ?? null,
           body.target_reps_min ?? null, body.target_reps_max ?? null, body.target_weight ?? null,
           body.target_duration_seconds ?? null, body.target_distance ?? null, body.rest_seconds ?? null,
           body.notes ?? null],
        ).then(r => r.rows[0]);
      });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'WORKOUT_NOT_FOUND', 'Workout day not found.'); return; }
    next(e);
  }
});

fitnessRouter.patch('/programs/:programId/workouts/:workoutId/exercises/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramP = z.object({ workoutId: z.string().uuid(), id: z.string().uuid() }).safeParse(req.params);
    if (!paramP.success) { err(res, 422, 'VALIDATION_ERROR', 'IDs must be valid UUIDs.'); return; }
    const bodyP = PatchProgramExerciseSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const setCols: string[] = [];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    for (const [k, v] of Object.entries(body)) setCols.push(`${k} = ${push(v)}`);
    params.push(paramP.data.id, paramP.data.workoutId);
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE fam_program_exercises SET ${setCols.join(',')} WHERE id = $${params.length - 1} AND program_workout_id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'PROGRAM_EXERCISE_NOT_FOUND', 'Planned exercise not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

fitnessRouter.delete('/programs/:programId/workouts/:workoutId/exercises/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramP = z.object({ workoutId: z.string().uuid(), id: z.string().uuid() }).safeParse(req.params);
    if (!paramP.success) { err(res, 422, 'VALIDATION_ERROR', 'IDs must be valid UUIDs.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `DELETE FROM fam_program_exercises WHERE id = $1 AND program_workout_id = $2 RETURNING id`,
          [paramP.data.id, paramP.data.workoutId],
        ).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'PROGRAM_EXERCISE_NOT_FOUND', 'Planned exercise not found.'); return; }
      ok(res, { deleted: true });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ══════════════════════════════════════════════════════════════════════════
// Sessions (actual logged workouts) + set logs
// ══════════════════════════════════════════════════════════════════════════

const CreateSessionSchema = z.object({
  family_member_id:   z.string().uuid(),
  program_workout_id: z.string().uuid().optional(),
  session_date:        DateStr,
  duration_minutes:    z.number().int().positive().optional(),
  perceived_exertion:  z.number().int().min(1).max(10).optional(),
  notes:               z.string().max(2000).optional(),
}).strict();

const PatchSessionSchema = z.object({
  duration_minutes:   z.number().int().positive().optional(),
  status:              SessionStatusEnum.optional(),
  perceived_exertion:  z.number().int().min(1).max(10).optional(),
  notes:               z.string().max(2000).optional(),
}).strict().refine(o => Object.keys(o).length > 0);

fitnessRouter.get('/sessions', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { family_member_id, from_date, to_date, status } = req.query as Record<string, string | undefined>;
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (family_member_id) conditions.push(`s.family_member_id = ${push(family_member_id)}`);
        if (from_date)         conditions.push(`s.session_date >= ${push(from_date)}`);
        if (to_date)           conditions.push(`s.session_date <= ${push(to_date)}`);
        if (status)            conditions.push(`s.status = ${push(status)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT s.*, pw.name AS workout_name,
                  (SELECT COUNT(*) FROM fam_exercise_logs l WHERE l.session_id = s.id) AS set_count
           FROM   fam_workout_sessions s
           LEFT   JOIN fam_program_workouts pw ON pw.id = s.program_workout_id
           ${where}
           ORDER  BY s.session_date DESC, s.created_at DESC`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

fitnessRouter.post('/sessions', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fam_workout_sessions
             (owner_id, family_member_id, program_workout_id, session_date, duration_minutes, perceived_exertion, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [ownerId, body.family_member_id, body.program_workout_id ?? null, body.session_date,
           body.duration_minutes ?? null, body.perceived_exertion ?? null, body.notes ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'FITNESS', action: 'SESSION_STARTED', user_id: ownerId, record_id: rec.id });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

fitnessRouter.get('/sessions/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const result = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const session = await c.query(`SELECT * FROM fam_workout_sessions WHERE id = $1`, [idP.data.id]);
        if (session.rows.length === 0) return null;
        const logs = await c.query(
          `SELECT l.*, e.name AS exercise_name, e.tracking_type
           FROM   fam_exercise_logs l
           JOIN   fam_exercises e ON e.id = l.exercise_id
           WHERE  l.session_id = $1
           ORDER  BY l.created_at`,
          [idP.data.id],
        );
        return { ...session.rows[0], logs: logs.rows };
      });
      if (!result) { err(res, 404, 'SESSION_NOT_FOUND', 'Workout session not found.'); return; }
      ok(res, result);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

fitnessRouter.patch('/sessions/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = PatchSessionSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const setCols: string[] = ['last_modified_at = now()'];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    for (const [k, v] of Object.entries(body)) setCols.push(`${k} = ${push(v)}`);
    params.push(idP.data.id);
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE fam_workout_sessions SET ${setCols.join(',')} WHERE id = $${params.length} RETURNING *`, params).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'SESSION_NOT_FOUND', 'Workout session not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

fitnessRouter.delete('/sessions/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM fam_workout_sessions WHERE id = $1 RETURNING id`, [idP.data.id]).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'SESSION_NOT_FOUND', 'Workout session not found.'); return; }
      ok(res, { deleted: true });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Set logs ─────────────────────────────────────────────────────────────────

const CreateLogSchema = z.object({
  exercise_id:       z.string().uuid(),
  set_number:        z.number().int().positive().optional(),
  reps:              z.number().int().positive().optional(),
  weight:            z.number().positive().optional(),
  weight_unit:       z.enum(['lb', 'kg']).default('kg'),
  duration_seconds:  z.number().int().positive().optional(),
  distance:          z.number().positive().optional(),
  distance_unit:     z.string().max(10).optional(),
  rpe:               z.number().int().min(1).max(10).optional(),
  is_warmup:         z.boolean().default(false),
  notes:             z.string().max(500).optional(),
}).strict();

const PatchLogSchema = CreateLogSchema.partial().strict().refine(o => Object.keys(o).length > 0);

// Upserts a fam_personal_records row only if the new value beats the stored one.
async function upsertIfBetter(c: PoolClient, params: {
  ownerId: string; familyMemberId: string; exerciseId: string; recordType: string;
  value: number; unit: string; achievedDate: string; sessionId: string; exerciseLogId: string | null;
  lowerIsBetter?: boolean;
}): Promise<boolean> {
  const existing = await c.query<{ id: string; value: string }>(
    `SELECT id, value FROM fam_personal_records WHERE family_member_id = $1 AND exercise_id = $2 AND record_type = $3`,
    [params.familyMemberId, params.exerciseId, params.recordType],
  );
  if (existing.rows.length > 0) {
    const current = parseFloat(existing.rows[0].value);
    const beats = params.lowerIsBetter ? params.value < current : params.value > current;
    if (!beats) return false;
  }
  await c.query(
    `INSERT INTO fam_personal_records
       (owner_id, family_member_id, exercise_id, record_type, value, unit, achieved_date, session_id, exercise_log_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (family_member_id, exercise_id, record_type)
     DO UPDATE SET value = $5, unit = $6, achieved_date = $7, session_id = $8, exercise_log_id = $9, updated_at = now()`,
    [params.ownerId, params.familyMemberId, params.exerciseId, params.recordType, params.value,
     params.unit, params.achievedDate, params.sessionId, params.exerciseLogId],
  );
  return true;
}

async function checkAndUpdatePersonalRecords(
  c: PoolClient,
  ownerId: string,
  familyMemberId: string,
  exercise: { id: string; tracking_type: TrackingType },
  log: { reps: number | null; weight: number | null; weight_unit: string; duration_seconds: number | null; distance: number | null; distance_unit: string | null },
  sessionId: string,
  exerciseLogId: string,
  achievedDate: string,
): Promise<void> {
  const base = { ownerId, familyMemberId, exerciseId: exercise.id, sessionId, exerciseLogId, achievedDate };

  if (exercise.tracking_type === 'REPS_WEIGHT' && log.weight != null && log.weight > 0) {
    await upsertIfBetter(c, { ...base, recordType: 'MAX_WEIGHT', value: log.weight, unit: log.weight_unit });
    if (log.reps != null && log.reps > 0) {
      const est1rm = log.weight * (1 + log.reps / 30);
      await upsertIfBetter(c, { ...base, recordType: 'MAX_1RM_EST', value: Math.round(est1rm * 100) / 100, unit: log.weight_unit });
    }
    // Session volume for this exercise (sum reps*weight across all non-warmup sets so far).
    const vol = await c.query<{ total: string | null }>(
      `SELECT SUM(reps * weight) AS total FROM fam_exercise_logs
       WHERE session_id = $1 AND exercise_id = $2 AND is_warmup = false AND reps IS NOT NULL AND weight IS NOT NULL`,
      [sessionId, exercise.id],
    );
    const totalVolume = parseFloat(vol.rows[0]?.total ?? '0');
    if (totalVolume > 0) await upsertIfBetter(c, { ...base, recordType: 'MAX_VOLUME', value: totalVolume, unit: log.weight_unit });
  }

  if (exercise.tracking_type === 'REPS_ONLY' && log.reps != null && log.reps > 0) {
    await upsertIfBetter(c, { ...base, recordType: 'MAX_REPS', value: log.reps, unit: 'reps' });
  }

  if (exercise.tracking_type === 'TIME' && log.duration_seconds != null && log.duration_seconds > 0) {
    await upsertIfBetter(c, { ...base, recordType: 'BEST_TIME', value: log.duration_seconds, unit: 'seconds' });
  }

  if (exercise.tracking_type === 'DISTANCE' && log.distance != null && log.distance > 0) {
    await upsertIfBetter(c, { ...base, recordType: 'BEST_DISTANCE', value: log.distance, unit: log.distance_unit ?? 'km' });
  }
}

fitnessRouter.post('/sessions/:sessionId/logs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramP = z.object({ sessionId: z.string().uuid() }).safeParse(req.params);
    if (!paramP.success) { err(res, 422, 'VALIDATION_ERROR', 'Session ID must be a valid UUID.'); return; }
    const bodyP = CreateLogSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const session = await c.query<{ id: string; family_member_id: string; session_date: string }>(
          `SELECT id, family_member_id, session_date::text FROM fam_workout_sessions WHERE id = $1`,
          [paramP.data.sessionId],
        );
        if (session.rows.length === 0) throw Object.assign(new Error('SESSION_NOT_FOUND'), { httpStatus: 404 });

        const exercise = await c.query<{ id: string; tracking_type: TrackingType }>(
          `SELECT id, tracking_type FROM fam_exercises WHERE id = $1`, [body.exercise_id],
        );
        if (exercise.rows.length === 0) throw Object.assign(new Error('EXERCISE_NOT_FOUND'), { httpStatus: 404 });

        let setNumber = body.set_number;
        if (setNumber == null) {
          const max = await c.query<{ max: number | null }>(
            `SELECT MAX(set_number) AS max FROM fam_exercise_logs WHERE session_id = $1 AND exercise_id = $2`,
            [paramP.data.sessionId, body.exercise_id],
          );
          setNumber = (max.rows[0]?.max ?? 0) + 1;
        }

        const log = await c.query(
          `INSERT INTO fam_exercise_logs
             (session_id, exercise_id, set_number, reps, weight, weight_unit, duration_seconds, distance, distance_unit, rpe, is_warmup, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [paramP.data.sessionId, body.exercise_id, setNumber, body.reps ?? null, body.weight ?? null,
           body.weight_unit, body.duration_seconds ?? null, body.distance ?? null, body.distance_unit ?? null,
           body.rpe ?? null, body.is_warmup, body.notes ?? null],
        ).then(r => r.rows[0]);

        if (!body.is_warmup) {
          await checkAndUpdatePersonalRecords(
            c, ownerId, session.rows[0].family_member_id, exercise.rows[0],
            { reps: body.reps ?? null, weight: body.weight ?? null, weight_unit: body.weight_unit,
              duration_seconds: body.duration_seconds ?? null, distance: body.distance ?? null, distance_unit: body.distance_unit ?? null },
            paramP.data.sessionId, log.id, session.rows[0].session_date,
          );
        }

        return log;
      });
      logger.info({ entity: 'FITNESS', action: 'SET_LOGGED', user_id: ownerId, record_id: rec.id });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) {
    const httpStatus = (e as { httpStatus?: number }).httpStatus;
    if (httpStatus === 404) {
      const code = (e as Error).message === 'EXERCISE_NOT_FOUND' ? 'EXERCISE_NOT_FOUND' : 'SESSION_NOT_FOUND';
      err(res, 404, code, code === 'EXERCISE_NOT_FOUND' ? 'Exercise not found.' : 'Workout session not found.');
      return;
    }
    next(e);
  }
});

fitnessRouter.patch('/sessions/:sessionId/logs/:logId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramP = z.object({ sessionId: z.string().uuid(), logId: z.string().uuid() }).safeParse(req.params);
    if (!paramP.success) { err(res, 422, 'VALIDATION_ERROR', 'IDs must be valid UUIDs.'); return; }
    const bodyP = PatchLogSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const setCols: string[] = [];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    for (const [k, v] of Object.entries(body)) setCols.push(`${k} = ${push(v)}`);
    params.push(paramP.data.logId, paramP.data.sessionId);
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE fam_exercise_logs SET ${setCols.join(',')} WHERE id = $${params.length - 1} AND session_id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'LOG_NOT_FOUND', 'Set log not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

fitnessRouter.delete('/sessions/:sessionId/logs/:logId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramP = z.object({ sessionId: z.string().uuid(), logId: z.string().uuid() }).safeParse(req.params);
    if (!paramP.success) { err(res, 422, 'VALIDATION_ERROR', 'IDs must be valid UUIDs.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `DELETE FROM fam_exercise_logs WHERE id = $1 AND session_id = $2 RETURNING id`,
          [paramP.data.logId, paramP.data.sessionId],
        ).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'LOG_NOT_FOUND', 'Set log not found.'); return; }
      ok(res, { deleted: true });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ══════════════════════════════════════════════════════════════════════════
// Records (PRs) + Progress (chart time-series)
// ══════════════════════════════════════════════════════════════════════════

fitnessRouter.get('/records', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { family_member_id, exercise_id } = req.query as Record<string, string | undefined>;
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (family_member_id) conditions.push(`r.family_member_id = ${push(family_member_id)}`);
        if (exercise_id)       conditions.push(`r.exercise_id = ${push(exercise_id)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT r.*, e.name AS exercise_name, e.tracking_type
           FROM   fam_personal_records r
           JOIN   fam_exercises e ON e.id = r.exercise_id
           ${where}
           ORDER  BY r.achieved_date DESC`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

const ProgressMetricEnum = z.enum(['weight', 'est_1rm', 'volume', 'reps', 'distance', 'time']);

const PROGRESS_EXPR: Record<z.infer<typeof ProgressMetricEnum>, string> = {
  weight:   `MAX(l.weight)`,
  est_1rm:  `MAX(l.weight * (1 + l.reps / 30.0))`,
  volume:   `SUM(l.reps * l.weight)`,
  reps:     `MAX(l.reps)`,
  distance: `MAX(l.distance)`,
  time:     `MAX(l.duration_seconds)`,
};

fitnessRouter.get('/progress', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = z.object({
      family_member_id: z.string().uuid(),
      exercise_id:       z.string().uuid(),
      metric:            ProgressMetricEnum,
    }).safeParse(req.query);
    if (!q.success) { err(res, 422, 'VALIDATION_ERROR', 'family_member_id, exercise_id, and a valid metric are required.'); return; }
    const { family_member_id, exercise_id, metric } = q.data;
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT s.session_date::text AS date, ${PROGRESS_EXPR[metric]} AS value
           FROM   fam_exercise_logs l
           JOIN   fam_workout_sessions s ON s.id = l.session_id
           WHERE  s.family_member_id = $1 AND l.exercise_id = $2 AND l.is_warmup = false
           GROUP  BY s.session_date
           ORDER  BY s.session_date`,
          [family_member_id, exercise_id],
        ).then(r => r.rows.map(row => ({ date: row.date, value: row.value == null ? null : parseFloat(row.value) }))),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
