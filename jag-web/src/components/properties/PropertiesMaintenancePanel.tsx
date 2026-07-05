import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'
import { propertiesApi } from '../../api/properties'
import type { Property, Unit } from '../../types/properties'

const CATEGORIES = [
  'PLUMBING','ELECTRICAL','HVAC','APPLIANCE','STRUCTURAL','ROOFING','PAINTING',
  'FLOORING','DOORS_WINDOWS','LOCKS_KEYS','PEST','SECURITY','GARDEN','FENCING',
  'DRAINAGE','WASTE_DISPOSAL','SMOKE_DETECTOR','CLEANING','OTHER',
]

const PRIORITY_COLORS: Record<string, string> = {
  P1: 'bg-red-900/70 text-red-200 border-red-600',
  P2: 'bg-orange-900/50 text-orange-300 border-orange-700',
  P3: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  P4: 'bg-slate-700 text-slate-400 border-slate-600',
}

const STATUS_COLORS: Record<string, string> = {
  OPEN:          'bg-red-900/50 text-red-300 border-red-700',
  ASSIGNED:      'bg-blue-900/50 text-blue-300 border-blue-700',
  IN_PROGRESS:   'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  PENDING_PARTS: 'bg-orange-900/50 text-orange-300 border-orange-700',
  RESOLVED:      'bg-green-900/50 text-green-300 border-green-700',
  CLOSED:        'bg-slate-700 text-slate-500 border-slate-600',
  CANCELLED:     'bg-slate-700 text-slate-500 border-slate-600',
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function PropertiesMaintenancePanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ property_id: '', unit_id: '', category: 'OTHER', description: '', priority: '', reported_by_name: '', reported_by_phone: '', report_channel: 'PORTAL' })
  const [resolveForm, setResolveForm] = useState({ resolution_notes: '', cost_ttd: '' })
  const [showResolve, setShowResolve] = useState(false)

  const { data: tickets = [] } = useQuery({
    queryKey: ['maintenance', statusFilter, priorityFilter],
    queryFn: () => tenancyApi.getMaintenanceTickets({ status: statusFilter || undefined, priority: priorityFilter || undefined }),
  })

  const { data: detail } = useQuery({
    queryKey: ['maintenance-ticket', selected],
    queryFn: () => tenancyApi.getMaintenanceTicket(selected!),
    enabled: !!selected,
  })

  const createMut = useMutation({
    mutationFn: () => tenancyApi.createMaintenanceTicket({
      ...form,
      unit_id: form.unit_id || undefined,
      priority: form.priority || undefined,
    }),
    onSuccess: () => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['maintenance'] }) },
  })

  const patchMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => tenancyApi.patchMaintenanceTicket(selected!, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['maintenance'] }); qc.invalidateQueries({ queryKey: ['maintenance-ticket', selected] }) },
  })

  const resolveMut = useMutation({
    mutationFn: () => tenancyApi.resolveTicket(selected!, { resolution_notes: resolveForm.resolution_notes, cost_ttd: resolveForm.cost_ttd ? parseFloat(resolveForm.cost_ttd) : undefined }),
    onSuccess: () => { setShowResolve(false); qc.invalidateQueries({ queryKey: ['maintenance'] }); qc.invalidateQueries({ queryKey: ['maintenance-ticket', selected] }) },
  })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  const { data: contractors = [] } = useQuery({
    queryKey: ['contractors'],
    queryFn: () => tenancyApi.getContractors(),
    staleTime: 5 * 60_000,
  })

  const { data: properties = [] } = useQuery({
    queryKey: ['properties-picker'],
    queryFn: () => propertiesApi.getProperties({ limit: 500 }),
    enabled: showCreate,
    staleTime: 60_000,
  })

  const { data: propertyUnits = [] } = useQuery({
    queryKey: ['properties', form.property_id, 'units-picker'],
    queryFn: () => propertiesApi.getUnits(form.property_id),
    enabled: showCreate && !!form.property_id,
    staleTime: 60_000,
  })

  return (
    <div className="flex gap-4 h-[700px]">
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <select className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">{t('tenancy.allStatuses','All statuses')}</option>
            {['OPEN','ASSIGNED','IN_PROGRESS','PENDING_PARTS','RESOLVED','CLOSED','CANCELLED'].map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
          </select>
          <select className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
            <option value="">{t('tenancy.allPriorities','All priorities')}</option>
            {['P1','P2','P3','P4'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={() => setShowCreate(true)} className="ml-auto px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded">
            + {t('tenancy.newTicket','New Ticket')}
          </button>
        </div>

        {tickets.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">{t('tenancy.noTickets','No maintenance tickets.')}</p>}
        {tickets.map((tk: Record<string, unknown>) => (
          <div key={String(tk['id'])} onClick={() => setSelected(String(tk['id']))}
            className={`p-3 rounded border mb-2 cursor-pointer transition-colors ${selected === String(tk['id']) ? 'border-blue-500 bg-slate-700' : 'border-slate-700 bg-slate-800 hover:bg-slate-750'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded border font-bold ${PRIORITY_COLORS[String(tk['priority'])] ?? ''}`}>{String(tk['priority'])}</span>
                  <span className="text-xs text-slate-500 font-mono">{String(tk['ticket_ref'])}</span>
                  {Boolean(tk['sla_breached']) && <span className="text-xs text-red-400 font-semibold">SLA BREACH</span>}
                </div>
                <p className="text-sm text-slate-200 mt-1 truncate">{String(tk['description'])}</p>
                <p className="text-xs text-slate-400">{tk['unit_number'] ? `Unit ${String(tk['unit_number'])}` : String(tk['property_name'] ?? '—')} · {String(tk['category'])} · {String(tk['reported_by_name'] ?? '')}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 ${STATUS_COLORS[String(tk['status'])] ?? ''}`}>{String(tk['status']).replace(/_/g,' ')}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="w-96 border-l border-slate-700 pl-4 overflow-y-auto">
        {!selected && <p className="text-sm text-slate-500 mt-8 text-center">{t('tenancy.selectTicket','Select a ticket.')}</p>}
        {detail && (
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded border font-bold ${PRIORITY_COLORS[String(detail['priority'])] ?? ''}`}>{String(detail['priority'])}</span>
                <span className="text-xs text-slate-500 font-mono">{String(detail['ticket_ref'])}</span>
              </div>
              <p className="text-sm text-slate-200 mt-2">{String(detail['description'])}</p>
              <p className="text-xs text-slate-400 mt-1">{String(detail['category'])} · {detail['unit_number'] ? `Unit ${String(detail['unit_number'])}` : String(detail['property_name'] ?? '—')}</p>
              {Boolean(detail['contractor_name']) && <p className="text-xs text-slate-400">Contractor: {String(detail['contractor_name'])}</p>}
            </div>
            <div className="flex gap-2 flex-wrap">
              <select className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100"
                value={String(detail['status'])} onChange={e => patchMut.mutate({ status: e.target.value })}>
                {['OPEN','ASSIGNED','IN_PROGRESS','PENDING_PARTS','RESOLVED','CLOSED','CANCELLED'].map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
              </select>
              {!['RESOLVED','CLOSED','CANCELLED'].includes(String(detail['status'])) && (
                <button onClick={() => setShowResolve(true)} className="px-2 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded">
                  {t('tenancy.resolve','Resolve')}
                </button>
              )}
            </div>
            {/* Contractor assignment */}
            <div className="space-y-2 border-t border-slate-700 pt-3">
              <p className="text-xs font-medium text-slate-400">{t('tenancy.contractorAssign', 'Contractor Assignment')}</p>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('tenancy.contractor', 'Contractor')}</label>
                <select className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100"
                  value={String(detail['contractor_id'] ?? '')}
                  onChange={e => patchMut.mutate({ contractor_id: e.target.value || null })}>
                  <option value="">{t('tenancy.noContractor', '— Not assigned —')}</option>
                  {contractors.map((c: Record<string, unknown>) => (
                    <option key={String(c['id'])} value={String(c['id'])}>
                      {String(c['name'])} · {String(c['trade'])} {c['phone'] ? `· ${c['phone']}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('tenancy.scheduledVisit', 'Scheduled Visit')}</label>
                <input type="datetime-local" className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100"
                  value={detail['estimated_visit_at'] ? String(detail['estimated_visit_at']).slice(0, 16) : ''}
                  onChange={e => patchMut.mutate({ estimated_visit_at: e.target.value || null })} />
              </div>
            </div>

            <div>
              <p className="text-xs text-slate-500 mb-1">{t('tenancy.updates','Updates')}</p>
              {((detail['updates'] as unknown[]) ?? []).map((upd: unknown) => {
                const u = upd as Record<string, unknown>
                return (
                  <div key={String(u['id'])} className="text-xs text-slate-400 border-l-2 border-slate-600 pl-2 mb-1">
                    <span className="text-slate-500">{new Date(String(u['created_at'])).toLocaleDateString('en-TT')}</span>
                    {Boolean(u['status_from']) && <span> {String(u['status_from'])} → {String(u['status_to'])}</span>}
                    {Boolean(u['note']) && <p className="text-slate-300">{String(u['note'])}</p>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md overflow-y-auto max-h-[90vh]">
            <h2 className="text-lg font-semibold mb-4">{t('tenancy.newTicket','New Maintenance Ticket')}</h2>
            <div className="space-y-3">
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.property','Property')}</label>
                <select className={cls} value={form.property_id}
                  onChange={e => setForm(f => ({ ...f, property_id: e.target.value, unit_id: '' }))}>
                  <option value="">{t('tenancy.selectProperty','— Select property —')}</option>
                  {properties.map((p: Property) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.unit','Unit (leave blank for a whole-building issue)')}</label>
                <select className={cls} value={form.unit_id} onChange={set('unit_id')} disabled={!form.property_id}>
                  <option value="">{t('tenancy.noUnit','— Whole building / no specific unit —')}</option>
                  {propertyUnits.map((u: Unit) => (
                    <option key={u.id} value={u.id}>{u.unit_number}</option>
                  ))}
                </select>
              </div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.category','Category')}</label>
                <select className={cls} value={form.category} onChange={set('category')}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.description','Description')}</label><textarea className={cls} rows={3} value={form.description} onChange={set('description')} /></div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.reportedBy','Reported By')}</label><input className={cls} value={form.reported_by_name} onChange={set('reported_by_name')} /></div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.phone','Phone')}</label><input className={cls} value={form.reported_by_phone} onChange={set('reported_by_phone')} /></div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel','Cancel')}</button>
              <button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.property_id || !form.description}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
                {createMut.isPending ? t('common.saving','Saving...') : t('common.save','Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showResolve && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">{t('tenancy.resolveTicket','Resolve Ticket')}</h2>
            <div className="space-y-3">
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.resolutionNotes','Resolution Notes')}</label><textarea className={cls} rows={3} value={resolveForm.resolution_notes} onChange={e => setResolveForm(f => ({ ...f, resolution_notes: e.target.value }))} /></div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.costTtd','Cost TTD')}</label><input type="number" className={cls} value={resolveForm.cost_ttd} onChange={e => setResolveForm(f => ({ ...f, cost_ttd: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowResolve(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel','Cancel')}</button>
              <button onClick={() => resolveMut.mutate()} disabled={resolveMut.isPending || !resolveForm.resolution_notes}
                className="px-4 py-2 text-sm bg-green-700 hover:bg-green-600 text-white rounded disabled:opacity-40">
                {resolveMut.isPending ? t('common.saving','Saving...') : t('tenancy.markResolved','Mark Resolved')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
