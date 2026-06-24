-- Migration: add disposal tracking columns to ims_items
-- Allows any is_asset=true item to be formally disposed (same flow as VMS vehicles)

ALTER TABLE ims_items
  ADD COLUMN IF NOT EXISTS disposed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disposal_type        VARCHAR(20)   CHECK (disposal_type IN ('SALE','WRITE_OFF','TRANSFER')),
  ADD COLUMN IF NOT EXISTS disposal_notes       TEXT,
  ADD COLUMN IF NOT EXISTS sale_price_ttd       NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS buyer_name           VARCHAR(200),
  ADD COLUMN IF NOT EXISTS disposal_gl_entry_id UUID;
