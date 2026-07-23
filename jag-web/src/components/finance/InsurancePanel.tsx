import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { financeApi } from '../../api/finance'
import { imsApi } from '../../api/ims'
import { propertiesApi } from '../../api/properties'
import { jabcoApi } from '../../api/jabco'
import { tenantApi } from '../../api/client'
import { entityName, fmtTTD, fmtDate } from '../../lib/entities'
import type {
  InsurancePolicy, InsurancePremium, InsuranceClaim as _InsuranceClaim,
  InsurancePolicyType, InsuranceAssetType, PremiumFrequency, ClaimStatus,
  InsurancePolicyHistory,
} from '../../types/finance'

// ── Constants ─────────────────────────────────────────────────────────────────

const POLICY_TYPES: InsurancePolicyType[] = [
  'BUILDING','CONTENTS','COMPREHENSIVE','FLOOD','FIRE',
  'VEHICLE','LIABILITY','LIFE','HEALTH',
  'BUSINESS_INTERRUPTION','MARINE','PROFESSIONAL_INDEMNITY',
  'SURETY_BOND','PERFORMANCE_BOND','PROPERTY','OTHER',
]
const ASSET_TYPES: InsuranceAssetType[] = ['VEHICLE','PROPERTY','BUSINESS','PERSON','PROJECT','OTHER']
const PREM_FREQS: PremiumFrequency[] = ['MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL','ONE_OFF']
const CLAIM_STATUS_STYLES: Record<ClaimStatus, string> = {
  SUBMITTED:    'bg-blue-900/50 text-blue-300 border border-blue-700',
  UNDER_REVIEW: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
  APPROVED:     'bg-green-900/40 text-green-300 border border-green-700',
  REJECTED:     'bg-red-900/50 text-red-400 border border-red-800',
  SETTLED:      'bg-emerald-900/50 text-emerald-300 border border-emerald-700',
  WITHDRAWN:    'bg-slate-700 text-slate-400 border border-slate-600',
}
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

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

// ── Add Policy Modal ──────────────────────────────────────────────────────────

function AddPolicyModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    owner_entity_id: ENTITY_OPTIONS[0].id,
    policy_number: '',
    insurer_name: '',
    broker_name: '',
    policy_type: 'BUILDING' as InsurancePolicyType,
    insured_asset_type: 'PROPERTY' as InsuranceAssetType,
    insured_asset_ref: '',
    sub_type: '',
    coverage_amount: '',
    currency: 'TTD',
    premium_amount: '',
    premium_frequency: 'ANNUAL' as PremiumFrequency,
    start_date: '',
    expiry_date: '',
    renewal_alert_days: '60',
    notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value, ...(k === 'insured_asset_type' ? { insured_asset_ref: '' } : {}) }))

  const { data: vehicles = [] } = useQuery({
    queryKey: ['ims', 'vehicles', 'picker'],
    queryFn: () => imsApi.getVehicles({ include_disposed: 'false', limit: 100 }).then(r => r.vehicles),
    enabled: form.insured_asset_type === 'VEHICLE',
  })
  const { data: properties = [] } = useQuery({
    queryKey: ['properties', 'picker'],
    queryFn: () => propertiesApi.getProperties({ limit: 500 }),
    enabled: form.insured_asset_type === 'PROPERTY',
  })
  const { data: projects = [] } = useQuery({
    queryKey: ['jabco-projects', 'picker'],
    queryFn: () => jabcoApi.getProjects({ limit: 100 }).then(r => r.projects),
    enabled: form.insured_asset_type === 'PROJECT',
  })

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => financeApi.createPolicy({
      owner_entity_id: form.owner_entity_id,
      policy_number: form.policy_number,
      insurer_name: form.insurer_name,
      broker_name: form.broker_name || undefined,
      policy_type: form.policy_type,
      insured_asset_type: form.insured_asset_type,
      insured_asset_ref: form.insured_asset_ref || undefined,
      sub_type: form.sub_type || undefined,
      coverage_amount: Number(form.coverage_amount),
      currency: form.currency || 'TTD',
      coverage_amount_ttd: Number(form.coverage_amount),
      premium_amount: Number(form.premium_amount),
      premium_amount_ttd: Number(form.premium_amount),
      premium_frequency: form.premium_frequency,
      start_date: form.start_date,
      expiry_date: form.expiry_date,
      renewal_alert_days: Number(form.renewal_alert_days) || 60,
      notes: form.notes || undefined,
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  const valid = form.policy_number && form.insurer_name && form.coverage_amount && form.premium_amount && form.start_date && form.expiry_date

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('insurance.addPolicy')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.entity')}</label>
            <select value={form.owner_entity_id} onChange={set('owner_entity_id')} className={cls}>
              {ENTITY_OPTIONS.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('insurance.policyType')}</label>
              <select value={form.policy_type} onChange={set('policy_type')} className={cls}>
                {POLICY_TYPES.map(tp => <option key={tp} value={tp}>{t(`insurance.policyTypes.${tp}`)}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('insurance.assetType')}</label>
              <select value={form.insured_asset_type} onChange={set('insured_asset_type')} className={cls}>
                {ASSET_TYPES.map(tp => <option key={tp} value={tp}>{t(`insurance.assetTypes.${tp}`)}</option>)}
              </select>
            </div>
          </div>
          {form.insured_asset_type === 'VEHICLE' && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('insurance.linkedVehicle')} <span className="text-slate-500 text-xs">({t('common.optional')})</span></label>
              <select value={form.insured_asset_ref} onChange={set('insured_asset_ref')} className={cls}>
                <option value="">{t('insurance.noSpecificAsset')}</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration_number} — {v.make} {v.model}</option>)}
              </select>
            </div>
          )}
          {form.insured_asset_type === 'PROPERTY' && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('insurance.linkedProperty')} <span className="text-slate-500 text-xs">({t('common.optional')})</span></label>
              <select value={form.insured_asset_ref} onChange={set('insured_asset_ref')} className={cls}>
                <option value="">{t('insurance.noSpecificAsset')}</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          {form.insured_asset_type === 'PROJECT' && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('insurance.linkedProject')} <span className="text-slate-500 text-xs">({t('common.optional')})</span></label>
              <select value={form.insured_asset_ref} onChange={set('insured_asset_ref')} className={cls}>
                <option value="">{t('insurance.noSpecificAsset')}</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.project_code} — {p.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('insurance.subType')} <span className="text-slate-500 text-xs">({t('common.optional')})</span></label>
            <input value={form.sub_type} onChange={set('sub_type')} className={cls} placeholder="e.g. Third-party, All-risks, Comprehensive" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('insurance.policyNumber')}</label>
            <input value={form.policy_number} onChange={set('policy_number')} className={cls} placeholder="e.g. POL-2026-001" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('insurance.insurer')}</label>
              <input value={form.insurer_name} onChange={set('insurer_name')} className={cls} placeholder="e.g. Guardian Life" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('insurance.broker')}</label>
              <input value={form.broker_name} onChange={set('broker_name')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('insurance.coverageAmount')}</label>
              <input type="number" step="0.01" value={form.coverage_amount} onChange={set('coverage_amount')} className={cls} placeholder="0.00" />
            </div>
            <div className="w-20">
              <label className="block text-xs text-slate-400 mb-1">{t('common.currency')}</label>
              <input maxLength={3} value={form.currency} onChange={set('currency')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('insurance.premiumAmount')}</label>
              <input type="number" step="0.01" value={form.premium_amount} onChange={set('premium_amount')} className={cls} placeholder="0.00" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('insurance.frequency')}</label>
              <select value={form.premium_frequency} onChange={set('premium_frequency')} className={cls}>
                {PREM_FREQS.map(pf => <option key={pf} value={pf}>{t(`insurance.frequencies.${pf}`)}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('common.startDate')}</label>
              <input type="date" value={form.start_date} onChange={set('start_date')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('insurance.expiryDate')}</label>
              <input type="date" value={form.expiry_date} onChange={set('expiry_date')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('insurance.renewalAlert')}</label>
            <input type="number" min="7" max="365" value={form.renewal_alert_days} onChange={set('renewal_alert_days')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea rows={2} value={form.notes} onChange={set('notes')} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => mutate()}
            disabled={isPending || !valid}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {isPending ? t('common.saving') : t('insurance.addBtn')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Policy Detail Panel (premiums + claims) ───────────────────────────────────

function PolicyDetail({ policy, onClose }: { policy: InsurancePolicy; onClose: () => void }) {
  const { t } = useTranslation()
  const [subTab, setSubTab] = useState<'premiums' | 'claims'>('premiums')
  const [showAddPremium, setShowAddPremium] = useState(false)
  const [showAddClaim, setShowAddClaim] = useState(false)
  const qc = useQueryClient()

  const { data: premiums = [], isLoading: loadPrem } = useQuery({
    queryKey: ['finance', 'insurance', 'premiums', policy.id],
    queryFn: () => financeApi.getPremiums(policy.id),
  })
  const { data: claims = [], isLoading: loadClaim } = useQuery({
    queryKey: ['finance', 'insurance', 'claims', policy.id],
    queryFn: () => financeApi.getClaims(policy.id),
  })

  const refreshPrem  = () => void qc.invalidateQueries({ queryKey: ['finance', 'insurance', 'premiums', policy.id] })
  const refreshClaim = () => void qc.invalidateQueries({ queryKey: ['finance', 'insurance', 'claims', policy.id] })

  const { mutate: markPaid, isPending: markingPaid } = useMutation({
    mutationFn: (prem: InsurancePremium) => financeApi.markPremiumPaid(prem.id, {
      paid_date: new Date().toISOString().slice(0, 10),
      idempotency_key: `mark-paid-${prem.id}`,
    }),
    onSuccess: refreshPrem,
  })

  const daysToExpiry = Math.ceil((new Date(policy.expiry_date).getTime() - Date.now()) / 86_400_000)
  const expiryColor = daysToExpiry < 30 ? 'text-red-400' : daysToExpiry < 90 ? 'text-yellow-400' : 'text-green-400'

  const SUB_TABS: { key: 'premiums' | 'claims'; label: string }[] = [
    { key: 'premiums', label: t('insurance.premiums') },
    { key: 'claims',   label: t('insurance.claims') },
  ]

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-700">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-base font-semibold text-white">{policy.insurer_name} — {policy.policy_number}</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {t(`insurance.policyTypes.${policy.policy_type}`)}
                {policy.sub_type && <span className="ml-1 text-slate-500">({policy.sub_type})</span>}
                {' · '}{entityName(policy.owner_entity_id)}
              </p>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-white text-sm px-2">✕</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            <div>
              <p className="text-xs text-slate-400">{t('insurance.colCoverage')}</p>
              <p className="text-sm font-mono font-medium text-white">{fmtTTD(policy.coverage_amount_ttd)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">{t('insurance.colPremium')}</p>
              <p className="text-sm font-mono font-medium text-white">
                {fmtTTD(policy.premium_amount_ttd)} <span className="text-slate-500 font-normal">/ {t(`insurance.frequencies.${policy.premium_frequency}`)}</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">{t('insurance.colExpiry')}</p>
              <p className={`text-sm font-medium ${expiryColor}`}>
                {fmtDate(policy.expiry_date)}
                <span className="ml-1 text-xs">({daysToExpiry > 0 ? `${daysToExpiry}d` : 'EXPIRED'})</span>
              </p>
            </div>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-slate-700 px-5 overflow-x-auto">
          {SUB_TABS.map(tb => (
            <button key={tb.key} onClick={() => setSubTab(tb.key)} className={`py-2.5 px-3 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${subTab === tb.key ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400 hover:text-white'}`}>{tb.label}</button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {subTab === 'premiums' && (
            <div>
              <div className="flex justify-end mb-3">
                <button onClick={() => setShowAddPremium(true)} className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">{t('insurance.schedulePremium')}</button>
              </div>
              {loadPrem && <p className="text-slate-400 text-xs">{t('common.loading')}</p>}
              {premiums.length === 0 && !loadPrem && <p className="text-slate-500 text-sm">{t('insurance.noPremiums')}</p>}
              <div className="space-y-2">
                {premiums.map(p => (
                  <div key={p.id} className="flex items-center justify-between bg-slate-700/50 rounded-lg px-3 py-2.5">
                    <div>
                      <p className="text-sm text-slate-100">{t('common.dueDate')} {fmtDate(p.due_date)}</p>
                      <p className="text-xs text-slate-400">{p.payment_method.replace(/_/g, ' ')}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-mono font-medium">{fmtTTD(p.amount_ttd)}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        p.status === 'PAID'    ? 'bg-green-900/50 text-green-300 border border-green-700' :
                        p.status === 'OVERDUE' ? 'bg-red-900/50 text-red-400 border border-red-800' :
                        p.status === 'WAIVED'  ? 'bg-slate-600 text-slate-400' :
                        'bg-yellow-900/50 text-yellow-300 border border-yellow-700'
                      }`}>{t(`insurance.premiumStatuses.${p.status}`, p.status)}</span>
                      {(p.status === 'DUE' || p.status === 'OVERDUE') && (
                        <button onClick={() => markPaid(p)} disabled={markingPaid} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">{t('common.markPaid')}</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {subTab === 'claims' && (
            <div>
              <div className="flex justify-end mb-3">
                <button onClick={() => setShowAddClaim(true)} className="text-xs px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded transition-colors">{t('insurance.lodgeClaim')}</button>
              </div>
              {loadClaim && <p className="text-slate-400 text-xs">{t('common.loading')}</p>}
              {claims.length === 0 && !loadClaim && <p className="text-slate-500 text-sm">{t('insurance.noClaims')}</p>}
              <div className="space-y-2">
                {claims.map(c => (
                  <div key={c.id} className="bg-slate-700/50 rounded-lg px-3 py-2.5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm text-slate-100">{c.description}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {t('insurance.incidentDate')} {fmtDate(c.incident_date)} · {t('insurance.claimDate')} {fmtDate(c.claim_date)}
                          {c.claim_reference && ` · Ref: ${c.claim_reference}`}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ml-3 ${CLAIM_STATUS_STYLES[c.status]}`}>{t(`insurance.claimStatuses.${c.status}`, c.status.replace('_', ' '))}</span>
                    </div>
                    <div className="flex gap-4 mt-2 text-xs font-mono">
                      <span className="text-slate-400">{t('insurance.amountClaimed')}: <span className="text-slate-100">{fmtTTD(c.claimed_amount_ttd)}</span></span>
                      {c.settled_amount_ttd && <span className="text-slate-400">{t('insurance.amountTTD')}: <span className="text-green-300">{fmtTTD(c.settled_amount_ttd)}</span></span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showAddPremium && <AddPremiumModal policyId={policy.id} onClose={() => setShowAddPremium(false)} onCreated={refreshPrem} />}
      {showAddClaim  && <AddClaimModal  policyId={policy.id} onClose={() => setShowAddClaim(false)}  onCreated={refreshClaim} />}
    </div>
  )
}

// ── Add Premium Modal ─────────────────────────────────────────────────────────

function AddPremiumModal({ policyId, onClose, onCreated }: { policyId: string; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ due_date: '', amount: '', payment_method: 'BANK_TRANSFER', notes: '' })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => financeApi.createPremium(policyId, {
      due_date: form.due_date, amount: Number(form.amount), amount_ttd: Number(form.amount),
      payment_method: form.payment_method, notes: form.notes || undefined,
      idempotency_key: uuidv4(),
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-white mb-3">{t('insurance.scheduleTitle')}</h3>
        <div className="space-y-3">
          <div><label className="block text-xs text-slate-400 mb-1">{t('common.dueDate')}</label><input type="date" value={form.due_date} onChange={set('due_date')} className={cls} /></div>
          <div><label className="block text-xs text-slate-400 mb-1">{t('insurance.amountTTD')}</label><input type="number" step="0.01" value={form.amount} onChange={set('amount')} className={cls} placeholder="0.00" /></div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('insurance.paymentMethod')}</label>
            <select value={form.payment_method} onChange={set('payment_method')} className={cls}>
              {['CASH','BANK_TRANSFER','CREDIT_CARD','CHEQUE','DIRECT_DEBIT','OTHER'].map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={() => mutate()} disabled={isPending || !form.due_date || !form.amount} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg">{isPending ? t('common.saving') : t('common.save')}</button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Add Claim Modal ───────────────────────────────────────────────────────────

function AddClaimModal({ policyId, onClose, onCreated }: { policyId: string; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ incident_date: today, claim_date: today, description: '', claimed_amount_ttd: '', claim_reference: '', notes: '' })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => financeApi.createClaim(policyId, {
      incident_date: form.incident_date, claim_date: form.claim_date,
      description: form.description, claimed_amount_ttd: Number(form.claimed_amount_ttd),
      claim_reference: form.claim_reference || undefined,
      notes: form.notes || undefined, idempotency_key: uuidv4(),
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-white mb-3">{t('insurance.lodgeTitle')}</h3>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1"><label className="block text-xs text-slate-400 mb-1">{t('insurance.incidentDate')}</label><input type="date" value={form.incident_date} onChange={set('incident_date')} className={cls} /></div>
            <div className="flex-1"><label className="block text-xs text-slate-400 mb-1">{t('insurance.claimDate')}</label><input type="date" value={form.claim_date} onChange={set('claim_date')} className={cls} /></div>
          </div>
          <div><label className="block text-xs text-slate-400 mb-1">{t('common.description')}</label><textarea rows={2} value={form.description} onChange={set('description')} className={cls} placeholder={t('insurance.whatHappened')} /></div>
          <div><label className="block text-xs text-slate-400 mb-1">{t('insurance.amountClaimed')}</label><input type="number" step="0.01" value={form.claimed_amount_ttd} onChange={set('claimed_amount_ttd')} className={cls} placeholder="0.00" /></div>
          <div><label className="block text-xs text-slate-400 mb-1">{t('insurance.insurerRef')}</label><input value={form.claim_reference} onChange={set('claim_reference')} className={cls} placeholder="CL-2026-xxxx" /></div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={() => mutate()} disabled={isPending || !form.description || !form.claimed_amount_ttd} className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg">{isPending ? t('common.saving') : t('insurance.lodgeClaim')}</button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Policy History Modal ──────────────────────────────────────────────────────

function PolicyHistoryModal({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [date, setDate] = useState('')
  const [coverage, setCoverage] = useState('')
  const [premium, setPremium] = useState('')
  const [expiry, setExpiry] = useState('')
  const [notes, setNotes] = useState('')

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['finance', 'insurance', 'policies', id, 'history'],
    queryFn: () => financeApi.getPolicyHistory(id),
  })

  const { mutate, isPending, error: addError } = useMutation({
    mutationFn: () => financeApi.addPolicyHistory(id, {
      as_of_date: date,
      coverage_amount_ttd: Number(coverage),
      premium_amount_ttd: Number(premium),
      expiry_date: expiry || undefined,
      notes: notes || undefined,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'insurance', 'policies', id, 'history'] })
      setDate(''); setCoverage(''); setPremium(''); setExpiry(''); setNotes('')
      setShowAdd(false)
    },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto py-6">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl mx-4 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Policy History — {name}</h2>
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
                <label className="block text-xs text-slate-400 mb-1">Coverage (TTD)</label>
                <input type="number" step="0.01" value={coverage} onChange={e => setCoverage(e.target.value)} className={cls} placeholder="0.00" />
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">Premium (TTD)</label>
                <input type="number" step="0.01" value={premium} onChange={e => setPremium(e.target.value)} className={cls} placeholder="0.00" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">Expiry Date (optional)</label>
                <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} className={cls} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className={cls} placeholder="e.g. 2025 renewal terms" />
            </div>
            {addError && <p className="text-red-400 text-xs">{addError instanceof Error ? addError.message : 'Failed.'}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={() => mutate()} disabled={isPending || !date || !coverage || !premium}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors">
                {isPending ? 'Saving...' : 'Save Entry'}
              </button>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-white text-xs transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {isLoading && <p className="text-slate-400 text-sm">Loading...</p>}
        {!isLoading && history.length === 0 && (
          <p className="text-slate-400 text-sm">No history yet. History records automatically each time you update the policy.</p>
        )}
        {history.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-right px-3 py-2">Coverage (TTD)</th>
                  <th className="text-right px-3 py-2">Premium (TTD)</th>
                  <th className="text-right px-3 py-2">Expiry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {history.map((row: InsurancePolicyHistory) => (
                  <tr key={row.id} className="hover:bg-slate-700/30">
                    <td className="px-3 py-2 text-slate-300">{row.as_of_date}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-100 font-medium">{fmtTTD(row.coverage_amount_ttd)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">{fmtTTD(row.premium_amount_ttd)}</td>
                    <td className="px-3 py-2 text-right text-slate-400">{row.expiry_date ? fmtDate(row.expiry_date) : '—'}</td>
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

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function InsurancePanel() {
  const { t } = useTranslation()
  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState<InsurancePolicy | null>(null)
  const [policyHistory, setPolicyHistory] = useState<{ id: string; name: string } | null>(null)
  const [filterActive, setFilterActive] = useState<'true' | 'false' | ''>('')
  const [filterType, setFilterType] = useState<InsurancePolicyType | ''>('')
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ total_events_created: number; failed: number } | null>(null)
  const qc = useQueryClient()

  const syncToCalendar = async () => {
    setSyncing(true); setSyncResult(null)
    try {
      const client = tenantApi('00000000-0000-0000-0001-000000000001')
      const result = await client.post<{ total_events_created: number; insurance_events: number; failed: number }>(
        '/admin/calendar/backfill', {}
      )
      setSyncResult({ total_events_created: result.total_events_created, failed: result.failed })
      void qc.invalidateQueries({ queryKey: ['finance', 'insurance'] })
    } catch {
      setSyncResult({ total_events_created: 0, failed: 1 })
    } finally {
      setSyncing(false)
    }
  }

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ['finance', 'insurance', 'policies', filterActive, filterType],
    queryFn: () => financeApi.getPolicies({
      ...(filterActive ? { is_active: filterActive as 'true' | 'false' } : {}),
      ...(filterType ? { policy_type: filterType as InsurancePolicyType } : {}),
    }),
  })

  const { data: expiring = [] } = useQuery({
    queryKey: ['finance', 'insurance', 'expiring'],
    queryFn: () => financeApi.getExpiringPolicies(),
  })

  // Resolve insured_asset_ref → a human label (plate/property/project) for display.
  // Only fetched if at least one loaded policy references that asset type.
  const hasVehicleRef  = policies.some(p => p.insured_asset_type === 'VEHICLE'  && p.insured_asset_ref)
  const hasPropertyRef = policies.some(p => p.insured_asset_type === 'PROPERTY' && p.insured_asset_ref)
  const hasProjectRef  = policies.some(p => p.insured_asset_type === 'PROJECT'  && p.insured_asset_ref)

  const { data: vehicles = [] } = useQuery({
    queryKey: ['ims', 'vehicles', 'picker'],
    queryFn: () => imsApi.getVehicles({ include_disposed: 'true', limit: 100 }).then(r => r.vehicles),
    enabled: hasVehicleRef,
  })
  const { data: properties = [] } = useQuery({
    queryKey: ['properties', 'picker'],
    queryFn: () => propertiesApi.getProperties({ limit: 500 }),
    enabled: hasPropertyRef,
  })
  const { data: projects = [] } = useQuery({
    queryKey: ['jabco-projects', 'picker'],
    queryFn: () => jabcoApi.getProjects({ limit: 100 }).then(r => r.projects),
    enabled: hasProjectRef,
  })

  const assetLabel = useMemo(() => {
    const vehicleMap = new Map(vehicles.map(v => [v.id, `${v.registration_number} (${v.make} ${v.model})`]))
    const propertyMap = new Map(properties.map(p => [p.id, p.name]))
    const projectMap = new Map(projects.map(p => [p.id, `${p.project_code} — ${p.name}`]))
    return (p: InsurancePolicy): string | null => {
      if (!p.insured_asset_ref) return null
      if (p.insured_asset_type === 'VEHICLE')  return vehicleMap.get(p.insured_asset_ref) ?? null
      if (p.insured_asset_type === 'PROPERTY') return propertyMap.get(p.insured_asset_ref) ?? null
      if (p.insured_asset_type === 'PROJECT')  return projectMap.get(p.insured_asset_ref) ?? null
      return null
    }
  }, [vehicles, properties, projects])

  const refresh = () => void qc.invalidateQueries({ queryKey: ['finance', 'insurance'] })

  const totalCoverage = policies.reduce((s, p) => s + parseFloat(p.coverage_amount_ttd), 0)
  const activePolicies = policies.filter(p => p.is_active)

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-slate-800 rounded-lg p-4 border-l-4 border-blue-500">
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{t('insurance.activePolicies')}</p>
          <p className="text-2xl font-semibold text-white">{activePolicies.length}</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-4 border-l-4 border-green-500">
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{t('insurance.totalCoverage')}</p>
          <p className="text-lg font-semibold font-mono text-white">{fmtTTD(String(totalCoverage))}</p>
        </div>
        <div className={`bg-slate-800 rounded-lg p-4 border-l-4 ${expiring.length > 0 ? 'border-red-500' : 'border-slate-600'}`}>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{t('insurance.expiringSoon')}</p>
          <p className={`text-2xl font-semibold ${expiring.length > 0 ? 'text-red-400' : 'text-slate-400'}`}>{expiring.length}</p>
        </div>
      </div>

      {/* Expiry alerts */}
      {expiring.length > 0 && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 mb-5">
          <p className="text-xs font-medium text-red-300 mb-2">⚠️ {t('insurance.expiringSoonSub')}</p>
          <div className="space-y-1">
            {expiring.map(p => {
              const days = Math.ceil((new Date(p.expiry_date).getTime() - Date.now()) / 86_400_000)
              return (
                <div key={p.id} className="flex justify-between text-xs">
                  <span className="text-red-200">{p.insurer_name} — {p.policy_number} ({t(`insurance.policyTypes.${p.policy_type}`)})</span>
                  <span className="text-red-400 font-medium">{days > 0 ? `${days}d` : 'EXPIRED'}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filters + Add */}
      <div className="flex gap-3 mb-4 items-center">
        <select value={filterType} onChange={e => setFilterType(e.target.value as InsurancePolicyType | '')} className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-300 focus:outline-none">
          <option value="">{t('insurance.allTypes')}</option>
          {POLICY_TYPES.map(tp => <option key={tp} value={tp}>{t(`insurance.policyTypes.${tp}`)}</option>)}
        </select>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value as 'true' | 'false' | '')} className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-300 focus:outline-none">
          <option value="">{t('insurance.allStatus')}</option>
          <option value="true">{t('common.active')}</option>
          <option value="false">{t('common.inactive')}</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          {syncResult && (
            <span className={`text-xs ${syncResult.failed > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {syncResult.failed > 0
                ? `⚠ ${syncResult.failed} failed`
                : `✓ ${syncResult.total_events_created} event${syncResult.total_events_created !== 1 ? 's' : ''} synced`}
            </span>
          )}
          <button
            onClick={syncToCalendar}
            disabled={syncing}
            className="px-3 py-1.5 bg-slate-700 hover:bg-green-800 disabled:opacity-50 text-slate-300 hover:text-white text-xs rounded-lg transition-colors"
            title={t('insurance.syncCalendarTooltip')}
          >{syncing ? '⏳' : '📅'} {t('insurance.syncCalendarBtn')}</button>
          <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">{t('insurance.addBtn')}</button>
        </div>
      </div>

      {/* Policies list */}
      {isLoading && <p className="text-slate-400 text-sm">{t('common.loading')}</p>}
      {!isLoading && policies.length === 0 && <p className="text-slate-500 text-sm">{t('insurance.noPolicies')}</p>}

      {policies.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2">{t('insurance.colInsurer')}</th>
                <th className="text-left px-4 py-2">{t('insurance.colType')}</th>
                <th className="text-left px-4 py-2">{t('insurance.colAsset')}</th>
                <th className="text-left px-4 py-2">{t('insurance.colEntity')}</th>
                <th className="text-right px-4 py-2">{t('insurance.colCoverage')}</th>
                <th className="text-right px-4 py-2">{t('insurance.colPremium')}</th>
                <th className="text-right px-4 py-2">{t('insurance.colExpiry')}</th>
                <th className="text-right px-4 py-2">{t('insurance.colStatus')}</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {policies.map(p => {
                const days = Math.ceil((new Date(p.expiry_date).getTime() - Date.now()) / 86_400_000)
                const expiryColor = !p.is_active ? 'text-slate-500' : days < 30 ? 'text-red-400' : days < 90 ? 'text-yellow-400' : 'text-slate-300'
                return (
                  <tr key={p.id} className="hover:bg-slate-700/30 transition-colors cursor-pointer" onClick={() => setSelected(p)}>
                    <td className="px-4 py-3">
                      <p className="text-slate-100 font-medium">{p.insurer_name}</p>
                      <p className="text-xs text-slate-500">{p.policy_number}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {t(`insurance.policyTypes.${p.policy_type}`)}
                      {p.sub_type && <span className="text-xs text-slate-500 ml-1">({p.sub_type})</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {assetLabel(p) ?? <span className="text-slate-600">{t(`insurance.assetTypes.${p.insured_asset_type}`)}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{entityName(p.owner_entity_id)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-200">{fmtTTD(p.coverage_amount_ttd)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-400">
                      {fmtTTD(p.premium_amount_ttd)}
                      <span className="text-xs text-slate-600 ml-1">/{t(`insurance.frequencies.${p.premium_frequency}`)}</span>
                    </td>
                    <td className={`px-4 py-3 text-right text-xs ${expiryColor}`}>{fmtDate(p.expiry_date)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${p.is_active ? 'bg-green-900/50 text-green-300 border border-green-700' : 'bg-slate-700 text-slate-500'}`}>
                        {p.is_active ? t('common.active') : t('common.inactive')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={e => { e.stopPropagation(); setPolicyHistory({ id: p.id, name: `${p.insurer_name} — ${p.policy_number}` }) }}
                        className="text-xs text-slate-500 hover:text-slate-300 transition-colors mr-3">
                        History
                      </button>
                      <span className="text-xs text-slate-500 hover:text-blue-400">{t('insurance.view')}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd       && <AddPolicyModal onClose={() => setShowAdd(false)} onCreated={refresh} />}
      {selected      && <PolicyDetail policy={selected} onClose={() => setSelected(null)} />}
      {policyHistory && <PolicyHistoryModal id={policyHistory.id} name={policyHistory.name} onClose={() => setPolicyHistory(null)} />}
    </div>
  )
}
