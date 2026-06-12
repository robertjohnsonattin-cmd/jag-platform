import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '../../api/finance'
import { entityName, fmtTTD, fmtDate } from '../../lib/entities'
import type { IntercompanyChargeType, IntercompanyChargeStatus } from '../../types/finance'

// ── Constants ─────────────────────────────────────────────────────────────────

const CHARGE_TYPES: IntercompanyChargeType[] = [
  'MANAGEMENT_FEE','LOAN_INTEREST','SHARED_SERVICE','DIVIDEND','RENT','RECHARGE','OTHER',
]
const CHARGE_TYPE_LABELS: Record<IntercompanyChargeType, string> = {
  MANAGEMENT_FEE: 'Management Fee', LOAN_INTEREST: 'Loan Interest',
  SHARED_SERVICE: 'Shared Service', DIVIDEND: 'Dividend',
  RENT: 'Rent', RECHARGE: 'Recharge', OTHER: 'Other',
}
const STATUS_STYLES: Record<IntercompanyChargeStatus, string> = {
  DRAFT:      'bg-slate-700 text-slate-300 border border-slate-600',
  POSTED:     'bg-blue-900/50 text-blue-300 border border-blue-700',
  ELIMINATED: 'bg-emerald-900/50 text-emerald-300 border border-emerald-700',
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

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

// ── Create Charge Modal ───────────────────────────────────────────────────────

function CreateChargeModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    from_entity_id: ENTITY_OPTIONS[0].id,
    to_entity_id: ENTITY_OPTIONS[1].id,
    charge_date: today,
    description: '',
    charge_type: 'MANAGEMENT_FEE' as IntercompanyChargeType,
    amount_ttd: '',
    notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => financeApi.createCharge({
      from_entity_id: form.from_entity_id,
      to_entity_id: form.to_entity_id,
      charge_date: form.charge_date,
      description: form.description,
      charge_type: form.charge_type,
      amount_ttd: Number(form.amount_ttd),
      notes: form.notes || undefined,
      idempotency_key: uuidv4(),
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  const sameEntity = form.from_entity_id === form.to_entity_id
  const valid = form.description && form.amount_ttd && !sameEntity

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">Create Intercompany Charge</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Charge Type</label>
            <select value={form.charge_type} onChange={set('charge_type')} className={cls}>
              {CHARGE_TYPES.map(t => <option key={t} value={t}>{CHARGE_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">From (billing entity)</label>
              <select value={form.from_entity_id} onChange={set('from_entity_id')} className={cls}>
                {ENTITY_OPTIONS.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">To (receiving entity)</label>
              <select value={form.to_entity_id} onChange={set('to_entity_id')} className={cls}>
                {ENTITY_OPTIONS.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
          </div>
          {sameEntity && <p className="text-yellow-400 text-xs">From and To must be different entities.</p>}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Date</label>
            <input type="date" value={form.charge_date} onChange={set('charge_date')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Description</label>
            <input value={form.description} onChange={set('description')} className={cls} placeholder="e.g. Monthly management fee — June 2026" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Amount (TTD)</label>
            <input type="number" step="0.01" value={form.amount_ttd} onChange={set('amount_ttd')} className={cls} placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes (optional)</label>
            <textarea rows={2} value={form.notes} onChange={set('notes')} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !valid} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">{isPending ? 'Saving…' : 'Create (Draft)'}</button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Consolidated View ─────────────────────────────────────────────────────────

function ConsolidatedView() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [month, setMonth] = useState<number | undefined>()

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'intercompany', 'consolidated', year, month],
    queryFn: () => financeApi.getConsolidated({ period_year: year, period_month: month }),
  })

  return (
    <div>
      <div className="flex gap-3 mb-4 items-center">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Year</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-300 focus:outline-none">
            {[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Month (optional)</label>
          <select value={month ?? ''} onChange={e => setMonth(e.target.value ? Number(e.target.value) : undefined)} className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-300 focus:outline-none">
            <option value="">Full Year</option>
            {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
              <option key={i+1} value={i+1}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && <p className="text-slate-400 text-sm">Loading…</p>}
      {data && (
        <div>
          {!data.fdw_available && (
            <p className="text-yellow-400 text-xs mb-3">⚠️ FDW not configured — showing JAG Holdings GL data only. Run 005b_fdw_setup.sql to enable cross-entity view.</p>
          )}

          {data.entities.length === 0 && <p className="text-slate-500 text-sm">No GL data for this period.</p>}

          {data.entities.length > 0 && (
            <div className="rounded-lg overflow-hidden border border-slate-700 mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                    <th className="text-left px-4 py-2">Entity</th>
                    <th className="text-right px-4 py-2">Revenue</th>
                    <th className="text-right px-4 py-2">Expenses</th>
                    <th className="text-right px-4 py-2">Net Income</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {data.entities.map((e, i) => {
                    const net = parseFloat(e.net_income_ttd)
                    return (
                      <tr key={i} className="hover:bg-slate-700/30">
                        <td className="px-4 py-3 text-slate-100">{entityName(e.entity_id)}</td>
                        <td className="px-4 py-3 text-right font-mono text-green-400">{fmtTTD(e.revenue_ttd)}</td>
                        <td className="px-4 py-3 text-right font-mono text-red-400">{fmtTTD(e.expenses_ttd)}</td>
                        <td className={`px-4 py-3 text-right font-mono font-semibold ${net >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmtTTD(e.net_income_ttd)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data.eliminations.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Eliminated Intercompany Charges</h4>
              <div className="rounded-lg overflow-hidden border border-slate-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                      <th className="text-left px-4 py-2">From</th>
                      <th className="text-left px-4 py-2">To</th>
                      <th className="text-right px-4 py-2">Eliminated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {data.eliminations.map((el, i) => (
                      <tr key={i} className="hover:bg-slate-700/30">
                        <td className="px-4 py-3 text-slate-300">{entityName(el.from_entity_id)}</td>
                        <td className="px-4 py-3 text-slate-300">{entityName(el.to_entity_id)}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-400">({fmtTTD(el.eliminated_ttd)})</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-700/30 font-semibold">
                      <td colSpan={2} className="px-4 py-2 text-slate-300 text-xs uppercase">Total Eliminated</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-300">({fmtTTD(data.total_eliminated_ttd)})</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function IntercompanyPanel() {
  const [tab, setTab] = useState<'charges' | 'consolidated'>('charges')
  const [showCreate, setShowCreate] = useState(false)
  const [filterStatus, setFilterStatus] = useState<IntercompanyChargeStatus | ''>('')
  const qc = useQueryClient()

  const { data: charges = [], isLoading } = useQuery({
    queryKey: ['finance', 'intercompany', 'charges', filterStatus],
    queryFn: () => financeApi.getCharges(filterStatus ? { status: filterStatus as IntercompanyChargeStatus } : {}),
  })

  const refresh = () => void qc.invalidateQueries({ queryKey: ['finance', 'intercompany'] })

  const totalDraft    = charges.filter(c => c.status === 'DRAFT').reduce((s, c) => s + parseFloat(c.amount_ttd), 0)
  const totalPosted   = charges.filter(c => c.status === 'POSTED').reduce((s, c) => s + parseFloat(c.amount_ttd), 0)
  const totalEliminated = charges.filter(c => c.status === 'ELIMINATED').reduce((s, c) => s + parseFloat(c.amount_ttd), 0)

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex gap-1 mb-5 border-b border-slate-700">
        {(['charges', 'consolidated'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${tab === t ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {t === 'consolidated' ? 'Consolidated P&L' : 'Charges'}
          </button>
        ))}
      </div>

      {tab === 'charges' && (
        <div>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div className="bg-slate-800 rounded-lg p-4 border-l-4 border-slate-500">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Draft</p>
              <p className="text-sm font-mono font-semibold text-slate-200">{fmtTTD(String(totalDraft))}</p>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border-l-4 border-blue-500">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Posted (pending elimination)</p>
              <p className="text-sm font-mono font-semibold text-blue-300">{fmtTTD(String(totalPosted))}</p>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border-l-4 border-emerald-500">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Eliminated</p>
              <p className="text-sm font-mono font-semibold text-emerald-300">{fmtTTD(String(totalEliminated))}</p>
            </div>
          </div>

          {/* Filters + Add */}
          <div className="flex gap-3 mb-4 items-center">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as IntercompanyChargeStatus | '')} className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-300 focus:outline-none">
              <option value="">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="POSTED">Posted</option>
              <option value="ELIMINATED">Eliminated</option>
            </select>
            <div className="ml-auto">
              <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">+ New Charge</button>
            </div>
          </div>

          {isLoading && <p className="text-slate-400 text-sm">Loading…</p>}
          {!isLoading && charges.length === 0 && <p className="text-slate-500 text-sm">No intercompany charges found.</p>}

          {charges.length > 0 && (
            <div className="rounded-lg overflow-hidden border border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-left px-4 py-2">From → To</th>
                    <th className="text-left px-4 py-2">Type</th>
                    <th className="text-left px-4 py-2">Description</th>
                    <th className="text-right px-4 py-2">Amount</th>
                    <th className="text-right px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {charges.map(c => (
                    <tr key={c.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{fmtDate(c.charge_date)}</td>
                      <td className="px-4 py-3">
                        <span className="text-slate-200 text-xs">{entityName(c.from_entity_id)}</span>
                        <span className="text-slate-500 mx-1">→</span>
                        <span className="text-slate-200 text-xs">{entityName(c.to_entity_id)}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{CHARGE_TYPE_LABELS[c.charge_type]}</td>
                      <td className="px-4 py-3 text-slate-300 text-xs max-w-xs truncate">{c.description}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-100">{fmtTTD(c.amount_ttd)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[c.status]}`}>{c.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-600 mt-3">To post or eliminate a charge, use the GL → Journal Entries workflow to create the offsetting entries, then mark the charge via the API. Full UI workflow coming in a future session.</p>
        </div>
      )}

      {tab === 'consolidated' && <ConsolidatedView />}

      {showCreate && <CreateChargeModal onClose={() => setShowCreate(false)} onCreated={refresh} />}
    </div>
  )
}
