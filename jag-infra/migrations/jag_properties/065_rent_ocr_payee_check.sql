-- Migration 065: payee verification for WhatsApp payment-slip OCR (STD-13 expand-only)
-- Found in first live test (2026-07-30): the OCR only read amount/date/reference
-- off the slip — it never checked WHO the money was actually paid to. A tenant
-- could submit a real bank transfer slip for a payment to someone else entirely
-- and it would still get flagged as "a payment slip" with no warning. Gemini
-- now also reads the recipient name off the slip and is given the expected
-- payee/bank/account (lib/payment-config.ts getPaymentDetails()) to compare
-- against, so a mismatch is surfaced loudly instead of silently missed.

ALTER TABLE prop_rent_schedule
  ADD COLUMN IF NOT EXISTS ocr_recipient_name TEXT,
  ADD COLUMN IF NOT EXISTS ocr_payee_match     VARCHAR(10)
    CHECK (ocr_payee_match IN ('MATCH','MISMATCH','UNKNOWN') OR ocr_payee_match IS NULL);
