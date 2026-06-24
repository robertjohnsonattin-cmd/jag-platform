-- 033_tenant_documents.sql
-- Tenant KYC document vault + application document tracking
--
-- prop_application_documents: object keys registered when presigned PUT URL is issued
-- prop_tenant_documents:      permanent vault; source = MANUAL or APPLICATION (copied on create-tenant)

BEGIN;

-- ── Application documents ────────────────────────────────────────────────────

CREATE TABLE prop_application_documents (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID        NOT NULL,
  application_id   UUID        NOT NULL REFERENCES prop_applications(id) ON DELETE CASCADE,
  doc_type         VARCHAR(50) NOT NULL,
  label            TEXT        NOT NULL,
  minio_object_key TEXT        NOT NULL,
  file_name        TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_appdocs_application ON prop_application_documents(application_id);

ALTER TABLE prop_application_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_appdocs_owner ON prop_application_documents
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

-- ── Tenant document vault ────────────────────────────────────────────────────

CREATE TABLE prop_tenant_documents (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID        NOT NULL,
  tenant_id        UUID        NOT NULL REFERENCES prop_property_tenants(id) ON DELETE CASCADE,
  doc_type         VARCHAR(50) NOT NULL DEFAULT 'other',
  label            TEXT        NOT NULL,
  minio_object_key TEXT        NOT NULL,
  file_name        TEXT        NOT NULL,
  file_size_bytes  BIGINT,
  mime_type        VARCHAR(100),
  notes            TEXT,
  source           VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  application_id   UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tendocs_tenant ON prop_tenant_documents(tenant_id);

ALTER TABLE prop_tenant_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_tendocs_owner ON prop_tenant_documents
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

COMMIT;
