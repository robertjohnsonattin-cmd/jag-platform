import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { glApi } from '../../api/gl'
import { ENTITY_NAMES, entityName, fmtTTD, fmtDate } from '../../lib/entities'
import type { EntryStatus, JournalEntry } from '../../types/gl'
import type { GlAccount } from '../../types/gl'

// ── New Journal Entry Modal ────────────────────────────────────────────────────

const ENTITY_OPTIONS = Object.entries(ENTITY_NAMES)
  .filter(([id]) => id !== '00000000-0000-0000-0000-000000000000')
  .map(([id, name]) => ({ id, name }))

interface Line { gl_account_id: string; description: string; side: 'dr' | 'cr'; amount: string }

function NewEntryModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [entityId, setEntityId]   = useState('')
  const [date, setDate]           = useState(new Date().toISOString().slice(0, 10))
  const [description, setDesc]    = useState('')
  const [reference, setRef]       = useState('')
  const [lines, setLines]         = useState<Line[]>([
    { gl_account_id: '', description: '', side: 'dr', amount: '' },
    { gl_account_id: '', description: '', side: 'cr', amount: '' },
  ])
  const [submitErr, setSubmitErr] = useState('')

  const { data: accounts = [] } = useQuery<GlAccount[]>({
    queryKey: ['gl-accounts', entityId],
    queryFn: () => glApi.getAccounts({ owner_entity_id: entityId, is_active: 'true' }),
    enabled: !!entityId,
    staleTime: 60_000,
  })

  const setLine = useCallback((i: number, patch: Partial<Line>) =>
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l)), [])

  const addLine = () => setLines(ls => [...ls, { gl_account_id: '', description: '', side: 'cr', amount: '' }])
  const removeLine = (i: number) => setLines(ls => ls.filter((_, idx) => idx !== i))

  const totalDr = lines.filter(l => l.side === 'dr').reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
  const totalCr = lines.filter(l => l.side === 'cr').reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
  const balanced = Math.abs(totalDr - totalCr) < 0.005 && totalDr > 0

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      if (!entityId)    throw new Error('Select an entity.')
      if (!description) throw new Error('Description is required.')
      if (!balanced)    throw new Error(`Entry is not balanced — Dr ${totalDr.toFixed(2)} ≠ Cr ${totalCr.toFixed(2)}`)
      for (const l of lines) {
        if (!l.gl_account_id) throw new Error('All lines must have an account selected.')
        if (!(parseFloat(l.amount) > 0)) throw new Error('All lines must have an amount greater than zero.')
      }
      return glApi.createEntry({
        owner_entity_id: entityId,
        entry_date: date,
        description,
        reference: reference || undefined,
        idempotency_key: `manual-${Date.now()}`,
        lines: lines.map((l, i) => ({
          gl_account_id: l.gl_account_id,
          line_number: i + 1,
          description: l.description || undefined,
          debit_ttd:  l.side === 'dr' ? parseFloat(l.amount) : 0,
          credit_ttd: l.side === 'cr' ? parseFloat(l.amount) : 0,
        })),
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gl', 'entries'] })
      onClose()
    },
    onError: (e: unknown) => setSubmitErr((e as Error).message),
  })

  const cls = 'bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 w-full'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">New Journal Entry</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="space-y-3 mb-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Entity *</label>
              <select value={entityId} onChange={e => setEntityId(e.target.value)} className={cls}>
                <option value="">— select entity —</option>
                {ENTITY_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Date *</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Description *</label>
            <input value={description} onChange={e => setDesc(e.target.value)} className={cls} placeholder="e.g. Gain on disposal of PDT 761" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Reference (optional)</label>
            <input value={reference} onChange={e => setRef(e.target.value)} className={cls} placeholder="e.g. INV-001" />
          </div>
        </div>

        {/* Lines */}
        <div className="mb-3">
          <div className="grid grid-cols-[1fr_1fr_80px_100px_28px] gap-1.5 text-xs text-slate-400 mb-1 px-1">
            <span>Account</span><span>Line description</span><span>Dr/Cr</span><span>Amount (TTD)</span><span></span>
          </div>
          <div className="space-y-1.5">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_80px_100px_28px] gap-1.5 items-center">
                <select value={l.gl_account_id} onChange={e => setLine(i, { gl_account_id: e.target.value })} className={cls} disabled={!entityId}>
                  <option value="">{entityId ? '— account —' : '← pick entity first'}</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>)}
                </select>
                <input value={l.description} onChange={e => setLine(i, { description: e.target.value })} className={cls} placeholder="optional" />
                <select value={l.side} onChange={e => setLine(i, { side: e.target.value as 'dr' | 'cr' })} className={cls}>
                  <option value="dr">Dr</option>
                  <option value="cr">Cr</option>
                </select>
                <input type="number" min="0" step="0.01" value={l.amount} onChange={e => setLine(i, { amount: e.target.value })} className={cls} placeholder="0.00" />
                <button onClick={() => removeLine(i)} disabled={lines.length <= 2}
                  className="text-slate-500 hover:text-red-400 disabled:opacity-20 text-base leading-none transition-colors">×</button>
              </div>
            ))}
          </div>
          <button onClick={addLine} className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors">+ Add line</button>
        </div>

        {/* Totals */}
        <div className={`flex justify-end gap-6 text-xs px-1 py-2 rounded mb-3 ${balanced ? 'bg-green-900/20 text-green-300' : 'bg-red-900/20 text-red-400'}`}>
          <span>Dr: {totalDr.toLocaleString('en-TT', { minimumFractionDigits: 2 })}</span>
          <span>Cr: {totalCr.toLocaleString('en-TT', { minimumFractionDigits: 2 })}</span>
          <span className="font-medium">{balanced ? '✓ Balanced' : 'Not balanced'}</span>
        </div>

        {submitErr && <p className="text-red-400 text-xs mb-3">{submitErr}</p>}

        <div className="flex gap-3">
          <button onClick={() => { setSubmitErr(''); mutate() }} disabled={isPending}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? 'Saving…' : 'Save as Draft'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
        </div>
        <p className="text-xs text-slate-500 mt-2 text-center">Saved as DRAFT — click Post in the entry detail to commit to the ledger</p>
      </div>
    </div>
  )
}

const STATUS_STYLES: Record<EntryStatus, string> = {
  DRAFT:  'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  POSTED: 'bg-green-900/50 text-green-300 border-green-700',
  VOID:   'bg-slate-700 text-slate-500 border-slate-600',
}

export default function JournalEntries() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<JournalEntry | null>(null)
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [page, setPage]         = useState(0)
  const [voidReason, setVoidReason] = useState('')
  const [showVoidModal, setShowVoidModal] = useState(false)
  const [showNewEntry, setShowNewEntry]   = useState(false)
  const PAGE_SIZE = 50

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['gl', 'entries', status, dateFrom, dateTo, page],
    queryFn: () => glApi.getEntries({
      status: status || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
  })

  const { data: detail } = useQuery({
    queryKey: ['gl', 'entry', selected?.id],
    queryFn: () => glApi.getEntry(selected!.id),
    enabled: !!selected,
  })

  const { mutate: postEntry, isPending: posting } = useMutation({
    mutationFn: (id: string) => glApi.postEntry(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gl', 'entries'] })
      void qc.invalidateQueries({ queryKey: ['gl', 'entry', selected?.id] })
    },
  })

  const { mutate: voidEntry, isPending: voiding } = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => glApi.voidEntry(id, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gl', 'entries'] })
      void qc.invalidateQueries({ queryKey: ['gl', 'entry', selected?.id] })
      setShowVoidModal(false)
      setVoidReason('')
    },
  })

  return (
    <div className="flex gap-6 h-full">
      {showNewEntry && <NewEntryModal onClose={() => setShowNewEntry(false)} />}

      {/* Left — entry list */}
      <div className="flex-1 min-w-0">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4 items-end justify-between">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.status')}</label>
            <select
              value={status}
              onChange={e => { setStatus(e.target.value); setPage(0) }}
              className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">{t('journalEntries.all')}</option>
              <option value="DRAFT">{t('journalEntries.draft')}</option>
              <option value="POSTED">{t('journalEntries.posted')}</option>
              <option value="VOID">{t('journalEntries.void')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.from')}</label>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }}
              className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.to')}</label>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }}
              className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <button onClick={() => setShowNewEntry(true)}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors whitespace-nowrap self-end">
            + New Entry
          </button>
        </div>

        {isLoading && <p className="text-slate-400 text-sm">{t('common.loading')}</p>}
        {!isLoading && entries.length === 0 && <p className="text-slate-400 text-sm">{t('journalEntries.noEntries')}</p>}

        {entries.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-2">{t('journalEntries.colDate')}</th>
                  <th className="text-left px-4 py-2">{t('journalEntries.colRef')}</th>
                  <th className="text-left px-4 py-2">{t('journalEntries.colDescription')}</th>
                  <th className="text-left px-4 py-2">{t('journalEntries.colEntity')}</th>
                  <th className="text-right px-4 py-2">{t('journalEntries.colDebit')}</th>
                  <th className="text-center px-4 py-2">{t('journalEntries.colStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {entries.map(e => (
                  <tr
                    key={e.id}
                    onClick={() => setSelected(e)}
                    className={`hover:bg-slate-700/30 transition-colors cursor-pointer ${selected?.id === e.id ? 'bg-slate-700/50' : ''}`}
                  >
                    <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap text-xs">{fmtDate(e.entry_date)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{e.reference ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-100 max-w-xs truncate">{e.description}</td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{entityName(e.owner_entity_id)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-300">{fmtTTD(e.total_debit_ttd)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_STYLES[e.status]}`}>{e.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-between items-center mt-4">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-30 border border-slate-600 rounded">
            {t('common.prev')}
          </button>
          <span className="text-xs text-slate-500">{t('common.page')} {page + 1}</span>
          <button disabled={entries.length < PAGE_SIZE} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-30 border border-slate-600 rounded">
            {t('common.next')}
          </button>
        </div>
      </div>

      {/* Right — detail panel */}
      {selected && (
        <div className="w-96 flex-shrink-0 bg-slate-800 rounded-lg border border-slate-700 p-4 self-start">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="text-xs text-slate-400">{fmtDate(selected.entry_date)}</p>
              <h3 className="font-semibold text-slate-100 mt-0.5">{selected.description}</h3>
              {selected.reference && <p className="text-xs text-slate-500 font-mono mt-0.5">{selected.reference}</p>}
            </div>
            <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_STYLES[selected.status]}`}>{selected.status}</span>
          </div>

          {detail?.lines && detail.lines.length > 0 && (
            <table className="w-full text-xs mb-4">
              <thead>
                <tr className="text-slate-500 border-b border-slate-700">
                  <th className="text-left pb-1">{t('journalEntries.colAccount')}</th>
                  <th className="text-right pb-1">{t('journalEntries.colDr')}</th>
                  <th className="text-right pb-1">{t('journalEntries.colCr')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {detail.lines.map(l => (
                  <tr key={l.id}>
                    <td className="py-1.5 text-slate-300">
                      <span className="font-mono text-slate-500 mr-1">{l.account_code}</span>
                      {l.account_name}
                    </td>
                    <td className="py-1.5 text-right font-mono text-blue-400">
                      {parseFloat(l.debit_ttd) > 0 ? fmtTTD(l.debit_ttd) : ''}
                    </td>
                    <td className="py-1.5 text-right font-mono text-green-400">
                      {parseFloat(l.credit_ttd) > 0 ? fmtTTD(l.credit_ttd) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-600 text-slate-400 font-semibold">
                <tr>
                  <td className="pt-2 text-xs">{t('journalEntries.colTotal')}</td>
                  <td className="pt-2 text-right font-mono">{fmtTTD(selected.total_debit_ttd)}</td>
                  <td className="pt-2 text-right font-mono">{fmtTTD(selected.total_credit_ttd)}</td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            {selected.status === 'DRAFT' && (
              <>
                <button
                  onClick={() => postEntry(selected.id)}
                  disabled={posting}
                  className="flex-1 px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs rounded transition-colors"
                >
                  {posting ? t('journalEntries.posting') : t('journalEntries.postEntry')}
                </button>
                <button
                  onClick={() => setShowVoidModal(true)}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded transition-colors"
                >
                  {t('journalEntries.voidEntry')}
                </button>
              </>
            )}
            {selected.status === 'POSTED' && (
              <button
                onClick={() => setShowVoidModal(true)}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded transition-colors"
              >
                {t('journalEntries.voidEntry')}
              </button>
            )}
          </div>

          {/* Void modal */}
          {showVoidModal && (
            <div className="mt-3 border border-red-800 rounded p-3 bg-red-950/30">
              <p className="text-xs text-red-400 mb-2 font-medium">{t('journalEntries.voidReason')}</p>
              <input
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                placeholder={t('journalEntries.voidReasonPlaceholder')}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100 mb-2 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => voidEntry({ id: selected.id, reason: voidReason })}
                  disabled={voiding || !voidReason.trim()}
                  className="flex-1 px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs rounded"
                >
                  {voiding ? t('journalEntries.voiding') : t('journalEntries.confirmVoid')}
                </button>
                <button onClick={() => setShowVoidModal(false)}
                  className="px-3 py-1.5 bg-slate-700 text-slate-300 text-xs rounded">
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
