ALTER TABLE jabco_projects
  ADD COLUMN IF NOT EXISTS handover_document_url TEXT;

COMMENT ON COLUMN jabco_projects.handover_document_url IS
  'MinIO URL for signed handover certificate. Required (along with zero open punch-list items) before status can transition to CLOSED.';
