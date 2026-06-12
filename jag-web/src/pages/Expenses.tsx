import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { expensesApi } from '../api/expenses'
import { glApi } from '../api/gl'
import { fmtTTD, fmtDate, entityName } from '../lib/entities'
import type { Expense } from '../types/expenses'
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal'

const ENTITY_OPTIONS = [
  { id: '00000000-0000-0000-0001-000000000001', name: 'JAG Holdings' },
  { id: '00000000-0000-0000-0001-000000000002', name: 'JABCO' },
  { id: '00000000-0000-0000-0001-000000000003', name: 'JAG Properties' },
  { id: '00000000-0000-0000-0001-000000000004', name: 'JAG Entertainment' },
  { id: '00000000-0000-0000-0001-000000000005', name: 'JAG Finance' },
  { id: '00000000-0000-0000-0001-000000000006', name: 'DragonBridge' },
]

const CATEGORIES = [
  'OPERATING_EXPENSE','PAYROLL','TAX_PAYMENT','LOAN_REPAYMENT',
  'INVESTMENT_PURCHASE','TRANSFER_OUT','PERSONAL_EXPENSE','UTILITIES',
  'INSURANCE','ENTERTAINMENT','TRAVEL','MEDICAL','EDUCATION','CHARITY','UNCLASSIFIED',
]

const PAYMENT_METHODS = ['CASH','BANK_TRANSFER','CREDIT_CARD','CHEQUE','DIRECT_DEBIT','OTHER']

const STATUS_STYLES: Record<string, string> = {
  DRAFT:     'bg-slate-700 text-slate-300 border-slate-500',
  SUBMITTED: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  APPROVED:  'bg-green-900/50 text-green-300 border-green-700',
  REJECTED:  'bg-red-900/50 text-red-400 border-red-700',
  REVERSED:  'bg-purple-900/50 text-purple-300 border-purple-700',
}

function fmt(v: string | null | undefined) {
  return v ? fmtTTD(v) : '—'
}

// ── Create Expense Modal ──────────────────────────────────────────────────────

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    owner_entity_id: ENTITY_OPTIONS[0].id,
    expense_date: new Date().toISOString().slice(0, 10),
    description: '',
    payee_name: '',
    amount: '',
    currency: 'TTD',
    payment_method: 'BANK_TRANSFER',
    category: 'OPERATING_EXPENSE',
    notes: '',
  })

  const { mutate: create, isPending, error } = useMutation({
    mutationFn: () => expensesApi.createExpense({
      owner_entity_id: form.owner_entity_id,
      expense_date: form.expense_date,
      description: form.description,
      payee_name: form.payee_name || undefined,
      amount: Number(form.amount),
      currency: form.currency,
      amount_ttd: Number(form.amount), // 1:1 for TTD; FX handled later
      payment_method: form.payment_method,
      category: form.category,
      notes: form.notes || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-5">New Expense</h2>

        <div className="space-y-3">
          <Field label="Entity">
            <select value={form.owner_entity_id} onChange={set('owner_entity_id')} className={cls}>
              {ENTITY_OPTIONS.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input type="date" value={form.expense_date} onChange={set('expense_date')} className={cls} />
            </Field>
            <Field label="Payment Method">
              <select value={form.payment_method} onChange={set('payment_method')} className={cls}>
                {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <input value={form.description} onChange={set('description')} placeholder="e.g. Office supplies" className={cls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payee">
              <input value={form.payee_name} onChange={set('payee_name')} placeholder="Optional" className={cls} />
            </Field>
            <Field label="Category">
              <select value={form.category} onChange={set('category')} className={cls}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount">
              <input type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} placeholder="0.00" className={cls} />
            </Field>
            <Field label="Currency">
              <select value={form.currency} onChange={set('currency')} className={cls}>
                <option>TTD</option><option>USD</option><option>EUR</option><option>GBP</option>
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={`${cls} resize-none`} />
          </Field>
        </div>

        {error && <p className="text-red-400 text-xs mt-3">{(error as Error).message}</p>}

        <div className="flex gap-3 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button
            onClick={() => create()}
            disabled={isPending || !form.description || !form.amount}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {isPending ? 'Saving…' : 'Save as Draft'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Approve Modal ─────────────────────────────────────────────────────────────

function ApproveModal({ expense, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: () => void }) {
  const [debitId, setDebitId]   = useState(expense.gl_debit_account_id ?? '')
  const [creditId, setCreditId] = useState('')

  const { data: accounts = [] } = useQuery({
    queryKey: ['gl', 'accounts'],
    queryFn: () => glApi.getAccounts(),
  })

  const entityAccounts = accounts.filter(a => a.owner_entity_id === expense.owner_entity_id)
  const expenseAccounts = entityAccounts.filter(a => ['EXPENSE','OTHER_EXPENSE'].includes(a.account_type) && a.allow_direct_posting)
  const paymentAccounts = entityAccounts.filter(a => ['ASSET','LIABILITY'].includes(a.account_type) && a.allow_direct_posting)

  const { mutate: approve, isPending, error } = useMutation({
    mutationFn: () => expensesApi.approve(expense.id, {
      gl_debit_account_id: debitId,
      gl_credit_account_id: creditId,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: () => { onDone(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-1">Approve Expense</h2>
        <p className="text-sm text-slate-400">{expense.description} — {fmtTTD(expense.amount_ttd)}</p>
        <p className="text-xs text-slate-500 mb-5">GL accounts filtered to <span className="text-slate-300">{entityName(expense.owner_entity_id)}</span></p>

        <div className="space-y-3">
          <Field label="Debit Account (Expense)">
            <select value={debitId} onChange={e => setDebitId(e.target.value)} className={cls}>
              <option value="">Select…</option>
              {expenseAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Credit Account (bank, credit card, or accrued liability)">
            <select value={creditId} onChange={e => setCreditId(e.target.value)} className={cls}>
              <option value="">Select…</option>
              {paymentAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>
              ))}
            </select>
          </Field>
        </div>

        {error && <p className="text-red-400 text-xs mt-3">{(error as Error).message}</p>}

        <div className="flex gap-3 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button
            onClick={() => approve()}
            disabled={isPending || !debitId || !creditId}
            className="px-4 py-2 text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {isPending ? 'Approving…' : 'Approve & Post GL'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Reject Modal ──────────────────────────────────────────────────────────────

function RejectModal({ expense, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')

  const { mutate: reject, isPending, error } = useMutation({
    mutationFn: () => expensesApi.reject(expense.id, reason),
    onSuccess: () => { onDone(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-1">Reject Expense</h2>
        <p className="text-sm text-slate-400 mb-5">{expense.description}</p>
        <Field label="Rejection reason">
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder="Explain why this expense is rejected…"
            className={`${cls} resize-none`}
          />
        </Field>
        {error && <p className="text-red-400 text-xs mt-3">{(error as Error).message}</p>}
        <div className="flex gap-3 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button
            onClick={() => reject()}
            disabled={isPending || !reason.trim()}
            className="px-4 py-2 text-sm bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {isPending ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Reverse Modal ─────────────────────────────────────────────────────────────

function ReverseModal({ expense, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')

  const { mutate: reverse, isPending, error } = useMutation({
    mutationFn: () => expensesApi.reverse(expense.id, reason),
    onSuccess: () => { onDone(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-1">Void & Reverse Entry</h2>
        <p className="text-sm text-slate-400 mb-1">{expense.description} — {fmtTTD(expense.amount_ttd)}</p>
        <p className="text-xs text-slate-500 mb-5">
          This will void the original GL entry and post an equal reversing entry. Both entries remain visible in the ledger. The expense moves to <span className="text-purple-300">REVERSED</span>.
        </p>
        <Field label="Reversal reason (required for audit trail)">
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Incorrect GL account selected on approval — reposted to correct account."
            className={`${cls} resize-none`}
          />
        </Field>
        {error && <p className="text-red-400 text-xs mt-3">{(error as Error).message}</p>}
        <div className="flex gap-3 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button
            onClick={() => reverse()}
            disabled={isPending || !reason.trim()}
            className="px-4 py-2 text-sm bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {isPending ? 'Reversing…' : 'Void & Reverse'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const qc = useQueryClient()
  const [showApprove, setShowApprove] = useState(false)
  const [showReject, setShowReject]   = useState(false)
  const [showReverse, setShowReverse] = useState(false)

  const { mutate: submit, isPending: submitting } = useMutation({
    mutationFn: () => expensesApi.submit(expense.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['expenses'] }),
  })

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['expenses'] })

  return (
    <div className="w-96 flex-shrink-0 bg-slate-800 rounded-lg border border-slate-700 p-5 self-start">
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-xs text-slate-400">{fmtDate(expense.expense_date)}</p>
          <h3 className="font-semibold text-slate-100 mt-0.5 leading-snug">{expense.description}</h3>
          {expense.payee_name && <p className="text-xs text-slate-400 mt-0.5">{expense.payee_name}</p>}
        </div>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-300 text-lg leading-none ml-2">✕</button>
      </div>

      <div className="space-y-2 mb-4 text-sm">
        <Row label="Amount" value={
          expense.currency === 'TTD'
            ? fmtTTD(expense.amount_ttd)
            : `${expense.currency} ${parseFloat(expense.amount).toLocaleString('en-TT', { minimumFractionDigits: 2 })} (${fmtTTD(expense.amount_ttd)})`
        } />
        <Row label="Entity"  value={entityName(expense.owner_entity_id)} />
        <Row label="Category" value={expense.category} />
        <Row label="Method"  value={expense.payment_method} />
        <Row label="Status"  value={<span className={`text-xs px-2 py-0.5 rounded border ${STATUS_STYLES[expense.status]}`}>{expense.status}</span>} />
        {expense.submitted_at && <Row label="Submitted" value={fmtDate(expense.submitted_at)} />}
        {expense.approved_at  && <Row label={expense.status === 'REJECTED' ? 'Rejected at' : 'Approved at'} value={fmtDate(expense.approved_at)} />}
        {expense.rejection_reason && (
          <div className="p-2.5 rounded bg-red-950/40 border border-red-900 text-xs text-red-300">
            <p className="font-medium mb-0.5">Rejection reason</p>
            <p>{expense.rejection_reason}</p>
          </div>
        )}
        {expense.journal_entry_id && <Row label="GL Entry" value={<span className="font-mono text-xs text-slate-400">{expense.journal_entry_id.slice(0, 8)}…</span>} />}
        {expense.notes && (
          <div className="p-2.5 rounded bg-slate-700/40 text-xs text-slate-300">{expense.notes}</div>
        )}
        {expense.receipt_filename && (
          <Row label="Receipt" value={<span className="text-blue-400 text-xs">{expense.receipt_filename}</span>} />
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        {expense.status === 'DRAFT' && (
          <button
            onClick={() => submit()}
            disabled={submitting}
            className="w-full px-3 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {submitting ? 'Submitting…' : 'Submit for Approval'}
          </button>
        )}
        {expense.status === 'SUBMITTED' && (
          <>
            <button
              onClick={() => setShowApprove(true)}
              className="w-full px-3 py-2 bg-green-700 hover:bg-green-600 text-white text-sm rounded-lg transition-colors"
            >
              Approve & Post GL
            </button>
            <button
              onClick={() => setShowReject(true)}
              className="w-full px-3 py-2 bg-red-800 hover:bg-red-700 text-white text-sm rounded-lg transition-colors"
            >
              Reject
            </button>
          </>
        )}
        {expense.status === 'APPROVED' && (
          <button
            onClick={() => setShowReverse(true)}
            className="w-full px-3 py-2 bg-purple-800 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors"
          >
            Void &amp; Reverse
          </button>
        )}
      </div>

      {showApprove && <ApproveModal expense={expense} onClose={() => setShowApprove(false)} onDone={invalidate} />}
      {showReject  && <RejectModal  expense={expense} onClose={() => setShowReject(false)}  onDone={invalidate} />}
      {showReverse && <ReverseModal expense={expense} onClose={() => setShowReverse(false)} onDone={invalidate} />}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-2">
      <span className="text-xs text-slate-400 shrink-0">{label}</span>
      <span className="text-sm text-slate-100 text-right">{value}</span>
    </div>
  )
}

export default function Expenses() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter]   = useState('')
  const [entityFilter, setEntityFilter]   = useState('')
  const [dateFrom, setDateFrom]           = useState('')
  const [dateTo, setDateTo]               = useState('')
  const [selected, setSelected]           = useState<Expense | null>(null)
  const [showCreate, setShowCreate]       = useState(false)
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null)

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', statusFilter, entityFilter, dateFrom, dateTo],
    queryFn: () => expensesApi.getExpenses({
      status:          statusFilter || undefined,
      owner_entity_id: entityFilter || undefined,
      date_from:       dateFrom || undefined,
      date_to:         dateTo || undefined,
      limit: 200,
    }),
  })

  // Keep selected in sync with fresh data
  const selectedFresh = selected ? (expenses.find(e => e.id === selected.id) ?? selected) : null

  const submitted = expenses.filter(e => e.status === 'SUBMITTED').length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Expenses</h1>
          {submitted > 0 && (
            <p className="text-sm text-yellow-400 mt-0.5">{submitted} pending approval</p>
          )}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
        >
          + New Expense
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">All</option>
            <option>DRAFT</option><option>SUBMITTED</option><option>APPROVED</option><option>REJECTED</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Entity</label>
          <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">All</option>
            {ENTITY_OPTIONS.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
      </div>

      <div className="flex gap-6">
        {/* Expense list */}
        <div className="flex-1 min-w-0">
          {isLoading && <p className="text-slate-400 text-sm">Loading…</p>}
          {!isLoading && expenses.length === 0 && (
            <p className="text-slate-500 text-sm">No expenses found. Create one to get started.</p>
          )}

          {expenses.length > 0 && (
            <div className="rounded-lg overflow-hidden border border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-left px-4 py-2">Description</th>
                    <th className="text-left px-4 py-2">Entity</th>
                    <th className="text-left px-4 py-2">Category</th>
                    <th className="text-right px-4 py-2">Amount</th>
                    <th className="text-center px-4 py-2">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {expenses.map(e => (
                    <tr
                      key={e.id}
                      onClick={() => setSelected(e)}
                      className={`hover:bg-slate-700/30 cursor-pointer transition-colors ${selected?.id === e.id ? 'bg-slate-700/50' : ''}`}
                    >
                      <td className="px-4 py-2.5 text-xs text-slate-400 whitespace-nowrap">{fmtDate(e.expense_date)}</td>
                      <td className="px-4 py-2.5 text-slate-100 max-w-xs">
                        <p className="truncate">{e.description}</p>
                        {e.payee_name && <p className="text-xs text-slate-500 truncate">{e.payee_name}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-400">{entityName(e.owner_entity_id)}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-400">{e.category.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-100">{fmt(e.amount_ttd)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_STYLES[e.status]}`}>{e.status}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {(e.status === 'DRAFT' || e.status === 'REJECTED') && (
                          <button
                            onClick={ev => { ev.stopPropagation(); setDeletingExpense(e) }}
                            className="text-slate-600 hover:text-red-400 transition-colors"
                            title="Delete expense"
                          >&#x1F5D1;</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-600 bg-slate-700/20 text-xs text-slate-400 font-semibold">
                  <tr>
                    <td colSpan={4} className="px-4 py-2">Total ({expenses.length})</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-200">
                      {fmtTTD(expenses.reduce((s, e) => s + parseFloat(e.amount_ttd), 0))}
                    </td>
                    <td /><td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedFresh && (
          <DetailPanel
            key={selectedFresh.id}
            expense={selectedFresh}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => void qc.invalidateQueries({ queryKey: ['expenses'] })}
        />
      )}

      {deletingExpense && (
        <ConfirmDeleteModal
          label={deletingExpense.description}
          onConfirm={() => expensesApi.delete(deletingExpense.id).then(() => {
            void qc.invalidateQueries({ queryKey: ['expenses'] })
            if (selected?.id === deletingExpense.id) setSelected(null)
          })}
          onClose={() => setDeletingExpense(null)}
        />
      )}
    </div>
  )
}
