// GET /api/v1/lifestyle/fitness/ai/profile?family_member_id=
// PUT /api/v1/lifestyle/fitness/ai/profile
// GET /api/v1/lifestyle/fitness/ai/checkins?family_member_id=
// POST /api/v1/lifestyle/fitness/ai/suggest
//
// AI-suggested workouts are not a separate data structure — they're inserted as a
// normal fam_workout_programs (ai_generated=true) + fam_program_workouts +
// fam_program_exercises row set, so the existing Programs/Log Workout/Progress
// tabs and PR pipeline work on them unchanged.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const aiCoachRouter = Router();

const GoalEnum = z.enum(['STRENGTH', 'HYPERTROPHY', 'WEIGHT_LOSS', 'ENDURANCE', 'GENERAL_FITNESS', 'REHAB', 'OTHER']);
const FitnessLevelEnum = z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
const ActivityLevelEnum = z.enum(['SEDENTARY', 'LIGHTLY_ACTIVE', 'MODERATELY_ACTIVE', 'VERY_ACTIVE', 'EXTREMELY_ACTIVE']);
const EquipmentAccessEnum = z.enum(['HOME_BASIC', 'HOME_FULL', 'COMMERCIAL_GYM', 'BODYWEIGHT_ONLY', 'OTHER']);
const BiologicalSexEnum = z.enum(['MALE', 'FEMALE', 'UNSPECIFIED']);

// ══════════════════════════════════════════════════════════════════════════
// Fitness profile
// ══════════════════════════════════════════════════════════════════════════

const UpsertProfileSchema = z.object({
  family_member_id:     z.string().uuid(),
  primary_goal:         GoalEnum.default('GENERAL_FITNESS'),
  fitness_level:         FitnessLevelEnum.default('BEGINNER'),
  activity_level:        ActivityLevelEnum.default('MODERATELY_ACTIVE'),
  biological_sex:        BiologicalSexEnum.default('UNSPECIFIED'),
  height_cm:             z.number().positive().optional(),
  weight_kg:             z.number().positive().optional(),
  body_fat_pct:          z.number().min(0).max(100).optional(),
  equipment_access:      EquipmentAccessEnum.default('HOME_BASIC'),
  days_per_week_target:  z.number().int().min(1).max(7).optional(),
  injuries_limitations:  z.string().max(2000).optional(),
}).strict();

aiCoachRouter.get('/profile', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = z.object({ family_member_id: z.string().uuid() }).safeParse(req.query);
    if (!q.success) { err(res, 422, 'VALIDATION_ERROR', 'family_member_id is required.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fam_fitness_profiles WHERE family_member_id = $1`, [q.data.family_member_id])
          .then(r => r.rows[0] ?? null),
      );
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

aiCoachRouter.put('/profile', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UpsertProfileSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fam_fitness_profiles
             (owner_id, family_member_id, primary_goal, fitness_level, activity_level, biological_sex,
              height_cm, weight_kg, body_fat_pct, equipment_access, days_per_week_target, injuries_limitations)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (family_member_id) DO UPDATE SET
             primary_goal = $3, fitness_level = $4, activity_level = $5, biological_sex = $6,
             height_cm = $7, weight_kg = $8, body_fat_pct = $9, equipment_access = $10,
             days_per_week_target = $11, injuries_limitations = $12, last_modified_at = now()
           RETURNING *`,
          [ownerId, body.family_member_id, body.primary_goal, body.fitness_level, body.activity_level,
           body.biological_sex, body.height_cm ?? null, body.weight_kg ?? null, body.body_fat_pct ?? null,
           body.equipment_access, body.days_per_week_target ?? null, body.injuries_limitations ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'FITNESS', action: 'AI_PROFILE_SAVED', user_id: ownerId, record_id: rec.id });
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ══════════════════════════════════════════════════════════════════════════
// Check-ins
// ══════════════════════════════════════════════════════════════════════════

aiCoachRouter.get('/checkins', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = z.object({ family_member_id: z.string().uuid() }).safeParse(req.query);
    if (!q.success) { err(res, 422, 'VALIDATION_ERROR', 'family_member_id is required.'); return; }
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT * FROM fam_fitness_checkins WHERE family_member_id = $1 ORDER BY created_at DESC LIMIT 20`,
          [q.data.family_member_id],
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ══════════════════════════════════════════════════════════════════════════
// Suggest a workout
// ══════════════════════════════════════════════════════════════════════════

const SuggestSchema = z.object({
  family_member_id:        z.string().uuid(),
  energy_level:             z.number().int().min(1).max(5),
  soreness_level:           z.number().int().min(1).max(5),
  time_available_minutes:  z.number().int().positive().optional(),
  focus_override:           GoalEnum.optional(),
  notes:                    z.string().max(500).optional(),
}).strict();

/**
 * PRIVACY BOUNDARY, not just a formatting map. Whatever is listed here is read
 * out of `fam_lifestyle_tracker` and sent to the Gemini API in the coach prompt.
 * Everything else in that table stays on our own infrastructure.
 *
 * Lab-derived values (total/LDL/HDL cholesterol, triglycerides, blood glucose)
 * were REMOVED on 2026-07-31 at Robert's instruction. They reach this table via
 * medical-record extraction, so including them meant clinical results off a
 * family member's lab report were leaving for a third-party API in order to
 * generate a workout. The coach reasons mainly from weight, sleep, resting heart
 * rate and blood pressure, so little is lost.
 *
 * Before adding a metric, ask whether it is fitness telemetry or a clinical
 * result — clinical results do not belong here. `fam_lifestyle_tracker` is
 * SHARED with Medical Records (see the extract-medical-records workflow), so new
 * clinical metric types will keep appearing in that table over time; they must
 * not be added to this map. The keys are also used to scope the SQL query, so a
 * value omitted here is never even loaded into this process.
 */
const COACH_HEALTH_METRIC_LABELS: Record<string, string> = {
  WEIGHT_KG: 'Weight (latest tracker entry)', STEPS: 'Steps (latest)', SLEEP_HOURS: 'Sleep last night',
  CALORIES: 'Calories (latest)', EXERCISE_MINUTES: 'Exercise minutes (latest)',
  BLOOD_PRESSURE_SYSTOLIC: 'Blood pressure — systolic', BLOOD_PRESSURE_DIASTOLIC: 'Blood pressure — diastolic',
  RESTING_HEART_RATE: 'Resting heart rate',
};
const COACH_HEALTH_METRIC_TYPES = Object.keys(COACH_HEALTH_METRIC_LABELS);

interface LibraryExercise {
  id: string; name: string; category: string; muscle_group: string;
  tracking_type: string; equipment: string | null;
}

interface GeminiExercise {
  exercise_id: string; target_sets: number; target_reps_min: number;
  target_reps_max: number; rest_seconds?: number; notes?: string;
}

interface GeminiSuggestion {
  session_title: string; focus_summary: string; estimated_duration_minutes: number;
  coaching_note: string; exercises: GeminiExercise[];
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

aiCoachRouter.post('/suggest', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = SuggestSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) { err(res, 503, 'CONFIG_ERROR', 'GEMINI_API_KEY not configured.'); return; }
    const geminiModel = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

    const client = await familyPool.connect();
    try {
      // ── Gather context ────────────────────────────────────────────────────
      const context = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const member = await c.query<{ first_name: string; date_of_birth: string | null }>(
          `SELECT first_name, date_of_birth::text FROM fam_family_members WHERE id = $1`,
          [body.family_member_id],
        );
        if (member.rows.length === 0) throw Object.assign(new Error('MEMBER_NOT_FOUND'), { httpStatus: 404 });

        const profile = await c.query(
          `SELECT * FROM fam_fitness_profiles WHERE family_member_id = $1`, [body.family_member_id],
        );
        if (profile.rows.length === 0) throw Object.assign(new Error('PROFILE_REQUIRED'), { httpStatus: 404 });

        // Recent training — both at muscle-group level (should we hit this area at
        // all today) and specific exercise level (should we vary the movement even
        // within the same muscle group, so consecutive sessions don't feel identical).
        const recentTraining = await c.query<{ muscle_group: string; exercise_name: string; session_date: string }>(
          `SELECT e.muscle_group, e.name AS exercise_name, s.session_date::text
           FROM fam_workout_sessions s
           JOIN fam_exercise_logs l ON l.session_id = s.id
           JOIN fam_exercises e ON e.id = l.exercise_id
           WHERE s.family_member_id = $1 AND s.session_date >= CURRENT_DATE - INTERVAL '7 days'
           ORDER BY s.session_date DESC`,
          [body.family_member_id],
        );

        // Most recent Health Tracker reading per metric (Lifestyle module) — gives
        // the coach real physiological context (resting HR, BP, sleep, weight trend,
        // daily activity) instead of only the static profile fields.
        // Scoped to COACH_HEALTH_METRIC_TYPES at the QUERY, not just when building
        // the prompt: this table also holds clinical lab values, and those must
        // never be loaded into a request that ends in a third-party API call.
        const healthMetrics = await c.query<{ metric_type: string; value: string; unit: string; entry_date: string }>(
          `SELECT DISTINCT ON (metric_type) metric_type, value, unit, entry_date::text
           FROM fam_lifestyle_tracker
           WHERE family_member_id = $1 AND entry_date >= CURRENT_DATE - INTERVAL '30 days'
             AND metric_type = ANY($2)
           ORDER BY metric_type, entry_date DESC`,
          [body.family_member_id, COACH_HEALTH_METRIC_TYPES],
        );

        const library = await c.query<LibraryExercise>(
          `SELECT id, name, category, muscle_group, tracking_type, equipment
           FROM fam_exercises WHERE is_active = true ORDER BY category, name`,
        );

        return {
          member: member.rows[0],
          profile: profile.rows[0],
          recentMuscleGroups: [...new Set(recentTraining.rows.map(r => r.muscle_group))],
          recentExercises: [...new Set(recentTraining.rows.map(r => r.exercise_name))],
          healthMetrics: healthMetrics.rows,
          library: library.rows,
        };
      });

      const { member, profile, recentMuscleGroups, recentExercises, healthMetrics, library } = context;
      const age = ageFromDob(member.date_of_birth);

      // ── Build prompt ─────────────────────────────────────────────────────
      const bodyStatsLines = [
        profile.height_cm ? `Height: ${profile.height_cm} cm` : null,
        profile.weight_kg ? `Weight: ${profile.weight_kg} kg` : null,
        profile.body_fat_pct ? `Body fat: ${profile.body_fat_pct}%` : null,
      ].filter(Boolean).join('\n- ');

      const healthLines = healthMetrics
        .filter(m => COACH_HEALTH_METRIC_LABELS[m.metric_type])
        .map(m => `${COACH_HEALTH_METRIC_LABELS[m.metric_type]}: ${m.value} ${m.unit} (logged ${m.entry_date})`)
        .join('\n- ');

      const exerciseListText = library
        .map(e => `${e.id} | ${e.name} | ${e.category}/${e.muscle_group} | ${e.tracking_type}${e.equipment ? ` | ${e.equipment}` : ''}`)
        .join('\n');

      const prompt = `You are a world-class certified personal trainer and strength & conditioning coach, known for evidence-based programming and never giving generic, one-size-fits-all advice. Design ONE workout session for today, personalised to this specific person's profile and current state.

Person:
- Name: ${member.first_name}${age != null ? `, Age: ${age}` : ''}${profile.biological_sex !== 'UNSPECIFIED' ? `, Biological sex: ${profile.biological_sex}` : ''}
- Primary goal: ${body.focus_override ?? profile.primary_goal}
- Fitness level: ${profile.fitness_level}
- Activity level (outside workouts): ${profile.activity_level}
${bodyStatsLines ? `- ${bodyStatsLines}` : ''}
- Equipment access: ${profile.equipment_access}
${profile.injuries_limitations ? `- Injuries/limitations (respect these strictly — substitute or omit any exercise that would aggravate them): ${profile.injuries_limitations}` : ''}
${healthLines ? `\nRecent health data from their tracker (use this like a trainer would — e.g. moderate intensity if resting heart rate is elevated or sleep was short, even if their stated energy is high):\n- ${healthLines}` : ''}

Today's check-in:
- Energy level (1=exhausted, 5=very energetic): ${body.energy_level}
- Soreness level (1=none, 5=very sore): ${body.soreness_level}
${body.time_available_minutes ? `- Time available: ${body.time_available_minutes} minutes` : ''}
${body.notes ? `- Notes: ${body.notes}` : ''}
${recentMuscleGroups.length > 0 ? `- Muscle groups trained in the last 7 days (avoid repeating unless it's a deliberate low-soreness recovery session or a high-frequency goal like ENDURANCE): ${recentMuscleGroups.join(', ')}` : ''}
${recentExercises.length > 0 ? `- Specific exercises already used in the last 7 days (for variety, prefer a DIFFERENT exercise targeting the same muscle group over repeating one of these, when the library has an equivalent option): ${recentExercises.join(', ')}` : ''}

Rules:
- Pick exercises ONLY from this exact list, referencing them by their id (left column). Do not invent exercises.
- Vary exercise selection like a real coach would — rotate between the different movement options available for each muscle group across sessions rather than defaulting to the same one or two exercises every time. The library has multiple variations per muscle group specifically so sessions don't feel repetitive.
- Programme like a professional: balance push/pull, upper/lower, and include a hip-hinge or squat pattern across a training week rather than isolating one pattern every session.
- If energy is low, soreness is high, resting heart rate is elevated, or sleep was short, favour lighter volume, lower-impact exercises, or active recovery — do not push a max-effort session regardless of what the stated goal is.
- If cholesterol, triglycerides, or blood glucose readings are elevated, weight the session toward more cardiovascular/aerobic volume and steady moderate intensity rather than pure max-strength work, and mention this reasoning briefly in the coaching note — this is general fitness-programming judgment, not medical advice, so do not diagnose or suggest medication.
- Keep the session realistic for the time available.
- target_reps_min/target_reps_max should be a sensible rep range for the goal (e.g. lower reps for STRENGTH, higher for HYPERTROPHY/ENDURANCE). For TIME or DISTANCE tracked exercises, use target_reps_min=target_reps_max=1 (one "set" of the activity) and put duration/distance guidance in notes.

Exercise library (id | name | category/muscle_group | tracking_type | equipment):
${exerciseListText}`;

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  session_title:              { type: 'STRING' },
                  focus_summary:              { type: 'STRING' },
                  estimated_duration_minutes: { type: 'INTEGER' },
                  coaching_note:              { type: 'STRING' },
                  exercises: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        exercise_id:      { type: 'STRING' },
                        target_sets:      { type: 'INTEGER' },
                        target_reps_min:  { type: 'INTEGER' },
                        target_reps_max:  { type: 'INTEGER' },
                        rest_seconds:     { type: 'INTEGER' },
                        notes:            { type: 'STRING' },
                      },
                      required: ['exercise_id', 'target_sets', 'target_reps_min', 'target_reps_max'],
                    },
                  },
                },
                required: ['session_title', 'focus_summary', 'estimated_duration_minutes', 'coaching_note', 'exercises'],
              },
            },
          }),
        },
      );

      if (!geminiRes.ok) {
        const bodyText = await geminiRes.text();
        logger.error({ entity: 'FITNESS', action: 'AI_COACH_GEMINI_ERROR', status: geminiRes.status, body: bodyText });
        // 503, not 502/504 — Cloudflare's edge silently replaces those two with its own
        // branded error page (plain text, no body) even when the origin sends valid JSON,
        // which broke this exact response for the browser. 503 passes through unmodified.
        err(res, 503, 'UPSTREAM_ERROR', 'Gemini unavailable.'); return;
      }

      type GeminiResp = { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
      const geminiData = (await geminiRes.json()) as GeminiResp;
      const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      let suggestion: GeminiSuggestion | null = null;
      try { suggestion = JSON.parse(raw) as GeminiSuggestion; } catch { /* schema enforcement means this rarely fires */ }

      if (!suggestion) { err(res, 503, 'UPSTREAM_ERROR', 'Could not parse Gemini response.'); return; }

      // Defensive: never trust the model to only emit real exercise IDs.
      const validIds = new Set(library.map(e => e.id));
      const validExercises = suggestion.exercises.filter(ex => validIds.has(ex.exercise_id));

      // ── Persist as a normal program/workout/exercises + checkin ───────────
      const result = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const program = await c.query(
          `INSERT INTO fam_workout_programs
             (owner_id, family_member_id, name, goal, description, status, start_date, ai_generated)
           VALUES ($1,$2,$3,$4,$5,'ACTIVE',CURRENT_DATE,true) RETURNING *`,
          [ownerId, body.family_member_id, suggestion!.session_title,
           body.focus_override ?? profile.primary_goal, suggestion!.coaching_note],
        ).then(r => r.rows[0]);

        const workout = await c.query(
          `INSERT INTO fam_program_workouts (program_id, name, day_order, notes)
           VALUES ($1,$2,0,$3) RETURNING *`,
          [program.id, suggestion!.session_title, suggestion!.focus_summary],
        ).then(r => r.rows[0]);

        for (let i = 0; i < validExercises.length; i++) {
          const ex = validExercises[i];
          await c.query(
            `INSERT INTO fam_program_exercises
               (program_workout_id, exercise_id, order_index, target_sets, target_reps_min, target_reps_max, rest_seconds, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [workout.id, ex.exercise_id, i, ex.target_sets, ex.target_reps_min, ex.target_reps_max,
             ex.rest_seconds ?? null, ex.notes ?? null],
          );
        }

        const checkin = await c.query(
          `INSERT INTO fam_fitness_checkins
             (owner_id, family_member_id, energy_level, soreness_level, time_available_minutes, focus_override, notes, suggested_program_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [ownerId, body.family_member_id, body.energy_level, body.soreness_level,
           body.time_available_minutes ?? null, body.focus_override ?? null, body.notes ?? null, program.id],
        ).then(r => r.rows[0]);

        const exercises = await c.query(
          `SELECT pe.*, e.name AS exercise_name, e.tracking_type, e.muscle_group
           FROM fam_program_exercises pe JOIN fam_exercises e ON e.id = pe.exercise_id
           WHERE pe.program_workout_id = $1 ORDER BY pe.order_index`,
          [workout.id],
        );

        return {
          program: { ...program, workouts: [{ ...workout, exercises: exercises.rows }] },
          checkin,
          focus_summary: suggestion!.focus_summary,
          coaching_note: suggestion!.coaching_note,
          estimated_duration_minutes: suggestion!.estimated_duration_minutes,
        };
      });

      logger.info({ entity: 'FITNESS', action: 'AI_SUGGESTION_CREATED', user_id: ownerId, record_id: result.program.id });
      ok(res, result, 201);
    } finally { client.release(); }
  } catch (e) {
    const httpStatus = (e as { httpStatus?: number }).httpStatus;
    if (httpStatus === 404) {
      const code = (e as Error).message;
      err(res, 404, code, code === 'PROFILE_REQUIRED' ? 'Set up a fitness profile for this person first.' : 'Family member not found.');
      return;
    }
    next(e);
  }
});
