-- Fixes a pre-existing defect in POST /finance/expenses/:id/reverse: the handler
-- writes fin_journal_entries.voided_at/voided_by (columns that do not exist) and
-- inserts source='REVERSAL' / fin_expenses.status='REVERSED' (values not present in
-- their enums). Every one of the three would abort the transaction — the endpoint has
-- never successfully completed in production (0 expenses in REVERSED status).
--
-- This migration adds the missing pieces so the existing handler code works as written.
-- Also required as groundwork for the new vendor-invoice /unpay endpoint (Phase 2.1),
-- which uses the same REVERSAL source value for its settlement-reversal journal entries.

ALTER TABLE fin_journal_entries
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID;

ALTER TYPE gl_entry_source ADD VALUE IF NOT EXISTS 'REVERSAL';
ALTER TYPE expense_status  ADD VALUE IF NOT EXISTS 'REVERSED';
