ALTER TABLE jabco_variation_orders
  ADD COLUMN IF NOT EXISTS time_extension_days INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN jabco_variation_orders.time_extension_days IS
  'Days added to jabco_projects.expected_end_date on approval. 0 = no schedule impact.';
