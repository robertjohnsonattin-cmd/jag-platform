-- Migration 011: Add proof_image_url to prop_rent_payments
-- STD-13 Step 1 (Expand): add nullable column; no existing code changes needed.
-- Stores the MinIO URL of the WhatsApp bank-transfer proof photo uploaded by staff.

ALTER TABLE prop_rent_payments
  ADD COLUMN IF NOT EXISTS proof_image_url TEXT;

COMMENT ON COLUMN prop_rent_payments.proof_image_url IS
  'MinIO presigned or permanent URL of the WhatsApp payment proof photo uploaded by staff.';
