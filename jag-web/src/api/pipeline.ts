import { tenantApi } from './client'
import type { PipelineOpportunity, IntelligenceResult, ReasonCategory, PackageVariance } from '../types/pipeline'

// Pipeline uses jag_commercial with CRM tenant (JAG_HOLDINGS)
const CRM_TENANT = '00000000-0000-0000-0001-000000000001'
const client = tenantApi(CRM_TENANT)

function qs(params?: Record<string, string | number | undefined>): string {
  if (!params) return ''
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  )
  const s = new URLSearchParams(filtered).toString()
  return s ? `?${s}` : ''
}

export const pipelineApi = {
  list: (params?: { stage?: string; pipeline_type?: string; page?: number; limit?: number }) =>
    client.get<{ opportunities: PipelineOpportunity[]; pagination: { total: number; page: number; limit: number; pages: number } }>(
      `/crm/pipeline${qs(params)}`
    ),

  get: (id: string) => client.get<PipelineOpportunity>(`/crm/pipeline/${id}`),

  create: (body: {
    title: string
    company_id?: string
    contact_id?: string
    estimated_value?: number
    bid_deadline?: string
    source_url?: string
    assigned_to?: string
    notes?: string
    pipeline_type?: 'JABCO_TENDER' | 'DRAGONBRIDGE_DEAL'
    idempotency_key: string
  }) => client.post<PipelineOpportunity>('/crm/pipeline', body),

  patch: (id: string, body: {
    title?: string
    estimated_value?: number
    bid_deadline?: string | null
    source_url?: string | null
    notes?: string | null
    assigned_to?: string | null
  }) => client.patch<PipelineOpportunity>(`/crm/pipeline/${id}`, body),

  goNoGo: (id: string, body: {
    decision: 'GO' | 'NO_GO'
    reason_category?: ReasonCategory
    reason_text?: string
    project_code?: string
    client_type?: 'GOVERNMENT' | 'PRIVATE'
    contract_currency?: string
    idempotency_key: string
  }) => client.post<{ pipeline: PipelineOpportunity; project?: unknown; bid_log_entry?: unknown }>(`/crm/pipeline/${id}/go-no-go`, body),

  submit: (id: string, body: {
    proposal_document_url: string
    submitted_at?: string
  }) => client.post<PipelineOpportunity>(`/crm/pipeline/${id}/submit`, body),

  decide: (id: string, body: {
    decision: 'WON' | 'LOST'
    competitor_name?: string
    winning_total_price?: number
    our_total_price?: number
    technical_score?: number
    financial_score?: number
    package_variances?: PackageVariance[]
    idempotency_key: string
  }) => client.post<{ pipeline: PipelineOpportunity; created: boolean }>(`/crm/pipeline/${id}/decide`, body),

  intelligence: (client_company_id: string, work_package_tags?: string) =>
    client.get<IntelligenceResult>(
      `/crm/pipeline/intelligence${qs({ client_company_id, work_package_tags })}`
    ),
}
