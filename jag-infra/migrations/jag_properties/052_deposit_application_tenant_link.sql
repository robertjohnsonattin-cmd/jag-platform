-- Migration 052: link deposits directly to the application and (once known) the tenant.
--
-- prop_deposits previously only resolved back to a tenant via lease_id ->
-- prop_lease_agreements.tenant_id, which meant (a) no deposit could be tied
-- to anyone until a lease existed, and (b) the automatic WhatsApp receipt
-- send in POST /properties/deposits only fired when an ACTIVE lease was
-- already on the unit. But by the time a deposit is taken, the applicant's
-- name/phone are already on file on prop_applications (full_name, phone) --
-- no lease required. Adding these as nullable soft-refs (STD-13 expand,
-- additive only) lets a deposit recorded right after approval send its
-- receipt immediately, and lets a tenant record show its deposits directly
-- instead of only through a lease.

ALTER TABLE prop_deposits
  ADD COLUMN application_id UUID REFERENCES prop_applications(id) ON DELETE SET NULL,
  ADD COLUMN tenant_id      UUID REFERENCES prop_property_tenants(id) ON DELETE SET NULL;

CREATE INDEX idx_prop_deposits_application ON prop_deposits(application_id);
CREATE INDEX idx_prop_deposits_tenant      ON prop_deposits(tenant_id);
