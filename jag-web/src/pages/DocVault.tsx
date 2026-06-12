import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DocType =
  | 'NATIONAL_ID' | 'PASSPORT' | 'BIRTH_CERTIFICATE' | 'MARRIAGE_CERTIFICATE'
  | 'DEATH_CERTIFICATE' | 'MEDICAL_RECORD' | 'ACADEMIC_CERTIFICATE'
  | 'PROFESSIONAL_LICENCE' | 'FINANCIAL_STATEMENT' | 'TAX_RETURN'
  | 'INSURANCE_POLICY' | 'PROPERTY_TITLE' | 'LEGAL_AGREEMENT' | 'OTHER'

export interface DocFile {
  id:               string
  title:            string
  document_type:    DocType
  file_name:        string
  storage_path:     string
  mime_type:        string
  file_size_bytes:  number
  family_member_id: string | null
  expires_date:     string | null
  is_data_room:     boolean
  data_room_entity: string | null
  notes:            string | null
  last_modified_at: string
  created_at:       string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BUCKET_DOCUMENTS = 'jag-documents'

const DOC_TYPE_LABELS: Record<DocType, string> = {
  NATIONAL_ID:           'National ID',
  PASSPORT:              'Passport',
  BIRTH_CERTIFICATE:     'Birth Certificate',
  MARRIAGE_CERTIFICATE:  'Marriage Certificate',
  DEATH_CERTIFICATE:     'Death Certificate',
  MEDICAL_RECORD:        'Medical Record',
  ACADEMIC_CERTIFICATE:  'Academic Certificate',
  PROFESSIONAL_LICENCE:  'Professional Licence',
  FINANCIAL_STATEMENT:   'Financial Statement',
  TAX_RETURN:            'Tax Return',
  INSURANCE_POLICY:      'Insurance Policy',
  PROPERTY_TITLE:        'Property Title',
  LEGAL_AGREEMENT:       'Legal Agreement',
  OTHER:                 'Other',
}

const DOC_TYPE_ICONS: Record<DocType, string> = {
  NATIONAL_ID:           '🪪',
  PASSPORT:              '📘',
  BIRTH_CERTIFICATE:     '📜',
  MARRIAGE_CERTIFICATE:  '💍',
  DEATH_CERTIFICATE:     '📋',
  MEDICAL_RECORD:        '🏥',
  ACADEMIC_CERTIFICATE:  '🎓',
  PROFESSIONAL_LICENCE:  '⚖️',
  FINANCIAL_STATEMENT:   '📊',
  TAX_RETURN:            '🧾',
  INSURANCE_POLICY:      '🛡️',
  PROPERTY_TITLE:        '🏠',
  LEGAL_AGREEMENT:       '📝',
  OTHER:                 '📄',
}

const DOC_TYPES = Object.keys(DOC_TYPE_LABELS) as DocType[]

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

function fmtSize(bytes: number): string {
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(d: string | null) {
  return d ? new Date(d).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
}

function isExpiringSoon(date: string | null): boolean {
  if (!date) return false
  const days = (new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  return days >= 0 && days <= 90
}

function isExpired(date: string | null): boolean {
  if (!date) return false
  return new Date(date).getTime() < Date.now()
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500'

function mimeIcon(mime: string): string {
  if (mime.startsWith('image/')) return '🖼'
  if (mime === 'application/pdf') return '📕'
  if (mime.includes('word')) return '📘'
  if (mime.includes('sheet') || mime.includes('excel')) return '📗'
  return '📄'
}

// ── Upload Modal ──────────────────────────────────────────────────────────────

function UploadModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState({
    title: '', document_type: '' as DocType | '',
    expires_date: '', is_data_room: false,
    data_room_entity: '', notes: '',
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

  const handleUpload = async () => {
    if (!file || !form.document_type) return
    setUploadError(null)

    try {
      // Step 1 — upload file to MinIO via the files proxy
      setProgress('uploading')
      const entityId = uuidv4()
      const formData = new FormData()
      formData.append('file', file)
      formData.append('bucket', BUCKET_DOCUMENTS)
      formData.append('module', 'docvault')
      formData.append('entity_id', entityId)

      const uploaded = await api.postForm<{ key: string; size: number; content_type: string }>(
        '/files/upload', formData,
      )

      // Step 2 — register metadata
      setProgress('registering')
      await api.post('/docvault/files', {
        title:            form.title || file.name,
        document_type:    form.document_type,
        file_name:        file.name,
        storage_path:     uploaded.key,
        mime_type:        uploaded.content_type,
        file_size_bytes:  uploaded.size,
        expires_date:     form.expires_date || undefined,
        is_data_room:     form.is_data_room,
        data_room_entity: form.is_data_room && form.data_room_entity ? form.data_room_entity : undefined,
        notes:            form.notes || undefined,
      })

      setProgress('done')
      qc.invalidateQueries({ queryKey: ['docvault-files'] })
      setTimeout(onClose, 500)
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed.')
      setProgress('idle')
    }
  }

  const canSubmit = file && form.document_type && progress === 'idle'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">Upload Document</h2>

        {/* File picker */}
        <div
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors mb-4 ${
            file ? 'border-orange-500 bg-orange-950/20' : 'border-slate-600 hover:border-slate-500'
          }`}>
          <input ref={fileRef} type="file" className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt"
            onChange={handleFileChange} />
          {file ? (
            <div>
              <p className="text-2xl mb-1">{mimeIcon(file.type)}</p>
              <p className="text-white font-medium">{file.name}</p>
              <p className="text-slate-400 text-xs mt-1">{fmtSize(file.size)} · {file.type}</p>
            </div>
          ) : (
            <div>
              <p className="text-3xl mb-2">📁</p>
              <p className="text-slate-400 text-sm">Click to select a file</p>
              <p className="text-slate-500 text-xs mt-1">PDF, Word, Excel, images — max 50 MB</p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Title</label>
              <input value={form.title} onChange={set('title')} placeholder={file?.name ?? ''} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Document Type *</label>
              <select value={form.document_type} onChange={set('document_type')} className={cls}>
                <option value="">— select —</option>
                {DOC_TYPES.map(t => (
                  <option key={t} value={t}>{DOC_TYPE_ICONS[t]} {DOC_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Expiry Date</label>
              <input type="date" value={form.expires_date} onChange={set('expires_date')} className={cls} />
            </div>
            <div className="flex-1 flex items-end gap-2 pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_data_room}
                  onChange={e => setForm(f => ({ ...f, is_data_room: e.target.checked }))}
                  className="w-4 h-4 accent-orange-500" />
                <span className="text-slate-300 text-sm">Data Room</span>
              </label>
            </div>
          </div>

          {form.is_data_room && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Data Room Entity</label>
              <input value={form.data_room_entity} onChange={set('data_room_entity')}
                placeholder="JABCO, JAG Properties…" className={cls} />
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
        </div>

        {uploadError && <p className="text-red-400 text-xs mt-3">{uploadError}</p>}

        {progress !== 'idle' && (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-400">
            <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            {progress === 'uploading'   && 'Uploading file…'}
            {progress === 'registering' && 'Registering metadata…'}
            {progress === 'done'        && <span className="text-green-400">Done ✓</span>}
          </div>
        )}

        <div className="flex gap-3 mt-5">
          <button onClick={handleUpload} disabled={!canSubmit}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            Upload & Register
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Document Detail Panel ─────────────────────────────────────────────────────

function DocDetailPanel({ doc, onClose }: { doc: DocFile; onClose: () => void }) {
  const qc = useQueryClient()
  const [deleting, setDeleting] = useState(false)

  const { mutate: deleteDoc, isPending: isDeleting } = useMutation({
    mutationFn: async () => {
      // Step 1: remove DB record (returns storage_path)
      const result = await api.delete<{ deleted: boolean; storage_path: string }>(`/docvault/files/${doc.id}`)
      // Step 2: remove MinIO object (best-effort — DB record already gone if this fails)
      await api.deleteBody('/files', { bucket: BUCKET_DOCUMENTS, key: result.storage_path }).catch(() => {})
      return result
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['docvault-files'] })
      onClose()
    },
  })

  const downloadUrl = `/api/v1/files/download?bucket=${BUCKET_DOCUMENTS}&key=${encodeURIComponent(doc.storage_path)}`
  const expired     = isExpired(doc.expires_date)
  const expiring    = isExpiringSoon(doc.expires_date)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="text-3xl">{DOC_TYPE_ICONS[doc.document_type]}</span>
          <div>
            <p className="text-white font-semibold">{doc.title}</p>
            <p className="text-slate-400 text-sm">{DOC_TYPE_LABELS[doc.document_type]}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none shrink-0">&times;</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Expiry warning */}
        {expired && (
          <div className="flex items-center gap-2 p-3 bg-red-950/40 border border-red-700 rounded-lg text-red-400 text-sm">
            <span>⚠</span> Expired on {fmtDate(doc.expires_date)}
          </div>
        )}
        {!expired && expiring && (
          <div className="flex items-center gap-2 p-3 bg-yellow-950/40 border border-yellow-700 rounded-lg text-yellow-400 text-sm">
            <span>⏰</span> Expires {fmtDate(doc.expires_date)} — renew soon
          </div>
        )}

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {[
            { label: 'File Name',  value: doc.file_name },
            { label: 'Size',       value: fmtSize(doc.file_size_bytes) },
            { label: 'Type',       value: doc.mime_type },
            { label: 'Uploaded',   value: fmtDate(doc.created_at) },
            { label: 'Expires',    value: fmtDate(doc.expires_date) },
            { label: 'Data Room',  value: doc.is_data_room ? (doc.data_room_entity ?? 'Yes') : 'No' },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-slate-500 text-xs">{label}</p>
              <p className="text-white mt-0.5">{value}</p>
            </div>
          ))}
        </div>

        {doc.notes && (
          <div>
            <p className="text-slate-500 text-xs mb-1">Notes</p>
            <p className="text-slate-300 text-sm bg-slate-900/40 rounded-lg p-3">{doc.notes}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-2">
          <a href={downloadUrl} target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-2 py-2.5 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded-lg transition-colors">
            ↓ Download / View
          </a>

          {!deleting ? (
            <button onClick={() => setDeleting(true)}
              className="py-2.5 text-slate-400 hover:text-red-400 text-sm transition-colors border border-slate-700 hover:border-red-700 rounded-lg">
              Delete Document
            </button>
          ) : (
            <div className="p-3 border border-red-700 rounded-lg bg-red-950/30">
              <p className="text-red-400 text-sm mb-3">Permanently delete this document and its file?</p>
              <div className="flex gap-2">
                <button onClick={() => deleteDoc()} disabled={isDeleting}
                  className="flex-1 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
                  {isDeleting ? 'Deleting…' : 'Yes, Delete'}
                </button>
                <button onClick={() => setDeleting(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DocVault() {
  const [typeFilter, setTypeFilter] = useState<DocType | ''>('')
  const [dataRoomFilter, setDataRoomFilter] = useState<'' | 'true' | 'false'>('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<DocFile | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['docvault-files', typeFilter, dataRoomFilter],
    queryFn: () => {
      const q = new URLSearchParams()
      if (typeFilter)       q.set('document_type', typeFilter)
      if (dataRoomFilter)   q.set('is_data_room',  dataRoomFilter)
      const qs = q.toString()
      return api.get<DocFile[]>(`/docvault/files${qs ? `?${qs}` : ''}`)
    },
  })

  const displayed = search
    ? files.filter(f =>
        f.title.toLowerCase().includes(search.toLowerCase()) ||
        f.file_name.toLowerCase().includes(search.toLowerCase()) ||
        (f.notes ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : files

  const expiredCount  = files.filter(f => isExpired(f.expires_date)).length
  const expiringCount = files.filter(f => isExpiringSoon(f.expires_date) && !isExpired(f.expires_date)).length

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">DocVault</h1>
            <p className="text-slate-400 text-sm mt-0.5">Secure document registry — IDs, titles, licences, statements</p>
          </div>
          <button onClick={() => setShowUpload(true)}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm rounded-lg transition-colors">
            + Upload Document
          </button>
        </div>

        {/* Expiry alerts */}
        {(expiredCount > 0 || expiringCount > 0) && (
          <div className="flex gap-3 mt-3">
            {expiredCount > 0 && (
              <button onClick={() => {}}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-950/40 border border-red-700 rounded-lg text-red-400 text-xs hover:bg-red-950/60 transition-colors">
                ⚠ {expiredCount} expired document{expiredCount !== 1 ? 's' : ''}
              </button>
            )}
            {expiringCount > 0 && (
              <button onClick={() => {}}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-950/40 border border-yellow-700 rounded-lg text-yellow-400 text-xs hover:bg-yellow-950/60 transition-colors">
                ⏰ {expiringCount} expiring within 90 days
              </button>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-slate-700 flex items-center gap-3 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search title or filename…"
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm w-56 focus:outline-none focus:border-orange-500"
        />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as DocType | '')}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm">
          <option value="">All Types</option>
          {DOC_TYPES.map(t => <option key={t} value={t}>{DOC_TYPE_ICONS[t]} {DOC_TYPE_LABELS[t]}</option>)}
        </select>
        <select value={dataRoomFilter} onChange={e => setDataRoomFilter(e.target.value as '' | 'true' | 'false')}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm">
          <option value="">All Documents</option>
          <option value="true">Data Room Only</option>
          <option value="false">Personal Only</option>
        </select>
        <span className="text-slate-500 text-sm ml-auto">{displayed.length} document{displayed.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* File list */}
        <div className={`flex flex-col overflow-y-auto ${selected ? 'hidden lg:flex lg:w-1/2 lg:border-r lg:border-slate-700' : 'flex-1'}`}>
          {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading…</div>}
          {!isLoading && displayed.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500">
              <p className="text-4xl mb-3">🗄️</p>
              <p className="text-sm">No documents yet.</p>
              <button onClick={() => setShowUpload(true)} className="mt-3 text-orange-400 hover:text-orange-300 text-sm">Upload your first document →</button>
            </div>
          )}

          {/* Grid of document cards */}
          {displayed.length > 0 && (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {displayed.map(f => {
                const expired  = isExpired(f.expires_date)
                const expiring = isExpiringSoon(f.expires_date) && !expired
                return (
                  <button key={f.id} onClick={() => setSelected(f)}
                    className={`text-left p-4 rounded-xl border transition-colors ${
                      selected?.id === f.id
                        ? 'border-orange-500 bg-orange-950/20'
                        : expired
                        ? 'border-red-700/60 bg-red-950/10 hover:bg-red-950/20'
                        : expiring
                        ? 'border-yellow-700/60 bg-yellow-950/10 hover:bg-yellow-950/20'
                        : 'border-slate-700 bg-slate-800 hover:bg-slate-700/60'
                    }`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="text-2xl">{DOC_TYPE_ICONS[f.document_type]}</span>
                      <div className="flex gap-1 flex-wrap justify-end">
                        {f.is_data_room && (
                          <span className="px-1.5 py-0.5 bg-purple-900/40 text-purple-300 text-xs rounded border border-purple-700">DR</span>
                        )}
                        {expired && <span className="px-1.5 py-0.5 bg-red-900/40 text-red-400 text-xs rounded border border-red-700">Expired</span>}
                        {expiring && <span className="px-1.5 py-0.5 bg-yellow-900/40 text-yellow-400 text-xs rounded border border-yellow-700">Expiring</span>}
                      </div>
                    </div>
                    <p className="text-white font-medium text-sm leading-tight">{f.title}</p>
                    <p className="text-slate-400 text-xs mt-1">{DOC_TYPE_LABELS[f.document_type]}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                      <span>{mimeIcon(f.mime_type)}</span>
                      <span>{fmtSize(f.file_size_bytes)}</span>
                      <span className="ml-auto">{fmtDate(f.created_at)}</span>
                    </div>
                    {f.expires_date && (
                      <p className={`text-xs mt-1 ${expired ? 'text-red-400' : expiring ? 'text-yellow-400' : 'text-slate-500'}`}>
                        Expires {fmtDate(f.expires_date)}
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="flex-1 overflow-hidden flex flex-col bg-slate-800/50">
            <DocDetailPanel doc={selected} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}
    </div>
  )
}
