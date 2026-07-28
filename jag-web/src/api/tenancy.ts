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

  /** Approve or reject a viewing request after reviewing its screening answers */
  screeningDecision: (id: string, decision: 'APPROVE' | 'REJECT') =>
    api.post<Row>(`/properties/enquiries/${id}/screening-decision`, { decision }),

  // ── Viewings ─────────────────────────────────────────────
  getViewings: (params?: { status?: string }) =>
    api.get<Row[]>(`/properties/viewings${qs(params)}`),

  patchViewing: (id: string, body: Row) =>
    api.patch<Row>(`/properties/viewings/${id}`, body),

  // ── Applications ──────────────────────────────────────────
  getApplications: (params?: { status?: string; unit_id?: string; tenant_id?: string }) =>
    api.get<Row[]>(`/properties/applications${qs(params)}`),

  getApplication: (id: string) =>
    api.get<Row>(`/properties/applications/${id}`),

  createApplication: (body: Row) =>
    api.post<Row>('/properties/applications', body),

  /** Approve or reject an application. `reason` is only used for REJECTED. */
  decideApplication: (id: string, decision: string, reason?: string) =>
    api.post<Row>(`/properties/applications/${id}/decide`, { decision, rejection_reason: reason }),

  uploadApplicationDoc: (id: string, docType: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    form.append('doc_type', docType)
    return api.postForm<Row>(`/properties/applications/${id}/upload-doc`, form)
  },

  getApplicationDocuments: (id: string) =>
    api.get<{ id: string; doc_type: string; label: string; file_name: string; created_at: string }[]>(`/properties/applications/${id}/documents`),

  downloadApplicationDoc: (id: string, docId: string, fileName: string) =>
    api.download(`/properties/applications/${id}/documents/${docId}/download`, fileName),

  createTenantFromApplication: (id: string, body: { first_name?: string; last_name?: string }) =>
    api.post<{ tenant: Record<string, unknown>; docs_copied: number }>(`/properties/applications/${id}/create-tenant`, body),

  // ── Rent Schedule ─────────────────────────────────────────
  getRentSchedule: (params?: { lease_id?: string; status?: string; unit_id?: string; year?: string; tenant_id?: string }) =>
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
  getDeposits: (params?: { lease_id?: string; status?: string; unit_id?: string; tenant_id?: string }) =>
    api.get<Row[]>(`/properties/deposits${qs(params)}`),

  createDeposit: (body: Row) =>
    api.post<Row>('/properties/deposits', body),

  reconcileDeposit: (id: string, body: Row) =>
    api.patch<Row>(`/properties/deposits/${id}/reconcile`, body),

  // ── Maintenance Tickets ───────────────────────────────────
  getMaintenanceTickets: (params?: { status?: string; priority?: string; unit_id?: string; tenant_id?: string }) =>
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

  // ── Scheduled (Preventive) Maintenance ────────────────────
  getScheduledMaintenance: (params?: { property_id?: string; unit_id?: string; status?: string }) =>
    api.get<Row[]>(`/properties/scheduled-maintenance${qs(params)}`),

  getScheduledMaintenanceTask: (id: string) =>
    api.get<Row>(`/properties/scheduled-maintenance/${id}`),

  createScheduledMaintenance: (body: Row) =>
    api.post<Row>('/properties/scheduled-maintenance', body),

  patchScheduledMaintenance: (id: string, body: Row) =>
    api.patch<Row>(`/properties/scheduled-maintenance/${id}`, body),

  deleteScheduledMaintenance: (id: string) =>
    api.delete<{ id: string }>(`/properties/scheduled-maintenance/${id}`),

  completeScheduledMaintenance: (id: string, body: { completed_date: string; actual_cost_ttd?: number; completed_by?: string; notes?: string }) =>
    api.post<Row>(`/properties/scheduled-maintenance/${id}/complete`, body),

  getScheduledMaintenanceOccurrences: (params: { from: string; to: string; property_id?: string }) =>
    api.get<Row[]>(`/properties/scheduled-maintenance/occurrences${qs(params)}`),

  // ── Rent ↔ Bank Reconciliation (Phase 1, link-only) ──────
  getReconciliationCandidates: () =>
    api.get<{
      bank_credits: Row[]
      rent_periods: Row[]
      suggestions: { bank_txn_id: string; rent_schedule_id: string; unambiguous: boolean }[]
    }>('/properties/rent-reconciliation/candidates'),

  getReconciliationMatches: () =>
    api.get<Row[]>('/properties/rent-reconciliation/matches'),

  matchRentBank: (rentScheduleId: string, bankTxnId: string) =>
    api.post<Row>('/properties/rent-reconciliation/match', { rent_schedule_id: rentScheduleId, bank_txn_id: bankTxnId }),

  autoMatchRentBank: () =>
    api.post<{ matched: number; ambiguous: number; failed: number }>('/properties/rent-reconciliation/auto-match', {}),

  unmatchRentBank: (id: string) =>
    api.delete<{ id: string }>(`/properties/rent-reconciliation/matches/${id}`),

  // ── Handover Checklists ───────────────────────────────────
  getHandoverByUnit: (unitId: string) =>
    api.get<Row[]>(`/properties/handover/unit/${unitId}`),

  getHandoverForTenant: (tenantId: string) =>
    api.get<Row[]>(`/properties/handover${qs({ tenant_id: tenantId })}`),

  createHandover: (body: Row) =>
    api.post<Row>('/properties/handover', body),

  patchHandover: (id: string, body: Row) =>
    api.patch<Row>(`/properties/handover/${id}`, body),

  compareHandover: (exitId: string) =>
    api.get<Row>(`/properties/handover/${exitId}/compare`),

  sendHandoverForSigning: (id: string) =>
    api.post<{ submissionId: string; landlordSigningUrl?: string; tenantSigningUrl?: string }>(
      `/properties/handover/${id}/send-for-signing`, {}
    ),

  downloadHandoverSignedPdf: (id: string) =>
    api.download(`/properties/handover/${id}/signed-pdf`, `handover-signed-${id}.pdf`),

  // ── Renewal Notices ───────────────────────────────────────
  getRenewals: (params?: { status?: string; tenant_id?: string }) =>
    api.get<Row[]>(`/properties/renewals${qs(params)}`),

  patchRenewal: (id: string, body: Row) =>
    api.patch<Row>(`/properties/renewals/${id}`, body),

  processRenewal: (id: string, body: { new_rent_ttd: number; new_start_date: string; new_end_date?: string }) =>
    api.post<Row>(`/properties/renewals/${id}/renew`, body),

  processVacate: (id: string, body: { vacating_date: string; exit_inspection_scheduled_at?: string }) =>
    api.post<void>(`/properties/renewals/${id}/vacate`, body),

  // ── WhatsApp (legacy send route) ─────────────────────────
  getConversations: () =>
    api.get<Row[]>('/properties/whatsapp/conversations'),

  getThread: (phone: string) =>
    api.get<Row[]>(`/properties/whatsapp/conversations/${encodeURIComponent(phone)}`),

  sendWaText: (body: { to: string; body: string; enquiry_id?: string; ticket_id?: string }) =>
    api.post<void>('/properties/whatsapp/send-text', body),

  sendWaTemplate: (body: { to: string; template_name: string; language_code?: string; components?: unknown[] }) =>
    api.post<void>('/properties/whatsapp/send-template', body),

  // ── WA Inbox (unified view) ───────────────────────────────
  getWaInbox: () =>
    api.get<Row[]>('/properties/wa-inbox'),

  getWaThread: (phone: string) =>
    api.get<{ phone: string; messages: Row[]; log: Row[]; enquiries: Row[] }>(`/properties/wa-inbox/${encodeURIComponent(phone)}`),

  sendWaInboxReply: (phone: string, body: string) =>
    api.post<void>(`/properties/wa-inbox/${encodeURIComponent(phone)}/reply`, { body }),

  logContact: (phone: string, body: { log_type: string; body: string; duration_mins?: number; enquiry_id?: string | null; ticket_id?: string | null }) =>
    api.post<Row>(`/properties/wa-inbox/${encodeURIComponent(phone)}/log`, body),

  // ── WA Pending Approvals ──────────────────────────────────
  getWaApprovals: (status?: string) =>
    api.get<Row[]>(`/properties/wa-approvals${qs({ status })}`),

  sendWaApproval: (id: string) =>
    api.post<Row>(`/properties/wa-approvals/${id}/send`, {}),

  dismissWaApproval: (id: string) =>
    api.post<void>(`/properties/wa-approvals/${id}/dismiss`, {}),
}
