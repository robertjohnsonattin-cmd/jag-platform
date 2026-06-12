export type GlAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | 'OTHER_INCOME' | 'OTHER_EXPENSE'
export type NormalBalance = 'DEBIT' | 'CREDIT'
export type EntryStatus   = 'DRAFT' | 'POSTED' | 'VOID'
export type EntrySource   = 'MANUAL' | 'BANK_IMPORT' | 'TRANSACTION_SYNC' | 'INTERCOMPANY' | 'PERIOD_CLOSE' | 'ADJUSTMENT'

export interface GlAccount {
  id: string
  owner_entity_id: string
  account_code: string
  account_name: string
  account_type: GlAccountType
  normal_balance: NormalBalance
  parent_id: string | null
  currency: string
  description: string | null
  is_active: boolean
  allow_direct_posting: boolean
  created_at: string
}

export interface JournalEntry {
  id: string
  owner_entity_id: string
  entry_date: string
  period_year: number
  period_month: number
  reference: string | null
  description: string
  status: EntryStatus
  source: EntrySource
  currency: string
  total_debit_ttd: string
  total_credit_ttd: string
  posted_at: string | null
  posted_by: string | null
  idempotency_key: string
  lines?: JournalEntryLine[]
  created_at: string
}

export interface JournalEntryLine {
  id: string
  journal_entry_id: string
  gl_account_id: string
  line_number: number
  description: string | null
  debit_ttd: string
  credit_ttd: string
  currency: string
  account_code?: string
  account_name?: string
  account_type?: GlAccountType
}

export interface TrialBalanceRow {
  account_id: string
  account_code: string
  account_name: string
  account_type: GlAccountType
  normal_balance: NormalBalance
  total_debit: string
  total_credit: string
  net_debit: string
  net_credit: string
}
