-- jag_family — Migration 030: Medical Profile (synthesized summary)
-- Run against jag_family as postgres (owned by postgres so RLS enforces against jag_app).
--
-- fam_medical_records (migration 029) is the atomic per-document log — good for audit/
-- traceability but reads as "a bunch of scattered notes" on its own, per Robert's feedback
-- (session, 2026-07-26). This adds one synthesized profile row per family member: active
-- diagnoses, current medications, care team, allergies, and a narrative summary, built by
-- reading across the approved records rather than displaying them as a raw list.
--
-- Not auto-computed by SQL aggregation — the underlying records are too heterogeneous
-- (free text + varied JSON shapes) for a reliable mechanical rollup. Claude (or Robert,
-- via the same UI) reviews approved records and (re)writes this summary; last_synthesized_at
-- tracks when that last happened so a stale profile is visible, not silently assumed fresh.

CREATE TABLE fam_medical_profile (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                 UUID          NOT NULL,
  family_member_id         UUID          NOT NULL UNIQUE REFERENCES fam_family_members(id),
  active_diagnoses         JSONB         NOT NULL DEFAULT '[]'::jsonb,   -- [{name, since, status, notes}]
  current_medications      JSONB         NOT NULL DEFAULT '[]'::jsonb,   -- [{name, dose, frequency, prescribed_by, since}]
  allergies                JSONB         NOT NULL DEFAULT '[]'::jsonb,   -- [{allergen, reaction}]
  care_team                JSONB         NOT NULL DEFAULT '[]'::jsonb,   -- [{name, specialty, facility, phone}]
  summary_notes            TEXT,                                        -- free-text narrative overview
  last_synthesized_at      TIMESTAMPTZ,
  last_modified_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_modified_by         UUID,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE fam_medical_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY fam_medical_profile_owner ON fam_medical_profile
  USING      (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON fam_medical_profile TO jag_app;
