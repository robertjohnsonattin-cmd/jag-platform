import { api } from './client'
import type { GlAccount, JournalEntry, TrialBalanceRow } from '../types/gl'

export const glApi = {
  getAccounts: (params?: { owner_entity_id?: string; account_type?: string; is_active?: 'true' | 'false' }) => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
    return api.get<GlAccount[]>(`/finance/gl/accounts${qs}`)
  },

  getEntries: (params?: {
    owner_entity_id?: string
    status?: string
    date_from?: string
    date_to?: string
    period_year?: number
    period_month?: number
    limit?: number
    offset?: number
  }) => {
    const qs = params
      ? '?' + new URLSearchParams(
          Object.fromEntries(
            Object.entries(params)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, String(v)])
          )
        ).toString()
      : ''
    return api.get<JournalEntry[]>(`/finance/gl/entries${qs}`)
  },

  getEntry: (id: string) => api.get<JournalEntry>(`/finance/gl/entries/${id}`),

  postEntry: (id: string) => api.post<JournalEntry>(`/finance/gl/entries/${id}/post`, {}),

  voidEntry: (id: string, void_reason: string) =>
    api.post<JournalEntry>(`/finance/gl/entries/${id}/void`, { void_reason }),

  getTrialBalance: (params: { period_year: number; period_month?: number; owner_entity_id?: string }) => {
    const qs = '?' + new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      )
    ).toString()
    return api.get<TrialBalanceRow[]>(`/finance/gl/trial-balance${qs}`)
  },
}
