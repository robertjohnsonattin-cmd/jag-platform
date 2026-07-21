-- Migration 053: link an application to the tenant it produced.
--
-- prop_applications has no tenant_id at all -- create-tenant (applications.ts)
-- reads FROM the application to build a prop_property_tenants row, but never
-- writes anything back, so the link from tenant -> originating application is
-- lost the moment the tenant exists. Same gap deposits had (migration 052)
-- and leases had (missing query, migration-free since tenant_id already
-- existed there) -- applications needed both a column and a query.

ALTER TABLE prop_applications
  ADD COLUMN tenant_id UUID REFERENCES prop_property_tenants(id) ON DELETE SET NULL;

CREATE INDEX idx_prop_applications_tenant ON prop_applications(tenant_id);
