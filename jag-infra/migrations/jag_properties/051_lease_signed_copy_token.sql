-- Adds a public, opaque token used to hand the tenant a self-serve download
-- link for their fully-signed lease PDF, generated once both parties sign
-- (see routes/internal/documenso-webhook.ts). STD-13 expand-only.
ALTER TABLE prop_lease_agreements
  ADD COLUMN IF NOT EXISTS signed_copy_token UUID;
