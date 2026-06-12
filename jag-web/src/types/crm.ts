export type InteractionType = 'CALL' | 'EMAIL' | 'MEETING' | 'SITE_VISIT' | 'OTHER'

export interface Company {
  id: string
  name: string
  industry: string | null
  country: string
  phone: string | null
  email: string | null
  website: string | null
  last_modified_at: string
  created_at: string
  contact_count: number
}

export interface CompaniesResponse {
  companies: Company[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

export interface Contact {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  role: string
  preferred_language: string
  last_modified_at: string
  created_at: string
  company_id: string | null
  company_name: string | null
}

export interface ContactsResponse {
  contacts: Contact[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

export interface Interaction {
  id: string
  tenant_id: string
  contact_id: string
  user_id: string
  interaction_type: InteractionType
  subject: string
  notes: string | null
  occurred_at: string
  follow_up_date: string | null
}

export interface CreateCompanyPayload {
  name: string
  industry?: string
  country?: string
  phone?: string
  email?: string
  website?: string
  notes?: string
}

export interface LogInteractionPayload {
  contact_id: string
  interaction_type: InteractionType
  subject: string
  notes?: string
  occurred_at: string
  follow_up_date?: string
}
