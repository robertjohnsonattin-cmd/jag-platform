import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export type SuccessionDocType =
  | 'WILL' | 'TRUST' | 'POWER_OF_ATTORNEY' | 'INSURANCE_POLICY' | 'TITLE_DEED'
  | 'SHARE_CERTIFICATE' | 'BANK_MANDATE' | 'COMPANY_RESOLUTION' | 'ADVANCE_DIRECTIVE' | 'OTHER'

// List shape — storage_path and notes are intentionally omitted (classified).
export interface SuccessionDoc {
  id:                   string
  document_type:        SuccessionDocType
  title:                string
  description:          string | null
  document_date:        string | null
  is_classified:        boolean
  governing_law:        string | null
  lawyer_firm:          string | null
  last_reviewed_date:   string | null
  review_reminder_date: string | null
  last_modified_at:     string
  created_at:           string
}

// Detail shape — adds the fields the by-id route returns.
export interface SuccessionDocDetail extends SuccessionDoc {
  storage_path: string | null
  notes:        string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BUCKET_DOCUMENTS = 'jag-documents'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const DOC_TYPE_LABELS: Record<SuccessionDocType, string> = {
  WILL:               'Will',
  TRUST:              'Trust',
  POWER_OF_ATTORNEY:  'Power of Attorney',
  INSURANCE_POLICY:   'Insurance Policy',
  TITLE_DEED:         'Title Deed',
  SHARE_CERTIFICATE:  'Share Certificate',
  BANK_MANDATE:       'Bank Mandate',
  COMPANY_RESOLUTION: 'Company Resolution',
  ADVANCE_DIRECTIVE:  'Advance Directive',
  OTHER:              'Other',
}

const DOC_TYPE_ICONS: Record<SuccessionDocType, string> = {
  WILL:               '📜',
  TRUST:              '🏛️',
  POWER_OF_ATTORNEY:  '⚖️',
  INSURANCE_POLICY:   '🛡️',
  TITLE_DEED:         '🏠',
  SHARE_CERTIFICATE:  '📈',
  BANK_MANDATE:       '🏦',
  COMPANY_RESOLUTION: '🏢',
  ADVANCE_DIRECTIVE:  '🩺',
  OTHER:              '📄',
}

const DOC_TYPES = Object.keys(DOC_TYPE_LABELS) as SuccessionDocType[]

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function isReviewOverdue(date: string | null): boolean {
  if (!date) return false
  return new Date(date).getTime() < Date.now()
}

function isReviewSoon(date: string | null): boolean {
  if (!date) return false
  const days = (new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  return days >= 0 && days <= 60
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500'

// ── Upload Modal ──────────────────────────────────────────────────────────────

function UploadModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState({
    title: '', document_type: '' as SuccessionDocType | '',
    description: '', document_date: '', governing_law: '', lawyer_firm: '',
    last_reviewed_date: '', review_reminder_date: '', is_classified: true, notes: '',
  })
  const [progress, setProgress] = useState<'idle' | 'uploading' | 'registering' | 'done'>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    if (f && !form.title) setForm(prev => ({ ...prev, title: f.name.replace(/\.[^.]+$/, '') }))
  }

  const dateOrUndef = (v: string) => (v && DATE_RE.test(v)) ? v : undefined

  const handleUpload = async () => {
    if (!form.document_type) return
    setUploadError(null)
    try {
      let storagePath: string | undefined
      // Optional file — estate documents may be registered before scanning.
      if (file) {
        setProgress('uploading')
        const formData = new FormData()
        formData.append('file', file)
        formData.append('bucket', BUCKET_DOCUMENTS)
        formData.append('module', 'succession')
        formData.append('entity_id', uuidv4())
        const uploaded = await api.postForm<{ key: string }>('/files/upload', formData)
        storagePath = uploaded.key
      }

      setProgress('registering')
      await api.post('/succession/documents', {
        document_type:        form.document_type,
        title:                form.title || file?.name || 'Untitled',
        description:          form.description || undefined,
        document_date:        dateOrUndef(form.document_date),
        storage_path:         storagePath,
        is_classified:        form.is_classified,
        governing_law:        form.governing_law || undefined,
        lawyer_firm:          form.lawyer_firm || undefined,
        last_reviewed_date:   dateOrUndef(form.last_reviewed_date),
        review_reminder_date: dateOrUndef(form.review_reminder_date),
        notes:                form.notes || undefined,
      })

      setProgress('done')
      qc.invalidateQueries({ queryKey: ['succession-documents'] })
      setTimeout(onClose, 400)
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed.')
      setProgress('idle')
    }
  }

  const canSubmit = form.document_type && form.title && progress === 'idle'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('succession.uploadTitle')}</h2>

        <div
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors mb-4 ${
            file ? 'border-orange-500 bg-orange-950/20' : 'border-slate-600 hover:border-slate-500'
          }`}>
          <input ref={fileRef} type="file" className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt"
            onChange={handleFileChange} />
          {file ? (
            <div>
              <p className="text-white font-medium text-sm">{file.name}</p>
              <p className="text-slate-400 text-xs mt-1">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
          ) : (
            <div>
              <p className="text-2xl mb-1">📁</p>
              <p className="text-slate-400 text-sm">{t('succession.clickToSelect')}</p>
              <p className="text-slate-500 text-xs mt-1">{t('succession.fileOptional')}</p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('succession.docTitle')}</label>
              <input value={form.title} onChange={set('title')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('succession.docType')}</label>
              <select value={form.document_type} onChange={set('document_type')} className={cls}>
                <option value="">— select —</option>
                {DOC_TYPES.map(dt => (
                  <option key={dt} value={dt}>{DOC_TYPE_ICONS[dt]} {t(`succession.docTypes.${dt}`, DOC_TYPE_LABELS[dt])}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('succession.description')}</label>
            <input value={form.description} onChange={set('description')} className={cls} />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('succession.documentDate')}</label>
              <input type="date" value={form.document_date} onChange={set('document_date')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('succession.governingLaw')}</label>
              <input value={form.governing_law} onChange={set('governing_law')} placeholder="Trinidad & Tobago" className={cls} />
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('succession.lawyerFirm')}</label>
              <input value={form.lawyer_firm} onChange={set('lawyer_firm')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('succession.reviewReminder')}</label>
              <input type="date" value={form.review_reminder_date} onChange={set('review_reminder_date')} className={cls} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_classified}
                onChange={e => setForm(f => ({ ...f, is_classified: e.target.checked }))}
                className="w-4 h-4 accent-orange-500" />
              <span className="text-slate-300 text-sm">{t('succession.classified')}</span>
            </label>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
        </div>

        {uploadError && <p className="text-red-400 text-xs mt-3">{uploadError}</p>}
        {progress !== 'idle' && progress !== 'done' && (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-400">
            <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            {progress === 'uploading' ? t('succession.uploading') : t('succession.registering')}
          </div>
        )}

        <div className="flex gap-3 mt-5">
          <button onClick={handleUpload} disabled={!canSubmit}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {t('succession.saveDocument')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
// Only fields the backend PATCH persists (governing_law is set at upload only).

function EditModal({ doc, onClose }: { doc: SuccessionDocDetail; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    title: doc.title,
    description: doc.description ?? '',
    document_date: doc.document_date ? doc.document_date.slice(0, 10) : '',
    lawyer_firm: doc.lawyer_firm ?? '',
    last_reviewed_date: doc.last_reviewed_date ? doc.last_reviewed_date.slice(0, 10) : '',
    review_reminder_date: doc.review_reminder_date ? doc.review_reminder_date.slice(0, 10) : '',
    is_classified: doc.is_classified,
    notes: doc.notes ?? '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))
  const dateOrUndef = (v: string) => (v && DATE_RE.test(v)) ? v : undefined

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => api.patch(`/succession/documents/${doc.id}`, {
      title: form.title,
      description: form.description || undefined,
      document_date: dateOrUndef(form.document_date),
      lawyer_firm: form.lawyer_firm || undefined,
      last_reviewed_date: dateOrUndef(form.last_reviewed_date),
      review_reminder_date: dateOrUndef(form.review_reminder_date),
      is_classified: form.is_classified,
      notes: form.notes || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['succession-documents'] })
      qc.invalidateQueries({ queryKey: ['succession-document', doc.id] })
      onClose()
    },
  })

  const markReviewedToday = () =>
    setForm(f => ({ ...f, last_reviewed_date: new Date().toISOString().slice(0, 10) }))

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('succession.editTitle')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('succession.docTitle')}</label>
            <input value={form.title} onChange={set('title')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('succession.description')}</label>
            <input value={form.description} onChange={set('description')} className={cls} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('succession.documentDate')}</label>
              <input type="date" value={form.document_date} onChange={set('document_date')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('succession.lawyerFirm')}</label>
              <input value={form.lawyer_firm} onChange={set('lawyer_firm')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('succession.lastReviewed')}</label>
              <input type="date" value={form.last_reviewed_date} onChange={set('last_reviewed_date')} className={cls} />
            </div>
            <button type="button" onClick={markReviewedToday}
              className="px-3 py-2 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors whitespace-nowrap">
              {t('succession.markReviewedToday')}
            </button>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('succession.reviewReminder')}</label>
            <input type="date" value={form.review_reminder_date} onChange={set('review_reminder_date')} className={cls} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_classified}
              onChange={e => setForm(f => ({ ...f, is_classified: e.target.checked }))}
              className="w-4 h-4 accent-orange-500" />
            <span className="text-slate-300 text-sm">{t('succession.classified')}</span>
          </label>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.title}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('common.save')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DocDetailPanel({ docId, onClose }: { docId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const { data: doc, isLoading } = useQuery({
    queryKey: ['succession-document', docId],
    queryFn: () => api.get<SuccessionDocDetail>(`/succession/documents/${docId}`),
  })

  if (isLoading || !doc) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">{t('common.loading')}</div>
    )
  }

  const overdue  = isReviewOverdue(doc.review_reminder_date)
  const soon     = isReviewSoon(doc.review_reminder_date)

  // Authenticated download — fetch with the Bearer token then save as a blob.
  // A plain <a href> can't carry the Authorization header (requireAuth is header-only).
  const handleDownload = async () => {
    if (!doc.storage_path) return
    setDownloading(true)
    try {
      const name = doc.storage_path.split('/').pop()?.replace(/^\d+_/, '') || doc.title
      await api.download(`/files/download?bucket=${BUCKET_DOCUMENTS}&key=${encodeURIComponent(doc.storage_path)}`, name)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="text-3xl">{DOC_TYPE_ICONS[doc.document_type]}</span>
          <div>
            <p className="text-white font-semibold">{doc.title}</p>
            <p className="text-slate-400 text-sm">{t(`succession.docTypes.${doc.document_type}`, DOC_TYPE_LABELS[doc.document_type])}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors">{t('common.edit')}</button>
          <button onClick={onClose} className="md:hidden text-slate-400 hover:text-white text-sm">{t('common.back')}</button>
          <button onClick={onClose} className="hidden md:block text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {overdue && (
          <div className="flex items-center gap-2 p-3 bg-red-950/40 border border-red-700 rounded-lg text-red-400 text-sm">
            <span>⚠</span> {t('succession.reviewOverdue')} {fmtDate(doc.review_reminder_date)}
          </div>
        )}
        {!overdue && soon && (
          <div className="flex items-center gap-2 p-3 bg-yellow-950/40 border border-yellow-700 rounded-lg text-yellow-400 text-sm">
            <span>⏰</span> {t('succession.reviewSoon')} {fmtDate(doc.review_reminder_date)}
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {[
            { label: t('succession.documentDate'), value: fmtDate(doc.document_date) },
            { label: t('succession.governingLaw'), value: doc.governing_law ?? '—' },
            { label: t('succession.lawyerFirm'),   value: doc.lawyer_firm ?? '—' },
            { label: t('succession.classified'),   value: doc.is_classified ? t('common.yes') : t('common.no') },
            { label: t('succession.lastReviewed'), value: fmtDate(doc.last_reviewed_date) },
            { label: t('succession.reviewReminder'), value: fmtDate(doc.review_reminder_date) },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-slate-500 text-xs">{label}</p>
              <p className="text-white mt-0.5">{value}</p>
            </div>
          ))}
        </div>

        {doc.description && (
          <div>
            <p className="text-slate-500 text-xs mb-1">{t('succession.description')}</p>
            <p className="text-slate-300 text-sm">{doc.description}</p>
          </div>
        )}

        {doc.notes && (
          <div>
            <p className="text-slate-500 text-xs mb-1">{t('common.notes')}</p>
            <p className="text-slate-300 text-sm bg-slate-900/40 rounded-lg p-3">{doc.notes}</p>
          </div>
        )}

        <div className="pt-2">
          {doc.storage_path ? (
            <button onClick={handleDownload} disabled={downloading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
              {downloading ? t('common.loading') : t('succession.downloadView')}
            </button>
          ) : (
            <p className="text-slate-500 text-sm text-center py-2">{t('succession.noFile')}</p>
          )}
        </div>
      </div>

      {editing && <EditModal doc={doc} onClose={() => setEditing(false)} />}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Succession() {
  const { t } = useTranslation()
  const [typeFilter, setTypeFilter] = useState<SuccessionDocType | ''>('')
  const [classifiedFilter, setClassifiedFilter] = useState<'' | 'true' | 'false'>('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['succession-documents', typeFilter],
    queryFn: () => {
      const q = new URLSearchParams()
      if (typeFilter) q.set('document_type', typeFilter)
      const qs = q.toString()
      return api.get<SuccessionDoc[]>(`/succession/documents${qs ? `?${qs}` : ''}`)
    },
  })

  const displayed = docs.filter(d => {
    if (classifiedFilter === 'true' && !d.is_classified) return false
    if (classifiedFilter === 'false' && d.is_classified) return false
    if (search) {
      const s = search.toLowerCase()
      return d.title.toLowerCase().includes(s) || (d.description ?? '').toLowerCase().includes(s)
    }
    return true
  })

  const overdueCount = docs.filter(d => isReviewOverdue(d.review_reminder_date)).length
  const soonCount    = docs.filter(d => isReviewSoon(d.review_reminder_date) && !isReviewOverdue(d.review_reminder_date)).length

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">{t('succession.title')}</h1>
            <p className="text-slate-400 text-sm mt-0.5">{t('succession.subtitle')}</p>
          </div>
          <button onClick={() => setShowUpload(true)}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm rounded-lg transition-colors">
            {t('succession.uploadBtn')}
          </button>
        </div>

        {(overdueCount > 0 || soonCount > 0) && (
          <div className="flex gap-3 mt-3">
            {overdueCount > 0 && (
              <span className="px-3 py-1.5 bg-red-950/40 border border-red-700 rounded-lg text-red-400 text-xs">
                ⚠ {t('succession.overdueAlert', { count: overdueCount })}
              </span>
            )}
            {soonCount > 0 && (
              <span className="px-3 py-1.5 bg-yellow-950/40 border border-yellow-700 rounded-lg text-yellow-400 text-xs">
                ⏰ {t('succession.soonAlert', { count: soonCount })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-slate-700 flex items-center gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={t('succession.searchPlaceholder')}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm w-56 focus:outline-none focus:border-orange-500" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as SuccessionDocType | '')}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm">
          <option value="">{t('succession.allTypes')}</option>
          {DOC_TYPES.map(dt => <option key={dt} value={dt}>{DOC_TYPE_ICONS[dt]} {t(`succession.docTypes.${dt}`, DOC_TYPE_LABELS[dt])}</option>)}
        </select>
        <select value={classifiedFilter} onChange={e => setClassifiedFilter(e.target.value as '' | 'true' | 'false')}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm">
          <option value="">{t('succession.allDocuments')}</option>
          <option value="true">{t('succession.classifiedOnly')}</option>
          <option value="false">{t('succession.openOnly')}</option>
        </select>
        <span className="text-slate-500 text-sm ml-auto">{t('succession.documentCount', { count: displayed.length })}</span>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        <div className={`flex flex-col overflow-y-auto ${selectedId ? 'hidden md:flex md:w-1/2 md:border-r md:border-slate-700' : 'flex-1'}`}>
          {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>}
          {!isLoading && displayed.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500">
              <p className="text-4xl mb-3">⚖️</p>
              <p className="text-sm">{t('succession.noDocuments')}</p>
              <button onClick={() => setShowUpload(true)} className="mt-3 text-orange-400 hover:text-orange-300 text-sm">{t('succession.uploadFirst')}</button>
            </div>
          )}

          {displayed.length > 0 && (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {displayed.map(d => {
                const overdue = isReviewOverdue(d.review_reminder_date)
                const soon    = isReviewSoon(d.review_reminder_date) && !overdue
                return (
                  <button key={d.id} onClick={() => setSelectedId(d.id)}
                    className={`text-left p-4 rounded-xl border transition-colors ${
                      selectedId === d.id
                        ? 'border-orange-500 bg-orange-950/20'
                        : overdue
                        ? 'border-red-700/60 bg-red-950/10 hover:bg-red-950/20'
                        : soon
                        ? 'border-yellow-700/60 bg-yellow-950/10 hover:bg-yellow-950/20'
                        : 'border-slate-700 bg-slate-800 hover:bg-slate-700/60'
                    }`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="text-2xl">{DOC_TYPE_ICONS[d.document_type]}</span>
                      <div className="flex gap-1 flex-wrap justify-end">
                        {d.is_classified && (
                          <span className="px-1.5 py-0.5 bg-purple-900/40 text-purple-300 text-xs rounded border border-purple-700">{t('succession.classifiedBadge')}</span>
                        )}
                        {overdue && <span className="px-1.5 py-0.5 bg-red-900/40 text-red-400 text-xs rounded border border-red-700">{t('succession.overdueBadge')}</span>}
                        {soon && <span className="px-1.5 py-0.5 bg-yellow-900/40 text-yellow-400 text-xs rounded border border-yellow-700">{t('succession.soonBadge')}</span>}
                      </div>
                    </div>
                    <p className="text-white font-medium text-sm leading-tight">{d.title}</p>
                    <p className="text-slate-400 text-xs mt-1">{t(`succession.docTypes.${d.document_type}`, DOC_TYPE_LABELS[d.document_type])}</p>
                    {d.review_reminder_date && (
                      <p className={`text-xs mt-2 ${overdue ? 'text-red-400' : soon ? 'text-yellow-400' : 'text-slate-500'}`}>
                        {t('succession.reviewReminder')}: {fmtDate(d.review_reminder_date)}
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {selectedId && (
          <div className={`flex-1 overflow-hidden flex flex-col bg-slate-800/50 ${selectedId ? 'block' : 'hidden md:block'}`}>
            <DocDetailPanel docId={selectedId} onClose={() => setSelectedId(null)} />
          </div>
        )}
      </div>

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}
    </div>
  )
}
