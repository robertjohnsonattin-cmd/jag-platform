-- Migration 040: IMS — manufacturer/brand on items
-- STD-13 Step 1 (Expand only): additive, nullable, no existing data touched.
--
-- Context: standardizing item naming to "{Manufacturer} {Model} -- {Type}"
-- (e.g. "Dell S3422DWG -- Curved Monitor") needs a distinct manufacturer field.
-- Folding it into model_number or description would make it un-queryable
-- ("show me every Dell we own" should be a real filter, not a text search).

ALTER TABLE ims_items
  ADD COLUMN IF NOT EXISTS manufacturer varchar(100) NULL;

COMMENT ON COLUMN ims_items.manufacturer IS
  'Brand/manufacturer, distinct from model_number. e.g. "Dell", "Brother", "HP".';

CREATE INDEX IF NOT EXISTS idx_ims_items_manufacturer ON ims_items(manufacturer);
