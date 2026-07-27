-- Migration 035: add blood_type to fam_medical_profile.
-- Robert: "always include the individual's blood group type in the overview
-- to the doctor" — a static, rarely-changing fact, so it belongs on the
-- synthesized profile itself rather than being re-derived from the raw
-- Blood Group & Rh Typing lab record every time.

ALTER TABLE fam_medical_profile ADD COLUMN IF NOT EXISTS blood_type TEXT;
