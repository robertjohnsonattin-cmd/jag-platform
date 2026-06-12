import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '../../api/finance'
import { fmtTTD, fmtDate } from '../../lib/entities'

const CATEGORY_LABELS: Record<string, string> = {
  SALARY: 'Salary', DIVIDEND: 'Dividend', RENTAL_INCOME: 'Rental Income',
  INTEREST_INCOME: 'Interest', TRANSFER_IN: 'Transfer In',
  OPERATING_EXPENSE: 'Operating Exp.', PAYROLL: 'Payroll', TAX_PAYMENT: 'Tax',
  LOAN_REPAYMENT: 'Loan Repayment', INVESTMENT_PURCHASE: 'Investment Buy',
  INVESTMENT_SALE: 'Investment Sell', TRANSFER_OUT: 'Transfer Out',
  PERSONAL_EXPENSE: 'Personal', UTILITIES: 'Utilities', INSURANCE: 'Insurance',
  ENTERTAINMENT: 'Entertainment', TRAVEL: 'Travel', MEDICAL: 'Medical',
  EDUCATION: 'Education', CHARITY: 'Charity', UNCLASSIFIED: 'Unclassified',
}

const CREDIT_CATEGORIES = new Set([
  'SALARY', 'DIVIDEND', 'RENTAL_INCOME', 'INTEREST_INCOME', 'TRANSFER_IN',
  'INVESTMENT_SALE',
])

export default function TransactionsPanel() {
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
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(0) }}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(0) }}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(0) }}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        {(dateFrom || dateTo || category) && (
          <div className="flex items-end">
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); setCategory(''); setPage(0) }}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-white border border-slate-600 rounded transition-colors"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {isLoading && <p className="text-slate-400 text-sm py-4">Loading…</p>}
      {error && <p className="text-red-400 text-sm">Failed to load transactions.</p>}

      {!isLoading && txns.length === 0 && (
        <p className="text-slate-400 text-sm py-4">No transactions found.</p>
      )}

      {txns.length > 0 && (
        <div className="rounded-lg overflow-hidden border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-left px-4 py-2">Description</th>
                <th className="text-left px-4 py-2">Category</th>
                <th className="text-left px-4 py-2">CCY</th>
                <th className="text-right px-4 py-2">Amount</th>
                <th className="text-center px-4 py-2">Rec.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {txns.map((t) => {
                const amt = parseFloat(t.amount)
                const isCredit = amt > 0
                return (
                  <tr key={t.id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">
                      {fmtDate(t.transaction_date)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-100 max-w-xs truncate">
                      {t.merchant_name ?? t.description}
                      {t.is_pending_review && (
                        <span className="ml-2 text-xs text-amber-400 border border-amber-400/40 rounded px-1">review</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        CREDIT_CATEGORIES.has(t.category)
                          ? 'bg-green-900/50 text-green-300'
                          : 'bg-slate-700 text-slate-400'
                      }`}>
                        {CATEGORY_LABELS[t.category] ?? t.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-400">{t.currency}</td>
                    <td className={`px-4 py-2.5 text-right font-mono font-medium ${isCredit ? 'text-green-400' : 'text-red-400'}`}>
                      {isCredit ? '+' : ''}{fmtTTD(t.amount_ttd ?? t.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => toggleReconcile({ id: t.id, is_reconciled: !t.is_reconciled })}
                        title={t.is_reconciled ? 'Mark unreconciled' : 'Mark reconciled'}
                        className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                          t.is_reconciled
                            ? 'text-green-400 hover:text-green-300'
                            : 'text-slate-600 hover:text-slate-400'
                        }`}
                      >
                        {t.is_reconciled ? '✓' : '–'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="flex justify-between items-center mt-4">
        <button
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
          className="px-3 py-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-30 border border-slate-600 rounded transition-colors"
        >
          ← Previous
        </button>
        <span className="text-xs text-slate-500">Page {page + 1}</span>
        <button
          disabled={txns.length < PAGE_SIZE}
          onClick={() => setPage((p) => p + 1)}
          className="px-3 py-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-30 border border-slate-600 rounded transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  )
}
