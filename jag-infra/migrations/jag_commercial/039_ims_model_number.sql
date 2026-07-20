-- Migration 039: IMS — model_number on items
-- STD-13 Step 1 (Expand only): additive, nullable, no existing data touched.
--
-- Context: serial_number already existed but model_number had nowhere to go
-- except free-text description, making "find every item of this model" (e.g.
-- for a recall, or a bulk warranty check) impossible as a real query. Mirrors
-- the same reasoning as migration 038's additive fields.

ALTER TABLE ims_items
  ADD COLUMN IF NOT EXISTS model_number varchar(100) NULL;

COMMENT ON COLUMN ims_items.model_number IS
  'Manufacturer model/part number, distinct from serial_number (which identifies
   one physical unit). e.g. "MFC-L2717DW" vs serial "U65527K0N340359".';

CREATE INDEX IF NOT EXISTS idx_ims_items_model_number ON ims_items(model_number);
