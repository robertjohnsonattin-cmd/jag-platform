-- Migration 034: add FREE_T4 metric type — found alongside TSH in a 2020 thyroid
-- panel that had never been backfilled at all (Robert asked "are there more blood
-- metrics we should include" after the CBC/chemistry expansion in migration 033).

ALTER TABLE fam_lifestyle_tracker DROP CONSTRAINT IF EXISTS fam_lifestyle_tracker_metric_type_check;

ALTER TABLE fam_lifestyle_tracker ADD CONSTRAINT fam_lifestyle_tracker_metric_type_check
  CHECK (metric_type IN (
    'WEIGHT_KG', 'STEPS', 'SLEEP_HOURS', 'CALORIES', 'EXERCISE_MINUTES',
    'BLOOD_PRESSURE_SYSTOLIC', 'BLOOD_PRESSURE_DIASTOLIC', 'RESTING_HEART_RATE',
    'CHOLESTEROL_TOTAL', 'CHOLESTEROL_LDL', 'CHOLESTEROL_HDL', 'TRIGLYCERIDES', 'BLOOD_GLUCOSE',
    'PSA', 'ESR', 'ACE_LEVEL', 'CREATININE', 'AST', 'ALT', 'WBC', 'HEMOGLOBIN', 'HBA1C',
    'BUN', 'TSH', 'VITAMIN_B12',
    'RBC', 'HCT', 'MCV', 'MCH', 'MCHC', 'RDW', 'PLATELETS', 'MPV',
    'NEUTROPHILS_PCT', 'LYMPHOCYTES_PCT', 'MONOCYTES_PCT', 'EOSINOPHILS_PCT', 'BASOPHILS_PCT',
    'NEUTROPHILS_ABSOLUTE', 'LYMPHOCYTES_ABSOLUTE', 'MONOCYTES_ABSOLUTE', 'EOSINOPHILS_ABSOLUTE', 'BASOPHILS_ABSOLUTE',
    'ALKALINE_PHOSPHATASE', 'SODIUM', 'POTASSIUM', 'CHLORIDE', 'TOTAL_PROTEIN',
    'FREE_T4',
    'OTHER'
  ));
