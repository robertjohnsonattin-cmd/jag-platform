import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { propertiesApi } from '../../api/properties'
import { financeApi } from '../../api/finance'
import { filesApi } from '../../api/files'
import { useAuth } from '../../auth/AuthProvider'
import { fmtTTD, fmtDate } from '../../lib/entities'
import FileUpload from '../ui/FileUpload'
import ConfirmDeleteModal from '../ui/ConfirmDeleteModal'
import type { InsurancePolicy } from '../../types/finance'
import type {
  Property, VendorInvoice,
  PropertyTaxRecord, Inspection,
  Lease, PropertyDocument,
  UtilityAccount, Unit, UnitPhoto, RentPayment, RentReceipt,
  PropertyValuationHistory,
} from '../../types/properties'

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

// occupancy_status is derived server-side from actual unit occupancy for
// multi-unit properties (falls back to is_rented for single-unit ones) — see
// occupancyStatus() in routes/properties/properties.ts.
function occupancyBadge(p: Property, t: TFunction, bordered?: boolean): { label: string; className: string } {
  const status = p.occupancy_status ?? (p.is_rented ? 'RENTED' : 'VACANT')
  const border = (c: string) => bordered ? `border ${c}` : ''
  if (status === 'RENTED') return { label: t('propertiesPanel.rented'), className: `text-green-400 ${border('border-green-700')}` }
  if (status === 'PARTIALLY_RENTED') {
    const label = `${t('propertiesPanel.partiallyRented', 'Partially Rented')} (${p.rented_units}/${p.total_units})`
    return { label, className: `text-amber-400 ${border('border-amber-700')}` }
  }
  return { label: t('propertiesPanel.vacant'), className: `text-slate-500 ${border('border-slate-600')}` }
}

function InfoField({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className={`text-sm text-slate-200 ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</p>
    </div>
  )
}

function Empty({ message = 'No records found' }: { message?: string }) {
  return <p className="text-sm text-slate-500 py-6 text-center">{message}</p>
}

const INVOICE_STATUS_STYLES: Record<string, string> = {
  RECEIVED: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  APPROVED: 'bg-blue-900/50 text-blue-300 border-blue-700',
  PAID:     'bg-green-900/50 text-green-300 border-green-700',
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const PROP_TYPES = ['RESIDENTIAL', 'COMMERCIAL', 'LAND', 'MIXED', 'AGRICULTURAL'] as const
const TENURE_TYPES = ['FREEHOLD', 'LEASEHOLD', 'STATE_LAND'] as const
// BANK_TRANSFER first — primary method for JAG Properties rent collection
// WIPAY kept last for display of historical records only
const PAY_METHODS = ['BANK_TRANSFER','CASH','CHEQUE','OTHER','WIPAY'] as const

// ─── Add Property Modal ───────────────────────────────────────────────────────
function AddPropertyModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    name: '', property_code: '', address_line1: '', address_line2: '', city: '',
    country: 'Trinidad and Tobago',
    property_type: 'RESIDENTIAL' as typeof PROP_TYPES[number],
    tenure_type: 'FREEHOLD' as typeof TENURE_TYPES[number],
    bedrooms: '', bathrooms: '', lot_size_sqm: '', floor_area_sqm: '',
    purchase_price: '', purchase_date: '',
    current_valuation: '', valuation_date: '',
    notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.createProperty({
      name: form.name,
      property_code: form.property_code,
      address_line1: form.address_line1 || undefined,
      address_line2: form.address_line2 || undefined,
      city: form.city || undefined,
      country: form.country,
      property_type: form.property_type,
      tenure_type: form.tenure_type,
      bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
      bathrooms: form.bathrooms ? Number(form.bathrooms) : undefined,
      lot_size_sqm: form.lot_size_sqm ? Number(form.lot_size_sqm) : undefined,
      floor_area_sqm: form.floor_area_sqm ? Number(form.floor_area_sqm) : undefined,
      purchase_price: form.purchase_price ? Number(form.purchase_price) : undefined,
      purchase_date: form.purchase_date || undefined,
      current_valuation: form.current_valuation ? Number(form.current_valuation) : undefined,
      valuation_date: form.valuation_date || undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('propertiesPanel.addProperty')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.propertyName')}</label>
              <input value={form.name} onChange={set('name')} className={cls} placeholder="e.g. Chaguanas House" />
            </div>
            <div className="w-36">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.code')}</label>
              <input value={form.property_code} onChange={set('property_code')} className={cls} placeholder="PROP-001" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.addressLine1')}</label>
            <input value={form.address_line1} onChange={set('address_line1')} className={cls} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.city')}</label>
              <input value={form.city} onChange={set('city')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.country')}</label>
              <input value={form.country} onChange={set('country')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('common.type')}</label>
              <select value={form.property_type} onChange={set('property_type')} className={cls}>
                {PROP_TYPES.map(tp => <option key={tp} value={tp}>{t(`propertiesPanel.propTypes.${tp}`, tp)}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.tenure')}</label>
              <select value={form.tenure_type} onChange={set('tenure_type')} className={cls}>
                {TENURE_TYPES.map(tn => <option key={tn} value={tn}>{t(`propertiesPanel.tenureTypes.${tn}`, tn.replace(/_/g,' '))}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.bedrooms')}</label>
              <input type="number" min="0" step="1" value={form.bedrooms} onChange={set('bedrooms')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.bathrooms')}</label>
              <input type="number" min="0" step="0.5" value={form.bathrooms} onChange={set('bathrooms')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.floorArea')}</label>
              <input type="number" step="0.01" value={form.floor_area_sqm} onChange={set('floor_area_sqm')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.purchasePrice')}</label>
              <input type="number" step="0.01" value={form.purchase_price} onChange={set('purchase_price')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.purchaseDate')}</label>
              <input type="date" value={form.purchase_date} onChange={set('purchase_date')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.currentValuation')}</label>
              <input type="number" step="0.01" value={form.current_valuation} onChange={set('current_valuation')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.valuationDate')}</label>
              <input type="date" value={form.valuation_date} onChange={set('valuation_date')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.name || !form.property_code}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('propertiesPanel.addProperty')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Lease Modal ──────────────────────────────────────────────────────────
function AddLeaseModal({ propertyId, onClose, onCreated }: { propertyId: string; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const { data: tenants = [] } = useQuery({ queryKey: ['properties', 'tenants'], queryFn: () => propertiesApi.getTenants() })
  const { data: units = [] } = useQuery({ queryKey: ['properties', propertyId, 'units'], queryFn: () => propertiesApi.getUnits(propertyId) })
  const [form, setForm] = useState({
    tenant_id: '', unit_id: '', lease_type: 'RESIDENTIAL',
    start_date: '', end_date: '',
    monthly_rent: '', security_deposit: '0',
    payment_due_day: '1', currency: 'TTD',
    late_fee_type: 'NONE', late_fee_value: '0', late_fee_grace_days: '0',
    notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.createLease(propertyId, {
      tenant_id: form.tenant_id,
      unit_id: form.unit_id || undefined,
      lease_type: form.lease_type,
      start_date: form.start_date,
      end_date: form.end_date || undefined,
      monthly_rent: Number(form.monthly_rent),
      security_deposit: Number(form.security_deposit),
      payment_due_day: Number(form.payment_due_day),
      currency: form.currency,
      late_fee_type: form.late_fee_type,
      late_fee_value: Number(form.late_fee_value),
      late_fee_grace_days: Number(form.late_fee_grace_days),
      notes: form.notes || undefined,
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('propertiesPanel.addLease')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.tenant')}</label>
            <select value={form.tenant_id} onChange={set('tenant_id')} className={cls}>
              <option value="">— {t('propertiesPanel.selectTenant')} —</option>
              {tenants.map(tn => (
                <option key={tn.id} value={tn.id}>
                  {tn.is_company ? tn.company_name : `${tn.first_name} ${tn.last_name ?? ''}`}
                </option>
              ))}
            </select>
          </div>
          {units.length > 0 && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.unitOptional')}</label>
              <select value={form.unit_id} onChange={set('unit_id')} className={cls}>
                <option value="">— whole property / no unit —</option>
                {units.map((u: Unit) => (
                  <option key={u.id} value={u.id}>
                    {t('propertiesPanel.unitLbl')} {u.unit_number}{u.floor != null ? ` · Floor ${u.floor}` : ''}{u.bedrooms != null ? ` · ${u.bedrooms}BR` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.leaseType')}</label>
              <select value={form.lease_type} onChange={set('lease_type')} className={cls}>
                {['RESIDENTIAL','COMMERCIAL','SHORT_TERM','OTHER'].map(lt => <option key={lt} value={lt}>{lt}</option>)}
              </select>
            </div>
            <div className="w-20">
              <label className="block text-xs text-slate-400 mb-1">Currency</label>
              <input maxLength={3} value={form.currency} onChange={set('currency')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.leaseStart')}</label>
              <input type="date" value={form.start_date} onChange={set('start_date')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.leaseEnd')}</label>
              <input type="date" value={form.end_date} onChange={set('end_date')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.monthlyRent')}</label>
              <input type="number" step="0.01" value={form.monthly_rent} onChange={set('monthly_rent')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.securityDeposit')}</label>
              <input type="number" step="0.01" value={form.security_deposit} onChange={set('security_deposit')} className={cls} />
            </div>
            <div className="w-24">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.dueDay')}</label>
              <input type="number" min="1" max="28" value={form.payment_due_day} onChange={set('payment_due_day')} className={cls} />
            </div>
          </div>
          <div className="border-t border-slate-700 pt-3">
            <p className="text-xs text-slate-400 mb-2 font-medium">{t('propertiesPanel.lateFeePolicy')}</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">{t('common.type')}</label>
                <select value={form.late_fee_type} onChange={set('late_fee_type')} className={cls}>
                  <option value="NONE">{t('propertiesPanel.lateFeeNone')}</option>
                  <option value="FIXED">{t('propertiesPanel.lateFeeFixed')}</option>
                  <option value="PERCENT">{t('propertiesPanel.lateFeePct')}</option>
                </select>
              </div>
              {form.late_fee_type !== 'NONE' && (
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">
                    {form.late_fee_type === 'PERCENT' ? t('propertiesPanel.lateFeePctField') : t('propertiesPanel.lateFeePctAmountField')}
                  </label>
                  <input type="number" step="0.01" min="0" value={form.late_fee_value} onChange={set('late_fee_value')} className={cls} />
                </div>
              )}
              {form.late_fee_type !== 'NONE' && (
                <div className="w-24">
                  <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.lateGraceDays')}</label>
                  <input type="number" min="0" value={form.late_fee_grace_days} onChange={set('late_fee_grace_days')} className={cls} />
                </div>
              )}
            </div>
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.tenant_id || !form.start_date || !form.monthly_rent}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('propertiesPanel.addLeaseBtn')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Record Payment Modal ─────────────────────────────────────────────────────
function RecordPaymentModal({ propertyId, onClose, onRecorded }: {
  propertyId: string
  onClose: () => void
  onRecorded: (paymentId: string) => void
}) {
  const { t } = useTranslation()
  const { token } = useAuth()
  const { data: leases = [] } = useQuery({
    queryKey: ['properties', propertyId, 'leases'],
    queryFn: () => propertiesApi.getLeases(propertyId),
  })
  const now = new Date()
  const [form, setForm] = useState({
    lease_id: '', payment_date: now.toISOString().slice(0,10),
    period_month: String(now.getMonth() + 1),
    period_year: String(now.getFullYear()),
    amount_due: '', amount_paid: '', late_fee_charged: '0',
    payment_method: 'BANK_TRANSFER' as typeof PAY_METHODS[number],
    receipt_number: '', notes: '',
  })
  const [proofKey, setProofKey] = useState<string | null>(null)
  const [proofName, setProofName] = useState<string | null>(null)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  // Auto-fill amount_due from selected lease
  const selectedLease = leases.find(l => l.id === form.lease_id)
  const handleLeaseChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lease = leases.find(l => l.id === e.target.value)
    setForm(f => ({
      ...f,
      lease_id: e.target.value,
      amount_due: lease ? String(parseFloat(lease.monthly_rent).toFixed(2)) : f.amount_due,
      amount_paid: lease ? String(parseFloat(lease.monthly_rent).toFixed(2)) : f.amount_paid,
    }))
  }

  const handleProofSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !token) return
    setUploadErr(null)
    setUploading(true)
    try {
      const result = await filesApi.upload(token, file, 'jag-receipts', 'properties', propertyId)
      setProofKey(result.key)
      setProofName(result.original_name)
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.createRentPayment(propertyId, {
      lease_id: form.lease_id,
      payment_date: form.payment_date,
      period_month: Number(form.period_month),
      period_year: Number(form.period_year),
      amount_due: Number(form.amount_due),
      amount_paid: Number(form.amount_paid),
      late_fee_charged: Number(form.late_fee_charged),
      payment_method: form.payment_method,
      receipt_number: form.receipt_number || undefined,
      notes: form.notes || undefined,
      proof_image_url: proofKey ?? undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: (payment) => { onRecorded(payment.id); onClose() },
  })

  const isPartial = form.amount_due && form.amount_paid &&
    parseFloat(form.amount_paid) < parseFloat(form.amount_due)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('propertiesPanel.recordRentPayment')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.leaseSel')}</label>
            <select value={form.lease_id} onChange={handleLeaseChange} className={cls}>
              <option value="">— select lease —</option>
              {leases.map(l => (
                <option key={l.id} value={l.id}>
                  {l.is_company ? l.company_name : `${l.first_name} ${l.last_name ?? ''}`} — {fmtTTD(l.monthly_rent)}/mo
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.paymentDate')}</label>
              <input type="date" value={form.payment_date} onChange={set('payment_date')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.periodMonth')}</label>
              <select value={form.period_month} onChange={set('period_month')} className={cls}>
                {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.periodYear')}</label>
              <input type="number" min="2020" value={form.period_year} onChange={set('period_year')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.amountDue')}</label>
              <input type="number" step="0.01" value={form.amount_due} onChange={set('amount_due')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.amountPaid')}</label>
              <input type="number" step="0.01" value={form.amount_paid} onChange={set('amount_paid')} className={cls} />
            </div>
          </div>
          {isPartial && (
            <p className="text-yellow-400 text-xs bg-yellow-900/20 border border-yellow-800 rounded px-2 py-1">
              ⚠ {t('propertiesPanel.partialPayment')} — balance of {fmtTTD(String(parseFloat(form.amount_due) - parseFloat(form.amount_paid)))} remains outstanding.
            </p>
          )}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.colMethod')}</label>
              <select value={form.payment_method} onChange={set('payment_method')} className={cls}>
                {PAY_METHODS.map(m => <option key={m} value={m}>{m.replace(/_/g,' ')}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.receiptNo')}</label>
              <input value={form.receipt_number} onChange={set('receipt_number')} className={cls} />
            </div>
            <div className="w-28">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.lateFee')}</label>
              <input type="number" step="0.01" value={form.late_fee_charged} onChange={set('late_fee_charged')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea rows={2} value={form.notes} onChange={set('notes')} className={cls} placeholder="Optional notes" />
          </div>

          {/* WhatsApp proof photo upload */}
          <div className="border border-slate-600 rounded-lg p-3 bg-slate-700/30">
            <label className="block text-xs text-slate-300 font-medium mb-2">{t('propertiesPanel.paymentProof')}</label>
            {proofKey ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-green-400">✓ {proofName ?? 'Photo uploaded'}</span>
                <button type="button" onClick={() => { setProofKey(null); setProofName(null) }}
                  className="text-xs text-slate-500 hover:text-red-400 transition-colors">{t('propertiesPanel.remove')}</button>
              </div>
            ) : (
              <div>
                <label className="cursor-pointer">
                  <input type="file" accept="image/*" onChange={handleProofSelect} className="hidden" disabled={uploading} />
                  <span className={`inline-block px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    uploading ? 'bg-slate-600 border-slate-500 text-slate-400' : 'bg-slate-700 hover:bg-slate-600 border-slate-600 text-slate-200 cursor-pointer'
                  }`}>
                    {uploading ? t('propertiesPanel.uploadingLabel') : t('propertiesPanel.selectPhoto')}
                  </span>
                </label>
                <p className="text-xs text-slate-500 mt-1">{t('propertiesPanel.uploadHint')}</p>
              </div>
            )}
            {uploadErr && <p className="text-xs text-red-400 mt-1">{uploadErr}</p>}
          </div>

          {selectedLease && (
            <p className="text-xs text-slate-500">
              Lease: {selectedLease.is_company ? selectedLease.company_name : `${selectedLease.first_name} ${selectedLease.last_name ?? ''}`} · {t('propertiesPanel.dueDayLbl')} {selectedLease.payment_due_day}
            </p>
          )}
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || uploading || !form.lease_id || !form.amount_due || !form.amount_paid}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('propertiesPanel.recordGetReceipt')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Receipt Modal ────────────────────────────────────────────────────────────
const MONTH_NAMES = ['January','February','March','April','May','June',
  'July','August','September','October','November','December']

function ReceiptModal({ propertyId, paymentId, onClose }: {
  propertyId: string
  paymentId: string
  onClose: () => void
}) {
  const { token } = useAuth()
  const [copied, setCopied] = useState(false)
  const [proofUrl, setProofUrl] = useState<string | null>(null)

  const { data: receipt, isLoading } = useQuery({
    queryKey: ['properties', propertyId, 'receipt', paymentId],
    queryFn: () => propertiesApi.getReceipt(propertyId, paymentId),
  })

  // Load proof image if available
  useEffect(() => {
    if (receipt?.proof_image_url && token) {
      filesApi.download(token, 'jag-receipts', receipt.proof_image_url)
        .then(url => setProofUrl(url))
        .catch(() => null)
    }
  }, [receipt?.proof_image_url, token])

  const formatReceipt = (r: RentReceipt): string => {
    const amtDue = parseFloat(r.amount_due)
    const amtPaid = parseFloat(r.amount_paid)
    const balance = amtDue - amtPaid
    const lateFee = parseFloat(r.late_fee_charged)
    const refNo = r.receipt_number ?? `JAG-${r.id.slice(-8).toUpperCase()}`
    const method = r.payment_method.replace(/_/g, ' ')
    const period = `${MONTH_NAMES[r.period_month - 1]} ${r.period_year}`
    const fmtAmt = (v: number) => `TTD ${v.toLocaleString('en-TT', { minimumFractionDigits: 2 })}`

    let text = `🏠 *JAG Properties*\n`
    text += `━━━━━━━━━━━━━━━━━━\n`
    text += `📋 *RENT RECEIPT*\n\n`
    text += `Property: ${r.property_name}\n`
    if (r.unit_number) text += `Unit: ${r.unit_number}\n`
    text += `Tenant: ${r.tenant_name}\n`
    text += `Period: ${period}\n\n`
    text += `Amount Due:  ${fmtAmt(amtDue)}\n`
    text += `Amount Paid: ${fmtAmt(amtPaid)}\n`
    if (balance > 0.005) text += `Balance Owed: ${fmtAmt(balance)}\n`
    if (lateFee > 0) text += `Late Fee: ${fmtAmt(lateFee)}\n`
    text += `Method: ${method}\n`
    text += `Date: ${fmtDate(r.payment_date)}\n\n`
    text += `Receipt No: ${refNo}\n`
    text += `━━━━━━━━━━━━━━━━━━\n`
    if (balance > 0.005) {
      text += `⚠ *Partial payment received.*\nPlease arrange the outstanding balance.\n`
    } else {
      text += `✅ Payment received in full. Thank you!\n`
    }
    text += `\nJAG Properties`
    return text
  }

  const handleCopy = () => {
    if (!receipt) return
    void navigator.clipboard.writeText(formatReceipt(receipt)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  const handleWhatsApp = () => {
    if (!receipt) return
    const text = encodeURIComponent(formatReceipt(receipt))
    window.open(`https://wa.me/?text=${text}`, '_blank')
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-white">WhatsApp Receipt</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        {isLoading && <p className="text-slate-400 text-sm">Loading receipt…</p>}

        {receipt && (
          <>
            <pre className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-xs text-slate-200 whitespace-pre-wrap font-mono leading-relaxed mb-4 select-all">
              {formatReceipt(receipt)}
            </pre>

            {proofUrl && (
              <div className="mb-4">
                <p className="text-xs text-slate-400 mb-1">Payment proof:</p>
                <img src={proofUrl} alt="Payment proof" className="max-h-48 rounded border border-slate-600 object-contain" />
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={handleCopy}
                className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors border border-slate-600">
                {copied ? '✓ Copied!' : '📋 Copy Text'}
              </button>
              <button onClick={handleWhatsApp}
                className="flex-1 py-2 bg-green-700 hover:bg-green-600 text-white text-sm rounded-lg transition-colors">
                💬 Open WhatsApp
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-3 text-center">
              Copy the text above and paste it into WhatsApp, or tap "Open WhatsApp" to pre-fill.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Add Mortgage Modal ───────────────────────────────────────────────────────
function AddMortgageModal({ propertyId, onClose, onCreated }: { propertyId: string; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    lender_name: '', account_reference: '',
    mortgage_type: 'FIXED_RATE',
    original_amount: '', outstanding_balance: '',
    interest_rate_percent: '', monthly_payment: '',
    currency: 'TTD', payment_due_day: '1',
    start_date: '', maturity_date: '', notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.createMortgage(propertyId, {
      lender_name: form.lender_name,
      account_reference: form.account_reference || undefined,
      mortgage_type: form.mortgage_type,
      original_amount: Number(form.original_amount),
      outstanding_balance: Number(form.outstanding_balance),
      interest_rate_percent: Number(form.interest_rate_percent),
      monthly_payment: Number(form.monthly_payment),
      currency: form.currency,
      payment_due_day: Number(form.payment_due_day),
      start_date: form.start_date,
      maturity_date: form.maturity_date || undefined,
      notes: form.notes || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('propertiesPanel.addMortgage')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.lender')}</label>
              <input value={form.lender_name} onChange={set('lender_name')} className={cls} placeholder="e.g. First Citizens Bank" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.accountRef')}</label>
              <input value={form.account_reference} onChange={set('account_reference')} className={cls} placeholder="last 4 digits" maxLength={50} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('common.type')}</label>
              <select value={form.mortgage_type} onChange={set('mortgage_type')} className={cls}>
                {['FIXED_RATE','VARIABLE_RATE','INTEREST_ONLY'].map(mt => <option key={mt} value={mt}>{t(`propertiesPanel.mortgageTypes.${mt}`, mt.replace(/_/g,' '))}</option>)}
              </select>
            </div>
            <div className="w-20">
              <label className="block text-xs text-slate-400 mb-1">Currency</label>
              <input maxLength={3} value={form.currency} onChange={set('currency')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.originalAmount')}</label>
              <input type="number" step="0.01" value={form.original_amount} onChange={set('original_amount')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.outstandingBalance')}</label>
              <input type="number" step="0.01" value={form.outstanding_balance} onChange={set('outstanding_balance')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.interestRate')}</label>
              <input type="number" step="0.0001" value={form.interest_rate_percent} onChange={set('interest_rate_percent')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.monthlyPayment')}</label>
              <input type="number" step="0.01" value={form.monthly_payment} onChange={set('monthly_payment')} className={cls} />
            </div>
            <div className="w-24">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.dueDay')}</label>
              <input type="number" min="1" max="28" value={form.payment_due_day} onChange={set('payment_due_day')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.leaseStart')}</label>
              <input type="date" value={form.start_date} onChange={set('start_date')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.maturityDate')}</label>
              <input type="date" value={form.maturity_date} onChange={set('maturity_date')} className={cls} />
            </div>
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()}
            disabled={isPending || !form.lender_name || !form.original_amount || !form.outstanding_balance || !form.interest_rate_percent || !form.monthly_payment || !form.start_date}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('propertiesPanel.addMortgageBtn')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Utility Modal ────────────────────────────────────────────────────────
function AddUtilityModal({ propertyId, onClose, onCreated }: { propertyId: string; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    utility_type: 'ELECTRICITY',
    provider: '', bill_date: '', paid_date: '',
    amount: '', vat_amount: '0', vat_code: 'STANDARD', notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.createUtility(propertyId, {
      utility_type: form.utility_type,
      provider: form.provider,
      bill_date: form.bill_date,
      paid_date: form.paid_date || undefined,
      amount: Number(form.amount),
      vat_amount: Number(form.vat_amount),
      vat_code: form.vat_code,
      notes: form.notes || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('propertiesPanel.recordUtilityBill')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('common.type')}</label>
              <select value={form.utility_type} onChange={set('utility_type')} className={cls}>
                {['ELECTRICITY','WATER','GAS','INTERNET','OTHER'].map(ut => <option key={ut} value={ut}>{ut}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.provider')}</label>
              <input value={form.provider} onChange={set('provider')} className={cls} placeholder="e.g. TTEC" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.billDate')}</label>
              <input type="date" value={form.bill_date} onChange={set('bill_date')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.paidDate')}</label>
              <input type="date" value={form.paid_date} onChange={set('paid_date')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('common.amount')} *</label>
              <input type="number" step="0.01" value={form.amount} onChange={set('amount')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.vatAmount')}</label>
              <input type="number" step="0.01" value={form.vat_amount} onChange={set('vat_amount')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.vatCode')}</label>
              <select value={form.vat_code} onChange={set('vat_code')} className={cls}>
                {['STANDARD','ZERO','EXEMPT'].map(vc => <option key={vc} value={vc}>{t(`propertiesPanel.vatCodes.${vc}`, vc)}</option>)}
              </select>
            </div>
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.provider || !form.bill_date || !form.amount}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('propertiesPanel.recordBill')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Vendor Invoice Modal ─────────────────────────────────────────────────
function AddInvoiceModal({ propertyId, onClose, onCreated }: { propertyId: string; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    vendor_name: '', invoice_ref: '', invoice_date: '', due_date: '',
    amount: '', vat_amount: '0', vat_code: 'STANDARD', notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.createVendorInvoice(propertyId, {
      vendor_name: form.vendor_name,
      invoice_ref: form.invoice_ref || undefined,
      invoice_date: form.invoice_date,
      due_date: form.due_date || undefined,
      amount: Number(form.amount),
      vat_amount: Number(form.vat_amount),
      vat_code: form.vat_code,
      notes: form.notes || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('propertiesPanel.addVendorInvoice')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.vendor')}</label>
              <input value={form.vendor_name} onChange={set('vendor_name')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.invoiceRef')}</label>
              <input value={form.invoice_ref} onChange={set('invoice_ref')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.invoiceDate')}</label>
              <input type="date" value={form.invoice_date} onChange={set('invoice_date')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.dueDate')}</label>
              <input type="date" value={form.due_date} onChange={set('due_date')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('common.amount')} *</label>
              <input type="number" step="0.01" value={form.amount} onChange={set('amount')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.vatAmount')}</label>
              <input type="number" step="0.01" value={form.vat_amount} onChange={set('vat_amount')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.vatCode')}</label>
              <select value={form.vat_code} onChange={set('vat_code')} className={cls}>
                {['STANDARD','ZERO','EXEMPT'].map(vc => <option key={vc} value={vc}>{t(`propertiesPanel.vatCodes.${vc}`, vc)}</option>)}
              </select>
            </div>
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.vendor_name || !form.invoice_date || !form.amount}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('propertiesPanel.addInvoice')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Pay Invoice Modal ────────────────────────────────────────────────────────
function PayInvoiceModal({ propertyId, inv, onClose, onUpdated }: {
  propertyId: string; inv: VendorInvoice; onClose: () => void; onUpdated: () => void
}) {
  const { t } = useTranslation()
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0,10))
  const [payRef, setPayRef] = useState('')

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.payInvoice(propertyId, inv.id, {
      paid_date: paidDate,
      payment_reference: payRef || undefined,
    }),
    onSuccess: () => { onUpdated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-base font-semibold mb-4 text-white">{t('propertiesPanel.payInvoiceTitle')} {inv.vendor_name}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.paidDate')}</label>
            <input type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.paidRef')}</label>
            <input value={payRef} onChange={e => setPayRef(e.target.value)} className={cls} placeholder="Cheque no., transfer ref…" />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !paidDate}
            className="flex-1 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('propertiesPanel.markPaidBtn')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Property Insurance Modal ────────────────────────────────────────────
const PROP_INS_TYPES = ['BUILDING','CONTENTS','COMPREHENSIVE','FLOOD','FIRE','LIABILITY','OTHER'] as const

function AddPropertyInsuranceModal({ propertyId, onClose, onCreated }: { propertyId: string; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const OWNER_ENTITY = '00000000-0000-0000-0001-000000000003' // JAG_PROPERTIES
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState({
    policy_type: 'BUILDING' as string, sub_type: '',
    policy_number: '', insurer_name: '', broker_name: '',
    coverage_amount: '', premium_amount: '', premium_frequency: 'ANNUAL',
    start_date: '', expiry_date: '', notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSave = async () => {
    setSaveError(null)
    setIsSaving(true)
    try {
      await financeApi.createPolicy({
        owner_entity_id: OWNER_ENTITY,
        policy_type: form.policy_type as Parameters<typeof financeApi.createPolicy>[0]['policy_type'],
        sub_type: form.sub_type || undefined,
        insured_asset_type: 'PROPERTY' as const,
        insured_asset_ref: propertyId,
        policy_number: form.policy_number || `PROP-${Date.now()}`,
        insurer_name: form.insurer_name,
        broker_name: form.broker_name || undefined,
        coverage_amount: parseFloat(form.coverage_amount) || 1,
        coverage_amount_ttd: parseFloat(form.coverage_amount) || 1,
        currency: 'TTD',
        premium_amount: parseFloat(form.premium_amount) || 1,
        premium_amount_ttd: parseFloat(form.premium_amount) || 1,
        premium_frequency: form.premium_frequency as Parameters<typeof financeApi.createPolicy>[0]['premium_frequency'],
        start_date: form.start_date || new Date().toISOString().slice(0,10),
        expiry_date: form.expiry_date || new Date(Date.now() + 365*24*60*60*1000).toISOString().slice(0,10),
        renewal_alert_days: 60,
        notes: form.notes || undefined,
      })
      onCreated()
      onClose()
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed — check all required fields.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
          <h2 className="text-sm font-semibold text-slate-100">{t('propertiesPanel.addInsurance')}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Type *</label>
              <select value={form.policy_type} onChange={set('policy_type')} className={cls}>
                {PROP_INS_TYPES.map(tp => <option key={tp} value={tp}>{t(`insurance.policyTypes.${tp}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Sub-type</label>
              <input value={form.sub_type} onChange={set('sub_type')} className={cls} placeholder="e.g. All-risks" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Insurer *</label>
              <input value={form.insurer_name} onChange={set('insurer_name')} className={cls} placeholder="Guardian General" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Policy Number</label>
              <input value={form.policy_number} onChange={set('policy_number')} className={cls} placeholder="POL-2026-001" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Broker</label>
            <input value={form.broker_name} onChange={set('broker_name')} className={cls} placeholder="Optional" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Coverage (TTD)</label>
              <input type="number" min="0" step="0.01" value={form.coverage_amount} onChange={set('coverage_amount')} className={cls} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Premium (TTD)</label>
              <input type="number" min="0" step="0.01" value={form.premium_amount} onChange={set('premium_amount')} className={cls} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Frequency</label>
              <select value={form.premium_frequency} onChange={set('premium_frequency')} className={cls}>
                {['MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL','ONE_OFF'].map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Start Date</label>
              <input type="date" value={form.start_date} onChange={set('start_date')} className={cls} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Expiry Date</label>
              <input type="date" value={form.expiry_date} onChange={set('expiry_date')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea rows={2} value={form.notes} onChange={set('notes')} className={cls + ' resize-none'} />
          </div>
          {saveError && <p className="text-red-400 text-xs rounded bg-red-900/30 border border-red-700 px-3 py-2">{saveError}</p>}
          <div className="flex justify-end pt-2">
            <button onClick={() => void handleSave()} disabled={!form.insurer_name || isSaving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
              {isSaving ? t('propertiesPanel.addingLabel') : t('propertiesPanel.addPolicy')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Property Detail ──────────────────────────────────────────────────────────

// ─── Add Tax Modal ────────────────────────────────────────────────────────────
function AddTaxModal({ propertyId, onClose, onCreated }: { propertyId: string; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    tax_year: new Date().getFullYear().toString(),
    assessment_value: '', tax_amount: '', due_date: '', notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending } = useMutation({
    mutationFn: () => propertiesApi.createTax(propertyId, {
      tax_year: parseInt(form.tax_year),
      assessment_value: form.assessment_value ? parseFloat(form.assessment_value) : undefined,
      tax_amount: parseFloat(form.tax_amount),
      due_date: form.due_date || undefined,
      notes: form.notes || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-sm font-semibold text-slate-100">{t('propertiesPanel.addTaxRecord')}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Tax Year *</label>
              <input type="number" min="2000" max="2100" value={form.tax_year} onChange={set('tax_year')} className={cls} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Due Date</label>
              <input type="date" value={form.due_date} onChange={set('due_date')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Assessment Value</label>
            <input type="number" min="0" step="0.01" value={form.assessment_value} onChange={set('assessment_value')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Tax Amount *</label>
            <input type="number" min="0" step="0.01" value={form.tax_amount} onChange={set('tax_amount')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea rows={2} value={form.notes} onChange={set('notes')} className={cls + ' resize-none'} />
          </div>
          <div className="flex justify-end pt-2">
            <button onClick={() => mutate()} disabled={!form.tax_year || !form.tax_amount || isPending}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
              {isPending ? t('propertiesPanel.addingLabel') : t('propertiesPanel.addTaxBtn')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Pay Tax Modal ────────────────────────────────────────────────────────────
function PayTaxModal({ propertyId, record, onClose, onUpdated }: { propertyId: string; record: PropertyTaxRecord; onClose: () => void; onUpdated: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ paid_date: new Date().toISOString().slice(0, 10), payment_reference: '' })

  const { mutate, isPending } = useMutation({
    mutationFn: () => propertiesApi.payTax(propertyId, record.id, {
      paid_date: form.paid_date,
      payment_reference: form.payment_reference || undefined,
    }),
    onSuccess: () => { onUpdated(); onClose() },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-sm font-semibold text-slate-100">{t('propertiesPanel.payPropertyTax')} — {record.tax_year}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-slate-400">{t('propertiesPanel.amountLabel')} <span className="text-slate-200 font-medium">{fmtTTD(record.tax_amount)}</span></p>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Paid Date *</label>
            <input type="date" value={form.paid_date} onChange={e => setForm(f => ({ ...f, paid_date: e.target.value }))} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Reference</label>
            <input value={form.payment_reference} onChange={e => setForm(f => ({ ...f, payment_reference: e.target.value }))} className={cls} placeholder="Receipt #" />
          </div>
          <div className="flex justify-end pt-2">
            <button onClick={() => mutate()} disabled={!form.paid_date || isPending}
              className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
              {isPending ? t('common.saving') : t('propertiesPanel.markPaidBtn')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Add Inspection Modal ─────────────────────────────────────────────────────
function AddInspectionModal({ propertyId, onClose, onCreated }: { propertyId: string; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    inspection_type: 'PERIODIC', inspection_date: new Date().toISOString().slice(0, 10),
    inspector_name: '', condition_rating: '', next_due_date: '', notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending } = useMutation({
    mutationFn: () => propertiesApi.createInspection(propertyId, {
      inspection_type: form.inspection_type,
      inspection_date: form.inspection_date,
      inspector_name: form.inspector_name || undefined,
      condition_rating: form.condition_rating || undefined,
      next_due_date: form.next_due_date || undefined,
      notes: form.notes || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
          <h2 className="text-sm font-semibold text-slate-100">{t('propertiesPanel.addInspection')}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Type *</label>
              <select value={form.inspection_type} onChange={set('inspection_type')} className={cls}>
                {['MOVE_IN','MOVE_OUT','PERIODIC','PRE_TENANCY','MAINTENANCE','VALUATION'].map(t => <option key={t}>{t.replace('_',' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Date *</label>
              <input type="date" value={form.inspection_date} onChange={set('inspection_date')} className={cls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Inspector Name</label>
              <input value={form.inspector_name} onChange={set('inspector_name')} className={cls} placeholder="Name" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Condition Rating</label>
              <select value={form.condition_rating} onChange={set('condition_rating')} className={cls}>
                <option value="">— Not rated —</option>
                {['EXCELLENT','GOOD','FAIR','POOR'].map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Next Due Date</label>
            <input type="date" value={form.next_due_date} onChange={set('next_due_date')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea rows={3} value={form.notes} onChange={set('notes')} className={cls + ' resize-none'} />
          </div>
          <div className="flex justify-end pt-2">
            <button onClick={() => mutate()} disabled={!form.inspection_date || isPending}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
              {isPending ? t('common.saving') : t('propertiesPanel.saveInspection')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Add Utility Account Modal ────────────────────────────────────────────────
function AddUtilityAccountModal({ propertyId, onClose, onCreated }: { propertyId: string; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const UTIL_TYPES = ['ELECTRICITY','WATER','GAS','INTERNET','OTHER'] as const
  const [form, setForm] = useState({
    utility_type: 'ELECTRICITY' as typeof UTIL_TYPES[number],
    provider: '', account_number: '', account_name: '', notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.createUtilityAccount(propertyId, {
      utility_type: form.utility_type,
      provider: form.provider,
      account_number: form.account_number || undefined,
      account_name: form.account_name || undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-slate-100 mb-4">{t('propertiesPanel.addAccount')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Type *</label>
              <select value={form.utility_type} onChange={set('utility_type')} className={cls}>
                {UTIL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Provider *</label>
              <input value={form.provider} onChange={set('provider')} className={cls} placeholder="e.g. T&TEC" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Account Number</label>
            <input value={form.account_number} onChange={set('account_number')} className={cls} placeholder="e.g. 1234567" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Account Name</label>
            <input value={form.account_name} onChange={set('account_name')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{(error as Error).message}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300">{t('common.cancel')}</button>
          <button onClick={() => mutate()} disabled={isPending || !form.provider}
            className="flex-1 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">
            {isPending ? t('common.saving') : t('propertiesPanel.addAccount')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Unit Modal ───────────────────────────────────────────────────────────
function AddUnitModal({ propertyId, onClose, onCreated }: { propertyId: string; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ unit_number: '', floor: '', bedrooms: '', bathrooms: '', floor_area_sqft: '', notes: '' })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.createUnit(propertyId, {
      unit_number: form.unit_number,
      floor: form.floor ? Number(form.floor) : undefined,
      bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
      bathrooms: form.bathrooms ? Number(form.bathrooms) : undefined,
      floor_area_sqft: form.floor_area_sqft ? Number(form.floor_area_sqft) : undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-slate-100 mb-4">{t('propertiesPanel.addUnit')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.unitNumber')}</label>
              <input value={form.unit_number} onChange={set('unit_number')} className={cls} placeholder="e.g. A1, 2B, 101" />
            </div>
            <div className="w-24">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.floor')}</label>
              <input type="number" value={form.floor} onChange={set('floor')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.bedrooms')}</label>
              <input type="number" min="0" value={form.bedrooms} onChange={set('bedrooms')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.bathrooms')}</label>
              <input type="number" step="0.5" min="0" value={form.bathrooms} onChange={set('bathrooms')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.area')}</label>
              <input type="number" step="0.1" min="0" value={form.floor_area_sqft} onChange={set('floor_area_sqft')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{(error as Error).message}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300">{t('common.cancel')}</button>
          <button onClick={() => mutate()} disabled={isPending || !form.unit_number}
            className="flex-1 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">
            {isPending ? t('common.saving') : t('propertiesPanel.addUnit')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Edit Unit Modal ──────────────────────────────────────────────────────────
function EditUnitModal({ propertyId, unit, onClose, onSaved }: { propertyId: string; unit: Unit; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    unit_number: unit.unit_number,
    floor: unit.floor != null ? String(unit.floor) : '',
    bedrooms: unit.bedrooms != null ? String(unit.bedrooms) : '',
    bathrooms: unit.bathrooms != null ? String(unit.bathrooms) : '',
    floor_area_sqft: unit.floor_area_sqft != null ? String(parseFloat(String(unit.floor_area_sqft))) : '',
    notes: unit.notes ?? '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.patchUnit(propertyId, unit.id, {
      unit_number: form.unit_number || undefined,
      floor: form.floor !== '' ? Number(form.floor) : null,
      bedrooms: form.bedrooms !== '' ? Number(form.bedrooms) : null,
      bathrooms: form.bathrooms !== '' ? Number(form.bathrooms) : null,
      floor_area_sqft: form.floor_area_sqft !== '' ? Number(form.floor_area_sqft) : null,
      notes: form.notes || null,
    }),
    onSuccess: () => { onSaved(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-slate-100 mb-4">{t('propertiesPanel.editUnit')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.unitNumber')}</label>
              <input value={form.unit_number} onChange={set('unit_number')} className={cls} />
            </div>
            <div className="w-24">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.floor')}</label>
              <input type="number" value={form.floor} onChange={set('floor')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.bedrooms')}</label>
              <input type="number" min="0" value={form.bedrooms} onChange={set('bedrooms')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.bathrooms')}</label>
              <input type="number" step="0.5" min="0" value={form.bathrooms} onChange={set('bathrooms')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.area')}</label>
              <input type="number" step="0.1" min="0" value={form.floor_area_sqft} onChange={set('floor_area_sqft')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{(error as Error).message}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300">{t('common.cancel')}</button>
          <button onClick={() => mutate()} disabled={isPending || !form.unit_number}
            className="flex-1 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">
            {isPending ? t('common.saving') : t('propertiesPanel.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Edit Inspection Modal ────────────────────────────────────────────────────
const INSP_TYPES = ['MOVE_IN','MOVE_OUT','PERIODIC','PRE_TENANCY','MAINTENANCE','VALUATION'] as const
const COND_RATINGS = ['EXCELLENT','GOOD','FAIR','POOR'] as const

function EditInspectionModal({ propertyId, inspection, onClose, onSaved }: { propertyId: string; inspection: Inspection; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    inspection_type: inspection.inspection_type,
    inspection_date: inspection.inspection_date,
    inspector_name: inspection.inspector_name ?? '',
    condition_rating: inspection.condition_rating ?? '',
    notes: inspection.notes ?? '',
    next_due_date: inspection.next_due_date ?? '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.updateInspection(propertyId, inspection.id, {
      inspection_type: form.inspection_type,
      inspection_date: form.inspection_date || undefined,
      inspector_name: form.inspector_name || null,
      condition_rating: form.condition_rating || null,
      notes: form.notes || null,
      next_due_date: form.next_due_date || null,
    }),
    onSuccess: () => { onSaved(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-sm font-semibold text-slate-100 mb-4">{t('propertiesPanel.editInspection')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Type</label>
              <select value={form.inspection_type} onChange={set('inspection_type')} className={cls}>
                {INSP_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Date *</label>
              <input type="date" value={form.inspection_date} onChange={set('inspection_date')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Inspector</label>
              <input value={form.inspector_name} onChange={set('inspector_name')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Condition</label>
              <select value={form.condition_rating} onChange={set('condition_rating')} className={cls}>
                <option value="">— none —</option>
                {COND_RATINGS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Next Due Date</label>
            <input type="date" value={form.next_due_date} onChange={set('next_due_date')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={3} className={cls} />
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{(error as Error).message}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300">{t('common.cancel')}</button>
          <button onClick={() => mutate()} disabled={isPending || !form.inspection_date}
            className="flex-1 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">
            {isPending ? t('common.saving') : t('propertiesPanel.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Edit Tax Modal ───────────────────────────────────────────────────────────
function EditTaxModal({ propertyId, record, onClose, onSaved }: { propertyId: string; record: PropertyTaxRecord; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    tax_year: String(record.tax_year),
    assessment_value: record.assessment_value != null ? String(parseFloat(String(record.assessment_value))) : '',
    tax_amount: String(parseFloat(String(record.tax_amount))),
    due_date: record.due_date ?? '',
    notes: record.notes ?? '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.updateTax(propertyId, record.id, {
      tax_year: form.tax_year ? Number(form.tax_year) : undefined,
      assessment_value: form.assessment_value !== '' ? Number(form.assessment_value) : null,
      tax_amount: form.tax_amount !== '' ? Number(form.tax_amount) : undefined,
      due_date: form.due_date || null,
      notes: form.notes || null,
    }),
    onSuccess: () => { onSaved(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-slate-100 mb-4">{t('propertiesPanel.editTax')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="w-24">
              <label className="block text-xs text-slate-400 mb-1">Year</label>
              <input type="number" value={form.tax_year} onChange={set('tax_year')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Tax Amount (TTD)</label>
              <input type="number" step="0.01" min="0" value={form.tax_amount} onChange={set('tax_amount')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Assessment Value (TTD)</label>
            <input type="number" step="0.01" min="0" value={form.assessment_value} onChange={set('assessment_value')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Due Date</label>
            <input type="date" value={form.due_date} onChange={set('due_date')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{(error as Error).message}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300">{t('common.cancel')}</button>
          <button onClick={() => mutate()} disabled={isPending}
            className="flex-1 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">
            {isPending ? t('common.saving') : t('propertiesPanel.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Edit Utility Account Modal ───────────────────────────────────────────────
const UTIL_TYPES = ['ELECTRICITY','WATER','GAS','INTERNET','OTHER'] as const

function EditUtilityAccountModal({ propertyId, account, onClose, onSaved }: { propertyId: string; account: UtilityAccount; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    utility_type: account.utility_type,
    provider: account.provider,
    account_number: account.account_number ?? '',
    account_name: account.account_name ?? '',
    notes: account.notes ?? '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.updateUtilityAccount(propertyId, account.id, {
      utility_type: form.utility_type,
      provider: form.provider,
      account_number: form.account_number || null,
      account_name: form.account_name || null,
      notes: form.notes || null,
    }),
    onSuccess: () => { onSaved(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-slate-100 mb-4">{t('propertiesPanel.editUtilityAccount')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Type</label>
              <select value={form.utility_type} onChange={set('utility_type')} className={cls}>
                {UTIL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Provider *</label>
              <input value={form.provider} onChange={set('provider')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Account Number</label>
              <input value={form.account_number} onChange={set('account_number')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Account Name</label>
              <input value={form.account_name} onChange={set('account_name')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{(error as Error).message}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300">{t('common.cancel')}</button>
          <button onClick={() => mutate()} disabled={isPending || !form.provider}
            className="flex-1 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">
            {isPending ? t('common.saving') : t('propertiesPanel.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Charge Late Fee Modal ────────────────────────────────────────────────────
function ChargeLateFeeModal({ propertyId, payment, lease, onClose, onCharged }: {
  propertyId: string
  payment: RentPayment
  lease: { late_fee_type?: string | null; late_fee_value?: string | null; monthly_rent: string } | null
  onClose: () => void
  onCharged: () => void
}) {
  const { t } = useTranslation()
  const suggested = lease?.late_fee_type === 'FIXED'
    ? Number(lease.late_fee_value ?? 0)
    : lease?.late_fee_type === 'PERCENT'
      ? Number(lease.monthly_rent) * Number(lease.late_fee_value ?? 0) / 100
      : 0
  const [amount, setAmount] = useState(String(suggested > 0 ? suggested.toFixed(2) : ''))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.chargeLateFee(propertyId, payment.id, Number(amount)),
    onSuccess: () => { onCharged(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-slate-100 mb-3">{t('propertiesPanel.chargeLateFee')}</h2>
        <p className="text-xs text-slate-400 mb-4">
          Payment: {MONTHS[payment.period_month - 1]} {payment.period_year} · Due {fmtTTD(payment.amount_due)} · Paid {fmtTTD(payment.amount_paid)}
        </p>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.lateFeeAmountTTD')}</label>
          <input
            type="number" step="0.01" min="0" value={amount}
            onChange={e => setAmount(e.target.value)} className={cls}
          />
          {suggested > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              {t('propertiesPanel.leasePolicySuggests')} {fmtTTD(String(suggested))}
              {lease?.late_fee_type === 'PERCENT' && ` (${lease.late_fee_value}%)`}
            </p>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{(error as Error).message}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300">{t('common.cancel')}</button>
          <button onClick={() => mutate()} disabled={isPending || !amount || Number(amount) <= 0}
            className="flex-1 py-1.5 text-xs rounded bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white">
            {isPending ? t('common.saving') : t('propertiesPanel.chargeFeeBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Refund Deposit Modal ─────────────────────────────────────────────────────
function RefundDepositModal({ propertyId, lease, onClose, onSaved }: { propertyId: string; lease: Lease; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const depositAmount = Number(lease.security_deposit ?? 0)
  const [form, setForm] = useState({
    refunded_amount: String(depositAmount),
    deductions: '0',
    refund_date: new Date().toISOString().slice(0, 10),
    notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.refundDeposit(propertyId, lease.id, {
      refunded_amount: Number(form.refunded_amount),
      deductions: Number(form.deductions),
      refund_date: form.refund_date,
      notes: form.notes || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: () => { onSaved(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-slate-100 mb-4">{t('propertiesPanel.refundSecurityDeposit')}</h2>
        <p className="text-xs text-slate-400 mb-4">
          {t('propertiesPanel.depositHeld')} <span className="text-slate-200 font-mono">{fmtTTD(String(depositAmount))}</span>
          {' · '}
          {lease.is_company ? lease.company_name : `${lease.first_name} ${lease.last_name ?? ''}`}
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.amountRefunded')}</label>
            <input type="number" step="0.01" min="0" value={form.refunded_amount} onChange={set('refunded_amount')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.deductions')}</label>
            <input type="number" step="0.01" min="0" value={form.deductions} onChange={set('deductions')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.refundDate')}</label>
            <input type="date" value={form.refund_date} onChange={set('refund_date')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} placeholder="Reason for deductions, etc." />
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{(error as Error).message}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300">{t('common.cancel')}</button>
          <button
            onClick={() => mutate()}
            disabled={isPending || !form.refund_date}
            className="flex-1 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white"
          >
            {isPending ? t('common.saving') : t('propertiesPanel.recordRefund')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Document Modal ───────────────────────────────────────────────────────
function AddDocumentModal({ propertyId, leases, onClose, onCreated }: { propertyId: string; leases: Lease[]; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    label: '',
    document_type: 'OTHER' as 'TITLE_DEED' | 'TENANCY_AGREEMENT' | 'INSURANCE_CERTIFICATE' | 'INSPECTION_REPORT' | 'PERMIT' | 'INVOICE' | 'OTHER',
    lease_id: '',
    notes: '',
  })
  const [uploadedKey, setUploadedKey] = useState<string | null>(null)
  const [uploadedName, setUploadedName] = useState<string | null>(null)
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.createDocument(propertyId, {
      label: form.label,
      document_type: form.document_type,
      minio_object_key: uploadedKey!,
      file_name: uploadedName!,
      lease_id: form.lease_id || undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  const DOC_TYPES = ['TITLE_DEED','TENANCY_AGREEMENT','INSURANCE_CERTIFICATE','INSPECTION_REPORT','PERMIT','INVOICE','OTHER'] as const

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-slate-100 mb-4">{t('propertiesPanel.attachDocument')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.docLabel')}</label>
            <input value={form.label} onChange={set('label')} className={cls} placeholder="e.g. Title Deed 2024" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.documentType')}</label>
            <select value={form.document_type} onChange={set('document_type')} className={cls}>
              {DOC_TYPES.map(dt => <option key={dt} value={dt}>{dt.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          {leases.length > 0 && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.linkToLease')}</label>
              <select value={form.lease_id} onChange={set('lease_id')} className={cls}>
                <option value="">— not linked —</option>
                {leases.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.is_company ? l.company_name : `${l.first_name} ${l.last_name ?? ''}`} — {fmtDate(l.start_date)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs text-slate-400 mb-1">File *</label>
            <FileUpload
              bucket="jag-documents"
              module="properties"
              entityId={propertyId}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
              label={uploadedKey ? `✓ ${uploadedName ?? 'File uploaded'}` : 'Upload File'}
              onUploaded={(key, _bucket, name) => { setUploadedKey(key); setUploadedName(name) }}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{(error as Error).message}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300">{t('common.cancel')}</button>
          <button
            onClick={() => mutate()}
            disabled={isPending || !form.label || !uploadedKey}
            className="flex-1 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white"
          >
            {isPending ? t('common.saving') : t('propertiesPanel.attachDocument')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Edit Property Modal ──────────────────────────────────────────────────────
function EditPropertyModal({ property, onClose, onSaved }: { property: Property; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    name: property.name,
    address_line1: property.address_line1 ?? '',
    address_line2: property.address_line2 ?? '',
    city: property.city ?? '',
    country: property.country ?? 'Trinidad and Tobago',
    current_valuation: property.current_valuation != null ? String(property.current_valuation) : '',
    valuation_date: property.valuation_date ? property.valuation_date.slice(0, 10) : '',
    notes: property.notes ?? '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.updateProperty(property.id, {
      name: form.name || undefined,
      address_line1: form.address_line1 || undefined,
      address_line2: form.address_line2 || undefined,
      city: form.city || undefined,
      country: form.country || undefined,
      current_valuation: form.current_valuation ? Number(form.current_valuation) : undefined,
      valuation_date: form.valuation_date || undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: () => { onSaved(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('propertiesPanel.editProperty')}</h2>
        <p className="text-xs text-slate-500 mb-4">{property.property_code}</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.propertyName')} *</label>
            <input value={form.name} onChange={set('name')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.addressLine1')}</label>
            <input value={form.address_line1} onChange={set('address_line1')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Address Line 2</label>
            <input value={form.address_line2} onChange={set('address_line2')} className={cls} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.city')}</label>
              <input value={form.city} onChange={set('city')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.country')}</label>
              <input value={form.country} onChange={set('country')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.currentValuation')}</label>
              <input type="number" step="0.01" min="0" value={form.current_valuation} onChange={set('current_valuation')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('propertiesPanel.valuationDate')}</label>
              <input type="date" value={form.valuation_date} onChange={set('valuation_date')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={3} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.name}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('propertiesPanel.saveChanges')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

type DetailTab = 'overview' | 'leases' | 'payments' | 'utilities' | 'invoices' | 'insurance' | 'tax' | 'inspections' | 'financials' | 'documents' | 'units'

function ValuationHistoryModal({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [date, setDate] = useState('')
  const [valuation, setValuation] = useState('')
  const [notes, setNotes] = useState('')

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['properties', id, 'valuation-history'],
    queryFn: () => propertiesApi.getValuationHistory(id),
  })

  const { mutate, isPending, error: addError } = useMutation({
    mutationFn: () => propertiesApi.addValuationHistory(id, {
      as_of_date: date,
      valuation_ttd: Number(valuation),
      notes: notes || undefined,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['properties', id, 'valuation-history'] })
      setDate(''); setValuation(''); setNotes('')
      setShowAdd(false)
    },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] overflow-y-auto py-6">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl mx-4 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Valuation History — {name}</h2>
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
                <label className="block text-xs text-slate-400 mb-1">Valuation (TTD)</label>
                <input type="number" step="0.01" value={valuation} onChange={e => setValuation(e.target.value)} className={cls} placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className={cls} placeholder="e.g. Professional appraisal 2025" />
            </div>
            {addError && <p className="text-red-400 text-xs">{addError instanceof Error ? addError.message : 'Failed.'}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={() => mutate()} disabled={isPending || !date || !valuation}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors">
                {isPending ? 'Saving...' : 'Save Entry'}
              </button>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-white text-xs transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {isLoading && <p className="text-slate-400 text-sm">Loading...</p>}
        {!isLoading && history.length === 0 && (
          <p className="text-slate-400 text-sm">No history yet. History records automatically each time you update the valuation.</p>
        )}
        {history.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-right px-3 py-2">Valuation (TTD)</th>
                  <th className="text-left px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {history.map((row: PropertyValuationHistory) => (
                  <tr key={row.id} className="hover:bg-slate-700/30">
                    <td className="px-3 py-2 text-slate-300">{row.as_of_date}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-100 font-medium">{fmtTTD(row.valuation_ttd)}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs">{row.notes ?? '—'}</td>
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

function PropertyDetail({ property, onDeleted }: { property: Property; onDeleted: () => void }) {
  const { t } = useTranslation()
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [showEditProperty, setShowEditProperty] = useState(false)
  const [showDeleteProperty, setShowDeleteProperty] = useState(false)
  const [showValuationHistory, setShowValuationHistory] = useState(false)
  const [showAddLease, setShowAddLease] = useState(false)
  const [showRecordPayment, setShowRecordPayment] = useState(false)
  const [receiptPaymentId, setReceiptPaymentId] = useState<string | null>(null)
  const [showAddMortgage, setShowAddMortgage] = useState(false)
  const [showAddUtility, setShowAddUtility] = useState(false)
  const [showAddInvoice, setShowAddInvoice] = useState(false)
  const [payingInvoice, setPayingInvoice] = useState<VendorInvoice | null>(null)
  const [showAddInsurance, setShowAddInsurance] = useState(false)
  const [showAddTax, setShowAddTax] = useState(false)
  const [payingTax, setPayingTax] = useState<PropertyTaxRecord | null>(null)
  const [showAddInspection, setShowAddInspection] = useState(false)
  const [refundingDeposit, setRefundingDeposit] = useState<Lease | null>(null)
  const [showAddDocument, setShowAddDocument] = useState(false)
  const [showAddUnit, setShowAddUnit] = useState(false)
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null)
  const [managingListingUnit, setManagingListingUnit] = useState<Unit | null>(null)
  const [showAddUtilityAccount, setShowAddUtilityAccount] = useState(false)
  const [editingUtilityAccount, setEditingUtilityAccount] = useState<UtilityAccount | null>(null)
  const [editingInspection, setEditingInspection] = useState<Inspection | null>(null)
  const [editingTax, setEditingTax] = useState<PropertyTaxRecord | null>(null)
  const [chargingLateFee, setChargingLateFee] = useState<RentPayment | null>(null)
  const [deletingLease, setDeletingLease] = useState<Lease | null>(null)
  const [sendingLeaseId, setSendingLeaseId] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: leases = [] } = useQuery({
    queryKey: ['properties', property.id, 'leases'],
    queryFn: () => propertiesApi.getLeases(property.id),
    enabled: detailTab === 'leases',
  })
  const { data: payments = [] } = useQuery({
    queryKey: ['properties', property.id, 'payments'],
    queryFn: () => propertiesApi.getRentPayments(property.id),
    enabled: detailTab === 'payments',
  })
  const { data: mortgages = [] } = useQuery({
    queryKey: ['properties', property.id, 'mortgages'],
    queryFn: () => propertiesApi.getMortgages(property.id),
    enabled: detailTab === 'overview',
  })
  const { data: utilities = [] } = useQuery({
    queryKey: ['properties', property.id, 'utilities'],
    queryFn: () => propertiesApi.getUtilities(property.id),
    enabled: detailTab === 'utilities',
  })
  const { data: invoices = [] } = useQuery({
    queryKey: ['properties', property.id, 'invoices'],
    queryFn: () => propertiesApi.getVendorInvoices(property.id),
    enabled: detailTab === 'invoices',
  })
  const { data: insurance = [] } = useQuery({
    queryKey: ['finance', 'insurance', 'policies', 'property', property.id],
    queryFn: () => financeApi.getPolicies({ insured_asset_ref: property.id }),
    enabled: detailTab === 'insurance',
  })
  const { data: taxRecords = [] } = useQuery({
    queryKey: ['properties', property.id, 'tax'],
    queryFn: () => propertiesApi.getTax(property.id),
    enabled: detailTab === 'tax',
  })
  const { data: inspections = [] } = useQuery({
    queryKey: ['properties', property.id, 'inspections'],
    queryFn: () => propertiesApi.getInspections(property.id),
    enabled: detailTab === 'inspections',
  })
  const { data: financials } = useQuery({
    queryKey: ['properties', property.id, 'financials'],
    queryFn: () => propertiesApi.getFinancialSummary(property.id),
    enabled: detailTab === 'financials',
  })
  const { data: documents = [] } = useQuery({
    queryKey: ['properties', property.id, 'documents'],
    queryFn: () => propertiesApi.getDocuments(property.id),
    enabled: detailTab === 'documents',
  })
  const { data: utilityAccounts = [] } = useQuery({
    queryKey: ['properties', property.id, 'utility-accounts'],
    queryFn: () => propertiesApi.getUtilityAccounts(property.id),
    enabled: detailTab === 'utilities',
  })
  const { data: units = [] } = useQuery({
    queryKey: ['properties', property.id, 'units'],
    queryFn: () => propertiesApi.getUnits(property.id),
    enabled: detailTab === 'units' || detailTab === 'leases',
  })

  const { mutate: approveInv } = useMutation({
    mutationFn: (id: string) => propertiesApi.approveInvoice(property.id, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'invoices'] }),
  })

  const refreshTab = (tab: DetailTab) =>
    void qc.invalidateQueries({ queryKey: ['properties', property.id, tab === 'payments' ? 'payments' : tab === 'overview' ? 'mortgages' : tab] })

  const DETAIL_TABS: { id: DetailTab; label: string }[] = [
    { id: 'overview',    label: t('propertiesPanel.detailTabs.overview') },
    { id: 'leases',      label: t('propertiesPanel.detailTabs.leases') },
    { id: 'payments',    label: t('propertiesPanel.detailTabs.payments') },
    { id: 'utilities',   label: t('propertiesPanel.detailTabs.utilities') },
    { id: 'invoices',    label: t('propertiesPanel.detailTabs.invoices') },
    { id: 'insurance',   label: t('propertiesPanel.detailTabs.insurance') },
    { id: 'tax',         label: t('propertiesPanel.detailTabs.tax') },
    { id: 'inspections', label: t('propertiesPanel.detailTabs.inspections') },
    { id: 'units',       label: t('propertiesPanel.detailTabs.units') },
    { id: 'financials',  label: t('propertiesPanel.detailTabs.financials') },
    { id: 'documents',   label: t('propertiesPanel.detailTabs.documents') },
  ]

  const activeLease = property.active_leases?.[0]

  return (
    <div className="flex-1 min-w-0 bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      {/* Property header */}
      <div className="p-4 border-b border-slate-700 bg-slate-800/80">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{property.name}</h2>
            <p className="text-sm text-slate-400 mt-0.5">{property.address_line1}, {property.city}</p>
            <div className="flex gap-2 mt-2 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">{property.property_type}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">{property.tenure_type}</span>
              {property.bedrooms != null && (
                <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">{property.bedrooms}BR / {property.bathrooms}BA</span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded ${occupancyBadge(property, t, true).className}`}>
                {occupancyBadge(property, t, true).label}
              </span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            {property.current_valuation && (
              <div className="text-right">
                <p className="text-xs text-slate-400">{t('propertiesPanel.valuation')}</p>
                <p className="text-sm font-semibold font-mono text-slate-100">{fmtTTD(property.current_valuation)}</p>
                {property.valuation_date && <p className="text-xs text-slate-500">{fmtDate(property.valuation_date)}</p>}
              </div>
            )}
            <button
              onClick={() => setShowValuationHistory(true)}
              className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white transition-colors whitespace-nowrap"
            >Valuation History</button>
            <button
              onClick={() => setShowEditProperty(true)}
              className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition-colors whitespace-nowrap"
            >{t('propertiesPanel.edit')}</button>
            <button
              onClick={() => setShowDeleteProperty(true)}
              className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-red-700 text-slate-400 hover:text-white transition-colors whitespace-nowrap"
              title="Delete property"
            >{t('propertiesPanel.delete')}</button>
          </div>
        </div>
        {activeLease && (
          <div className="mt-3 p-2.5 bg-slate-700/40 rounded text-xs text-slate-300">
            <span className="text-slate-400">{t('propertiesPanel.activeLeaseLbl')}</span>
            <span className="font-medium">{activeLease.is_company ? activeLease.company_name : `${activeLease.first_name} ${activeLease.last_name ?? ''}`}</span>
            <span className="text-slate-400 ml-2">{fmtTTD(activeLease.monthly_rent)}/mo</span>
            <span className="text-slate-400 ml-2">due day {activeLease.payment_due_day}</span>
          </div>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-0 border-b border-slate-700 overflow-x-auto">
        {DETAIL_TABS.map(tab => (
          <button key={tab.id} onClick={() => setDetailTab(tab.id)}
            className={`px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
              detailTab === tab.id ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {/* Overview */}
        {detailTab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <InfoField label={t('propertiesPanel.infoCode')} value={property.property_code} mono />
              <InfoField label={t('propertiesPanel.city')} value={property.city} />
              <InfoField label={t('common.type')} value={property.property_type} />
              <InfoField label={t('propertiesPanel.infoTenure')} value={property.tenure_type} />
            </div>
            <div className="flex justify-end">
              <button onClick={() => setShowAddMortgage(true)}
                className="text-xs px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg border border-slate-600 transition-colors">
                + {t('propertiesPanel.addMortgage')}
              </button>
            </div>
            {mortgages.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">{t('propertiesPanel.mortgagesLbl')}</h3>
                <div className="space-y-2">
                  {mortgages.map(m => (
                    <div key={m.id} className="p-3 bg-slate-700/40 rounded flex justify-between items-start text-sm">
                      <div>
                        <p className="text-slate-200 font-medium">{m.lender_name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{m.mortgage_type} · {m.interest_rate_percent}% · due {m.maturity_date ? fmtDate(m.maturity_date) : 'N/A'}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-slate-100">{fmtTTD(m.outstanding_balance)}</p>
                        <p className="text-xs text-slate-400">{fmtTTD(m.monthly_payment)}/mo</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Leases */}
        {detailTab === 'leases' && (
          <div>
            <div className="flex justify-end mb-3">
              <button onClick={() => setShowAddLease(true)}
                className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
                + Add Lease
              </button>
            </div>
            {leases.length === 0 ? <Empty /> : (
              <div className="space-y-3">
                {leases.map(l => (
                  <div key={l.id} className="p-3 bg-slate-700/30 rounded">
                    <div className="flex justify-between items-start mb-1">
                      <p className="text-sm font-medium text-slate-100">
                        {l.is_company ? l.company_name : `${l.first_name} ${l.last_name ?? ''}`}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded border ${l.status === 'ACTIVE' ? 'border-green-700 text-green-400' : 'border-slate-600 text-slate-500'}`}>{l.status}</span>
                        {l.signature_status && l.signature_status !== 'UNSIGNED' && (
                          <span className={`text-xs px-2 py-0.5 rounded border ${
                            l.signature_status === 'SIGNED' ? 'border-green-700 text-green-400'
                            : l.signature_status === 'DECLINED' || l.signature_status === 'EXPIRED' ? 'border-red-700 text-red-400'
                            : 'border-amber-700 text-amber-400'
                          }`}>
                            {l.signature_status === 'SIGNED' ? '✓ Signed'
                              : l.signature_status === 'PARTIALLY_SIGNED' ? 'Partially signed'
                              : l.signature_status === 'SENT' ? 'Sent for signing'
                              : l.signature_status}
                          </span>
                        )}
                        <button onClick={async () => {
                            setSendingLeaseId(l.id)
                            try {
                              const result = await propertiesApi.sendLeaseForSigning(property.id, l.id)
                              void qc.invalidateQueries({ queryKey: ['properties', property.id, 'leases'] })
                              if (result.landlordSigningUrl) window.open(result.landlordSigningUrl, '_blank')
                            } catch {
                              alert('Could not send the lease for signature.')
                            } finally {
                              setSendingLeaseId(null)
                            }
                          }}
                          disabled={sendingLeaseId === l.id}
                          className="text-xs px-2 py-0.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded border border-blue-600 transition-colors"
                          title="Send for e-signature">
                          {sendingLeaseId === l.id ? '…' : '✍ Send for Signature'}
                        </button>
                        <button onClick={() => void propertiesApi.downloadLeaseAgreement(property.id, l.id).catch(() => alert('Could not download the lease agreement.'))}
                          className="text-xs px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded border border-slate-600 transition-colors"
                          title="Download lease agreement">📄 {t('propertiesPanel.downloadAgreement')}</button>
                        <button onClick={() => setDeletingLease(l)}
                          className="text-slate-600 hover:text-red-400 transition-colors text-sm leading-none"
                          title="Delete lease">&#x1F5D1;</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-slate-400">
                      <span>Rent: <span className="text-slate-200 font-mono">{fmtTTD(l.monthly_rent)}/mo</span></span>
                      <span>Due: day {l.payment_due_day}</span>
                      <span>{fmtDate(l.start_date)} → {l.end_date ? fmtDate(l.end_date) : t('propertiesPanel.ongoing')}</span>
                    </div>
                    {(l.email || l.phone) && (
                      <p className="text-xs text-slate-500 mt-1">{l.email ?? ''} {l.phone ? `· ${l.phone}` : ''}</p>
                    )}
                    {l.security_deposit && Number(l.security_deposit) > 0 && (
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700">
                        <p className="text-xs text-slate-400">{t('propertiesPanel.depositLbl')} <span className="font-mono text-slate-200">{fmtTTD(l.security_deposit)}</span></p>
                        <button onClick={() => setRefundingDeposit(l)}
                          className="text-xs px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded border border-slate-600 transition-colors">
                          {t('propertiesPanel.refundDeposit')}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Rent Payments */}
        {detailTab === 'payments' && (
          <div>
            <div className="flex justify-end mb-3">
              <button onClick={() => setShowRecordPayment(true)}
                className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
                + Record Payment
              </button>
            </div>
            {payments.length === 0 ? <Empty /> : (
              <div className="overflow-x-auto rounded-lg border border-slate-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                      <th className="text-left px-3 py-2">{t('propertiesPanel.colDate')}</th>
                      <th className="text-left px-3 py-2">{t('propertiesPanel.colPeriod')}</th>
                      <th className="text-right px-3 py-2">{t('propertiesPanel.colDue')}</th>
                      <th className="text-right px-3 py-2">{t('propertiesPanel.paidBadge')}</th>
                      <th className="text-left px-3 py-2">{t('propertiesPanel.colMethod')}</th>
                      <th className="text-center px-3 py-2">{t('propertiesPanel.colStatus')}</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {payments.map(p => (
                      <tr key={p.id} className="hover:bg-slate-700/20">
                        <td className="px-3 py-2 text-xs text-slate-400">{fmtDate(p.payment_date)}</td>
                        <td className="px-3 py-2 text-xs text-slate-300">{MONTHS[p.period_month - 1]} {p.period_year}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-slate-300">{fmtTTD(p.amount_due)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-slate-100">{fmtTTD(p.amount_paid)}</td>
                        <td className="px-3 py-2 text-xs text-slate-400">
                          {p.payment_method.replace(/_/g,' ')}
                          {p.proof_image_url && <span className="ml-1 text-slate-500" title="Proof attached">📎</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {p.is_late
                            ? <span className="text-xs text-red-400">{t('propertiesPanel.lateStatus')}{Number(p.late_fee_charged) > 0 ? ` +${fmtTTD(p.late_fee_charged)}` : ''}</span>
                            : parseFloat(String(p.amount_paid)) < parseFloat(String(p.amount_due))
                              ? <span className="text-xs text-yellow-400">{t('propertiesPanel.partialStatus')}</span>
                              : <span className="text-xs text-emerald-400">{t('propertiesPanel.paidStatus')}</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => setReceiptPaymentId(p.id)}
                              className="text-xs text-green-400 hover:text-green-300 transition-colors">
                              {t('propertiesPanel.receiptBtn')}
                            </button>
                            {(parseFloat(String(p.amount_paid)) < parseFloat(String(p.amount_due)) || p.is_late) && (
                              <button onClick={() => setChargingLateFee(p)}
                                className="text-xs text-orange-400 hover:text-orange-300 transition-colors">
                                + fee
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Utilities */}
        {detailTab === 'utilities' && (
          <div className="space-y-5">
            {/* Utility Accounts (reference) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{t('propertiesPanel.serviceAccounts')}</h3>
                <button onClick={() => setShowAddUtilityAccount(true)}
                  className="text-xs px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded border border-slate-600 transition-colors">
                  + {t('propertiesPanel.addAccount')}
                </button>
              </div>
              {(utilityAccounts as UtilityAccount[]).length === 0 ? (
                <p className="text-slate-600 text-xs">{t('propertiesPanel.noUtilityAccounts')}</p>
              ) : (
                <div className="space-y-1">
                  {(utilityAccounts as UtilityAccount[]).map((a: UtilityAccount) => (
                    <div key={a.id} className="flex items-center justify-between px-3 py-2 bg-slate-700/30 rounded text-xs">
                      <div>
                        <span className="text-slate-300 font-medium">{a.provider}</span>
                        <span className="text-slate-500 ml-2">{a.utility_type}</span>
                        {a.account_number && <span className="text-slate-400 ml-2 font-mono">#{a.account_number}</span>}
                        {a.account_name && <span className="text-slate-500 ml-2">{a.account_name}</span>}
                      </div>
                      <div className="flex gap-2 items-center ml-3">
                        <button
                          onClick={() => setEditingUtilityAccount(a)}
                          className="text-xs text-slate-500 hover:text-blue-400 transition-colors"
                        >{t('propertiesPanel.edit')}</button>
                        <button
                          onClick={() => propertiesApi.deleteUtilityAccount(property.id, a.id).then(() =>
                            void qc.invalidateQueries({ queryKey: ['properties', property.id, 'utility-accounts'] })
                          )}
                          className="text-slate-600 hover:text-red-400 transition-colors">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bills */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{t('propertiesPanel.billsLbl')}</h3>
                <button onClick={() => setShowAddUtility(true)}
                  className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
                  + Record Bill
                </button>
              </div>
              {utilities.length === 0 ? <Empty /> : (
                <div className="overflow-x-auto rounded-lg border border-slate-700">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                        <th className="text-left px-3 py-2">{t('common.type')}</th>
                        <th className="text-left px-3 py-2">{t('propertiesPanel.colVendor')}</th>
                        <th className="text-left px-3 py-2">{t('propertiesPanel.billDate')}</th>
                        <th className="text-left px-3 py-2">{t('propertiesPanel.paidDate')}</th>
                        <th className="text-right px-3 py-2">{t('common.amount')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                      {utilities.map(u => (
                        <tr key={u.id} className="hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-xs text-slate-300">{u.utility_type}</td>
                          <td className="px-3 py-2 text-xs text-slate-400">{u.provider}</td>
                          <td className="px-3 py-2 text-xs text-slate-400">{fmtDate(u.bill_date)}</td>
                          <td className="px-3 py-2 text-xs">
                            {u.paid_date ? <span className="text-green-400">{fmtDate(u.paid_date)}</span> : <span className="text-red-400">{t('propertiesPanel.unpaidStatus')}</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-slate-100">{fmtTTD(u.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Vendor Invoices */}
        {detailTab === 'invoices' && (
          <div>
            <div className="flex justify-end mb-3">
              <button onClick={() => setShowAddInvoice(true)}
                className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
                + Add Invoice
              </button>
            </div>
            {invoices.length === 0 ? <Empty /> : (
              <div className="overflow-x-auto rounded-lg border border-slate-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                      <th className="text-left px-3 py-2">{t('propertiesPanel.colVendor')}</th>
                      <th className="text-left px-3 py-2">{t('propertiesPanel.colRef')}</th>
                      <th className="text-left px-3 py-2">{t('propertiesPanel.colDate')}</th>
                      <th className="text-right px-3 py-2">{t('common.amount')}</th>
                      <th className="text-center px-3 py-2">{t('propertiesPanel.colStatus')}</th>
                      <th className="text-right px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {invoices.map((inv: VendorInvoice) => (
                      <tr key={inv.id} className="hover:bg-slate-700/20">
                        <td className="px-3 py-2 text-xs text-slate-100">{inv.vendor_name}</td>
                        <td className="px-3 py-2 text-xs text-slate-400 font-mono">{inv.invoice_ref ?? '—'}</td>
                        <td className="px-3 py-2 text-xs text-slate-400">{fmtDate(inv.invoice_date)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-slate-100">{fmtTTD(inv.amount)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${INVOICE_STATUS_STYLES[inv.status]}`}>{inv.status}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {inv.status === 'RECEIVED' && (
                            <button onClick={() => approveInv(inv.id)}
                              className="text-xs text-blue-400 hover:text-blue-300 transition-colors mr-2">{t('propertiesPanel.approve')}</button>
                          )}
                          {inv.status === 'APPROVED' && (
                            <button onClick={() => setPayingInvoice(inv)}
                              className="text-xs text-green-400 hover:text-green-300 transition-colors">{t('propertiesPanel.payBtn')}</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

        {/* Insurance Tab */}
        {detailTab === 'insurance' && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <button onClick={() => setShowAddInsurance(true)}
                className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
                + Add Policy
              </button>
            </div>
            {insurance.length === 0 && <Empty />}
            {(insurance as InsurancePolicy[]).map(p => {
              const days = Math.ceil((new Date(p.expiry_date).getTime() - Date.now()) / 86_400_000)
              const expiring = days < 60
              return (
                <div key={p.id} className="bg-slate-700/40 rounded-lg p-3 border border-slate-600">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-100">{p.insurer_name}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-600 text-slate-300">
                          {t(`insurance.policyTypes.${p.policy_type}`)}
                          {p.sub_type && ` — ${p.sub_type}`}
                        </span>
                        {!p.is_active && <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-500">Inactive</span>}
                        {p.is_active && expiring && <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/60 text-red-300 border border-red-700">{t('propertiesPanel.expiringSoon')}</span>}
                      </div>
                      {p.policy_number && <p className="text-xs text-slate-400 mt-0.5 font-mono">{p.policy_number}</p>}
                      <div className="grid grid-cols-2 gap-x-4 mt-1.5 text-xs text-slate-400">
                        <span>{t('propertiesPanel.insurancePremium')} <span className="text-slate-200">{fmtTTD(p.premium_amount_ttd)} / {p.premium_frequency.toLowerCase()}</span></span>
                        <span>{t('propertiesPanel.insuranceCoverage')} <span className="text-slate-200">{fmtTTD(p.coverage_amount_ttd)}</span></span>
                        <span>{t('propertiesPanel.insuranceFrom')} <span className="text-slate-200">{fmtDate(p.start_date)}</span></span>
                        <span className={expiring && p.is_active ? 'text-red-400' : ''}>{t('propertiesPanel.insuranceExpires')} <span className="text-slate-200">{fmtDate(p.expiry_date)}</span></span>
                      </div>
                      {p.notes && <p className="text-xs text-slate-500 mt-1">{p.notes}</p>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Property Tax Tab */}
        {detailTab === 'tax' && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <button onClick={() => setShowAddTax(true)}
                className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
                + Add Year
              </button>
            </div>
            {taxRecords.length === 0 && <Empty />}
            <div className="overflow-x-auto">
              {taxRecords.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-700">
                      <th className="px-3 py-2 text-left font-medium">{t('propertiesPanel.colYear')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('propertiesPanel.colAssessment')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('propertiesPanel.colTaxDue')}</th>
                      <th className="px-3 py-2 text-center font-medium">{t('propertiesPanel.dueDate')}</th>
                      <th className="px-3 py-2 text-center font-medium">{t('propertiesPanel.paidDate')}</th>
                      <th className="px-3 py-2 text-center font-medium">{t('propertiesPanel.colStatus')}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {taxRecords.map((r: PropertyTaxRecord) => (
                      <tr key={r.id} className="border-b border-slate-700/40 hover:bg-slate-700/20">
                        <td className="px-3 py-2 font-semibold text-slate-200">{r.tax_year}</td>
                        <td className="px-3 py-2 text-right text-slate-400">{r.assessment_value ? fmtTTD(r.assessment_value) : '—'}</td>
                        <td className="px-3 py-2 text-right text-slate-100 font-medium">{fmtTTD(r.tax_amount)}</td>
                        <td className="px-3 py-2 text-center text-slate-400">{r.due_date ? fmtDate(r.due_date) : '—'}</td>
                        <td className="px-3 py-2 text-center text-slate-400">{r.paid_date ? fmtDate(r.paid_date) : '—'}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${r.paid_date ? 'bg-green-900/50 text-green-300 border-green-700' : 'bg-yellow-900/50 text-yellow-300 border-yellow-700'}`}>
                            {r.paid_date ? t('propertiesPanel.paidStatus').toUpperCase() : t('propertiesPanel.unpaidStatus').toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => setEditingTax(r)}
                              className="text-xs text-slate-500 hover:text-blue-400 transition-colors">{t('propertiesPanel.edit')}</button>
                            {!r.paid_date && (
                              <button onClick={() => setPayingTax(r)}
                                className="text-xs text-green-400 hover:text-green-300 transition-colors">{t('propertiesPanel.payBtn')}</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Inspections Tab */}
        {detailTab === 'inspections' && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <button onClick={() => setShowAddInspection(true)}
                className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
                + Record Inspection
              </button>
            </div>
            {inspections.length === 0 && <Empty />}
            {inspections.map((insp: Inspection) => {
              const RATING_STYLES: Record<string, string> = {
                EXCELLENT: 'text-green-400', GOOD: 'text-blue-400',
                FAIR: 'text-yellow-400', POOR: 'text-red-400',
              }
              return (
                <div key={insp.id} className="bg-slate-700/40 rounded-lg p-3 border border-slate-600">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-100">{insp.inspection_type.replace(/_/g, ' ')}</span>
                        <span className="text-xs text-slate-400">{fmtDate(insp.inspection_date)}</span>
                        {insp.condition_rating && (
                          <span className={`text-xs font-medium ${RATING_STYLES[insp.condition_rating] ?? ''}`}>
                            {insp.condition_rating}
                          </span>
                        )}
                      </div>
                      {insp.inspector_name && <p className="text-xs text-slate-400 mt-0.5">{t('propertiesPanel.inspectorLbl')} {insp.inspector_name}</p>}
                      {insp.next_due_date && <p className="text-xs text-slate-400 mt-0.5">{t('propertiesPanel.nextDueLbl')} {fmtDate(insp.next_due_date)}</p>}
                      {insp.notes && <p className="text-xs text-slate-300 mt-1.5 whitespace-pre-line">{insp.notes}</p>}
                    </div>
                    <button
                      onClick={() => setEditingInspection(insp)}
                      className="text-xs text-slate-500 hover:text-blue-400 transition-colors shrink-0"
                    >{t('propertiesPanel.edit')}</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Units Tab */}
        {detailTab === 'units' && (
          <div>
            <div className="flex justify-end mb-3">
              <button onClick={() => setShowAddUnit(true)}
                className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
                + Add Unit
              </button>
            </div>
            {(units as Unit[]).length === 0 ? (
              <p className="text-slate-500 text-sm">{t('propertiesPanel.noUnits')}</p>
            ) : (
              <div className="space-y-2">
                {(units as Unit[]).map((u: Unit) => (
                  <div key={u.id} className={`p-3 rounded-lg border ${u.is_rented ? 'border-green-800 bg-green-900/10' : 'border-slate-700 bg-slate-700/20'}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-100">{t('propertiesPanel.unitLbl')} {u.unit_number}</p>
                          {u.floor != null && <span className="text-xs text-slate-500">Floor {u.floor}</span>}
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${u.is_rented ? 'border-green-700 text-green-400' : 'border-slate-600 text-slate-500'}`}>
                            {u.is_rented ? t('propertiesPanel.rented') : t('propertiesPanel.vacant')}
                          </span>
                          {u.listing_status === 'LISTED' && (
                            <span className="text-xs px-1.5 py-0.5 rounded border border-emerald-700 text-emerald-400">Listed</span>
                          )}
                        </div>
                        <div className="flex gap-3 text-xs text-slate-400 mt-1">
                          {u.bedrooms != null && <span>{u.bedrooms}BR</span>}
                          {u.bathrooms != null && <span>{u.bathrooms}BA</span>}
                          {u.floor_area_sqft && <span>{u.floor_area_sqft} ft²</span>}
                        </div>
                        {u.lease_id && (
                          <p className="text-xs text-slate-300 mt-1">
                            {u.is_company ? u.company_name : `${u.tenant_first_name ?? ''} ${u.tenant_last_name ?? ''}`.trim()}
                            {u.monthly_rent && <span className="text-slate-400 ml-2 font-mono">{fmtTTD(u.monthly_rent)}/mo</span>}
                            {u.tenant_phone && <span className="text-slate-500 ml-2">{u.tenant_phone}</span>}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1.5 ml-3 shrink-0 flex-wrap justify-end">
                        <button
                          onClick={() => setEditingUnit(u)}
                          className="text-xs px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-400 rounded border border-slate-600 transition-colors"
                        >{t('propertiesPanel.edit')}</button>
                        <button
                          onClick={() => propertiesApi.patchUnit(property.id, u.id, { is_rented: !u.is_rented }).then(() =>
                            void qc.invalidateQueries({ queryKey: ['properties', property.id, 'units'] })
                          )}
                          className="text-xs px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-400 rounded border border-slate-600 transition-colors"
                        >
                          {u.is_rented ? t('propertiesPanel.markVacant') : t('propertiesPanel.markRented')}
                        </button>
                        <button
                          onClick={() => setManagingListingUnit(u)}
                          className="text-xs px-2 py-0.5 bg-emerald-800 hover:bg-emerald-700 text-emerald-300 rounded border border-emerald-700 transition-colors"
                        >
                          🏷 Listing
                        </button>
                      </div>
                    </div>
                    {u.notes && <p className="text-xs text-slate-500 mt-1">{u.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Financial Summary Tab */}
        {detailTab === 'financials' && (
          <div>
            {!financials ? (
              <p className="text-slate-400 text-sm">Loading…</p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-900/20 border border-green-800 rounded-lg p-3">
                    <p className="text-xs text-green-400 mb-1">{t('propertiesPanel.finRentCollected')}</p>
                    <p className="text-lg font-semibold font-mono text-green-300">{fmtTTD(String(financials.rent_collected))}</p>
                  </div>
                  <div className="bg-red-900/20 border border-red-800 rounded-lg p-3">
                    <p className="text-xs text-red-400 mb-1">{t('propertiesPanel.finTotalExpenses')}</p>
                    <p className="text-lg font-semibold font-mono text-red-300">{fmtTTD(String(financials.total_expenses))}</p>
                  </div>
                  <div className={`col-span-2 border rounded-lg p-3 ${financials.net_income >= 0 ? 'bg-blue-900/20 border-blue-800' : 'bg-orange-900/20 border-orange-800'}`}>
                    <p className={`text-xs mb-1 ${financials.net_income >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>{t('propertiesPanel.finNetIncome')}</p>
                    <p className={`text-xl font-bold font-mono ${financials.net_income >= 0 ? 'text-blue-200' : 'text-orange-300'}`}>{fmtTTD(String(financials.net_income))}</p>
                  </div>
                </div>
                <div className="border border-slate-700 rounded-lg divide-y divide-slate-700">
                  {[
                    { label: t('propertiesPanel.finMaintenance'), val: financials.maintenance_cost },
                    { label: t('propertiesPanel.finUtilities'), val: financials.utility_cost },
                    { label: t('propertiesPanel.finVendor'), val: financials.vendor_invoice_cost },
                    { label: t('propertiesPanel.finMortgage'), val: financials.mortgage_cost },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between px-3 py-2 text-sm">
                      <span className="text-slate-400">{row.label}</span>
                      <span className="font-mono text-slate-200">{fmtTTD(String(row.val))}</span>
                    </div>
                  ))}
                </div>
                {(financials.gross_yield_percent !== null || financials.net_yield_percent !== null) && (
                  <div className="flex gap-4">
                    {financials.gross_yield_percent !== null && (
                      <div className="flex-1 border border-slate-700 rounded-lg p-3 text-center">
                        <p className="text-xs text-slate-400">{t('propertiesPanel.finGrossYield')}</p>
                        <p className="text-base font-semibold text-slate-100 mt-0.5">{financials.gross_yield_percent.toFixed(2)}%</p>
                      </div>
                    )}
                    {financials.net_yield_percent !== null && (
                      <div className="flex-1 border border-slate-700 rounded-lg p-3 text-center">
                        <p className="text-xs text-slate-400">{t('propertiesPanel.finNetYield')}</p>
                        <p className="text-base font-semibold text-slate-100 mt-0.5">{financials.net_yield_percent.toFixed(2)}%</p>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-xs text-slate-600">{t('propertiesPanel.finNote')}</p>
              </div>
            )}
          </div>
        )}

        {/* Documents Tab */}
        {detailTab === 'documents' && (
          <div>
            <div className="flex justify-end mb-3">
              <button onClick={() => setShowAddDocument(true)}
                className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
                + Attach Document
              </button>
            </div>
            {(documents as PropertyDocument[]).length === 0 ? <Empty /> : (
              <div className="space-y-2">
                {(documents as PropertyDocument[]).map((d: PropertyDocument) => (
                  <div key={d.id} className="flex items-start justify-between p-3 bg-slate-700/30 rounded gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-100 font-medium">{d.label}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{d.document_type.replace(/_/g,' ')} · {d.file_name}</p>
                      {d.notes && <p className="text-xs text-slate-500 mt-0.5">{d.notes}</p>}
                      <p className="text-xs text-slate-600 mt-0.5">{fmtDate(d.created_at)}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <a
                        href={`/api/v1/files/download?bucket=jag-documents&key=${encodeURIComponent(d.minio_object_key)}`}
                        target="_blank" rel="noreferrer"
                        className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded border border-slate-600 transition-colors"
                      >
                        Download
                      </a>
                      <button
                        onClick={() => {
                          if (confirm('Delete this document?')) {
                            propertiesApi.deleteDocument(property.id, d.id).then(() =>
                              void qc.invalidateQueries({ queryKey: ['properties', property.id, 'documents'] })
                            )
                          }
                        }}
                        className="text-xs px-2 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded border border-red-800 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      {/* Modals */}
      {showDeleteProperty && (
        <ConfirmDeleteModal
          label={property.name}
          onConfirm={() => propertiesApi.deleteProperty(property.id).then(() => {
            void qc.invalidateQueries({ queryKey: ['properties'] })
            onDeleted()
          })}
          onClose={() => setShowDeleteProperty(false)}
        />
      )}
      {deletingLease && (
        <ConfirmDeleteModal
          label={`${deletingLease.is_company ? (deletingLease.company_name ?? 'Lease') : `${deletingLease.first_name} ${deletingLease.last_name ?? ''}`} lease`}
          onConfirm={() => propertiesApi.deleteLease(property.id, deletingLease.id).then(() => {
            void qc.invalidateQueries({ queryKey: ['properties', property.id, 'leases'] })
            void qc.invalidateQueries({ queryKey: ['properties'] })
          })}
          onClose={() => setDeletingLease(null)}
        />
      )}
      {showEditProperty && <EditPropertyModal property={property} onClose={() => setShowEditProperty(false)}
        onSaved={() => void qc.invalidateQueries({ queryKey: ['properties'] })} />}
      {showValuationHistory && <ValuationHistoryModal id={property.id} name={property.name} onClose={() => setShowValuationHistory(false)} />}
      {showAddLease     && <AddLeaseModal propertyId={property.id} onClose={() => setShowAddLease(false)}
        onCreated={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'leases'] })} />}
      {showRecordPayment && <RecordPaymentModal propertyId={property.id} onClose={() => setShowRecordPayment(false)}
        onRecorded={(paymentId) => {
          void qc.invalidateQueries({ queryKey: ['properties', property.id, 'payments'] })
          setShowRecordPayment(false)
          setReceiptPaymentId(paymentId)
        }} />}
      {receiptPaymentId && <ReceiptModal propertyId={property.id} paymentId={receiptPaymentId} onClose={() => setReceiptPaymentId(null)} />}
      {showAddMortgage  && <AddMortgageModal propertyId={property.id} onClose={() => setShowAddMortgage(false)}
        onCreated={() => { void qc.invalidateQueries({ queryKey: ['properties', property.id, 'mortgages'] }); refreshTab('overview') }} />}
      {showAddUtility   && <AddUtilityModal propertyId={property.id} onClose={() => setShowAddUtility(false)}
        onCreated={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'utilities'] })} />}
      {showAddInvoice   && <AddInvoiceModal propertyId={property.id} onClose={() => setShowAddInvoice(false)}
        onCreated={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'invoices'] })} />}
      {payingInvoice    && <PayInvoiceModal propertyId={property.id} inv={payingInvoice} onClose={() => setPayingInvoice(null)}
        onUpdated={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'invoices'] })} />}
      {showAddInsurance && <AddPropertyInsuranceModal propertyId={property.id} onClose={() => setShowAddInsurance(false)}
        onCreated={() => void qc.invalidateQueries({ queryKey: ['finance', 'insurance', 'policies', 'property', property.id] })} />}
      {showAddTax       && <AddTaxModal propertyId={property.id} onClose={() => setShowAddTax(false)}
        onCreated={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'tax'] })} />}
      {payingTax        && <PayTaxModal propertyId={property.id} record={payingTax} onClose={() => setPayingTax(null)}
        onUpdated={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'tax'] })} />}
      {showAddInspection && <AddInspectionModal propertyId={property.id} onClose={() => setShowAddInspection(false)}
        onCreated={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'inspections'] })} />}
      {refundingDeposit && <RefundDepositModal propertyId={property.id} lease={refundingDeposit} onClose={() => setRefundingDeposit(null)}
        onSaved={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'leases'] })} />}
      {showAddDocument  && <AddDocumentModal propertyId={property.id} leases={leases} onClose={() => setShowAddDocument(false)}
        onCreated={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'documents'] })} />}
      {managingListingUnit && (
        <ManageListingModal
          unit={managingListingUnit}
          propertyId={property.id}
          onClose={() => setManagingListingUnit(null)}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ['properties', property.id, 'units'] })
            setManagingListingUnit(null)
          }}
        />
      )}
      {showAddUnit      && <AddUnitModal propertyId={property.id} onClose={() => setShowAddUnit(false)}
        onCreated={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'units'] })} />}
      {showAddUtilityAccount && <AddUtilityAccountModal propertyId={property.id} onClose={() => setShowAddUtilityAccount(false)}
        onCreated={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'utility-accounts'] })} />}
      {editingUnit && <EditUnitModal propertyId={property.id} unit={editingUnit} onClose={() => setEditingUnit(null)}
        onSaved={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'units'] })} />}
      {editingUtilityAccount && <EditUtilityAccountModal propertyId={property.id} account={editingUtilityAccount} onClose={() => setEditingUtilityAccount(null)}
        onSaved={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'utility-accounts'] })} />}
      {editingInspection && <EditInspectionModal propertyId={property.id} inspection={editingInspection} onClose={() => setEditingInspection(null)}
        onSaved={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'inspections'] })} />}
      {editingTax && <EditTaxModal propertyId={property.id} record={editingTax} onClose={() => setEditingTax(null)}
        onSaved={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'tax'] })} />}
      {chargingLateFee && (
        <ChargeLateFeeModal
          propertyId={property.id}
          payment={chargingLateFee}
          lease={leases.find(l => l.id === chargingLateFee.lease_id) ?? null}
          onClose={() => setChargingLateFee(null)}
          onCharged={() => void qc.invalidateQueries({ queryKey: ['properties', property.id, 'payments'] })} />)}
    </div>
  )
}

export default function PropertiesPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const { data: properties = [], isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: () => propertiesApi.getProperties(),
  })

  const selected = properties.find(p => p.id === selectedId) ?? null

  return (
    <div className="flex gap-4 min-h-0">
      {/* Property list — full width on mobile when no property selected, w-64 sidebar on md+ */}
      <div className={`${selected ? 'hidden md:flex' : 'flex'} w-full md:w-64 shrink-0 flex-col gap-2`}>
        <button
          onClick={() => setShowAdd(true)}
          className="w-full py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          + {t('propertiesPanel.addProperty')}
        </button>
        {isLoading && <p className="text-xs text-slate-400 text-center py-4">{t('common.loading')}</p>}
        {properties.map(p => (
          <button
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            className={`text-left px-3 py-2.5 rounded-lg border transition-colors text-sm ${
              selectedId === p.id
                ? 'border-blue-500 bg-blue-900/20 text-white'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500'
            }`}
          >
            <p className="font-medium truncate">{p.name}</p>
            <p className="text-xs text-slate-500 truncate mt-0.5">{p.property_code} · {p.property_type}</p>
            <span className={`text-xs ${occupancyBadge(p, t).className}`}>
              {occupancyBadge(p, t).label}
            </span>
          </button>
        ))}
        {!isLoading && properties.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-6">{t('propertiesPanel.noProperties')}</p>
        )}
      </div>

      {/* Detail panel — full width on mobile, flex-1 on md+ */}
      <div className={`${!selected ? 'hidden md:block' : 'block'} flex-1 min-w-0`}>
        {selected && (
          <button
            className="md:hidden mb-3 flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            onClick={() => setSelectedId(null)}
          >
            ← {t('common.back')}
          </button>
        )}
        {selected
          ? <PropertyDetail property={selected} onDeleted={() => {
              setSelectedId(null)
              void qc.invalidateQueries({ queryKey: ['properties'] })
            }} />
          : <div className="h-full flex items-center justify-center text-slate-500 text-sm">
              {t('propertiesPanel.selectProperty')}
            </div>
        }
      </div>

      {showAdd && (
        <AddPropertyModal
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['properties'] })
            setShowAdd(false)
          }}
        />
      )}
    </div>
  )
}

// ─── Manage Listing Modal ─────────────────────────────────────────────────────
function ManageListingModal({ unit, propertyId, onClose, onChanged }: {
  unit: Unit; propertyId: string; onClose: () => void; onChanged: () => void
}) {
  const qc = useQueryClient()
  const [desc, setDesc]   = useState(unit.listing_description ?? '')
  const [wasa, setWasa]   = useState(unit.wasa_included ?? false)
  const [elec, setElec]   = useState(unit.electricity_included ?? false)
  const [inet, setInet]   = useState(unit.internet_included ?? false)
  const [rent, setRent]   = useState(unit.rent_amount ? parseFloat(String(unit.rent_amount)).toFixed(2) : '')
  const [uploading, setUploading] = useState(false)
  const [savingInfo, setSavingInfo] = useState(false)
  const [msg, setMsg]     = useState<string | null>(null)

  const bookingBase = import.meta.env['VITE_BOOKING_BASE_URL'] as string ?? 'https://jagcorporate.com/book'
  const bookingUrl = unit.booking_slug ? `${bookingBase}/${unit.booking_slug}` : null
  const bookingLinkRef = useRef<HTMLInputElement>(null)

  async function copyBookingLink() {
    if (!bookingUrl) return
    try {
      await navigator.clipboard.writeText(bookingUrl)
      setMsg('Link copied!')
    } catch {
      // Clipboard API unavailable/blocked in this context — fall back to
      // select + execCommand, which works without any special permission.
      const el = bookingLinkRef.current
      if (el) {
        el.focus()
        el.select()
        try {
          document.execCommand('copy')
          setMsg('Link copied!')
        } catch {
          setMsg('Could not copy automatically — the link is selected, press Ctrl+C.')
        }
      } else {
        setMsg('Could not copy the link. Please copy it manually.')
      }
    }
  }

  const { data: photos = [], refetch: refetchPhotos } = useQuery({
    queryKey: ['unit-photos', unit.id],
    queryFn: () => propertiesApi.getUnitPhotos(unit.id),
  })

  const { mutate: doList, isPending: listing } = useMutation({
    mutationFn: () => propertiesApi.listUnit(unit.id),
    onSuccess: () => { setMsg('Unit listed — WA broadcast sent to past enquirers.'); onChanged() },
    onError: (e: Error) => setMsg('Error: ' + e.message),
  })
  const { mutate: doUnlist, isPending: unlisting } = useMutation({
    mutationFn: () => propertiesApi.unlistUnit(unit.id),
    onSuccess: () => { setMsg('Unit unlisted.'); onChanged() },
    onError: (e: Error) => setMsg('Error: ' + e.message),
  })
  const { mutate: doSuggest, isPending: suggesting } = useMutation({
    mutationFn: () => propertiesApi.suggestUnitPrice(unit.id),
    onSuccess: (r) => setMsg('AI suggestion: TTD $' + r.recommended + '/mo (range $' + r.min + String.fromCharCode(8211) + '$' + r.max + ')'),
    onError: (e: Error) => setMsg('Suggest error: ' + e.message),
  })
  const { mutate: deletePhoto } = useMutation({
    mutationFn: (photoId: string) => propertiesApi.deleteUnitPhoto(unit.id, photoId),
    onSuccess: () => void refetchPhotos(),
  })
  const { mutate: reorderPhoto } = useMutation({
    mutationFn: (args: { photoId: string; display_order: number }) =>
      propertiesApi.updateUnitPhoto(unit.id, args.photoId, { display_order: args.display_order }),
    onSuccess: () => void refetchPhotos(),
  })
  const { mutate: updatePhotoCaption } = useMutation({
    mutationFn: (args: { photoId: string; caption: string }) =>
      propertiesApi.updateUnitPhoto(unit.id, args.photoId, { caption: args.caption || null }),
    onSuccess: () => void refetchPhotos(),
  })

  function movePhoto(idx: number, dir: -1 | 1) {
    const list = photos as UnitPhoto[]
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= list.length) return
    const a = list[idx]
    const b = list[swapIdx]
    reorderPhoto({ photoId: a.id, display_order: swapIdx })
    reorderPhoto({ photoId: b.id, display_order: idx })
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setMsg(null)
    try {
      const { upload_url, object_key } = await propertiesApi.getPhotoUploadUrl(unit.id, file.name)
      await fetch(upload_url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      await propertiesApi.confirmUnitPhoto(unit.id, { object_key, display_order: (photos as UnitPhoto[]).length })
      await refetchPhotos()
      setMsg('Photo uploaded.')
    } catch (err) {
      setMsg('Upload failed: ' + (err as Error).message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function saveInfo() {
    setSavingInfo(true)
    setMsg(null)
    try {
      await propertiesApi.updateListingInfo(unit.id, {
        listing_description: desc || null,
        wasa_included: wasa,
        electricity_included: elec,
        internet_included: inet,
        ...(rent ? { rent_amount: parseFloat(rent) } : {}),
      })
      void qc.invalidateQueries({ queryKey: ['properties', propertyId, 'units'] })
      setMsg('Listing info saved.')
    } catch (err) {
      setMsg('Save failed: ' + (err as Error).message)
    } finally {
      setSavingInfo(false)
    }
  }

  const isBusy = listing || unlisting || suggesting || uploading || savingInfo
  const isListed = unit.listing_status === 'LISTED'
  const inputCls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'
  const utilityOpts: Array<[string, string, boolean, (v: boolean) => void]> = [
    ['wasa', 'WASA', wasa, setWasa],
    ['elec', 'Electricity', elec, setElec],
    ['inet', 'Internet', inet, setInet],
  ]

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-700">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Manage Listing &mdash; Unit {unit.unit_number}</h2>
            <span className={`text-xs px-2 py-0.5 rounded mt-1 inline-block ${isListed ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700' : 'bg-slate-700 text-slate-400 border border-slate-600'}`}>
              {unit.listing_status ?? 'VACANT'}
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-lg leading-none">&#x2715;</button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex gap-2 flex-wrap">
            {!isListed ? (
              <button onClick={() => doList()} disabled={isBusy}
                className="text-xs px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg disabled:opacity-50 transition-colors">
                {listing ? 'Listing...' : 'List Unit + Broadcast'}
              </button>
            ) : (
              <button onClick={() => doUnlist()} disabled={isBusy}
                className="text-xs px-3 py-1.5 bg-red-800 hover:bg-red-700 text-red-200 rounded-lg disabled:opacity-50 transition-colors">
                {unlisting ? 'Unlisting...' : 'Unlist'}
              </button>
            )}
            <button onClick={() => doSuggest()} disabled={isBusy}
              className="text-xs px-3 py-1.5 bg-blue-800 hover:bg-blue-700 text-blue-200 rounded-lg disabled:opacity-50 transition-colors">
              {suggesting ? 'Thinking...' : 'AI Suggest Price'}
            </button>
          </div>

          {bookingUrl && (
            <div>
              <p className="text-xs text-slate-400 mb-1">Public booking link</p>
              <div className="flex gap-2">
                <input readOnly value={bookingUrl} ref={bookingLinkRef}
                  onFocus={e => e.target.select()}
                  className="flex-1 bg-slate-700/50 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono" />
                <button onClick={() => void copyBookingLink()}
                  className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded border border-slate-600">
                  Copy
                </button>
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-slate-300 mb-2">Photos ({(photos as UnitPhoto[]).length})</p>
            {(photos as UnitPhoto[]).length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                {(photos as UnitPhoto[]).map((p: UnitPhoto, idx: number) => (
                  <div key={p.id} className="rounded overflow-hidden border border-slate-700 bg-slate-900">
                    <div className="relative group">
                      <img src={p.url} alt={p.caption ?? ('Photo ' + (idx + 1))} className="w-full aspect-square object-cover" />
                      <button onClick={() => deletePhoto(p.id)}
                        className="absolute top-1 right-1 bg-red-900/80 hover:bg-red-700 text-white text-xs w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity">
                        &#x2715;
                      </button>
                      <div className="absolute bottom-1 left-1 right-1 flex justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => movePhoto(idx, -1)} disabled={idx === 0}
                          className="bg-black/60 hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs w-5 h-5 flex items-center justify-center rounded">
                          &#x2039;
                        </button>
                        <button onClick={() => movePhoto(idx, 1)} disabled={idx === (photos as UnitPhoto[]).length - 1}
                          className="bg-black/60 hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs w-5 h-5 flex items-center justify-center rounded">
                          &#x203a;
                        </button>
                      </div>
                    </div>
                    <input
                      defaultValue={p.caption ?? ''}
                      placeholder="Add a label…"
                      onBlur={e => {
                        if (e.target.value !== (p.caption ?? '')) updatePhotoCaption({ photoId: p.id, caption: e.target.value })
                      }}
                      className="w-full bg-slate-800 text-xs text-slate-300 placeholder-slate-500 px-1.5 py-1 border-0 border-t border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                ))}
              </div>
            )}
            <label className={`text-xs px-3 py-1.5 rounded-lg border border-dashed border-slate-600 text-slate-400 hover:border-blue-500 hover:text-blue-400 cursor-pointer transition-colors inline-block ${isBusy ? 'opacity-50 pointer-events-none' : ''}`}>
              {uploading ? 'Uploading...' : '+ Add Photo'}
              <input type="file" accept="image/*" className="hidden" onChange={ev => void handleFileChange(ev)} disabled={isBusy} />
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Listing Description</label>
            <textarea value={desc} onChange={ev => setDesc(ev.target.value)} rows={4}
              className={inputCls} placeholder="Describe the unit, features, nearby amenities, etc." />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Asking Rent (TTD/month)</label>
            <input type="number" value={rent} onChange={ev => setRent(ev.target.value)}
              className={inputCls} placeholder="e.g. 4500" min="0" step="100" />
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-300 mb-2">Utilities Included</p>
            <div className="flex gap-5 flex-wrap">
              {utilityOpts.map(([key, label, val, setter]) => (
                <label key={key} className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={val} onChange={ev => setter(ev.target.checked)}
                    className="rounded border-slate-600 bg-slate-700 text-blue-500" />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {msg && (
            <p className={`text-xs px-3 py-2 rounded-lg border ${msg.startsWith('Error') || msg.startsWith('Upload failed') || msg.startsWith('Save failed') ? 'border-red-700 bg-red-900/20 text-red-300' : 'border-green-700 bg-green-900/20 text-green-300'}`}>
              {msg}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5 border-t border-slate-700 pt-4">
          <button onClick={onClose} className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg border border-slate-600">
            Close
          </button>
          <button onClick={() => void saveInfo()} disabled={isBusy}
            className="text-xs px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50">
            {savingInfo ? 'Saving...' : 'Save Info'}
          </button>
        </div>
      </div>
    </div>
  )
}
