import { useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { financeApi } from '../../api/finance'
import type { BankStatementJob, BankStatementJobStatus } from '../../types/finance'

type UploadState = 'idle' | 'uploading' | 'done' | 'error'

interface StagedFile {
  key: string
  file: File
  accountId: string
  state: UploadState
  errorMsg: string | null
}

const STATUS_STYLES: Record<BankStatementJobStatus, string> = {
  PENDING:    'bg-yellow-500/20 text-yellow-300',
  PROCESSING: 'bg-blue-500/20 text-blue-300',
  COMPLETE:   'bg-green-500/20 text-green-300',
  PARTIAL:    'bg-orange-500/20 text-orange-300',
  FAILED:     'bg-red-500/20 text-red-300',
}

function fmt(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('en-TT', { dateStyle: 'short', timeStyle: 'short' })
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const ALLOWED_EXTS = ['.pdf', '.csv', '.txt']

function isAllowed(f: File) {
  const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
  return ALLOWED_EXTS.includes(ext)
}

export default function BankStatementsPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)

  const [staged, setStaged]     = useState<StagedFile[]>([])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)

  const { data: accounts = [] } = useQuery({
    queryKey: ['finance-accounts'],
    queryFn: () => financeApi.getAccounts({ is_active: 'true' }),
  })

  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ['bank-statement-jobs'],
    queryFn: () => financeApi.getBankStatementJobs({ limit: 100 }),
    refetchInterval: (query) => {
      const data = query.state.data as BankStatementJob[] | undefined
      return data?.some(j => j.status === 'PENDING' || j.status === 'PROCESSING') ? 10_000 : false
    },
  })

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter(isAllowed)
    if (!arr.length) return
    setStaged(prev => {
      const existing = new Set(prev.map(s => s.file.name + s.file.size))
      const fresh = arr
        .filter(f => !existing.has(f.name + f.size))
        .map(f => ({
          key: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`,
          file: f,
          accountId: '',
          state: 'idle' as UploadState,
          errorMsg: null,
        }))
      return [...prev, ...fresh]
    })
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }, [addFiles])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(e.target.files)
    e.target.value = ''
  }

  const removeStaged = (key: string) =>
    setStaged(prev => prev.filter(s => s.key !== key))

  const setAccount = (key: string, accountId: string) =>
    setStaged(prev => prev.map(s => s.key === key ? { ...s, accountId } : s))

  const uploadAll = async () => {
    const ready = staged.filter(s => s.accountId && s.state === 'idle')
    if (!ready.length) return
    setUploading(true)

    await Promise.all(ready.map(async (s) => {
      setStaged(prev => prev.map(x => x.key === s.key ? { ...x, state: 'uploading' } : x))
      try {
        const idem = `upload:${s.accountId}:${s.file.name}:${s.file.size}:${Date.now()}`
        await financeApi.uploadBankStatement(s.file, s.accountId, idem)
        setStaged(prev => prev.map(x => x.key === s.key ? { ...x, state: 'done' } : x))
      } catch (e) {
        setStaged(prev => prev.map(x =>
          x.key === s.key ? { ...x, state: 'error', errorMsg: (e as Error).message } : x
        ))
      }
    }))

    setUploading(false)
    qc.invalidateQueries({ queryKey: ['bank-statement-jobs'] })
  }

  const clearDone = () => setStaged(prev => prev.filter(s => s.state !== 'done'))

  const readyCount   = staged.filter(s => s.accountId && s.state === 'idle').length
  const unassigned   = staged.filter(s => !s.accountId && s.state === 'idle').length
  const doneCount    = staged.filter(s => s.state === 'done').length
  const errorCount   = staged.filter(s => s.state === 'error').length

  const inp = 'bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="space-y-6">

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragging ? 'border-blue-400 bg-blue-500/10' : 'border-slate-600 hover:border-slate-500'
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
          onChange={onInputChange}
        />
        <p className="text-slate-300 text-sm font-medium">
          {dragging ? t('bankStatements.dropActive') : t('bankStatements.dropzone')}
        </p>
        <p className="text-slate-500 text-xs mt-1">{t('bankStatements.dropzoneHint')}</p>
      </div>

      {/* Staging queue */}
      {staged.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>{staged.length}</span>
              {unassigned > 0 && <span className="text-yellow-400">{unassigned} {t('bankStatements.needAccount')}</span>}
              {doneCount  > 0 && <span className="text-green-400">{doneCount} {t('bankStatements.uploaded')}</span>}
              {errorCount > 0 && <span className="text-red-400">{errorCount} {t('bankStatements.failed')}</span>}
            </div>
            <div className="flex items-center gap-2">
              {doneCount > 0 && (
                <button
                  className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
                  onClick={clearDone}
                >
                  {t('bankStatements.clearDone')}
                </button>
              )}
              <button
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-xs font-medium transition-colors"
                disabled={readyCount === 0 || uploading}
                onClick={uploadAll}
              >
                {uploading ? t('bankStatements.uploading') : `${t('bankStatements.upload')} ${readyCount > 0 ? readyCount : ''}`}
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-700/50">
            {staged.map(s => (
              <div key={s.key} className="px-4 py-2 flex items-center gap-3">
                <div className="w-5 flex-shrink-0 text-center">
                  {s.state === 'idle'      && <span className="text-slate-500 text-xs">○</span>}
                  {s.state === 'uploading' && <span className="text-blue-400 text-xs animate-pulse">↑</span>}
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
                  className={`w-52 flex-shrink-0 ${inp} ${!s.accountId && s.state === 'idle' ? 'border-yellow-600' : ''}`}
                  value={s.accountId}
                  disabled={s.state !== 'idle'}
                  onChange={e => setAccount(s.key, e.target.value)}
                >
                  <option value="">— {t('bankStatements.assignAccount')} —</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.account_name} · {a.institution_name}</option>
                  ))}
                </select>

                {s.state === 'idle' && (
                  <button
                    className="text-slate-500 hover:text-red-400 transition-colors text-sm flex-shrink-0"
                    onClick={() => removeStaged(s.key)}
                    title={t('bankStatements.remove')}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Jobs history */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">{t('bankStatements.processingHistory')}</h2>
          <button
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
            onClick={() => qc.invalidateQueries({ queryKey: ['bank-statement-jobs'] })}
          >
            {t('common.refresh')}
          </button>
        </div>

        {jobsLoading && (
          <p className="text-sm text-slate-400 px-5 py-6">{t('common.loading')}</p>
        )}

        {!jobsLoading && jobs.length === 0 && (
          <p className="text-sm text-slate-400 px-5 py-6">{t('bankStatements.noJobs')}</p>
        )}

        {!jobsLoading && jobs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 border-b border-slate-700">
                  <th className="px-4 py-2 text-left font-medium">{t('bankStatements.colFile')}</th>
                  <th className="px-4 py-2 text-left font-medium">{t('bankStatements.colAccount')}</th>
                  <th className="px-4 py-2 text-left font-medium">{t('bankStatements.colStatus')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('bankStatements.colParsed')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('bankStatements.colImported')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('bankStatements.colSkipped')}</th>
                  <th className="px-4 py-2 text-left font-medium">{t('bankStatements.colUploaded')}</th>
                  <th className="px-4 py-2 text-left font-medium">{t('bankStatements.colCompleted')}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {jobs.map(job => {
                  const acct = accounts.find(a => a.id === job.account_id)
                  return (
                    <tr key={job.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-2 text-slate-200 max-w-[180px] truncate" title={job.file_name}>
                        {job.file_name}
                      </td>
                      <td className="px-4 py-2 text-slate-300 text-xs">
                        {acct ? acct.account_name : job.account_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[job.status]}`}>
                          {t(`bankStatements.statuses.${job.status}`, job.status)}
                        </span>
                        {job.error_detail && (
                          <span className="block text-xs text-red-400 mt-0.5 max-w-[200px] truncate" title={job.error_detail}>
                            {job.error_detail}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-300">{job.rows_parsed ?? '—'}</td>
                      <td className="px-4 py-2 text-right text-green-400">{job.rows_imported ?? '—'}</td>
                      <td className="px-4 py-2 text-right text-slate-400">{job.rows_skipped ?? '—'}</td>
                      <td className="px-4 py-2 text-slate-400 text-xs whitespace-nowrap">{fmt(job.created_at)}</td>
                      <td className="px-4 py-2 text-slate-400 text-xs whitespace-nowrap">{fmt(job.completed_at)}</td>
                      <td className="px-4 py-2 text-right">
                        {['COMPLETE', 'PARTIAL', 'FAILED'].includes(job.status) && (
                          <button
                            className="text-xs text-red-400 hover:text-red-300 transition-colors"
                            onClick={() =>
                              financeApi.deleteBankStatementJob(job.id).then(() =>
                                qc.invalidateQueries({ queryKey: ['bank-statement-jobs'] })
                              )
                            }
                          >
                            {t('common.delete')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 text-xs text-slate-400 space-y-1">
        <p><span className="text-slate-200 font-medium">{t('bankStatements.howItWorks')}</span> {t('bankStatements.howItWorksDetail')}</p>
        <p>{t('bankStatements.howItWorksDetail2')}</p>
        <code className="block bg-slate-900 rounded px-3 py-1.5 text-slate-300 mt-1">
          Start-ScheduledTask -TaskName "JAG-Ollama-Batch"
        </code>
      </div>

    </div>
  )
}
