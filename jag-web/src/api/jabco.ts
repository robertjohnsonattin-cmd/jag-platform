import { tenantApi } from './client'
import type {
  Project, BoqItem, VariationOrder, ProgressClaim, PaymentCertificate, VendorInvoice, SiteDiaryEntry,
} from '../types/jabco'

const api = tenantApi('00000000-0000-0000-0001-000000000002')

function qs(params?: Record<string, string | number | undefined>): string {
  if (!params) return ''
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  )
  const s = new URLSearchParams(filtered).toString()
  return s ? `?${s}` : ''
}

export const jabcoApi = {
  getProjects: (params?: { status?: string; page?: number; limit?: number }) =>
    api.get<{ projects: Project[]; pagination: { total: number; page: number; limit: number } }>(
      `/jabco/projects${qs(params)}`
    ),

  getProject: (id: string) => api.get<Project>(`/jabco/projects/${id}`),

  getBoq: (projectId: string) => api.get<BoqItem[]>(`/jabco/projects/${projectId}/boq`),

  getVariationOrders: (projectId: string) =>
    api.get<{ variation_orders: VariationOrder[]; progress_claims: ProgressClaim[] }>(
      `/jabco/projects/${projectId}`
    ),

  approveVO: (projectId: string, voId: string, action: 'APPROVED' | 'REJECTED' | 'WITHDRAWN', approved_date?: string) =>
    api.patch<VariationOrder>(`/jabco/projects/${projectId}/variation-orders/${voId}`, { action, approved_date }),

  getProgressClaims: (projectId: string) =>
    api.get<{ variation_orders: VariationOrder[]; progress_claims: ProgressClaim[] }>(
      `/jabco/projects/${projectId}`
    ),

  getPaymentCerts: (projectId: string) =>
    api.get<{ payment_certificates: PaymentCertificate[] }>(
      `/jabco/projects/${projectId}/payment-certificates`
    ),

  getSiteDiary: (projectId: string, params?: { from_date?: string; to_date?: string; page?: number }) =>
    api.get<{ entries: SiteDiaryEntry[]; pagination: { total: number; page: number; limit: number } }>(
      `/jabco/projects/${projectId}/site-diary${qs(params)}`
    ),

  createSiteDiaryEntry: (projectId: string, body: {
    entry_date: string
    weather?: string
    workers_on_site?: number
    activities_completed?: string
    materials_received?: string
    equipment_on_site?: string
    instructions_received?: string
    issues_noted?: string
    idempotency_key: string
  }) => api.post<SiteDiaryEntry>(`/jabco/projects/${projectId}/site-diary`, body),

  // ── Write actions ──────────────────────────────────────────────────────────

  createProject: (body: {
    project_code: string
    name: string
    client_name: string
    client_type: 'GOVERNMENT' | 'PRIVATE'
    client_company_id?: string
    contract_value: number
    contract_currency?: string
    vat_inclusive?: boolean
    vat_pct?: number
    start_date?: string
    expected_end_date?: string
    site_address?: string
    project_manager_id: string
    idempotency_key: string
  }) => api.post<Project>('/jabco/projects', body),

  patchProject: (id: string, body: {
    client_company_id?: string | null
    status?: string
    name?: string
    expected_end_date?: string | null
    actual_end_date?: string | null
    site_address?: string | null
    handover_document_url?: string | null
  }) => api.patch<Project>(`/jabco/projects/${id}`, body),

  createBoqItem: (projectId: string, body: {
    section: string
    item_number?: string
    description: string
    unit: string
    quantity_budgeted: number
    unit_rate: number
  }) => api.post<BoqItem>(`/jabco/projects/${projectId}/boq`, body),

  createVO: (projectId: string, body: {
    vo_number: string
    description: string
    amount: number
    currency?: string
    submitted_date?: string
    idempotency_key: string
  }) => api.post<VariationOrder>(`/jabco/projects/${projectId}/variation-orders`, body),

  createProgressClaim: (projectId: string, body: {
    claim_number: number
    period_from: string
    period_to: string
    amount_claimed: number
    idempotency_key: string
  }) => api.post<ProgressClaim>(`/jabco/projects/${projectId}/progress-claims`, body),

  createPaymentCert: (projectId: string, body: {
    progress_claim_id: string
    certificate_number: string
    amount_certified: number
    issued_date: string
    due_date?: string
    idempotency_key: string
  }) => api.post<PaymentCertificate>(`/jabco/projects/${projectId}/payment-certificates`, body),

  markCertPaid: (projectId: string, certId: string, body: {
    paid_date: string
    payment_reference?: string
  }) => api.patch<PaymentCertificate>(`/jabco/projects/${projectId}/payment-certificates/${certId}/pay`, body),

  getVendorInvoices: (projectId: string, params?: { status?: string; vendor_type?: string; page?: number }) =>
    api.get<{ vendor_invoices: VendorInvoice[]; pagination: { total: number; page: number; limit: number } }>(
      `/jabco/projects/${projectId}/vendor-invoices${qs(params)}`
    ),

  createVendorInvoice: (projectId: string, body: {
    vendor_name: string
    vendor_type?: 'SUPPLIER' | 'SUBCONTRACTOR'
    invoice_ref?: string
    invoice_date: string
    due_date?: string
    amount: number
    vat_amount?: number
    vat_code?: string
    notes?: string
    idempotency_key: string
  }) => api.post<VendorInvoice>(`/jabco/projects/${projectId}/vendor-invoices`, body),

  approveVendorInvoice: (projectId: string, id: string) =>
    api.patch<VendorInvoice>(`/jabco/projects/${projectId}/vendor-invoices/${id}/approve`, {}),

  payVendorInvoice: (projectId: string, id: string, body: {
    paid_date: string
    payment_reference?: string
  }) => api.patch<VendorInvoice>(`/jabco/projects/${projectId}/vendor-invoices/${id}/pay`, body),

  deleteProject: (id: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/jabco/projects/${id}`),

  // ── Project Tasks ──────────────────────────────────────────────────────────

  getTasks: (projectId: string, params?: { task_type?: string }) =>
    api.get<{ tasks: import('../types/jabco').ProjectTask[] }>(
      `/jabco/projects/${projectId}/tasks${qs(params)}`
    ),

  createTask: (projectId: string, body: {
    task_type?: 'MOBILIZATION' | 'POST_MORTEM' | 'GENERAL'
    title: string
    description?: string
    assigned_to?: string
    due_date?: string
  }) => api.post<import('../types/jabco').ProjectTask>(`/jabco/projects/${projectId}/tasks`, body),

  patchTask: (projectId: string, taskId: string, body: {
    status?: 'OPEN' | 'IN_PROGRESS' | 'DONE'
    due_date?: string | null
    assigned_to?: string | null
    title?: string
  }) => api.patch<import('../types/jabco').ProjectTask>(`/jabco/projects/${projectId}/tasks/${taskId}`, body),

  // ── Punch List ─────────────────────────────────────────────────────────────

  getPunchList: (projectId: string, params?: { status?: string }) =>
    api.get<{ items: import('../types/jabco').PunchListItem[] }>(
      `/jabco/projects/${projectId}/punch-list${qs(params)}`
    ),

  createPunchItem: (projectId: string, body: {
    description: string
    location?: string
    trade?: string
    photo_url?: string
  }) => api.post<import('../types/jabco').PunchListItem>(`/jabco/projects/${projectId}/punch-list`, body),

  patchPunchItem: (projectId: string, itemId: string, body: {
    status: 'RECTIFIED' | 'VERIFIED'
    rectified_date?: string
    verified_by?: string
    verified_date?: string
  }) => api.patch<import('../types/jabco').PunchListItem>(`/jabco/projects/${projectId}/punch-list/${itemId}`, body),

  // ── Site Incidents ─────────────────────────────────────────────────────────

  getIncidents: (projectId: string) =>
    api.get<{ incidents: import('../types/jabco').SiteIncident[] }>(
      `/jabco/projects/${projectId}/incidents`
    ),

  createIncident: (projectId: string, body: {
    incident_date: string
    incident_type: 'NEAR_MISS' | 'MINOR_INJURY' | 'MAJOR_INJURY' | 'PROPERTY_DAMAGE' | 'ENVIRONMENTAL' | 'OTHER'
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    description: string
    corrective_action?: string
    photos?: string[]
  }) => api.post<import('../types/jabco').SiteIncident>(`/jabco/projects/${projectId}/incidents`, body),

  closeIncident: (projectId: string, incidentId: string, body: {
    status: 'CLOSED'
    closed_date?: string
    corrective_action?: string
  }) => api.patch<import('../types/jabco').SiteIncident>(`/jabco/projects/${projectId}/incidents/${incidentId}`, body),

  // ── Quality Inspections ────────────────────────────────────────────────────

  getQualityInspections: (projectId: string) =>
    api.get<{ inspections: import('../types/jabco').QualityInspection[] }>(
      `/jabco/projects/${projectId}/quality-inspections`
    ),

  createQualityInspection: (projectId: string, body: {
    inspection_date: string
    inspector_name: string
    area_inspected: string
    checklist_result: 'PASS' | 'FAIL' | 'CONDITIONAL'
    defects_noted?: string
    follow_up_required?: boolean
    follow_up_date?: string
    photos?: string[]
  }) => api.post<import('../types/jabco').QualityInspection>(`/jabco/projects/${projectId}/quality-inspections`, body),
}
