import { api } from './client'

export type ProgType = 'AIRLINE' | 'HOTEL' | 'CRUISE' | 'CREDIT_CARD' | 'RETAIL' | 'DINING' | 'OTHER'
export type TxType = 'EARN' | 'REDEEM' | 'EXPIRE' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'BONUS' | 'REINSTATEMENT'
export type MetricType =
  | 'WEIGHT_KG' | 'STEPS' | 'SLEEP_HOURS' | 'CALORIES' | 'EXERCISE_MINUTES'
  | 'BLOOD_PRESSURE_SYSTOLIC' | 'BLOOD_PRESSURE_DIASTOLIC' | 'RESTING_HEART_RATE'
  | 'CHOLESTEROL_TOTAL' | 'CHOLESTEROL_LDL' | 'CHOLESTEROL_HDL' | 'TRIGLYCERIDES' | 'BLOOD_GLUCOSE'
  | 'OTHER'

export interface LoyaltyProgramme {
  id: string
  programme_type: ProgType
  provider_name: string
  membership_number: string | null
  tier: string | null
  points_balance: number
  miles_balance: number
  expiry_date: string | null
  family_member_id: string | null
  last_modified_at: string
  created_at: string
}

export interface LoyaltyTransaction {
  id: string
  transaction_date: string
  transaction_type: TxType
  points_amount: number
  miles_amount: number
  description: string
  reference_number: string | null
  created_at: string
}

export interface TrackerEntry {
  id: string
  entry_date: string
  metric_type: MetricType
  value: number
  unit: string
  family_member_id: string | null
  source: string | null
  notes: string | null
  created_at: string
}

export const lifestyleApi = {
  // Loyalty programmes
  getProgrammes: (family_member_id?: string) =>
    api.get<LoyaltyProgramme[]>(`/lifestyle/loyalty${family_member_id ? `?family_member_id=${family_member_id}` : ''}`),

  createProgramme: (data: {
    programme_type: ProgType
    provider_name: string
    membership_number?: string
    tier?: string
    points_balance?: number
    miles_balance?: number
    expiry_date?: string
    family_member_id?: string
    notes?: string
  }) => api.post<LoyaltyProgramme>('/lifestyle/loyalty', data),

  updateProgramme: (id: string, data: Partial<{
    tier: string
    points_balance: number
    miles_balance: number
    expiry_date: string
    membership_number: string
    family_member_id: string | null
    notes: string
  }>) => api.patch<LoyaltyProgramme>(`/lifestyle/loyalty/${id}`, data),

  getTransactions: (programmeId: string) =>
    api.get<LoyaltyTransaction[]>(`/lifestyle/loyalty/${programmeId}/transactions`),

  addTransaction: (programmeId: string, data: {
    transaction_date: string
    transaction_type: TxType
    points_amount?: number
    miles_amount?: number
    description: string
    reference_number?: string
    idempotency_key: string
  }) => api.post<LoyaltyTransaction>(`/lifestyle/loyalty/${programmeId}/transactions`, data),

  // Health tracker
  getTrackerEntries: (params?: {
    metric_type?: MetricType
    from_date?: string
    to_date?: string
    family_member_id?: string
  }) => {
    const q = new URLSearchParams()
    if (params?.metric_type) q.set('metric_type', params.metric_type)
    if (params?.from_date) q.set('from_date', params.from_date)
    if (params?.to_date) q.set('to_date', params.to_date)
    if (params?.family_member_id) q.set('family_member_id', params.family_member_id)
    const qs = q.toString()
    return api.get<TrackerEntry[]>(`/lifestyle/tracker${qs ? `?${qs}` : ''}`)
  },

  addTrackerEntry: (data: {
    entry_date: string
    metric_type: MetricType
    value: number
    unit: string
    family_member_id?: string
    notes?: string
    source?: string
  }) => api.post<TrackerEntry>('/lifestyle/tracker', data),
}
