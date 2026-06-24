export type InteractionType = 'CALL' | 'WHATSAPP_CALL' | 'WHATSAPP_MESSAGE' | 'EMAIL' | 'MEETING' | 'SITE_VISIT' | 'OTHER'

export interface Company {
  id: string
  name: string
  industry: string | null
  country: string
  phone: string | null
  email: string | null
  website: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state_province: string | null
  postal_code: string | null
  last_modified_at: string
  created_at: string
  contact_count: number
}

export interface CompaniesResponse {
  companies: Company[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

export interface ContactInteraction {
  id: string
  interaction_type: InteractionType
  subject: string
  notes: string | null
  occurred_at: string
  follow_up_date: string | null
  calendar_event_id: string | null
  created_at: string
}

export interface Contact {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null        // land phone
  phone2: string | null       // cell phone
  role: string | null
  notes: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state_province: string | null
  postal_code: string | null
  birthday: string | null
  preferred_language: string
  last_modified_at: string
  created_at: string
  company_id: string | null
  company_name: string | null
  interactions?: ContactInteraction[]
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
  address_line1?: string
  address_line2?: string
  city?: string
  state_province?: string
  postal_code?: string
}

export interface UpdateCompanyPayload {
  name?: string
  industry?: string | null
  country?: string
  phone?: string | null
  email?: string | null
  website?: string | null
  notes?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state_province?: string | null
  postal_code?: string | null
}

export interface CreateContactPayload {
  first_name: string
  last_name: string
  email?: string
  phone?: string
  phone2?: string
  role?: string
  company_id?: string
  notes?: string
  preferred_language?: string
  address_line1?: string
  address_line2?: string
  city?: string
  state_province?: string
  postal_code?: string
  birthday?: string
}

export interface UpdateContactPayload {
  first_name?: string
  last_name?: string
  email?: string | null
  phone?: string | null
  phone2?: string | null
  role?: string | null
  company_id?: string | null
  notes?: string | null
  preferred_language?: string
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state_province?: string | null
  postal_code?: string | null
  birthday?: string | null
}

export interface LogInteractionPayload {
  contact_id: string
  interaction_type: InteractionType
  subject: string
  notes?: string
  occurred_at: string
  follow_up_date?: string
}
