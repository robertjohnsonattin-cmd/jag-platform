import { api } from './client'
import type { Expense } from '../types/expenses'

function qs(params?: Record<string, string | number | undefined>): string {
  if (!params) return ''
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  )
  const s = new URLSearchParams(filtered).toString()
  return s ? `?${s}` : ''
}

export const expensesApi = {
  getExpenses: (params?: {
    owner_entity_id?: string
    status?: string
    category?: string
    date_from?: string
    date_to?: string
    limit?: number
    offset?: number
  }) => api.get<Expense[]>(`/finance/expenses${qs(params)}`),

  createExpense: (body: {
    owner_entity_id: string
    expense_date: string
    description: string
    payee_name?: string
    amount: number
    currency: string
    amount_ttd: number
    payment_method: string
    category: string
    notes?: string
    idempotency_key: string
    linked_record_type?: string
    linked_record_id?: string
    linked_record_label?: string
    fuel_litres?: number
    fuel_odometer_km?: number
    fuel_type?: string
  }) => api.post<Expense>('/finance/expenses', body),

  submit: (id: string) =>
    api.post<Expense>(`/finance/expenses/${id}/submit`, {}),

  approve: (id: string, body: {
    gl_debit_account_id: string
    gl_credit_account_id: string
    idempotency_key: string
  }) => api.post<Expense>(`/finance/expenses/${id}/approve`, body),

  reject: (id: string, rejection_reason: string) =>
    api.post<Expense>(`/finance/expenses/${id}/reject`, { rejection_reason }),

  reverse: (id: string, reversal_reason: string) =>
    api.post<Expense>(`/finance/expenses/${id}/reverse`, {
      reversal_reason,
      idempotency_key: crypto.randomUUID(),
    }),

  delete: (id: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/finance/expenses/${id}`),
}
