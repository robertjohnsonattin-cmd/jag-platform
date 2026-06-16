CREATE TABLE IF NOT EXISTS jabco_project_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  project_id        UUID NOT NULL REFERENCES jabco_projects(id) ON DELETE CASCADE,
  task_type         VARCHAR(20) NOT NULL CHECK (task_type IN ('MOBILIZATION','POST_MORTEM','GENERAL')),
  title             VARCHAR(200) NOT NULL,
  description       TEXT,
  assigned_to       UUID,
  due_date          DATE,
  status            VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','DONE')),
  completed_at      TIMESTAMPTZ,
  last_modified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE jabco_project_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY jabco_project_tasks_tenant ON jabco_project_tasks
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant  ON jabco_project_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON jabco_project_tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status  ON jabco_project_tasks (status);
