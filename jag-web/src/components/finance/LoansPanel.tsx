import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { financeApi } from '../../api/finance'
import { entityName, fmtTTD, fmtDate } from '../../lib/entities'
import type { LoanType, LoanBalanceHistory } from '../../types/finance'

const LOAN_TYPES: LoanType[] = ['MORTGAGE', 'CAR_LOAN', 'PERSONAL_LOAN', 'BUSINESS_LOAN', 'OVERDRAFT', 'OTHER']

const ENTITY_OPTIONS = [
  { id: '00000000-0000-0000-0001-000000000001', name: 'JAG Holdings' },
  { id: '00000000-0000-0000-0001-000000000002', name: 'JABCO' },
  { id: '00000000-0000-0000-0001-000000000003', name: 'JAG Properties' },
  { id: '00000000-0000-0000-0001-000000000004', name: 'JAG Entertainment' },
  { id: '00000000-0000-0000-0001-000000000005', name: 'JAG Finance' },
  { id: '00000000-0000-0000-0001-000000000006', name: 'DragonBridge' },
  { id: '00000000-0000-0000-0001-000000000008', name: 'Personal — Robert' },
  { id: '00000000-0000-0000-0001-000000000009', name: 'Isabella Johnson-Attin' },
  { id: '00000000-0000-0000-0001-000000000010', name: 'Phillip Ajack Johnson-Attin' },
  { id: '00000000-0000-0000-0001-000000000011', name: 'Brian Johnson-Attin' },
  { id: '00000000-0000-0000-0001-000000000012', name: 'Zhanghua Chang' },
  { id: '00000000-0000-0000-0001-000000000013', name: 'Theresa Johnson-Attin' },
]

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

function AddModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    owner_entity_id: ENTITY_OPTIONS[0].id,
    loan_type: 'MORTGAGE' as LoanType,
    lender_name: '',
    original_principal: '',
    outstanding_balance: '',
    interest_rate: '',
    interest_type: 'FIXED' as 'FIXED' | 'VARIABLE',
    currency: 'TTD',
    start_date: '',
    maturity_date: '',
    monthly_payment: '',
    notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => financeApi.createLoan({
      owner_entity_id: form.owner_entity_id,
      loan_type: form.loan_type,
      lender_name: form.lender_name,
      original_principal: Number(form.original_principal),
      outstanding_balance: Number(form.outstanding_balance),
      interest_rate: Number(form.interest_rate),
      interest_type: form.interest_type,
      currency: form.currency || 'TTD',
      start_date: form.start_date || undefined,
      maturity_date: form.maturity_date || undefined,
      monthly_payment: form.monthly_payment ? Number(form.monthly_payment) : undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('finance.loans.addTitle')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.entity')}</label>
            <select value={form.owner_entity_id} onChange={set('owner_entity_id')} className={cls}>
              {ENTITY_OPTIONS.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('common.type')}</label>
              <select value={form.loan_type} onChange={set('loan_type')} className={cls}>
                {LOAN_TYPES.map(tp => <option key={tp} value={tp}>{t(`finance.loans.loanTypes.${tp}`)}</option>)}
              </select>
            </div>
            <div className="w-20">
              <label className="block text-xs text-slate-400 mb-1">{t('common.currency')}</label>
              <input maxLength={3} value={form.currency} onChange={set('currency')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('finance.loans.lender')}</label>
            <input value={form.lender_name} onChange={set('lender_name')} className={cls} placeholder="e.g. First Citizens Bank" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('finance.loans.originalPrincipal')}</label>
              <input type="number" step="0.01" value={form.original_principal} onChange={set('original_principal')} className={cls} placeholder="0.00" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('finance.loans.outstandingBalance')}</label>
              <input type="number" step="0.01" value={form.outstanding_balance} onChange={set('outstanding_balance')} className={cls} placeholder="0.00" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('finance.loans.interestRate')}</label>
              <input type="number" step="0.01" value={form.interest_rate} onChange={set('interest_rate')} className={cls} placeholder="4.50" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('finance.loans.rateType')}</label>
              <select value={form.interest_type} onChange={set('interest_type')} className={cls}>
                <option value="FIXED">{t('finance.loans.fixed')}</option>
                <option value="VARIABLE">{t('finance.loans.variable')}</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('common.startDate')}</label>
              <input type="date" value={form.start_date} onChange={set('start_date')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('finance.loans.maturityDate')}</label>
              <input type="date" value={form.maturity_date} onChange={set('maturity_date')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('finance.loans.monthlyPayment')}</label>
            <input type="number" step="0.01" value={form.monthly_payment} onChange={set('monthly_payment')} className={cls} placeholder="0.00 (optional)" />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.lender_name || !form.original_principal || !form.outstanding_balance || !form.interest_rate}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('finance.loans.addLoan')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function UpdateBalanceModal({ id, lender, onClose, onUpdated }: { id: string; lender: string; onClose: () => void; onUpdated: () => void }) {
  const { t } = useTranslation()
  const [balance, setBalance] = useState('')

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => financeApi.updateLoan(id, { outstanding_balance: Number(balance) }),
    onSuccess: () => { onUpdated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-base font-semibold mb-4 text-white">{t('finance.loans.updateTitle', { lender })}</h2>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('finance.loans.outstandingBalance')}</label>
          <input type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="0.00" />
        </div>
        {error && <p className="text-red-400 text-xs mt-2">{error instanceof Error ? error.message : 'Failed.'}</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !balance}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('finance.loans.update')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function LoanHistoryModal({ id, lender, onClose }: { id: string; lender: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [date, setDate] = useState('')
  const [balance, setBalance] = useState('')
  const [rate, setRate] = useState('')
  const [payment, setPayment] = useState('')
  const [notes, setNotes] = useState('')

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['finance', 'loans', id, 'history'],
    queryFn: () => financeApi.getLoanHistory(id),
  })

  const { mutate, isPending, error: addError } = useMutation({
    mutationFn: () => financeApi.addLoanHistory(id, {
      as_of_date: date,
      outstanding_balance: Number(balance),
      interest_rate: rate ? Number(rate) : undefined,
      monthly_payment: payment ? Number(payment) : undefined,
      notes: notes || undefined,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'loans', id, 'history'] })
      setDate(''); setBalance(''); setRate(''); setPayment(''); setNotes('')
      setShowAdd(false)
    },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto py-6">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl mx-4 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Balance History — {lender}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm">{t('common.close', 'Close')}</button>
        </div>

        {!showAdd && (
          <button onClick={() => setShowAdd(true)}
            className="mb-4 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded-lg transition-colors">
            + Add Past Entry
          </button>
        )}
        {showAdd && (
          <div className="mb-5 p-4 bg-slate-700/50 rounded-lg border border-slate-600 space-y-3">
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Add Historical Entry</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className={cls} />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">Outstanding Balance (TTD)</label>
                <input type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)} className={cls} placeholder="0.00" />
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">Interest Rate % (optional)</label>
                <input type="number" step="0.01" value={rate} onChange={e => setRate(e.target.value)} className={cls} placeholder="4.50" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">Monthly Payment (optional)</label>
                <input type="number" step="0.01" value={payment} onChange={e => setPayment(e.target.value)} className={cls} placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className={cls} placeholder="e.g. Jul 2025 statement" />
            </div>
            {addError && <p className="text-red-400 text-xs">{addError instanceof Error ? addError.message : 'Failed.'}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={() => mutate()} disabled={isPending || !date || !balance}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors">
                {isPending ? 'Saving...' : 'Save Entry'}
              </button>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-white text-xs transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {isLoading && <p className="text-slate-400 text-sm">Loading...</p>}
        {!isLoading && history.length === 0 && (
          <p className="text-slate-400 text-sm">No history yet. History records automatically each time you update the balance.</p>
        )}
        {history.length > 0 && (
          <div className="rounded-lg overflow-hidden border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-right px-3 py-2">Outstanding Balance</th>
                  <th className="text-right px-3 py-2">Rate %</th>
                  <th className="text-right px-3 py-2">Monthly Pmt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {history.map((row: LoanBalanceHistory) => (
                  <tr key={row.id} className="hover:bg-slate-700/30">
                    <td className="px-3 py-2 text-slate-300">{row.as_of_date}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-400 font-medium">{fmtTTD(row.outstanding_balance)}</td>
                    <td className="px-3 py-2 text-right text-slate-400">
                      {row.interest_rate ? `${parseFloat(row.interest_rate).toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">
                      {row.monthly_payment ? fmtTTD(row.monthly_payment) : '—'}
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

export default function LoansPanel() {
  const { t } = useTranslation()
  const [showAdd, setShowAdd] = useState(false)
  const [updating, setUpdating] = useState<{ id: string; lender: string } | null>(null)
  const [loanHistory, setLoanHistory] = useState<{ id: string; lender: string } | null>(null)
  const qc = useQueryClient()

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ['finance', 'loans'],
    queryFn: () => financeApi.getLoans(),
  })

  const refresh = () => void qc.invalidateQueries({ queryKey: ['finance', 'loans'] })

  if (isLoading) return <p className="text-slate-400 text-sm">{t('finance.loans.loading')}</p>

  const totalOutstanding = loans.reduce((s, l) => s + parseFloat(l.outstanding_balance), 0)

  const byEntity: Record<string, typeof loans> = {}
  for (const loan of loans) {
    ;(byEntity[loan.owner_entity_id] ??= []).push(loan)
  }

  return (
    <div>
      {loans.length > 0 && (
        <div className="bg-slate-800 rounded-lg p-4 border-l-4 border-red-500 mb-6 inline-block min-w-48">
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{t('finance.loans.totalOutstanding')}</p>
          <p className="text-lg font-semibold font-mono text-red-400">{fmtTTD(String(totalOutstanding))}</p>
        </div>
      )}

      <div className="flex justify-end mb-4">
        <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
          {t('finance.loans.addLoan')}
        </button>
      </div>

      {loans.length === 0 && <p className="text-slate-400 text-sm">{t('finance.loans.noLoans')}</p>}

      {Object.entries(byEntity).sort(([a], [b]) => entityName(a).localeCompare(entityName(b))).map(([entityId, rows]) => (
        <div key={entityId} className="mb-6">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-2">{entityName(entityId)}</h3>
          <div className="rounded-lg overflow-hidden border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-2">{t('finance.loans.colLender')}</th>
                  <th className="text-left px-4 py-2">{t('finance.loans.colType')}</th>
                  <th className="text-right px-4 py-2">{t('finance.loans.colOriginal')}</th>
                  <th className="text-right px-4 py-2">{t('finance.loans.colOutstanding')}</th>
                  <th className="text-right px-4 py-2">{t('finance.loans.colRate')}</th>
                  <th className="text-right px-4 py-2">{t('finance.loans.colMonthlyPmt')}</th>
                  <th className="text-right px-4 py-2">{t('finance.loans.colMaturity')}</th>
                  <th className="text-right px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {rows.map(loan => (
                  <tr key={loan.id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-3 text-slate-100 font-medium">{loan.lender_name}</td>
                    <td className="px-4 py-3 text-slate-400">{t(`finance.loans.loanTypes.${loan.loan_type}`, loan.loan_type)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-400">{fmtTTD(loan.original_principal)}</td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-red-400">{fmtTTD(loan.outstanding_balance)}</td>
                    <td className="px-4 py-3 text-right text-slate-400">
                      {parseFloat(loan.interest_rate).toFixed(2)}%
                      <span className="ml-1 text-xs text-slate-600">{loan.interest_type === 'VARIABLE' ? 'VAR' : ''}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-400">
                      {loan.monthly_payment != null ? fmtTTD(loan.monthly_payment) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 text-xs">
                      {loan.maturity_date ? fmtDate(loan.maturity_date) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setLoanHistory({ id: loan.id, lender: loan.lender_name })}
                        className="text-xs text-slate-500 hover:text-slate-300 transition-colors mr-3">
                        History
                      </button>
                      <button onClick={() => setUpdating({ id: loan.id, lender: loan.lender_name })}
                        className="text-xs text-slate-500 hover:text-blue-400 transition-colors">
                        {t('finance.loans.update')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {showAdd && <AddModal onClose={() => setShowAdd(false)} onCreated={refresh} />}
      {updating && <UpdateBalanceModal id={updating.id} lender={updating.lender} onClose={() => setUpdating(null)} onUpdated={refresh} />}
      {loanHistory && <LoanHistoryModal id={loanHistory.id} lender={loanHistory.lender} onClose={() => setLoanHistory(null)} />}
    </div>
  )
}
