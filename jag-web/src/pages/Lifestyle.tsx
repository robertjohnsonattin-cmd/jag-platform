import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

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
import { familyApi, type FamilyMember } from '../api/family'
import {
  medicalRecordsApi,
  type RecordType, type RecordStatus,
  type MedicalRecord, type MedicalProfile,
} from '../api/medical-records'

// Shared family-member directory (cached by query key — deduped across components).
function useFamilyMembers() {
  const { data: members = [] } = useQuery<FamilyMember[]>({
    queryKey: ['family-members'],
    queryFn: () => familyApi.list(),
    staleTime: 60_000,
  })
  const nameOf = (id: string | null | undefined): string | null => {
    if (!id) return null
    const m = members.find(x => x.id === id)
    return m ? `${m.first_name} ${m.last_name}` : null
  }
  return { members, nameOf }
}

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
  RESTING_HEART_RATE: 'Resting HR',
  CHOLESTEROL_TOTAL: 'Cholesterol — Total', CHOLESTEROL_LDL: 'Cholesterol — LDL',
  CHOLESTEROL_HDL: 'Cholesterol — HDL', TRIGLYCERIDES: 'Triglycerides', BLOOD_GLUCOSE: 'Blood Glucose',
  OTHER: 'Other',
}
const METRIC_ICONS: Record<MetricType, string> = {
  WEIGHT_KG: '⚖️', STEPS: '👣', SLEEP_HOURS: '😴', CALORIES: '🔥',
  EXERCISE_MINUTES: '🏃', BLOOD_PRESSURE_SYSTOLIC: '❤️', BLOOD_PRESSURE_DIASTOLIC: '❤️',
  RESTING_HEART_RATE: '💓',
  CHOLESTEROL_TOTAL: '🩸', CHOLESTEROL_LDL: '🩸', CHOLESTEROL_HDL: '🩸', TRIGLYCERIDES: '🩸', BLOOD_GLUCOSE: '🩸',
  OTHER: '📊',
}
const METRIC_DEFAULT_UNIT: Record<MetricType, string> = {
  WEIGHT_KG: 'kg', STEPS: 'steps', SLEEP_HOURS: 'hrs', CALORIES: 'kcal',
  EXERCISE_MINUTES: 'min', BLOOD_PRESSURE_SYSTOLIC: 'mmHg', BLOOD_PRESSURE_DIASTOLIC: 'mmHg',
  RESTING_HEART_RATE: 'bpm',
  CHOLESTEROL_TOTAL: 'mg/dL', CHOLESTEROL_LDL: 'mg/dL', CHOLESTEROL_HDL: 'mg/dL',
  TRIGLYCERIDES: 'mg/dL', BLOOD_GLUCOSE: 'mg/dL',
  OTHER: '',
}

const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  LAB_RESULT: 'Lab Result', IMAGING: 'Imaging', PRESCRIPTION: 'Prescription',
  CLINIC_CARD: 'Clinic Card', REFERRAL: 'Referral', DISCHARGE_SUMMARY: 'Discharge Summary',
  VISIT_NOTE: 'Visit Note', IMMUNIZATION: 'Immunization', DEVICE_EQUIPMENT: 'Device / Equipment',
  INVOICE: 'Invoice', CHRONOLOGY_SUMMARY: 'Chronology Summary', OTHER: 'Other',
}
const RECORD_TYPE_ICONS: Record<RecordType, string> = {
  LAB_RESULT: '🧪', IMAGING: '🩻', PRESCRIPTION: '💊', CLINIC_CARD: '🪪', REFERRAL: '📨',
  DISCHARGE_SUMMARY: '🏥', VISIT_NOTE: '📝', IMMUNIZATION: '💉', DEVICE_EQUIPMENT: '🦾',
  INVOICE: '🧾', CHRONOLOGY_SUMMARY: '📚', OTHER: '📄',
}
const RECORD_STATUS_COLORS: Record<RecordStatus, string> = {
  REVIEW: 'bg-orange-900 text-orange-200',
  APPROVED: 'bg-emerald-900 text-emerald-200',
  REJECTED: 'bg-red-900 text-red-300',
}

const today = () => new Date().toISOString().split('T')[0]
const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' })
const fmtNum = (n: number) => n.toLocaleString()

// ── Add Programme Modal ────────────────────────────────────────────────────────

function AddProgrammeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const { members } = useFamilyMembers()
  const [form, setForm] = useState({
    programme_type: 'AIRLINE' as ProgType,
    provider_name: '',
    membership_number: '',
    tier: '',
    points_balance: '',
    miles_balance: '',
    expiry_date: '',
    family_member_id: '',
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
        family_member_id: form.family_member_id || undefined,
        notes: form.notes || undefined,
      })
      onSaved()
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold">{t('lifestyle.addProgramme')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('crm.typeLabel')}</label>
              <select value={form.programme_type} onChange={e => set('programme_type', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                {(Object.keys(PROG_LABELS) as ProgType[]).map(pt => (
                  <option key={pt} value={pt}>{PROG_ICONS[pt]} {t(`lifestyle.progTypes.${pt}`, PROG_LABELS[pt])}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.providerNameStar')}</label>
              <input value={form.provider_name} onChange={e => set('provider_name', e.target.value)}
                placeholder="e.g. Caribbean Airlines, Marriott"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.membershipNumber')}</label>
              <input value={form.membership_number} onChange={e => set('membership_number', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.tierStatus')}</label>
              <input value={form.tier} onChange={e => set('tier', e.target.value)}
                placeholder="e.g. Gold, Platinum"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.openingPoints')}</label>
              <input type="number" min="0" value={form.points_balance} onChange={e => set('points_balance', e.target.value)}
                placeholder="0"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.openingMiles')}</label>
              <input type="number" min="0" value={form.miles_balance} onChange={e => set('miles_balance', e.target.value)}
                placeholder="0"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.expiryLabel')}</label>
              <input type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.belongsTo')}</label>
            <select value={form.family_member_id} onChange={e => set('family_member_id', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
              <option value="">{t('lifestyle.unassigned')}</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm resize-none" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">{t('common.cancel')}</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            {saving ? t('common.saving') : t('lifestyle.addProgrammeBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Programme Modal ──────────────────────────────────────────────────────

function EditProgrammeModal({ prog, onClose, onSaved }: { prog: LoyaltyProgramme; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const { members } = useFamilyMembers()
  const [form, setForm] = useState({
    tier: prog.tier ?? '',
    membership_number: prog.membership_number ?? '',
    points_balance: String(prog.points_balance),
    miles_balance: String(prog.miles_balance),
    expiry_date: prog.expiry_date ? prog.expiry_date.slice(0, 10) : '',
    family_member_id: prog.family_member_id ?? '',
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
        family_member_id: form.family_member_id || null,
      })
      onSaved()
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold">{t('lifestyle.editProgramme', { name: prog.provider_name })}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.membershipNumber')}</label>
              <input value={form.membership_number} onChange={e => set('membership_number', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.tier')}</label>
              <input value={form.tier} onChange={e => set('tier', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.pointsBalance')}</label>
              <input type="number" value={form.points_balance} onChange={e => set('points_balance', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.milesBalance')}</label>
              <input type="number" value={form.miles_balance} onChange={e => set('miles_balance', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.expiryLabel')}</label>
              <input type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.belongsTo')}</label>
            <select value={form.family_member_id} onChange={e => set('family_member_id', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
              <option value="">{t('lifestyle.unassigned')}</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
            </select>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">{t('common.cancel')}</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            {saving ? t('common.saving') : t('lifestyle.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Transaction Modal ─────────────────────────────────────────────────────

function AddTransactionModal({ prog, onClose, onSaved }: { prog: LoyaltyProgramme; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
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
          <h2 className="text-lg font-semibold">{t('lifestyle.addTransactionTitle', { name: prog.provider_name })}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.dateLabel')}</label>
              <input type="date" value={form.transaction_date} onChange={e => set('transaction_date', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('crm.typeLabel')}</label>
              <select value={form.transaction_type} onChange={e => set('transaction_type', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                {(Object.keys(TX_LABELS) as TxType[]).map(tp => (
                  <option key={tp} value={tp}>{t(`lifestyle.txTypes.${tp}`, TX_LABELS[tp])}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.points')}</label>
              <input type="number" value={form.points_amount} onChange={e => set('points_amount', e.target.value)}
                placeholder="0"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.miles')}</label>
              <input type="number" value={form.miles_amount} onChange={e => set('miles_amount', e.target.value)}
                placeholder="0"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.descriptionStar')}</label>
            <input value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="e.g. CAL flight BW101 New York"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.referenceNumber')}</label>
            <input value={form.reference_number} onChange={e => set('reference_number', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">{t('common.cancel')}</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50">
            {saving ? t('common.saving') : t('lifestyle.recordTxBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Programme Detail Panel ────────────────────────────────────────────────────

function ProgrammeDetail({ prog, onClose }: { prog: LoyaltyProgramme; onClose: () => void }) {
  const { t } = useTranslation()
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
              {PROG_ICONS[prog.programme_type]} {t(`lifestyle.progTypes.${prog.programme_type}`, PROG_LABELS[prog.programme_type])}
            </span>
            {prog.tier && <span className="text-xs bg-yellow-900 text-yellow-200 px-2 py-0.5 rounded">{prog.tier}</span>}
            {isExpired && <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded">{t('lifestyle.expiredBadge')}</span>}
            {isExpiringSoon && <span className="text-xs bg-orange-900 text-orange-300 px-2 py-0.5 rounded">{t('lifestyle.expiringSoonBadge')}</span>}
          </div>
          <h3 className="text-xl font-bold">{prog.provider_name}</h3>
          {prog.membership_number && <p className="text-sm text-slate-400 mt-0.5">#{prog.membership_number}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowEdit(true)}
            className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded">{t('common.edit')}</button>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl px-1">✕</button>
        </div>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-slate-700 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-emerald-400">{fmtNum(prog.points_balance)}</div>
          <div className="text-xs text-slate-400 mt-0.5">{t('lifestyle.points')}</div>
        </div>
        <div className="bg-slate-700 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-blue-400">{fmtNum(prog.miles_balance)}</div>
          <div className="text-xs text-slate-400 mt-0.5">{t('lifestyle.miles')}</div>
        </div>
        <div className="bg-slate-700 rounded-lg p-3 text-center">
          <div className={`text-lg font-bold ${isExpired ? 'text-red-400' : isExpiringSoon ? 'text-orange-400' : 'text-slate-200'}`}>
            {prog.expiry_date ? fmtDate(prog.expiry_date) : '—'}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{t('lifestyle.expiryLabel')}</div>
        </div>
      </div>

      {/* Transactions */}
      <div className="flex justify-between items-center mb-3">
        <h4 className="text-sm font-semibold text-slate-300">{t('lifestyle.txHistory')}</h4>
        <button onClick={() => setShowAddTx(true)}
          className="text-xs px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded">{t('lifestyle.addTxShort')}</button>
      </div>

      {isLoading ? (
        <p className="text-slate-500 text-sm">{t('common.loading')}</p>
      ) : txs.length === 0 ? (
        <p className="text-slate-500 text-sm italic">{t('lifestyle.noTxs')}</p>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {txs.map(tx => (
            <div key={tx.id} className="flex items-center justify-between py-2 px-3 bg-slate-700/50 rounded text-sm">
              <div className="flex items-center gap-3">
                <span className="text-slate-400 text-xs w-24 shrink-0">{fmtDate(tx.transaction_date)}</span>
                <span className={`text-xs font-medium ${TX_COLORS[tx.transaction_type]}`}>{t(`lifestyle.txTypes.${tx.transaction_type}`, TX_LABELS[tx.transaction_type])}</span>
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
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { members, nameOf } = useFamilyMembers()
  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState<LoyaltyProgramme | null>(null)
  const [filterType, setFilterType] = useState<ProgType | 'ALL'>('ALL')
  const [memberFilter, setMemberFilter] = useState('')

  const { data: programmes = [], isLoading } = useQuery({
    queryKey: ['lifestyle-programmes'],
    queryFn: () => lifestyleApi.getProgrammes(),
  })

  const filtered = programmes.filter(p =>
    (filterType === 'ALL' || p.programme_type === filterType) &&
    (!memberFilter || p.family_member_id === memberFilter),
  )

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
          <div className="text-xs text-slate-400 mt-1">{t('lifestyle.totalPoints')}</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4">
          <div className="text-2xl font-bold text-blue-400">{fmtNum(totalMiles)}</div>
          <div className="text-xs text-slate-400 mt-1">{t('lifestyle.totalMiles')}</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4">
          <div className={`text-2xl font-bold ${expiringSoon.length > 0 ? 'text-orange-400' : 'text-slate-400'}`}>
            {expiringSoon.length}
          </div>
          <div className="text-xs text-slate-400 mt-1">{t('lifestyle.expiring90d')}</div>
        </div>
      </div>

      {expiringSoon.length > 0 && (
        <div className="bg-orange-900/30 border border-orange-700 rounded-lg px-4 py-3 text-sm text-orange-300">
          ⚠️ {expiringSoon.map(p => p.provider_name).join(', ')} {t('lifestyle.expiringSoonAlert')}
        </div>
      )}

      {/* Filter + Add */}
      <div className="flex justify-between items-center">
        <div className="flex gap-2 flex-wrap">
          {(['ALL', ...Object.keys(PROG_LABELS)] as (ProgType | 'ALL')[]).map(pt => (
            <button key={pt} onClick={() => setFilterType(pt)}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                filterType === pt ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}>
              {pt === 'ALL' ? t('lifestyle.allFilter') : `${PROG_ICONS[pt as ProgType]} ${t(`lifestyle.progTypes.${pt}`, PROG_LABELS[pt as ProgType])}`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {members.length > 0 && (
            <select value={memberFilter} onChange={e => setMemberFilter(e.target.value)}
              className="text-xs bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200">
              <option value="">{t('lifestyle.allMembers')}</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
            </select>
          )}
          <button onClick={() => setShowAdd(true)}
            className="text-sm px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium">
            {t('lifestyle.addProgrammeShort')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-slate-500 text-sm">{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <p className="text-slate-500 text-sm italic">{t('lifestyle.noProgrammes')}</p>
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
                        {PROG_ICONS[p.programme_type]} {t(`lifestyle.progTypes.${p.programme_type}`, PROG_LABELS[p.programme_type])}
                      </span>
                      {p.tier && <span className="text-xs bg-yellow-900 text-yellow-200 px-2 py-0.5 rounded">{p.tier}</span>}
                    </div>
                    <div className="font-semibold">{p.provider_name}</div>
                    {p.membership_number && <div className="text-xs text-slate-400">#{p.membership_number}</div>}
                    {nameOf(p.family_member_id) && <div className="text-xs text-slate-500 mt-0.5">👤 {nameOf(p.family_member_id)}</div>}
                  </div>
                  <div className="text-right">
                    {expired && <div className="text-xs text-red-400 mb-1">{t('lifestyle.expiredBadge')}</div>}
                    {expiring && <div className="text-xs text-orange-400 mb-1">{t('lifestyle.expiringSoonShort')}</div>}
                    {p.expiry_date && <div className="text-xs text-slate-400">{fmtDate(p.expiry_date)}</div>}
                  </div>
                </div>
                <div className="flex gap-6">
                  <div>
                    <div className="text-lg font-bold text-emerald-400">{fmtNum(p.points_balance)}</div>
                    <div className="text-xs text-slate-400">{t('lifestyle.points')}</div>
                  </div>
                  {p.miles_balance > 0 && (
                    <div>
                      <div className="text-lg font-bold text-blue-400">{fmtNum(p.miles_balance)}</div>
                      <div className="text-xs text-slate-400">{t('lifestyle.miles')}</div>
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
  const { t } = useTranslation()
  const { members } = useFamilyMembers()
  const [form, setForm] = useState({
    entry_date: today(),
    metric_type: 'WEIGHT_KG' as MetricType,
    value: '',
    unit: METRIC_DEFAULT_UNIT['WEIGHT_KG'],
    family_member_id: '',
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
        family_member_id: form.family_member_id || undefined,
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
          <h2 className="text-lg font-semibold">{t('lifestyle.logHealthMetric')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.dateLabel')}</label>
              <input type="date" value={form.entry_date} onChange={e => set('entry_date', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.metricLabel')}</label>
              <select value={form.metric_type} onChange={e => handleMetricChange(e.target.value as MetricType)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                {(Object.keys(METRIC_LABELS) as MetricType[]).map(m => (
                  <option key={m} value={m}>{METRIC_ICONS[m]} {t(`lifestyle.metricTypes.${m}`, METRIC_LABELS[m])}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.valueStar')}</label>
              <input type="number" step="any" value={form.value} onChange={e => set('value', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.unitLabel')}</label>
              <input value={form.unit} onChange={e => set('unit', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.sourceLabel')}</label>
              <input value={form.source} onChange={e => set('source', e.target.value)}
                placeholder="e.g. Fitbit, Manual, Doctor"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.belongsTo')}</label>
              <select value={form.family_member_id} onChange={e => set('family_member_id', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                <option value="">{t('lifestyle.unassigned')}</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm resize-none" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">{t('common.cancel')}</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50">
            {saving ? t('common.saving') : t('lifestyle.logEntryBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Medical Profile Tab ──────────────────────────────────────────────────────
// Synthesized summary (diagnoses/medications/allergies/care team) — distinct from the
// raw per-document Records tab. This is what actually answers "what's going on with them."

function ProfileTab() {
  const { t } = useTranslation()
  const { members } = useFamilyMembers()
  const [selectedMember, setSelectedMember] = useState('')

  const eligibleMembers = members // any family member may have a profile

  const { data: profile, isLoading } = useQuery({
    queryKey: ['medical-profile', selectedMember],
    queryFn: () => medicalRecordsApi.getProfile(selectedMember),
    enabled: !!selectedMember,
  })

  if (eligibleMembers.length === 0) {
    return <p className="text-slate-500 text-sm italic">{t('medical.noFamilyMembers', 'Add a family member first (Family Registry page).')}</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-xs text-slate-400 mb-1">{t('medical.selectMember', 'Family member')}</label>
        <select value={selectedMember} onChange={e => setSelectedMember(e.target.value)}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm">
          <option value="">{t('medical.chooseMember', '— Choose —')}</option>
          {eligibleMembers.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
        </select>
      </div>

      {!selectedMember ? null : isLoading ? (
        <p className="text-slate-500 text-sm">{t('common.loading')}</p>
      ) : (
        <ProfileView profile={profile ?? null} />
      )}
    </div>
  )
}

function ProfileView({ profile }: { profile: MedicalProfile | null }) {
  const { t } = useTranslation()

  const diagnoses = profile?.active_diagnoses ?? []
  const medications = profile?.current_medications ?? []
  const allergies = profile?.allergies ?? []
  const careTeam = profile?.care_team ?? []

  const hasContent = diagnoses.length + medications.length + allergies.length + careTeam.length > 0 || !!profile?.summary_notes

  if (!hasContent) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 text-center">
        <p className="text-slate-400 text-sm">{t('medical.noProfileYet', 'No synthesized profile yet for this person. As medical records are approved, ask Claude to synthesize/update the profile summary from them.')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {profile?.last_synthesized_at && (
        <p className="text-xs text-slate-500">{t('medical.lastSynthesized', { date: fmtDate(profile.last_synthesized_at.slice(0, 10)), defaultValue: 'Last synthesized {{date}}' })}</p>
      )}

      {profile?.summary_notes && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">{t('medical.overview', 'Overview')}</h3>
          <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{profile.summary_notes}</p>
        </div>
      )}

      {diagnoses.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">🩺 {t('medical.activeDiagnoses', 'Active Diagnoses')}</h3>
          <div className="space-y-2">
            {diagnoses.map((d, i) => (
              <div key={i} className="flex items-start justify-between gap-4 bg-slate-900/40 rounded-lg px-3 py-2">
                <div>
                  <div className="font-medium text-slate-100">{d.name}</div>
                  {d.notes && <div className="text-xs text-slate-400 mt-0.5">{d.notes}</div>}
                </div>
                <div className="text-right shrink-0">
                  {d.status && <div className="text-xs bg-slate-700 rounded-full px-2 py-0.5 inline-block">{d.status}</div>}
                  {d.since && <div className="text-xs text-slate-500 mt-1">{t('medical.since', 'since')} {d.since}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {medications.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">💊 {t('medical.currentMedications', 'Current Medications')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {medications.map((m, i) => (
              <div key={i} className="bg-slate-900/40 rounded-lg px-3 py-2">
                <div className="font-medium text-slate-100">{m.name}</div>
                <div className="text-xs text-slate-400">{[m.dose, m.frequency].filter(Boolean).join(' · ')}</div>
                {m.prescribed_by && <div className="text-xs text-slate-500">{t('medical.prescribedBy', 'Prescribed by')} {m.prescribed_by}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {careTeam.length > 0 && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">👥 {t('medical.careTeam', 'Care Team')}</h3>
            <div className="space-y-2">
              {careTeam.map((c, i) => (
                <div key={i} className="text-sm">
                  <div className="font-medium text-slate-100">{c.name}</div>
                  <div className="text-xs text-slate-400">{[c.specialty, c.facility].filter(Boolean).join(' · ')}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {allergies.length > 0 && (
          <div className="bg-slate-800 rounded-xl border border-red-900/50 p-5">
            <h3 className="text-sm font-semibold text-red-300 mb-3">⚠️ {t('medical.allergies', 'Allergies')}</h3>
            <div className="space-y-1">
              {allergies.map((a, i) => (
                <div key={i} className="text-sm">
                  <span className="font-medium text-slate-100">{a.allergen}</span>
                  {a.reaction && <span className="text-xs text-slate-400 ml-2">{a.reaction}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500 italic">
        {t('medical.profileHint', 'This summary is synthesized from approved records, not auto-generated — ask Claude to refresh it after new records are approved.')}
      </p>
    </div>
  )
}

// ── Medical Record Detail Panel ────────────────────────────────────────────────

function MedicalRecordDetail({ record, onClose, onChanged }: { record: MedicalRecord; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation()
  const { nameOf } = useFamilyMembers()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const approve = async () => {
    setBusy(true); setError('')
    try { await medicalRecordsApi.approve(record.id); onChanged() }
    catch (e) { setError((e as Error).message); setBusy(false) }
  }
  const reject = async () => {
    setBusy(true); setError('')
    try { await medicalRecordsApi.reject(record.id); onChanged() }
    catch (e) { setError((e as Error).message); setBusy(false) }
  }
  const remove = async () => {
    if (!confirm(t('medical.confirmDelete', 'Delete this record permanently?'))) return
    setBusy(true); setError('')
    try { await medicalRecordsApi.delete(record.id); onChanged() }
    catch (e) { setError((e as Error).message); setBusy(false) }
  }

  const detailEntries = Object.entries(record.details ?? {}).filter(([k]) => k !== 'lifestyle_metrics')
  const linkedMetrics = (record.details?.lifestyle_metrics as Array<{ metric_type: string; value: number; unit: string; entry_date: string }> | undefined) ?? []

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-200">
              {RECORD_TYPE_ICONS[record.record_type]} {t(`medical.recordTypes.${record.record_type}`, RECORD_TYPE_LABELS[record.record_type])}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded ${RECORD_STATUS_COLORS[record.status]}`}>
              {t(`medical.status.${record.status}`, record.status)}
            </span>
            {record.specialty && <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">{record.specialty}</span>}
          </div>
          <h3 className="text-xl font-bold">{record.title}</h3>
          <p className="text-sm text-slate-400 mt-0.5">
            {nameOf(record.family_member_id) ?? '—'}
            {record.record_date && ` · ${fmtDate(record.record_date)}${record.record_date_end ? ` – ${fmtDate(record.record_date_end)}` : ''}`}
          </p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-xl px-1">✕</button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
        {record.provider_name && (
          <div><span className="text-slate-400">{t('medical.provider', 'Provider')}: </span><span className="text-slate-200">{record.provider_name}</span></div>
        )}
        {record.facility_name && (
          <div><span className="text-slate-400">{t('medical.facility', 'Facility')}: </span><span className="text-slate-200">{record.facility_name}</span></div>
        )}
        {record.source_file_name && (
          <div className="col-span-2"><span className="text-slate-400">{t('medical.sourceFile', 'Source file')}: </span><span className="text-slate-300 font-mono text-xs">{record.source_file_name}</span></div>
        )}
      </div>

      {record.summary && (
        <div className="mb-4">
          <div className="text-xs font-semibold text-slate-400 mb-1">{t('medical.summary', 'Summary')}</div>
          <p className="text-sm text-slate-200 whitespace-pre-wrap">{record.summary}</p>
        </div>
      )}

      {detailEntries.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-semibold text-slate-400 mb-2">{t('medical.details', 'Extracted Details')}</div>
          <div className="bg-slate-900/50 rounded-lg divide-y divide-slate-700/50">
            {detailEntries.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-3 py-1.5 text-sm">
                <span className="text-slate-400 shrink-0">{k}</span>
                <span className="text-slate-200 text-right">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {linkedMetrics.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-semibold text-slate-400 mb-2">
            {t('medical.linkedMetrics', 'Will log to Health Metrics on approval')}
          </div>
          <div className="flex flex-wrap gap-2">
            {linkedMetrics.map((m, i) => (
              <span key={i} className="text-xs bg-slate-700 rounded-full px-3 py-1">
                {t(`lifestyle.metricTypes.${m.metric_type}`, m.metric_type)}: {m.value} {m.unit} ({fmtDate(m.entry_date)})
              </span>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      <div className="flex gap-2 pt-2 border-t border-slate-700">
        {record.status === 'REVIEW' && (
          <>
            <button onClick={approve} disabled={busy}
              className="text-xs px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded disabled:opacity-50">
              ✓ {t('medical.approve', 'Approve')}
            </button>
            <button onClick={reject} disabled={busy}
              className="text-xs px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-50">
              {t('medical.reject', 'Reject')}
            </button>
          </>
        )}
        <button onClick={remove} disabled={busy}
          className="text-xs px-4 py-2 bg-red-900/50 hover:bg-red-900 text-red-300 rounded ml-auto disabled:opacity-50">
          {t('common.delete', 'Delete')}
        </button>
      </div>
    </div>
  )
}

// ── Medical Records Tab ──────────────────────────────────────────────────────

function MedicalRecordsTab() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { members, nameOf } = useFamilyMembers()
  const [selected, setSelected] = useState<MedicalRecord | null>(null)
  const [statusFilter, setStatusFilter] = useState<RecordStatus | 'ALL'>('ALL')
  const [memberFilter, setMemberFilter] = useState('')

  const { data: records = [], isLoading, refetch } = useQuery({
    queryKey: ['medical-records', memberFilter],
    queryFn: () => medicalRecordsApi.list({ family_member_id: memberFilter || undefined }),
  })

  const filtered = records.filter(r => statusFilter === 'ALL' || r.status === statusFilter)
  const reviewCount = records.filter(r => r.status === 'REVIEW').length

  const refresh = () => {
    setSelected(null)
    qc.invalidateQueries({ queryKey: ['medical-records'] })
    qc.invalidateQueries({ queryKey: ['lifestyle-tracker'] })
    refetch()
  }

  return (
    <div className="space-y-6">
      {reviewCount > 0 && (
        <div className="bg-orange-900/30 border border-orange-700 rounded-lg px-4 py-3 text-sm text-orange-300">
          ⚠️ {t('medical.pendingReviewAlert', { count: reviewCount, defaultValue: '{{count}} record(s) awaiting review' })}
        </div>
      )}

      <div className="flex flex-wrap justify-between items-end gap-4">
        <div className="flex flex-wrap gap-2">
          {(['ALL', 'REVIEW', 'APPROVED', 'REJECTED'] as (RecordStatus | 'ALL')[]).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                statusFilter === s ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}>
              {s === 'ALL' ? t('lifestyle.allFilter') : t(`medical.status.${s}`, s)}
            </button>
          ))}
        </div>
        {members.length > 0 && (
          <select value={memberFilter} onChange={e => setMemberFilter(e.target.value)}
            className="text-xs bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200">
            <option value="">{t('lifestyle.allMembers')}</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
          </select>
        )}
      </div>

      {isLoading ? (
        <p className="text-slate-500 text-sm">{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <p className="text-slate-500 text-sm italic">{t('medical.noRecords', 'No medical records yet.')}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(r => (
            <button key={r.id} onClick={() => setSelected(selected?.id === r.id ? null : r)}
              className={`text-left bg-slate-800 rounded-xl p-4 border transition-colors ${
                selected?.id === r.id ? 'border-blue-500' : 'border-slate-700 hover:border-slate-600'
              }`}>
              <div className="flex justify-between items-start mb-2">
                <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-200">
                  {RECORD_TYPE_ICONS[r.record_type]} {t(`medical.recordTypes.${r.record_type}`, RECORD_TYPE_LABELS[r.record_type])}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded ${RECORD_STATUS_COLORS[r.status]}`}>
                  {t(`medical.status.${r.status}`, r.status)}
                </span>
              </div>
              <div className="font-semibold">{r.title}</div>
              <div className="text-xs text-slate-400 mt-0.5">
                {nameOf(r.family_member_id) ?? '—'}{r.specialty ? ` · ${r.specialty}` : ''}
                {r.record_date ? ` · ${fmtDate(r.record_date)}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <MedicalRecordDetail record={selected} onClose={() => setSelected(null)} onChanged={refresh} />
      )}
    </div>
  )
}

// ── Tracker Tab ────────────────────────────────────────────────────────────────

function TrackerTab() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { members } = useFamilyMembers()
  const [showAdd, setShowAdd] = useState(false)
  const [filterMetric, setFilterMetric] = useState<MetricType | 'ALL'>('ALL')
  const [memberFilter, setMemberFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['lifestyle-tracker', filterMetric, memberFilter, fromDate, toDate],
    queryFn: () => lifestyleApi.getTrackerEntries({
      metric_type: filterMetric !== 'ALL' ? filterMetric : undefined,
      family_member_id: memberFilter || undefined,
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
                <div className="text-xs text-slate-400 mt-0.5">{t(`lifestyle.metricTypes.${m}`, METRIC_LABELS[m])}</div>
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
              {m === 'ALL' ? t('lifestyle.allMetrics') : `${METRIC_ICONS[m as MetricType]} ${t(`lifestyle.metricTypes.${m}`, METRIC_LABELS[m as MetricType])}`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {members.length > 0 && (
            <select value={memberFilter} onChange={e => setMemberFilter(e.target.value)}
              className="text-xs bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200">
              <option value="">{t('lifestyle.allMembers')}</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
            </select>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">{t('common.from')}</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">{t('common.to')}</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm" />
          </div>
          <button onClick={() => setShowAdd(true)}
            className="text-sm px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium">
            {t('lifestyle.logMetricShort')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-slate-500 text-sm">{t('common.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="text-slate-500 text-sm italic">{t('lifestyle.noEntries')}</p>
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
                      <span className="text-slate-300 w-48 shrink-0">{t(`lifestyle.metricTypes.${e.metric_type}`, METRIC_LABELS[e.metric_type])}</span>
                      <span className="font-semibold text-white">{e.value}</span>
                      <span className="text-slate-400">{e.unit}</span>
                      {e.source && <span className="text-xs text-slate-500 ml-auto">{t('lifestyle.viaSource', { source: e.source })}</span>}
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

type Tab = 'loyalty' | 'medical'
type MedicalSubTab = 'profile' | 'records' | 'biometrics'

export default function Lifestyle() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('loyalty')
  const [medicalSubTab, setMedicalSubTab] = useState<MedicalSubTab>('profile')

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('lifestyle.title')}</h1>
          <p className="text-slate-400 text-sm mt-1">{t('lifestyle.subtitle')}</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-slate-800 rounded-lg p-1 w-fit overflow-x-auto">
        {([
          ['loyalty', t('lifestyle.tabLoyalty')],
          ['medical', t('lifestyle.tabMedical', '🩺 Medical Records')],
        ] as [Tab, string][]).map(([tb, label]) => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
              tab === tb ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'loyalty' && <LoyaltyTab />}

      {tab === 'medical' && (
        <div>
          <div className="flex gap-1 mb-5 bg-slate-800/60 rounded-lg p-1 w-fit overflow-x-auto">
            {([
              ['profile', t('medical.subTabProfile', '🗂 Profile')],
              ['records', t('medical.subTabRecords', '📁 Records')],
              ['biometrics', t('medical.subTabBiometrics', '📈 Biometrics')],
            ] as [MedicalSubTab, string][]).map(([tb, label]) => (
              <button key={tb} onClick={() => setMedicalSubTab(tb)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  medicalSubTab === tb ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'
                }`}>
                {label}
              </button>
            ))}
          </div>
          {medicalSubTab === 'profile' && <ProfileTab />}
          {medicalSubTab === 'records' && <MedicalRecordsTab />}
          {medicalSubTab === 'biometrics' && <TrackerTab />}
        </div>
      )}
    </div>
  )
}
