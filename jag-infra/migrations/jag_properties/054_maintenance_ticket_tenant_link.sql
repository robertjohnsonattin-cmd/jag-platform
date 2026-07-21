-- Migration 054: link a maintenance ticket to the tenant who reported it.
--
-- prop_maintenance_tickets has no tenant_id at all -- only a nullable lease_id
-- (never actually populated; the frontend form doesn't collect it) and free-text
-- reported_by_name/reported_by_phone. Same class of gap as deposits (migration
-- 052) and applications (migration 053): no durable link back to the tenant, no
-- tenant-scoped query, no Tenant-record UI surface. unit_id is the reliable field
-- here (required unless the ticket is building-wide with no unit), so tenant_id
-- is resolved from the unit's active lease at ticket-creation time.

ALTER TABLE prop_maintenance_tickets
  ADD COLUMN tenant_id UUID REFERENCES prop_property_tenants(id) ON DELETE SET NULL;

CREATE INDEX idx_prop_tickets_tenant ON prop_maintenance_tickets(tenant_id);
