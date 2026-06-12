import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '../../api/finance'
import type { BankStatementJob, BankStatementJobStatus } from '../../types/finance'

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

export default function BankStatementsPanel() {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [accountId, setAccountId] = useState('')
  const [file, setFile]           = useState<File | null>(null)
  const [uploadErr, setUploadErr] = useState<string | null>(null)

  const { data: accounts = [] } = useQuery({
    queryKey: ['finance-accounts'],
    queryFn: () => financeApi.getAccounts({ is_active: 'true' }),
  })

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['bank-statement-jobs'],
    queryFn: () => financeApi.getBankStatementJobs({ limit: 50 }),
    refetchInterval: (query) => {
      const data = query.state.data as BankStatementJob[] | undefined
      const hasActive = data?.some(j => j.status === 'PENDING' || j.status === 'PROCESSING')
      return hasActive ? 10_000 : false
    },
  })

  const upload = useMutation({
    mutationFn: () => {
      if (!file || !accountId) throw new Error('Select an account and file first.')
      const idem = `upload:${accountId}:${file.name}:${file.size}:${Date.now()}`
      return financeApi.uploadBankStatement(file, accountId, idem)
    },
    onSuccess: () => {
      setFile(null)
      setUploadErr(null)
      if (fileRef.current) fileRef.current.value = ''
      qc.invalidateQueries({ queryKey: ['bank-statement-jobs'] })
    },
    onError: (e: Error) => setUploadErr(e.message),
  })

  const requeue = useMutation({
    mutationFn: (id: string) => financeApi.requeueBankStatementJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank-statement-jobs'] }),
  })

  const inp = 'bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="space-y-6">

      {/* ── Upload section ── */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-200 mb-4">Upload Bank Statement</h2>
        <p className="text-xs text-slate-400 mb-4">
          Accepted formats: PDF, CSV, TXT (max 20 MB). The Ollama batch processor runs nightly at
          02:00 and will parse uploaded statements automatically.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <label className="block text-xs text-slate-400 mb-1">Account</label>
            <select
              className={`w-full ${inp}`}
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
            >
              <option value="">— select account —</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.account_name} ({a.institution_name})</option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-1">
            <label className="block text-xs text-slate-400 mb-1">File</label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.csv,.txt"
              className={`w-full ${inp} file:mr-2 file:py-0.5 file:px-2 file:rounded file:border-0 file:bg-slate-600 file:text-slate-200 file:text-xs cursor-pointer`}
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="flex items-end">
            <button
              className="w-full px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium transition-colors"
              disabled={!accountId || !file || upload.isPending}
              onClick={() => upload.mutate()}
            >
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>

        {uploadErr && (
          <p className="mt-2 text-xs text-red-400">{uploadErr}</p>
        )}
        {upload.isSuccess && (
          <p className="mt-2 text-xs text-green-400">
            Statement uploaded. Job queued — Ollama will process it tonight at 02:00.
          </p>
        )}
      </div>

      {/* ── Jobs table ── */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Processing Jobs</h2>
          <button
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
            onClick={() => qc.invalidateQueries({ queryKey: ['bank-statement-jobs'] })}
          >
            Refresh
          </button>
        </div>

        {isLoading && (
          <p className="text-sm text-slate-400 px-5 py-6">Loading…</p>
        )}

        {!isLoading && jobs.length === 0 && (
          <p className="text-sm text-slate-400 px-5 py-6">
            No jobs yet. Upload a statement above to get started.
          </p>
        )}

        {!isLoading && jobs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 border-b border-slate-700">
                  <th className="px-4 py-2 text-left font-medium">File</th>
                  <th className="px-4 py-2 text-left font-medium">Account</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Parsed</th>
                  <th className="px-4 py-2 text-right font-medium">Imported</th>
                  <th className="px-4 py-2 text-right font-medium">Skipped</th>
                  <th className="px-4 py-2 text-left font-medium">Uploaded</th>
                  <th className="px-4 py-2 text-left font-medium">Completed</th>
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
                          {job.status}
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
                        {job.status === 'FAILED' && (
                          <button
                            className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
                            disabled={requeue.isPending}
                            onClick={() => requeue.mutate(job.id)}
                          >
                            Requeue
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

      {/* ── Info box ── */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 text-xs text-slate-400 space-y-1">
        <p><span className="text-slate-200 font-medium">How it works:</span> After uploading, the Ollama AI batch processor runs at 02:00 each morning.</p>
        <p>It downloads the file, extracts transaction data using the local <span className="text-slate-200">llama3.2</span> model, and writes parsed transactions to Finance → Transactions with <span className="text-slate-200">is_pending_review = true</span>.</p>
        <p>Review and confirm parsed transactions in the Transactions tab. To process immediately, run the batch manually from PowerShell:</p>
        <code className="block bg-slate-900 rounded px-3 py-1.5 text-slate-300 mt-1">
          Start-ScheduledTask -TaskName "JAG-Ollama-Batch"
        </code>
      </div>

    </div>
  )
}
