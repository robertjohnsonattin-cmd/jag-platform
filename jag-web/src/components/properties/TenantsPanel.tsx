import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { propertiesApi } from '../../api/properties'
import { tenancyApi } from '../../api/tenancy'
import { api } from '../../api/client'
import type { PropertyTenant, TenantDocument, TenantDocType, Lease } from '../../types/properties'
import { fmtDate } from '../../lib/entities'
import ConfirmDeleteModal from '../ui/ConfirmDeleteModal'

const DEPOSIT_STATUS_COLORS: Record<string, string> = {
  HELD:               'bg-blue-900/50 text-blue-300 border-blue-700',
  PARTIALLY_RETURNED: 'bg-orange-900/50 text-orange-300 border-orange-700',
  RETURNED:           'bg-green-900/50 text-green-300 border-green-700',
  FORFEITED:          'bg-red-900/50 text-red-300 border-red-700',
}

const LEASE_STATUS_COLORS: Record<string, string> = {
  ACTIVE:      'bg-green-900/50 text-green-300 border-green-700',
  PENDING:     'bg-blue-900/50 text-blue-300 border-blue-700',
  EXPIRED:     'bg-slate-700 text-slate-400 border-slate-600',
  TERMINATED:  'bg-red-900/50 text-red-300 border-red-700',
}

const APPLICATION_STATUS_COLORS: Record<string, string> = {
  PENDING:       'bg-slate-700 text-slate-400 border-slate-600',
  UNDER_REVIEW:  'bg-blue-900/50 text-blue-300 border-blue-700',
  APPROVED:      'bg-green-900/50 text-green-300 border-green-700',
  REJECTED:      'bg-red-900/50 text-red-300 border-red-700',
  WITHDRAWN:     'bg-slate-700 text-slate-400 border-slate-600',
}

const TICKET_STATUS_COLORS: Record<string, string> = {
  OPEN:            'bg-red-900/50 text-red-300 border-red-700',
  ASSIGNED:        'bg-orange-900/50 text-orange-300 border-orange-700',
  IN_PROGRESS:     'bg-blue-900/50 text-blue-300 border-blue-700',
  PENDING_PARTS:   'bg-orange-900/50 text-orange-300 border-orange-700',
  RESOLVED:        'bg-green-900/50 text-green-300 border-green-700',
  CLOSED:          'bg-slate-700 text-slate-400 border-slate-600',
  CANCELLED:       'bg-slate-700 text-slate-400 border-slate-600',
}

const RENEWAL_RESPONSE_COLORS: Record<string, string> = {
  RENEWING:    'bg-green-900/50 text-green-300 border-green-700',
  VACATING:    'bg-red-900/50 text-red-300 border-red-700',
  DISCUSSING:  'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  NO_RESPONSE: 'bg-slate-700 text-slate-400 border-slate-600',
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

const ID_TYPES = ['TT_NIC', 'PASSPORT', 'COMPANY_REG', 'DRIVERS_LICENCE', 'OTHER'] as const

const TENANT_DOC_TYPES: TenantDocType[] = [
  'national_id','passport','drivers_licence','employment_letter','payslip',
  'company_reg','bank_statement','utility_bill','reference_letter','tenancy_agreement','other',
]

// ── Add Tenant Modal ──────────────────────────────────────────────────────────

function AddTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    first_name: '', last_name: '', company_name: '', is_company: false,
    phone: '', phone2: '', email: '',
    identification_type: '', identification_number: '',
    emergency_contact_name: '', emergency_contact_phone: '',
    notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))
  const setCheck = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.checked }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.createTenant({
      first_name: form.first_name,
      last_name: form.last_name || undefined,
      company_name: form.company_name || undefined,
      is_company: form.is_company,
      phone: form.phone || undefined,
      phone2: form.phone2 || undefined,
      email: form.email || undefined,
      identification_type: form.identification_type || undefined,
      identification_number: form.identification_number || undefined,
      emergency_contact_name: form.emergency_contact_name || undefined,
      emergency_contact_phone: form.emergency_contact_phone || undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('tenants.addTenant')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.firstName')}</label>
              <input value={form.first_name} onChange={set('first_name')} className={cls} disabled={form.is_company} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.lastName')}</label>
              <input value={form.last_name} onChange={set('last_name')} className={cls} disabled={form.is_company} />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <input type="checkbox" id="is_company" checked={form.is_company} onChange={setCheck('is_company')} className="rounded" />
              <label htmlFor="is_company" className="text-xs text-slate-400">{t('tenants.company')} {form.is_company ? '*' : `(${t('common.optional', 'optional')})`}</label>
            </div>
            <input value={form.company_name} onChange={set('company_name')} className={cls} placeholder="e.g. ABC Holdings Ltd" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.phone')}</label>
              <input value={form.phone} onChange={set('phone')} className={cls} placeholder="+1-868-..." />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.phone2')}</label>
              <input value={form.phone2} onChange={set('phone2')} className={cls} placeholder="+1-868-..." />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.email')}</label>
              <input type="email" value={form.email} onChange={set('email')} className={cls} />
            </div>
            <div className="flex-1" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.idType')}</label>
              <select value={form.identification_type} onChange={set('identification_type')} className={cls}>
                <option value="">— none —</option>
                {ID_TYPES.map(tp => <option key={tp} value={tp}>{t(`tenants.idTypes.${tp}`, tp.replace(/_/g, ' '))}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.idNumber')}</label>
              <input value={form.identification_number} onChange={set('identification_number')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.emergencyContact')}</label>
              <input value={form.emergency_contact_name} onChange={set('emergency_contact_name')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.emergencyPhone')}</label>
              <input value={form.emergency_contact_phone} onChange={set('emergency_contact_phone')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => mutate()}
            disabled={isPending || (!form.is_company && !form.first_name) || (form.is_company && !form.company_name)}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {isPending ? t('common.saving') : t('tenants.addTenant')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Tenant Modal ─────────────────────────────────────────────────────────

function EditTenantModal({ tenant, onClose, onSaved }: { tenant: PropertyTenant; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    first_name: tenant.first_name,
    last_name: tenant.last_name ?? '',
    company_name: tenant.company_name ?? '',
    is_company: tenant.is_company,
    phone: tenant.phone ?? '',
    phone2: tenant.phone2 ?? '',
    email: tenant.email ?? '',
    identification_type: (tenant as unknown as Record<string, string>).identification_type ?? '',
    identification_number: (tenant as unknown as Record<string, string>).identification_number ?? '',
    emergency_contact_name: (tenant as unknown as Record<string, string>).emergency_contact_name ?? '',
    emergency_contact_phone: (tenant as unknown as Record<string, string>).emergency_contact_phone ?? '',
    notes: (tenant as unknown as Record<string, string>).notes ?? '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))
  const setCheck = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.checked }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.updateTenant(tenant.id, {
      first_name: form.first_name || undefined,
      last_name: form.last_name || null,
      company_name: form.company_name || null,
      is_company: form.is_company,
      phone: form.phone || null,
      phone2: form.phone2 || null,
      email: form.email || null,
      identification_type: form.identification_type || null,
      identification_number: form.identification_number || null,
      emergency_contact_name: form.emergency_contact_name || null,
      emergency_contact_phone: form.emergency_contact_phone || null,
      notes: form.notes || null,
    }),
    onSuccess: () => { onSaved(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('tenants.editTenant')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.firstName')}</label>
              <input value={form.first_name} onChange={set('first_name')} className={cls} disabled={form.is_company} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.lastName')}</label>
              <input value={form.last_name} onChange={set('last_name')} className={cls} disabled={form.is_company} />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <input type="checkbox" id="edit_is_company" checked={form.is_company} onChange={setCheck('is_company')} className="rounded" />
              <label htmlFor="edit_is_company" className="text-xs text-slate-400">{t('tenants.company')} {form.is_company ? '*' : `(${t('common.optional', 'optional')})`}</label>
            </div>
            <input value={form.company_name} onChange={set('company_name')} className={cls} placeholder="e.g. ABC Holdings Ltd" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.phone')}</label>
              <input value={form.phone} onChange={set('phone')} className={cls} placeholder="+1-868-..." />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.phone2')}</label>
              <input value={form.phone2} onChange={set('phone2')} className={cls} placeholder="+1-868-..." />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.email')}</label>
              <input type="email" value={form.email} onChange={set('email')} className={cls} />
            </div>
            <div className="flex-1" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.idType')}</label>
              <select value={form.identification_type} onChange={set('identification_type')} className={cls}>
                <option value="">— none —</option>
                {ID_TYPES.map(tp => <option key={tp} value={tp}>{t(`tenants.idTypes.${tp}`, tp.replace(/_/g, ' '))}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.idNumber')}</label>
              <input value={form.identification_number} onChange={set('identification_number')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.emergencyContact')}</label>
              <input value={form.emergency_contact_name} onChange={set('emergency_contact_name')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.emergencyPhone')}</label>
              <input value={form.emergency_contact_phone} onChange={set('emergency_contact_phone')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => mutate()}
            disabled={isPending || (!form.is_company && !form.first_name) || (form.is_company && !form.company_name)}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {isPending ? t('common.saving') : t('tenants.saveChanges')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Tenant Documents Modal ────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  national_id: 'National ID', passport: 'Passport', drivers_licence: "Driver's Licence",
  employment_letter: 'Employment Letter', payslip: 'Payslip', company_reg: 'Company Registration',
  bank_statement: 'Bank Statement', utility_bill: 'Utility Bill', reference_letter: 'Reference Letter',
  tenancy_agreement: 'Tenancy Agreement', other: 'Other',
}

function TenantDocsModal({ tenant, onClose }: { tenant: PropertyTenant; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [docType, setDocType] = useState<TenantDocType>('national_id')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const tenantName = tenant.is_company
    ? (tenant.company_name ?? 'Tenant')
    : `${tenant.first_name}${tenant.last_name ? ` ${tenant.last_name}` : ''}`

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['tenant-docs', tenant.id],
    queryFn: () => propertiesApi.getTenantDocuments(tenant.id),
  })

  const deleteMut = useMutation({
    mutationFn: (docId: string) => propertiesApi.deleteTenantDocument(tenant.id, docId),
    onSuccess: () => {
      setDeletingId(null)
      void qc.invalidateQueries({ queryKey: ['tenant-docs', tenant.id] })
    },
  })

  async function handleUpload(file: File) {
    setUploading(true)
    setUploadError(null)
    try {
      await propertiesApi.uploadTenantDocument(tenant.id, docType, file)
      void qc.invalidateQueries({ queryKey: ['tenant-docs', tenant.id] })
    } catch {
      setUploadError(t('tenants.docs.uploadError', 'Upload failed. Please try again.'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const [downloading, setDownloading] = useState<string | null>(null)
  async function handleDownload(doc: TenantDocument) {
    setDownloading(doc.id)
    try { await propertiesApi.downloadTenantDocument(tenant.id, doc.id, doc.file_name) }
    catch { /* silent — browser will show network error if needed */ }
    finally { setDownloading(null) }
  }

  const sourceTag = (doc: TenantDocument) =>
    doc.source === 'APPLICATION'
      ? <span className="ml-1.5 text-xs bg-blue-900/50 text-blue-300 border border-blue-700 px-1.5 py-0.5 rounded">{t('tenants.docs.fromApp', 'from app')}</span>
      : null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{t('tenants.docs.title', 'Documents')}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{tenantName}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        {/* Upload row */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <select
            value={docType}
            onChange={e => setDocType(e.target.value as TenantDocType)}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {TENANT_DOC_TYPES.map(dt => (
              <option key={dt} value={dt}>{t(`tenants.docs.types.${dt}`, DOC_TYPE_LABELS[dt])}</option>
            ))}
          </select>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleUpload(f) }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {uploading ? t('common.uploading', 'Uploading…') : t('tenants.docs.uploadBtn', '+ Upload')}
          </button>
          {uploadError && <p className="text-red-400 text-xs self-center">{uploadError}</p>}
        </div>

        {/* Doc list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && <p className="text-slate-400 text-sm">{t('common.loading')}</p>}
          {!isLoading && docs.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-8">{t('tenants.docs.none', 'No documents uploaded yet.')}</p>
          )}
          {docs.length > 0 && (
            <div className="space-y-2">
              {docs.map((doc: TenantDocument) => (
                <div key={doc.id} className="flex items-center gap-3 bg-slate-700/50 rounded-lg px-3 py-2.5 border border-slate-700">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-xs font-medium text-slate-300 bg-slate-600 px-1.5 py-0.5 rounded">
                        {t(`tenants.docs.types.${doc.doc_type}`, DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type)}
                      </span>
                      {sourceTag(doc)}
                    </div>
                    <p className="text-sm text-slate-200 mt-1 truncate">{doc.file_name}</p>
                    <p className="text-xs text-slate-500">{fmtDate(doc.created_at)}</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => void handleDownload(doc)}
                      disabled={downloading === doc.id}
                      className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
                    >
                      {downloading === doc.id ? '…' : t('common.download', 'Download')}
                    </button>
                    {deletingId === doc.id ? (
                      <span className="text-xs text-red-400">
                        <button onClick={() => deleteMut.mutate(doc.id)} className="hover:text-red-300">{t('common.yes', 'Yes')}</button>
                        {' / '}
                        <button onClick={() => setDeletingId(null)} className="hover:text-slate-200">{t('common.no', 'No')}</button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setDeletingId(doc.id)}
                        className="text-xs text-slate-600 hover:text-red-400 transition-colors"
                        title={t('tenants.docs.delete', 'Delete document')}
                      >&#x1F5D1;</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-700 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">{t('common.close', 'Close')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Tenant Applications Modal ────────────────────────────────────────────────
// prop_applications had no tenant_id at all until migration 053 -- create-tenant
// only ever read FROM the application, never wrote a link back, so the trail
// from tenant -> originating application dead-ended the moment the tenant
// existed. Same class of gap as deposits (migration 052).

function TenantApplicationsModal({ tenant, onClose }: { tenant: PropertyTenant; onClose: () => void }) {
  const { t } = useTranslation()

  const tenantName = tenant.is_company
    ? (tenant.company_name ?? 'Tenant')
    : `${tenant.first_name}${tenant.last_name ? ` ${tenant.last_name}` : ''}`

  const { data: applications = [], isLoading } = useQuery({
    queryKey: ['tenant-applications', tenant.id],
    queryFn: () => tenancyApi.getApplications({ tenant_id: tenant.id }),
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{t('tenants.applications.title', 'Applications')}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{tenantName}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3">
          {isLoading && <p className="text-slate-400 text-sm">{t('common.loading')}</p>}
          {!isLoading && applications.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-8">{t('tenants.applications.none', 'No application on file for this tenant.')}</p>
          )}
          {applications.map((a: Record<string, unknown>) => (
            <div key={String(a['id'])} className="bg-slate-700/50 rounded-lg border border-slate-700 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-200">{String(a['property_name'] ?? '—')}{a['unit_number'] ? ` · Unit ${String(a['unit_number'])}` : ''}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {t('tenants.applications.submitted', 'Submitted')} {a['submitted_at'] ? fmtDate(String(a['submitted_at'])) : '—'}
                    {a['decision_at'] ? ` · ${t('tenants.applications.decided', 'Decided')} ${fmtDate(String(a['decision_at']))}` : ''}
                  </p>
                  {Boolean(a['monthly_income_ttd']) && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {t('tenants.applications.income', 'Income')}: TTD ${parseFloat(String(a['monthly_income_ttd'])).toLocaleString('en-TT', { minimumFractionDigits: 2 })}
                      {a['employer_name'] ? ` · ${String(a['employer_name'])}` : ''}
                    </p>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded border ${APPLICATION_STATUS_COLORS[String(a['status'])] ?? ''}`}>{String(a['status'])}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-700 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">{t('common.close', 'Close')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Tenant Maintenance Tickets Modal ─────────────────────────────────────────
// prop_maintenance_tickets had no tenant_id at all -- only a nullable lease_id
// the frontend never actually populates. tenant_id is resolved from unit_id's
// active lease at ticket-creation time instead (see migration 054).

function TenantMaintenanceModal({ tenant, onClose }: { tenant: PropertyTenant; onClose: () => void }) {
  const { t } = useTranslation()

  const tenantName = tenant.is_company
    ? (tenant.company_name ?? 'Tenant')
    : `${tenant.first_name}${tenant.last_name ? ` ${tenant.last_name}` : ''}`

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['tenant-maintenance', tenant.id],
    queryFn: () => tenancyApi.getMaintenanceTickets({ tenant_id: tenant.id }),
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{t('tenants.maintenance.title', 'Maintenance')}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{tenantName}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3">
          {isLoading && <p className="text-slate-400 text-sm">{t('common.loading')}</p>}
          {!isLoading && tickets.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-8">{t('tenants.maintenance.none', 'No maintenance tickets on file for this tenant.')}</p>
          )}
          {tickets.map((tk: Record<string, unknown>) => (
            <div key={String(tk['id'])} className="bg-slate-700/50 rounded-lg border border-slate-700 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-200">{String(tk['ticket_ref'] ?? '—')} · {String(tk['category'] ?? '')}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{String(tk['property_name'] ?? '—')}{tk['unit_number'] ? ` · Unit ${String(tk['unit_number'])}` : ''} · {fmtDate(String(tk['created_at']))}</p>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">{String(tk['description'] ?? '')}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-600">{String(tk['priority'] ?? '')}</span>
                  <span className={`text-xs px-2 py-0.5 rounded border ${TICKET_STATUS_COLORS[String(tk['status'])] ?? ''}`}>{String(tk['status'])}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-700 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">{t('common.close', 'Close')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Tenant Handover Modal ────────────────────────────────────────────────────
// prop_handover_checklists had no tenant_id, only an optional lease_id (the
// frontend form DOES collect it via a picker, unlike maintenance tickets, but
// it's optional and there was no general list route at all -- only
// GET /unit/:unitId). tenant_id resolved from lease_id if given, else the
// unit's active lease at creation time (migration 055).

function TenantHandoverModal({ tenant, onClose }: { tenant: PropertyTenant; onClose: () => void }) {
  const { t } = useTranslation()

  const tenantName = tenant.is_company
    ? (tenant.company_name ?? 'Tenant')
    : `${tenant.first_name}${tenant.last_name ? ` ${tenant.last_name}` : ''}`

  const { data: checklists = [], isLoading } = useQuery({
    queryKey: ['tenant-handover', tenant.id],
    queryFn: () => tenancyApi.getHandoverForTenant(tenant.id),
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{t('tenants.handover.title', 'Handover')}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{tenantName}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3">
          {isLoading && <p className="text-slate-400 text-sm">{t('common.loading')}</p>}
          {!isLoading && checklists.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-8">{t('tenants.handover.none', 'No handover checklists on file for this tenant.')}</p>
          )}
          {checklists.map((h: Record<string, unknown>) => (
            <div key={String(h['id'])} className="bg-slate-700/50 rounded-lg border border-slate-700 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-200">{String(h['property_name'] ?? '—')}{h['unit_number'] ? ` · Unit ${String(h['unit_number'])}` : ''}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{fmtDate(String(h['created_at']))}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {t('tenants.handover.keys', 'Keys')}: {String(h['keys_issued'] ?? 0)}{h['keys_returned'] != null ? ` / ${String(h['keys_returned'])} ${t('tenants.handover.returned', 'returned')}` : ''}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-600">{String(h['type'] ?? '')}</span>
                  {Boolean(h['completed_at']) && <span className="text-xs px-2 py-0.5 rounded border bg-green-900/50 text-green-300 border-green-700">{t('tenants.handover.completed', 'Completed')}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-700 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">{t('common.close', 'Close')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Tenant Renewals Modal ────────────────────────────────────────────────────
// Unlike deposits/applications/maintenance, prop_renewal_notices already had
// lease_id NOT NULL (renewal notices can't exist without a lease), so tenant_id
// was always reachable via the lease -- same class of gap as Leases: missing
// query + missing UI, not a missing data link.

function TenantRenewalsModal({ tenant, onClose }: { tenant: PropertyTenant; onClose: () => void }) {
  const { t } = useTranslation()

  const tenantName = tenant.is_company
    ? (tenant.company_name ?? 'Tenant')
    : `${tenant.first_name}${tenant.last_name ? ` ${tenant.last_name}` : ''}`

  const { data: renewals = [], isLoading } = useQuery({
    queryKey: ['tenant-renewals', tenant.id],
    queryFn: () => tenancyApi.getRenewals({ tenant_id: tenant.id }),
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{t('tenants.renewals.title', 'Renewals')}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{tenantName}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3">
          {isLoading && <p className="text-slate-400 text-sm">{t('common.loading')}</p>}
          {!isLoading && renewals.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-8">{t('tenants.renewals.none', 'No renewal notices on file for this tenant.')}</p>
          )}
          {renewals.map((r: Record<string, unknown>) => (
            <div key={String(r['id'])} className="bg-slate-700/50 rounded-lg border border-slate-700 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-200">{String(r['property_name'] ?? '—')}{r['unit_number'] ? ` · Unit ${String(r['unit_number'])}` : ''}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{t('tenancy.leaseEnd', 'Lease Ends')}: {r['lease_end_date'] ? fmtDate(String(r['lease_end_date'])) : '—'}</p>
                  {Boolean(r['monthly_rent']) && (
                    <p className="text-xs text-slate-400 mt-0.5">TTD ${parseFloat(String(r['monthly_rent'])).toLocaleString('en-TT', { minimumFractionDigits: 2 })}/mo</p>
                  )}
                </div>
                {r['tenant_response']
                  ? <span className={`text-xs px-2 py-0.5 rounded border ${RENEWAL_RESPONSE_COLORS[String(r['tenant_response'])] ?? ''}`}>{String(r['tenant_response']).replace(/_/g, ' ')}</span>
                  : <span className="text-xs text-slate-500">{t('tenancy.awaitingResponse', 'Awaiting Response')}</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-700 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">{t('common.close', 'Close')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Tenant Leases Modal ────────────────────────────────────────────────────────
// Unlike deposits, leases already carry tenant_id NOT NULL -- the gap here was
// purely a missing query (every other lease route is scoped under
// /:propertyId/leases) and a missing UI section, not a missing data link.

function TenantLeasesModal({ tenant, onClose }: { tenant: PropertyTenant; onClose: () => void }) {
  const { t } = useTranslation()

  const tenantName = tenant.is_company
    ? (tenant.company_name ?? 'Tenant')
    : `${tenant.first_name}${tenant.last_name ? ` ${tenant.last_name}` : ''}`

  const { data: leases = [], isLoading } = useQuery({
    queryKey: ['tenant-leases', tenant.id],
    queryFn: () => propertiesApi.getLeasesForTenant(tenant.id),
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{t('tenants.leases.title', 'Leases')}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{tenantName}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3">
          {isLoading && <p className="text-slate-400 text-sm">{t('common.loading')}</p>}
          {!isLoading && leases.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-8">{t('tenants.leases.none', 'No leases on file for this tenant.')}</p>
          )}
          {leases.map((l: Lease) => (
            <div key={l.id} className="bg-slate-700/50 rounded-lg border border-slate-700 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-200">{l.property_name ?? '—'}{l.unit_number ? ` · Unit ${l.unit_number}` : ''}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{fmtDate(l.start_date)} — {l.end_date ? fmtDate(l.end_date) : t('tenants.leases.ongoing', 'ongoing')}</p>
                  <p className="text-sm font-mono text-slate-300 mt-1">
                    {l.currency} ${parseFloat(l.monthly_rent).toLocaleString('en-TT', { minimumFractionDigits: 2 })}/mo
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded border ${LEASE_STATUS_COLORS[l.status] ?? ''}`}>{l.status}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-700 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">{t('common.close', 'Close')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Tenant Deposits Modal ─────────────────────────────────────────────────────
// Deposits have no tenant_id column (see prop_deposits schema) -- the backend
// resolves them for a tenant via lease_id -> prop_lease_agreements.tenant_id,
// which is only populated once a lease exists (either set at deposit creation,
// or backfilled automatically when a lease is added later for that unit).

function TenantDepositsModal({ tenant, onClose }: { tenant: PropertyTenant; onClose: () => void }) {
  const { t } = useTranslation()

  const tenantName = tenant.is_company
    ? (tenant.company_name ?? 'Tenant')
    : `${tenant.first_name}${tenant.last_name ? ` ${tenant.last_name}` : ''}`

  const { data: deposits = [], isLoading } = useQuery({
    queryKey: ['tenant-deposits', tenant.id],
    queryFn: () => tenancyApi.getDeposits({ tenant_id: tenant.id }),
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{t('tenants.deposits.title', 'Deposits')}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{tenantName}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3">
          {isLoading && <p className="text-slate-400 text-sm">{t('common.loading')}</p>}
          {!isLoading && deposits.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-8">
              {t('tenants.deposits.none', 'No deposits linked to this tenant yet. A deposit only shows up here once a lease links it — record the deposit against the unit, then create the lease (or vice versa).')}
            </p>
          )}
          {deposits.map((d: Record<string, unknown>) => (
            <div key={String(d['id'])} className="bg-slate-700/50 rounded-lg border border-slate-700 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-slate-400">{t('tenants.deposits.unit', 'Unit')} {String(d['unit_number'] ?? '—')} · {String(d['received_date'] ?? '')}</p>
                  <p className="text-sm font-mono text-slate-200 mt-1">
                    TTD ${parseFloat(String(d['amount_ttd'] ?? 0)).toLocaleString('en-TT', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-slate-500">{t('tenancy.receiptNo', 'Receipt')}: {String(d['receipt_number'] ?? '—')}
                    <button onClick={() => void api.openHtml(`/properties/deposits/${String(d['id'])}/receipt`).catch(() => alert('Could not open the receipt.'))}
                      className="text-blue-400 hover:text-blue-300 ml-2">{t('tenancy.printReceipt', 'Print receipt')}</button>
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded border ${DEPOSIT_STATUS_COLORS[String(d['status'])] ?? ''}`}>{String(d['status'])}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-700 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">{t('common.close', 'Close')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function TenantsPanel() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editingTenant, setEditingTenant] = useState<PropertyTenant | null>(null)
  const [deletingTenant, setDeletingTenant] = useState<PropertyTenant | null>(null)
  const [docsForTenant, setDocsForTenant] = useState<PropertyTenant | null>(null)
  const [depositsForTenant, setDepositsForTenant] = useState<PropertyTenant | null>(null)
  const [leasesForTenant, setLeasesForTenant] = useState<PropertyTenant | null>(null)
  const [applicationsForTenant, setApplicationsForTenant] = useState<PropertyTenant | null>(null)
  const [maintenanceForTenant, setMaintenanceForTenant] = useState<PropertyTenant | null>(null)
  const [renewalsForTenant, setRenewalsForTenant] = useState<PropertyTenant | null>(null)
  const [handoverForTenant, setHandoverForTenant] = useState<PropertyTenant | null>(null)
  const qc = useQueryClient()

  const handleSearch = (val: string) => {
    setSearch(val)
    clearTimeout((window as unknown as { _tenantSearchTimer?: ReturnType<typeof setTimeout> })._tenantSearchTimer)
    ;(window as unknown as { _tenantSearchTimer?: ReturnType<typeof setTimeout> })._tenantSearchTimer = setTimeout(() => setDebouncedSearch(val), 300)
  }

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['properties', 'tenants', debouncedSearch],
    queryFn: () => propertiesApi.getTenants(debouncedSearch || undefined),
  })

  const refresh = () => void qc.invalidateQueries({ queryKey: ['properties', 'tenants'] })

  return (
    <div>
      <div className="flex gap-3 mb-4 items-center">
        <input
          type="text"
          placeholder={t('tenants.search')}
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className="w-80 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
        >
          {t('tenants.addBtn')}
        </button>
      </div>

      {isLoading && <p className="text-slate-400 text-sm">{t('common.loading')}</p>}
      {!isLoading && tenants.length === 0 && <p className="text-slate-500 text-sm">{t('tenants.noTenants')}</p>}

      {tenants.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2">{t('tenants.colName')}</th>
                <th className="text-left px-4 py-2">{t('tenants.colEmail')}</th>
                <th className="text-left px-4 py-2">{t('tenants.colPhone')}</th>
                <th className="text-left px-4 py-2">{t('tenants.colAdded')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {tenants.map(tn => (
                <tr key={tn.id} className="hover:bg-slate-700/30">
                  <td className="px-4 py-3">
                    <p className="text-slate-100 font-medium">
                      {tn.is_company ? tn.company_name : `${tn.first_name}${tn.last_name ? ` ${tn.last_name}` : ''}`}
                    </p>
                    {tn.is_company && <p className="text-xs text-slate-500 mt-0.5">{t('tenants.colType')}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-sm">{tn.email ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-sm">{tn.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(tn.created_at)}</td>
                  <td className="px-4 py-3 text-right flex gap-3 justify-end items-center">
                    <button
                      onClick={() => setDocsForTenant(tn)}
                      className="text-xs text-slate-500 hover:text-green-400 transition-colors"
                      title={t('tenants.docs.title', 'Documents')}
                    >{t('tenants.docsBtn', 'Docs')}</button>
                    <button
                      onClick={() => setDepositsForTenant(tn)}
                      className="text-xs text-slate-500 hover:text-green-400 transition-colors"
                      title={t('tenants.deposits.title', 'Deposits')}
                    >{t('tenants.deposits.btn', 'Deposits')}</button>
                    <button
                      onClick={() => setLeasesForTenant(tn)}
                      className="text-xs text-slate-500 hover:text-green-400 transition-colors"
                      title={t('tenants.leases.title', 'Leases')}
                    >{t('tenants.leases.btn', 'Leases')}</button>
                    <button
                      onClick={() => setApplicationsForTenant(tn)}
                      className="text-xs text-slate-500 hover:text-green-400 transition-colors"
                      title={t('tenants.applications.title', 'Applications')}
                    >{t('tenants.applications.btn', 'Applications')}</button>
                    <button
                      onClick={() => setMaintenanceForTenant(tn)}
                      className="text-xs text-slate-500 hover:text-green-400 transition-colors"
                      title={t('tenants.maintenance.title', 'Maintenance')}
                    >{t('tenants.maintenance.btn', 'Maintenance')}</button>
                    <button
                      onClick={() => setRenewalsForTenant(tn)}
                      className="text-xs text-slate-500 hover:text-green-400 transition-colors"
                      title={t('tenants.renewals.title', 'Renewals')}
                    >{t('tenants.renewals.btn', 'Renewals')}</button>
                    <button
                      onClick={() => setHandoverForTenant(tn)}
                      className="text-xs text-slate-500 hover:text-green-400 transition-colors"
                      title={t('tenants.handover.title', 'Handover')}
                    >{t('tenants.handover.btn', 'Handover')}</button>
                    <button
                      onClick={() => setEditingTenant(tn)}
                      className="text-xs text-slate-500 hover:text-blue-400 transition-colors"
                    >{t('tenants.editBtn')}</button>
                    <button
                      onClick={() => setDeletingTenant(tn)}
                      className="text-xs text-slate-600 hover:text-red-400 transition-colors"
                      title={t('tenants.deleteTitle')}
                    >&#x1F5D1;</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddTenantModal onClose={() => setShowAdd(false)} onCreated={refresh} />}
      {docsForTenant && <TenantDocsModal tenant={docsForTenant} onClose={() => setDocsForTenant(null)} />}
      {depositsForTenant && <TenantDepositsModal tenant={depositsForTenant} onClose={() => setDepositsForTenant(null)} />}
      {leasesForTenant && <TenantLeasesModal tenant={leasesForTenant} onClose={() => setLeasesForTenant(null)} />}
      {applicationsForTenant && <TenantApplicationsModal tenant={applicationsForTenant} onClose={() => setApplicationsForTenant(null)} />}
      {maintenanceForTenant && <TenantMaintenanceModal tenant={maintenanceForTenant} onClose={() => setMaintenanceForTenant(null)} />}
      {renewalsForTenant && <TenantRenewalsModal tenant={renewalsForTenant} onClose={() => setRenewalsForTenant(null)} />}
      {handoverForTenant && <TenantHandoverModal tenant={handoverForTenant} onClose={() => setHandoverForTenant(null)} />}
      {deletingTenant && (
        <ConfirmDeleteModal
          label={deletingTenant.is_company ? (deletingTenant.company_name ?? 'Tenant') : `${deletingTenant.first_name}${deletingTenant.last_name ? ` ${deletingTenant.last_name}` : ''}`}
          onConfirm={() => propertiesApi.deleteTenant(deletingTenant.id).then(() => {
            void qc.invalidateQueries({ queryKey: ['properties', 'tenants'] })
          })}
          onClose={() => setDeletingTenant(null)}
        />
      )}
      {editingTenant && (
        <EditTenantModal
          tenant={editingTenant}
          onClose={() => setEditingTenant(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}
