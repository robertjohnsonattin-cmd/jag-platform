export type ExpenseStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'

export interface Expense {
  id: string
  owner_entity_id: string
  submitted_by: string
  expense_date: string
  description: string
  payee_name: string | null
  amount: string
  currency: string
  amount_ttd: string
  fx_rate_used: string | null
  payment_method: string
  category: string
  gl_debit_account_id: string | null
  gl_credit_account_id: string | null
  status: ExpenseStatus
  submitted_at: string | null
  approved_by: string | null
  approved_at: string | null
  rejection_reason: string | null
  journal_entry_id: string | null
  receipt_path: string | null
  receipt_filename: string | null
  notes: string | null
  idempotency_key: string
  created_at: string
  updated_at: string
  linked_record_type: string | null
  linked_record_id: string | null
  linked_record_label: string | null
  fuel_litres: string | null
  fuel_odometer_km: number | null
  fuel_type: string | null
}
