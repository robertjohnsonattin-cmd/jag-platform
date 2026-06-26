import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { expensesApi } from '../api/expenses'
import { glApi } from '../api/gl'
import { imsApi } from '../api/ims'
import { financeApi } from '../api/finance'
import { propertiesApi } from '../api/properties'
import { familyApi } from '../api/family'
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
  'PERSONAL_EXPENSE','GROCERIES','DINING','TRANSPORT','FUEL',
  'UTILITIES','ENTERTAINMENT','TRAVEL','MEDICAL','EDUCATION',
  'CLOTHING','SUBSCRIPTIONS','MAINTENANCE','INSURANCE','CHARITY',
  'OPERATING_EXPENSE','PAYROLL','TAX_PAYMENT','LOAN_REPAYMENT',
  'INVESTMENT_PURCHASE','TRANSFER_OUT','UNCLASSIFIED',
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

// ── Category → link type mapping ─────────────────────────────────────────────

const VEHICLE_CATEGORIES    = new Set(['FUEL','MAINTENANCE','TRANSPORT','INSURANCE'])
const POLICY_CATEGORIES     = new Set(['INSURANCE'])
const PROPERTY_CATEGORIES   = new Set(['MAINTENANCE','UTILITIES','TAX_PAYMENT'])
const FAMILY_CATEGORIES     = new Set(['PERSONAL_EXPENSE','MEDICAL','EDUCATION','CHARITY'])

// ── Create Expense Modal ──────────────────────────────────────────────────────

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
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
  const [linkType, setLinkType]   = useState<'VEHICLE'|'INSURANCE_POLICY'|'PROPERTY'|'FAMILY_MEMBER'|''>('')
  const [linkedId, setLinkedId]   = useState('')
  const [linkedLabel, setLinkedLabel] = useState('')
  const [fuelLitres, setFuelLitres]   = useState('')
  const [fuelOdo, setFuelOdo]         = useState('')
  const [fuelType, setFuelType]       = useState('PETROL')

  // Fetch contextual picker data based on category
  const showVehiclePicker  = VEHICLE_CATEGORIES.has(form.category)
  const showPolicyPicker   = POLICY_CATEGORIES.has(form.category)
  const showPropertyPicker = PROPERTY_CATEGORIES.has(form.category)
  const showFamilyPicker   = FAMILY_CATEGORIES.has(form.category)

  const { data: vehiclesData } = useQuery({
    queryKey: ['expense-picker-vehicles'],
    queryFn: () => imsApi.getVehicles({ limit: 200 }),
    enabled: showVehiclePicker,
  })
  const { data: policies = [] } = useQuery({
    queryKey: ['expense-picker-policies'],
    queryFn: () => financeApi.getPolicies({ is_active: 'true' }),
    enabled: showPolicyPicker,
  })
  const { data: propertiesArr = [] } = useQuery({
    queryKey: ['expense-picker-properties'],
    queryFn: () => propertiesApi.getProperties({ limit: 200 }),
    enabled: showPropertyPicker,
  })
  const { data: members = [] } = useQuery({
    queryKey: ['expense-picker-family'],
    queryFn: () => familyApi.list(),
    enabled: showFamilyPicker,
  })

  const vehicles   = vehiclesData?.vehicles ?? []
  const properties = propertiesArr

  // Reset link state when category changes in a way that the current linkType is no longer relevant
  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const cat = e.target.value
    setForm(f => ({ ...f, category: cat }))
    setLinkType('')
    setLinkedId('')
    setLinkedLabel('')
  }

  const handleLinkSelect = (id: string, label: string) => {
    setLinkedId(id)
    setLinkedLabel(label)
  }

  const { mutate: create, isPending, error } = useMutation({
    mutationFn: () => expensesApi.createExpense({
      owner_entity_id: form.owner_entity_id,
      expense_date: form.expense_date,
      description: form.description,
      payee_name: form.payee_name || undefined,
      amount: Number(form.amount),
      currency: form.currency,
      amount_ttd: Number(form.amount),
      payment_method: form.payment_method,
      category: form.category,
      notes: form.notes || undefined,
      idempotency_key: crypto.randomUUID(),
      linked_record_type: (linkType && linkedId) ? linkType : undefined,
      linked_record_id:   (linkType && linkedId) ? linkedId : undefined,
      linked_record_label:(linkType && linkedId) ? linkedLabel : undefined,
      fuel_litres:     (form.category === 'FUEL' && fuelLitres) ? Number(fuelLitres) : undefined,
      fuel_odometer_km:(form.category === 'FUEL' && fuelOdo) ? Number(fuelOdo) : undefined,
      fuel_type:       form.category === 'FUEL' ? fuelType : undefined,
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto py-6">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl mx-4">
        <h2 className="text-lg font-semibold mb-5">{t('expenses.createTitle')}</h2>

        <div className="space-y-3">
          <Field label={t('expenses.entityField')}>
            <select value={form.owner_entity_id} onChange={set('owner_entity_id')} className={cls}>
              {ENTITY_OPTIONS.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('expenses.dateField')}>
              <input type="date" value={form.expense_date} onChange={set('expense_date')} className={cls} />
            </Field>
            <Field label={t('expenses.paymentMethodField')}>
              <select value={form.payment_method} onChange={set('payment_method')} className={cls}>
                {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t('expenses.descriptionField')}>
            <input value={form.description} onChange={set('description')} placeholder={t('expenses.descriptionPlaceholder')} className={cls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('expenses.payeeField')}>
              <input value={form.payee_name} onChange={set('payee_name')} placeholder={t('expenses.payeeOptional')} className={cls} />
            </Field>
            <Field label={t('expenses.categoryField')}>
              <select value={form.category} onChange={handleCategoryChange} className={cls}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('expenses.amountField')}>
              <input type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} placeholder="0.00" className={cls} />
            </Field>
            <Field label={t('expenses.currencyField')}>
              <select value={form.currency} onChange={set('currency')} className={cls}>
                <option>TTD</option><option>USD</option><option>EUR</option><option>GBP</option>
              </select>
            </Field>
          </div>
          <Field label={t('expenses.notesField')}>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={`${cls} resize-none`} />
          </Field>

          {/* ── Contextual link section ─────────────────────────────────────── */}
          {(showVehiclePicker || showPolicyPicker || showPropertyPicker || showFamilyPicker) && (
            <div className="border-t border-slate-700 pt-3 space-y-3">
              <p className="text-xs text-slate-400 font-medium">Link to record (optional)</p>

              {/* Link type selector when multiple options apply */}
              {showVehiclePicker && showPolicyPicker && (
                <div className="flex gap-2">
                  {(['VEHICLE','INSURANCE_POLICY'] as const).map(lt => (
                    <button
                      key={lt}
                      type="button"
                      onClick={() => { setLinkType(lt); setLinkedId(''); setLinkedLabel('') }}
                      className={`px-3 py-1 text-xs rounded border transition-colors ${linkType === lt ? 'bg-blue-700 border-blue-500 text-white' : 'border-slate-600 text-slate-400 hover:border-slate-400'}`}
                    >
                      {lt === 'VEHICLE' ? 'Vehicle' : 'Insurance Policy'}
                    </button>
                  ))}
                </div>
              )}
              {showVehiclePicker && showPropertyPicker && !showPolicyPicker && (
                <div className="flex gap-2">
                  {(['VEHICLE','PROPERTY'] as const).map(lt => (
                    <button
                      key={lt}
                      type="button"
                      onClick={() => { setLinkType(lt); setLinkedId(''); setLinkedLabel('') }}
                      className={`px-3 py-1 text-xs rounded border transition-colors ${linkType === lt ? 'bg-blue-700 border-blue-500 text-white' : 'border-slate-600 text-slate-400 hover:border-slate-400'}`}
                    >
                      {lt === 'VEHICLE' ? 'Vehicle' : 'Property'}
                    </button>
                  ))}
                </div>
              )}

              {/* Vehicle picker */}
              {(linkType === 'VEHICLE' || (showVehiclePicker && !showPolicyPicker && !showPropertyPicker && linkType === '')) && (
                <Field label="Vehicle">
                    <select
                      value={linkedId}
                      onChange={e => {
                        const veh = vehicles.find(v => v.id === e.target.value)
                        handleLinkSelect(e.target.value, veh ? `${veh.registration_number ?? ''} ${veh.make ?? ''} ${veh.model ?? ''}`.trim() : '')
                        setLinkType('VEHICLE')
                      }}
                      className={cls}
                    >
                      <option value="">— No vehicle —</option>
                      {vehicles.map(v => (
                        <option key={v.id} value={v.id}>
                          {v.registration_number ? `${v.registration_number} · ` : ''}{v.make} {v.model}
                        </option>
                      ))}
                    </select>
                </Field>
              )}

              {/* Insurance policy picker */}
              {linkType === 'INSURANCE_POLICY' && (
                <Field label="Insurance Policy">
                  <select
                    value={linkedId}
                    onChange={e => {
                      const pol = policies.find(p => p.id === e.target.value)
                      handleLinkSelect(e.target.value, pol ? `${pol.policy_number ?? ''} ${pol.insurer_name ?? ''}`.trim() : '')
                    }}
                    className={cls}
                  >
                    <option value="">— No policy —</option>
                    {policies.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.policy_number ? `${p.policy_number} · ` : ''}{p.insurer_name} ({p.policy_type})
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {/* Property picker */}
              {linkType === 'PROPERTY' && (
                <Field label="Property">
                  <select
                    value={linkedId}
                    onChange={e => {
                      const prop = properties.find(p => p.id === e.target.value)
                      handleLinkSelect(e.target.value, prop?.name ?? '')
                    }}
                    className={cls}
                  >
                    <option value="">— No property —</option>
                    {properties.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </Field>
              )}

              {/* Family member picker */}
              {showFamilyPicker && !showVehiclePicker && !showPropertyPicker && (
                <Field label="Family member">
                  <select
                    value={linkedId}
                    onChange={e => {
                      const m = members.find(fm => fm.id === e.target.value)
                      handleLinkSelect(e.target.value, m ? `${m.first_name} ${m.last_name}` : '')
                      setLinkType('FAMILY_MEMBER')
                    }}
                    className={cls}
                  >
                    <option value="">— No person —</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
                    ))}
                  </select>
                </Field>
              )}

              {/* Fuel-specific extra fields */}
              {form.category === 'FUEL' && linkType === 'VEHICLE' && linkedId && (
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Litres">
                    <input type="number" min="0" step="0.01" value={fuelLitres} onChange={e => setFuelLitres(e.target.value)} placeholder="e.g. 40" className={cls} />
                  </Field>
                  <Field label="Odometer km">
                    <input type="number" min="0" step="1" value={fuelOdo} onChange={e => setFuelOdo(e.target.value)} placeholder="optional" className={cls} />
                  </Field>
                  <Field label="Fuel type">
                    <select value={fuelType} onChange={e => setFuelType(e.target.value)} className={cls}>
                      <option>PETROL</option><option>DIESEL</option><option>CNG</option><option>ELECTRIC</option>
                    </select>
                  </Field>
                </div>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-red-400 text-xs mt-3">{(error as Error).message}</p>}

        <div className="flex gap-3 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel')}</button>
          <button
            onClick={() => create()}
            disabled={isPending || !form.description || !form.amount}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {isPending ? t('common.saving') : t('expenses.saveDraft')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Approve Modal ─────────────────────────────────────────────────────────────

function ApproveModal({ expense, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
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
        <h2 className="text-lg font-semibold mb-1">{t('expenses.approveTitle')}</h2>
        <p className="text-sm text-slate-400">{expense.description} — {fmtTTD(expense.amount_ttd)}</p>
        <p className="text-xs text-slate-500 mb-5">
          {t('expenses.glFiltered', { entity: entityName(expense.owner_entity_id) })}
        </p>

        <div className="space-y-3">
          <Field label={t('expenses.debitAccount')}>
            <select value={debitId} onChange={e => setDebitId(e.target.value)} className={cls}>
              <option value="">{t('expenses.selectAccount')}</option>
              {expenseAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>
              ))}
            </select>
          </Field>
          <Field label={t('expenses.creditAccount')}>
            <select value={creditId} onChange={e => setCreditId(e.target.value)} className={cls}>
              <option value="">{t('expenses.selectAccount')}</option>
              {paymentAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>
              ))}
            </select>
          </Field>
        </div>

        {error && <p className="text-red-400 text-xs mt-3">{(error as Error).message}</p>}

        <div className="flex gap-3 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel')}</button>
          <button
            onClick={() => approve()}
            disabled={isPending || !debitId || !creditId}
            className="px-4 py-2 text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {isPending ? t('expenses.approving') : t('expenses.approvePost')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Reject Modal ──────────────────────────────────────────────────────────────

function RejectModal({ expense, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')

  const { mutate: reject, isPending, error } = useMutation({
    mutationFn: () => expensesApi.reject(expense.id, reason),
    onSuccess: () => { onDone(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-1">{t('expenses.rejectTitle')}</h2>
        <p className="text-sm text-slate-400 mb-5">{expense.description}</p>
        <Field label={t('expenses.rejectionReason')}>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder={t('expenses.rejectionPlaceholder')}
            className={`${cls} resize-none`}
          />
        </Field>
        {error && <p className="text-red-400 text-xs mt-3">{(error as Error).message}</p>}
        <div className="flex gap-3 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel')}</button>
          <button
            onClick={() => reject()}
            disabled={isPending || !reason.trim()}
            className="px-4 py-2 text-sm bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {isPending ? t('expenses.rejecting') : t('expenses.reject')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Reverse Modal ─────────────────────────────────────────────────────────────

function ReverseModal({ expense, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')

  const { mutate: reverse, isPending, error } = useMutation({
    mutationFn: () => expensesApi.reverse(expense.id, reason),
    onSuccess: () => { onDone(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-1">{t('expenses.voidTitle')}</h2>
        <p className="text-sm text-slate-400 mb-1">{expense.description} — {fmtTTD(expense.amount_ttd)}</p>
        <p className="text-xs text-slate-500 mb-5">{t('expenses.voidDescription')}</p>
        <Field label={t('expenses.reversalReason')}>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder={t('expenses.reversalPlaceholder')}
            className={`${cls} resize-none`}
          />
        </Field>
        {error && <p className="text-red-400 text-xs mt-3">{(error as Error).message}</p>}
        <div className="flex gap-3 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel')}</button>
          <button
            onClick={() => reverse()}
            disabled={isPending || !reason.trim()}
            className="px-4 py-2 text-sm bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {isPending ? t('expenses.reversing') : t('expenses.voidReverse')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const { t } = useTranslation()
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
        <Row label={t('expenses.detailAmount')} value={
          expense.currency === 'TTD'
            ? fmtTTD(expense.amount_ttd)
            : `${expense.currency} ${parseFloat(expense.amount).toLocaleString('en-TT', { minimumFractionDigits: 2 })} (${fmtTTD(expense.amount_ttd)})`
        } />
        <Row label={t('expenses.detailEntity')}   value={entityName(expense.owner_entity_id)} />
        <Row label={t('expenses.detailCategory')} value={expense.category} />
        <Row label={t('expenses.detailMethod')}   value={expense.payment_method} />
        <Row label={t('expenses.detailStatus')}   value={<span className={`text-xs px-2 py-0.5 rounded border ${STATUS_STYLES[expense.status]}`}>{expense.status}</span>} />
        {expense.submitted_at && <Row label={t('expenses.detailSubmitted')} value={fmtDate(expense.submitted_at)} />}
        {expense.approved_at  && <Row label={expense.status === 'REJECTED' ? t('expenses.detailRejectedAt') : t('expenses.detailApprovedAt')} value={fmtDate(expense.approved_at)} />}
        {expense.rejection_reason && (
          <div className="p-2.5 rounded bg-red-950/40 border border-red-900 text-xs text-red-300">
            <p className="font-medium mb-0.5">{t('expenses.detailRejectionReason')}</p>
            <p>{expense.rejection_reason}</p>
          </div>
        )}
        {expense.journal_entry_id && <Row label={t('expenses.detailGlEntry')} value={<span className="font-mono text-xs text-slate-400">{expense.journal_entry_id.slice(0, 8)}…</span>} />}
        {expense.notes && (
          <div className="p-2.5 rounded bg-slate-700/40 text-xs text-slate-300">{expense.notes}</div>
        )}
        {expense.receipt_filename && (
          <Row label={t('expenses.detailReceipt')} value={<span className="text-blue-400 text-xs">{expense.receipt_filename}</span>} />
        )}
        {expense.linked_record_type && (
          <Row
            label={expense.linked_record_type === 'VEHICLE' ? 'Vehicle' :
                   expense.linked_record_type === 'INSURANCE_POLICY' ? 'Policy' :
                   expense.linked_record_type === 'PROPERTY' ? 'Property' : 'Person'}
            value={<span className="text-amber-300 text-xs">{expense.linked_record_label ?? expense.linked_record_id?.slice(0,8)}</span>}
          />
        )}
        {expense.fuel_litres && (
          <Row label="Fuel" value={
            <span className="text-xs text-slate-300">
              {parseFloat(expense.fuel_litres).toFixed(1)}L {expense.fuel_type ?? ''}
              {expense.fuel_odometer_km ? ` · ${expense.fuel_odometer_km.toLocaleString()} km` : ''}
            </span>
          } />
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
            {submitting ? t('expenses.submitting') : t('expenses.submitForApproval')}
          </button>
        )}
        {expense.status === 'SUBMITTED' && (
          <>
            <button
              onClick={() => setShowApprove(true)}
              className="w-full px-3 py-2 bg-green-700 hover:bg-green-600 text-white text-sm rounded-lg transition-colors"
            >
              {t('expenses.approvePost')}
            </button>
            <button
              onClick={() => setShowReject(true)}
              className="w-full px-3 py-2 bg-red-800 hover:bg-red-700 text-white text-sm rounded-lg transition-colors"
            >
              {t('expenses.reject')}
            </button>
          </>
        )}
        {expense.status === 'APPROVED' && (
          <button
            onClick={() => setShowReverse(true)}
            className="w-full px-3 py-2 bg-purple-800 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors"
          >
            {t('expenses.voidReverse')}
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

export default function Expenses() {
  const { t } = useTranslation()
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

  const selectedFresh = selected ? (expenses.find(e => e.id === selected.id) ?? selected) : null
  const submitted = expenses.filter(e => e.status === 'SUBMITTED').length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{t('expenses.title')}</h1>
          {submitted > 0 && (
            <p className="text-sm text-yellow-400 mt-0.5">{t('expenses.pendingApproval', { count: submitted })}</p>
          )}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
        >
          {t('expenses.newExpense')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('expenses.statusFilter')}</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">{t('common.all')}</option>
            <option>DRAFT</option><option>SUBMITTED</option><option>APPROVED</option><option>REJECTED</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('expenses.entityFilter')}</label>
          <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">{t('common.all')}</option>
            {ENTITY_OPTIONS.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('common.from')}</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('common.to')}</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
      </div>

      <div className="flex gap-6">
        {/* Expense list */}
        <div className="flex-1 min-w-0">
          {isLoading && <p className="text-slate-400 text-sm">{t('expenses.loading')}</p>}
          {!isLoading && expenses.length === 0 && (
            <p className="text-slate-500 text-sm">{t('expenses.noExpenses')}</p>
          )}

          {expenses.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                    <th className="text-left px-4 py-2">{t('expenses.colDate')}</th>
                    <th className="text-left px-4 py-2">{t('expenses.colDescription')}</th>
                    <th className="text-left px-4 py-2">{t('expenses.colEntity')}</th>
                    <th className="text-left px-4 py-2">{t('expenses.colCategory')}</th>
                    <th className="text-right px-4 py-2">{t('expenses.colAmount')}</th>
                    <th className="text-center px-4 py-2">{t('expenses.colStatus')}</th>
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
                            title={t('common.delete')}
                          >&#x1F5D1;</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-600 bg-slate-700/20 text-xs text-slate-400 font-semibold">
                  <tr>
                    <td colSpan={4} className="px-4 py-2">{t('expenses.totalRow', { count: expenses.length })}</td>
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
