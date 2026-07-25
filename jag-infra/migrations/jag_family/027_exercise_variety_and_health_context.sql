-- jag_family — Migration 027: Exercise library expansion + biological sex + equipment labels
-- Run against jag_family as jag_app.
--
-- 1. Adds ~43 new exercises matched to the user's actual home gym (Marcy multi-gym
--    cable tower, dumbbells, barbell, adjustable bench w/ leg developer, treadmill,
--    upright + recumbent bikes) so the AI coach (and manual browsing) has real
--    variety per muscle group instead of one option each. Picked using standard
--    strength-and-conditioning programming principles: balanced push/pull/hinge/
--    squat/carry coverage, at least 3-4 variations per major muscle group so
--    consecutive sessions don't repeat the same movement.
-- 2. Corrects equipment labels on existing cable-tower exercises that were
--    generically labelled "Machine" — the cable tower is a specific, named piece
--    of equipment in this household's gym.
-- 3. Adds fam_fitness_profiles.biological_sex — used by the AI coach prompt for
--    more calibrated programming (exercise science reasonably differs by sex on
--    things like typical relative strength and injury-prevention emphasis).
--    Optional, defaults to UNSPECIFIED — never required.

-- ── Correct existing equipment labels (cable tower, not generic "Machine") ────

UPDATE fam_exercises SET equipment = 'Cable Tower'
WHERE name IN ('Lat Pulldown', 'Seated Cable Row', 'Face Pull', 'Cable Crunch', 'Tricep Pushdown')
  AND owner_id = '95ca3f77-60ba-4a0f-af70-2832b247b525';

-- ── biological_sex on fam_fitness_profiles ───────────────────────────────────

ALTER TABLE fam_fitness_profiles ADD COLUMN biological_sex TEXT NOT NULL DEFAULT 'UNSPECIFIED'
  CHECK (biological_sex IN ('MALE', 'FEMALE', 'UNSPECIFIED'));

-- ── New exercises — matched to the actual home gym ───────────────────────────

INSERT INTO fam_exercises (owner_id, name, category, muscle_group, tracking_type, equipment, is_custom)
VALUES
  -- Cable tower — chest
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Chest Press','STRENGTH','CHEST','REPS_WEIGHT','Cable Tower',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Fly','STRENGTH','CHEST','REPS_WEIGHT','Cable Tower',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Low-to-High Fly','STRENGTH','CHEST','REPS_WEIGHT','Cable Tower',false),
  -- Cable tower — back
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Straight-Arm Pulldown','STRENGTH','BACK','REPS_WEIGHT','Cable Tower',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Standing Row','STRENGTH','BACK','REPS_WEIGHT','Cable Tower',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Single-Arm Row','STRENGTH','BACK','REPS_WEIGHT','Cable Tower',false),
  -- Cable tower — shoulders
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Lateral Raise','STRENGTH','SHOULDERS','REPS_WEIGHT','Cable Tower',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Front Raise','STRENGTH','SHOULDERS','REPS_WEIGHT','Cable Tower',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Upright Row','STRENGTH','SHOULDERS','REPS_WEIGHT','Cable Tower',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Reverse Fly','STRENGTH','SHOULDERS','REPS_WEIGHT','Cable Tower',false),
  -- Cable tower — arms
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Overhead Tricep Extension','STRENGTH','ARMS','REPS_WEIGHT','Cable Tower',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Bicep Curl','STRENGTH','ARMS','REPS_WEIGHT','Cable Tower',false),
  -- Cable tower — core / legs
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Woodchopper','STRENGTH','CORE','REPS_WEIGHT','Cable Tower',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Kneeling Crunch','STRENGTH','CORE','REPS_WEIGHT','Cable Tower',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Cable Pull-Through','STRENGTH','LEGS','REPS_WEIGHT','Cable Tower',false),

  -- Bench + leg-developer attachment
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Leg Extension','STRENGTH','LEGS','REPS_WEIGHT','Bench Leg Developer',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Lying Leg Curl','STRENGTH','LEGS','REPS_WEIGHT','Bench Leg Developer',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Bench Dip','STRENGTH','ARMS','REPS_ONLY','Bench',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Decline Push-Up','STRENGTH','CHEST','REPS_ONLY','Bench',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Incline Push-Up','STRENGTH','CHEST','REPS_ONLY','Bench',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Bulgarian Split Squat','STRENGTH','LEGS','REPS_WEIGHT','Bench + Dumbbells',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Step-Up','STRENGTH','LEGS','REPS_WEIGHT','Bench + Dumbbells',false),

  -- Dumbbells — more variety
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Flat Dumbbell Bench Press','STRENGTH','CHEST','REPS_WEIGHT','Dumbbells',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Dumbbell Fly','STRENGTH','CHEST','REPS_WEIGHT','Dumbbells',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Single-Arm Dumbbell Row','STRENGTH','BACK','REPS_WEIGHT','Dumbbells',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Dumbbell Pullover','STRENGTH','BACK','REPS_WEIGHT','Dumbbells',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Goblet Squat','STRENGTH','LEGS','REPS_WEIGHT','Dumbbells',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Dumbbell Romanian Deadlift','STRENGTH','LEGS','REPS_WEIGHT','Dumbbells',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Hammer Curl','STRENGTH','ARMS','REPS_WEIGHT','Dumbbells',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Concentration Curl','STRENGTH','ARMS','REPS_WEIGHT','Dumbbells',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Arnold Press','STRENGTH','SHOULDERS','REPS_WEIGHT','Dumbbells',false),

  -- Barbell — more variety
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Barbell Hip Thrust','STRENGTH','LEGS','REPS_WEIGHT','Barbell',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Barbell Shrug','STRENGTH','BACK','REPS_WEIGHT','Barbell',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Barbell Upright Row','STRENGTH','SHOULDERS','REPS_WEIGHT','Barbell',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Sumo Deadlift','STRENGTH','LEGS','REPS_WEIGHT','Barbell',false),

  -- Bodyweight fillers — no equipment needed, useful for low-recovery days
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Mountain Climbers','STRENGTH','CORE','TIME','Bodyweight',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Bicycle Crunch','STRENGTH','CORE','REPS_ONLY','Bodyweight',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Superman','STRENGTH','CORE','REPS_ONLY','Bodyweight',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Wall Sit','STRENGTH','LEGS','TIME','Bodyweight',false),

  -- Cardio machines actually owned
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Treadmill Incline Walk','CARDIO','CARDIO','TIME','Treadmill',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Treadmill Interval Run','CARDIO','CARDIO','TIME','Treadmill',false),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525','Recumbent Bike Cycling','CARDIO','CARDIO','DISTANCE','Recumbent Bike',false)
ON CONFLICT (owner_id, name) DO NOTHING;
