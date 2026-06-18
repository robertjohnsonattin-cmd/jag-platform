import { api } from './client'
import type { ExpenseCategory, PaymentMethod } from '../constants/enums'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreditCard {
  id: string
  card_name: string
  last_four: string | null
  card_type: string | null
  is_active: boolean
  created_at: string
}

export interface Expense {
  id: string
  owner_entity_id: string
  expense_date: string
  description: string
  payee_name: string | null
  amount: string
  currency: string
  amount_ttd: string
  payment_method: PaymentMethod
  category: ExpenseCategory
  card_id: string | null
  notes: string | null
  receipt_url: string | null
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REVERSED'
  created_at: string
}

export interface CreateExpenseBody {
  owner_entity_id: string
  expense_date: string
  description: string
  payee_name?: string
  amount: number
  currency: string
  amount_ttd: number
  payment_method: PaymentMethod
  category: ExpenseCategory
  card_id?: string
  notes?: string
  idempotency_key: string
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const expensesApi = {
  create: (body: CreateExpenseBody) =>
    api.post<Expense>('/finance/expenses', body),

  uploadReceipt: (id: string, form: FormData) =>
    api.postForm<{ receipt_url: string }>(`/finance/expenses/${id}/receipt`, form),

  submit: (id: string) =>
    api.post<Expense>(`/finance/expenses/${id}/submit`, {}),
}

export const creditCardsApi = {
  list: () =>
    api.get<CreditCard[]>('/finance/credit-cards'),

  create: (body: { card_name: string; last_four?: string; card_type?: string }) =>
    api.post<CreditCard>('/finance/credit-cards', body),

  deactivate: (id: string) =>
    api.delete<{ deactivated: boolean }>(`/finance/credit-cards/${id}`),
}
