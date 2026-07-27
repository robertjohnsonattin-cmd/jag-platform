-- Migration 033: extend fam_lifestyle_tracker metric_type to cover the full CBC
-- differential + remaining common chemistry panel values, so a full blood count
-- (not just a curated subset) can be trended in Biometrics.
-- Session: PJA medical records review — Robert asked why RBC/HCT/MCV/MCH/MCHC/RDW/
-- PLT/MPV and the WBC differential weren't trend-tracked even though they were
-- already captured in each record's raw extracted details.

ALTER TABLE fam_lifestyle_tracker DROP CONSTRAINT IF EXISTS fam_lifestyle_tracker_metric_type_check;

ALTER TABLE fam_lifestyle_tracker ADD CONSTRAINT fam_lifestyle_tracker_metric_type_check
  CHECK (metric_type IN (
    'WEIGHT_KG', 'STEPS', 'SLEEP_HOURS', 'CALORIES', 'EXERCISE_MINUTES',
    'BLOOD_PRESSURE_SYSTOLIC', 'BLOOD_PRESSURE_DIASTOLIC', 'RESTING_HEART_RATE',
    'CHOLESTEROL_TOTAL', 'CHOLESTEROL_LDL', 'CHOLESTEROL_HDL', 'TRIGLYCERIDES', 'BLOOD_GLUCOSE',
    'PSA', 'ESR', 'ACE_LEVEL', 'CREATININE', 'AST', 'ALT', 'WBC', 'HEMOGLOBIN', 'HBA1C',
    'BUN', 'TSH', 'VITAMIN_B12',
    -- New: CBC differential (red cell indices + platelet indices)
    'RBC', 'HCT', 'MCV', 'MCH', 'MCHC', 'RDW', 'PLATELETS', 'MPV',
    -- New: CBC differential (white cell breakdown, percentage + absolute)
    'NEUTROPHILS_PCT', 'LYMPHOCYTES_PCT', 'MONOCYTES_PCT', 'EOSINOPHILS_PCT', 'BASOPHILS_PCT',
    'NEUTROPHILS_ABSOLUTE', 'LYMPHOCYTES_ABSOLUTE', 'MONOCYTES_ABSOLUTE', 'EOSINOPHILS_ABSOLUTE', 'BASOPHILS_ABSOLUTE',
    -- New: remaining common chemistry panel values
    'ALKALINE_PHOSPHATASE', 'SODIUM', 'POTASSIUM', 'CHLORIDE', 'TOTAL_PROTEIN',
    'OTHER'
  ));
