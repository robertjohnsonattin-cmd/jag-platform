import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { glApi } from '../../api/gl'
import { entityName, fmtTTD, fmtDate } from '../../lib/entities'
import type { EntryStatus, JournalEntry } from '../../types/gl'

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
      {/* Left — entry list */}
      <div className="flex-1 min-w-0">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
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
