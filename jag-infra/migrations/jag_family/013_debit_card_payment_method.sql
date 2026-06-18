-- Migration 013: add DEBIT_CARD to expense_payment_method enum
ALTER TYPE expense_payment_method ADD VALUE IF NOT EXISTS 'DEBIT_CARD';
