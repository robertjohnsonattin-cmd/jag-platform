-- Migration 021: Lease Renewal Tracking

CREATE TABLE prop_renewal_notices (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                     UUID NOT NULL,
  lease_id                     UUID NOT NULL REFERENCES prop_lease_agreements(id) ON DELETE CASCADE,
  unit_id                      UUID NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  notice_sent_at               TIMESTAMPTZ,
  d60_sent_at                  TIMESTAMPTZ,
  d30_sent_at                  TIMESTAMPTZ,
  d14_sent_at                  TIMESTAMPTZ,
  tenant_response              VARCHAR(20) CHECK (tenant_response IN ('RENEWING','VACATING','DISCUSSING','NO_RESPONSE')),
  tenant_responded_at          TIMESTAMPTZ,
  new_rent_ttd                 NUMERIC(12,2),
  new_lease_id                 UUID REFERENCES prop_lease_agreements(id) ON DELETE SET NULL,
  vacating_date                DATE,
  exit_inspection_scheduled_at TIMESTAMPTZ,
  notes                        TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_renewal_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_renewal_notices_owner ON prop_renewal_notices
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_renewals_lease ON prop_renewal_notices(lease_id);
