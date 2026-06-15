import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { financeApi } from '../../api/finance'
import { entityName, fmtTTD } from '../../lib/entities'
import type { InvestmentType } from '../../types/finance'

function fmtNative(value: string, currency: string): string {
  const num = parseFloat(value)
  const formatted = num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency === 'TTD' ? `$${formatted}` : `${currency} ${formatted}`
}

const INVESTMENT_TYPES: InvestmentType[] = [
  'EQUITY', 'BOND', 'MUTUAL_FUND', 'ETF', 'UNIT_TRUST',
  'REAL_ESTATE', 'PRIVATE_EQUITY', 'CASH_EQUIVALENT', 'OTHER',
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

function AddModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
    mutationFn: () => financeApi.createInvestment({
      owner_entity_id: form.owner_entity_id,
      investment_type: form.investment_type,
      asset_name: form.asset_name,
      current_value_ttd: Number(form.current_value_ttd),
      cost_basis_ttd: form.cost_basis_ttd ? Number(form.cost_basis_ttd) : undefined,
      currency: form.currency || 'TTD',
      institution_name: form.institution_name || undefined,
      ticker_symbol: form.ticker_symbol || undefined,
      maturity_date: form.maturity_date || undefined,
      notes: form.notes || undefined,
    }),
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

function UpdateValueModal({ id, name, currency, onClose, onUpdated }: { id: string; name: string; currency: string; onClose: () => void; onUpdated: () => void }) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [gain, setGain] = useState('')

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => financeApi.updateInvestment(id, {
      current_value_ttd: Number(value),
      unrealised_gain_ttd: gain ? Number(gain) : undefined,
    }),
    onSuccess: () => { onUpdated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-base font-semibold mb-4 text-white">{t('finance.investments.updateTitle', { name })}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('finance.investments.currentValue')} ({currency})</label>
            <input type="number" step="0.01" value={value} onChange={e => setValue(e.target.value)} className={cls} placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('finance.investments.unrealisedGainLossLabel')} ({currency})</label>
            <input type="number" step="0.01" value={gain} onChange={e => setGain(e.target.value)} className={cls} placeholder="0.00 (optional)" />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !value}
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
  const [updating, setUpdating] = useState<{ id: string; name: string; currency: string } | null>(null)
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

  const toTTD = (value: string, currency: string) =>
    parseFloat(value) * (rateMap[currency] ?? 1)

  const totalValueTTD = investments.reduce((s, i) => s + toTTD(i.current_value_ttd, i.currency ?? 'TTD'), 0)
  const totalGain = investments.reduce((s, i) => s + toTTD(i.unrealised_gain_ttd ?? '0', i.currency ?? 'TTD'), 0)

  const byEntity: Record<string, typeof investments> = {}
  for (const inv of investments) {
    ;(byEntity[inv.owner_entity_id] ??= []).push(inv)
  }

  return (
    <div>
      {investments.length > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-6">
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
          <div className="rounded-lg overflow-hidden border border-slate-700">
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
                  const ttdEquiv = toTTD(inv.current_value_ttd, invCurrency)
                  return (
                    <tr key={inv.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3 text-slate-100 font-medium">
                        {inv.asset_name}
                        {inv.ticker_symbol && <span className="ml-2 text-xs text-slate-500">{inv.ticker_symbol}</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-400">{t(`finance.investments.investmentTypes.${inv.investment_type}`, inv.investment_type)}</td>
                      <td className="px-4 py-3 text-slate-400">{inv.institution_name ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-100">
                        {fmtNative(inv.current_value_ttd, invCurrency)}
                        {invCurrency !== 'TTD' && (
                          <span className="block text-xs text-slate-500">≈ {fmtTTD(String(ttdEquiv))} TTD</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-sm ${gain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {inv.unrealised_gain_ttd != null ? `${gain >= 0 ? '+' : ''}${fmtNative(inv.unrealised_gain_ttd, invCurrency)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setUpdating({ id: inv.id, name: inv.asset_name, currency: inv.currency ?? 'TTD' })}
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

      {showAdd && <AddModal onClose={() => setShowAdd(false)} onCreated={refresh} />}
      {updating && <UpdateValueModal id={updating.id} name={updating.name} currency={updating.currency} onClose={() => setUpdating(null)} onUpdated={refresh} />}
    </div>
  )
}
