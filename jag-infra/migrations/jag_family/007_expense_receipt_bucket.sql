-- STD-13 Expand step: add receipt_bucket to fin_expenses.
-- Existing rows will have NULL (no bucket) — handled gracefully by the API.
ALTER TABLE fin_expenses
  ADD COLUMN IF NOT EXISTS receipt_bucket VARCHAR(100);
