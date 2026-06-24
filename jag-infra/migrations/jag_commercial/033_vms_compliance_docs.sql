-- Migration 033: VMS Increment 2 — compliance document vault
-- STD-04: versioned migration, never run raw SQL on production.
-- RLS uses NULLIF pattern (STD-02).
-- Files stored in MinIO jag-documents bucket under vehicles/{vehicleId}/compliance/
-- Expiry reminder state tracked via reminder_sent_at (deduplication by cron).

CREATE TABLE vms_compliance_docs (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid         NOT NULL,
  vehicle_id        uuid         NOT NULL REFERENCES ims_vehicles(id) ON DELETE CASCADE,
  doc_type          varchar(50)  NOT NULL
                    CHECK (doc_type IN (
                      'CERTIFICATE_OF_FITNESS',
                      'INSURANCE_CERTIFICATE',
                      'ROAD_TAX',
                      'CUSTOMS_RELEASE',
                      'IMPORT_PERMIT',
                      'TITLE',
                      'TYRE_CERT',
                      'OTHER'
                    )),
  title             varchar(200) NOT NULL,
  doc_number        varchar(100),
  issuing_authority varchar(200),
  issue_date        date,
  expiry_date       date,
  -- MinIO jag-documents bucket object key; NULL until file uploaded
  object_key        text,
  -- Set when an expiry-approaching alert has been dispatched (for dedup by cron)
  reminder_sent_at  timestamptz,
  notes             text,
  last_modified_at  timestamptz  NOT NULL DEFAULT now(),
  last_modified_by  uuid,
  created_at        timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE vms_compliance_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY vms_compliance_rls ON vms_compliance_docs
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

CREATE INDEX IF NOT EXISTS idx_vms_comp_vehicle
  ON vms_compliance_docs(vehicle_id, expiry_date);

CREATE INDEX IF NOT EXISTS idx_vms_comp_tenant
  ON vms_compliance_docs(tenant_id);

-- For the expiry-monitor cron: all active docs with an approaching expiry date
CREATE INDEX IF NOT EXISTS idx_vms_comp_expiry
  ON vms_compliance_docs(expiry_date)
  WHERE expiry_date IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON vms_compliance_docs TO jag_app;
