-- IMS: SALE movement type + VAT fields
-- STD-13 Expand-and-Contract: adding new enum value and columns only (no drops/renames).

-- 1. Extend the movement type enum with SALE.
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'SALE';

-- 2. Add VAT code enum for items.
DO $$ BEGIN
  CREATE TYPE ims_vat_code AS ENUM ('STANDARD', 'ZERO', 'EXEMPT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Add vat_code to ims_items.
ALTER TABLE ims_items
  ADD COLUMN IF NOT EXISTS vat_code ims_vat_code NOT NULL DEFAULT 'STANDARD';

-- 4. Add SALE-specific columns to ims_stock_movements.
ALTER TABLE ims_stock_movements
  ADD COLUMN IF NOT EXISTS sale_price       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS vat_amount       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS customer_name    VARCHAR(200),
  ADD COLUMN IF NOT EXISTS internal_entity  UUID;  -- FK to a JAG entity (informational)
