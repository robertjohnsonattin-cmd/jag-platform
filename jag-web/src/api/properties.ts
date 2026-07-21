import { api } from './client'
import type {
  Property, PropertyTenant, PipelineItem,
  RentPayment, RentReceipt, UtilityBill, VendorInvoice, Lease, Mortgage,
  PropertyTaxRecord, Inspection, ArrearsRecord, LeaseExpiryRecord,
  FinancialSummary, PropertyDocument, UtilityAccount, Unit, UnitPhoto, PropertyValuationHistory,
  TenantDocument, TenantDocType,
} from '../types/properties'

function qs(params?: Record<string, string | number | undefined>): string {
  if (!params) return ''
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  )
  const s = new URLSearchParams(filtered).toString()
  return s ? `?${s}` : ''
}

export const propertiesApi = {
  getProperties: (params?: { is_rented?: 'true' | 'false'; page?: number; limit?: number }) =>
    api.get<{ properties: Property[]; pagination: { page: number; limit: number; total: number; pages: number } }>(
      `/properties${qs(params)}`
    ).then(r => r.properties),

  getProperty: (id: string) =>
    api.get<Property>(`/properties/${id}`),

  getLeases: (propertyId: string) =>
    api.get<Lease[]>(`/properties/${propertyId}/leases`),

  getLeasesForTenant: (tenantId: string) =>
    api.get<Lease[]>(`/properties/leases${qs({ tenant_id: tenantId })}`),

  downloadLeaseAgreement: (propertyId: string, leaseId: string) =>
    api.download(`/properties/${propertyId}/leases/${leaseId}/agreement-pdf`, `lease-agreement-${leaseId}.pdf`),

  uploadSignedLease: (propertyId: string, leaseId: string, file: File) => {
    const fd = new FormData(); fd.append('file', file)
    return api.postForm<{ signed_pdf_object_key: string; signature_status: string }>(
      `/properties/${propertyId}/leases/${leaseId}/upload-signed`, fd)
  },

  downloadSignedLease: (propertyId: string, leaseId: string) =>
    api.download(`/properties/${propertyId}/leases/${leaseId}/signed-pdf`, `lease-signed-${leaseId}.pdf`),

  sendLeaseForSigning: (propertyId: string, leaseId: string) =>
    api.post<{ submissionId: string; landlordSigningUrl?: string; tenantSigningUrl?: string }>(
      `/properties/${propertyId}/leases/${leaseId}/send-for-signing`, {}
    ),

  getRentPayments: (propertyId: string, params?: { page?: number; limit?: number }) =>
    api.get<{ payments: RentPayment[]; pagination: { page: number; limit: number; total: number; pages: number } }>(
      `/properties/${propertyId}/rent-payments${qs(params)}`
    ).then(r => r.payments),

  getMortgages: (propertyId: string) =>
    api.get<Mortgage[]>(`/properties/${propertyId}/mortgage`),

  getUtilities: (propertyId: string, params?: { page?: number; limit?: number }) =>
    api.get<{ utility_bills: UtilityBill[]; pagination: { page: number; limit: number; total: number; pages: number } }>(
      `/properties/${propertyId}/utilities${qs(params)}`
    ).then(r => r.utility_bills),

  getVendorInvoices: (propertyId: string, params?: { status?: string; page?: number; limit?: number }) =>
    api.get<{ vendor_invoices: VendorInvoice[]; pagination: { page: number; limit: number; total: number; pages: number } }>(
      `/properties/${propertyId}/vendor-invoices${qs(params)}`
    ).then(r => r.vendor_invoices),

  approveInvoice: (propertyId: string, id: string) =>
    api.patch<VendorInvoice>(`/properties/${propertyId}/vendor-invoices/${id}/approve`, {}),

  payInvoice: (propertyId: string, id: string, body: { paid_date: string; payment_reference?: string }) =>
    api.patch<VendorInvoice>(`/properties/${propertyId}/vendor-invoices/${id}/pay`, body),

  createProperty: (body: Record<string, unknown>) =>
    api.post<Property>('/properties', body),

  updateProperty: (id: string, body: {
    name?: string
    address_line1?: string
    address_line2?: string
    city?: string
    country?: string
    current_valuation?: number
    valuation_date?: string
    notes?: string
  }) => api.patch<Property>(`/properties/${id}`, body),

  getValuationHistory: (id: string) =>
    api.get<PropertyValuationHistory[]>(`/properties/${id}/valuation-history`),

  addValuationHistory: (id: string, body: { as_of_date: string; valuation_ttd: number; notes?: string }) =>
    api.post<PropertyValuationHistory>(`/properties/${id}/valuation-history`, body),

  createLease: (propertyId: string, body: Record<string, unknown>) =>
    api.post<Lease>(`/properties/${propertyId}/leases`, body),

  createRentPayment: (propertyId: string, body: Record<string, unknown>) =>
    api.post<RentPayment>(`/properties/${propertyId}/rent-payments`, body),

  createMortgage: (propertyId: string, body: Record<string, unknown>) =>
    api.post<Mortgage>(`/properties/${propertyId}/mortgage`, body),

  createUtility: (propertyId: string, body: Record<string, unknown>) =>
    api.post<UtilityBill>(`/properties/${propertyId}/utilities`, body),

  createVendorInvoice: (propertyId: string, body: Record<string, unknown>) =>
    api.post<VendorInvoice>(`/properties/${propertyId}/vendor-invoices`, body),

  getTenants: (search?: string) =>
    api.get<PropertyTenant[]>(`/properties/tenants${search ? `?search=${encodeURIComponent(search)}` : ''}`),

  createTenant: (body: Record<string, unknown>) =>
    api.post<PropertyTenant>('/properties/tenants', body),

  updateTenant: (id: string, body: Record<string, unknown>) =>
    api.patch<PropertyTenant>(`/properties/tenants/${id}`, body),

  getTenantDocuments: (tenantId: string) =>
    api.get<TenantDocument[]>(`/properties/tenants/${tenantId}/documents`),

  uploadTenantDocument: (tenantId: string, docType: TenantDocType, file: File, notes?: string, expiryDate?: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('doc_type', docType)
    if (notes) form.append('notes', notes)
    if (expiryDate) form.append('expiry_date', expiryDate)
    return api.postForm<TenantDocument>(`/properties/tenants/${tenantId}/documents`, form)
  },

  downloadTenantDocument: (tenantId: string, docId: string, fileName: string) =>
    api.download(`/properties/tenants/${tenantId}/documents/${docId}/download`, fileName),

  updateTenantDocumentExpiry: (tenantId: string, docId: string, expiryDate: string | null) =>
    api.patch<TenantDocument>(`/properties/tenants/${tenantId}/documents/${docId}`, { expiry_date: expiryDate }),

  deleteTenantDocument: (tenantId: string, docId: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/properties/tenants/${tenantId}/documents/${docId}`),

  getPipeline: (params?: { stage?: string; page?: number; limit?: number }) =>
    api.get<{ pipeline: PipelineItem[]; pagination: { page: number; limit: number; total: number; pages: number } }>(
      `/properties/pipeline${qs(params)}`
    ).then(r => r.pipeline),

  updatePipelineStage: (id: string, stage: string) =>
    api.patch<PipelineItem>(`/properties/pipeline/${id}`, { stage }),

  createPipelineItem: (body: Record<string, unknown>) =>
    api.post<PipelineItem>('/properties/pipeline', body),

  deletePipelineItem: (id: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/properties/pipeline/${id}`),

  // ── Property Tax ─────────────────────────────────────────────────────────────
  getTax: (propertyId: string) =>
    api.get<PropertyTaxRecord[]>(`/properties/${propertyId}/tax`),

  createTax: (propertyId: string, body: Record<string, unknown>) =>
    api.post<PropertyTaxRecord>(`/properties/${propertyId}/tax`, body),

  updateTax: (propertyId: string, id: string, body: Record<string, unknown>) =>
    api.patch<PropertyTaxRecord>(`/properties/${propertyId}/tax/${id}`, body),

  payTax: (propertyId: string, id: string, body: { paid_date: string; payment_reference?: string }) =>
    api.patch<PropertyTaxRecord>(`/properties/${propertyId}/tax/${id}/pay`, body),

  // ── Inspections ──────────────────────────────────────────────────────────────
  getInspections: (propertyId: string) =>
    api.get<Inspection[]>(`/properties/${propertyId}/inspections`),

  createInspection: (propertyId: string, body: Record<string, unknown>) =>
    api.post<Inspection>(`/properties/${propertyId}/inspections`, body),

  updateInspection: (propertyId: string, id: string, body: Record<string, unknown>) =>
    api.patch<Inspection>(`/properties/${propertyId}/inspections/${id}`, body),

  // ── Portfolio views ──────────────────────────────────────────────────────────
  getArrears: () =>
    api.get<ArrearsRecord[]>('/properties/arrears'),

  getLeaseExpiry: () =>
    api.get<LeaseExpiryRecord[]>('/properties/lease-expiry'),

  // ── Financial Summary ────────────────────────────────────────────────────────
  getFinancialSummary: (propertyId: string) =>
    api.get<FinancialSummary>(`/properties/${propertyId}/financial-summary`),

  // ── Deposit Refund ───────────────────────────────────────────────────────────
  refundDeposit: (propertyId: string, leaseId: string, body: {
    refunded_amount: number
    deductions: number
    refund_date: string
    notes?: string
    idempotency_key: string
  }) => api.patch<Lease>(`/properties/${propertyId}/leases/${leaseId}/refund-deposit`, body),

  // ── Documents ────────────────────────────────────────────────────────────────
  getDocuments: (propertyId: string) =>
    api.get<PropertyDocument[]>(`/properties/${propertyId}/documents`),

  createDocument: (propertyId: string, body: Record<string, unknown>) =>
    api.post<PropertyDocument>(`/properties/${propertyId}/documents`, body),

  deleteDocument: (propertyId: string, id: string) =>
    api.delete<{ id: string }>(`/properties/${propertyId}/documents/${id}`),

  // ── Utility Accounts ─────────────────────────────────────────────────────────
  getUtilityAccounts: (propertyId: string) =>
    api.get<UtilityAccount[]>(`/properties/${propertyId}/utility-accounts`),

  createUtilityAccount: (propertyId: string, body: Record<string, unknown>) =>
    api.post<UtilityAccount>(`/properties/${propertyId}/utility-accounts`, body),

  updateUtilityAccount: (propertyId: string, id: string, body: Record<string, unknown>) =>
    api.patch<UtilityAccount>(`/properties/${propertyId}/utility-accounts/${id}`, body),

  deleteUtilityAccount: (propertyId: string, id: string) =>
    api.delete<{ id: string }>(`/properties/${propertyId}/utility-accounts/${id}`),

  // ── Units ────────────────────────────────────────────────────────────────────
  getUnits: (propertyId: string) =>
    api.get<Unit[]>(`/properties/${propertyId}/units`),

  createUnit: (propertyId: string, body: Record<string, unknown>) =>
    api.post<Unit>(`/properties/${propertyId}/units`, body),

  patchUnit: (propertyId: string, id: string, body: Record<string, unknown>) =>
    api.patch<Unit>(`/properties/${propertyId}/units/${id}`, body),

  // ── Unit listing actions (mounted at /properties/units/:id/) ─────────────────
  listUnit:   (unitId: string) => api.post<Unit>(`/properties/units/${unitId}/list`, {}),
  unlistUnit: (unitId: string) => api.post<Unit>(`/properties/units/${unitId}/unlist`, {}),
  suggestUnitPrice: (unitId: string) => api.post<{ min: number; max: number; recommended: number }>(`/properties/units/${unitId}/suggest-price`, {}),
  updateListingInfo: (unitId: string, body: { listing_description?: string | null; wasa_included?: boolean; electricity_included?: boolean; internet_included?: boolean; rent_amount?: number }) =>
    api.patch<Unit>(`/properties/units/${unitId}/listing-info`, body),

  // ── Unit photos ──────────────────────────────────────────────────────────────
  getUnitPhotos: (unitId: string) => api.get<UnitPhoto[]>(`/properties/units/${unitId}/photos`),
  getPhotoUploadUrl: (unitId: string, filename: string) =>
    api.post<{ upload_url: string; object_key: string }>(`/properties/units/${unitId}/photos/upload-url`, { filename }),
  confirmUnitPhoto: (unitId: string, body: { object_key: string; caption?: string; display_order?: number }) =>
    api.post<UnitPhoto>(`/properties/units/${unitId}/photos`, body),
  deleteUnitPhoto: (unitId: string, photoId: string) =>
    api.delete<{ deleted: boolean }>(`/properties/units/${unitId}/photos/${photoId}`),
  updateUnitPhoto: (unitId: string, photoId: string, body: { display_order?: number; caption?: string | null }) =>
    api.patch<UnitPhoto>(`/properties/units/${unitId}/photos/${photoId}`, body),

  // ── Late Fee ─────────────────────────────────────────────────────────────────
  chargeLateFee: (propertyId: string, paymentId: string, amount: number) =>
    api.patch<RentPayment>(`/properties/${propertyId}/rent-payments/${paymentId}/charge-late-fee`, {
      amount,
      idempotency_key: crypto.randomUUID(),
    }),

  // ── Receipt ──────────────────────────────────────────────────────────────────
  getReceipt: (propertyId: string, paymentId: string) =>
    api.get<RentReceipt>(`/properties/${propertyId}/rent-payments/${paymentId}/receipt`),

  // ── Delete ───────────────────────────────────────────────────────────────────
  deleteProperty: (id: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/properties/${id}`),

  deleteTenant: (id: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/properties/tenants/${id}`),

  deleteLease: (propertyId: string, leaseId: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/properties/${propertyId}/leases/${leaseId}`),
}
