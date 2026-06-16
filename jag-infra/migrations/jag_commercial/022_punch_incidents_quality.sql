CREATE TABLE IF NOT EXISTS jabco_punch_list_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  project_id       UUID NOT NULL REFERENCES jabco_projects(id) ON DELETE CASCADE,
  description      TEXT NOT NULL,
  location         VARCHAR(200),
  trade            VARCHAR(100),
  status           VARCHAR(20) NOT NULL DEFAULT 'IDENTIFIED'
    CHECK (status IN ('IDENTIFIED','RECTIFIED','VERIFIED')),
  identified_by    UUID NOT NULL,
  identified_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  rectified_date   DATE,
  verified_by      UUID,
  verified_date    DATE,
  photo_url        TEXT,
  last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jabco_site_incidents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  project_id       UUID NOT NULL REFERENCES jabco_projects(id) ON DELETE CASCADE,
  incident_date    DATE NOT NULL,
  incident_type    VARCHAR(30) NOT NULL
    CHECK (incident_type IN ('NEAR_MISS','MINOR_INJURY','MAJOR_INJURY','PROPERTY_DAMAGE','ENVIRONMENTAL','OTHER')),
  severity         VARCHAR(10) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  description      TEXT NOT NULL,
  reported_by      UUID NOT NULL,
  corrective_action TEXT,
  status           VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  closed_date      DATE,
  photos           JSONB DEFAULT '[]',
  last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jabco_quality_inspections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  project_id        UUID NOT NULL REFERENCES jabco_projects(id) ON DELETE CASCADE,
  inspection_date   DATE NOT NULL,
  inspector_name    VARCHAR(200) NOT NULL,
  area_inspected    VARCHAR(200) NOT NULL,
  checklist_result  VARCHAR(15) NOT NULL CHECK (checklist_result IN ('PASS','FAIL','CONDITIONAL')),
  defects_noted     TEXT,
  follow_up_required BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up_date    DATE,
  photos            JSONB DEFAULT '[]',
  last_modified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE jabco_punch_list_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE jabco_site_incidents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE jabco_quality_inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY jabco_punch_tenant     ON jabco_punch_list_items
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY jabco_incidents_tenant ON jabco_site_incidents
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY jabco_quality_tenant   ON jabco_quality_inspections
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE INDEX IF NOT EXISTS idx_punch_project     ON jabco_punch_list_items (project_id);
CREATE INDEX IF NOT EXISTS idx_punch_status      ON jabco_punch_list_items (status);
CREATE INDEX IF NOT EXISTS idx_incidents_project ON jabco_site_incidents (project_id);
CREATE INDEX IF NOT EXISTS idx_quality_project   ON jabco_quality_inspections (project_id);
