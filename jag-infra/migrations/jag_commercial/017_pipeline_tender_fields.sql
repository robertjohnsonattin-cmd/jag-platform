-- STD-13 Expand: all nullable, zero-risk to existing rows.
ALTER TABLE crm_sales_pipeline
  ADD COLUMN IF NOT EXISTS pipeline_type        VARCHAR(20) NOT NULL DEFAULT 'JABCO_TENDER'
    CHECK (pipeline_type IN ('JABCO_TENDER','DRAGONBRIDGE_DEAL')),
  ADD COLUMN IF NOT EXISTS bid_deadline         DATE,
  ADD COLUMN IF NOT EXISTS source_url           TEXT,
  ADD COLUMN IF NOT EXISTS assigned_estimator_id UUID,
  ADD COLUMN IF NOT EXISTS proposal_document_url TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS linked_project_id    UUID REFERENCES jabco_projects(id);

CREATE INDEX IF NOT EXISTS idx_pipeline_type ON crm_sales_pipeline (pipeline_type);
CREATE INDEX IF NOT EXISTS idx_pipeline_linked_project ON crm_sales_pipeline (linked_project_id)
  WHERE linked_project_id IS NOT NULL;

COMMENT ON COLUMN crm_sales_pipeline.linked_project_id IS
  'Set on Go decision — links the opportunity to the jabco_projects row created for it.';
