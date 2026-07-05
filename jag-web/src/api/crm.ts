import { tenantApi } from './client'
import type {
  CompaniesResponse, Company,
  ContactsResponse, Contact,
  Interaction,
  InteractionType,
  CreateCompanyPayload,
  UpdateCompanyPayload,
  CreateContactPayload,
  UpdateContactPayload,
  LogInteractionPayload,
} from '../types/crm'

// CRM uses jag_commercial with withTenantRLS.
// Owner (Robert) has app.bypass_rls=true so JAG_HOLDINGS tenant shows all records.
const CRM_TENANT = '00000000-0000-0000-0001-000000000001'
const client = tenantApi(CRM_TENANT)

export const crmApi = {
  getCompanies: (params: { search?: string; page?: number; limit?: number } = {}): Promise<CompaniesResponse> => {
    const q = new URLSearchParams()
    if (params.search) q.set('search', params.search)
    if (params.page)   q.set('page', String(params.page))
    if (params.limit)  q.set('limit', String(params.limit))
    const qs = q.toString()
    return client.get(`/crm/companies${qs ? `?${qs}` : ''}`)
  },

  createCompany: (data: CreateCompanyPayload): Promise<Company> =>
    client.post('/crm/companies', data),

  updateCompany: (id: string, data: UpdateCompanyPayload): Promise<Company> =>
    client.patch(`/crm/companies/${id}`, data),

  getContacts: (params: { company_id?: string; search?: string; page?: number; limit?: number } = {}): Promise<ContactsResponse> => {
    const q = new URLSearchParams()
    if (params.company_id) q.set('company_id', params.company_id)
    if (params.search)     q.set('search', params.search)
    if (params.page)       q.set('page', String(params.page))
    if (params.limit)      q.set('limit', String(params.limit))
    const qs = q.toString()
    return client.get(`/crm/contacts${qs ? `?${qs}` : ''}`)
  },

  getContact: (id: string): Promise<Contact> =>
    client.get(`/crm/contacts/${id}`),

  createContact: (data: CreateContactPayload): Promise<Contact> =>
    client.post('/crm/contacts', data),

  updateContact: (id: string, data: UpdateContactPayload): Promise<Contact> =>
    client.patch(`/crm/contacts/${id}`, data),

  logInteraction: (data: LogInteractionPayload): Promise<Interaction> =>
    client.post('/crm/interactions', data),

  // Fire-and-forget log for Call/WhatsApp/Email quick-action links — records intent
  // to reach the contact, not confirmed delivery (mailto:/tel:/wa.me hand off to the OS).
  quickLog: (contactId: string, interactionType: InteractionType, subject: string): Promise<Interaction> =>
    client.post('/crm/interactions', {
      contact_id: contactId,
      interaction_type: interactionType,
      subject,
      occurred_at: new Date().toISOString(),
    } as LogInteractionPayload),

  deleteCompany: (id: string) =>
    client.delete<{ deleted: boolean; id: string }>(`/crm/companies/${id}`),

  deleteContact: (id: string) =>
    client.delete<{ deleted: boolean; id: string }>(`/crm/contacts/${id}`),
}
