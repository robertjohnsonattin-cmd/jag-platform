-- Migration 064: WhatsApp payment-slip OCR audit trail on prop_rent_schedule (STD-13 expand-only)
-- Supports the inbound-WhatsApp flow: a tenant sends a photo of a bank transfer/
-- deposit slip, Gemini vision reads the amount/date/reference, and if it confidently
-- matches the earliest unpaid period for that tenant's active lease the payment is
-- auto-recorded and the existing jag_rent_receipt_full_v2 receipt is sent back —
-- same as a manually recorded payment, just a different payment_source. A low-
-- confidence or non-matching read is NOT auto-posted; it's attached here for
-- Robert to confirm from Tenant -> Rent, same UI the manual record-payment already has.

ALTER TABLE prop_rent_schedule
  ADD COLUMN IF NOT EXISTS payment_source VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
    CHECK (payment_source IN ('MANUAL','WHATSAPP_OCR')),
  ADD COLUMN IF NOT EXISTS ocr_extracted_amount_ttd NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS ocr_extracted_date       DATE,
  ADD COLUMN IF NOT EXISTS ocr_confidence           VARCHAR(10)
    CHECK (ocr_confidence IN ('HIGH','MEDIUM','LOW') OR ocr_confidence IS NULL),
  ADD COLUMN IF NOT EXISTS payment_slip_object_key  TEXT,
  ADD COLUMN IF NOT EXISTS ocr_review_needed        BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_prop_rent_ocr_review ON prop_rent_schedule(ocr_review_needed) WHERE ocr_review_needed;
