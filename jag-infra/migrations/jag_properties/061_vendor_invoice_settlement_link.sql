-- Phase 2 (accrual) — settlement journal-entry link for vendor invoices.
--
-- When an APPROVED vendor invoice is paid, the /pay endpoint posts a settlement
-- journal entry in jag_family (Dr 2100 Accounts Payable, Cr 1100 FCB Bank …3082)
-- that clears the payable recognised at finance-approval (Dr 5100 / Cr 2100).
-- This column stores that settlement entry's id for traceability and to make the
-- pay operation idempotent on retry. Cross-DB (jag_properties ↔ jag_family) — no FK.
--
-- NULL means either: unpaid, or paid without an accrual settlement leg (i.e. the
-- linked expense was finance-approved crediting a bank/asset directly — cash-basis,
-- already settled at approval, so no second leg is posted).

ALTER TABLE prop_vendor_invoices
  ADD COLUMN IF NOT EXISTS settlement_journal_entry_id UUID;

COMMENT ON COLUMN prop_vendor_invoices.settlement_journal_entry_id IS
  'ID of the jag_family.fin_journal_entries settlement entry (Dr A/P, Cr Bank) posted when this invoice was paid. Cross-DB (no FK). NULL if unpaid or cash-basis (no accrual settlement leg).';

CREATE INDEX IF NOT EXISTS idx_prop_vendor_invoices_settlement_je
  ON prop_vendor_invoices (settlement_journal_entry_id)
  WHERE settlement_journal_entry_id IS NOT NULL;
