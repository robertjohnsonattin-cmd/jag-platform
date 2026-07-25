-- jag_family — Migration 028: Health Tracker lab-marker metric types
-- Run against jag_family as jag_app.
--
-- Extends fam_lifestyle_tracker.metric_type to accept blood-lab markers
-- (cholesterol panel + glucose), first step of the AI fitness coach reading
-- from a broader set of health data (per Robert's stated direction — the
-- Lifestyle health tracker growing into a fuller personal health record over
-- time, with the AI coach factoring in whatever's logged there).
--
-- No new table needed — fam_lifestyle_tracker is already a generic
-- (metric_type, value, unit) time series; the AI coach's health-context query
-- (routes/lifestyle/ai-coach.ts) already reads "most recent entry per metric
-- type within 30 days" with no metric_type filter, so newly-loggable types
-- flow into the coaching prompt automatically once their label is added there.

ALTER TABLE fam_lifestyle_tracker DROP CONSTRAINT fam_lifestyle_tracker_metric_type_check;

ALTER TABLE fam_lifestyle_tracker ADD CONSTRAINT fam_lifestyle_tracker_metric_type_check
  CHECK (metric_type IN (
    'WEIGHT_KG','STEPS','SLEEP_HOURS','CALORIES','EXERCISE_MINUTES',
    'BLOOD_PRESSURE_SYSTOLIC','BLOOD_PRESSURE_DIASTOLIC','RESTING_HEART_RATE',
    'CHOLESTEROL_TOTAL','CHOLESTEROL_LDL','CHOLESTEROL_HDL','TRIGLYCERIDES','BLOOD_GLUCOSE',
    'OTHER'
  ));
