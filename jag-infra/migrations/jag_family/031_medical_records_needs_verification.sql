-- jag_family — Migration 031: needs_verification flag on fam_medical_records
-- Run against jag_family as postgres.
--
-- Several extracted records had low-confidence fields (illegible handwriting, poor
-- scan quality, conflicting dates across two documents) that were only ever noted
-- as free text inside details.confidence — not queryable/filterable, and Robert had
-- no way to find them without me listing them out manually. This adds a real
-- boolean flag so the UI can show a "needs verification" filter/badge.

ALTER TABLE fam_medical_records ADD COLUMN needs_verification BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_fam_medical_records_needs_verification ON fam_medical_records (needs_verification) WHERE needs_verification = true;
