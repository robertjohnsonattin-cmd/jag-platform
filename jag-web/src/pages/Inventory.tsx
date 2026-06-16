import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { imsApi } from '../api/ims'
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal'
import type {
  Item, ItemDetail,
  ItemCondition, MovementType,
  StockTakeSummary, StockTakeLine, StockTakeStatus,
  DepreciationSchedule, Vehicle,
} from '../types/ims'
import { VEHICLE_OWNER_OPTIONS } from '../types/ims'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtMoney = (v: number | null, currency = 'TTD') =>
  v == null ? '—' : `${currency} ${fmt.format(v)}`
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtDateTime = (d: string) =>
  new Date(d).toLocaleString('en-TT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const CONDITION_STYLES: Record<ItemCondition, string> = {
  NEW:         'bg-green-900/50  text-green-300  border border-green-700',
  GOOD:        'bg-blue-900/50   text-blue-300   border border-blue-700',
  FAIR:        'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
  POOR:        'bg-orange-900/50 text-orange-400 border border-orange-700',
  WRITTEN_OFF: 'bg-slate-700/60  text-slate-400  border border-slate-600',
}

const MOVEMENT_STYLES: Record<MovementType, string> = {
  RECEIVE:    'bg-green-900/50  text-green-300',
  RETURN:     'bg-teal-900/50   text-teal-300',
  TRANSFER:   'bg-blue-900/50   text-blue-300',
  ADJUSTMENT: 'bg-purple-900/50 text-purple-300',
  CONSUME:    'bg-yellow-900/50 text-yellow-300',
  DISPOSAL:   'bg-red-900/50    text-red-400',
  SALE:       'bg-orange-900/50 text-orange-300',
}

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-orange-500'

const VEHICLE_TYPES = ['CAR','SUV','TRUCK','VAN','EXCAVATOR','COMPACTOR','ROLLER','CRANE','GENERATOR','TRAILER','MOTORCYCLE','OTHER'] as const

// ── Add Item Modal ─────────────────────────────────────────────────────────────

function AddItemModal({
  locations,
  categories,
  onClose,
}: {
  locations: { id: string; name: string; code: string }[]
  categories: { id: string; name: string }[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const [form, setForm] = useState({
    name: '', location_id: '', sku: '', category_id: '',
    unit_of_measure: 'each', description: '',
    quantity_on_hand: '0', reorder_point: '',
    unit_value: '', serial_number: '',
    condition: 'GOOD', is_asset: false, vat_code: 'STANDARD',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))
  const setCheck = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.checked }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => imsApi.createItem({
      name: form.name,
      location_id: form.location_id,
      sku: form.sku || undefined,
      category_id: form.category_id || undefined,
      unit_of_measure: form.unit_of_measure,
      description: form.description || undefined,
      quantity_on_hand: Number(form.quantity_on_hand),
      reorder_point: form.reorder_point ? Number(form.reorder_point) : undefined,
      unit_value: form.unit_value ? Number(form.unit_value) : undefined,
      serial_number: form.serial_number || undefined,
      condition: form.condition,
      is_asset: form.is_asset,
      vat_code: form.vat_code,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ims-items'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('inv.addItemTitle')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.nameStar')}</label>
              <input value={form.name} onChange={set('name')} className={cls} placeholder="e.g. Cement 40kg bag" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.sku')}</label>
              <input value={form.sku} onChange={set('sku')} className={cls} placeholder="optional" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.locationStar')}</label>
              <select value={form.location_id} onChange={set('location_id')} className={cls}>
                <option value="">— select —</option>
                {locations.map(l => <option key={l.id} value={l.id}>[{l.code}] {l.name}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.category')}</label>
              <select value={form.category_id} onChange={set('category_id')} className={cls}>
                <option value="">— none —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-28">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.uom')}</label>
              <input value={form.unit_of_measure} onChange={set('unit_of_measure')} className={cls} placeholder="each" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.qtyOnHand')}</label>
              <input type="number" step="0.01" min="0" value={form.quantity_on_hand} onChange={set('quantity_on_hand')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.reorderPoint')}</label>
              <input type="number" step="0.01" min="0" value={form.reorder_point} onChange={set('reorder_point')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.unitValueTTD')}</label>
              <input type="number" step="0.01" min="0" value={form.unit_value} onChange={set('unit_value')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.serialNumber')}</label>
              <input value={form.serial_number} onChange={set('serial_number')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.condition')}</label>
              <select value={form.condition} onChange={set('condition')} className={cls}>
                {['NEW','GOOD','FAIR','POOR','WRITTEN_OFF'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.vatCode')}</label>
              <select value={form.vat_code} onChange={set('vat_code')} className={cls}>
                {['STANDARD','ZERO','EXEMPT'].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="is_asset" checked={form.is_asset} onChange={setCheck('is_asset')} className="rounded" />
            <label htmlFor="is_asset" className="text-sm text-slate-300">{t('inv.capitalAsset')}</label>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.description')}</label>
            <textarea value={form.description} onChange={set('description')} rows={2} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => mutate()}
            disabled={isPending || !form.name || !form.location_id}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {isPending ? t('inv.addingItem') : t('inv.addItemBtn')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Create Location Modal ─────────────────────────────────────────────────────

function CreateLocationModal({ onClose, onCreated }: { onClose: () => void; onCreated: (loc: { id: string; name: string; code: string }) => void }) {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [address, setAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!name.trim() || !code.trim()) { setError('Name and code are required.'); return }
    setSaving(true); setError('')
    try {
      const loc = await imsApi.createLocation({ name: name.trim(), code: code.trim().toUpperCase().replace(/\s+/g, '_'), address: address || undefined })
      qc.invalidateQueries({ queryKey: ['ims-locations'] })
      onCreated(loc)
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60]">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-5 shadow-2xl">
        <h3 className="text-base font-semibold mb-4 text-white">{t('inv.createLocationTitle')}</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.nameStar')}</label>
            <input value={name} onChange={e => setName(e.target.value)} className={cls} placeholder="e.g. JABCO Yard" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.codeStar')}</label>
            <input value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,''))} className={cls} placeholder="e.g. JABCO_YARD" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.address')}</label>
            <input value={address} onChange={e => setAddress(e.target.value)} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={submit} disabled={saving || !name || !code}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg">
            {saving ? t('inv.creating') : t('common.create')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Log Service Modal ─────────────────────────────────────────────────────────

function LogServiceModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const todayStr = new Date().toISOString().split('T')[0]
  const [serviceDate, setServiceDate] = useState(todayStr)
  const [mileage, setMileage] = useState(String(vehicle.current_mileage_km ?? ''))
  const [intervalDays, setIntervalDays] = useState(String(vehicle.service_interval_days))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setSaving(true); setError('')
    try {
      await imsApi.updateVehicle(vehicle.id, {
        last_service_date: serviceDate,
        service_interval_days: Number(intervalDays),
        current_mileage_km: mileage ? Number(mileage) : undefined,
      })
      qc.invalidateQueries({ queryKey: ['ims-vehicles'] })
      onClose()
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  const nextDate = (() => {
    const d = new Date(serviceDate + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + Number(intervalDays))
    return d.toISOString().split('T')[0]
  })()

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60]">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-5 shadow-2xl">
        <h3 className="text-base font-semibold mb-1 text-white">{t('inv.logServiceTitle')}</h3>
        <p className="text-xs text-slate-400 mb-4">{vehicle.registration_number} — {vehicle.make} {vehicle.model}</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.serviceDate')}</label>
            <input type="date" value={serviceDate} onChange={e => setServiceDate(e.target.value)} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.serviceIntervalDays')}</label>
            <input type="number" min="1" max="3650" value={intervalDays} onChange={e => setIntervalDays(e.target.value)} className={cls} />
            <p className="text-xs text-slate-500 mt-1">{t('inv.nextServiceDue')} <span className="text-orange-400 font-medium">{fmtDate(nextDate)}</span></p>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.currentMileageKm')}</label>
            <input type="number" min="0" value={mileage} onChange={e => setMileage(e.target.value)} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg">
            {saving ? t('common.saving') : t('inv.saveServiceLog')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Add Vehicle Modal ─────────────────────────────────────────────────────────

function AddVehicleModal({
  locations: initLocations,
  onClose,
}: {
  locations: { id: string; name: string; code: string }[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const [locations, setLocations] = useState(initLocations)
  const [showCreateLoc, setShowCreateLoc] = useState(false)

  const [form, setForm] = useState({
    name: '', owner_entity: 'JABCO', owner_entity_custom: '',
    location_id: '',
    registration_number: '', make: '', model: '', year: String(new Date().getFullYear()),
    colour: '', vehicle_type: 'CAR', fuel_type: 'PETROL',
    vin: '', engine_number: '',
    insurance_policy_number: '', insurance_provider: '', insurance_expiry: '',
    registration_expiry: '', purchase_date: '', purchase_price: '',
    current_mileage_km: '', unit_value: '', condition: 'GOOD',
    last_service_date: '', service_interval_days: '90',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const ownerEntityFinal = form.owner_entity === 'Other' ? form.owner_entity_custom : form.owner_entity

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => imsApi.createVehicle({
      name: form.name,
      owner_entity: ownerEntityFinal,
      location_id: form.location_id || undefined,
      registration_number: form.registration_number,
      make: form.make,
      model: form.model,
      year: Number(form.year),
      colour: form.colour || undefined,
      vehicle_type: form.vehicle_type,
      fuel_type: form.fuel_type,
      vin: form.vin || undefined,
      engine_number: form.engine_number || undefined,
      insurance_policy_number: form.insurance_policy_number || undefined,
      insurance_provider: form.insurance_provider || undefined,
      insurance_expiry: form.insurance_expiry || undefined,
      registration_expiry: form.registration_expiry || undefined,
      purchase_date: form.purchase_date || undefined,
      purchase_price: form.purchase_price ? Number(form.purchase_price) : undefined,
      current_mileage_km: form.current_mileage_km ? Number(form.current_mileage_km) : undefined,
      unit_value: form.unit_value ? Number(form.unit_value) : undefined,
      condition: form.condition,
      last_service_date: form.last_service_date || undefined,
      service_interval_days: Number(form.service_interval_days),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ims-vehicles'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('inv.addVehicleTitle')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.displayNameStar')}</label>
              <input value={form.name} onChange={set('name')} className={cls} placeholder="e.g. Toyota Hilux — White" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.ownerEntityStar')}</label>
              <select value={form.owner_entity} onChange={set('owner_entity')} className={cls}>
                {VEHICLE_OWNER_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              {form.owner_entity === 'Other' && (
                <input value={form.owner_entity_custom} onChange={set('owner_entity_custom')}
                  className={`${cls} mt-1`} placeholder={t('inv.ownerEntityPlaceholder')} />
              )}
            </div>
          </div>

          {/* Location — optional, with inline create */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-400">{t('inv.colLocation')}</label>
              <button type="button" onClick={() => setShowCreateLoc(true)}
                className="text-xs text-orange-400 hover:text-orange-300">{t('inv.createLocation')}</button>
            </div>
            <select value={form.location_id} onChange={set('location_id')} className={cls}>
              <option value="">{t('inv.noLocation')}</option>
              {locations.map(l => <option key={l.id} value={l.id}>[{l.code}] {l.name}</option>)}
            </select>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.registrationStar')}</label>
              <input value={form.registration_number} onChange={set('registration_number')} className={cls} placeholder="e.g. PAB 1234" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.vehicleType')}</label>
              <select value={form.vehicle_type} onChange={set('vehicle_type')} className={cls}>
                {VEHICLE_TYPES.map(vt => <option key={vt} value={vt}>{vt}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.makeStar')}</label>
              <input value={form.make} onChange={set('make')} className={cls} placeholder="Toyota" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.modelStar')}</label>
              <input value={form.model} onChange={set('model')} className={cls} placeholder="Hilux" />
            </div>
            <div className="w-24">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.yearStar')}</label>
              <input type="number" min="1900" max="2100" value={form.year} onChange={set('year')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.colour')}</label>
              <input value={form.colour} onChange={set('colour')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.fuelType')}</label>
              <select value={form.fuel_type} onChange={set('fuel_type')} className={cls}>
                {['PETROL','DIESEL','HYBRID','ELECTRIC','NONE'].map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.insuranceExpiry')}</label>
              <input type="date" value={form.insurance_expiry} onChange={set('insurance_expiry')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.regExpiry')}</label>
              <input type="date" value={form.registration_expiry} onChange={set('registration_expiry')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.insuranceProvider')}</label>
              <input value={form.insurance_provider} onChange={set('insurance_provider')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.policyNumber')}</label>
              <input value={form.insurance_policy_number} onChange={set('insurance_policy_number')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.purchaseDate')}</label>
              <input type="date" value={form.purchase_date} onChange={set('purchase_date')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.purchasePriceTTD')}</label>
              <input type="number" step="0.01" value={form.purchase_price} onChange={set('purchase_price')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.currentValueTTD')}</label>
              <input type="number" step="0.01" value={form.unit_value} onChange={set('unit_value')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.vin')}</label>
              <input value={form.vin} onChange={set('vin')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.engineNumber')}</label>
              <input value={form.engine_number} onChange={set('engine_number')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.condition')}</label>
              <select value={form.condition} onChange={set('condition')} className={cls}>
                {['NEW','GOOD','FAIR','POOR'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.mileageKm')}</label>
              <input type="number" min="0" value={form.current_mileage_km} onChange={set('current_mileage_km')} className={cls} />
            </div>
          </div>

          {/* Service tracking */}
          <div className="border-t border-slate-700 pt-3">
            <p className="text-xs text-slate-400 mb-2 font-medium">{t('inv.serviceTracking')}</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">{t('inv.serviceDate')}</label>
                <input type="date" value={form.last_service_date} onChange={set('last_service_date')} className={cls} />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">{t('inv.serviceIntervalDays')}</label>
                <input type="number" min="1" max="3650" value={form.service_interval_days} onChange={set('service_interval_days')} className={cls} />
                <p className="text-xs text-slate-500 mt-0.5">{t('inv.defaultServiceInterval')}</p>
              </div>
            </div>
          </div>

          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => mutate()}
            disabled={isPending || !form.name || !form.registration_number || !form.make || !form.model || !form.year || !ownerEntityFinal}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {isPending ? t('common.saving') : t('inv.addVehicleBtn')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>

      {showCreateLoc && (
        <CreateLocationModal
          onClose={() => setShowCreateLoc(false)}
          onCreated={(loc) => {
            setLocations(prev => [...prev, loc])
            setForm(f => ({ ...f, location_id: loc.id }))
            setShowCreateLoc(false)
          }}
        />
      )}
    </div>
  )
}

// ── Edit Vehicle Modal ────────────────────────────────────────────────────────

function EditVehicleModal({
  vehicle,
  locations,
  onClose,
}: {
  vehicle: Vehicle
  locations: { id: string; name: string; code: string }[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const [form, setForm] = useState({
    owner_entity: vehicle.owner_entity ?? vehicle.fleet_type ?? '',
    owner_entity_custom: '',
    location_id: vehicle.location_id ?? '',
    colour: vehicle.colour ?? '',
    condition: vehicle.item_condition ?? 'GOOD',
    current_mileage_km: vehicle.current_mileage_km != null ? String(vehicle.current_mileage_km) : '',
    unit_value: vehicle.current_value != null ? String(vehicle.current_value) : '',
    insurance_expiry: vehicle.insurance_expiry ?? '',
    insurance_provider: vehicle.insurance_provider ?? '',
    insurance_policy_number: vehicle.insurance_policy_number ?? '',
    registration_expiry: vehicle.registration_expiry ?? '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const ownerEntityFinal = form.owner_entity === 'Other' ? form.owner_entity_custom : form.owner_entity

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => imsApi.updateVehicle(vehicle.id, {
      owner_entity: ownerEntityFinal || undefined,
      colour: form.colour || undefined,
      condition: form.condition || undefined,
      current_mileage_km: form.current_mileage_km ? Number(form.current_mileage_km) : undefined,
      unit_value: form.unit_value ? Number(form.unit_value) : undefined,
      insurance_expiry: form.insurance_expiry || undefined,
      insurance_provider: form.insurance_provider || undefined,
      insurance_policy_number: form.insurance_policy_number || undefined,
      registration_expiry: form.registration_expiry || undefined,
      location_id: form.location_id || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ims-vehicles'] }); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-semibold mb-1 text-white">{t('inv.editVehicleTitle')}</h3>
        <p className="text-xs text-slate-400 mb-4">{vehicle.registration_number} — {vehicle.make} {vehicle.model}</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.ownerEntityStar')}</label>
            <select value={form.owner_entity} onChange={set('owner_entity')} className={cls}>
              {VEHICLE_OWNER_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              <option value="Other">Other</option>
            </select>
            {form.owner_entity === 'Other' && (
              <input value={form.owner_entity_custom} onChange={set('owner_entity_custom')}
                className={`${cls} mt-1`} placeholder={t('inv.ownerEntityPlaceholder')} />
            )}
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.colLocation')}</label>
            <select value={form.location_id} onChange={set('location_id')} className={cls}>
              <option value="">{t('inv.noLocation')}</option>
              {locations.map(l => <option key={l.id} value={l.id}>[{l.code}] {l.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.condition')}</label>
              <select value={form.condition} onChange={set('condition')} className={cls}>
                {['NEW','GOOD','FAIR','POOR'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.colour')}</label>
              <input value={form.colour} onChange={set('colour')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.currentValueTTD')}</label>
              <input type="number" step="0.01" min="0" value={form.unit_value} onChange={set('unit_value')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.mileageKm')}</label>
              <input type="number" min="0" value={form.current_mileage_km} onChange={set('current_mileage_km')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.insuranceExpiry')}</label>
              <input type="date" value={form.insurance_expiry} onChange={set('insurance_expiry')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.regExpiry')}</label>
              <input type="date" value={form.registration_expiry} onChange={set('registration_expiry')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.insuranceProvider')}</label>
              <input value={form.insurance_provider} onChange={set('insurance_provider')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.policyNumber')}</label>
              <input value={form.insurance_policy_number} onChange={set('insurance_policy_number')} className={cls} />
            </div>
          </div>
          {(vehicle.vin || vehicle.engine_number) && (
            <div className="flex gap-3">
              {vehicle.vin && (
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">{t('inv.vinChassis')}</label>
                  <input readOnly value={vehicle.vin} className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-300 font-mono cursor-default select-all" />
                </div>
              )}
              {vehicle.engine_number && (
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">{t('inv.engineNumber')}</label>
                  <input readOnly value={vehicle.engine_number} className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-300 font-mono cursor-default select-all" />
                </div>
              )}
            </div>
          )}
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={() => mutate()} disabled={isPending}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('inv.saveChanges')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Movement Modal ─────────────────────────────────────────────────────────────

function RecordMovementModal({
  item,
  locations,
  onClose,
}: {
  item: Item
  locations: { id: string; name: string; code: string }[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const [type, setType] = useState<MovementType>('RECEIVE')
  const [quantity, setQuantity] = useState('')
  const [toLoc, setToLoc] = useState('')
  const [notes, setNotes] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      imsApi.recordMovement({
        item_id: item.id,
        movement_type: type,
        quantity: parseFloat(quantity),
        to_location_id: type === 'TRANSFER' ? toLoc : undefined,
        notes: notes || undefined,
        sale_price: type === 'SALE' ? parseFloat(salePrice) : undefined,
        customer_name: type === 'SALE' && customerName ? customerName : undefined,
        idempotency_key: uuidv4(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ims-items'] })
      qc.invalidateQueries({ queryKey: ['ims-item', item.id] })
      qc.invalidateQueries({ queryKey: ['ims-movements'] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-white font-semibold">{t('inv.recordMovementTitle')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="text-slate-400 text-sm">{t('common.name')}: <span className="text-white font-medium">{item.name}</span>
            <span className="ml-2 text-slate-500">({t('inv.itemOnHand', { qty: item.quantity_on_hand, uom: item.unit_of_measure })})</span>
          </div>

          <div>
            <label className="block text-slate-400 text-xs mb-1">{t('inv.movementType')}</label>
            <select
              value={type}
              onChange={e => setType(e.target.value as MovementType)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
            >
              {(['RECEIVE','RETURN','CONSUME','ADJUSTMENT','TRANSFER','DISPOSAL','SALE'] as MovementType[]).map(mt => (
                <option key={mt} value={mt}>{mt}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 text-xs mb-1">{t('inv.quantity')}</label>
            <input
              type="number"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="0"
              min="0.01"
              step="0.01"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
            />
          </div>

          {type === 'TRANSFER' && (
            <div>
              <label className="block text-slate-400 text-xs mb-1">{t('inv.destLocation')}</label>
              <select
                value={toLoc}
                onChange={e => setToLoc(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
              >
                <option value="">{t('inv.selectLocation')}</option>
                {locations.map(l => (
                  <option key={l.id} value={l.id}>[{l.code}] {l.name}</option>
                ))}
              </select>
            </div>
          )}

          {type === 'SALE' && (
            <>
              <div>
                <label className="block text-slate-400 text-xs mb-1">{t('inv.salePriceTTD')}</label>
                <input
                  type="number"
                  value={salePrice}
                  onChange={e => setSalePrice(e.target.value)}
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs mb-1">{t('inv.customerNameOpt')}</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-slate-400 text-xs mb-1">{t('inv.notesOpt')}</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm resize-none"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm text-slate-300 hover:text-white transition-colors"
          >{t('common.cancel')}</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !quantity || (type === 'TRANSFER' && !toLoc) || (type === 'SALE' && !salePrice)}
            className="px-4 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mutation.isPending ? t('common.saving') : t('inv.record')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Barcode Modal ─────────────────────────────────────────────────────────

function AddBarcodeModal({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [type, setType] = useState('CODE128')
  const [isPrimary, setIsPrimary] = useState(false)

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => imsApi.addBarcode(itemId, { barcode_value: value, barcode_type: type, is_primary: isPrimary }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ims-item', itemId] }); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-base font-semibold mb-4 text-white">{t('inv.addBarcodeTitle')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.barcodeValueStar')}</label>
            <input value={value} onChange={e => setValue(e.target.value)} className={cls} placeholder="e.g. 123456789012" autoFocus />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.type')}</label>
            <select value={type} onChange={e => setType(e.target.value)} className={cls}>
              {['EAN13','EAN8','UPC_A','CODE128','QR','CUSTOM'].map(bt => <option key={bt} value={bt}>{bt}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="bc_primary" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} className="rounded" />
            <label htmlFor="bc_primary" className="text-sm text-slate-300">{t('inv.setPrimary')}</label>
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !value} className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('common.add')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Item Modal ───────────────────────────────────────────────────────────

function EditItemModal({
  item,
  locations,
  onClose,
}: {
  item: Item
  locations: { id: string; name: string; code: string }[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const [form, setForm] = useState({
    name: item.name,
    description: '',
    unit_value: item.unit_value != null ? String(item.unit_value) : '',
    condition: item.condition,
    location_id: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => {
      const patch: Record<string, unknown> = {}
      if (form.name !== item.name) patch.name = form.name
      if (form.description) patch.description = form.description
      if (form.condition !== item.condition) patch.condition = form.condition
      if (form.unit_value !== String(item.unit_value ?? '')) patch.unit_value = form.unit_value ? Number(form.unit_value) : null
      return imsApi.updateItem(item.id, patch as Parameters<typeof imsApi.updateItem>[1])
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ims-items'] })
      qc.invalidateQueries({ queryKey: ['ims-item', item.id] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60]">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-5 shadow-2xl">
        <h3 className="text-base font-semibold mb-1 text-white">{t('inv.editItemTitle')}</h3>
        <p className="text-xs text-slate-400 mb-4">{item.sku ? item.sku + ' · ' : ''}{item.location_name}</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.nameStar')}</label>
            <input value={form.name} onChange={set('name')} className={cls} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.unitValueTTD')}</label>
              <input type="number" step="0.01" min="0" value={form.unit_value} onChange={set('unit_value')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.condition')}</label>
              <select value={form.condition} onChange={set('condition')} className={cls}>
                {['NEW','GOOD','FAIR','POOR','WRITTEN_OFF'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.newLocation')}</label>
            <select value={form.location_id} onChange={set('location_id')} className={cls}>
              <option value="">{t('inv.keepCurrent')}</option>
              {locations.map(l => <option key={l.id} value={l.id}>[{l.code}] {l.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.descriptionReplaces')}</label>
            <textarea value={form.description} onChange={set('description')} rows={2} className={cls} placeholder={t('inv.leaveBlankKeep')} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={() => mutate()} disabled={isPending || !form.name}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('inv.saveChanges')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Item Detail Panel ─────────────────────────────────────────────────────────

function ItemDetailPanel({
  item,
  onClose,
}: {
  item: Item
  onClose: () => void
}) {
  const [movementModal, setMovementModal] = useState(false)
  const [addBarcodeModal, setAddBarcodeModal] = useState(false)
  const [editModal, setEditModal] = useState(false)
  const [showDeleteItem, setShowDeleteItem] = useState(false)
  const [detailTab, setDetailTab] = useState<'info' | 'movements' | 'barcodes' | 'photos'>('info')
  const qc = useQueryClient()
  const { t } = useTranslation()

  const { data: detail } = useQuery({
    queryKey: ['ims-item', item.id],
    queryFn: () => imsApi.getItem(item.id),
  })

  const { data: movData } = useQuery({
    queryKey: ['ims-movements', item.id],
    queryFn: () => imsApi.getMovements({ item_id: item.id, limit: 50 }),
    enabled: detailTab === 'movements',
  })

  const { data: locData } = useQuery({
    queryKey: ['ims-locations'],
    queryFn: () => imsApi.getLocations(),
  })

  const d = detail ?? item as ItemDetail

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-white font-semibold truncate">{d.name}</h2>
            <p className="text-slate-400 text-sm mt-0.5">
              {d.sku ? `SKU: ${d.sku}` : t('inv.noSku')} · {d.location_code} {d.location_name}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setEditModal(true)}
              className="px-3 py-1.5 rounded text-xs bg-slate-600 hover:bg-slate-500 text-white transition-colors"
            >
              {t('common.edit')}
            </button>
            <button
              onClick={() => setShowDeleteItem(true)}
              className="px-3 py-1.5 rounded text-xs bg-slate-700 hover:bg-red-700 text-slate-400 hover:text-white transition-colors"
              title="Delete item"
            >{t('common.delete')}</button>
            <button
              onClick={() => setMovementModal(true)}
              className="px-3 py-1.5 rounded text-xs bg-orange-600 hover:bg-orange-500 text-white transition-colors"
            >
              {t('inv.addMovement')}
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700 px-5">
          {(['info', 'movements', 'barcodes', 'photos'] as const).map(dtab => {
            const tabLabels = {
              info:      t('inv.detailTabInfo'),
              movements: t('inv.detailTabMovements'),
              barcodes:  t('inv.detailTabBarcodes'),
              photos:    t('inv.detailTabPhotos'),
            }
            return (
              <button
                key={dtab}
                onClick={() => setDetailTab(dtab)}
                className={`py-2 px-3 text-sm capitalize font-medium border-b-2 -mb-px transition-colors ${
                  detailTab === dtab
                    ? 'border-orange-500 text-orange-400'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >{tabLabels[dtab]}</button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {detailTab === 'info' && (
            <div className="space-y-5">
              {/* Stock */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-white">{d.quantity_on_hand}</p>
                  <p className="text-xs text-slate-400 mt-1">{t('inv.onHand')}</p>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-white">{d.quantity_reserved}</p>
                  <p className="text-xs text-slate-400 mt-1">{t('inv.reserved')}</p>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-white">{d.reorder_point ?? '—'}</p>
                  <p className="text-xs text-slate-400 mt-1">{t('inv.reorderAt')}</p>
                </div>
              </div>

              {/* Fields */}
              <div className="space-y-2">
                {([
                  ['unitOfMeasure', t('inv.unitOfMeasure'), d.unit_of_measure],
                  ['unitValue',     t('inv.unitValue'),     fmtMoney(d.unit_value)],
                  ['totalValue',    t('inv.totalValue'),     fmtMoney(d.unit_value != null ? d.unit_value * d.quantity_on_hand : null)],
                  ['condition',     t('inv.conditionLbl'),   null],
                  ['category',      t('inv.categoryLbl'),    d.category_name ?? '—'],
                  ['serialNumber',  t('inv.serialNumberLbl'), d.serial_number ?? '—'],
                  ['asset',         t('inv.assetLbl'),       d.is_asset ? t('common.yes') : t('common.no')],
                  ['lastModified',  t('inv.lastModified'),   fmtDate(d.last_modified_at)],
                ] as [string, string, string | null][]).map(([key, label, value]) => (
                  <div key={key} className="flex justify-between text-sm">
                    <span className="text-slate-400">{label}</span>
                    {key === 'condition'
                      ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CONDITION_STYLES[d.condition]}`}>{d.condition}</span>
                      : <span className="text-white">{value as string}</span>
                    }
                  </div>
                ))}
              </div>

              {/* Description */}
              {d.description && (
                <div>
                  <p className="text-slate-400 text-xs mb-1">Description</p>
                  <p className="text-slate-300 text-sm">{d.description}</p>
                </div>
              )}

              {/* Tags */}
              {d.tags.length > 0 && (
                <div>
                  <p className="text-slate-400 text-xs mb-2">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {d.tags.map(tag => (
                      <span
                        key={tag.id}
                        className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: tag.color + '55', border: `1px solid ${tag.color}` }}
                      >{tag.name}</span>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}

          {detailTab === 'barcodes' && (
            <BarcodesTab item={d as ItemDetail} onAdd={() => setAddBarcodeModal(true)} />
          )}

          {detailTab === 'photos' && (
            <PhotosTab itemId={item.id} />
          )}

          {detailTab === 'movements' && (
            <div className="space-y-2">
              {!movData && <p className="text-slate-400 text-sm">{t('common.loading')}</p>}
              {movData?.movements.length === 0 && (
                <p className="text-slate-500 text-sm text-center py-8">{t('inv.noMovements')}</p>
              )}
              {movData?.movements.map(m => (
                <div key={m.id} className="bg-slate-700/50 rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${MOVEMENT_STYLES[m.movement_type]}`}>
                      {m.movement_type}
                    </span>
                    <span className="text-slate-400 text-xs">{fmtDateTime(m.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className={m.movement_type === 'CONSUME' || m.movement_type === 'DISPOSAL' || m.movement_type === 'SALE' ? 'text-red-400' : 'text-green-400'}>
                      {['CONSUME','DISPOSAL','SALE'].includes(m.movement_type) ? '−' : '+'}{m.quantity}
                    </span>
                    <span className="text-slate-400">{item.unit_of_measure}</span>
                    {m.from_location_name && <span className="text-slate-500 text-xs">{t('inv.fromLbl')} {m.from_location_name}</span>}
                    {m.to_location_name && <span className="text-slate-500 text-xs">→ {m.to_location_name}</span>}
                  </div>
                  {m.sale_price && (
                    <p className="text-slate-400 text-xs">
                      {t('inv.saleLbl')} {fmtMoney(m.sale_price)}{t('inv.perUnitVat')} {fmtMoney(m.vat_amount)}
                      {m.customer_name ? ` · ${m.customer_name}` : ''}
                    </p>
                  )}
                  {m.notes && <p className="text-slate-400 text-xs">{m.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {movementModal && (
        <RecordMovementModal
          item={item}
          locations={locData ?? []}
          onClose={() => setMovementModal(false)}
        />
      )}

      {addBarcodeModal && (
        <AddBarcodeModal itemId={item.id} onClose={() => setAddBarcodeModal(false)} />
      )}

      {editModal && (
        <EditItemModal
          item={item}
          locations={locData ?? []}
          onClose={() => setEditModal(false)}
        />
      )}
      {showDeleteItem && (
        <ConfirmDeleteModal
          label={item.name}
          onConfirm={() => imsApi.deleteItem(item.id).then(() => {
            void qc.invalidateQueries({ queryKey: ['ims-items'] })
            onClose()
          })}
          onClose={() => setShowDeleteItem(false)}
        />
      )}
    </>
  )
}

// ── Barcodes Tab ──────────────────────────────────────────────────────────────

function BarcodesTab({ item, onAdd }: { item: ItemDetail; onAdd: () => void }) {
  const qc = useQueryClient()
  const { t } = useTranslation()

  const { mutate: deleteBarcode } = useMutation({
    mutationFn: (barcodeId: string) => imsApi.deleteBarcode(item.id, barcodeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ims-item', item.id] }),
  })

  const barcodes = item.barcodes ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-slate-400 text-xs">{t('inv.barcodeCount', { count: barcodes.length })}</p>
        <button
          onClick={onAdd}
          className="px-2.5 py-1 text-xs bg-orange-600 hover:bg-orange-500 text-white rounded transition-colors"
        >{t('inv.addBarcode')}</button>
      </div>

      {barcodes.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-8">{t('inv.noBarcodes')}</p>
      )}

      {barcodes.map(b => (
        <div key={b.id} className="flex items-center justify-between bg-slate-700/50 rounded-lg px-3 py-2.5">
          <div>
            <p className="text-white font-mono text-sm">{b.barcode_value}</p>
            <p className="text-slate-400 text-xs mt-0.5">
              {b.barcode_type}{b.is_primary ? ` · ${t('inv.primary')}` : ''}
            </p>
          </div>
          <button
            onClick={() => deleteBarcode(b.id)}
            className="text-slate-500 hover:text-red-400 transition-colors text-lg leading-none px-1"
            title={t('inv.removeBarcode')}
          >&times;</button>
        </div>
      ))}
    </div>
  )
}

// ── Photos Tab ────────────────────────────────────────────────────────────────

function PhotosTab({ itemId }: { itemId: string }) {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const fileRef = useCallback((node: HTMLInputElement | null) => { if (node) node.value = '' }, [])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const { data: photos = [], isLoading } = useQuery({
    queryKey: ['ims-photos', itemId],
    queryFn: () => imsApi.getPhotos(itemId),
  })

  const { mutate: deletePhoto } = useMutation({
    mutationFn: (photoId: string) => imsApi.deletePhoto(itemId, photoId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ims-photos', itemId] }),
  })

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      await imsApi.uploadPhoto(itemId, file, photos.length === 0)
      qc.invalidateQueries({ queryKey: ['ims-photos', itemId] })
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-slate-400 text-xs">{t('inv.photoCount', { count: photos.length })}</p>
        <label className={`px-2.5 py-1 text-xs rounded transition-colors cursor-pointer ${uploading ? 'bg-slate-600 text-slate-400' : 'bg-orange-600 hover:bg-orange-500 text-white'}`}>
          {uploading ? t('inv.uploading') : t('inv.addPhoto')}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileChange} disabled={uploading} />
        </label>
      </div>

      {uploadError && <p className="text-red-400 text-xs">{uploadError}</p>}

      {isLoading && <p className="text-slate-400 text-sm text-center py-8">{t('common.loading')}</p>}
      {!isLoading && photos.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-8">{t('inv.noPhotos')}</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {photos.map(p => (
          <div key={p.id} className="relative group rounded-lg overflow-hidden bg-slate-700 aspect-square">
            <img
              src={`/api/v1${imsApi.photoDownloadUrl(itemId, p.id)}`}
              alt={t('inv.itemPhoto')}
              className="w-full h-full object-cover"
            />
            {p.is_primary && (
              <span className="absolute top-1 left-1 bg-orange-600 text-white text-xs px-1.5 py-0.5 rounded">{t('inv.primaryLabel')}</span>
            )}
            <button
              onClick={() => deletePhoto(p.id)}
              className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
              title={t('inv.deletePhoto')}
            >&times;</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Items Tab ─────────────────────────────────────────────────────────────────

function ItemsTab() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [locationId, setLocationId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [isAsset, setIsAsset] = useState<'all' | 'true' | 'false'>('all')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Item | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const { data: locData } = useQuery({ queryKey: ['ims-locations'], queryFn: imsApi.getLocations })
  const { data: catData } = useQuery({ queryKey: ['ims-categories'], queryFn: imsApi.getCategories })

  const { data, isLoading } = useQuery({
    queryKey: ['ims-items', search, locationId, categoryId, isAsset, page],
    queryFn: () => imsApi.getItems({
      search: search || undefined,
      location_id: locationId || undefined,
      category_id: categoryId || undefined,
      is_asset: isAsset === 'all' ? undefined : isAsset === 'true',
      page,
      limit: 25,
    }),
  })

  const resetFilters = useCallback(() => {
    setSearch(''); setLocationId(''); setCategoryId(''); setIsAsset('all'); setPage(1)
  }, [])

  const items = data?.items ?? []
  const pagination = data?.pagination

  return (
    <div className="flex h-full gap-0">
      {/* List panel */}
      <div className={`flex flex-col ${selected ? 'hidden lg:flex lg:w-96 lg:shrink-0' : 'flex-1'}`}>
        {/* Filters */}
        <div className="px-4 py-3 border-b border-slate-700 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t('inv.searchNameSku')}
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm placeholder:text-slate-500"
            />
            <button
              onClick={() => setShowAdd(true)}
              className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-colors whitespace-nowrap"
            >{t('inv.addItemBtn')}</button>
          </div>
          <div className="flex gap-2">
            <select
              value={locationId}
              onChange={e => { setLocationId(e.target.value); setPage(1) }}
              className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-white text-xs"
            >
              <option value="">{t('inv.allLocations')}</option>
              {(locData ?? []).map(l => <option key={l.id} value={l.id}>[{l.code}] {l.name}</option>)}
            </select>
            <select
              value={categoryId}
              onChange={e => { setCategoryId(e.target.value); setPage(1) }}
              className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-white text-xs"
            >
              <option value="">{t('inv.allCategories')}</option>
              {(catData ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              value={isAsset}
              onChange={e => { setIsAsset(e.target.value as 'all' | 'true' | 'false'); setPage(1) }}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-white text-xs"
            >
              <option value="all">{t('common.all')}</option>
              <option value="true">{t('inv.assets')}</option>
              <option value="false">{t('inv.stock')}</option>
            </select>
          </div>
          {(search || locationId || categoryId || isAsset !== 'all') && (
            <button onClick={resetFilters} className="text-xs text-slate-400 hover:text-white transition-colors">
              {t('inv.clearFilters')}
            </button>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>
          )}
          {!isLoading && items.length === 0 && (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">{t('inv.noItemsFound')}</div>
          )}
          {items.map(item => {
            const lowStock = item.reorder_point != null && item.quantity_on_hand <= item.reorder_point
            return (
              <button
                key={item.id}
                onClick={() => setSelected(item)}
                className={`w-full text-left px-4 py-3 border-b border-slate-700/50 hover:bg-slate-700/40 transition-colors ${selected?.id === item.id ? 'bg-slate-700/60' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{item.name}</p>
                    <p className="text-slate-400 text-xs mt-0.5 truncate">
                      {item.sku ? `${item.sku} · ` : ''}{item.location_code} · {item.category_name ?? t('inv.uncategorised')}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-sm font-medium ${lowStock ? 'text-red-400' : 'text-white'}`}>
                      {item.quantity_on_hand}
                      <span className="text-slate-500 text-xs ml-1">{item.unit_of_measure}</span>
                    </p>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${CONDITION_STYLES[item.condition]}`}>
                      {item.condition}
                    </span>
                  </div>
                </div>
                {item.tags.length > 0 && (
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    {item.tags.map(tag => (
                      <span
                        key={tag.id}
                        className="px-1.5 py-0.5 rounded text-xs text-white"
                        style={{ backgroundColor: tag.color + '55' }}
                      >{tag.name}</span>
                    ))}
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Pagination */}
        {pagination && pagination.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-slate-700 text-xs text-slate-400">
            <span>{t('inv.itemsPagination', { total: pagination.total, page: pagination.page, pages: pagination.pages })}</span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2 py-1 rounded bg-slate-700 disabled:opacity-40"
              >‹</button>
              <button
                onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
                disabled={page === pagination.pages}
                className="px-2 py-1 rounded bg-slate-700 disabled:opacity-40"
              >›</button>
            </div>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="flex-1 border-l border-slate-700 bg-slate-800/50 overflow-hidden flex flex-col">
          <ItemDetailPanel item={selected} onClose={() => setSelected(null)} />
        </div>
      )}

      {showAdd && (
        <AddItemModal
          locations={locData ?? []}
          categories={catData ?? []}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}

// ── Vehicles Tab ──────────────────────────────────────────────────────────────

function VehiclesTab() {
  const { t } = useTranslation()
  const [ownerFilter, setOwnerFilter] = useState('ALL')
  const [page, setPage] = useState(1)
  const [showAdd, setShowAdd] = useState(false)
  const [logServiceFor, setLogServiceFor] = useState<Vehicle | null>(null)
  const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null)
  const [deletingVehicle, setDeletingVehicle] = useState<Vehicle | null>(null)
  const qc = useQueryClient()

  const { data: locData } = useQuery({ queryKey: ['ims-locations'], queryFn: imsApi.getLocations })

  const { data, isLoading } = useQuery({
    queryKey: ['ims-vehicles', ownerFilter, page],
    queryFn: () => imsApi.getVehicles({
      owner_entity: ownerFilter === 'ALL' ? undefined : ownerFilter,
      page,
      limit: 25,
    }),
  })

  const vehicles = data?.vehicles ?? []
  const pagination = data?.pagination

  const nowMs = Date.now()
  const SOON_MS  = 30 * 24 * 60 * 60 * 1000 // 30 days

  const isExpired      = (d: string | null) => !!d && new Date(d + 'T00:00:00').getTime() < nowMs
  const isExpiringSoon = (d: string | null) => !!d && !isExpired(d) && (new Date(d + 'T00:00:00').getTime() - nowMs) < SOON_MS
  const isServiceDue   = (v: Vehicle) => {
    if (!v.next_service_date) return false
    return new Date(v.next_service_date + 'T00:00:00').getTime() <= nowMs + SOON_MS
  }

  // Collect all unique owner_entity values for filter buttons
  const ownerOptions = Array.from(new Set(vehicles.map(v => v.owner_entity).filter(Boolean))) as string[]

  // Alerts across all vehicles (unfiltered) — check entire list
  const alertInsurance = vehicles.filter(v => isExpired(v.insurance_expiry) || isExpiringSoon(v.insurance_expiry))
  const alertReg       = vehicles.filter(v => isExpired(v.registration_expiry) || isExpiringSoon(v.registration_expiry))
  const alertService   = vehicles.filter(v => isServiceDue(v))

  return (
    <div className="flex flex-col h-full">
      {/* Alert banners */}
      {alertInsurance.length > 0 && (
        <div className="mx-4 mt-3 px-4 py-2.5 bg-red-900/40 border border-red-700 rounded-lg text-sm text-red-300 flex items-start gap-2">
          <span className="text-base">🛡️</span>
          <div>
            <span className="font-semibold">{t('inv.insuranceAlert')} </span>
            {alertInsurance.map(v => `${v.registration_number} (${isExpired(v.insurance_expiry) ? t('inv.expired') : fmtDate(v.insurance_expiry)})`).join(' · ')}
          </div>
        </div>
      )}
      {alertReg.length > 0 && (
        <div className="mx-4 mt-2 px-4 py-2.5 bg-orange-900/40 border border-orange-700 rounded-lg text-sm text-orange-300 flex items-start gap-2">
          <span className="text-base">📋</span>
          <div>
            <span className="font-semibold">{t('inv.registrationAlert')} </span>
            {alertReg.map(v => `${v.registration_number} (${isExpired(v.registration_expiry) ? t('inv.expired') : fmtDate(v.registration_expiry)})`).join(' · ')}
          </div>
        </div>
      )}
      {alertService.length > 0 && (
        <div className="mx-4 mt-2 px-4 py-2.5 bg-yellow-900/40 border border-yellow-700 rounded-lg text-sm text-yellow-300 flex items-start gap-2">
          <span className="text-base">🔧</span>
          <div>
            <span className="font-semibold">{t('inv.serviceDueAlert')} </span>
            {alertService.map(v => `${v.registration_number} (${t('inv.due')} ${v.next_service_date ? fmtDate(v.next_service_date) : t('inv.overdue')})`).join(' · ')}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="px-4 py-3 border-b border-slate-700 flex gap-2 items-center flex-wrap mt-2">
        <button onClick={() => { setOwnerFilter('ALL'); setPage(1) }}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${ownerFilter === 'ALL' ? 'bg-orange-700 text-white' : 'bg-slate-700 text-slate-300 hover:text-white'}`}>
          {t('inv.allVehicles')}
        </button>
        {ownerOptions.map(o => (
          <button key={o} onClick={() => { setOwnerFilter(o); setPage(1) }}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${ownerFilter === o ? 'bg-orange-700 text-white' : 'bg-slate-700 text-slate-300 hover:text-white'}`}>
            {o}
          </button>
        ))}
        <button
          onClick={() => setShowAdd(true)}
          className="ml-auto px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-colors"
        >{t('inv.addVehicleFilterBtn')}</button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>
        )}
        {!isLoading && vehicles.length === 0 && (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">{t('inv.noVehiclesFound')}</div>
        )}
        {vehicles.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700 sticky top-0 bg-slate-800">
              <tr>
                {([
                  ['registration', t('inv.colRegistration')],
                  ['makeModel',    t('inv.colMakeModel')],
                  ['year',         t('inv.colYear')],
                  ['owner',        t('inv.colOwner')],
                  ['location',     t('inv.colLocation')],
                  ['value',        t('inv.colValue')],
                  ['condition',    t('inv.colCondition')],
                  ['insurance',    t('inv.colInsurance')],
                  ['regExpiry',    t('inv.colRegExpiry')],
                  ['nextService',  t('inv.colNextService')],
                  ['actions',      ''],
                ] as [string, string][]).map(([key, label]) => (
                  <th key={key} className="px-4 py-2.5 text-left font-medium">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vehicles.map(v => (
                <tr key={v.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-2.5 text-white font-mono font-medium">{v.registration_number}</td>
                  <td className="px-4 py-2.5 text-white">{v.make} {v.model}</td>
                  <td className="px-4 py-2.5 text-slate-300">{v.year}</td>
                  <td className="px-4 py-2.5 text-slate-300 text-xs">{v.owner_entity ?? v.fleet_type}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{v.location_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-300">{fmtMoney(v.current_value)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${CONDITION_STYLES[v.item_condition]}`}>
                      {v.item_condition}
                    </span>
                  </td>
                  <td className={`px-4 py-2.5 text-xs ${isExpired(v.insurance_expiry) ? 'text-red-400 font-bold' : isExpiringSoon(v.insurance_expiry) ? 'text-orange-400 font-medium' : 'text-slate-300'}`}>
                    {fmtDate(v.insurance_expiry)}
                    {(isExpired(v.insurance_expiry) || isExpiringSoon(v.insurance_expiry)) && <span className="ml-1">⚠</span>}
                  </td>
                  <td className={`px-4 py-2.5 text-xs ${isExpired(v.registration_expiry) ? 'text-red-400 font-bold' : isExpiringSoon(v.registration_expiry) ? 'text-orange-400 font-medium' : 'text-slate-300'}`}>
                    {fmtDate(v.registration_expiry)}
                    {(isExpired(v.registration_expiry) || isExpiringSoon(v.registration_expiry)) && <span className="ml-1">⚠</span>}
                  </td>
                  <td className={`px-4 py-2.5 text-xs ${isServiceDue(v) ? 'text-yellow-400 font-medium' : 'text-slate-300'}`}>
                    {v.next_service_date ? fmtDate(v.next_service_date) : v.last_service_date ? '—' : <span className="text-slate-500 italic">{t('inv.notSet')}</span>}
                    {isServiceDue(v) && <span className="ml-1">🔧</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      <button onClick={() => setEditVehicle(v)}
                        className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition-colors">
                        {t('common.edit')}
                      </button>
                      <button onClick={() => setLogServiceFor(v)}
                        className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-orange-700 text-slate-300 hover:text-white transition-colors">
                        {t('inv.serviceBtn')}
                      </button>
                      <button onClick={() => setDeletingVehicle(v)}
                        className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-red-700 text-slate-500 hover:text-white transition-colors"
                        title="Delete vehicle">
                        &#x1F5D1;
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-700 text-xs text-slate-400">
          <span>{t('inv.vehiclesPagination', { total: pagination.total, page: pagination.page, pages: pagination.pages })}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 rounded bg-slate-700 disabled:opacity-40">‹</button>
            <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page === pagination.pages} className="px-2 py-1 rounded bg-slate-700 disabled:opacity-40">›</button>
          </div>
        </div>
      )}

      {showAdd && <AddVehicleModal locations={locData ?? []} onClose={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['ims-vehicles'] }) }} />}
      {logServiceFor && <LogServiceModal vehicle={logServiceFor} onClose={() => setLogServiceFor(null)} />}
      {editVehicle && <EditVehicleModal vehicle={editVehicle} locations={locData ?? []} onClose={() => setEditVehicle(null)} />}
      {deletingVehicle && (
        <ConfirmDeleteModal
          label={`${deletingVehicle.make} ${deletingVehicle.model} (${deletingVehicle.registration_number})`}
          onConfirm={() => imsApi.deleteVehicle(deletingVehicle.id).then(() => {
            void qc.invalidateQueries({ queryKey: ['ims-vehicles'] })
          })}
          onClose={() => setDeletingVehicle(null)}
        />
      )}
    </div>
  )
}

// ── Movements Tab ─────────────────────────────────────────────────────────────

function MovementsTab() {
  const { t } = useTranslation()
  const [movType, setMovType] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['ims-movements', movType, page],
    queryFn: () => imsApi.getMovements({
      movement_type: movType || undefined,
      page,
      limit: 30,
    }),
  })

  const movements = data?.movements ?? []
  const pagination = data?.pagination

  return (
    <div className="flex flex-col h-full">
      {/* Filter */}
      <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
        <label className="text-slate-400 text-xs">{t('inv.typeLbl')}</label>
        <select
          value={movType}
          onChange={e => { setMovType(e.target.value); setPage(1) }}
          className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-white text-xs"
        >
          <option value="">{t('common.all')}</option>
          {(['RECEIVE','RETURN','TRANSFER','ADJUSTMENT','CONSUME','DISPOSAL','SALE'] as const).map(mt => (
            <option key={mt} value={mt}>{mt}</option>
          ))}
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-700/50">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>
        )}
        {!isLoading && movements.length === 0 && (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">{t('inv.noMovements')}</div>
        )}
        {movements.map(m => (
          <div key={m.id} className="px-4 py-3 hover:bg-slate-700/20 transition-colors">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${MOVEMENT_STYLES[m.movement_type]}`}>
                  {m.movement_type}
                </span>
                <p className="text-white text-sm truncate">{m.item_name}</p>
                {m.sku && <span className="text-slate-500 text-xs shrink-0">{m.sku}</span>}
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-medium ${['CONSUME','DISPOSAL','SALE'].includes(m.movement_type) ? 'text-red-400' : 'text-green-400'}`}>
                  {['CONSUME','DISPOSAL','SALE'].includes(m.movement_type) ? '−' : '+'}{m.quantity}
                </p>
                <p className="text-slate-400 text-xs">{fmtDateTime(m.created_at)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
              {m.from_location_name && <span>{t('inv.fromLbl')} {m.from_location_name}</span>}
              {m.to_location_name && <span>{t('inv.toLbl')} {m.to_location_name}</span>}
              {m.sale_price && <span>{t('inv.saleLbl')} {fmtMoney(m.sale_price)}/unit{m.customer_name ? ` · ${m.customer_name}` : ''}</span>}
              {m.notes && <span className="truncate">{m.notes}</span>}
            </div>
          </div>
        ))}
      </div>

      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-700 text-xs text-slate-400">
          <span>{t('inv.movementsPagination', { total: pagination.total, page: pagination.page, pages: pagination.pages })}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 rounded bg-slate-700 disabled:opacity-40">‹</button>
            <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page === pagination.pages} className="px-2 py-1 rounded bg-slate-700 disabled:opacity-40">›</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Valuation Tab ─────────────────────────────────────────────────────────────

const fmtTTD = (v: number) =>
  `TTD ${new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`

function ValuationTab() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['ims-valuation'],
    queryFn: imsApi.getValuation,
  })

  if (isLoading) return <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>
  if (!data) return null

  const { summary, by_location, by_category } = data

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {([
          { key: 'totalItems',  label: t('inv.totalItems'),  value: summary.total_items.toLocaleString() },
          { key: 'lowStock',    label: t('inv.lowStock'),    value: summary.low_stock_count.toLocaleString(),    red: summary.low_stock_count > 0 },
          { key: 'outOfStock',  label: t('inv.outOfStock'),  value: summary.out_of_stock_count.toLocaleString(), red: summary.out_of_stock_count > 0 },
          { key: 'stockValue',  label: t('inv.stockValue'),  value: fmtTTD(summary.total_stock_value) },
          { key: 'assetValue',  label: t('inv.assetValue'),  value: fmtTTD(summary.total_asset_value) },
        ] as { key: string; label: string; value: string; red?: boolean }[]).map(({ key, label, value, red }) => (
          <div key={key} className="bg-slate-700/50 rounded-lg p-3 text-center">
            <p className={`text-xl font-bold ${red ? 'text-orange-400' : 'text-white'}`}>{value}</p>
            <p className="text-xs text-slate-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By location */}
        <div>
          <h3 className="text-sm font-medium text-slate-300 mb-3">{t('inv.valueByLocation')}</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-slate-700">
                <th className="text-left py-1.5">{t('inv.colLocation')}</th>
                <th className="text-right py-1.5">{t('inv.colItems')}</th>
                <th className="text-right py-1.5">{t('inv.colValueHeader')}</th>
              </tr>
            </thead>
            <tbody>
              {by_location.map(r => (
                <tr key={r.location_code} className="border-b border-slate-700/40">
                  <td className="py-2 text-white">{r.location_code} · {r.location_name}</td>
                  <td className="py-2 text-right text-slate-400">{r.item_count}</td>
                  <td className="py-2 text-right text-slate-300">{fmtTTD(Number(r.total_value))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* By category */}
        <div>
          <h3 className="text-sm font-medium text-slate-300 mb-3">{t('inv.valueByCategory')}</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-slate-700">
                <th className="text-left py-1.5">{t('inv.colCategory')}</th>
                <th className="text-right py-1.5">{t('inv.colItems')}</th>
                <th className="text-right py-1.5">{t('inv.colValueHeader')}</th>
              </tr>
            </thead>
            <tbody>
              {by_category.map(r => (
                <tr key={r.category_name} className="border-b border-slate-700/40">
                  <td className="py-2 text-white">{r.category_name}</td>
                  <td className="py-2 text-right text-slate-400">{r.item_count}</td>
                  <td className="py-2 text-right text-slate-300">{fmtTTD(Number(r.total_value))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Low Stock Tab ─────────────────────────────────────────────────────────────

function LowStockTab() {
  const { t } = useTranslation()
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['ims-low-stock'],
    queryFn: imsApi.getLowStock,
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-3">
        <span className="text-orange-400 font-medium text-sm">{t('inv.lowStockCount', { count: items.length })}</span>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>
        )}
        {!isLoading && items.length === 0 && (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">{t('inv.allSufficient')}</div>
        )}
        {items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700 sticky top-0 bg-slate-800">
              <tr>
                {([
                  ['item',        t('inv.colItem')],
                  ['sku',         t('inv.sku')],
                  ['location',    t('inv.colLocation')],
                  ['category',    t('inv.colCategory')],
                  ['onHand',      t('inv.colOnHand')],
                  ['reorderAt',   t('inv.colReorderAt')],
                  ['deficit',     t('inv.colDeficit')],
                  ['valuePerUnit', t('inv.colValuePerUnit')],
                ] as [string, string][]).map(([key, label]) => (
                  <th key={key} className="px-4 py-2.5 text-left font-medium">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const deficit = (item.reorder_point ?? 0) - item.quantity_on_hand
                return (
                  <tr key={item.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-2.5 text-white font-medium">{item.name}</td>
                    <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">{item.sku ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-300 text-xs">{item.location_code} · {item.location_name}</td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{item.category_name ?? '—'}</td>
                    <td className={`px-4 py-2.5 font-medium ${item.quantity_on_hand === 0 ? 'text-red-400' : 'text-orange-400'}`}>
                      {item.quantity_on_hand} <span className="text-xs font-normal text-slate-500">{item.unit_of_measure}</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-300">{item.reorder_point}</td>
                    <td className="px-4 py-2.5 text-red-400 font-medium">{deficit}</td>
                    <td className="px-4 py-2.5 text-slate-300 text-xs">{item.unit_value != null ? `TTD ${item.unit_value.toFixed(2)}` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Stock Takes Tab ───────────────────────────────────────────────────────────

const ST_STATUS_STYLES: Record<StockTakeStatus, string> = {
  OPEN:       'bg-slate-700   text-slate-300  border border-slate-600',
  COUNTING:   'bg-blue-900/50 text-blue-300   border border-blue-700',
  FINALISED:  'bg-green-900/50 text-green-300  border border-green-700',
  CANCELLED:  'bg-red-900/50  text-red-400    border border-red-800',
}

function StockTakeDetail({ st, onClose }: { st: StockTakeSummary; onClose: () => void }) {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const [edits, setEdits] = useState<Record<string, string>>({})

  const { data: detail, isLoading } = useQuery({
    queryKey: ['ims-st', st.id],
    queryFn: () => imsApi.getStockTake(st.id),
  })

  const { mutate: saveCount, isPending: saving } = useMutation({
    mutationFn: () => {
      const lines = Object.entries(edits)
        .filter(([, v]) => v !== '')
        .map(([line_id, v]) => ({ line_id, counted_qty: Number(v) }))
      return imsApi.countStockTakeLines(st.id, lines)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ims-st', st.id] })
      qc.invalidateQueries({ queryKey: ['ims-stock-takes'] })
      setEdits({})
    },
  })

  const { mutate: finalise, isPending: finalising } = useMutation({
    mutationFn: () => imsApi.finaliseStockTake(st.id, uuidv4()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ims-st', st.id] })
      qc.invalidateQueries({ queryKey: ['ims-stock-takes'] })
      qc.invalidateQueries({ queryKey: ['ims-items'] })
    },
  })

  const lines: StockTakeLine[] = detail?.lines ?? []
  const canEdit     = st.status === 'OPEN' || st.status === 'COUNTING'
  const canFinalise = st.status === 'COUNTING' && lines.some(l => l.counted_qty !== null)
  const hasEdits    = Object.values(edits).some(v => v !== '')

  const variantLines  = lines.filter(l => l.variance !== null && l.variance !== 0)
  const pendingLines  = lines.filter(l => l.counted_qty === null)

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-white font-semibold">{st.reference}</h2>
          <p className="text-slate-400 text-sm mt-0.5">{st.location_name ?? 'All Locations'}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canFinalise && (
            <button onClick={() => finalise()} disabled={finalising}
              className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded transition-colors">
              {finalising ? t('inv.finalising') : t('inv.finalise')}
            </button>
          )}
          {hasEdits && canEdit && (
            <button onClick={() => saveCount()} disabled={saving}
              className="px-3 py-1.5 text-xs bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded transition-colors">
              {saving ? t('common.saving') : t('inv.saveCounts')}
            </button>
          )}
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
      </div>

      <div className="px-5 py-2 border-b border-slate-700 flex gap-4 text-xs text-slate-400">
        <span><span className={`px-2 py-0.5 rounded-full ${ST_STATUS_STYLES[st.status]}`}>{st.status}</span></span>
        <span>{st.counted_count} / {st.line_count} {t('inv.counted')}</span>
        {st.variance_count > 0 && <span className="text-orange-400">{st.variance_count} {t('inv.variances')}</span>}
        {pendingLines.length > 0 && <span className="text-yellow-500">{pendingLines.length} {t('inv.uncounted')}</span>}
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>}

        {variantLines.length > 0 && (
          <div className="px-5 pt-3 pb-1">
            <p className="text-xs text-orange-400 font-medium mb-1">{t('inv.variancesTitle')}</p>
          </div>
        )}

        <table className="w-full text-sm">
          <thead className="text-slate-400 text-xs border-b border-slate-700 sticky top-0 bg-slate-800">
            <tr>
              <th className="px-5 py-2 text-left">{t('inv.colItem')}</th>
              <th className="px-3 py-2 text-right">{t('inv.colExpected')}</th>
              <th className="px-3 py-2 text-right">{t('inv.colCounted')}</th>
              <th className="px-3 py-2 text-right">{t('inv.colVariance')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(line => {
              const editVal = edits[line.id]
              const counted = editVal !== undefined ? editVal : (line.counted_qty !== null ? String(line.counted_qty) : '')
              const variance = editVal !== undefined
                ? Number(editVal) - line.expected_qty
                : line.variance

              return (
                <tr key={line.id} className={`border-b border-slate-700/40 ${variance !== null && variance !== 0 ? 'bg-orange-950/20' : ''}`}>
                  <td className="px-5 py-2.5">
                    <p className="text-white">{line.item_name}</p>
                    <p className="text-slate-500 text-xs">{line.sku ?? ''} · {line.location_code} · {line.unit_of_measure}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-300">{line.expected_qty}</td>
                  <td className="px-3 py-2.5 text-right">
                    {canEdit ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={counted}
                        onChange={e => setEdits(ed => ({ ...ed, [line.id]: e.target.value }))}
                        className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white text-right"
                        placeholder="—"
                      />
                    ) : (
                      <span className="text-slate-300">{line.counted_qty ?? '—'}</span>
                    )}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-medium ${
                    variance === null ? 'text-slate-500'
                    : variance > 0  ? 'text-green-400'
                    : variance < 0  ? 'text-red-400'
                    : 'text-slate-400'
                  }`}>
                    {variance !== null ? (variance > 0 ? `+${variance}` : variance) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StockTakesTab() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const [selected, setSelected] = useState<StockTakeSummary | null>(null)
  const { data: takes = [], isLoading } = useQuery({ queryKey: ['ims-stock-takes'], queryFn: imsApi.getStockTakes })

  const { mutate: createTake, isPending: creating } = useMutation({
    mutationFn: () => imsApi.createStockTake({}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['ims-stock-takes'] })
      // Auto-open the new take
      setSelected({ id: data.id, reference: data.reference, status: 'OPEN',
        location_id: null, location_name: null, notes: null,
        line_count: data.line_count, counted_count: 0, variance_count: 0,
        finalised_at: null, last_modified_at: new Date().toISOString(), created_at: new Date().toISOString() })
    },
  })

  return (
    <div className="flex h-full gap-0">
      <div className={`flex flex-col ${selected ? 'hidden lg:flex lg:w-80 lg:shrink-0' : 'flex-1'}`}>
        <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
          <span className="text-slate-400 text-sm">{t('inv.stockTakeCount', { count: takes.length })}</span>
          <button onClick={() => createTake()} disabled={creating}
            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors">
            {creating ? t('inv.creating') : t('inv.newStockTake')}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-700/50">
          {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>}
          {!isLoading && takes.length === 0 && <div className="flex items-center justify-center h-32 text-slate-500 text-sm">{t('inv.noStockTakes')}</div>}
          {takes.map(st => (
            <button key={st.id} onClick={() => setSelected(st)}
              className={`w-full text-left px-4 py-3 hover:bg-slate-700/40 transition-colors ${selected?.id === st.id ? 'bg-slate-700/60' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-white text-sm font-mono font-medium">{st.reference}</p>
                <span className={`px-2 py-0.5 rounded-full text-xs ${ST_STATUS_STYLES[st.status]}`}>{st.status}</span>
              </div>
              <p className="text-slate-400 text-xs mt-0.5">{st.location_name ?? 'All Locations'}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                <span>{st.counted_count}/{st.line_count} {t('inv.counted')}</span>
                {st.variance_count > 0 && <span className="text-orange-400">{st.variance_count} {t('inv.variances')}</span>}
                <span className="ml-auto">{new Date(st.created_at).toLocaleDateString('en-TT')}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
      {selected && (
        <div className="flex-1 border-l border-slate-700 bg-slate-800/50 overflow-hidden flex flex-col">
          <StockTakeDetail st={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  )
}

// ── Depreciation Tab ──────────────────────────────────────────────────────────

function AddScheduleModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const { data: assetsData } = useQuery({
    queryKey: ['ims-items-assets'],
    queryFn: () => imsApi.getItems({ is_asset: true, limit: 100 }),
  })
  const [form, setForm] = useState({
    item_id: '', method: 'STRAIGHT_LINE', useful_life_years: '5',
    residual_value: '0', depreciation_start: new Date().toISOString().slice(0, 10),
    cost_at_start: '', notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => imsApi.createDepreciationSchedule({
      item_id: form.item_id,
      method: form.method,
      useful_life_years: Number(form.useful_life_years),
      residual_value: Number(form.residual_value),
      depreciation_start: form.depreciation_start,
      cost_at_start: Number(form.cost_at_start),
      notes: form.notes || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ims-dep-schedules'] }); onClose() },
  })

  const assets = assetsData?.items ?? []

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('inv.addDepScheduleTitle')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.assetStar')}</label>
            <select value={form.item_id} onChange={set('item_id')} className={cls}>
              <option value="">{t('inv.selectAsset')}</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.name}{a.sku ? ` (${a.sku})` : ''}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.method')}</label>
              <select value={form.method} onChange={set('method')} className={cls}>
                <option value="STRAIGHT_LINE">{t('inv.straightLine')}</option>
                <option value="DECLINING_BALANCE">{t('inv.decliningBalance')}</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.usefulLifeStar')}</label>
              <input type="number" min="0.5" step="0.5" value={form.useful_life_years} onChange={set('useful_life_years')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.costAtStartStar')}</label>
              <input type="number" min="0.01" step="0.01" value={form.cost_at_start} onChange={set('cost_at_start')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('inv.residualValueTTD')}</label>
              <input type="number" min="0" step="0.01" value={form.residual_value} onChange={set('residual_value')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.depStartDateStar')}</label>
            <input type="date" value={form.depreciation_start} onChange={set('depreciation_start')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.item_id || !form.cost_at_start}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('inv.createSchedule')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function ScheduleDetail({ sched, onClose }: { sched: DepreciationSchedule; onClose: () => void }) {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const today = new Date().toISOString().slice(0, 10)
  const [periodStart, setPeriodStart] = useState(() => {
    if (!sched.last_posted_period) return sched.depreciation_start
    // Default to month after last posted period
    const d = new Date(sched.last_posted_period)
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  })
  const [periodEnd, setPeriodEnd] = useState(today)

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['ims-dep-entries', sched.id],
    queryFn: () => imsApi.getDepreciationEntries(sched.id),
  })

  const { mutate: postEntry, isPending: posting, error } = useMutation({
    mutationFn: () => imsApi.postDepreciationEntry(sched.id, { period_start: periodStart, period_end: periodEnd }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ims-dep-entries', sched.id] })
      qc.invalidateQueries({ queryKey: ['ims-dep-schedules'] })
    },
  })

  const fmtMon = (v: number | string) =>
    `TTD ${new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2 }).format(Number(v))}`

  const pctDepreciated = sched.cost_at_start > 0
    ? (Number(sched.accumulated_depreciation) / sched.cost_at_start) * 100
    : 0

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between">
        <div>
          <h2 className="text-white font-semibold">{sched.item_name}</h2>
          <p className="text-slate-400 text-sm mt-0.5">{sched.method.replace('_', ' ')} · {sched.useful_life_years}{t('inv.yr')} {t('inv.usefulLife')}</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
      </div>

      {/* Summary */}
      <div className="px-5 py-3 border-b border-slate-700 grid grid-cols-4 gap-3">
        {([
          { key: 'cost',        label: t('inv.cost'),        value: fmtMon(sched.cost_at_start) },
          { key: 'accumulated', label: t('inv.accumulated'), value: fmtMon(sched.accumulated_depreciation) },
          { key: 'netBookVal',  label: t('inv.netBookVal'),  value: fmtMon(sched.net_book_value) },
          { key: 'residual',    label: t('inv.residual'),    value: fmtMon(sched.residual_value) },
        ] as { key: string; label: string; value: string }[]).map(({ key, label, value }) => (
          <div key={key} className="text-center">
            <p className="text-white text-sm font-medium">{value}</p>
            <p className="text-slate-500 text-xs">{label}</p>
          </div>
        ))}
      </div>
      <div className="px-5 py-2 border-b border-slate-700">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span>{t('inv.depreciated')}</span><span>{pctDepreciated.toFixed(1)}%</span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${Math.min(100, pctDepreciated)}%` }} />
        </div>
      </div>

      {/* Post entry form */}
      {sched.is_active && (
        <div className="px-5 py-3 border-b border-slate-700 flex items-end gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.periodStart')}</label>
            <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-white text-xs" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('inv.periodEnd')}</label>
            <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-white text-xs" />
          </div>
          <button onClick={() => postEntry()} disabled={posting || !periodStart || !periodEnd}
            className="px-3 py-1.5 text-xs bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded transition-colors whitespace-nowrap">
            {posting ? t('inv.posting') : t('inv.postEntry')}
          </button>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
      )}

      {/* Entries */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>}
        {!isLoading && entries.length === 0 && <div className="flex items-center justify-center h-32 text-slate-500 text-sm">{t('inv.noEntries')}</div>}
        {entries.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-xs border-b border-slate-700 sticky top-0 bg-slate-800">
              <tr>
                {([
                  ['period',      t('inv.colPeriod')],
                  ['depreciation', t('inv.colDepreciation')],
                  ['accumulated', t('inv.colAccumulated')],
                  ['nbv',         t('inv.colNBV')],
                ] as [string, string][]).map(([key, label]) => (
                  <th key={key} className="px-5 py-2 text-left font-medium">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...entries].reverse().map(e => (
                <tr key={e.id} className="border-b border-slate-700/40">
                  <td className="px-5 py-2.5 text-slate-300 text-xs">
                    {new Date(e.period_start).toLocaleDateString('en-TT', { month: 'short', year: 'numeric' })}
                    {' → '}
                    {new Date(e.period_end).toLocaleDateString('en-TT', { month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-5 py-2.5 text-orange-400 font-medium">{fmtMon(e.depreciation_amount)}</td>
                  <td className="px-5 py-2.5 text-slate-300">{fmtMon(e.accumulated_depreciation)}</td>
                  <td className="px-5 py-2.5 text-white font-medium">{fmtMon(e.net_book_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function DepreciationTab() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<DepreciationSchedule | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const { data: schedules = [], isLoading } = useQuery({
    queryKey: ['ims-dep-schedules'],
    queryFn: imsApi.getDepreciationSchedules,
  })

  const fmtMon = (v: number | string) =>
    `TTD ${new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2 }).format(Number(v))}`

  return (
    <div className="flex h-full gap-0">
      <div className={`flex flex-col ${selected ? 'hidden lg:flex lg:w-96 lg:shrink-0' : 'flex-1'}`}>
        <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
          <span className="text-slate-400 text-sm">{t('inv.assetCount', { count: schedules.length })}</span>
          <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-colors">{t('inv.addScheduleBtn')}</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>}
          {!isLoading && schedules.length === 0 && <div className="flex items-center justify-center h-32 text-slate-500 text-sm">{t('inv.noSchedules')}</div>}
          {schedules.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700 sticky top-0 bg-slate-800">
                <tr>
                  {([
                    ['asset',      t('inv.colAsset')],
                    ['method',     t('inv.colMethod')],
                    ['cost',       t('inv.colCost')],
                    ['nbv',        t('inv.colNBV')],
                    ['lastPeriod', t('inv.colLastPeriod')],
                  ] as [string, string][]).map(([key, label]) => (
                    <th key={key} className="px-4 py-2.5 text-left font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedules.map(s => (
                  <tr key={s.id} onClick={() => setSelected(s)}
                    className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors cursor-pointer ${selected?.id === s.id ? 'bg-slate-700/50' : ''}`}>
                    <td className="px-4 py-2.5">
                      <p className="text-white font-medium">{s.item_name}</p>
                      {s.sku && <p className="text-slate-500 text-xs">{s.sku}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{s.method === 'STRAIGHT_LINE' ? 'SL' : 'DB'} · {s.useful_life_years}yr</td>
                    <td className="px-4 py-2.5 text-slate-300 text-xs">{fmtMon(s.cost_at_start)}</td>
                    <td className="px-4 py-2.5 text-white text-xs font-medium">{fmtMon(s.net_book_value)}</td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">
                      {s.last_posted_period
                        ? new Date(s.last_posted_period).toLocaleDateString('en-TT', { month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {selected && (
        <div className="flex-1 border-l border-slate-700 bg-slate-800/50 overflow-hidden flex flex-col">
          <ScheduleDetail sched={selected} onClose={() => setSelected(null)} />
        </div>
      )}
      {showAdd && <AddScheduleModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'items' | 'vehicles' | 'movements' | 'low-stock' | 'valuation' | 'stock-takes' | 'depreciation'

export default function Inventory() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('items')

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Page header */}
      <div className="px-6 py-4 border-b border-slate-700">
        <h1 className="text-xl font-semibold text-white">{t('inv.pageTitle')}</h1>
        <p className="text-slate-400 text-sm mt-0.5">{t('inv.pageSubtitle')}</p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-700 px-6">
        {([
          { key: 'items',        label: t('inv.tabItemsAssets') },
          { key: 'vehicles',     label: t('inv.tabVehicles') },
          { key: 'movements',    label: t('inv.tabMovements') },
          { key: 'low-stock',    label: t('inv.tabLowStock') },
          { key: 'valuation',    label: t('inv.tabValuation') },
          { key: 'stock-takes',  label: t('inv.tabStockTakes') },
          { key: 'depreciation', label: t('inv.tabDepreciation') },
        ] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >{label}</button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'items'      && <ItemsTab />}
        {tab === 'vehicles'   && <VehiclesTab />}
        {tab === 'movements'  && <MovementsTab />}
        {tab === 'low-stock'  && <LowStockTab />}
        {tab === 'valuation'    && <ValuationTab />}
        {tab === 'stock-takes'  && <StockTakesTab />}
        {tab === 'depreciation' && <DepreciationTab />}
      </div>
    </div>
  )
}
