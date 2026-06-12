import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '../../api/finance'
import { entityName, fmtTTD } from '../../lib/entities'
import type { InvestmentType } from '../../types/finance'

const INVESTMENT_TYPES: InvestmentType[] = [
  'EQUITY', 'BOND', 'MUTUAL_FUND', 'ETF', 'UNIT_TRUST',
  'REAL_ESTATE', 'PRIVATE_EQUITY', 'CASH_EQUIVALENT', 'OTHER',
]

const TYPE_LABELS: Record<InvestmentType, string> = {
  EQUITY: 'Equity', BOND: 'Bond', MUTUAL_FUND: 'Mutual Fund', ETF: 'ETF',
  UNIT_TRUST: 'Unit Trust', REAL_ESTATE: 'Real Estate', PRIVATE_EQUITY: 'Private Equity',
  CASH_EQUIVALENT: 'Cash Equiv.', OTHER: 'Other',
}

const ENTITY_OPTIONS = [
  { id: '00000000-0000-0000-0001-000000000001', name: 'JAG Holdings' },
  { id: '00000000-0000-0000-0001-000000000002', name: 'JABCO' },
  { id: '00000000-0000-0000-0001-000000000003', name: 'JAG Properties' },
  { id: '00000000-0000-0000-0001-000000000004', name: 'JAG Entertainment' },
  { id: '00000000-0000-0000-0001-000000000005', name: 'JAG Finance' },
  { id: '00000000-0000-0000-0001-000000000006', name: 'DragonBridge' },
]

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

function AddModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
        <h2 className="text-lg font-semibold mb-4 text-white">Add Investment</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Entity</label>
            <select value={form.owner_entity_id} onChange={set('owner_entity_id')} className={cls}>
              {ENTITY_OPTIONS.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Type</label>
              <select value={form.investment_type} onChange={set('investment_type')} className={cls}>
                {INVESTMENT_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="w-20">
              <label className="block text-xs text-slate-400 mb-1">Currency</label>
              <input maxLength={3} value={form.currency} onChange={set('currency')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Asset Name</label>
            <input value={form.asset_name} onChange={set('asset_name')} className={cls} placeholder="e.g. Angostura Holdings" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Institution</label>
              <input value={form.institution_name} onChange={set('institution_name')} className={cls} placeholder="e.g. BPTT Brokers" />
            </div>
            <div className="w-28">
              <label className="block text-xs text-slate-400 mb-1">Ticker</label>
              <input value={form.ticker_symbol} onChange={set('ticker_symbol')} className={cls} placeholder="AHL" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Current Value (TTD)</label>
              <input type="number" step="0.01" value={form.current_value_ttd} onChange={set('current_value_ttd')} className={cls} placeholder="0.00" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Cost Basis (TTD)</label>
              <input type="number" step="0.01" value={form.cost_basis_ttd} onChange={set('cost_basis_ttd')} className={cls} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Maturity Date (optional)</label>
            <input type="date" value={form.maturity_date} onChange={set('maturity_date')} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => mutate()}
            disabled={isPending || !form.asset_name || !form.current_value_ttd}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {isPending ? 'Saving…' : 'Add Investment'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function UpdateValueModal({ id, name, onClose, onUpdated }: { id: string; name: string; onClose: () => void; onUpdated: () => void }) {
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
        <h2 className="text-base font-semibold mb-4 text-white">Update Value — {name}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Current Value (TTD)</label>
            <input type="number" step="0.01" value={value} onChange={e => setValue(e.target.value)} className={cls} placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Unrealised Gain/Loss (TTD)</label>
            <input type="number" step="0.01" value={gain} onChange={e => setGain(e.target.value)} className={cls} placeholder="0.00 (optional)" />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => mutate()}
            disabled={isPending || !value}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {isPending ? 'Saving…' : 'Update'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function InvestmentsPanel() {
  const [showAdd, setShowAdd] = useState(false)
  const [updating, setUpdating] = useState<{ id: string; name: string } | null>(null)
  const qc = useQueryClient()

  const { data: investments = [], isLoading } = useQuery({
    queryKey: ['finance', 'investments'],
    queryFn: () => financeApi.getInvestments(),
  })

  const refresh = () => void qc.invalidateQueries({ queryKey: ['finance', 'investments'] })

  if (isLoading) return <p className="text-slate-400 text-sm">Loading…</p>

  const totalValue = investments.reduce((s, i) => s + parseFloat(i.current_value_ttd), 0)
  const totalGain = investments.reduce((s, i) => s + parseFloat(i.unrealised_gain_ttd ?? '0'), 0)

  // Group by entity
  const byEntity: Record<string, typeof investments> = {}
  for (const inv of investments) {
    ;(byEntity[inv.owner_entity_id] ??= []).push(inv)
  }

  return (
    <div>
      {/* Summary */}
      {investments.length > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-slate-800 rounded-lg p-4 border-l-4 border-blue-500">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Portfolio Value</p>
            <p className="text-lg font-semibold font-mono">{fmtTTD(String(totalValue))}</p>
          </div>
          <div className={`bg-slate-800 rounded-lg p-4 border-l-4 ${totalGain >= 0 ? 'border-green-500' : 'border-red-500'}`}>
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Unrealised Gain/Loss</p>
            <p className={`text-lg font-semibold font-mono ${totalGain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalGain >= 0 ? '+' : ''}{fmtTTD(String(totalGain))}
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
        >
          + Add Investment
        </button>
      </div>

      {investments.length === 0 && (
        <p className="text-slate-400 text-sm">No investments recorded.</p>
      )}

      {Object.entries(byEntity).sort(([a], [b]) => entityName(a).localeCompare(entityName(b))).map(([entityId, rows]) => (
        <div key={entityId} className="mb-6">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-2">{entityName(entityId)}</h3>
          <div className="rounded-lg overflow-hidden border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-2">Asset</th>
                  <th className="text-left px-4 py-2">Type</th>
                  <th className="text-left px-4 py-2">Institution</th>
                  <th className="text-right px-4 py-2">Value (TTD)</th>
                  <th className="text-right px-4 py-2">Gain/Loss</th>
                  <th className="text-right px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {rows.map(inv => {
                  const gain = parseFloat(inv.unrealised_gain_ttd ?? '0')
                  return (
                    <tr key={inv.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3 text-slate-100 font-medium">
                        {inv.asset_name}
                        {inv.ticker_symbol && <span className="ml-2 text-xs text-slate-500">{inv.ticker_symbol}</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-400">{TYPE_LABELS[inv.investment_type] ?? inv.investment_type}</td>
                      <td className="px-4 py-3 text-slate-400">{inv.institution_name ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-100">{fmtTTD(inv.current_value_ttd)}</td>
                      <td className={`px-4 py-3 text-right font-mono text-sm ${gain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {inv.unrealised_gain_ttd != null ? `${gain >= 0 ? '+' : ''}${fmtTTD(inv.unrealised_gain_ttd)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setUpdating({ id: inv.id, name: inv.asset_name })}
                          className="text-xs text-slate-500 hover:text-blue-400 transition-colors"
                        >
                          Update
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
      {updating && <UpdateValueModal id={updating.id} name={updating.name} onClose={() => setUpdating(null)} onUpdated={refresh} />}
    </div>
  )
}
