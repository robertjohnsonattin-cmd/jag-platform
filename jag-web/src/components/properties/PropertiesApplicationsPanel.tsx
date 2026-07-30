import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'
import AuthedImg from '../AuthedImg'

const STATUS_COLORS: Record<string, string> = {
  PENDING:      'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  UNDER_REVIEW: 'bg-blue-900/50 text-blue-300 border-blue-700',
  APPROVED:     'bg-green-900/50 text-green-300 border-green-700',
  REJECTED:     'bg-red-900/50 text-red-300 border-red-700',
  WITHDRAWN:    'bg-slate-700 text-slate-500 border-slate-600',
}

const APPLICATION_DOC_TYPES = [
  'national_id', 'drivers_permit', 'passport', 'employment_letter', 'payslip_1', 'payslip_2', 'payslip_3',
] as const

// Two vocabularies land here: lowercase (Robert's own manual upload, below) and
// uppercase (the public /apply form's identification + document sections) —
// both need a friendly label.
const DOC_TYPE_LABELS: Record<string, string> = {
  national_id: 'National ID / ID Card', drivers_permit: 'Driver’s Permit', passport: 'Passport',
  employment_letter: 'Employment Letter / Job Letter',
  payslip_1: 'Payslip (1st)', payslip_2: 'Payslip (2nd)', payslip_3: 'Payslip (3rd)', payslip: 'Payslip',
  NATIONAL_ID: 'National ID / ID Card', DRIVERS_PERMIT: 'Driver’s Permit', PASSPORT: 'Passport',
  EMPLOYMENT_LETTER: 'Employment Letter / Job Letter', PAYSLIP: 'Payslip', OTHER: 'Other relevant document',
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-slate-500 w-44 flex-shrink-0">{label}</span>
      <span className="text-slate-200">{value ?? '—'}</span>
    </div>
  )
}

// ── Create Tenant Modal ───────────────────────────────────────────────────────

function CreateTenantModal({
  applicationId,
  fullName,
  onClose,
  onCreated,
}: {
  applicationId: string
  fullName: string
  onClose: () => void
  onCreated: (tenantId: string) => void
}) {
  const { t } = useTranslation()
  const spaceIdx = fullName.indexOf(' ')
  const [firstName, setFirstName] = useState(spaceIdx > 0 ? fullName.slice(0, spaceIdx) : fullName)
  const [lastName, setLastName]   = useState(spaceIdx > 0 ? fullName.slice(spaceIdx + 1) : '')

  const { mutate, isPending, error, data } = useMutation({
    mutationFn: () => tenancyApi.createTenantFromApplication(applicationId, {
      first_name: firstName.trim() || undefined,
      last_name:  lastName.trim()  || undefined,
    }),
    onSuccess: (result) => {
      const tid = (result.tenant as Record<string, unknown>).id as string
      onCreated(tid)
    },
  })

  if (data) {
    const docsCopied = data.docs_copied
    const tName = [firstName, lastName].filter(Boolean).join(' ')
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl text-center">
          <div className="text-4xl mb-3">✓</div>
          <h3 className="text-lg font-semibold text-white mb-1">{t('tenancy.tenantCreated', 'Tenant created!')}</h3>
          <p className="text-slate-300 text-sm mb-1">{tName}</p>
          {docsCopied > 0 && (
            <p className="text-slate-400 text-xs mb-4">
              {t('tenancy.docsCopied', '{{count}} document(s) copied to tenant vault', { count: docsCopied })}
            </p>
          )}
          <button onClick={onClose} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg">{t('common.close', 'Close')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <h3 className="text-base font-semibold text-white mb-1">{t('tenancy.createTenant', 'Create Tenant')}</h3>
        <p className="text-xs text-slate-400 mb-4">{t('tenancy.createTenantHint', 'Confirm the name and any existing documents will be copied to the tenant vault.')}</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('tenants.firstName')}</label>
            <input value={firstName} onChange={e => setFirstName(e.target.value)} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('tenants.lastName')}</label>
            <input value={lastName} onChange={e => setLastName(e.target.value)} className={cls} />
          </div>
        </div>
        {error && <p className="text-red-400 text-xs mt-2">{error instanceof Error ? error.message : 'Failed.'}</p>}
        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">{t('common.cancel')}</button>
          <button
            onClick={() => mutate()}
            disabled={isPending || !firstName.trim()}
            className="px-4 py-2 text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded"
          >
            {isPending ? t('common.saving') : t('tenancy.createTenant', 'Create Tenant')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ID verification thumbnails ──────────────────────────────────────────────
// No OCR — Robert just eyeballs the typed ID number against the uploaded
// photo(s). Shown inline (not a download link) so that comparison doesn't
// require leaving the page.

const ID_DOC_TYPES = new Set(['national_id', 'drivers_permit', 'passport', 'NATIONAL_ID', 'DRIVERS_PERMIT', 'PASSPORT'])

function IdVerificationThumbs({ applicationId, docs }: { applicationId: string; docs: { id: string; doc_type: string; label: string; file_name: string }[] }) {
  const idDocs = docs.filter(d => ID_DOC_TYPES.has(d.doc_type))
  if (idDocs.length === 0) return null
  return (
    <div className="flex gap-3 pt-1">
      {idDocs.map(d => (
        <div key={d.id} className="text-center">
          <AuthedImg
            path={`/properties/applications/${applicationId}/documents/${d.id}/download`}
            alt={d.label}
            className="w-28 h-20 object-cover rounded border border-slate-600"
          />
          <p className="text-[10px] text-slate-500 mt-0.5">{DOC_TYPE_LABELS[d.doc_type] ?? d.doc_type}</p>
        </div>
      ))}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function PropertiesApplicationsPanel({ focusId }: { focusId?: string | null } = {}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<string | null>(focusId ?? null)

  // Deep-link from a notification click (?tab=applications&focus=<id>).
  useEffect(() => { if (focusId) setSelected(focusId) }, [focusId])
  const [decisionModal, setDecisionModal] = useState<'APPROVED' | 'REJECTED' | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showCreateTenant, setShowCreateTenant] = useState(false)
  const [uploadDocType, setUploadDocType] = useState<typeof APPLICATION_DOC_TYPES[number]>('national_id')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const { data: applications = [] } = useQuery({
    queryKey: ['applications'],
    queryFn: () => tenancyApi.getApplications(),
  })

  const { data: detail } = useQuery({
    queryKey: ['application', selected],
    queryFn: () => tenancyApi.getApplication(selected!),
    enabled: !!selected,
  })

  const { data: appDocs = [] } = useQuery({
    queryKey: ['application-docs', selected],
    queryFn: () => tenancyApi.getApplicationDocuments(selected!),
    enabled: !!selected,
  })

  const decideMut = useMutation({
    mutationFn: ({ decision, reason }: { decision: string; reason?: string }) =>
      tenancyApi.decideApplication(selected!, decision, reason),
    onSuccess: () => {
      setDecisionModal(null)
      void qc.invalidateQueries({ queryKey: ['applications'] })
      void qc.invalidateQueries({ queryKey: ['application', selected] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => tenancyApi.deleteApplication(selected!),
    onSuccess: () => {
      setShowDeleteConfirm(false)
      setSelected(null)
      void qc.invalidateQueries({ queryKey: ['applications'] })
    },
  })


  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null)

  async function handleDocUpload(file: File) {
    if (!selected) return
    setUploading(true)
    setUploadError(null)
    try {
      await tenancyApi.uploadApplicationDoc(selected, uploadDocType, file)
      void qc.invalidateQueries({ queryKey: ['application-docs', selected] })
    } catch {
      setUploadError(t('tenancy.docUploadError', 'Upload failed. Please try again.'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDocDownload(docId: string, fileName: string) {
    if (!selected) return
    setDownloadingDocId(docId)
    try { await tenancyApi.downloadApplicationDoc(selected, docId, fileName) }
    catch { /* silent */ }
    finally { setDownloadingDocId(null) }
  }

  const selectedStatus = detail ? String(detail['status']) : ''
  const selectedName   = detail ? String(detail['full_name']) : ''

  return (
    <div className="flex gap-4 h-[700px]">
      {/* Application list */}
      <div className={`${selected ? 'hidden md:block' : 'block'} w-full md:w-80 overflow-y-auto`}>
        {applications.length === 0 && (
          <p className="text-sm text-slate-500 py-6 text-center">{t('tenancy.noApplications', 'No applications yet.')}</p>
        )}
        {applications.map((a: Record<string, unknown>) => (
          <div key={String(a['id'])} onClick={() => setSelected(String(a['id']))}
            className={`p-3 rounded border mb-2 cursor-pointer transition-colors ${selected === String(a['id']) ? 'border-blue-500 bg-slate-700' : 'border-slate-700 bg-slate-800 hover:bg-slate-750'}`}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-200">{String(a['full_name'])}</p>
              <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLORS[String(a['status'])] ?? ''}`}>
                {String(a['status'])}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">Unit {String(a['unit_number'] ?? '—')}</p>
          </div>
        ))}
      </div>

      {/* Detail panel */}
      <div className={`${!selected ? 'hidden md:block' : 'block'} flex-1 border-l-0 md:border-l border-slate-700 md:pl-4 overflow-y-auto space-y-5`}>
        {!selected && (
          <p className="hidden md:block text-sm text-slate-500 mt-8 text-center">{t('tenancy.selectApplication', 'Select an application.')}</p>
        )}

        {detail && (
          <>
            <button onClick={() => setSelected(null)} className="md:hidden text-sm text-blue-400 hover:text-blue-300">
              {t('common.back', '← Back')}
            </button>
            {/* Header + status actions */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-200">{selectedName}</h3>
                <span className={`text-xs px-2 py-1 rounded border ${STATUS_COLORS[selectedStatus] ?? ''}`}>{selectedStatus}</span>
              </div>
              <div className="space-y-2">
                <InfoRow label={t('tenancy.phone', 'Phone')} value={String(detail['phone'] ?? '')} />
                <InfoRow label={t('tenancy.email', 'Email')} value={String(detail['email'] ?? '')} />
                <InfoRow label={t('tenancy.nationalId', 'National ID')} value={String(detail['national_id'] ?? '')} />
                <IdVerificationThumbs applicationId={selected!} docs={appDocs} />
                <InfoRow label={t('tenancy.employer', 'Employer')} value={String(detail['employer_name'] ?? '')} />
                <InfoRow label={t('tenancy.employmentType', 'Employment')} value={String(detail['employment_type'] ?? '')} />
                <InfoRow
                  label={t('tenancy.monthlyIncome', 'Monthly Income TTD')}
                  value={detail['monthly_income_ttd'] ? `$${parseFloat(String(detail['monthly_income_ttd'])).toLocaleString('en-TT', { minimumFractionDigits: 2 })}` : null}
                />
                <InfoRow label={t('tenancy.ref1', 'Reference 1')} value={detail['reference_1_name'] ? `${detail['reference_1_name']} (${detail['reference_1_relation']}) ${detail['reference_1_phone']}` : null} />
                <InfoRow label={t('tenancy.ref2', 'Reference 2')} value={detail['reference_2_name'] ? `${detail['reference_2_name']} (${detail['reference_2_relation']}) ${detail['reference_2_phone']}` : null} />
                <InfoRow label={t('tenancy.priorLandlord', 'Prior Landlord')} value={detail['prior_landlord_name'] ? `${detail['prior_landlord_name']} ${detail['prior_landlord_phone']}` : null} />
                <InfoRow label="Emergency Contact 1" value={detail['emergency_contact_name'] ? `${detail['emergency_contact_name']} (${detail['emergency_contact_relation']}) ${detail['emergency_contact_phone']}` : null} />
                <InfoRow label="Emergency Contact 2" value={detail['emergency_contact_2_name'] ? `${detail['emergency_contact_2_name']} (${detail['emergency_contact_2_relation']}) ${detail['emergency_contact_2_phone']}` : null} />
              </div>

              {/* Approve / Reject */}
              {(selectedStatus === 'PENDING' || selectedStatus === 'UNDER_REVIEW') && (
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setDecisionModal('APPROVED')}
                    className="px-4 py-2 text-sm bg-green-700 hover:bg-green-600 text-white rounded">
                    {t('tenancy.approve', 'Approve')}
                  </button>
                  <button onClick={() => setDecisionModal('REJECTED')}
                    className="px-4 py-2 text-sm bg-red-800 hover:bg-red-700 text-white rounded">
                    {t('tenancy.reject', 'Reject')}
                  </button>
                </div>
              )}

              {Boolean(detail['rejection_reason']) && (
                <p className="text-sm text-red-400">{t('tenancy.rejectedReason', 'Reason')}: {String(detail['rejection_reason'])}</p>
              )}

              {/* Create Tenant — only for APPROVED */}
              {selectedStatus === 'APPROVED' && (
                <div className="pt-2 border-t border-slate-700">
                  <button
                    onClick={() => setShowCreateTenant(true)}
                    className="px-4 py-2 text-sm bg-blue-700 hover:bg-blue-600 text-white rounded"
                  >
                    {t('tenancy.createTenantBtn', 'Create Tenant Record →')}
                  </button>
                  <p className="text-xs text-slate-500 mt-1">{t('tenancy.createTenantNote', 'Creates a tenant and copies all uploaded documents to their vault.')}</p>
                </div>
              )}

              {/* Delete — Owner only (enforced server-side); blocked if a tenant or
                  deposit already links to this application (409, message shown below). */}
              <div className="pt-2 border-t border-slate-700">
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  {t('tenancy.deleteApplication', 'Delete Application')}
                </button>
                {deleteMut.isError && (
                  <p className="text-xs text-red-400 mt-1">
                    {(deleteMut.error as Error & { code?: string })?.message ?? t('tenancy.deleteApplicationError', 'Could not delete this application.')}
                  </p>
                )}
              </div>
            </div>

            {/* Documents section */}
            <div className="border-t border-slate-700 pt-4">
              <h4 className="text-sm font-semibold text-slate-300 mb-3">{t('tenancy.appDocs', 'Supporting Documents')}</h4>

              {/* Upload row */}
              <div className="flex gap-2 mb-3 flex-wrap">
                <select
                  value={uploadDocType}
                  onChange={e => setUploadDocType(e.target.value as typeof APPLICATION_DOC_TYPES[number])}
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {APPLICATION_DOC_TYPES.map(dt => (
                    <option key={dt} value={dt}>{DOC_TYPE_LABELS[dt]}</option>
                  ))}
                </select>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void handleDocUpload(f) }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white text-xs rounded transition-colors"
                >
                  {uploading ? t('common.uploading', 'Uploading…') : t('tenancy.uploadDoc', '+ Upload')}
                </button>
                {uploadError && <p className="text-red-400 text-xs self-center">{uploadError}</p>}
              </div>

              {/* Doc list */}
              {appDocs.length === 0 && (
                <p className="text-xs text-slate-500">{t('tenancy.noAppDocs', 'No documents uploaded yet.')}</p>
              )}
              <div className="space-y-1.5">
                {appDocs.map(doc => (
                  <div key={doc.id} className="flex items-center gap-3 bg-slate-700/40 rounded px-3 py-2 border border-slate-700">
                    <span className="text-xs font-medium text-slate-300 bg-slate-600 px-1.5 py-0.5 rounded whitespace-nowrap">
                      {DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}
                    </span>
                    <span className="text-xs text-slate-400 truncate flex-1">{doc.file_name}</span>
                    <button
                      onClick={() => void handleDocDownload(doc.id, doc.file_name)}
                      disabled={downloadingDocId === doc.id}
                      className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 whitespace-nowrap"
                    >
                      {downloadingDocId === doc.id ? '…' : t('common.download', 'Download')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Decision modal */}
      {decisionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold mb-3">
              {decisionModal === 'APPROVED' ? t('tenancy.confirmApprove', 'Approve Application?') : t('tenancy.confirmReject', 'Reject Application?')}
            </h3>
            {decisionModal === 'REJECTED' && (
              <textarea className={cls} rows={3} placeholder={t('tenancy.rejectionReason', 'Reason for rejection...')}
                value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} />
            )}
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setDecisionModal(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel', 'Cancel')}</button>
              <button
                onClick={() => decideMut.mutate({ decision: decisionModal, reason: rejectionReason || undefined })}
                disabled={decideMut.isPending}
                className={`px-4 py-2 text-sm text-white rounded disabled:opacity-40 ${decisionModal === 'APPROVED' ? 'bg-green-700 hover:bg-green-600' : 'bg-red-800 hover:bg-red-700'}`}
              >
                {decideMut.isPending ? t('common.saving', 'Saving...') : t('common.confirm', 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold mb-2">{t('tenancy.confirmDeleteApplication', 'Delete this application?')}</h3>
            <p className="text-sm text-slate-400">{t('tenancy.confirmDeleteApplicationNote', 'This permanently removes the application and its uploaded documents. This cannot be undone.')}</p>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel', 'Cancel')}</button>
              <button
                onClick={() => deleteMut.mutate()}
                disabled={deleteMut.isPending}
                className="px-4 py-2 text-sm text-white rounded disabled:opacity-40 bg-red-800 hover:bg-red-700"
              >
                {deleteMut.isPending ? t('common.saving', 'Deleting...') : t('tenancy.deleteApplication', 'Delete Application')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create tenant modal */}
      {showCreateTenant && selected && (
        <CreateTenantModal
          applicationId={selected}
          fullName={selectedName}
          onClose={() => setShowCreateTenant(false)}
          onCreated={() => {
            setShowCreateTenant(false)
            void qc.invalidateQueries({ queryKey: ['properties', 'tenants'] })
          }}
        />
      )}
    </div>
  )
}
