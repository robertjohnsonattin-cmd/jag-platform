-- STD-13 Expand: add nullable CRM company FK to jabco_projects.
-- Nullable column = pure expand step, no contract step needed.
-- Existing rows get NULL (no backfill required — historically projects had no CRM link).

ALTER TABLE jabco_projects
  ADD COLUMN client_company_id UUID REFERENCES crm_companies(id);

CREATE INDEX idx_jabco_projects_company ON jabco_projects (client_company_id)
  WHERE client_company_id IS NOT NULL;

COMMENT ON COLUMN jabco_projects.client_company_id IS 'Optional FK to crm_companies — links project to a CRM client record (Enter Once principle).';
