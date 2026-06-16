import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { financeApi } from '../../api/finance'
import type { DocumentJob, DocumentJobStatus, DocumentJobType } from '../../types/finance'

type UploadState = 'idle' | 'uploading' | 'done' | 'error'

interface StagedFile {
  key:      string
  file:     File
  docType:  DocumentJobType | ''
  state:    UploadState
  errorMsg: string | null
}

const DOC_TYPE_VALUES: DocumentJobType[] = ['LOAN', 'INVESTMENT', 'INSURANCE']

const STATUS_STYLES: Record<DocumentJobStatus, string> = {
  PENDING:    'bg-yellow-500/20 text-yellow-300',
  PROCESSING: 'bg-blue-500/20  text-blue-300',
  REVIEW:     'bg-purple-500/20 text-purple-300',
  APPROVED:   'bg-green-500/20  text-green-300',
  FAILED:     'bg-red-500/20    text-red-300',
}

const ENTITY_OPTIONS = [
  { id: '00000000-0000-0000-0001-000000000001', label: 'JAG Holdings' },
  { id: '00000000-0000-0000-0001-000000000002', label: 'JABCO' },
  { id: '00000000-0000-0000-0001-000000000003', label: 'JAG Properties' },
  { id: '00000000-0000-0000-0001-000000000004', label: 'JAG Entertainment' },
  { id: '00000000-0000-0000-0001-000000000005', label: 'JAG Finance' },
  { id: '00000000-0000-0000-0001-000000000006', label: 'DragonBridge' },
  { id: '00000000-0000-0000-0001-000000000008', label: 'Personal — Robert' },
  { id: '00000000-0000-0000-0001-000000000009', label: 'Isabella Johnson-Attin' },
  { id: '00000000-0000-0000-0001-000000000010', label: 'Phillip Ajack Johnson-Attin' },
  { id: '00000000-0000-0000-0001-000000000011', label: 'Brian Johnson-Attin' },
  { id: '00000000-0000-0000-0001-000000000012', label: 'Zhanghua Chang' },
  { id: '00000000-0000-0000-0001-000000000013', label: 'Theresa Johnson-Attin' },
]

function fmt(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('en-TT', { dateStyle: 'short', timeStyle: 'short' })
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function ReviewCard({ job, onApproved, onDeleted }: {
  job: DocumentJob
  onApproved: () => void
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const [entityId, setEntityId] = useState(ENTITY_OPTIONS[0].id)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [holdingsJson, setHoldingsJson] = useState('')
  const [holdingsJsonErr, setHoldingsJsonErr] = useState<string | null>(null)
  const [overrideHoldings, setOverrideHoldings] = useState(false)
  const ex = job.extracted_data ?? {}

  const hasHoldings = job.doc_type === 'INVESTMENT' && (ex['holdings'] as unknown[])?.length > 0
  const needsHoldings = job.doc_type === 'INVESTMENT' && (!hasHoldings || overrideHoldings)

  const approve = async () => {
    setBusy(true); setErr(null); setHoldingsJsonErr(null)

    let overrides: Record<string, unknown> | undefined
    if (needsHoldings) {
      if (!holdingsJson.trim()) {
        setHoldingsJsonErr('Enter at least one holding before approving.')
        setBusy(false)
        return
      }
      try {
        const parsed: unknown = JSON.parse(holdingsJson)
        overrides = { holdings: Array.isArray(parsed) ? parsed : [parsed] }
      } catch {
        setHoldingsJsonErr('Invalid JSON — check your brackets and quotes.')
        setBusy(false)
        return
      }
    }

    try {
      await financeApi.approveDocumentJob(job.id, { owner_entity_id: entityId, overrides })
      onApproved()
    } catch (e) {
      setErr((e as Error).message)
    } finally { setBusy(false) }
  }

  const reject = async () => {
    if (!confirm(t('documents.deleteConfirm'))) return
    setBusy(true)
    try {
      await financeApi.deleteDocumentJob(job.id)
      onDeleted()
    } catch (e) {
      setErr((e as Error).message)
    } finally { setBusy(false) }
  }

  const inp = 'bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="bg-slate-800 border border-purple-600/40 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-100">{job.file_name}</p>
          <p className="text-xs text-slate-400 mt-0.5">{job.doc_type} — extracted {fmt(job.completed_at)}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLES['REVIEW']}`}>
          {t('documents.statuses.REVIEW')}
        </span>
      </div>

      <div className="bg-slate-900 rounded p-3 overflow-auto max-h-48">
        {hasHoldings && !overrideHoldings ? (
          <div className="space-y-1">
            <p className="text-xs text-slate-400 mb-2">
              {String(ex['institution_name'] ?? '')} — {String(ex['as_of_date'] ?? '')}
              <button className="ml-3 text-slate-500 hover:text-slate-300 underline" onClick={() => setOverrideHoldings(true)}>override</button>
            </p>
            {(ex['holdings'] as Record<string, unknown>[]).map((h, i) => (
              <div key={i} className="flex justify-between text-xs text-slate-300">
                <span>{String(h['asset_name'] ?? '?')} <span className="text-slate-500">({String(h['investment_type'] ?? '')})</span></span>
                <span>{String(h['currency'] ?? 'TTD')} {h['current_value_ttd'] ? Number(h['current_value_ttd']).toLocaleString() : '—'}</span>
              </div>
            ))}
          </div>
        ) : (
          <pre className="text-xs text-slate-300 whitespace-pre-wrap">
            {JSON.stringify(ex, null, 2)}
          </pre>
        )}
      </div>

      {needsHoldings && (
        <div className="space-y-1">
          <p className="text-xs text-yellow-400">
            No holdings extracted — enter them manually as a JSON array:
          </p>
          <textarea
            className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-xs text-slate-300 font-mono h-36 resize-y focus:outline-none focus:ring-1 focus:ring-purple-500"
            value={holdingsJson}
            onChange={e => setHoldingsJson(e.target.value)}
            placeholder={`[
  {
    "asset_name": "NCB Financial Group",
    "investment_type": "EQUITY",
    "ticker_symbol": "NCBFG",
    "units_held": 100,
    "currency": "TTD",
    "current_value_ttd": 15000
  }
]`}
          />
          {holdingsJsonErr && <p className="text-xs text-red-400">{holdingsJsonErr}</p>}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <select
          className={`flex-1 min-w-[180px] ${inp}`}
          value={entityId}
          onChange={e => setEntityId(e.target.value)}
          disabled={busy}
        >
          {ENTITY_OPTIONS.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>

        <button
          className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 rounded text-xs font-medium transition-colors"
          onClick={approve}
          disabled={busy}
        >
          {busy ? t('documents.importing') : t('documents.approveImport')}
        </button>
        <button
          className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
          onClick={reject}
          disabled={busy}
        >
          {t('common.reject')}
        </button>
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}

      {job.status === 'APPROVED' && job.target_record_ids?.length && (
        <p className="text-xs text-green-400">
          {t('documents.recordsCreated', { count: job.target_record_ids.length })}
        </p>
      )}
    </div>
  )
}

export default function DocumentsPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)

  const [staged, setStaged]       = useState<StagedFile[]>([])
  const [dragging, setDragging]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null)

  const { data: triggerStatus } = useQuery({
    queryKey: ['document-jobs', 'trigger-status'],
    queryFn: financeApi.getBatchTriggerStatus,
    refetchInterval: triggerMsg ? 5_000 : false,
  })

  useEffect(() => {
    if (triggerMsg && triggerStatus && !triggerStatus.pending) {
      setTriggerMsg({ text: 'Processing complete — check the queue below.', type: 'success' })
      void qc.invalidateQueries({ queryKey: ['document-jobs'] })
    }
  }, [triggerStatus, triggerMsg, qc])

  const handleTrigger = async () => {
    setTriggering(true)
    setTriggerMsg(null)
    try {
      await financeApi.triggerBatch()
      setTriggerMsg({ text: 'Batch triggered — workstation will process within 2 minutes.', type: 'info' })
      void qc.invalidateQueries({ queryKey: ['document-jobs', 'trigger-status'] })
    } catch {
      setTriggerMsg({ text: 'Failed to trigger batch. Check API connection.', type: 'error' })
    } finally {
      setTriggering(false)
    }
  }

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['document-jobs'],
    queryFn:  () => financeApi.getDocumentJobs({ limit: 100 }),
    refetchInterval: (query) => {
      const data = query.state.data as DocumentJob[] | undefined
      return data?.some(j => j.status === 'PENDING' || j.status === 'PROCESSING') ? 10_000 : false
    },
  })

  const reviewJobs  = jobs.filter(j => j.status === 'REVIEW')
  const historyJobs = jobs.filter(j => j.status !== 'REVIEW')

  const addFiles = useCallback((files: FileList | File[]) => {
    const allowed = ['.pdf', '.csv', '.txt']
    const arr = Array.from(files).filter(f => {
      const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
      return allowed.includes(ext)
    })
    if (!arr.length) return
    setStaged(prev => {
      const existing = new Set(prev.map(s => s.file.name + s.file.size))
      return [
        ...prev,
        ...arr
          .filter(f => !existing.has(f.name + f.size))
          .map(f => ({
            key:     `${f.name}-${f.size}-${Date.now()}-${Math.random()}`,
            file:    f,
            docType: '' as DocumentJobType | '',
            state:   'idle' as UploadState,
            errorMsg: null,
          })),
      ]
    })
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    addFiles(e.dataTransfer.files)
  }, [addFiles])

  const setDocType = (key: string, docType: DocumentJobType | '') =>
    setStaged(prev => prev.map(s => s.key === key ? { ...s, docType } : s))

  const removeStaged = (key: string) =>
    setStaged(prev => prev.filter(s => s.key !== key))

  const uploadAll = async () => {
    const ready = staged.filter(s => s.docType && s.state === 'idle')
    if (!ready.length) return
    setUploading(true)

    await Promise.all(ready.map(async (s) => {
      setStaged(prev => prev.map(x => x.key === s.key ? { ...x, state: 'uploading' } : x))
      try {
        const idem = `upload:${s.docType}:${s.file.name}:${s.file.size}:${Date.now()}`
        await financeApi.uploadDocumentJob(s.file, s.docType as DocumentJobType, idem)
        setStaged(prev => prev.map(x => x.key === s.key ? { ...x, state: 'done' } : x))
      } catch (e) {
        setStaged(prev => prev.map(x =>
          x.key === s.key ? { ...x, state: 'error', errorMsg: (e as Error).message } : x
        ))
      }
    }))

    setUploading(false)
    qc.invalidateQueries({ queryKey: ['document-jobs'] })
  }

  const clearDone = () => setStaged(prev => prev.filter(s => s.state !== 'done'))

  const readyCount  = staged.filter(s => s.docType && s.state === 'idle').length
  const doneCount   = staged.filter(s => s.state === 'done').length
  const unassigned  = staged.filter(s => !s.docType && s.state === 'idle').length

  const inp = 'bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="space-y-6">

      {/* How it works */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 text-xs text-slate-400 space-y-1">
        <p className="text-slate-200 font-medium">{t('documents.twoPaths')}</p>
        <p>
          <span className="text-slate-300">{t('documents.path1Title')}</span>{' '}
          {t('documents.path1Detail')}
        </p>
        <p>
          <span className="text-slate-300">{t('documents.path2Title')}</span>{' '}
          <code className="text-slate-300 bg-slate-900 px-1 rounded">node dist/extract.js --type loan --file "C:/JAG Filing/..."</code>{' '}
          {t('documents.path2From')}{' '}
          <code className="text-slate-300 bg-slate-900 px-1 rounded">scripts/doc-import/</code>
        </p>
      </div>

      {/* Process Now */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleTrigger}
          disabled={triggering || triggerStatus?.pending}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
        >
          {triggering || triggerStatus?.pending
            ? <><span className="animate-spin">⟳</span> Processing…</>
            : '▶ Process Now'}
        </button>
        {triggerMsg && (
          <p className={`text-xs ${triggerMsg.type === 'error' ? 'text-red-400' : triggerMsg.type === 'success' ? 'text-green-400' : 'text-slate-400'}`}>
            {triggerMsg.text}
          </p>
        )}
        {triggerStatus?.pending && (
          <button
            className="text-xs text-slate-500 hover:text-slate-300 underline"
            onClick={async () => {
              await financeApi.clearBatchTrigger()
              setTriggerMsg(null)
              void qc.invalidateQueries({ queryKey: ['document-jobs', 'trigger-status'] })
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Drop zone */}
      <div>
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            dragging ? 'border-purple-400 bg-purple-500/10' : 'border-slate-600 hover:border-slate-500'
          }`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.csv,.txt"
            className="hidden"
            onChange={e => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = '' }}
          />
          <p className="text-slate-300 text-sm font-medium">
            {dragging ? t('documents.dropActive') : t('documents.dropzone')}
          </p>
          <p className="text-slate-500 text-xs mt-1">{t('documents.dropzoneHint')}</p>
        </div>
      </div>

      {/* Staging queue */}
      {staged.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>{staged.length}</span>
              {unassigned > 0 && <span className="text-yellow-400">{unassigned} {t('documents.needDocType')}</span>}
              {doneCount  > 0 && <span className="text-green-400">{doneCount} {t('bankStatements.uploaded')}</span>}
            </div>
            <div className="flex items-center gap-2">
              {doneCount > 0 && (
                <button className="text-xs text-slate-400 hover:text-slate-200" onClick={clearDone}>
                  {t('documents.clearDone')}
                </button>
              )}
              <button
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 rounded text-xs font-medium transition-colors"
                disabled={readyCount === 0 || uploading}
                onClick={uploadAll}
              >
                {uploading ? t('documents.uploading') : `${t('documents.upload')} ${readyCount > 0 ? readyCount : ''}`}
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-700/50">
            {staged.map(s => (
              <div key={s.key} className="px-4 py-2 flex items-center gap-3">
                <div className="w-5 flex-shrink-0 text-center">
                  {s.state === 'idle'      && <span className="text-slate-500 text-xs">○</span>}
                  {s.state === 'uploading' && <span className="text-purple-400 text-xs animate-pulse">↑</span>}
                  {s.state === 'done'      && <span className="text-green-400 text-xs">✓</span>}
                  {s.state === 'error'     && <span className="text-red-400 text-xs">✗</span>}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200 truncate" title={s.file.name}>{s.file.name}</p>
                  {s.errorMsg
                    ? <p className="text-xs text-red-400 truncate">{s.errorMsg}</p>
                    : <p className="text-xs text-slate-500">{fmtBytes(s.file.size)}</p>
                  }
                </div>

                <select
                  className={`w-56 flex-shrink-0 ${inp} ${!s.docType && s.state === 'idle' ? 'border-yellow-600' : ''}`}
                  value={s.docType}
                  disabled={s.state !== 'idle'}
                  onChange={e => setDocType(s.key, e.target.value as DocumentJobType | '')}
                >
                  <option value="">— {t('common.type')} —</option>
                  {DOC_TYPE_VALUES.map(v => (
                    <option key={v} value={v}>{t(`documents.docTypes.${v}`)}</option>
                  ))}
                </select>

                {s.state === 'idle' && (
                  <button
                    className="text-slate-500 hover:text-red-400 transition-colors text-sm flex-shrink-0"
                    onClick={() => removeStaged(s.key)}
                  >×</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending review */}
      {reviewJobs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-200">
            {t('documents.pendingReview')}
            <span className="ml-2 bg-purple-500/20 text-purple-300 text-xs px-2 py-0.5 rounded-full">{reviewJobs.length}</span>
          </h2>
          {reviewJobs.map(job => (
            <ReviewCard
              key={job.id}
              job={job}
              onApproved={() => qc.invalidateQueries({ queryKey: ['document-jobs'] })}
              onDeleted={() => qc.invalidateQueries({ queryKey: ['document-jobs'] })}
            />
          ))}
        </div>
      )}

      {/* History */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">{t('documents.history')}</h2>
          <button
            className="text-xs text-slate-400 hover:text-slate-200"
            onClick={() => qc.invalidateQueries({ queryKey: ['document-jobs'] })}
          >
            {t('common.refresh')}
          </button>
        </div>

        {isLoading && <p className="text-sm text-slate-400 px-5 py-6">{t('common.loading')}</p>}

        {!isLoading && historyJobs.length === 0 && (
          <p className="text-sm text-slate-400 px-5 py-6">{t('documents.noJobs')}</p>
        )}

        {!isLoading && historyJobs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 border-b border-slate-700">
                  <th className="px-4 py-2 text-left font-medium">{t('documents.colFile')}</th>
                  <th className="px-4 py-2 text-left font-medium">{t('documents.colType')}</th>
                  <th className="px-4 py-2 text-left font-medium">{t('documents.colStatus')}</th>
                  <th className="px-4 py-2 text-left font-medium">{t('documents.colUploaded')}</th>
                  <th className="px-4 py-2 text-left font-medium">{t('documents.colCompleted')}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {historyJobs.map(job => (
                  <tr key={job.id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-2 text-slate-200 max-w-[200px] truncate" title={job.file_name}>
                      {job.file_name}
                    </td>
                    <td className="px-4 py-2 text-slate-300 text-xs">{job.doc_type}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[job.status]}`}>
                        {t(`documents.statuses.${job.status}`, job.status)}
                      </span>
                      {job.error_detail && (
                        <span className="block text-xs text-red-400 mt-0.5 max-w-[200px] truncate" title={job.error_detail}>
                          {job.error_detail}
                        </span>
                      )}
                      {job.status === 'APPROVED' && job.target_record_ids?.length && (
                        <span className="block text-xs text-green-400 mt-0.5">
                          {t('documents.recordsCreated', { count: job.target_record_ids.length })}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-400 text-xs whitespace-nowrap">{fmt(job.created_at)}</td>
                    <td className="px-4 py-2 text-slate-400 text-xs whitespace-nowrap">{fmt(job.completed_at)}</td>
                    <td className="px-4 py-2 text-right">
                      {['FAILED'].includes(job.status) && (
                        <button
                          className="text-xs text-red-400 hover:text-red-300 transition-colors"
                          onClick={() =>
                            financeApi.deleteDocumentJob(job.id).then(() =>
                              qc.invalidateQueries({ queryKey: ['document-jobs'] })
                            )
                          }
                        >
                          {t('common.delete')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
