-- Migration 066 (jag_properties) — enquiry merge support
-- Session 2026-08-03. Duplicate enquiries for the same prospect (same last-7 phone
-- key, same unit) are merged into one "keeper". The merged-away rows are KEPT for
-- the audit trail — marked stage='MERGED' and pointed at the keeper via
-- merged_into_id — never deleted. Backend: POST /properties/enquiries/merge
-- (routes/properties/enquiries.ts, mergeEnquiriesTx).

-- 1. Add the MERGED stage to the stage CHECK. Expand-only: no existing value is
--    removed, so the constraint is recreated wider. The name is PostgreSQL's
--    auto-generated column CHECK name (table_column_check).
ALTER TABLE prop_enquiries DROP CONSTRAINT prop_enquiries_stage_check;
ALTER TABLE prop_enquiries ADD CONSTRAINT prop_enquiries_stage_check CHECK (
  stage IN ('NEW_LEAD','VIEWING_SCHEDULED','VIEWED','APPLICATION_SENT',
            'APPLICATION_RECEIVED','SCREENING','APPROVED','REJECTED',
            'WITHDRAWN','CONVERTED','MERGED')
);

-- 2. Pointer from a merged-away enquiry to the enquiry it was merged into.
ALTER TABLE prop_enquiries ADD COLUMN merged_into_id UUID REFERENCES prop_enquiries(id) ON DELETE SET NULL;

CREATE INDEX idx_prop_enquiries_merged_into ON prop_enquiries(merged_into_id) WHERE merged_into_id IS NOT NULL;
