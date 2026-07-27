import { useState, useEffect, useRef } from 'react'
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
import { clinicRegistrationsApi, type ClinicRegistration } from '../api/clinic-registrations'

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
  PSA: 'PSA', ESR: 'ESR', ACE_LEVEL: 'ACE Level', CREATININE: 'Creatinine', AST: 'AST', ALT: 'ALT',
  WBC: 'White Blood Cell Count', HEMOGLOBIN: 'Haemoglobin', HBA1C: 'HbA1c', BUN: 'BUN', TSH: 'TSH', VITAMIN_B12: 'Vitamin B12', FREE_T4: 'Free T4',
  RBC: 'Red Blood Cell Count', HCT: 'Haematocrit', MCV: 'MCV', MCH: 'MCH', MCHC: 'MCHC', RDW: 'RDW',
  PLATELETS: 'Platelets', MPV: 'MPV',
  NEUTROPHILS_PCT: 'Neutrophils (%)', LYMPHOCYTES_PCT: 'Lymphocytes (%)', MONOCYTES_PCT: 'Monocytes (%)',
  EOSINOPHILS_PCT: 'Eosinophils (%)', BASOPHILS_PCT: 'Basophils (%)',
  NEUTROPHILS_ABSOLUTE: 'Neutrophils (abs)', LYMPHOCYTES_ABSOLUTE: 'Lymphocytes (abs)', MONOCYTES_ABSOLUTE: 'Monocytes (abs)',
  EOSINOPHILS_ABSOLUTE: 'Eosinophils (abs)', BASOPHILS_ABSOLUTE: 'Basophils (abs)',
  ALKALINE_PHOSPHATASE: 'Alkaline Phosphatase', SODIUM: 'Sodium', POTASSIUM: 'Potassium', CHLORIDE: 'Chloride',
  TOTAL_PROTEIN: 'Total Protein',
  OTHER: 'Other',
}
const METRIC_ICONS: Record<MetricType, string> = {
  WEIGHT_KG: '⚖️', STEPS: '👣', SLEEP_HOURS: '😴', CALORIES: '🔥',
  EXERCISE_MINUTES: '🏃', BLOOD_PRESSURE_SYSTOLIC: '❤️', BLOOD_PRESSURE_DIASTOLIC: '❤️',
  RESTING_HEART_RATE: '💓',
  CHOLESTEROL_TOTAL: '🩸', CHOLESTEROL_LDL: '🩸', CHOLESTEROL_HDL: '🩸', TRIGLYCERIDES: '🩸', BLOOD_GLUCOSE: '🩸',
  PSA: '🧪', ESR: '🧪', ACE_LEVEL: '🧪', CREATININE: '🧪', AST: '🧪', ALT: '🧪',
  WBC: '🧪', HEMOGLOBIN: '🧪', HBA1C: '🧪', BUN: '🧪', TSH: '🧪', VITAMIN_B12: '🧪', FREE_T4: '🧪',
  RBC: '🧪', HCT: '🧪', MCV: '🧪', MCH: '🧪', MCHC: '🧪', RDW: '🧪', PLATELETS: '🧪', MPV: '🧪',
  NEUTROPHILS_PCT: '🧪', LYMPHOCYTES_PCT: '🧪', MONOCYTES_PCT: '🧪', EOSINOPHILS_PCT: '🧪', BASOPHILS_PCT: '🧪',
  NEUTROPHILS_ABSOLUTE: '🧪', LYMPHOCYTES_ABSOLUTE: '🧪', MONOCYTES_ABSOLUTE: '🧪', EOSINOPHILS_ABSOLUTE: '🧪', BASOPHILS_ABSOLUTE: '🧪',
  ALKALINE_PHOSPHATASE: '🧪', SODIUM: '🧪', POTASSIUM: '🧪', CHLORIDE: '🧪', TOTAL_PROTEIN: '🧪',
  OTHER: '📊',
}
const METRIC_DEFAULT_UNIT: Record<MetricType, string> = {
  WEIGHT_KG: 'kg', STEPS: 'steps', SLEEP_HOURS: 'hrs', CALORIES: 'kcal',
  EXERCISE_MINUTES: 'min', BLOOD_PRESSURE_SYSTOLIC: 'mmHg', BLOOD_PRESSURE_DIASTOLIC: 'mmHg',
  RESTING_HEART_RATE: 'bpm',
  PSA: 'ng/mL', ESR: 'mm/hr', ACE_LEVEL: 'U/L', CREATININE: 'mg/dL', AST: 'IU/L', ALT: 'IU/L',
  WBC: 'x10^3/uL', HEMOGLOBIN: 'g/dL', HBA1C: '%', BUN: 'mg/dL', TSH: 'uIU/mL', VITAMIN_B12: 'pg/mL', FREE_T4: 'ng/dL',
  CHOLESTEROL_TOTAL: 'mg/dL', CHOLESTEROL_LDL: 'mg/dL', CHOLESTEROL_HDL: 'mg/dL',
  TRIGLYCERIDES: 'mg/dL', BLOOD_GLUCOSE: 'mg/dL',
  RBC: 'x10^6/uL', HCT: '%', MCV: 'fL', MCH: 'pg', MCHC: 'g/dL', RDW: '%', PLATELETS: 'x10^3/uL', MPV: 'fL',
  NEUTROPHILS_PCT: '%', LYMPHOCYTES_PCT: '%', MONOCYTES_PCT: '%', EOSINOPHILS_PCT: '%', BASOPHILS_PCT: '%',
  NEUTROPHILS_ABSOLUTE: 'x10^3/uL', LYMPHOCYTES_ABSOLUTE: 'x10^3/uL', MONOCYTES_ABSOLUTE: 'x10^3/uL',
  EOSINOPHILS_ABSOLUTE: 'x10^3/uL', BASOPHILS_ABSOLUTE: 'x10^3/uL',
  ALKALINE_PHOSPHATASE: 'U/L', SODIUM: 'mmol/L', POTASSIUM: 'mmol/L', CHLORIDE: 'mmol/L', TOTAL_PROTEIN: 'g/dL',
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
// entry_date/record_date are PG DATE columns — they can arrive as full ISO datetime
// strings (e.g. "2024-03-27T00:00:00.000Z") rather than plain YYYY-MM-DD. Slice to the
// date portion first so appending 'T00:00:00' below doesn't produce an invalid string.
const fmtDate = (d: string) => new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' })
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
  const member = eligibleMembers.find(m => m.id === selectedMember) ?? null

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
        <ProfileView profile={profile ?? null} member={member} />
      )}
    </div>
  )
}

// Builds a clean, black-on-white printable summary of a family member's medical
// profile — meant to be handed (printed or PDF'd) to a treating doctor. Rendered
// entirely client-side (the profile is already loaded via React Query — no server
// HTML endpoint needed, same rationale as the WhatsApp receipt "Print/PDF" button).
function ageFromDob(dob: string): number {
  const [y, m, d] = dob.slice(0, 10).split('-').map(Number)
  const today = new Date()
  let age = today.getFullYear() - y
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--
  return age
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildProfilePrintHtml(member: FamilyMember, profile: MedicalProfile): string {
  const patientName = escapeHtml(`${member.first_name} ${member.last_name}`)
  const dobLine = member.date_of_birth
    ? `${fmtDate(member.date_of_birth)} (age ${ageFromDob(member.date_of_birth)})`
    : 'Not on file'
  const generatedOn = new Date().toLocaleDateString('en-TT', { day: '2-digit', month: 'long', year: 'numeric' })
  const lastSynth = profile.last_synthesized_at ? fmtDate(profile.last_synthesized_at.slice(0, 10)) : 'Never'

  const diagnosesHtml = (profile.active_diagnoses ?? []).map(d => `
    <tr>
      <td><strong>${escapeHtml(d.name)}</strong>${d.notes ? `<div class="notes">${escapeHtml(d.notes)}</div>` : ''}</td>
      <td>${escapeHtml(d.status ?? '')}</td>
      <td>${escapeHtml(d.since ?? '')}</td>
    </tr>`).join('')

  const medsHtml = (profile.current_medications ?? []).map(m => `
    <tr>
      <td><strong>${escapeHtml(m.name)}</strong></td>
      <td>${escapeHtml([m.dose, m.frequency].filter(Boolean).join(' — '))}</td>
      <td>${escapeHtml(m.prescribed_by ?? '')}</td>
      <td>${escapeHtml(m.since ?? '')}</td>
    </tr>`).join('')

  const allergiesHtml = (profile.allergies ?? []).map(a =>
    `<li><strong>${escapeHtml(a.allergen)}</strong>${a.reaction ? ` — ${escapeHtml(a.reaction)}` : ''}</li>`).join('')

  const careTeamHtml = (profile.care_team ?? []).map(c => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.specialty ?? '')}</td>
      <td>${escapeHtml(c.facility ?? '')}</td>
      <td>${escapeHtml(c.phone ?? '')}</td>
    </tr>`).join('')

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Medical Summary — ${patientName}</title>
<style>
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; margin: 0; padding: 24px; font-size: 13px; line-height: 1.5; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1.5px solid #1a1a1a; text-transform: uppercase; letter-spacing: 0.03em; }
  .subtitle { color: #555; font-size: 12px; margin-bottom: 18px; }
  .patient-box { display: flex; justify-content: space-between; border: 1px solid #999; border-radius: 6px; padding: 12px 16px; margin-bottom: 8px; }
  .patient-box .field { font-size: 12px; }
  .patient-box .field .label { color: #666; display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
  .patient-box .field.blood-type { font-weight: bold; color: #b00; font-size: 15px; }
  .meta { font-size: 10px; color: #777; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #666; padding: 3px 8px 3px 0; border-bottom: 1px solid #ccc; }
  td { padding: 6px 8px 6px 0; vertical-align: top; border-bottom: 1px solid #eee; }
  td .notes { font-size: 11px; color: #555; margin-top: 2px; }
  ul { margin: 0; padding-left: 18px; }
  .overview { white-space: pre-wrap; }
  .allergy-box { border: 1.5px solid #b00; border-radius: 6px; padding: 10px 14px; background: #fff5f5; }
  .allergy-box h2 { color: #b00; border-color: #b00; }
  .empty { color: #888; font-style: italic; font-size: 12px; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 10px; color: #777; }
  @media print { .no-print { display: none; } }
</style></head>
<body>
  <div class="no-print" style="text-align:right; margin-bottom: 12px;">
    <button onclick="window.print()" style="padding:8px 16px; font-size:13px; cursor:pointer;">Print</button>
  </div>

  <h1>Medical Summary</h1>
  <div class="subtitle">Prepared for review by a treating medical practitioner</div>

  <div class="patient-box">
    <div class="field"><span class="label">Patient</span>${patientName}</div>
    <div class="field"><span class="label">Date of Birth</span>${dobLine}</div>
    <div class="field blood-type"><span class="label" style="color:#b00;">Blood Type</span>${escapeHtml(profile.blood_type ?? 'Not on file')}</div>
    <div class="field"><span class="label">Generated</span>${generatedOn}</div>
  </div>
  <div class="meta">Profile last synthesized: ${lastSynth} — this summary reflects the family's own JAG Holdings medical record system and is not a substitute for the patient's full clinical chart.</div>

  <h2>Overview</h2>
  ${profile.summary_notes ? `<div class="overview">${escapeHtml(profile.summary_notes)}</div>` : '<p class="empty">No overview on file.</p>'}

  <h2>Active Diagnoses</h2>
  ${diagnosesHtml ? `<table><thead><tr><th>Diagnosis</th><th>Status</th><th>Since</th></tr></thead><tbody>${diagnosesHtml}</tbody></table>` : '<p class="empty">None on file.</p>'}

  <h2>Current Medications</h2>
  ${medsHtml ? `<table><thead><tr><th>Medication</th><th>Dose / Frequency</th><th>Prescribed By</th><th>Since</th></tr></thead><tbody>${medsHtml}</tbody></table>` : '<p class="empty">None on file.</p>'}

  ${allergiesHtml ? `<div class="allergy-box"><h2 style="margin-top:0; border-bottom:none;">⚠ Allergies</h2><ul>${allergiesHtml}</ul></div>` : ''}

  <h2>Care Team</h2>
  ${careTeamHtml ? `<table><thead><tr><th>Name</th><th>Specialty</th><th>Facility</th><th>Phone</th></tr></thead><tbody>${careTeamHtml}</tbody></table>` : '<p class="empty">None on file.</p>'}

  <div class="footer">Generated by JAG Holdings — Medical Records module. Please verify all details with the patient/family before relying on this summary clinically.</div>
</body></html>`
}

function printMedicalProfile(member: FamilyMember, profile: MedicalProfile) {
  const w = window.open('', '_blank')
  if (!w) return
  w.document.open()
  w.document.write(buildProfilePrintHtml(member, profile))
  w.document.close()
}

function ProfileView({ profile, member }: { profile: MedicalProfile | null; member: FamilyMember | null }) {
  const { t } = useTranslation()

  const diagnoses = profile?.active_diagnoses ?? []
  const medications = profile?.current_medications ?? []
  const allergies = profile?.allergies ?? []
  const careTeam = profile?.care_team ?? []

  const hasContent = diagnoses.length + medications.length + allergies.length + careTeam.length > 0 || !!profile?.summary_notes || !!profile?.blood_type

  if (!hasContent) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 text-center">
        <p className="text-slate-400 text-sm">{t('medical.noProfileYet', 'No synthesized profile yet for this person. As medical records are approved, ask Claude to synthesize/update the profile summary from them.')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-red-950/40 border border-red-800 rounded-lg px-4 py-2 flex items-center gap-2 text-sm">
        <span className="text-red-300 font-semibold">🩸 {t('medical.bloodType', 'Blood Type')}:</span>
        <span className="text-red-100 font-bold">{profile?.blood_type || t('medical.notOnFile', 'Not on file')}</span>
      </div>
      <div className="flex items-center justify-between">
        {profile?.last_synthesized_at ? (
          <p className="text-xs text-slate-500">{t('medical.lastSynthesized', { date: fmtDate(profile.last_synthesized_at.slice(0, 10)), defaultValue: 'Last synthesized {{date}}' })}</p>
        ) : <span />}
        {member && profile && (
          <button onClick={() => printMedicalProfile(member, profile)}
            className="text-xs px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium">
            🖨 {t('medical.printForDoctor', 'Print for Doctor')}
          </button>
        )}
      </div>

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
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <EditMedicalRecordForm record={record}
        onCancel={() => setEditing(false)}
        onSaved={() => { setEditing(false); onChanged() }} />
    )
  }

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
  const toggleVerification = async () => {
    setBusy(true); setError('')
    try { await medicalRecordsApi.update(record.id, { needs_verification: !record.needs_verification }); onChanged() }
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
            {record.needs_verification && (
              <span className="text-xs bg-amber-900 text-amber-200 px-2 py-0.5 rounded">
                ⚠ {t('medical.needsVerification', 'Needs Verification')}
              </span>
            )}
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
        <button onClick={toggleVerification} disabled={busy}
          className="text-xs px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-50">
          {record.needs_verification ? t('medical.markVerified', '✓ Mark Verified') : t('medical.flagForVerification', '⚠ Flag for Verification')}
        </button>
        <button onClick={() => setEditing(true)} disabled={busy}
          className="text-xs px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-50">
          ✎ {t('common.edit', 'Edit')}
        </button>
        <button onClick={remove} disabled={busy}
          className="text-xs px-4 py-2 bg-red-900/50 hover:bg-red-900 text-red-300 rounded ml-auto disabled:opacity-50">
          {t('common.delete', 'Delete')}
        </button>
      </div>
    </div>
  )
}

// ── Edit Medical Record Form ─────────────────────────────────────────────────
// Lets a reviewer correct a record's fields (and its extracted details, including
// the lifestyle_metrics that get pushed to Biometrics on approval) before approving it.

function EditMedicalRecordForm({ record, onCancel, onSaved }: { record: MedicalRecord; onCancel: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const { members, nameOf } = useFamilyMembers()
  const [form, setForm] = useState({
    family_member_id: record.family_member_id,
    record_type: record.record_type,
    specialty: record.specialty ?? '',
    provider_name: record.provider_name ?? '',
    facility_name: record.facility_name ?? '',
    record_date: record.record_date?.slice(0, 10) ?? '',
    record_date_end: record.record_date_end?.slice(0, 10) ?? '',
    title: record.title,
    summary: record.summary ?? '',
  })
  const [detailsText, setDetailsText] = useState(() => JSON.stringify(record.details ?? {}, null, 2))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    if (!form.title.trim()) { setError(t('medical.titleRequired', 'Title is required.')); return }
    let details: Record<string, unknown>
    try { details = JSON.parse(detailsText) }
    catch { setError(t('medical.invalidDetailsJson', 'Extracted Details is not valid JSON — check for a missing comma or bracket.')); return }
    setSaving(true); setError('')
    try {
      await medicalRecordsApi.update(record.id, {
        family_member_id: form.family_member_id,
        record_type: form.record_type,
        specialty: form.specialty || undefined,
        provider_name: form.provider_name || undefined,
        facility_name: form.facility_name || undefined,
        record_date: form.record_date || undefined,
        record_date_end: form.record_date_end || undefined,
        title: form.title.trim(),
        summary: form.summary || undefined,
        details,
      })
      onSaved()
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <div className="bg-slate-800 rounded-xl border border-blue-600 p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">✎ {t('medical.editRecord', 'Edit Record')}</h3>
        <button onClick={onCancel} className="text-slate-400 hover:text-white text-xl px-1">✕</button>
      </div>
      <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('medical.selectMember', 'Family member')}</label>
          <select value={form.family_member_id} onChange={e => set('family_member_id', e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
            {members.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
            {!members.some(m => m.id === form.family_member_id) && (
              <option value={form.family_member_id}>{nameOf(form.family_member_id) ?? form.family_member_id}</option>
            )}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('crm.typeLabel')}</label>
            <select value={form.record_type} onChange={e => set('record_type', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
              {(Object.keys(RECORD_TYPE_LABELS) as RecordType[]).map(rt => (
                <option key={rt} value={rt}>{RECORD_TYPE_ICONS[rt]} {t(`medical.recordTypes.${rt}`, RECORD_TYPE_LABELS[rt])}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('medical.specialty', 'Specialty')}</label>
            <input value={form.specialty} onChange={e => set('specialty', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('medical.titleStar', 'Title *')}</label>
          <input value={form.title} onChange={e => set('title', e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('medical.provider', 'Provider')}</label>
            <input value={form.provider_name} onChange={e => set('provider_name', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('medical.facility', 'Facility')}</label>
            <input value={form.facility_name} onChange={e => set('facility_name', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.dateLabel')}</label>
            <input type="date" value={form.record_date} onChange={e => set('record_date', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('medical.recordDateEnd', 'End date (if a range)')}</label>
            <input type="date" value={form.record_date_end} onChange={e => set('record_date_end', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('medical.summary', 'Summary')}</label>
          <textarea value={form.summary} onChange={e => set('summary', e.target.value)} rows={4}
            className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm resize-none" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            {t('medical.detailsJson', 'Extracted Details (JSON)')}
          </label>
          <p className="text-xs text-slate-500 mb-1">
            {t('medical.detailsJsonHint', 'Includes lifestyle_metrics if present — those values get logged to Biometrics on approval, so fix them here too.')}
          </p>
          <textarea value={detailsText} onChange={e => setDetailsText(e.target.value)} rows={12}
            spellCheck={false}
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-xs font-mono resize-y" />
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>
      <div className="flex justify-end gap-3 pt-4 mt-2 border-t border-slate-700">
        <button onClick={onCancel} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">{t('common.cancel')}</button>
        <button onClick={submit} disabled={saving}
          className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
          {saving ? t('common.saving') : t('common.save', 'Save')}
        </button>
      </div>
    </div>
  )
}

// ── Add Medical Record Modal ─────────────────────────────────────────────────

function AddMedicalRecordModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const { members } = useFamilyMembers()
  const [form, setForm] = useState({
    family_member_id: '',
    record_type: 'VISIT_NOTE' as RecordType,
    specialty: '',
    provider_name: '',
    facility_name: '',
    record_date: today(),
    title: '',
    summary: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    if (!form.family_member_id) { setError(t('medical.memberRequired', 'Choose a family member.')); return }
    if (!form.title.trim()) { setError(t('medical.titleRequired', 'Title is required.')); return }
    setSaving(true); setError('')
    try {
      await medicalRecordsApi.create({
        family_member_id: form.family_member_id,
        record_type: form.record_type,
        specialty: form.specialty || undefined,
        provider_name: form.provider_name || undefined,
        facility_name: form.facility_name || undefined,
        record_date: form.record_date || undefined,
        title: form.title.trim(),
        summary: form.summary || undefined,
        extracted_by: 'MANUAL',
      })
      onSaved()
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold">{t('medical.addRecord', '+ Add Medical Record')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('medical.selectMember', 'Family member')} *</label>
            <select value={form.family_member_id} onChange={e => set('family_member_id', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
              <option value="">{t('medical.chooseMember', '— Choose —')}</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('crm.typeLabel')}</label>
              <select value={form.record_type} onChange={e => set('record_type', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                {(Object.keys(RECORD_TYPE_LABELS) as RecordType[]).map(rt => (
                  <option key={rt} value={rt}>{RECORD_TYPE_ICONS[rt]} {t(`medical.recordTypes.${rt}`, RECORD_TYPE_LABELS[rt])}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('lifestyle.dateLabel')}</label>
              <input type="date" value={form.record_date} onChange={e => set('record_date', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('medical.titleStar', 'Title *')}</label>
            <input value={form.title} onChange={e => set('title', e.target.value)}
              placeholder={t('medical.titlePlaceholder', 'e.g. Rheumatology follow-up visit')}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('medical.specialty', 'Specialty')}</label>
              <input value={form.specialty} onChange={e => set('specialty', e.target.value)}
                placeholder="e.g. Rheumatology"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('medical.provider', 'Provider')}</label>
              <input value={form.provider_name} onChange={e => set('provider_name', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('medical.facility', 'Facility')}</label>
            <input value={form.facility_name} onChange={e => set('facility_name', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('medical.summary', 'Summary')}</label>
            <textarea value={form.summary} onChange={e => set('summary', e.target.value)} rows={4}
              placeholder={t('medical.summaryPlaceholder', 'What happened at this visit / what the note covers...')}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm resize-none" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">{t('common.cancel')}</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            {saving ? t('common.saving') : t('medical.saveRecord', 'Save Record')}
          </button>
        </div>
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
  const [showAdd, setShowAdd] = useState(false)
  const [statusFilter, setStatusFilter] = useState<RecordStatus | 'ALL'>('REVIEW')
  const [memberFilter, setMemberFilter] = useState('')
  const [verificationOnly, setVerificationOnly] = useState(false)

  const { data: records = [], isLoading, refetch } = useQuery({
    queryKey: ['medical-records', memberFilter],
    queryFn: () => medicalRecordsApi.list({ family_member_id: memberFilter || undefined }),
  })

  const filtered = records.filter(r =>
    (statusFilter === 'ALL' || r.status === statusFilter) &&
    (!verificationOnly || r.needs_verification)
  )
  const reviewCount = records.filter(r => r.status === 'REVIEW').length
  const verificationCount = records.filter(r => r.needs_verification).length

  // Default view is REVIEW so pending records don't require scrolling past approved ones,
  // but fall back to ALL once nothing's pending so the tab doesn't look empty.
  const autoFellBack = useRef(false)
  useEffect(() => {
    if (!isLoading && statusFilter === 'REVIEW' && reviewCount === 0 && !autoFellBack.current) {
      autoFellBack.current = true
      setStatusFilter('ALL')
    }
  }, [isLoading, reviewCount, statusFilter])

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
      {verificationCount > 0 && (
        <div className="bg-amber-900/30 border border-amber-700 rounded-lg px-4 py-3 text-sm text-amber-300 flex justify-between items-center gap-3">
          <span>⚠ {t('medical.needsVerificationAlert', { count: verificationCount, defaultValue: '{{count}} record(s) flagged for verification against the original document' })}</span>
          <button onClick={() => setVerificationOnly(v => !v)}
            className="text-xs px-3 py-1 rounded-full bg-amber-800 hover:bg-amber-700 whitespace-nowrap">
            {verificationOnly ? t('medical.showAll', 'Show all') : t('medical.showOnlyThese', 'Show only these')}
          </button>
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
          <button onClick={() => setVerificationOnly(v => !v)}
            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
              verificationOnly ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}>
            ⚠ {t('medical.needsVerification', 'Needs Verification')}
          </button>
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
            {t('medical.addRecordShort', '+ Add Record')}
          </button>
        </div>
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
                <div className="flex items-center gap-1">
                  {r.needs_verification && <span className="text-xs px-2 py-0.5 rounded bg-amber-900 text-amber-200">⚠</span>}
                  <span className={`text-xs px-2 py-0.5 rounded ${RECORD_STATUS_COLORS[r.status]}`}>
                    {t(`medical.status.${r.status}`, r.status)}
                  </span>
                </div>
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

      {showAdd && (
        <AddMedicalRecordModal onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); refresh() }} />
      )}
    </div>
  )
}

// ── Tracker Tab ────────────────────────────────────────────────────────────────

// Builds a printable trend summary of biometric readings — same rationale and layout
// conventions as buildProfilePrintHtml (client-side, patient header, black-on-white).
function buildBiometricsPrintHtml(
  member: FamilyMember,
  metricOrder: string[],
  groupedByMetric: Record<string, TrackerEntry[]>,
  metricLabel: (m: MetricType) => string,
): string {
  const patientName = escapeHtml(`${member.first_name} ${member.last_name}`)
  const dobLine = member.date_of_birth
    ? `${fmtDate(member.date_of_birth)} (age ${ageFromDob(member.date_of_birth)})`
    : 'Not on file'
  const generatedOn = new Date().toLocaleDateString('en-TT', { day: '2-digit', month: 'long', year: 'numeric' })

  const sections = metricOrder.map(metricKey => {
    const history = groupedByMetric[metricKey]
    const values = history.map(h => Number(h.value)).filter(v => !Number.isNaN(v))
    const min = values.length ? Math.min(...values) : null
    const max = values.length ? Math.max(...values) : null
    const rangeLine = min !== null && max !== null && min !== max
      ? ` — Range: ${min}–${max} ${escapeHtml(history[0].unit)}` : ''
    const rows = history.map((e, i) => {
      const isLatest = i === history.length - 1
      return `<tr class="${isLatest ? 'latest' : ''}">
        <td>${fmtDate(e.entry_date)}${isLatest ? ' <span class="tag">latest</span>' : ''}</td>
        <td><strong>${escapeHtml(String(e.value))}</strong> ${escapeHtml(e.unit)}</td>
        <td>${escapeHtml(e.notes || '')}</td>
      </tr>`
    }).join('')
    return `<div class="metric-block">
      <h2>${escapeHtml(metricLabel(metricKey as MetricType))} <span class="count">(${history.length} reading${history.length === 1 ? '' : 's'})${rangeLine}</span></h2>
      <table><thead><tr><th>Date</th><th>Value</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`
  }).join('')

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Biometrics Summary — ${patientName}</title>
<style>
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; margin: 0; padding: 24px; font-size: 13px; line-height: 1.5; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 0 0 6px; padding-bottom: 4px; border-bottom: 1.5px solid #1a1a1a; text-transform: uppercase; letter-spacing: 0.03em; }
  h2 .count { text-transform: none; font-weight: normal; color: #666; letter-spacing: normal; font-size: 11px; }
  .subtitle { color: #555; font-size: 12px; margin-bottom: 18px; }
  .patient-box { display: flex; justify-content: space-between; border: 1px solid #999; border-radius: 6px; padding: 12px 16px; margin-bottom: 20px; }
  .patient-box .field { font-size: 12px; }
  .patient-box .field .label { color: #666; display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
  .metric-block { margin-bottom: 22px; break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 4px 8px 4px 0; text-align: left; border-bottom: 1px solid #eee; }
  th { font-size: 10px; text-transform: uppercase; color: #666; border-bottom: 1px solid #ccc; }
  tr.latest { background: #f0f6ff; }
  .tag { font-size: 9px; color: #2563eb; text-transform: uppercase; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 10px; color: #777; }
  @media print { .no-print { display: none; } }
</style></head>
<body>
  <div class="no-print" style="text-align:right; margin-bottom: 12px;">
    <button onclick="window.print()" style="padding:8px 16px; font-size:13px; cursor:pointer;">Print</button>
  </div>

  <h1>Biometrics Summary</h1>
  <div class="subtitle">Prepared for review by a treating medical practitioner</div>

  <div class="patient-box">
    <div class="field"><span class="label">Patient</span>${patientName}</div>
    <div class="field"><span class="label">Date of Birth</span>${dobLine}</div>
    <div class="field"><span class="label">Generated</span>${generatedOn}</div>
  </div>

  ${sections || '<p style="color:#888;font-style:italic;">No biometric readings on file.</p>'}

  <div class="footer">Generated by JAG Holdings — Medical Records module. Please verify all details with the patient/family before relying on this summary clinically.</div>
</body></html>`
}

function printBiometrics(
  member: FamilyMember,
  metricOrder: string[],
  groupedByMetric: Record<string, TrackerEntry[]>,
  metricLabel: (m: MetricType) => string,
) {
  const w = window.open('', '_blank')
  if (!w) return
  w.document.open()
  w.document.write(buildBiometricsPrintHtml(member, metricOrder, groupedByMetric, metricLabel))
  w.document.close()
}

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

  // Group entries by metric type — a chronological history per test, not mixed by date,
  // so a trend (e.g. PSA over 15 years) reads as one table instead of scattered rows.
  const groupedByMetric = entries.reduce<Record<string, TrackerEntry[]>>((acc, e) => {
    acc[e.metric_type] = [...(acc[e.metric_type] ?? []), e]
    return acc
  }, {})
  for (const key of Object.keys(groupedByMetric)) {
    groupedByMetric[key].sort((a, b) => a.entry_date.localeCompare(b.entry_date))
  }
  const metricOrder = Object.keys(groupedByMetric).sort((a, b) =>
    groupedByMetric[b][groupedByMetric[b].length - 1].entry_date.localeCompare(
      groupedByMetric[a][groupedByMetric[a].length - 1].entry_date)
  )

  // Latest value per metric for summary. API returns entries sorted entry_date DESC,
  // so the first occurrence of each metric_type in iteration order is already the latest.
  const latestByMetric: Partial<Record<MetricType, TrackerEntry>> = {}
  for (const e of entries) {
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
          <button
            onClick={() => {
              const member = members.find(m => m.id === memberFilter)
              if (member) printBiometrics(member, metricOrder, groupedByMetric, (m) => t(`lifestyle.metricTypes.${m}`, METRIC_LABELS[m]))
            }}
            disabled={!memberFilter || entries.length === 0}
            title={!memberFilter ? t('medical.selectMemberToPrint', 'Select a family member above to print their biometrics') : ''}
            className="text-xs px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed">
            🖨 {t('medical.printForDoctor', 'Print for Doctor')}
          </button>
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
        <div className="space-y-5">
          {metricOrder.map(metricKey => {
            const m = metricKey as MetricType
            const history = groupedByMetric[metricKey]
            const values = history.map(h => Number(h.value)).filter(v => !Number.isNaN(v))
            const min = values.length ? Math.min(...values) : null
            const max = values.length ? Math.max(...values) : null
            return (
              <div key={metricKey} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-800/80">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{METRIC_ICONS[m]}</span>
                    <span className="font-semibold text-slate-100">{t(`lifestyle.metricTypes.${m}`, METRIC_LABELS[m])}</span>
                    <span className="text-xs text-slate-500">({history.length})</span>
                  </div>
                  {min !== null && max !== null && min !== max && (
                    <span className="text-xs text-slate-400">{t('medical.rangeLabel', 'Range')}: {min} – {max} {history[0].unit}</span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-slate-500 border-b border-slate-700/50">
                        <th className="text-left px-4 py-1.5 font-medium">{t('lifestyle.dateLabel')}</th>
                        <th className="text-left px-4 py-1.5 font-medium">{t('lifestyle.valueStar', 'Value').replace(' *', '')}</th>
                        <th className="text-left px-4 py-1.5 font-medium">{t('common.notes')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((e, i) => {
                        const isLatest = i === history.length - 1
                        return (
                          <tr key={e.id} className={`border-b border-slate-700/30 last:border-0 ${isLatest ? 'bg-blue-900/20' : ''}`}>
                            <td className="px-4 py-2 text-slate-300 whitespace-nowrap">
                              {fmtDate(e.entry_date)}{isLatest && <span className="text-xs text-blue-400 ml-2">{t('medical.latest', 'latest')}</span>}
                            </td>
                            <td className="px-4 py-2 font-semibold text-white whitespace-nowrap">{e.value} <span className="text-slate-400 font-normal">{e.unit}</span></td>
                            <td className="px-4 py-2 text-slate-400 text-xs">
                              {e.notes || (e.source ? t('lifestyle.viaSource', { source: e.source }) : '')}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
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

// ── Clinic Registrations Tab ─────────────────────────────────────────────────

function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  const target = new Date(y, m - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function ClinicRegistrationsTab() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { members, nameOf } = useFamilyMembers()
  const [memberFilter, setMemberFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<ClinicRegistration | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const { data: registrations = [], isLoading } = useQuery({
    queryKey: ['clinic-registrations', memberFilter],
    queryFn: () => clinicRegistrationsApi.list({ family_member_id: memberFilter || undefined }),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['clinic-registrations'] })

  const syncCalendar = async (reg: ClinicRegistration) => {
    setSyncingId(reg.id); setError('')
    try { await clinicRegistrationsApi.syncCalendar(reg.id); refresh() }
    catch (e) { setError((e as Error).message) }
    finally { setSyncingId(null) }
  }

  const remove = async (reg: ClinicRegistration) => {
    if (!confirm(t('medical.confirmDeleteClinic', 'Remove this clinic registration?'))) return
    try { await clinicRegistrationsApi.delete(reg.id); refresh() }
    catch (e) { setError((e as Error).message) }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400">
        {t('medical.clinicsHint', 'Which clinics each family member is enrolled at, their registration number, and their next appointment — synced to Google Calendar when set.')}
      </p>

      <div className="flex flex-wrap justify-between items-end gap-4">
        {members.length > 0 && (
          <select value={memberFilter} onChange={e => setMemberFilter(e.target.value)}
            className="text-xs bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200">
            <option value="">{t('lifestyle.allMembers')}</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
          </select>
        )}
        <button onClick={() => setShowAdd(true)}
          className="text-sm px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium">
          {t('medical.addClinic', '+ Add Clinic')}
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {isLoading ? (
        <p className="text-slate-500 text-sm">{t('common.loading')}</p>
      ) : registrations.length === 0 ? (
        <p className="text-slate-500 text-sm italic">{t('medical.noClinics', 'No clinic registrations logged yet.')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-xs text-slate-400">
                <th className="text-left px-4 py-2 font-medium">{t('medical.patient', 'Patient')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('medical.facility', 'Facility')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('medical.regNumber', 'Reg #')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('medical.nextAppointment', 'Next Appointment')}</th>
                <th className="text-right px-4 py-2 font-medium">{t('common.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {registrations.map(reg => {
                const dleft = reg.next_appointment_date ? daysUntil(reg.next_appointment_date) : null
                return (
                  <tr key={reg.id} className="border-t border-slate-700/50">
                    <td className="px-4 py-2.5 text-slate-200">{nameOf(reg.family_member_id) ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="text-slate-100">{reg.facility_name}</div>
                      {reg.department && <div className="text-xs text-slate-500">{reg.department}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-300 font-mono text-xs">{reg.registration_number || '—'}</td>
                    <td className="px-4 py-2.5">
                      {reg.next_appointment_date ? (
                        <div>
                          <span className={dleft !== null && dleft < 0 ? 'text-slate-500' : dleft !== null && dleft <= 7 ? 'text-amber-300 font-semibold' : 'text-slate-200'}>
                            {fmtDate(reg.next_appointment_date)}
                          </span>
                          {dleft !== null && dleft >= 0 && (
                            <span className="text-xs text-slate-500 ml-2">
                              ({dleft === 0 ? t('medical.today', 'today') : t('medical.inDays', { count: dleft, defaultValue: 'in {{count}}d' })})
                            </span>
                          )}
                          {reg.calendar_event_id && <span className="text-xs text-emerald-400 ml-2">📅 {t('medical.synced', 'synced')}</span>}
                        </div>
                      ) : (
                        <span className="text-slate-500 italic text-xs">{t('medical.noneScheduled', 'None scheduled')}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => setEditing(reg)}
                        className="text-xs px-2.5 py-1 bg-slate-700 hover:bg-slate-600 rounded mr-1.5">
                        ✎ {t('common.edit', 'Edit')}
                      </button>
                      {reg.next_appointment_date && (
                        <button onClick={() => syncCalendar(reg)} disabled={syncingId === reg.id}
                          className="text-xs px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 rounded mr-1.5 disabled:opacity-50">
                          📅 {syncingId === reg.id ? t('common.saving') : t('medical.syncCalendar', 'Sync to Calendar')}
                        </button>
                      )}
                      <button onClick={() => remove(reg)}
                        className="text-xs px-2.5 py-1 bg-red-900/50 hover:bg-red-900 text-red-300 rounded">
                        {t('common.delete', 'Delete')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {(showAdd || editing) && (
        <ClinicRegistrationModal
          registration={editing}
          onClose={() => { setShowAdd(false); setEditing(null) }}
          onSaved={() => { setShowAdd(false); setEditing(null); refresh() }}
        />
      )}
    </div>
  )
}

function ClinicRegistrationModal({ registration, onClose, onSaved }: {
  registration: ClinicRegistration | null; onClose: () => void; onSaved: () => void
}) {
  const { t } = useTranslation()
  const { members } = useFamilyMembers()
  const [form, setForm] = useState({
    family_member_id: registration?.family_member_id ?? '',
    facility_name: registration?.facility_name ?? '',
    department: registration?.department ?? '',
    registration_number: registration?.registration_number ?? '',
    next_appointment_date: registration?.next_appointment_date?.slice(0, 10) ?? '',
    notes: registration?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Unfiltered (all family members) so facility/department suggestions are drawn
  // from everything already on file, not just the currently-selected member.
  const { data: allRegistrations = [] } = useQuery({
    queryKey: ['clinic-registrations', 'all-for-suggestions'],
    queryFn: () => clinicRegistrationsApi.list(),
  })
  const facilityOptions = Array.from(new Set(allRegistrations.map(r => r.facility_name))).sort()
  const matchingReg = form.facility_name
    ? allRegistrations.filter(r => r.facility_name === form.facility_name)
    : allRegistrations
  const departmentOptions = Array.from(new Set(matchingReg.map(r => r.department).filter((d): d is string => !!d))).sort()

  const set = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }))
  const selectFacility = (v: string) => {
    setForm(p => ({
      ...p,
      facility_name: v,
      // Auto-fill the registration # already known for this facility (e.g. the
      // shared hospital-wide number) unless the user already typed one in.
      registration_number: p.registration_number || (allRegistrations.find(r => r.facility_name === v && r.registration_number)?.registration_number ?? p.registration_number),
    }))
  }

  const submit = async () => {
    if (!form.family_member_id) { setError(t('medical.memberRequired', 'Choose a family member.')); return }
    if (!form.facility_name.trim()) { setError(t('medical.facilityRequired', 'Facility name is required.')); return }
    setSaving(true); setError('')
    try {
      const payload = {
        family_member_id: form.family_member_id,
        facility_name: form.facility_name.trim(),
        department: form.department || undefined,
        registration_number: form.registration_number || undefined,
        next_appointment_date: form.next_appointment_date || undefined,
        notes: form.notes || undefined,
      }
      if (registration) await clinicRegistrationsApi.update(registration.id, payload)
      else await clinicRegistrationsApi.create(payload)
      onSaved()
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold">{registration ? t('medical.editClinic', 'Edit Clinic Registration') : t('medical.addClinic', '+ Add Clinic')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('medical.selectMember', 'Family member')} *</label>
            <select value={form.family_member_id} onChange={e => set('family_member_id', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
              <option value="">{t('medical.chooseMember', '— Choose —')}</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('medical.facility', 'Facility')} *</label>
            <input value={form.facility_name} onChange={e => selectFacility(e.target.value)}
              list="clinic-facility-options"
              placeholder="e.g. General Hospital San Fernando"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            <datalist id="clinic-facility-options">
              {facilityOptions.map(f => <option key={f} value={f} />)}
            </datalist>
            {facilityOptions.length > 0 && (
              <p className="text-xs text-slate-500 mt-1">{t('medical.facilityPickHint', 'Start typing to pick an existing facility, or enter a new one.')}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('medical.department', 'Department / Clinic')}</label>
              <input value={form.department} onChange={e => set('department', e.target.value)}
                list="clinic-department-options"
                placeholder="e.g. Rheumatology OPC"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
              <datalist id="clinic-department-options">
                {departmentOptions.map(d => <option key={d} value={d} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('medical.regNumber', 'Registration #')}</label>
              <input value={form.registration_number} onChange={e => set('registration_number', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('medical.nextAppointment', 'Next Appointment')}</label>
            <input type="date" value={form.next_appointment_date} onChange={e => set('next_appointment_date', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            <p className="text-xs text-slate-500 mt-1">{t('medical.syncAfterSaveHint', 'After saving, use "Sync to Calendar" on the list to push this to Google Calendar.')}</p>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('medical.notes', 'Notes')}</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm resize-none" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">{t('common.cancel')}</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            {saving ? t('common.saving') : t('common.save', 'Save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'loyalty' | 'medical'
type MedicalSubTab = 'profile' | 'records' | 'biometrics' | 'clinics'

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
              ['clinics', t('medical.subTabClinics', '🏥 Clinics')],
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
          {medicalSubTab === 'clinics' && <ClinicRegistrationsTab />}
        </div>
      )}
    </div>
  )
}
