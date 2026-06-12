import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '../../api/finance'
import { entityName, fmtTTD, fmtDate } from '../../lib/entities'
import type { LoanType } from '../../types/finance'

const LOAN_TYPES: LoanType[] = ['MORTGAGE', 'CAR_LOAN', 'PERSONAL_LOAN', 'BUSINESS_LOAN', 'OVERDRAFT', 'OTHER']

const TYPE_LABELS: Record<LoanType, string> = {
  MORTGAGE: 'Mortgage', CAR_LOAN: 'Car Loan', PERSONAL_LOAN: 'Personal Loan',
  BUSINESS_LOAN: 'Business Loan', OVERDRAFT: 'Overdraft', OTHER: 'Other',
}

const ENTITY_OPTIONS = [
  { id: '00000000-0000-0000-0001-000000000001', name: 'JAG Holdings' },
  { id: '00000000-0000-0000-0001-000000000002', name: 'JABCO' },
  { id: '00000000-0000-0000-0001-000000000003', name: 'JAG Properties' },
  { id: '00000000-0000-0000-0001-000000000004', name: 'JAG Entertainment' },
  { id: '00000000-0000-0000-0001-000000000005', name: 'JAG Finance' },
  { id: '00000000-0000-0000-0001-000000000006', name: 'DragonBridge' },
]

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

function AddModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
        <h2 className="text-lg font-semibold mb-4 text-white">Add Loan / Liability</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Entity</label>
            <select value={form.owner_entity_id} onChange={set('owner_entity_id')} className={cls}>
              {ENTITY_OPTIONS.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Type</label>
              <select value={form.loan_type} onChange={set('loan_type')} className={cls}>
                {LOAN_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="w-20">
              <label className="block text-xs text-slate-400 mb-1">Currency</label>
              <input maxLength={3} value={form.currency} onChange={set('currency')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Lender</label>
            <input value={form.lender_name} onChange={set('lender_name')} className={cls} placeholder="e.g. First Citizens Bank" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Original Principal</label>
              <input type="number" step="0.01" value={form.original_principal} onChange={set('original_principal')} className={cls} placeholder="0.00" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Outstanding Balance</label>
              <input type="number" step="0.01" value={form.outstanding_balance} onChange={set('outstanding_balance')} className={cls} placeholder="0.00" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Interest Rate %</label>
              <input type="number" step="0.01" value={form.interest_rate} onChange={set('interest_rate')} className={cls} placeholder="4.50" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Rate Type</label>
              <select value={form.interest_type} onChange={set('interest_type')} className={cls}>
                <option value="FIXED">Fixed</option>
                <option value="VARIABLE">Variable</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Start Date</label>
              <input type="date" value={form.start_date} onChange={set('start_date')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Maturity Date</label>
              <input type="date" value={form.maturity_date} onChange={set('maturity_date')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Monthly Payment</label>
            <input type="number" step="0.01" value={form.monthly_payment} onChange={set('monthly_payment')} className={cls} placeholder="0.00 (optional)" />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => mutate()}
            disabled={isPending || !form.lender_name || !form.original_principal || !form.outstanding_balance || !form.interest_rate}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {isPending ? 'Saving…' : 'Add Loan'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function UpdateBalanceModal({ id, lender, onClose, onUpdated }: { id: string; lender: string; onClose: () => void; onUpdated: () => void }) {
  const [balance, setBalance] = useState('')

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => financeApi.updateLoan(id, { outstanding_balance: Number(balance) }),
    onSuccess: () => { onUpdated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-base font-semibold mb-4 text-white">Update Balance — {lender}</h2>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Outstanding Balance</label>
          <input type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="0.00" />
        </div>
        {error && <p className="text-red-400 text-xs mt-2">{error instanceof Error ? error.message : 'Failed.'}</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !balance} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? 'Saving…' : 'Update'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function LoansPanel() {
  const [showAdd, setShowAdd] = useState(false)
  const [updating, setUpdating] = useState<{ id: string; lender: string } | null>(null)
  const qc = useQueryClient()

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ['finance', 'loans'],
    queryFn: () => financeApi.getLoans(),
  })

  const refresh = () => void qc.invalidateQueries({ queryKey: ['finance', 'loans'] })

  if (isLoading) return <p className="text-slate-400 text-sm">Loading…</p>

  const totalOutstanding = loans.reduce((s, l) => s + parseFloat(l.outstanding_balance), 0)

  const byEntity: Record<string, typeof loans> = {}
  for (const loan of loans) {
    ;(byEntity[loan.owner_entity_id] ??= []).push(loan)
  }

  return (
    <div>
      {loans.length > 0 && (
        <div className="bg-slate-800 rounded-lg p-4 border-l-4 border-red-500 mb-6 inline-block min-w-48">
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Total Outstanding</p>
          <p className="text-lg font-semibold font-mono text-red-400">{fmtTTD(String(totalOutstanding))}</p>
        </div>
      )}

      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
        >
          + Add Loan
        </button>
      </div>

      {loans.length === 0 && <p className="text-slate-400 text-sm">No loans recorded.</p>}

      {Object.entries(byEntity).sort(([a], [b]) => entityName(a).localeCompare(entityName(b))).map(([entityId, rows]) => (
        <div key={entityId} className="mb-6">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-2">{entityName(entityId)}</h3>
          <div className="rounded-lg overflow-hidden border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-2">Lender</th>
                  <th className="text-left px-4 py-2">Type</th>
                  <th className="text-right px-4 py-2">Original</th>
                  <th className="text-right px-4 py-2">Outstanding</th>
                  <th className="text-right px-4 py-2">Rate</th>
                  <th className="text-right px-4 py-2">Monthly Pmt</th>
                  <th className="text-right px-4 py-2">Maturity</th>
                  <th className="text-right px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {rows.map(loan => (
                  <tr key={loan.id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-3 text-slate-100 font-medium">{loan.lender_name}</td>
                    <td className="px-4 py-3 text-slate-400">{TYPE_LABELS[loan.loan_type] ?? loan.loan_type}</td>
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
                      <button
                        onClick={() => setUpdating({ id: loan.id, lender: loan.lender_name })}
                        className="text-xs text-slate-500 hover:text-blue-400 transition-colors"
                      >
                        Update
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
    </div>
  )
}
