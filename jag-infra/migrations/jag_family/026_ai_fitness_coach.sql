-- jag_family — Migration 026: AI Fitness Coach
-- Run against jag_family as jag_app.
--
-- Adds the data model for AI-driven workout suggestions on top of the fitness
-- module (migration 025): a static self-reported fitness profile per family
-- member, an append-only daily readiness check-in log, and a flag on
-- fam_workout_programs marking AI-generated programs (STD-13 additive column
-- so the Programs tab can badge them distinctly).
--
-- AI-suggested workouts are NOT a separate structure — /lifestyle/fitness/ai/suggest
-- creates a normal fam_workout_programs + fam_program_workouts + fam_program_exercises
-- row set (ai_generated = true), so the existing session-logging/PR pipeline works
-- on them unchanged.
--
-- Unit correction: exercise-logging weight/distance defaults were set to lb/mi in
-- 025 — this migration also flips fam_exercise_logs.weight_unit's DEFAULT to 'kg'
-- so the fitness module is metric throughout (matches the new profile's height_cm/
-- weight_kg/body_fat_pct and the pre-existing fam_lifestyle_tracker WEIGHT_KG
-- convention). No existing rows to backfill.

ALTER TABLE fam_exercise_logs ALTER COLUMN weight_unit SET DEFAULT 'kg';

-- ── fam_fitness_profiles ─────────────────────────────────────────────────────

CREATE TABLE fam_fitness_profiles (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID          NOT NULL,
  family_member_id      UUID          NOT NULL UNIQUE REFERENCES fam_family_members(id),
  primary_goal          TEXT          NOT NULL DEFAULT 'GENERAL_FITNESS'
    CHECK (primary_goal IN ('STRENGTH','HYPERTROPHY','WEIGHT_LOSS','ENDURANCE','GENERAL_FITNESS','REHAB','OTHER')),
  fitness_level         TEXT          NOT NULL DEFAULT 'BEGINNER'
    CHECK (fitness_level IN ('BEGINNER','INTERMEDIATE','ADVANCED')),
  activity_level        TEXT          NOT NULL DEFAULT 'MODERATELY_ACTIVE'
    CHECK (activity_level IN ('SEDENTARY','LIGHTLY_ACTIVE','MODERATELY_ACTIVE','VERY_ACTIVE','EXTREMELY_ACTIVE')),
  height_cm             NUMERIC(5,1),
  weight_kg             NUMERIC(5,1),
  body_fat_pct          NUMERIC(4,1),   -- optional — no way to measure this yet, stays NULL
  equipment_access      TEXT          NOT NULL DEFAULT 'HOME_BASIC'
    CHECK (equipment_access IN ('HOME_BASIC','HOME_FULL','COMMERCIAL_GYM','BODYWEIGHT_ONLY','OTHER')),
  days_per_week_target  SMALLINT      CHECK (days_per_week_target BETWEEN 1 AND 7),
  injuries_limitations  VARCHAR(2000),
  last_modified_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── fam_fitness_checkins ─────────────────────────────────────────────────────
-- Append-only — one row per "Suggest My Workout" click, not just per day, so a
-- second check-in later in the day (different energy/soreness) isn't lost.

CREATE TABLE fam_fitness_checkins (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id               UUID          NOT NULL,
  family_member_id       UUID          NOT NULL REFERENCES fam_family_members(id),
  checkin_date           DATE          NOT NULL DEFAULT CURRENT_DATE,
  energy_level           SMALLINT      NOT NULL CHECK (energy_level BETWEEN 1 AND 5),
  soreness_level         SMALLINT      NOT NULL CHECK (soreness_level BETWEEN 1 AND 5),
  time_available_minutes SMALLINT,
  focus_override         VARCHAR(50),
  notes                  VARCHAR(500),
  suggested_program_id   UUID          REFERENCES fam_workout_programs(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── fam_workout_programs.ai_generated ────────────────────────────────────────

ALTER TABLE fam_workout_programs ADD COLUMN ai_generated BOOLEAN NOT NULL DEFAULT false;

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_fam_fitness_checkins_member ON fam_fitness_checkins (family_member_id, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE fam_fitness_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE fam_fitness_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY fam_fitness_profiles_owner ON fam_fitness_profiles
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE POLICY fam_fitness_checkins_owner ON fam_fitness_checkins
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

-- Tables owned by postgres (so RLS ENABLE enforces against jag_app — the app role).
GRANT SELECT, INSERT, UPDATE, DELETE ON fam_fitness_profiles TO jag_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fam_fitness_checkins TO jag_app;
