import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'

type Row = Record<string, unknown>

const fmtTTD = (n: unknown) =>
  `TT$${Number(n ?? 0).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (s: unknown) => (s ? new Date(String(s)).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

const periodLabel = (p: Row) =>
  `${p['unit_number'] ? `Unit ${String(p['unit_number'])}` : '—'} · ${String(p['tenant_name'] ?? '')} · ${String(p['period_month'])}/${String(p['period_year'])}`

export default function PropertiesReconciliationPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [manualPick, setManualPick] = useState<Record<string, string>>({})

  const { data: cand, isLoading } = useQuery({
    queryKey: ['reconciliation-candidates'],
    queryFn: () => tenancyApi.getReconciliationCandidates(),
  })
  const { data: matches = [] } = useQuery({
    queryKey: ['reconciliation-matches'],
    queryFn: () => tenancyApi.getReconciliationMatches(),
  })

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['reconciliation-candidates'] })
    void qc.invalidateQueries({ queryKey: ['reconciliation-matches'] })
  }

  const matchMut = useMutation({
    mutationFn: ({ rentScheduleId, bankTxnId }: { rentScheduleId: string; bankTxnId: string }) =>
      tenancyApi.matchRentBank(rentScheduleId, bankTxnId),
    onSuccess: () => { setExpanded(null); invalidateAll() },
  })
  const autoMut = useMutation({
    mutationFn: () => tenancyApi.autoMatchRentBank(),
    onSuccess: () => invalidateAll(),
  })
  const unmatchMut = useMutation({
    mutationFn: (id: string) => tenancyApi.unmatchRentBank(id),
    onSuccess: () => invalidateAll(),
  })

  const credits = cand?.bank_credits ?? []
  const periods = cand?.rent_periods ?? []
  const suggestions = cand?.suggestions ?? []

  const periodById = new Map(periods.map(p => [String(p['id']), p]))
  const suggestionsFor = (bankTxnId: string) => suggestions.filter(s => s.bank_txn_id === bankTxnId)

  return (
    <div className="space-y-6">
      {/* Phase-1 notice + toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="text-xs text-slate-400 bg-slate-800 border border-slate-700 rounded px-3 py-1.5">
          {t('tenancy.recon.linkOnlyNote', 'Link-only: matching records a reconciliation link and marks the bank line reconciled. It does not change rent status or notify the tenant.')}
        </div>
        <button onClick={() => autoMut.mutate()} disabled={autoMut.isPending || credits.length === 0}
          className="ml-auto px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded">
          {autoMut.isPending ? t('common.saving', 'Working…') : t('tenancy.recon.autoMatch', 'Auto-match all')}
        </button>
      </div>

      {autoMut.data && (
        <p className="text-xs text-green-400">
          {t('tenancy.recon.autoResult', 'Auto-matched {{matched}} · {{ambiguous}} ambiguous (need manual) · {{failed}} failed', {
            matched: autoMut.data.matched, ambiguous: autoMut.data.ambiguous, failed: autoMut.data.failed,
          })}
        </p>
      )}

      {/* Unmatched bank credits */}
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-2">
          {t('tenancy.recon.unmatchedCredits', 'Unmatched bank credits')}
          <span className="text-slate-500 font-normal ml-1">({credits.length})</span>
        </h3>
        {isLoading && <p className="text-sm text-slate-500">{t('common.loading', 'Loading…')}</p>}
        {!isLoading && credits.length === 0 && (
          <p className="text-sm text-slate-500 py-4 text-center">{t('tenancy.recon.allReconciled', 'No unreconciled bank credits. All caught up.')}</p>
        )}
        <div className="space-y-2">
          {credits.map((cr: Row) => {
            const id = String(cr['id'])
            const sugg = suggestionsFor(id)
            const isOpen = expanded === id
            return (
              <div key={id} className="bg-slate-800 border border-slate-700 rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono text-green-400">{fmtTTD(cr['amount_ttd'])}</span>
                      <span className="text-xs text-slate-500">{fmtDate(cr['transaction_date'])}</span>
                      {sugg.length > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded border bg-amber-900/40 text-amber-300 border-amber-700">
                          {t('tenancy.recon.suggested', '{{n}} suggested', { n: sugg.length })}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1 truncate">{String(cr['description'] ?? '')}</p>
                    {Boolean(cr['reference_number']) && <p className="text-xs text-slate-600 font-mono">{String(cr['reference_number'])}</p>}
                  </div>
                  <button onClick={() => setExpanded(isOpen ? null : id)}
                    className="text-xs text-blue-400 hover:text-blue-300 flex-shrink-0">
                    {isOpen ? t('common.close', 'Close') : t('tenancy.recon.match', 'Match')}
                  </button>
                </div>

                {/* Suggestions — one-click confirm */}
                {sugg.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sugg.map(s => {
                      const p = periodById.get(s.rent_schedule_id)
                      if (!p) return null
                      return (
                        <button key={s.rent_schedule_id}
                          onClick={() => matchMut.mutate({ rentScheduleId: s.rent_schedule_id, bankTxnId: id })}
                          disabled={matchMut.isPending}
                          className="text-xs px-2 py-1 rounded border bg-slate-700 border-slate-600 hover:border-green-500 hover:text-green-300 text-slate-200 transition-colors">
                          → {periodLabel(p)} · {fmtTTD(p['amount_due_ttd'])}
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Manual picker */}
                {isOpen && (
                  <div className="mt-3 border-t border-slate-700 pt-3 flex items-center gap-2">
                    <select className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100"
                      value={manualPick[id] ?? ''} onChange={e => setManualPick(m => ({ ...m, [id]: e.target.value }))}>
                      <option value="">{t('tenancy.recon.pickPeriod', '— Pick a rent period —')}</option>
                      {periods.map((p: Row) => (
                        <option key={String(p['id'])} value={String(p['id'])}>
                          {periodLabel(p)} · {fmtTTD(p['amount_due_ttd'])} · due {fmtDate(p['due_date'])}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => manualPick[id] && matchMut.mutate({ rentScheduleId: manualPick[id], bankTxnId: id })}
                      disabled={matchMut.isPending || !manualPick[id]}
                      className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded">
                      {t('tenancy.recon.link', 'Link')}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {matchMut.isError && (
          <p className="text-xs text-red-400 mt-2">
            {matchMut.error instanceof Error ? matchMut.error.message : t('tenancy.recon.matchFailed', 'Could not link. It may already be matched — refresh and retry.')}
          </p>
        )}
      </div>

      {/* Confirmed matches */}
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-2">
          {t('tenancy.recon.confirmedMatches', 'Confirmed matches')}
          <span className="text-slate-500 font-normal ml-1">({matches.length})</span>
        </h3>
        {matches.length === 0 && <p className="text-sm text-slate-500 py-2">{t('tenancy.recon.noMatches', 'No matches yet.')}</p>}
        <div className="space-y-1.5">
          {matches.map((m: Row) => (
            <div key={String(m['id'])} className="flex items-center justify-between gap-3 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-mono text-green-400">{fmtTTD(m['bank_amount_ttd'])}</span>
                  <span className="text-xs text-slate-500">{fmtDate(m['bank_txn_date'])}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${m['match_type'] === 'AUTO' ? 'bg-blue-900/40 text-blue-300 border-blue-700' : 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                    {String(m['match_type'])}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  {m['unit_number'] ? `Unit ${String(m['unit_number'])}` : '—'} · {String(m['tenant_name'] ?? '')} · due {fmtDate(m['due_date'])}
                </p>
              </div>
              <button onClick={() => unmatchMut.mutate(String(m['id']))} disabled={unmatchMut.isPending}
                className="text-xs text-slate-500 hover:text-red-400 transition-colors flex-shrink-0">
                {t('tenancy.recon.unmatch', 'Unmatch')}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
