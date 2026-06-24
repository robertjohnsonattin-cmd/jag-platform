import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { financeApi } from '../../api/finance'
import { fmtTTD, fmtDate, ENTITY_NAMES } from '../../lib/entities'
import type { FinTransaction } from '../../types/finance'

const CATEGORY_KEYS = [
  'SALARY','DIVIDEND','RENTAL_INCOME','INTEREST_INCOME','TRANSFER_IN',
  'OPERATING_EXPENSE','PAYROLL','TAX_PAYMENT','LOAN_REPAYMENT','INVESTMENT_PURCHASE',
  'INVESTMENT_SALE','TRANSFER_OUT','PERSONAL_EXPENSE','UTILITIES','INSURANCE',
  'ENTERTAINMENT','TRAVEL','MEDICAL','EDUCATION','CHARITY',
  'GROCERIES','FUEL','DINING','HARDWARE','LOAN_PAYMENT',
  'UNCLASSIFIED',
]

const CREDIT_CATEGORIES = new Set([
  'SALARY', 'DIVIDEND', 'RENTAL_INCOME', 'INTEREST_INCOME', 'TRANSFER_IN', 'INVESTMENT_SALE',
])

const ENTITY_OPTIONS = Object.entries(ENTITY_NAMES)
  .filter(([id]) => id !== '00000000-0000-0000-0000-000000000000')
  .map(([id, name]) => ({ id, name }))

function ReviewModal({ txn, onClose }: { txn: FinTransaction; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [category, setCategory] = useState(txn.category ?? 'UNCLASSIFIED')
  const [subcategory, setSubcategory] = useState(txn.subcategory ?? '')
  const [merchantName, setMerchantName] = useState(txn.merchant_name ?? '')
  const [entityId, setEntityId] = useState(txn.entity_id ?? '')
  const [projectRef, setProjectRef] = useState(txn.project_ref ?? '')
  const [propertyRef, setPropertyRef] = useState(txn.property_ref ?? '')
  const [costCentre, setCostCentre] = useState(txn.cost_centre ?? '')
  const [billable, setBillable] = useState(txn.billable ?? false)
  const [notes, setNotes] = useState(txn.notes ?? '')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>(txn.tags ?? [])

  const addTag = () => {
    const val = tagInput.trim()
    if (val && !tags.includes(val)) setTags([...tags, val])
    setTagInput('')
  }

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => financeApi.patchTransaction(txn.id, {
      category,
      subcategory: subcategory || null,
      merchant_name: merchantName || undefined,
      entity_id: entityId || null,
      project_ref: projectRef || null,
      property_ref: propertyRef || null,
      cost_centre: costCentre || null,
      billable,
      notes: notes || null,
      tags,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'transactions'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-slate-700">
          <h3 className="text-base font-semibold text-slate-100">Categorise Transaction</h3>
          <p className="text-xs text-slate-400 mt-1 truncate">{txn.description}</p>
          <p className="text-xs text-slate-500">{fmtDate(txn.transaction_date)} · {parseFloat(txn.amount) < 0 ? '' : '+'}{fmtTTD(txn.amount_ttd ?? txn.amount)}</p>
        </div>

        <div className="p-5 space-y-4">
          {/* Merchant */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Merchant / Payee</label>
            <input type="text" value={merchantName} onChange={(e) => setMerchantName(e.target.value)}
              placeholder={txn.description}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>

          {/* AI suggestion — from the bank-import review queue */}
          {txn.suggested_category && txn.suggested_category !== category && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-blue-700/40 bg-blue-900/20">
              <div className="text-xs text-blue-200">
                {t('finance.transactions.aiSuggests')}:{' '}
                <span className="font-medium">{txn.suggested_category}</span>
                {txn.confidence != null && (
                  <span className="text-blue-300/70"> · {Math.round(parseFloat(String(txn.confidence)) * 100)}%</span>
                )}
              </div>
              <button type="button" onClick={() => setCategory(txn.suggested_category!)}
                className="text-xs px-2 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors shrink-0">
                {t('finance.transactions.accept')}
              </button>
            </div>
          )}

          {/* Category + Subcategory */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500">
                {CATEGORY_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Subcategory</label>
              <input type="text" value={subcategory} onChange={(e) => setSubcategory(e.target.value)}
                placeholder="e.g. Vehicle, Generator…"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
          </div>

          {/* Entity */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Entity</label>
            <select value={entityId} onChange={(e) => setEntityId(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">— None —</option>
              {ENTITY_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
            </select>
          </div>

          {/* Project + Property */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Project</label>
              <input type="text" value={projectRef} onChange={(e) => setProjectRef(e.target.value)}
                placeholder="e.g. Debe Highway"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Property</label>
              <input type="text" value={propertyRef} onChange={(e) => setPropertyRef(e.target.value)}
                placeholder="e.g. 62 Ariapita Ave"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
          </div>

          {/* Cost Centre + Billable */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Cost Centre</label>
              <input type="text" value={costCentre} onChange={(e) => setCostCentre(e.target.value)}
                placeholder="e.g. Site Operations"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)}
                  className="w-4 h-4 rounded accent-blue-500" />
                <span className="text-sm text-slate-300">Billable to client</span>
              </label>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Tags</label>
            <div className="flex gap-2 mb-2">
              <input type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                placeholder="Type a tag and press Enter"
                className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <button type="button" onClick={addTag}
                className="px-3 py-2 text-xs bg-slate-600 hover:bg-slate-500 text-white rounded transition-colors">Add</button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 text-xs bg-blue-900/40 text-blue-300 border border-blue-700/40 rounded-full px-2 py-0.5">
                    {tag}
                    <button onClick={() => setTags(tags.filter(tg => tg !== tag))} className="hover:text-white">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="Any additional context…"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
          </div>
        </div>

        <div className="p-5 border-t border-slate-700 flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white border border-slate-600 rounded transition-colors">
            {t('common.cancel')}
          </button>
          <button onClick={() => save()} disabled={isPending}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded transition-colors">
            {isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TransactionsPanel() {
  const { t } = useTranslation()
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [category, setCategory] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [page, setPage] = useState(0)
  const [reviewing, setReviewing] = useState<FinTransaction | null>(null)
  const PAGE_SIZE = 50
  const qc = useQueryClient()

  const { data: txns = [], isLoading, error } = useQuery({
    queryKey: ['finance', 'transactions', dateFrom, dateTo, category, entityFilter, page],
    queryFn: () =>
      financeApi.getTransactions({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        category: category || undefined,
        entity_id: entityFilter || undefined,
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
      {reviewing && <ReviewModal txn={reviewing} onClose={() => setReviewing(null)} />}

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
            <option value="">All categories</option>
            {CATEGORY_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Entity</label>
          <select value={entityFilter} onChange={(e) => { setEntityFilter(e.target.value); setPage(0) }}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">All entities</option>
            {ENTITY_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
          </select>
        </div>
        {(dateFrom || dateTo || category || entityFilter) && (
          <div className="flex items-end">
            <button onClick={() => { setDateFrom(''); setDateTo(''); setCategory(''); setEntityFilter(''); setPage(0) }}
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
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2">{t('finance.transactions.colDate')}</th>
                <th className="text-left px-4 py-2">{t('finance.transactions.colDescription')}</th>
                <th className="text-left px-4 py-2">{t('finance.transactions.colCategory')}</th>
                <th className="text-left px-4 py-2">Entity / Project</th>
                <th className="text-left px-4 py-2">{t('finance.transactions.colCcy')}</th>
                <th className="text-right px-4 py-2">{t('finance.transactions.colAmount')}</th>
                <th className="text-center px-4 py-2">{t('finance.transactions.colRec')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {txns.map((txn) => {
                const amt = parseFloat(txn.amount)
                const isCredit = amt > 0
                const entityLabel = txn.entity_id ? ENTITY_NAMES[txn.entity_id] ?? txn.entity_id.slice(0, 8) : null
                return (
                  <tr key={txn.id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{fmtDate(txn.transaction_date)}</td>
                    <td className="px-4 py-2.5 text-slate-100 max-w-xs">
                      <div className="truncate">{txn.merchant_name ?? txn.description}</div>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {txn.is_pending_review && (
                          <button onClick={() => setReviewing(txn)}
                            className="text-xs text-amber-400 border border-amber-400/40 rounded px-1 hover:bg-amber-400/10 transition-colors">
                            review
                          </button>
                        )}
                        {txn.subcategory && (
                          <span className="text-xs text-slate-500">{txn.subcategory}</span>
                        )}
                        {txn.billable && (
                          <span className="text-xs text-emerald-400 border border-emerald-400/30 rounded px-1">billable</span>
                        )}
                        {(txn.tags ?? []).map(tag => (
                          <span key={tag} className="text-xs text-blue-400/70"># {tag}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span onClick={() => setReviewing(txn)}
                        className={`text-xs px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80 transition-opacity ${
                          CREDIT_CATEGORIES.has(txn.category) ? 'bg-green-900/50 text-green-300' : 'bg-slate-700 text-slate-400'
                        }`}>
                        {txn.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">
                      {entityLabel && <div className="font-medium text-slate-300">{entityLabel}</div>}
                      {txn.project_ref && <div className="text-slate-500 truncate max-w-[120px]">{txn.project_ref}</div>}
                      {txn.cost_centre && <div className="text-slate-500 truncate max-w-[120px]">{txn.cost_centre}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400">{txn.currency}</td>
                    <td className={`px-4 py-2.5 text-right font-mono font-medium ${isCredit ? 'text-green-400' : 'text-red-400'}`}>
                      {isCredit ? '+' : ''}{fmtTTD(txn.amount_ttd ?? txn.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => toggleReconcile({ id: txn.id, is_reconciled: !txn.is_reconciled })}
                        title={txn.is_reconciled ? 'Mark unreconciled' : 'Mark reconciled'}
                        className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                          txn.is_reconciled ? 'text-green-400 hover:text-green-300' : 'text-slate-600 hover:text-slate-400'
                        }`}>
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
