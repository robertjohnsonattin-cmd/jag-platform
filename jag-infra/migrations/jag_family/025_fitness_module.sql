-- jag_family — Migration 025: Full Health & Fitness module
-- Run against jag_family as jag_app.
--
-- Adds a full workout tracking system alongside the existing simple body-metric
-- tracker (fam_lifestyle_tracker): a shared exercise library, per-family-member
-- workout programs/plans, actual logged sessions with sets, and auto-maintained
-- personal records (PRs).
--
-- fam_exercises        — shared exercise library (owner-scoped, not per-member)
-- fam_workout_programs — a plan belonging to one family member
-- fam_program_workouts — workout "days" within a program (e.g. "Day 1 - Push")
-- fam_program_exercises— planned exercises within a workout day
-- fam_workout_sessions — an actual logged workout instance
-- fam_exercise_logs    — actual sets logged within a session
-- fam_personal_records — auto-maintained PRs, upserted by the API whenever a
--                         logged set beats the stored value (see fitness.ts
--                         checkAndUpdatePersonalRecords()); UNIQUE per
--                         (member, exercise, record_type) so it's always the
--                         current best, not a history.
--
-- RLS: owner-scoped (withOwnerRLS — app.current_owner_id), same guard as every
-- fam_* table (NULLIF pattern per the platform-wide GUC empty-string rule).

-- ── fam_exercises ────────────────────────────────────────────────────────────

CREATE TABLE fam_exercises (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID          NOT NULL,
  name              VARCHAR(150)  NOT NULL,
  category          TEXT          NOT NULL
    CHECK (category IN ('STRENGTH','CARDIO','FLEXIBILITY','BALANCE','SPORT')),
  muscle_group      TEXT          NOT NULL DEFAULT 'OTHER'
    CHECK (muscle_group IN ('CHEST','BACK','LEGS','SHOULDERS','ARMS','CORE','FULL_BODY','CARDIO','OTHER')),
  tracking_type     TEXT          NOT NULL
    CHECK (tracking_type IN ('REPS_WEIGHT','TIME','DISTANCE','REPS_ONLY')),
  equipment         VARCHAR(100),
  instructions      TEXT,
  is_custom         BOOLEAN       NOT NULL DEFAULT true,
  is_active         BOOLEAN       NOT NULL DEFAULT true,
  last_modified_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_modified_by  UUID,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_fam_exercises_owner_name ON fam_exercises (owner_id, name);

-- ── fam_workout_programs ─────────────────────────────────────────────────────

CREATE TABLE fam_workout_programs (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID          NOT NULL,
  family_member_id  UUID          NOT NULL REFERENCES fam_family_members(id),
  name              VARCHAR(150)  NOT NULL,
  goal              TEXT          NOT NULL DEFAULT 'GENERAL_FITNESS'
    CHECK (goal IN ('STRENGTH','HYPERTROPHY','WEIGHT_LOSS','ENDURANCE','GENERAL_FITNESS','REHAB','OTHER')),
  description       VARCHAR(2000),
  status            TEXT          NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','COMPLETED','PAUSED','ARCHIVED')),
  start_date        DATE          NOT NULL,
  end_date          DATE,
  last_modified_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_modified_by  UUID,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── fam_program_workouts ─────────────────────────────────────────────────────

CREATE TABLE fam_program_workouts (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id        UUID          NOT NULL REFERENCES fam_workout_programs(id) ON DELETE CASCADE,
  name              VARCHAR(150)  NOT NULL,
  day_order         INTEGER       NOT NULL DEFAULT 0,
  notes             VARCHAR(1000),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── fam_program_exercises ────────────────────────────────────────────────────

CREATE TABLE fam_program_exercises (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  program_workout_id    UUID          NOT NULL REFERENCES fam_program_workouts(id) ON DELETE CASCADE,
  exercise_id           UUID          NOT NULL REFERENCES fam_exercises(id),
  order_index           INTEGER       NOT NULL DEFAULT 0,
  target_sets           INTEGER,
  target_reps_min       INTEGER,
  target_reps_max       INTEGER,
  target_weight         NUMERIC(8,2),
  target_duration_seconds INTEGER,
  target_distance        NUMERIC(8,2),
  rest_seconds           INTEGER,
  notes                  VARCHAR(500),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── fam_workout_sessions ─────────────────────────────────────────────────────

CREATE TABLE fam_workout_sessions (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID          NOT NULL,
  family_member_id      UUID          NOT NULL REFERENCES fam_family_members(id),
  program_workout_id    UUID          REFERENCES fam_program_workouts(id) ON DELETE SET NULL,
  session_date          DATE          NOT NULL,
  duration_minutes      INTEGER,
  status                TEXT          NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  perceived_exertion    SMALLINT      CHECK (perceived_exertion BETWEEN 1 AND 10),
  notes                 VARCHAR(2000),
  last_modified_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── fam_exercise_logs ────────────────────────────────────────────────────────

CREATE TABLE fam_exercise_logs (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID          NOT NULL REFERENCES fam_workout_sessions(id) ON DELETE CASCADE,
  exercise_id       UUID          NOT NULL REFERENCES fam_exercises(id),
  set_number        INTEGER       NOT NULL DEFAULT 1,
  reps              INTEGER,
  weight            NUMERIC(8,2),
  weight_unit       VARCHAR(10)   NOT NULL DEFAULT 'lb',
  duration_seconds  INTEGER,
  distance          NUMERIC(8,2),
  distance_unit     VARCHAR(10),
  rpe               SMALLINT      CHECK (rpe BETWEEN 1 AND 10),
  is_warmup         BOOLEAN       NOT NULL DEFAULT false,
  notes             VARCHAR(500),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── fam_personal_records ─────────────────────────────────────────────────────
-- Current-best only (not a history) — upserted by the API, replaced only when
-- a new logged set beats the stored value.

CREATE TABLE fam_personal_records (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID          NOT NULL,
  family_member_id  UUID          NOT NULL REFERENCES fam_family_members(id),
  exercise_id       UUID          NOT NULL REFERENCES fam_exercises(id),
  record_type       TEXT          NOT NULL
    CHECK (record_type IN ('MAX_WEIGHT','MAX_1RM_EST','MAX_REPS','MAX_VOLUME','BEST_TIME','BEST_DISTANCE')),
  value             NUMERIC(10,2) NOT NULL,
  unit              VARCHAR(10)   NOT NULL,
  achieved_date     DATE          NOT NULL,
  session_id        UUID          REFERENCES fam_workout_sessions(id) ON DELETE SET NULL,
  exercise_log_id   UUID          REFERENCES fam_exercise_logs(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_personal_record_member_exercise_type
  ON fam_personal_records (family_member_id, exercise_id, record_type);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_fam_exercises_owner            ON fam_exercises (owner_id) WHERE is_active;
CREATE INDEX idx_fam_workout_programs_member     ON fam_workout_programs (family_member_id, status);
CREATE INDEX idx_fam_program_workouts_program    ON fam_program_workouts (program_id, day_order);
CREATE INDEX idx_fam_program_exercises_workout   ON fam_program_exercises (program_workout_id, order_index);
CREATE INDEX idx_fam_workout_sessions_member     ON fam_workout_sessions (family_member_id, session_date DESC);
CREATE INDEX idx_fam_workout_sessions_program_wo ON fam_workout_sessions (program_workout_id) WHERE program_workout_id IS NOT NULL;
CREATE INDEX idx_fam_exercise_logs_session       ON fam_exercise_logs (session_id, set_number);
CREATE INDEX idx_fam_exercise_logs_exercise      ON fam_exercise_logs (exercise_id, created_at DESC);
CREATE INDEX idx_fam_personal_records_member     ON fam_personal_records (family_member_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE fam_exercises          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fam_workout_programs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fam_program_workouts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fam_program_exercises  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fam_workout_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fam_exercise_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fam_personal_records   ENABLE ROW LEVEL SECURITY;

CREATE POLICY fam_exercises_owner ON fam_exercises
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE POLICY fam_workout_programs_owner ON fam_workout_programs
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

-- Child tables have no owner_id of their own — scope via a join back to the
-- owner-scoped parent (same "join to parent" RLS idiom used for other
-- child-of-owner-scoped-parent tables on this platform).

CREATE POLICY fam_program_workouts_owner ON fam_program_workouts
  USING (EXISTS (
    SELECT 1 FROM fam_workout_programs p
    WHERE p.id = program_id
      AND p.owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM fam_workout_programs p
    WHERE p.id = program_id
      AND p.owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid
  ));

CREATE POLICY fam_program_exercises_owner ON fam_program_exercises
  USING (EXISTS (
    SELECT 1 FROM fam_program_workouts w
    JOIN   fam_workout_programs p ON p.id = w.program_id
    WHERE  w.id = program_workout_id
      AND  p.owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM fam_program_workouts w
    JOIN   fam_workout_programs p ON p.id = w.program_id
    WHERE  w.id = program_workout_id
      AND  p.owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid
  ));

CREATE POLICY fam_workout_sessions_owner ON fam_workout_sessions
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE POLICY fam_exercise_logs_owner ON fam_exercise_logs
  USING (EXISTS (
    SELECT 1 FROM fam_workout_sessions s
    WHERE s.id = session_id
      AND s.owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM fam_workout_sessions s
    WHERE s.id = session_id
      AND s.owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid
  ));

CREATE POLICY fam_personal_records_owner ON fam_personal_records
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

-- Tables owned by postgres (so RLS ENABLE enforces against jag_app — the app role).
GRANT SELECT, INSERT, UPDATE, DELETE ON fam_exercises          TO jag_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fam_workout_programs   TO jag_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fam_program_workouts   TO jag_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fam_program_exercises  TO jag_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fam_workout_sessions   TO jag_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fam_exercise_logs      TO jag_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fam_personal_records   TO jag_app;

-- ── Seed: shared exercise library ───────────────────────────────────────────
-- owner_id hardcoded to Robert's jag_core users.id (same value used throughout
-- this project's seed migrations, e.g. 023_properties_credit_accounts.sql).
-- Idempotent — safe to re-run.

INSERT INTO fam_exercises (owner_id, name, category, muscle_group, tracking_type, equipment, is_custom)
VALUES
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Barbell Bench Press','STRENGTH','CHEST','REPS_WEIGHT','Barbell',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Incline Dumbbell Press','STRENGTH','CHEST','REPS_WEIGHT','Dumbbells',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Push-Up','STRENGTH','CHEST','REPS_ONLY','Bodyweight',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Barbell Back Squat','STRENGTH','LEGS','REPS_WEIGHT','Barbell',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Front Squat','STRENGTH','LEGS','REPS_WEIGHT','Barbell',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Leg Press','STRENGTH','LEGS','REPS_WEIGHT','Machine',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Romanian Deadlift','STRENGTH','LEGS','REPS_WEIGHT','Barbell',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Walking Lunge','STRENGTH','LEGS','REPS_WEIGHT','Dumbbells',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Conventional Deadlift','STRENGTH','BACK','REPS_WEIGHT','Barbell',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Pull-Up','STRENGTH','BACK','REPS_ONLY','Pull-Up Bar',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Lat Pulldown','STRENGTH','BACK','REPS_WEIGHT','Machine',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Barbell Row','STRENGTH','BACK','REPS_WEIGHT','Barbell',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Seated Cable Row','STRENGTH','BACK','REPS_WEIGHT','Machine',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Overhead Press','STRENGTH','SHOULDERS','REPS_WEIGHT','Barbell',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Dumbbell Shoulder Press','STRENGTH','SHOULDERS','REPS_WEIGHT','Dumbbells',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Lateral Raise','STRENGTH','SHOULDERS','REPS_WEIGHT','Dumbbells',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Face Pull','STRENGTH','SHOULDERS','REPS_WEIGHT','Cable',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Barbell Curl','STRENGTH','ARMS','REPS_WEIGHT','Barbell',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Dumbbell Curl','STRENGTH','ARMS','REPS_WEIGHT','Dumbbells',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Tricep Pushdown','STRENGTH','ARMS','REPS_WEIGHT','Cable',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Skull Crusher','STRENGTH','ARMS','REPS_WEIGHT','Barbell',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Dip','STRENGTH','ARMS','REPS_ONLY','Dip Bar',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Plank','STRENGTH','CORE','TIME','Bodyweight',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Hanging Leg Raise','STRENGTH','CORE','REPS_ONLY','Pull-Up Bar',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Crunch','STRENGTH','CORE','REPS_WEIGHT','Cable',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Russian Twist','STRENGTH','CORE','REPS_ONLY','Bodyweight',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Kettlebell Swing','STRENGTH','FULL_BODY','REPS_WEIGHT','Kettlebell',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Burpee','STRENGTH','FULL_BODY','REPS_ONLY','Bodyweight',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Clean and Jerk','STRENGTH','FULL_BODY','REPS_WEIGHT','Barbell',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Running','CARDIO','CARDIO','DISTANCE','None',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cycling','CARDIO','CARDIO','DISTANCE','Bicycle',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Swimming','CARDIO','CARDIO','DISTANCE','Pool',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Rowing Machine','CARDIO','CARDIO','DISTANCE','Machine',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Jump Rope','CARDIO','CARDIO','TIME','Jump Rope',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Elliptical','CARDIO','CARDIO','TIME','Machine',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Stair Climber','CARDIO','CARDIO','TIME','Machine',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Yoga','FLEXIBILITY','FULL_BODY','TIME','Mat',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Static Stretching','FLEXIBILITY','FULL_BODY','TIME','Mat',false)
ON CONFLICT (owner_id, name) DO NOTHING;
