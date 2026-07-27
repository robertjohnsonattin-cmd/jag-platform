-- Migration 038: Samsung Health (via Android Health Connect) auto-sync support.
-- Adds DISTANCE_KM + FLOORS_CLIMBED metric types (STEPS/SLEEP_HOURS/CALORIES/
-- EXERCISE_MINUTES already existed and are reused for step count/sleep/calories
-- burned/active minutes respectively). Also adds a partial unique index so the
-- jag-mobile sync endpoint can upsert one row per day per metric for
-- source='HEALTH_CONNECT' entries specifically, without constraining manual
-- entries (which may legitimately have multiple readings per day, e.g. BP).

ALTER TABLE fam_lifestyle_tracker DROP CONSTRAINT fam_lifestyle_tracker_metric_type_check;

ALTER TABLE fam_lifestyle_tracker ADD CONSTRAINT fam_lifestyle_tracker_metric_type_check
  CHECK (metric_type IN (
    'WEIGHT_KG','STEPS','SLEEP_HOURS','CALORIES','EXERCISE_MINUTES',
    'BLOOD_PRESSURE_SYSTOLIC','BLOOD_PRESSURE_DIASTOLIC','RESTING_HEART_RATE',
    'CHOLESTEROL_TOTAL','CHOLESTEROL_LDL','CHOLESTEROL_HDL','TRIGLYCERIDES','BLOOD_GLUCOSE',
    'PSA','ESR','ACE_LEVEL','CREATININE','AST','ALT','WBC','HEMOGLOBIN','HBA1C','BUN','TSH',
    'VITAMIN_B12','FREE_T4','RBC','HCT','MCV','MCH','MCHC','RDW','PLATELETS','MPV',
    'NEUTROPHILS_PCT','LYMPHOCYTES_PCT','MONOCYTES_PCT','EOSINOPHILS_PCT','BASOPHILS_PCT',
    'NEUTROPHILS_ABSOLUTE','LYMPHOCYTES_ABSOLUTE','MONOCYTES_ABSOLUTE','EOSINOPHILS_ABSOLUTE','BASOPHILS_ABSOLUTE',
    'ALKALINE_PHOSPHATASE','SODIUM','POTASSIUM','CHLORIDE','TOTAL_PROTEIN',
    'DISTANCE_KM','FLOORS_CLIMBED',
    'OTHER'
  ));

CREATE UNIQUE INDEX fam_lifestyle_tracker_health_connect_uq
  ON fam_lifestyle_tracker (family_member_id, entry_date, metric_type)
  WHERE source = 'HEALTH_CONNECT';
