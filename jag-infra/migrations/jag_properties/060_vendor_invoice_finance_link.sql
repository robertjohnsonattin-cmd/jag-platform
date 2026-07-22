-- 060_vendor_invoice_finance_link.sql
-- Properties ↔ Finance expense bridge (Phase 1).
--
-- When a property vendor invoice is approved, the API cross-database creates a
-- linked DRAFT expense in jag_family.fin_expenses (linked_record_type='PROPERTY').
-- This column stores that expense's id so the property portal can show the link
-- and so approve is idempotent (never double-bridges the same invoice).
--
-- Cross-database link: fin_expenses lives in jag_family, so no FK is possible.
-- Nullable; only populated once the invoice has been approved.

ALTER TABLE prop_vendor_invoices
  ADD COLUMN IF NOT EXISTS linked_expense_id UUID;

COMMENT ON COLUMN prop_vendor_invoices.linked_expense_id IS
  'ID of the linked jag_family.fin_expenses DRAFT created on approval. Cross-DB (no FK).';

CREATE INDEX IF NOT EXISTS idx_prop_vendor_invoices_linked_expense
  ON prop_vendor_invoices (linked_expense_id)
  WHERE linked_expense_id IS NOT NULL;
