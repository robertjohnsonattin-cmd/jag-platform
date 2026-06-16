import { api } from './client'

type Row = Record<string, unknown>

function qs(params?: Record<string, string | number | undefined>): string {
  if (!params) return ''
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  )
  const s = new URLSearchParams(filtered).toString()
  return s ? `?${s}` : ''
}

export const tenancyApi = {
  // ── Enquiries ────────────────────────────────────────────
  getEnquiries: (params?: { unit_id?: string; stage?: string }) =>
    api.get<Row[]>(`/properties/enquiries${qs(params)}`),

  getEnquiry: (id: string) =>
    api.get<Row>(`/properties/enquiries/${id}`),

  createEnquiry: (body: Row) =>
    api.post<Row>('/properties/enquiries', body),

  patchEnquiry: (id: string, body: Row) =>
    api.patch<Row>(`/properties/enquiries/${id}`, body),

  deleteEnquiry: (id: string) =>
    api.delete<void>(`/properties/enquiries/${id}`),

  /** Send a freeform WhatsApp reply on an enquiry thread */
  sendEnquiryReply: (id: string, body: string) =>
    api.post<void>(`/properties/enquiries/${id}/send-reply`, { body }),

  sendWaReply: (id: string, body: string) =>
    api.post<void>(`/properties/enquiries/${id}/send-reply`, { body }),

  sendAppLink: (id: string) =>
    api.post<void>(`/properties/enquiries/${id}/send-app-link`, {}),

  // ── Viewings ─────────────────────────────────────────────
  getViewings: (params?: { status?: string }) =>
    api.get<Row[]>(`/properties/viewings${qs(params)}`),

  patchViewing: (id: string, body: Row) =>
    api.patch<Row>(`/properties/viewings/${id}`, body),

  // ── Applications ──────────────────────────────────────────
  getApplications: (params?: { status?: string }) =>
    api.get<Row[]>(`/properties/applications${qs(params)}`),

  getApplication: (id: string) =>
    api.get<Row>(`/properties/applications/${id}`),

  createApplication: (body: Row) =>
    api.post<Row>('/properties/applications', body),

  /** Approve or reject an application. `reason` is only used for REJECTED. */
  decideApplication: (id: string, decision: string, reason?: string) =>
    api.post<Row>(`/properties/applications/${id}/decide`, { decision, rejection_reason: reason }),

  uploadApplicationDoc: (id: string, body: { file_type: string; content_type: string }) =>
    api.post<{ upload_url: string; object_key: string }>(`/properties/applications/${id}/upload-doc`, body),

  // ── Rent Schedule ─────────────────────────────────────────
  getRentSchedule: (params?: { lease_id?: string; status?: string }) =>
    api.get<Row[]>(`/properties/rent-schedule${qs(params)}`),

  getRentPeriod: (id: string) =>
    api.get<Row>(`/properties/rent-schedule/${id}`),

  generateRentSchedule: (leaseId: string) =>
    api.post<Row[]>('/properties/rent-schedule/generate', { lease_id: leaseId }),

  recordRentPayment: (id: string, body: Row) =>
    api.post<Row>(`/properties/rent-schedule/${id}/record-payment`, body),

  /** Alias used by PropertiesRentSchedulePanel */
  recordPayment: (id: string, body: Row) =>
    api.post<Row>(`/properties/rent-schedule/${id}/record-payment`, body),

  waiveRentPeriod: (id: string, body: { waive_reason: string }) =>
    api.post<void>(`/properties/rent-schedule/${id}/waive`, body),

  // ── Deposits ──────────────────────────────────────────────
  getDeposits: (params?: { lease_id?: string; status?: string }) =>
    api.get<Row[]>(`/properties/deposits${qs(params)}`),

  createDeposit: (body: Row) =>
    api.post<Row>('/properties/deposits', body),

  reconcileDeposit: (id: string, body: Row) =>
    api.patch<Row>(`/properties/deposits/${id}/reconcile`, body),

  // ── Maintenance Tickets ───────────────────────────────────
  getMaintenanceTickets: (params?: { status?: string; priority?: string; unit_id?: string }) =>
    api.get<Row[]>(`/properties/maintenance${qs(params)}`),

  getMaintenanceTicket: (id: string) =>
    api.get<Row>(`/properties/maintenance/${id}`),

  createMaintenanceTicket: (body: Row) =>
    api.post<Row>('/properties/maintenance', body),

  patchMaintenanceTicket: (id: string, body: Row) =>
    api.patch<Row>(`/properties/maintenance/${id}`, body),

  resolveTicket: (id: string, body: { resolution_notes: string; cost_ttd?: number }) =>
    api.post<Row>(`/properties/maintenance/${id}/resolve`, body),

  recordSatisfaction: (id: string, body: { satisfaction_score: number }) =>
    api.post<void>(`/properties/maintenance/${id}/satisfaction`, body),

  // ── Contractors ───────────────────────────────────────────
  getContractors: () =>
    api.get<Row[]>('/properties/contractors'),

  createContractor: (body: Row) =>
    api.post<Row>('/properties/contractors', body),

  patchContractor: (id: string, body: Row) =>
    api.patch<Row>(`/properties/contractors/${id}`, body),

  // ── Handover Checklists ───────────────────────────────────
  getHandoverByUnit: (unitId: string) =>
    api.get<Row[]>(`/properties/handover/unit/${unitId}`),

  createHandover: (body: Row) =>
    api.post<Row>('/properties/handover', body),

  patchHandover: (id: string, body: Row) =>
    api.patch<Row>(`/properties/handover/${id}`, body),

  compareHandover: (exitId: string) =>
    api.get<Row>(`/properties/handover/${exitId}/compare`),

  // ── Renewal Notices ───────────────────────────────────────
  getRenewals: (params?: { status?: string }) =>
    api.get<Row[]>(`/properties/renewals${qs(params)}`),

  patchRenewal: (id: string, body: Row) =>
    api.patch<Row>(`/properties/renewals/${id}`, body),

  processRenewal: (id: string, body: { new_rent_ttd: number; new_start_date: string; new_end_date?: string }) =>
    api.post<Row>(`/properties/renewals/${id}/renew`, body),

  processVacate: (id: string, body: { vacating_date: string; exit_inspection_scheduled_at?: string }) =>
    api.post<void>(`/properties/renewals/${id}/vacate`, body),

  // ── WhatsApp ──────────────────────────────────────────────
  getConversations: () =>
    api.get<Row[]>('/properties/whatsapp/conversations'),

  getThread: (phone: string) =>
    api.get<Row[]>(`/properties/whatsapp/conversations/${encodeURIComponent(phone)}`),

  sendWaText: (body: { to: string; body: string; enquiry_id?: string; ticket_id?: string }) =>
    api.post<void>('/properties/whatsapp/send-text', body),

  sendWaTemplate: (body: { to: string; template_name: string; language_code?: string; components?: unknown[] }) =>
    api.post<void>('/properties/whatsapp/send-template', body),
}
