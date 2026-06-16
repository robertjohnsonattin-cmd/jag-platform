import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { financeApi } from '../../api/finance'
import { fmtTTD, fmtDate } from '../../lib/entities'

const CATEGORY_KEYS = [
  'SALARY','DIVIDEND','RENTAL_INCOME','INTEREST_INCOME','TRANSFER_IN',
  'OPERATING_EXPENSE','PAYROLL','TAX_PAYMENT','LOAN_REPAYMENT','INVESTMENT_PURCHASE',
  'INVESTMENT_SALE','TRANSFER_OUT','PERSONAL_EXPENSE','UTILITIES','INSURANCE',
  'ENTERTAINMENT','TRAVEL','MEDICAL','EDUCATION','CHARITY','UNCLASSIFIED',
]

const CREDIT_CATEGORIES = new Set([
  'SALARY', 'DIVIDEND', 'RENTAL_INCOME', 'INTEREST_INCOME', 'TRANSFER_IN', 'INVESTMENT_SALE',
])

export default function TransactionsPanel() {
  const { t } = useTranslation()
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50
  const qc = useQueryClient()

  const { data: txns = [], isLoading, error } = useQuery({
    queryKey: ['finance', 'transactions', dateFrom, dateTo, category, page],
    queryFn: () =>
      financeApi.getTransactions({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        category: category || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  })

  const { mutate: toggleReconcile } = useMutation({
    mutationFn: ({ id, is_reconciled }: { id: string; is_reconciled: boolean }) =>
      financeApi.reconcileTransaction(id, { is_reconciled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['finance', 'transactions'] }),
  })

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('common.from')}</label>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0) }}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('common.to')}</label>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0) }}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('common.category')}</label>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0) }}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">{t('finance.transactions.allCategories')}</option>
            {CATEGORY_KEYS.map(k => (
              <option key={k} value={k}>{t(`dashboard.categories.${k}`, k)}</option>
            ))}
          </select>
        </div>
        {(dateFrom || dateTo || category) && (
          <div className="flex items-end">
            <button onClick={() => { setDateFrom(''); setDateTo(''); setCategory(''); setPage(0) }}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-white border border-slate-600 rounded transition-colors">
              {t('finance.transactions.clear')}
            </button>
          </div>
        )}
      </div>

      {isLoading && <p className="text-slate-400 text-sm py-4">{t('common.loading')}</p>}
      {error && <p className="text-red-400 text-sm">{t('finance.transactions.failedLoad')}</p>}

      {!isLoading && txns.length === 0 && (
        <p className="text-slate-400 text-sm py-4">{t('finance.transactions.noTransactions')}</p>
      )}

      {txns.length > 0 && (
        <div className="rounded-lg overflow-hidden border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2">{t('finance.transactions.colDate')}</th>
                <th className="text-left px-4 py-2">{t('finance.transactions.colDescription')}</th>
                <th className="text-left px-4 py-2">{t('finance.transactions.colCategory')}</th>
                <th className="text-left px-4 py-2">{t('finance.transactions.colCcy')}</th>
                <th className="text-right px-4 py-2">{t('finance.transactions.colAmount')}</th>
                <th className="text-center px-4 py-2">{t('finance.transactions.colRec')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {txns.map((txn) => {
                const amt = parseFloat(txn.amount)
                const isCredit = amt > 0
                return (
                  <tr key={txn.id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{fmtDate(txn.transaction_date)}</td>
                    <td className="px-4 py-2.5 text-slate-100 max-w-xs truncate">
                      {txn.merchant_name ?? txn.description}
                      {txn.is_pending_review && (
                        <span className="ml-2 text-xs text-amber-400 border border-amber-400/40 rounded px-1">{t('finance.transactions.review')}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        CREDIT_CATEGORIES.has(txn.category) ? 'bg-green-900/50 text-green-300' : 'bg-slate-700 text-slate-400'
                      }`}>
                        {t(`dashboard.categories.${txn.category}`, txn.category)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-400">{txn.currency}</td>
                    <td className={`px-4 py-2.5 text-right font-mono font-medium ${isCredit ? 'text-green-400' : 'text-red-400'}`}>
                      {isCredit ? '+' : ''}{fmtTTD(txn.amount_ttd ?? txn.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => toggleReconcile({ id: txn.id, is_reconciled: !txn.is_reconciled })}
                        title={txn.is_reconciled ? t('finance.transactions.markUnreconciled') : t('finance.transactions.markReconciled')}
                        className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                          txn.is_reconciled ? 'text-green-400 hover:text-green-300' : 'text-slate-600 hover:text-slate-400'
                        }`}
                      >
                        {txn.is_reconciled ? '✓' : '–'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-between items-center mt-4">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
          className="px-3 py-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-30 border border-slate-600 rounded transition-colors">
          {t('common.prev')}
        </button>
        <span className="text-xs text-slate-500">{t('common.page')} {page + 1}</span>
        <button disabled={txns.length < PAGE_SIZE} onClick={() => setPage((p) => p + 1)}
          className="px-3 py-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-30 border border-slate-600 rounded transition-colors">
          {t('common.next')}
        </button>
      </div>
    </div>
  )
}
