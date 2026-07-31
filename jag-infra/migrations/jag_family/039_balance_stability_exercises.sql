-- jag_family — Migration 039: Balance / stability exercise library
-- Run against jag_family as jag_app.
--
-- fam_exercises.category has always allowed 'BALANCE' (see 025_fitness_module.sql's CHECK
-- constraint), but no exercise was ever seeded into it — every exercise added by 025 and 027
-- is STRENGTH, CARDIO, or FLEXIBILITY. Found 2026-07-30: the AI coach could never suggest
-- balance/fall-prevention work for any family member, including Robert's 86-year-old father,
-- because the category was structurally empty. Adds low-impact, low/no-equipment stability
-- exercises appropriate for an elderly/beginner profile (chair- or wall-supported where a
-- fall risk exists), plus a few standing-balance progressions useful at any fitness level.
-- Idempotent — safe to re-run.

INSERT INTO fam_exercises (owner_id, name, category, muscle_group, tracking_type, equipment, is_custom)
VALUES
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Single-Leg Stance','BALANCE','LEGS','TIME','Bodyweight',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Wall-Supported Single-Leg Stance','BALANCE','LEGS','TIME','Wall',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Chair-Assisted Sit-to-Stand','BALANCE','LEGS','REPS_ONLY','Chair',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Standing Marches','BALANCE','LEGS','TIME','Bodyweight',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Seated Marches','BALANCE','CORE','REPS_ONLY','Chair',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Heel-to-Toe Tandem Walk','BALANCE','LEGS','TIME','Bodyweight',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Weight Shifts (Side-to-Side)','BALANCE','LEGS','TIME','Bodyweight',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Rock the Boat (Weight Shift Front-Back)','BALANCE','LEGS','TIME','Bodyweight',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Chair-Assisted Heel Raises','BALANCE','LEGS','REPS_ONLY','Chair',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Chair-Assisted Standing Hip Abduction','BALANCE','LEGS','REPS_ONLY','Chair',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Toe Taps (Step Taps)','BALANCE','LEGS','REPS_ONLY','Chair',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Standing Reach (Clock Reach)','BALANCE','CORE','REPS_ONLY','Chair',false)
ON CONFLICT (owner_id, name) DO NOTHING;
