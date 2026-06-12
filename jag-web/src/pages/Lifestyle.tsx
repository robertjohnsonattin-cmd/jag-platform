import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

import {
  lifestyleApi,
  type ProgType, type TxType, type MetricType,
  type LoyaltyProgramme, type TrackerEntry,
} from '../api/lifestyle'

// ── Constants ─────────────────────────────────────────────────────────────────

const PROG_LABELS: Record<ProgType, string> = {
  AIRLINE: 'Airline', HOTEL: 'Hotel', CRUISE: 'Cruise',
  CREDIT_CARD: 'Credit Card', RETAIL: 'Retail', DINING: 'Dining', OTHER: 'Other',
}
const PROG_ICONS: Record<ProgType, string> = {
  AIRLINE: '✈️', HOTEL: '🏨', CRUISE: '🚢',
  CREDIT_CARD: '💳', RETAIL: '🛍️', DINING: '🍽️', OTHER: '⭐',
}
const PROG_COLORS: Record<ProgType, string> = {
  AIRLINE: 'bg-blue-900 text-blue-200',
  HOTEL: 'bg-purple-900 text-purple-200',
  CRUISE: 'bg-cyan-900 text-cyan-200',
  CREDIT_CARD: 'bg-emerald-900 text-emerald-200',
  RETAIL: 'bg-orange-900 text-orange-200',
  DINING: 'bg-red-900 text-red-200',
  OTHER: 'bg-slate-700 text-slate-200',
}

const TX_LABELS: Record<TxType, string> = {
  EARN: 'Earn', REDEEM: 'Redeem', EXPIRE: 'Expire',
  TRANSFER_IN: 'Transfer In', TRANSFER_OUT: 'Transfer Out',
  BONUS: 'Bonus', REINSTATEMENT: 'Reinstatement',
}
const TX_COLORS: Record<TxType, string> = {
  EARN: 'text-emerald-400', BONUS: 'text-emerald-400', REINSTATEMENT: 'text-emerald-400',
  TRANSFER_IN: 'text-blue-400',
  REDEEM: 'text-orange-400', EXPIRE: 'text-red-400', TRANSFER_OUT: 'text-red-400',
}

const METRIC_LABELS: Record<MetricType, string> = {
  WEIGHT_KG: 'Weight (kg)', STEPS: 'Steps', SLEEP_HOURS: 'Sleep (hrs)',
  CALORIES: 'Calories', EXERCISE_MINUTES: 'Exercise (min)',
  BLOOD_PRESSURE_SYSTOLIC: 'BP Systolic', BLOOD_PRESSURE_DIASTOLIC: 'BP Diastolic',
  RESTING_HEART_RATE: 'Resting HR', OTHER: 'Other',
}
const METRIC_ICONS: Record<MetricType, string> = {
  WEIGHT_KG: '⚖️', STEPS: '👣', SLEEP_HOURS: '😴', CALORIES: '🔥',
  EXERCISE_MINUTES: '🏃', BLOOD_PRESSURE_SYSTOLIC: '❤️', BLOOD_PRESSURE_DIASTOLIC: '❤️',
  RESTING_HEART_RATE: '💓', OTHER: '📊',
}
const METRIC_DEFAULT_UNIT: Record<MetricType, string> = {
  WEIGHT_KG: 'kg', STEPS: 'steps', SLEEP_HOURS: 'hrs', CALORIES: 'kcal',
  EXERCISE_MINUTES: 'min', BLOOD_PRESSURE_SYSTOLIC: 'mmHg', BLOOD_PRESSURE_DIASTOLIC: 'mmHg',
  RESTING_HEART_RATE: 'bpm', OTHER: '',
}

const today = () => new Date().toISOString().split('T')[0]
const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' })
const fmtNum = (n: number) => n.toLocaleString()

// ── Add Programme Modal ────────────────────────────────────────────────────────

function AddProgrammeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    programme_type: 'AIRLINE' as ProgType,
    provider_name: '',
    membership_number: '',
    tier: '',
    points_balance: '',
    miles_balance: '',
    expiry_date: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    if (!form.provider_name.trim()) { setError('Provider name is required.'); return }
    setSaving(true); setError('')
    try {
      await lifestyleApi.createProgramme({
        programme_type: form.programme_type,
        provider_name: form.provider_name.trim(),
        membership_number: form.membership_number || undefined,
        tier: form.tier || undefined,
        points_balance: form.points_balance ? Number(form.points_balance) : undefined,
        miles_balance: form.miles_balance ? Number(form.miles_balance) : undefined,
        expiry_date: form.expiry_date || undefined,
        notes: form.notes || undefined,
      })
      onSaved()
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold">Add Loyalty Programme</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Type</label>
              <select value={form.programme_type} onChange={e => set('programme_type', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                {(Object.keys(PROG_LABELS) as ProgType[]).map(t => (
                  <option key={t} value={t}>{PROG_ICONS[t]} {PROG_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Provider Name *</label>
              <input value={form.provider_name} onChange={e => set('provider_name', e.target.value)}
                placeholder="e.g. Caribbean Airlines, Marriott"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Membership Number</label>
              <input value={form.membership_number} onChange={e => set('membership_number', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Tier / Status</label>
              <input value={form.tier} onChange={e => set('tier', e.target.value)}
                placeholder="e.g. Gold, Platinum"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Opening Points</label>
              <input type="number" min="0" value={form.points_balance} onChange={e => set('points_balance', e.target.value)}
                placeholder="0"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Opening Miles</label>
              <input type="number" min="0" value={form.miles_balance} onChange={e => set('miles_balance', e.target.value)}
                placeholder="0"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Expiry Date</label>
              <input type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm resize-none" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            {saving ? 'Saving…' : 'Add Programme'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Programme Modal ──────────────────────────────────────────────────────

function EditProgrammeModal({ prog, onClose, onSaved }: { prog: LoyaltyProgramme; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    tier: prog.tier ?? '',
    membership_number: prog.membership_number ?? '',
    points_balance: String(prog.points_balance),
    miles_balance: String(prog.miles_balance),
    expiry_date: prog.expiry_date ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    setSaving(true); setError('')
    try {
      await lifestyleApi.updateProgramme(prog.id, {
        tier: form.tier || undefined,
        membership_number: form.membership_number || undefined,
        points_balance: Number(form.points_balance),
        miles_balance: Number(form.miles_balance),
        expiry_date: form.expiry_date || undefined,
      })
      onSaved()
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold">Edit — {prog.provider_name}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Membership Number</label>
              <input value={form.membership_number} onChange={e => set('membership_number', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Tier</label>
              <input value={form.tier} onChange={e => set('tier', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Points Balance</label>
              <input type="number" value={form.points_balance} onChange={e => set('points_balance', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Miles Balance</label>
              <input type="number" value={form.miles_balance} onChange={e => set('miles_balance', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Expiry Date</label>
              <input type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Transaction Modal ─────────────────────────────────────────────────────

function AddTransactionModal({ prog, onClose, onSaved }: { prog: LoyaltyProgramme; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    transaction_date: today(),
    transaction_type: 'EARN' as TxType,
    points_amount: '',
    miles_amount: '',
    description: '',
    reference_number: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    if (!form.description.trim()) { setError('Description is required.'); return }
    setSaving(true); setError('')
    try {
      await lifestyleApi.addTransaction(prog.id, {
        transaction_date: form.transaction_date,
        transaction_type: form.transaction_type,
        points_amount: form.points_amount ? Number(form.points_amount) : 0,
        miles_amount: form.miles_amount ? Number(form.miles_amount) : 0,
        description: form.description.trim(),
        reference_number: form.reference_number || undefined,
        idempotency_key: uuidv4(),
      })
      onSaved()
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold">Add Transaction — {prog.provider_name}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Date</label>
              <input type="date" value={form.transaction_date} onChange={e => set('transaction_date', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Type</label>
              <select value={form.transaction_type} onChange={e => set('transaction_type', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                {(Object.keys(TX_LABELS) as TxType[]).map(t => (
                  <option key={t} value={t}>{TX_LABELS[t]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Points</label>
              <input type="number" value={form.points_amount} onChange={e => set('points_amount', e.target.value)}
                placeholder="0"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Miles</label>
              <input type="number" value={form.miles_amount} onChange={e => set('miles_amount', e.target.value)}
                placeholder="0"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Description *</label>
            <input value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="e.g. CAL flight BW101 New York"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Reference Number</label>
            <input value={form.reference_number} onChange={e => set('reference_number', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50">
            {saving ? 'Saving…' : 'Record Transaction'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Programme Detail Panel ────────────────────────────────────────────────────

function ProgrammeDetail({ prog, onClose }: { prog: LoyaltyProgramme; onClose: () => void }) {
  const qc = useQueryClient()
  const [showEdit, setShowEdit] = useState(false)
  const [showAddTx, setShowAddTx] = useState(false)

  const { data: txs = [], isLoading } = useQuery({
    queryKey: ['lifestyle-txs', prog.id],
    queryFn: () => lifestyleApi.getTransactions(prog.id),
  })

  const isExpired = prog.expiry_date && prog.expiry_date < today()
  const isExpiringSoon = prog.expiry_date && !isExpired &&
    (new Date(prog.expiry_date).getTime() - Date.now()) < 90 * 86400 * 1000

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs px-2 py-0.5 rounded ${PROG_COLORS[prog.programme_type]}`}>
              {PROG_ICONS[prog.programme_type]} {PROG_LABELS[prog.programme_type]}
            </span>
            {prog.tier && <span className="text-xs bg-yellow-900 text-yellow-200 px-2 py-0.5 rounded">{prog.tier}</span>}
            {isExpired && <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded">Expired</span>}
            {isExpiringSoon && <span className="text-xs bg-orange-900 text-orange-300 px-2 py-0.5 rounded">Expiring Soon</span>}
          </div>
          <h3 className="text-xl font-bold">{prog.provider_name}</h3>
          {prog.membership_number && <p className="text-sm text-slate-400 mt-0.5">#{prog.membership_number}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowEdit(true)}
            className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded">Edit</button>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl px-1">✕</button>
        </div>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-slate-700 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-emerald-400">{fmtNum(prog.points_balance)}</div>
          <div className="text-xs text-slate-400 mt-0.5">Points</div>
        </div>
        <div className="bg-slate-700 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-blue-400">{fmtNum(prog.miles_balance)}</div>
          <div className="text-xs text-slate-400 mt-0.5">Miles</div>
        </div>
        <div className="bg-slate-700 rounded-lg p-3 text-center">
          <div className={`text-lg font-bold ${isExpired ? 'text-red-400' : isExpiringSoon ? 'text-orange-400' : 'text-slate-200'}`}>
            {prog.expiry_date ? fmtDate(prog.expiry_date) : '—'}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Expiry</div>
        </div>
      </div>

      {/* Transactions */}
      <div className="flex justify-between items-center mb-3">
        <h4 className="text-sm font-semibold text-slate-300">Transaction History</h4>
        <button onClick={() => setShowAddTx(true)}
          className="text-xs px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded">+ Add Transaction</button>
      </div>

      {isLoading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : txs.length === 0 ? (
        <p className="text-slate-500 text-sm italic">No transactions recorded yet.</p>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {txs.map(tx => (
            <div key={tx.id} className="flex items-center justify-between py-2 px-3 bg-slate-700/50 rounded text-sm">
              <div className="flex items-center gap-3">
                <span className="text-slate-400 text-xs w-24 shrink-0">{fmtDate(tx.transaction_date)}</span>
                <span className={`text-xs font-medium ${TX_COLORS[tx.transaction_type]}`}>{TX_LABELS[tx.transaction_type]}</span>
                <span className="text-slate-300">{tx.description}</span>
              </div>
              <div className="flex gap-4 text-xs shrink-0">
                {tx.points_amount !== 0 && (
                  <span className={tx.points_amount > 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {tx.points_amount > 0 ? '+' : ''}{fmtNum(tx.points_amount)} pts
                  </span>
                )}
                {tx.miles_amount !== 0 && (
                  <span className={tx.miles_amount > 0 ? 'text-blue-400' : 'text-red-400'}>
                    {tx.miles_amount > 0 ? '+' : ''}{fmtNum(tx.miles_amount)} mi
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showEdit && (
        <EditProgrammeModal prog={prog} onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); qc.invalidateQueries({ queryKey: ['lifestyle-programmes'] }) }} />
      )}
      {showAddTx && (
        <AddTransactionModal prog={prog} onClose={() => setShowAddTx(false)}
          onSaved={() => {
            setShowAddTx(false)
            qc.invalidateQueries({ queryKey: ['lifestyle-txs', prog.id] })
            qc.invalidateQueries({ queryKey: ['lifestyle-programmes'] })
          }} />
      )}
    </div>
  )
}

// ── Loyalty Tab ────────────────────────────────────────────────────────────────

function LoyaltyTab() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState<LoyaltyProgramme | null>(null)
  const [filterType, setFilterType] = useState<ProgType | 'ALL'>('ALL')

  const { data: programmes = [], isLoading } = useQuery({
    queryKey: ['lifestyle-programmes'],
    queryFn: () => lifestyleApi.getProgrammes(),
  })

  const filtered = filterType === 'ALL' ? programmes : programmes.filter(p => p.programme_type === filterType)

  const totalPoints = programmes.reduce((s, p) => s + p.points_balance, 0)
  const totalMiles = programmes.reduce((s, p) => s + p.miles_balance, 0)
  const expiringSoon = programmes.filter(p =>
    p.expiry_date && !isExpiredFn(p.expiry_date) && isExpiringSoonFn(p.expiry_date)
  )

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800 rounded-xl p-4">
          <div className="text-2xl font-bold text-emerald-400">{fmtNum(totalPoints)}</div>
          <div className="text-xs text-slate-400 mt-1">Total Points</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4">
          <div className="text-2xl font-bold text-blue-400">{fmtNum(totalMiles)}</div>
          <div className="text-xs text-slate-400 mt-1">Total Miles</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4">
          <div className={`text-2xl font-bold ${expiringSoon.length > 0 ? 'text-orange-400' : 'text-slate-400'}`}>
            {expiringSoon.length}
          </div>
          <div className="text-xs text-slate-400 mt-1">Expiring in 90 days</div>
        </div>
      </div>

      {expiringSoon.length > 0 && (
        <div className="bg-orange-900/30 border border-orange-700 rounded-lg px-4 py-3 text-sm text-orange-300">
          ⚠️ {expiringSoon.map(p => p.provider_name).join(', ')} — points/miles expiring soon!
        </div>
      )}

      {/* Filter + Add */}
      <div className="flex justify-between items-center">
        <div className="flex gap-2 flex-wrap">
          {(['ALL', ...Object.keys(PROG_LABELS)] as (ProgType | 'ALL')[]).map(t => (
            <button key={t} onClick={() => setFilterType(t)}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                filterType === t ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}>
              {t === 'ALL' ? 'All' : `${PROG_ICONS[t as ProgType]} ${PROG_LABELS[t as ProgType]}`}
            </button>
          ))}
        </div>
        <button onClick={() => setShowAdd(true)}
          className="text-sm px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium">
          + Add Programme
        </button>
      </div>

      {isLoading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-slate-500 text-sm italic">No loyalty programmes yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(p => {
            const expired = p.expiry_date && isExpiredFn(p.expiry_date)
            const expiring = p.expiry_date && !expired && isExpiringSoonFn(p.expiry_date)
            return (
              <button key={p.id} onClick={() => setSelected(selected?.id === p.id ? null : p)}
                className={`text-left bg-slate-800 rounded-xl p-4 border transition-colors ${
                  selected?.id === p.id ? 'border-blue-500' : 'border-slate-700 hover:border-slate-600'
                }`}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded ${PROG_COLORS[p.programme_type]}`}>
                        {PROG_ICONS[p.programme_type]} {PROG_LABELS[p.programme_type]}
                      </span>
                      {p.tier && <span className="text-xs bg-yellow-900 text-yellow-200 px-2 py-0.5 rounded">{p.tier}</span>}
                    </div>
                    <div className="font-semibold">{p.provider_name}</div>
                    {p.membership_number && <div className="text-xs text-slate-400">#{p.membership_number}</div>}
                  </div>
                  <div className="text-right">
                    {expired && <div className="text-xs text-red-400 mb-1">Expired</div>}
                    {expiring && <div className="text-xs text-orange-400 mb-1">Expiring soon</div>}
                    {p.expiry_date && <div className="text-xs text-slate-400">{fmtDate(p.expiry_date)}</div>}
                  </div>
                </div>
                <div className="flex gap-6">
                  <div>
                    <div className="text-lg font-bold text-emerald-400">{fmtNum(p.points_balance)}</div>
                    <div className="text-xs text-slate-400">Points</div>
                  </div>
                  {p.miles_balance > 0 && (
                    <div>
                      <div className="text-lg font-bold text-blue-400">{fmtNum(p.miles_balance)}</div>
                      <div className="text-xs text-slate-400">Miles</div>
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selected && (
        <ProgrammeDetail prog={selected} onClose={() => setSelected(null)} />
      )}

      {showAdd && (
        <AddProgrammeModal onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['lifestyle-programmes'] }) }} />
      )}
    </div>
  )
}

function isExpiredFn(date: string) { return date < today() }
function isExpiringSoonFn(date: string) {
  return (new Date(date).getTime() - Date.now()) < 90 * 86400 * 1000
}

// ── Add Tracker Entry Modal ────────────────────────────────────────────────────

function AddTrackerModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    entry_date: today(),
    metric_type: 'WEIGHT_KG' as MetricType,
    value: '',
    unit: METRIC_DEFAULT_UNIT['WEIGHT_KG'],
    source: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const handleMetricChange = (m: MetricType) => {
    setForm(p => ({ ...p, metric_type: m, unit: METRIC_DEFAULT_UNIT[m] }))
  }

  const submit = async () => {
    if (!form.value) { setError('Value is required.'); return }
    setSaving(true); setError('')
    try {
      await lifestyleApi.addTrackerEntry({
        entry_date: form.entry_date,
        metric_type: form.metric_type,
        value: Number(form.value),
        unit: form.unit,
        source: form.source || undefined,
        notes: form.notes || undefined,
      })
      onSaved()
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold">Log Health Metric</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Date</label>
              <input type="date" value={form.entry_date} onChange={e => set('entry_date', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Metric</label>
              <select value={form.metric_type} onChange={e => handleMetricChange(e.target.value as MetricType)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                {(Object.keys(METRIC_LABELS) as MetricType[]).map(m => (
                  <option key={m} value={m}>{METRIC_ICONS[m]} {METRIC_LABELS[m]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Value *</label>
              <input type="number" step="any" value={form.value} onChange={e => set('value', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Unit</label>
              <input value={form.unit} onChange={e => set('unit', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Source</label>
            <input value={form.source} onChange={e => set('source', e.target.value)}
              placeholder="e.g. Fitbit, Manual, Doctor"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm resize-none" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50">
            {saving ? 'Saving…' : 'Log Entry'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Tracker Tab ────────────────────────────────────────────────────────────────

function TrackerTab() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [filterMetric, setFilterMetric] = useState<MetricType | 'ALL'>('ALL')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['lifestyle-tracker', filterMetric, fromDate, toDate],
    queryFn: () => lifestyleApi.getTrackerEntries({
      metric_type: filterMetric !== 'ALL' ? filterMetric : undefined,
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
    }),
  })

  // Group entries by date for display
  const grouped = entries.reduce<Record<string, TrackerEntry[]>>((acc, e) => {
    acc[e.entry_date] = [...(acc[e.entry_date] ?? []), e]
    return acc
  }, {})

  // Latest value per metric for summary
  const latestByMetric: Partial<Record<MetricType, TrackerEntry>> = {}
  for (const e of [...entries].reverse()) {
    if (!latestByMetric[e.metric_type]) latestByMetric[e.metric_type] = e
  }

  return (
    <div className="space-y-6">
      {/* Latest readings summary */}
      {Object.keys(latestByMetric).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(Object.keys(latestByMetric) as MetricType[]).map(m => {
            const e = latestByMetric[m]!
            return (
              <div key={m} className="bg-slate-800 rounded-xl p-3">
                <div className="text-lg">{METRIC_ICONS[m]}</div>
                <div className="text-lg font-bold text-slate-100 mt-1">{e.value} <span className="text-sm text-slate-400">{e.unit}</span></div>
                <div className="text-xs text-slate-400 mt-0.5">{METRIC_LABELS[m]}</div>
                <div className="text-xs text-slate-500">{fmtDate(e.entry_date)}</div>
              </div>
            )
          })}
        </div>
      )}

      {/* Filters + Add */}
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div className="flex flex-wrap gap-2">
          {(['ALL', ...Object.keys(METRIC_LABELS)] as (MetricType | 'ALL')[]).map(m => (
            <button key={m} onClick={() => setFilterMetric(m)}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                filterMetric === m ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}>
              {m === 'ALL' ? 'All Metrics' : `${METRIC_ICONS[m as MetricType]} ${METRIC_LABELS[m as MetricType]}`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm" />
          </div>
          <button onClick={() => setShowAdd(true)}
            className="text-sm px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium">
            + Log Metric
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-slate-500 text-sm italic">No health entries yet.</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([date, dayEntries]) => (
              <div key={date}>
                <div className="text-xs font-semibold text-slate-400 mb-2">{fmtDate(date)}</div>
                <div className="space-y-1">
                  {dayEntries.map(e => (
                    <div key={e.id} className="flex items-center gap-4 bg-slate-800 rounded-lg px-4 py-2.5 text-sm">
                      <span className="text-base">{METRIC_ICONS[e.metric_type]}</span>
                      <span className="text-slate-300 w-48 shrink-0">{METRIC_LABELS[e.metric_type]}</span>
                      <span className="font-semibold text-white">{e.value}</span>
                      <span className="text-slate-400">{e.unit}</span>
                      {e.source && <span className="text-xs text-slate-500 ml-auto">via {e.source}</span>}
                      {e.notes && <span className="text-xs text-slate-500 italic">{e.notes}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {showAdd && (
        <AddTrackerModal onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false)
            qc.invalidateQueries({ queryKey: ['lifestyle-tracker'] })
          }} />
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'loyalty' | 'tracker'

export default function Lifestyle() {
  const [tab, setTab] = useState<Tab>('loyalty')

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">JAG Lifestyle</h1>
          <p className="text-slate-400 text-sm mt-1">Loyalty programmes & health tracker</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-slate-800 rounded-lg p-1 w-fit">
        {([
          ['loyalty', '⭐ Loyalty Programmes'],
          ['tracker', '❤️ Health Tracker'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'loyalty' && <LoyaltyTab />}
      {tab === 'tracker' && <TrackerTab />}
    </div>
  )
}
