-- jag_family — Migration 032: expand fam_lifestyle_tracker for full lab panel tracking
-- Run against jag_family as postgres.
--
-- Robert asked why the various blood test figures pulled from the Medical Records
-- extraction (PSA over the years, ESR trend, ACE levels, a 2024 chemistry panel)
-- were not showing anywhere in a proper table/trend view. Root cause: only a
-- handful of values (cholesterol, glucose, resting HR) had ever been wired into
-- fam_lifestyle_tracker via details.lifestyle_metrics — the rest sat only inside
-- each fam_medical_records row's JSONB details blob, with no path into a
-- longitudinal table. This adds the missing common lab-panel metric types so
-- they can be backfilled and show up in the existing Biometrics tab (which
-- already supports per-metric filtering/history — no new UI component needed).

ALTER TABLE fam_lifestyle_tracker DROP CONSTRAINT IF EXISTS fam_lifestyle_tracker_metric_type_check;
ALTER TABLE fam_lifestyle_tracker ADD CONSTRAINT fam_lifestyle_tracker_metric_type_check
  CHECK (metric_type IN (
    'WEIGHT_KG','STEPS','SLEEP_HOURS','CALORIES','EXERCISE_MINUTES',
    'BLOOD_PRESSURE_SYSTOLIC','BLOOD_PRESSURE_DIASTOLIC','RESTING_HEART_RATE',
    'CHOLESTEROL_TOTAL','CHOLESTEROL_LDL','CHOLESTEROL_HDL','TRIGLYCERIDES','BLOOD_GLUCOSE',
    'PSA','ESR','ACE_LEVEL','CREATININE','AST','ALT','WBC','HEMOGLOBIN','HBA1C','BUN','TSH','VITAMIN_B12',
    'OTHER'
  ));
