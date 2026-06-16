import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { glApi } from '../../api/gl'
import { fmtTTD } from '../../lib/entities'
import type { GlAccountType, TrialBalanceRow } from '../../types/gl'

const TYPE_ORDER: GlAccountType[] = ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','OTHER_INCOME','OTHER_EXPENSE']

const now = new Date()

export default function TrialBalance() {
  const { t } = useTranslation()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['gl', 'trial-balance', year, month],
    queryFn: () => glApi.getTrialBalance({ period_year: year, period_month: month }),
  })

  const activeRows = rows.filter(r => parseFloat(r.total_debit) > 0 || parseFloat(r.total_credit) > 0)
  const grouped = TYPE_ORDER.reduce<Partial<Record<GlAccountType, TrialBalanceRow[]>>>((acc, tp) => {
    const group = activeRows.filter(r => r.account_type === tp)
    if (group.length > 0) acc[tp] = group
    return acc
  }, {})

  const grandDebit  = rows.reduce((s, r) => s + parseFloat(r.total_debit),  0)
  const grandCredit = rows.reduce((s, r) => s + parseFloat(r.total_credit), 0)
  const isBalanced  = Math.round(grandDebit * 100) === Math.round(grandCredit * 100)

  const monthNames = [1,2,3,4,5,6,7,8,9,10,11,12].map(m => t(`intercompany.months.${m}`))

  return (
    <div>
      {/* Period selector */}
      <div className="flex gap-3 mb-6 items-end">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('trialBalance.year')}</label>
          <input
            type="number"
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="w-24 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('trialBalance.month')}</label>
          <select
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {monthNames.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
        {!isLoading && rows.length > 0 && (
          <div className={`text-xs px-3 py-1.5 rounded border ${isBalanced ? 'border-green-700 text-green-400' : 'border-red-700 text-red-400'}`}>
            {isBalanced ? `✓ ${t('trialBalance.balanced')}` : `⚠ ${t('trialBalance.outOfBalance')}`}
          </div>
        )}
      </div>

      {isLoading && <p className="text-slate-400 text-sm">{t('common.loading')}</p>}
      {error   && <p className="text-red-400 text-sm">{t('trialBalance.failed')}</p>}

      {!isLoading && activeRows.length === 0 && (
        <p className="text-slate-400 text-sm">{t('trialBalance.noEntries')}</p>
      )}

      {activeRows.length > 0 && (
        <>
          <div className="space-y-6">
            {(Object.entries(grouped) as [GlAccountType, TrialBalanceRow[]][]).map(([type, typeRows]) => {
              const subtotalDr = typeRows.reduce((s, r) => s + parseFloat(r.total_debit),  0)
              const subtotalCr = typeRows.reduce((s, r) => s + parseFloat(r.total_credit), 0)
              return (
                <div key={type}>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
                    {t(`trialBalance.types.${type}`)}
                  </h3>
                  <div className="rounded-lg overflow-hidden border border-slate-700">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                          <th className="text-left px-4 py-2 w-24">{t('trialBalance.colCode')}</th>
                          <th className="text-left px-4 py-2">{t('trialBalance.colAccount')}</th>
                          <th className="text-right px-4 py-2">{t('trialBalance.colDebit')}</th>
                          <th className="text-right px-4 py-2">{t('trialBalance.colCredit')}</th>
                          <th className="text-right px-4 py-2">{t('trialBalance.colBalance')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700">
                        {typeRows.map(r => {
                          const balance = r.normal_balance === 'DEBIT'
                            ? parseFloat(r.net_debit)
                            : parseFloat(r.net_credit)
                          return (
                            <tr key={r.account_id} className="hover:bg-slate-700/30">
                              <td className="px-4 py-2.5 font-mono text-slate-500 text-xs">{r.account_code}</td>
                              <td className="px-4 py-2.5 text-slate-100">{r.account_name}</td>
                              <td className="px-4 py-2.5 text-right font-mono text-blue-400 text-xs">
                                {parseFloat(r.total_debit) > 0 ? fmtTTD(r.total_debit) : ''}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-green-400 text-xs">
                                {parseFloat(r.total_credit) > 0 ? fmtTTD(r.total_credit) : ''}
                              </td>
                              <td className={`px-4 py-2.5 text-right font-mono font-medium text-xs ${balance >= 0 ? 'text-slate-100' : 'text-red-400'}`}>
                                {fmtTTD(Math.abs(balance))}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot className="border-t border-slate-600 bg-slate-700/20 text-xs text-slate-400 font-semibold">
                        <tr>
                          <td colSpan={2} className="px-4 py-2">{t('trialBalance.subtotal')}</td>
                          <td className="px-4 py-2 text-right font-mono text-blue-300">{fmtTTD(subtotalDr)}</td>
                          <td className="px-4 py-2 text-right font-mono text-green-300">{fmtTTD(subtotalCr)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-6 rounded-lg border border-slate-600 bg-slate-800 p-4">
            <div className="flex justify-between text-sm font-semibold">
              <span className="text-slate-300">{t('trialBalance.grandTotal')}</span>
              <div className="flex gap-8">
                <span className="font-mono text-blue-300">{fmtTTD(grandDebit)} {t('trialBalance.dr')}</span>
                <span className="font-mono text-green-300">{fmtTTD(grandCredit)} {t('trialBalance.cr')}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
