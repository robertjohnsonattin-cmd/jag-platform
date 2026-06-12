import { tenantApi } from './client'
import type {
  CompaniesResponse, Company,
  ContactsResponse,
  Interaction,
  CreateCompanyPayload,
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

  getContacts: (params: { company_id?: string; search?: string; page?: number; limit?: number } = {}): Promise<ContactsResponse> => {
    const q = new URLSearchParams()
    if (params.company_id) q.set('company_id', params.company_id)
    if (params.search)     q.set('search', params.search)
    if (params.page)       q.set('page', String(params.page))
    if (params.limit)      q.set('limit', String(params.limit))
    const qs = q.toString()
    return client.get(`/crm/contacts${qs ? `?${qs}` : ''}`)
  },

  logInteraction: (data: LogInteractionPayload): Promise<Interaction> =>
    client.post('/crm/interactions', data),

  deleteCompany: (id: string) =>
    client.delete<{ deleted: boolean; id: string }>(`/crm/companies/${id}`),

  deleteContact: (id: string) =>
    client.delete<{ deleted: boolean; id: string }>(`/crm/contacts/${id}`),
}
