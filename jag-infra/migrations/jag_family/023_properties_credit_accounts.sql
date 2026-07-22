-- 023_properties_credit_accounts.sql
-- Registers the credit-side GL accounts for the JAG Properties entity
-- (owner_entity_id 00000000-0000-0000-0001-000000000003), which until now had
-- only revenue (4xxx) and expense (5xxx) accounts and no asset/liability accounts.
--
-- 1100  First Citizens Bank — Rent Account (…3082)  ASSET/DEBIT   (the account rents are paid into)
-- 2100  Accounts Payable — Vendors                  LIABILITY/CREDIT
--
-- OPSEC: only the last 4 digits of the bank account number are stored in the name.
--
-- STAGED FOR PHASE 2: the Phase 1 Properties↔Finance bridge creates DRAFT expenses
-- only and does NOT post to the GL, so these accounts are not yet referenced by any
-- posting. They complete the chart so accrual/payment posting can be wired later.
-- Idempotent via the UNIQUE(owner_id, owner_entity_id, account_code) constraint.

INSERT INTO fin_gl_accounts
  (owner_id, owner_entity_id, account_code, account_name,
   account_type, normal_balance, currency, description, is_active, allow_direct_posting)
VALUES
  ('95ca3f77-60ba-4a0f-af70-2832b247b525', '00000000-0000-0000-0001-000000000003',
   '1100', 'First Citizens Bank — Rent Account (…3082)',
   'ASSET', 'DEBIT', 'TTD', 'FCB operating/rent bank account for JAG Properties.', true, true),
  ('95ca3f77-60ba-4a0f-af70-2832b247b525', '00000000-0000-0000-0001-000000000003',
   '2100', 'Accounts Payable — Vendors',
   'LIABILITY', 'CREDIT', 'TTD', 'Amounts owed to property vendors/contractors.', true, true)
ON CONFLICT (owner_id, owner_entity_id, account_code) DO NOTHING;
