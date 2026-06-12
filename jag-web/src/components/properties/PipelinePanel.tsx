import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { propertiesApi } from '../../api/properties'
import { fmtTTD, fmtDate } from '../../lib/entities'
import type { PipelineItem, PipelineStage } from '../../types/properties'
import ConfirmDeleteModal from '../ui/ConfirmDeleteModal'

const PROP_TYPES = ['RESIDENTIAL', 'COMMERCIAL', 'LAND', 'MIXED', 'AGRICULTURAL'] as const
const SOURCES = ['AGENT', 'PRIVATE_SELLER', 'AUCTION', 'ONLINE_LISTING', 'REFERRAL', 'OTHER'] as const
const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

function AddDealModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', address: '',
    property_type: 'RESIDENTIAL' as typeof PROP_TYPES[number],
    asking_price: '', estimated_value: '', estimated_monthly_rent: '',
    stage: 'WATCH' as PipelineStage,
    source: '' as typeof SOURCES[number] | '',
    agent_name: '', agent_phone: '',
    analysis_notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.createPipelineItem({
      name: form.name,
      address: form.address || undefined,
      property_type: form.property_type,
      asking_price: form.asking_price ? Number(form.asking_price) : undefined,
      estimated_value: form.estimated_value ? Number(form.estimated_value) : undefined,
      estimated_monthly_rent: form.estimated_monthly_rent ? Number(form.estimated_monthly_rent) : undefined,
      stage: form.stage,
      source: form.source || undefined,
      agent_name: form.agent_name || undefined,
      agent_phone: form.agent_phone || undefined,
      analysis_notes: form.analysis_notes || undefined,
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">Add Pipeline Deal</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Name / Description *</label>
            <input value={form.name} onChange={set('name')} className={cls} placeholder="e.g. Chaguanas Residential 3BR" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Address</label>
            <input value={form.address} onChange={set('address')} className={cls} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Property Type</label>
              <select value={form.property_type} onChange={set('property_type')} className={cls}>
                {PROP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Stage</label>
              <select value={form.stage} onChange={set('stage')} className={cls}>
                {['WATCH','INTERESTED','OFFER_MADE','DUE_DILIGENCE','CONTRACT','ACQUIRED','PASSED'].map(s =>
                  <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
                )}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Asking Price (TTD)</label>
              <input type="number" step="0.01" value={form.asking_price} onChange={set('asking_price')} className={cls} placeholder="0.00" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Est. Value (TTD)</label>
              <input type="number" step="0.01" value={form.estimated_value} onChange={set('estimated_value')} className={cls} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Est. Monthly Rent (TTD)</label>
            <input type="number" step="0.01" value={form.estimated_monthly_rent} onChange={set('estimated_monthly_rent')} className={cls} placeholder="0.00" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Source</label>
              <select value={form.source} onChange={set('source')} className={cls}>
                <option value="">— none —</option>
                {SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Agent Name</label>
              <input value={form.agent_name} onChange={set('agent_name')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Agent Phone</label>
              <input value={form.agent_phone} onChange={set('agent_phone')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Analysis Notes</label>
            <textarea value={form.analysis_notes} onChange={set('analysis_notes')} rows={3} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => mutate()}
            disabled={isPending || !form.name}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {isPending ? 'Saving…' : 'Add Deal'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

const STAGES: { id: PipelineStage; label: string; color: string }[] = [
  { id: 'WATCH',         label: 'Watch',         color: 'border-slate-500 text-slate-400' },
  { id: 'INTERESTED',    label: 'Interested',    color: 'border-blue-500 text-blue-400' },
  { id: 'OFFER_MADE',    label: 'Offer Made',    color: 'border-yellow-500 text-yellow-400' },
  { id: 'DUE_DILIGENCE', label: 'Due Diligence', color: 'border-orange-500 text-orange-400' },
  { id: 'CONTRACT',      label: 'Contract',      color: 'border-purple-500 text-purple-400' },
  { id: 'ACQUIRED',      label: 'Acquired',      color: 'border-green-500 text-green-400' },
  { id: 'PASSED',        label: 'Passed',        color: 'border-red-800 text-red-700' },
]

const STAGE_MAP = Object.fromEntries(STAGES.map(s => [s.id, s]))

function PipelineCard({ item, onStageChange, onDeleteClick }: {
  item: PipelineItem
  onStageChange: (id: string, stage: string) => void
  onDeleteClick: (item: PipelineItem) => void
}) {
  const stage = STAGE_MAP[item.stage]
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <div className="flex justify-between items-start mb-2">
        <h3 className="text-sm font-medium text-slate-100 flex-1 pr-2">{item.name}</h3>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded border ${stage?.color ?? ''}`}>{stage?.label ?? item.stage}</span>
          <button
            onClick={() => onDeleteClick(item)}
            className="text-slate-700 hover:text-red-400 transition-colors text-sm leading-none"
            title="Delete deal"
          >&#x1F5D1;</button>
        </div>
      </div>

      {item.address && <p className="text-xs text-slate-400 mb-2">{item.address}</p>}

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">
        <span className="text-slate-400">Type: <span className="text-slate-200">{item.property_type}</span></span>
        {item.asking_price && <span className="text-slate-400">Asking: <span className="text-slate-200 font-mono">{fmtTTD(item.asking_price)}</span></span>}
        {item.estimated_value && <span className="text-slate-400">Value: <span className="text-slate-200 font-mono">{fmtTTD(item.estimated_value)}</span></span>}
        {item.estimated_monthly_rent && <span className="text-slate-400">Rent: <span className="text-slate-200 font-mono">{fmtTTD(item.estimated_monthly_rent)}/mo</span></span>}
        {item.gross_yield_percent && <span className="text-slate-400">Yield: <span className="text-green-400 font-mono">{parseFloat(item.gross_yield_percent).toFixed(2)}%</span></span>}
        {item.agent_name && <span className="text-slate-400">Agent: <span className="text-slate-200">{item.agent_name}</span></span>}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {STAGES.filter(s => s.id !== item.stage && s.id !== 'ACQUIRED').slice(0, 3).map(s => (
          <button
            key={s.id}
            onClick={() => onStageChange(item.id, s.id)}
            className="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
          >
            → {s.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-600 mt-2">Updated {fmtDate(item.last_modified_at)}</p>
    </div>
  )
}

export default function PipelinePanel() {
  const [stageFilter, setStageFilter] = useState<PipelineStage | 'ALL'>('ALL')
  const [showAdd, setShowAdd] = useState(false)
  const [deletingItem, setDeletingItem] = useState<PipelineItem | null>(null)
  const qc = useQueryClient()

  const { data: pipeline = [], isLoading } = useQuery({
    queryKey: ['properties', 'pipeline', stageFilter],
    queryFn: () => propertiesApi.getPipeline(stageFilter !== 'ALL' ? { stage: stageFilter } : undefined),
  })

  const { mutate: updateStage } = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) => propertiesApi.updatePipelineStage(id, stage),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['properties', 'pipeline'] }),
  })

  // Group by stage for kanban-style display
  const grouped = STAGES.reduce<Record<string, PipelineItem[]>>((acc, s) => {
    acc[s.id] = pipeline.filter(p => p.stage === s.id)
    return acc
  }, {})

  const activeStages = STAGES.filter(s => (grouped[s.id]?.length ?? 0) > 0 || stageFilter === s.id)

  const refresh = () => void qc.invalidateQueries({ queryKey: ['properties', 'pipeline'] })

  return (
    <div>
      {/* Stage filter tabs */}
      <div className="flex gap-1 mb-6 flex-wrap items-center">
        <button
          onClick={() => setStageFilter('ALL')}
          className={`px-3 py-1 text-xs rounded border transition-colors ${
            stageFilter === 'ALL' ? 'border-blue-500 text-blue-400 bg-blue-900/20' : 'border-slate-600 text-slate-400 hover:text-slate-200'
          }`}
        >
          All ({pipeline.length})
        </button>
        {STAGES.map(s => (
          <button
            key={s.id}
            onClick={() => setStageFilter(s.id)}
            className={`px-3 py-1 text-xs rounded border transition-colors ${
              stageFilter === s.id ? `border-current ${s.color} opacity-100` : 'border-slate-600 text-slate-400 hover:text-slate-200'
            }`}
          >
            {s.label} {grouped[s.id]?.length ? `(${grouped[s.id].length})` : ''}
          </button>
        ))}
      </div>

      <button
        onClick={() => setShowAdd(true)}
        className="ml-auto px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
      >
        + Add Deal
      </button>

      {isLoading && <p className="text-slate-400 text-sm">Loading…</p>}

      {!isLoading && pipeline.length === 0 && (
        <p className="text-slate-500 text-sm">No pipeline items found.</p>
      )}

      {/* Flat list when filtering by stage */}
      {stageFilter !== 'ALL' && pipeline.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {pipeline.map(item => (
            <PipelineCard key={item.id} item={item} onStageChange={(id, stage) => updateStage({ id, stage })} onDeleteClick={setDeletingItem} />
          ))}
        </div>
      )}

      {/* Grouped kanban when showing all */}
      {stageFilter === 'ALL' && activeStages.length > 0 && (
        <div className="space-y-6">
          {activeStages.map(s => (
            <div key={s.id}>
              <h3 className={`text-xs font-bold uppercase tracking-widest mb-3 ${s.color.split(' ')[1]}`}>
                {s.label} ({grouped[s.id]?.length ?? 0})
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {(grouped[s.id] ?? []).map(item => (
                  <PipelineCard key={item.id} item={item} onStageChange={(id, stage) => updateStage({ id, stage })} onDeleteClick={setDeletingItem} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddDealModal onClose={() => setShowAdd(false)} onCreated={refresh} />}

      {deletingItem && (
        <ConfirmDeleteModal
          label={deletingItem.name}
          onConfirm={() => propertiesApi.deletePipelineItem(deletingItem.id).then(() => {
            void qc.invalidateQueries({ queryKey: ['properties', 'pipeline'] })
          })}
          onClose={() => setDeletingItem(null)}
        />
      )}
    </div>
  )
}
