-- Migration 037: fam_lifestyle_tracker.entry_time — time of day a reading was taken.
-- Vitals (BP systolic/diastolic, resting HR) are logged together as one reading, and
-- time-of-day matters for those (BP varies morning vs evening) — additive, nullable,
-- existing rows are unaffected.

ALTER TABLE fam_lifestyle_tracker ADD COLUMN entry_time TIME;
