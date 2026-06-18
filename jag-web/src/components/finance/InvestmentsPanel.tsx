import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { financeApi } from '../../api/finance'
import { entityName, fmtTTD } from '../../lib/entities'
import type { InvestmentType } from '../../types/finance'
import type { InvestmentValuation } from '../../types/finance'

function fmtNative(value: string, currency: string): string {
  const num = parseFloat(value)
  const formatted = num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency === 'TTD' ? `$${formatted}` : `${currency} ${formatted}`
}

const INVESTMENT_TYPES: InvestmentType[] = [
  'EQUITY', 'BOND', 'MUTUAL_FUND', 'ETF', 'UNIT_TRUST',
  'REAL_ESTATE', 'PRIVATE_EQUITY', 'CASH_EQUIVALENT', 'ANNUITY', 'OTHER',
]

const CURRENCIES = ['TTD', 'USD', 'CAD', 'CNY']

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

function AddModal({ onClose, onCreated, rateMap }: { onClose: () => void; onCreated: () => void; rateMap: Record<string, number> }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    owner_entity_id: ENTITY_OPTIONS[0].id,
    investment_type: 'EQUITY' as InvestmentType,
    asset_name: '',
    ticker_symbol: '',
    institution_name: '',
    current_value_ttd: '',
    cost_basis_ttd: '',
    currency: 'TTD',
    maturity_date: '',
    notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => {
      const rate = rateMap[form.currency] ?? 1
      return financeApi.createInvestment({
      owner_entity_id: form.owner_entity_id,
      investment_type: form.investment_type,
      asset_name: form.asset_name,
      current_value_ttd: Number(form.current_value_ttd) * rate,
      average_cost_per_unit: form.cost_basis_ttd ? Number(form.cost_basis_ttd) : undefined,
      currency: form.currency || 'TTD',
      institution_name: form.institution_name || undefined,
      ticker_symbol: form.ticker_symbol || undefined,
      maturity_date: form.maturity_date || undefined,
      notes: form.notes || undefined,
    })},
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('finance.investments.addTitle')}</h2>
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
              <select value={form.investment_type} onChange={set('investment_type')} className={cls}>
                {INVESTMENT_TYPES.map(tp => <option key={tp} value={tp}>{t(`finance.investments.investmentTypes.${tp}`)}</option>)}
              </select>
            </div>
            <div className="w-24">
              <label className="block text-xs text-slate-400 mb-1">{t('common.currency')}</label>
              <select value={form.currency} onChange={set('currency')} className={cls}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('finance.investments.assetName')}</label>
            <input value={form.asset_name} onChange={set('asset_name')} className={cls} placeholder="e.g. Angostura Holdings" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('finance.accounts.institution')}</label>
              <input value={form.institution_name} onChange={set('institution_name')} className={cls} placeholder="e.g. BPTT Brokers" />
            </div>
            <div className="w-28">
              <label className="block text-xs text-slate-400 mb-1">{t('finance.investments.ticker')}</label>
              <input value={form.ticker_symbol} onChange={set('ticker_symbol')} className={cls} placeholder="AHL" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('finance.investments.currentValue')} ({form.currency})</label>
              <input type="number" step="0.01" value={form.current_value_ttd} onChange={set('current_value_ttd')} className={cls} placeholder="0.00" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('finance.investments.costBasis')} ({form.currency})</label>
              <input type="number" step="0.01" value={form.cost_basis_ttd} onChange={set('cost_basis_ttd')} className={cls} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('finance.investments.maturityDateOptional')}</label>
            <input type="date" value={form.maturity_date} onChange={set('maturity_date')} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.asset_name || !form.current_value_ttd}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('finance.investments.addTitle')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function HistoryModal({ id, name, currency, onClose }: { id: string; name: string; currency: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)

  // Add entry form state
  const [date, setDate] = useState('')
  const [units, setUnits] = useState('')
  const [price, setPrice] = useState('')
  const [value, setValue] = useState('')
  const [valueManual, setValueManual] = useState(false)
  const [gain, setGain] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (valueManual) return
    const u = parseFloat(units)
    const p = parseFloat(price)
    if (!isNaN(u) && !isNaN(p) && u > 0 && p > 0) setValue((u * p).toFixed(2))
  }, [units, price, valueManual])

  const { data: valuations = [], isLoading } = useQuery({
    queryKey: ['finance', 'investments', id, 'valuations'],
    queryFn: () => financeApi.getInvestmentValuations(id),
  })

  const { mutate, isPending, error: addError } = useMutation({
    mutationFn: () => financeApi.addInvestmentValuation(id, {
      as_of_date: date,
      units_held: units ? Number(units) : undefined,
      price_per_unit: price ? Number(price) : undefined,
      current_value_ttd: Number(value),
      unrealised_gain_ttd: gain ? Number(gain) : undefined,
      notes: notes || undefined,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'investments', id, 'valuations'] })
      setDate(''); setUnits(''); setPrice(''); setValue(''); setGain(''); setNotes('')
      setValueManual(false); setShowAdd(false)
    },
  })

  const fmtNum = (v: string) => parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto py-6">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl mx-4 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Valuation History — {name}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm">{t('common.close', 'Close')}</button>
        </div>

        {/* Add past entry form */}
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
                <label className="block text-xs text-slate-400 mb-1">No. of Shares</label>
                <input type="number" step="0.01" value={units} onChange={e => setUnits(e.target.value)} className={cls} placeholder="0" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">Price / Share ({currency})</label>
                <input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} className={cls} placeholder="0.00" />
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">
                  Value ({currency})
                  {!valueManual && units && price
                    ? <span className="ml-1 text-slate-500 italic">auto</span>
                    : <button type="button" onClick={() => setValueManual(false)} className="ml-1 text-slate-500 hover:text-blue-400 text-xs italic">auto</button>
                  }
                </label>
                <input type="number" step="0.01" value={value}
                  onChange={e => { setValueManual(true); setValue(e.target.value) }}
                  className={cls} placeholder="0.00" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">Gain/Loss ({currency})</label>
                <input type="number" step="0.01" value={gain} onChange={e => setGain(e.target.value)} className={cls} placeholder="optional" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className={cls} placeholder="e.g. Q1 2025 broker statement" />
            </div>
            {addError && <p className="text-red-400 text-xs">{addError instanceof Error ? addError.message : 'Failed.'}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={() => mutate()} disabled={isPending || !date || !value}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors">
                {isPending ? 'Saving...' : 'Save Entry'}
              </button>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-white text-xs transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {isLoading && <p className="text-slate-400 text-sm">Loading...</p>}
        {!isLoading && valuations.length === 0 && (
          <p className="text-slate-400 text-sm">No history yet. Add a past entry above, or history records automatically each time you save an update.</p>
        )}
        {valuations.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-right px-3 py-2">Shares</th>
                  <th className="text-right px-3 py-2">Price ({currency})</th>
                  <th className="text-right px-3 py-2">Value ({currency})</th>
                  <th className="text-right px-3 py-2">Gain/Loss</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {valuations.map((v: InvestmentValuation) => {
                  const gain = v.unrealised_gain_ttd ? parseFloat(v.unrealised_gain_ttd) : null
                  return (
                    <tr key={v.id} className="hover:bg-slate-700/30">
                      <td className="px-3 py-2 text-slate-300">{v.as_of_date}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">
                        {v.units_held ? fmtNum(v.units_held) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">
                        {v.price_per_unit ? fmtNum(v.price_per_unit) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-100 font-medium">
                        {fmtTTD(v.current_value_ttd)}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono text-sm ${gain == null ? 'text-slate-500' : gain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {gain == null ? '—' : `${gain >= 0 ? '+' : ''}${fmtTTD(String(gain))}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

type UpdatingInv = {
  id: string; currency: string
  asset_name: string; investment_type: InvestmentType; institution_name: string
  ticker_symbol: string; units_held: string; current_price: string
  average_cost_per_unit: string; current_value_ttd: string
  unrealised_gain_ttd: string; purchase_date: string
  maturity_date: string; last_valued_at: string; notes: string
}

function UpdateValueModal({ inv, onClose, onUpdated, rateMap }: {
  inv: UpdatingInv; onClose: () => void; onUpdated: () => void; rateMap: Record<string, number>
}) {
  const { t } = useTranslation()
  const rate = rateMap[inv.currency] ?? 1
  const [assetName, setAssetName] = useState(inv.asset_name)
  const [investType, setInvestType] = useState<InvestmentType>(inv.investment_type)
  const [institution, setInstitution] = useState(inv.institution_name)
  const [ticker, setTicker] = useState(inv.ticker_symbol)
  const fmt = (v: string) => v ? parseFloat(v).toFixed(2) : ''
  const [units, setUnits] = useState(() => fmt(inv.units_held))
  const [pricePerUnit, setPricePerUnit] = useState(() => fmt(inv.current_price))
  const [costPerUnit, setCostPerUnit] = useState(() => fmt(inv.average_cost_per_unit))
  // current_value_ttd is stored in TTD — show user the native currency value
  const [value, setValue] = useState(() => fmt(String(parseFloat(inv.current_value_ttd || '0') / rate)))
  const [valueManual, setValueManual] = useState(false)
  const [gain, setGain] = useState(() => {
    const g = parseFloat(inv.unrealised_gain_ttd || '0')
    return g !== 0 ? (g / rate).toFixed(2) : (inv.unrealised_gain_ttd ?? '')
  })

  useEffect(() => {
    if (valueManual) return
    const u = parseFloat(units)
    const p = parseFloat(pricePerUnit)
    if (!isNaN(u) && !isNaN(p) && u > 0 && p > 0) {
      setValue((u * p).toFixed(2))
    }
  }, [units, pricePerUnit, valueManual])
  const [maturity, setMaturity] = useState(
    inv.maturity_date ? inv.maturity_date.slice(0, 10) : ''
  )
  const [valuedDate, setValuedDate] = useState(
    inv.last_valued_at ? inv.last_valued_at.slice(0, 10) : ''
  )
  const [notes, setNotes] = useState(inv.notes)

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
  const { mutate, isPending, error } = useMutation({
    mutationFn: () => financeApi.updateInvestment(inv.id, {
      asset_name: assetName || undefined,
      investment_type: investType,
      institution_name: institution || undefined,
      ticker_symbol: ticker || undefined,
      units_held: units ? Number(units) : undefined,
      current_price: pricePerUnit ? Number(pricePerUnit) : undefined,
      average_cost_per_unit: costPerUnit ? Number(costPerUnit) : undefined,
      current_value_ttd: value ? Number(value) * rate : undefined,
      unrealised_gain_ttd: gain ? Number(gain) * rate : undefined,
      maturity_date: (maturity && DATE_RE.test(maturity)) ? maturity : undefined,
      last_valued_at: (valuedDate && DATE_RE.test(valuedDate)) ? new Date(valuedDate).toISOString() : undefined,
      notes: notes || undefined,
    }),
    onSuccess: () => { onUpdated(); onClose() },
  })

  const cur = inv.currency

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto py-6">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md mx-4 p-6 shadow-2xl">
        <h2 className="text-base font-semibold mb-4 text-white">{t('finance.investments.updateTitle', { name: inv.asset_name })}</h2>
        <div className="space-y-3">

          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('finance.investments.assetName')}</label>
            <input value={assetName} onChange={e => setAssetName(e.target.value)} className={cls} />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('common.type')}</label>
              <select value={investType} onChange={e => setInvestType(e.target.value as InvestmentType)} className={cls}>
                {INVESTMENT_TYPES.map(tp => <option key={tp} value={tp}>{t(`finance.investments.investmentTypes.${tp}`)}</option>)}
              </select>
            </div>
            <div className="w-28">
              <label className="block text-xs text-slate-400 mb-1">{t('finance.investments.ticker')}</label>
              <input value={ticker} onChange={e => setTicker(e.target.value)} className={cls} placeholder="e.g. AHL" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('finance.accounts.institution')}</label>
            <input value={institution} onChange={e => setInstitution(e.target.value)} className={cls} placeholder="e.g. TTSE" />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">No. of Shares</label>
              <input type="number" step="0.000001" value={units} onChange={e => setUnits(e.target.value)} className={cls} placeholder="0" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Price / Share ({cur})</label>
              <input type="number" step="0.0001" value={pricePerUnit} onChange={e => setPricePerUnit(e.target.value)} className={cls} placeholder="0.00" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Purchase Price / Share ({cur})</label>
            <input type="number" step="0.0001" value={costPerUnit} onChange={e => setCostPerUnit(e.target.value)} className={cls} placeholder="Avg cost per unit" />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">
                {t('finance.investments.currentValue')} ({cur})
                {!valueManual && units && pricePerUnit
                  ? <span className="ml-1 text-slate-500 italic">auto</span>
                  : <button type="button" onClick={() => setValueManual(false)} className="ml-1 text-slate-500 hover:text-blue-400 text-xs italic">auto</button>
                }
              </label>
              <input type="number" step="0.01" value={value}
                onChange={e => { setValueManual(true); setValue(e.target.value) }}
                className={cls} placeholder="0.00" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('finance.investments.unrealisedGainLossLabel')} ({cur})</label>
              <input type="number" step="0.01" value={gain} onChange={e => setGain(e.target.value)} className={cls} placeholder="0.00" />
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Value Date</label>
              <input type="date" value={valuedDate} onChange={e => setValuedDate(e.target.value)} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('finance.investments.maturityDateOptional')}</label>
              <input type="date" value={maturity} onChange={e => setMaturity(e.target.value)} className={cls} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} className={cls} rows={2} placeholder="Optional notes" />
          </div>

          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !assetName}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('finance.investments.update')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

export default function InvestmentsPanel() {
  const { t } = useTranslation()
  const [showAdd, setShowAdd] = useState(false)
  const [updating, setUpdating] = useState<UpdatingInv | null>(null)
  const [history, setHistory] = useState<{ id: string; name: string; currency: string } | null>(null)
  const qc = useQueryClient()

  const { data: investments = [], isLoading } = useQuery({
    queryKey: ['finance', 'investments'],
    queryFn: () => financeApi.getInvestments(),
  })

  const { data: fxRates = [] } = useQuery({
    queryKey: ['finance', 'fx-rates'],
    queryFn: () => financeApi.getFxRates(),
  })

  const refresh = () => void qc.invalidateQueries({ queryKey: ['finance', 'investments'] })

  if (isLoading) return <p className="text-slate-400 text-sm">{t('finance.investments.loading')}</p>

  const rateMap: Record<string, number> = { TTD: 1 }
  for (const fx of fxRates) rateMap[fx.currency] = parseFloat(fx.rate_to_ttd)

  // current_value_ttd and unrealised_gain_ttd are always stored in TTD — sum directly.
  const totalValueTTD = investments.reduce((s, i) => s + parseFloat(i.current_value_ttd ?? '0'), 0)
  const totalGain = investments.reduce((s, i) => s + parseFloat(i.unrealised_gain_ttd ?? '0'), 0)

  const byEntity: Record<string, typeof investments> = {}
  for (const inv of investments) {
    ;(byEntity[inv.owner_entity_id] ??= []).push(inv)
  }

  return (
    <div>
      {investments.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="bg-slate-800 rounded-lg p-4 border-l-4 border-blue-500">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{t('finance.investments.portfolioValue')} (TTD)</p>
            <p className="text-lg font-semibold font-mono">{fmtTTD(String(totalValueTTD))}</p>
            <p className="text-xs text-slate-500 mt-1">Converted at today's FX rates</p>
          </div>
          <div className={`bg-slate-800 rounded-lg p-4 border-l-4 ${totalGain >= 0 ? 'border-green-500' : 'border-red-500'}`}>
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{t('finance.investments.unrealisedGainLoss')} (TTD)</p>
            <p className={`text-lg font-semibold font-mono ${totalGain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalGain >= 0 ? '+' : ''}{fmtTTD(String(totalGain))}
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end mb-4">
        <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
          {t('finance.investments.addInvestment')}
        </button>
      </div>

      {investments.length === 0 && <p className="text-slate-400 text-sm">{t('finance.investments.noInvestments')}</p>}

      {Object.entries(byEntity).sort(([a], [b]) => entityName(a).localeCompare(entityName(b))).map(([entityId, rows]) => (
        <div key={entityId} className="mb-6">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-2">{entityName(entityId)}</h3>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-2">{t('finance.investments.colAsset')}</th>
                  <th className="text-left px-4 py-2">{t('finance.investments.colType')}</th>
                  <th className="text-left px-4 py-2">{t('finance.investments.colInstitution')}</th>
                  <th className="text-right px-4 py-2">{t('finance.investments.colValue', 'Value')}</th>
                  <th className="text-right px-4 py-2">{t('finance.investments.colGainLoss')}</th>
                  <th className="text-right px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {rows.map(inv => {
                  const gain = parseFloat(inv.unrealised_gain_ttd ?? '0')
                  const invCurrency = inv.currency ?? 'TTD'
                  // current_value_ttd is always stored in TTD.
                  // For non-TTD investments derive the native display value by dividing.
                  const ttdValue = parseFloat(inv.current_value_ttd ?? '0')
                  const fxRate = rateMap[invCurrency] ?? 1
                  const nativeValue = invCurrency === 'TTD' ? ttdValue : ttdValue / fxRate
                  const gainNative = invCurrency === 'TTD' ? gain : gain / fxRate
                  return (
                    <tr key={inv.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3 text-slate-100 font-medium">
                        {inv.asset_name}
                        {inv.ticker_symbol && <span className="ml-2 text-xs text-slate-500">{inv.ticker_symbol}</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-400">{t(`finance.investments.investmentTypes.${inv.investment_type}`, inv.investment_type)}</td>
                      <td className="px-4 py-3 text-slate-400">{inv.institution_name ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-100">
                        {fmtNative(String(nativeValue), invCurrency)}
                        {invCurrency !== 'TTD' && (
                          <span className="block text-xs text-slate-500">≈ {fmtTTD(String(ttdValue))} TTD</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-sm ${gain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {inv.unrealised_gain_ttd != null ? `${gain >= 0 ? '+' : ''}${fmtNative(String(gainNative), invCurrency)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setHistory({ id: inv.id, name: inv.asset_name, currency: inv.currency ?? 'TTD' })}
                          className="text-xs text-slate-500 hover:text-slate-300 transition-colors mr-3">
                          History
                        </button>
                        <button onClick={() => setUpdating({
                          id: inv.id, currency: inv.currency ?? 'TTD',
                          asset_name: inv.asset_name,
                          investment_type: inv.investment_type,
                          institution_name: inv.institution_name ?? '',
                          ticker_symbol: inv.ticker_symbol ?? '',
                          units_held: inv.units_held ?? '',
                          current_price: inv.current_price ?? '',
                          average_cost_per_unit: inv.average_cost_per_unit ?? '',
                          current_value_ttd: inv.current_value_ttd ?? '',
                          unrealised_gain_ttd: inv.unrealised_gain_ttd ?? '',
                          purchase_date: inv.purchase_date ?? '',
                          maturity_date: inv.maturity_date ?? '',
                          last_valued_at: inv.last_valued_at ?? '',
                          notes: inv.notes ?? '',
                        })}
                          className="text-xs text-slate-500 hover:text-blue-400 transition-colors">
                          {t('finance.investments.update')}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {showAdd && <AddModal onClose={() => setShowAdd(false)} onCreated={refresh} rateMap={rateMap} />}
      {updating && <UpdateValueModal inv={updating} onClose={() => setUpdating(null)} onUpdated={refresh} rateMap={rateMap} />}
      {history && <HistoryModal id={history.id} name={history.name} currency={history.currency} onClose={() => setHistory(null)} />}
    </div>
  )
}
