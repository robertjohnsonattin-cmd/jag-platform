-- Migration 055: link a handover checklist to the tenant it was done for.
--
-- prop_handover_checklists has no tenant_id at all -- only a nullable lease_id
-- (unlike maintenance tickets, this one IS collected by the frontend form, via
-- a lease picker, but it's optional and there's no general tenant-scoped query
-- route either -- only GET /unit/:unitId exists). Same class of gap as
-- deposits/applications/maintenance (migrations 052/053/054). tenant_id is
-- resolved from lease_id if given, else from the unit's active lease.

ALTER TABLE prop_handover_checklists
  ADD COLUMN tenant_id UUID REFERENCES prop_property_tenants(id) ON DELETE SET NULL;

CREATE INDEX idx_prop_handover_tenant ON prop_handover_checklists(tenant_id);
