ALTER TABLE jabco_boq_items
  ADD COLUMN IF NOT EXISTS internal_cost_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS markup_percent     NUMERIC,
  ADD COLUMN IF NOT EXISTS final_bid_rate     NUMERIC,
  ADD COLUMN IF NOT EXISTS work_package_tag   VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_boq_work_package ON jabco_boq_items (work_package_tag)
  WHERE work_package_tag IS NOT NULL;

COMMENT ON COLUMN jabco_boq_items.work_package_tag IS
  'e.g. Concrete, Earthworks, Electrical — used to group historical rate variance by trade.';
