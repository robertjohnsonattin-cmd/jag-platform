import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'
import { propertiesApi } from '../../api/properties'
import type { Property, Unit } from '../../types/properties'

const FREQUENCIES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL', 'ONE_TIME']
const PRIORITIES = ['LOW', 'MED', 'HIGH']
const RESPONSIBLES = ['IN_HOUSE', 'CONTRACTOR', 'TENANT', 'OFFICE']
const CATEGORY_OPTIONS = ['Preventive', 'Servicing', 'Inspection', 'Seasonal', 'Compliance', 'Safety', 'Security']

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: 'bg-red-900/50 text-red-300 border-red-700',
  MED:  'bg-amber-900/50 text-amber-300 border-amber-700',
  LOW:  'bg-slate-700 text-slate-400 border-slate-600',
}

const RESPONSIBLE_LABELS: Record<string, string> = {
  IN_HOUSE: 'In-house', CONTRACTOR: 'Contractor', TENANT: 'Tenant', OFFICE: 'Office',
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:    'bg-blue-900/50 text-blue-300 border-blue-700',
  PAUSED:    'bg-slate-700 text-slate-400 border-slate-600',
  COMPLETED: 'bg-green-900/50 text-green-300 border-green-700',
  CANCELLED: 'bg-slate-700 text-slate-500 border-slate-600',
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

function nextMonday(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  const day = d.getDay() // 0=Sun..6=Sat
  const add = day === 1 ? 0 : ((8 - day) % 7 || 7)
  d.setDate(d.getDate() + add)
  return d.toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  // next_due_date can arrive as a full ISO timestamp (e.g. "2026-08-10T00:00:00.000Z");
  // take just the date part so the constructed string stays valid (else -> NaN).
  const due = new Date(`${dateStr.slice(0, 10)}T00:00:00`)
  return Math.ceil((due.getTime() - today.getTime()) / 86_400_000)
}

function DueBadge({ dateStr, status }: { dateStr: string; status: string }) {
  const { t } = useTranslation()
  if (status !== 'ACTIVE') return null
  const days = daysUntil(dateStr)
  const style =
    days < 0  ? 'bg-red-900/50 text-red-300 border-red-700' :
    days <= 7 ? 'bg-amber-900/50 text-amber-300 border-amber-700' :
    'bg-slate-700 text-slate-400 border-slate-600'
  const label =
    days < 0  ? t('tenancy.sched.overdue', 'Overdue {{days}}d', { days: Math.abs(days) }) :
    days === 0 ? t('tenancy.sched.dueToday', 'Due today') :
    t('tenancy.sched.dueIn', 'Due in {{days}}d', { days })
  return <span className={`text-xs px-1.5 py-0.5 rounded border ${style}`}>{label}</span>
}

export default function PropertiesScheduledMaintenancePanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('ACTIVE')
  const [showCreate, setShowCreate] = useState(false)
  const [showComplete, setShowComplete] = useState(false)
  const [form, setForm] = useState({
    property_id: '', unit_id: '', title: '', description: '', frequency: 'MONTHLY',
    next_due_date: '', assigned_contractor_id: '', estimated_cost_ttd: '', notes: '',
    category: '', priority: 'MED', responsible: 'IN_HOUSE', trade: '', est_hours: '',
  })
  const [showPrint, setShowPrint] = useState(false)
  const [printForm, setPrintForm] = useState({
    mode: 'WEEKLY' as 'WEEKLY' | 'DAILY',
    start_date: nextMonday(),
    weeks: '1',
    property_id: '',
  })
  const [printing, setPrinting] = useState(false)
  const [completeForm, setCompleteForm] = useState({
    completed_date: new Date().toISOString().slice(0, 10), actual_cost_ttd: '', completed_by: '', notes: '',
  })

  const { data: tasks = [] } = useQuery({
    queryKey: ['scheduled-maintenance', statusFilter],
    queryFn: () => tenancyApi.getScheduledMaintenance({ status: statusFilter || undefined }),
  })

  const { data: detail } = useQuery({
    queryKey: ['scheduled-maintenance-task', selected],
    queryFn: () => tenancyApi.getScheduledMaintenanceTask(selected!),
    enabled: !!selected,
  })

  const { data: contractors = [] } = useQuery({
    queryKey: ['contractors'],
    queryFn: () => tenancyApi.getContractors(),
    staleTime: 5 * 60_000,
  })

  const { data: properties = [] } = useQuery({
    queryKey: ['properties-picker'],
    queryFn: () => propertiesApi.getProperties({ limit: 500 }),
    enabled: showCreate || showPrint,
    staleTime: 60_000,
  })

  const { data: propertyUnits = [] } = useQuery({
    queryKey: ['properties', form.property_id, 'units-picker'],
    queryFn: () => propertiesApi.getUnits(form.property_id),
    enabled: showCreate && !!form.property_id,
    staleTime: 60_000,
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const setPrint = (k: keyof typeof printForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setPrintForm(f => ({ ...f, [k]: e.target.value }))

  const runPrint = async () => {
    setPrinting(true)
    try {
      const from = printForm.start_date
      const to = printForm.mode === 'DAILY'
        ? printForm.start_date
        : addDays(printForm.start_date, Math.max(1, Number(printForm.weeks) || 1) * 7 - 1)
      const occurrences = await tenancyApi.getScheduledMaintenanceOccurrences({
        from, to, property_id: printForm.property_id || undefined,
      })
      printMaintenanceSchedule(occurrences as Record<string, unknown>[], from, to)
      setShowPrint(false)
    } finally {
      setPrinting(false)
    }
  }

  const createMut = useMutation({
    mutationFn: () => tenancyApi.createScheduledMaintenance({
      property_id: form.property_id,
      unit_id: form.unit_id || undefined,
      title: form.title,
      description: form.description || undefined,
      frequency: form.frequency,
      next_due_date: form.next_due_date,
      assigned_contractor_id: form.assigned_contractor_id || undefined,
      estimated_cost_ttd: form.estimated_cost_ttd ? parseFloat(form.estimated_cost_ttd) : undefined,
      notes: form.notes || undefined,
      category: form.category || undefined,
      priority: form.priority || undefined,
      responsible: form.responsible || undefined,
      trade: form.trade || undefined,
      est_hours: form.est_hours ? parseFloat(form.est_hours) : undefined,
    }),
    onSuccess: () => {
      setShowCreate(false)
      setForm({
        property_id: '', unit_id: '', title: '', description: '', frequency: 'MONTHLY',
        next_due_date: '', assigned_contractor_id: '', estimated_cost_ttd: '', notes: '',
        category: '', priority: 'MED', responsible: 'IN_HOUSE', trade: '', est_hours: '',
      })
      void qc.invalidateQueries({ queryKey: ['scheduled-maintenance'] })
    },
  })

  const patchMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => tenancyApi.patchScheduledMaintenance(selected!, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scheduled-maintenance'] })
      void qc.invalidateQueries({ queryKey: ['scheduled-maintenance-task', selected] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => tenancyApi.deleteScheduledMaintenance(selected!),
    onSuccess: () => {
      setSelected(null)
      void qc.invalidateQueries({ queryKey: ['scheduled-maintenance'] })
    },
  })

  const completeMut = useMutation({
    mutationFn: () => tenancyApi.completeScheduledMaintenance(selected!, {
      completed_date: completeForm.completed_date,
      actual_cost_ttd: completeForm.actual_cost_ttd ? parseFloat(completeForm.actual_cost_ttd) : undefined,
      completed_by: completeForm.completed_by || undefined,
      notes: completeForm.notes || undefined,
    }),
    onSuccess: () => {
      setShowComplete(false)
      setCompleteForm({ completed_date: new Date().toISOString().slice(0, 10), actual_cost_ttd: '', completed_by: '', notes: '' })
      void qc.invalidateQueries({ queryKey: ['scheduled-maintenance'] })
      void qc.invalidateQueries({ queryKey: ['scheduled-maintenance-task', selected] })
    },
  })

  return (
    <div className="flex gap-4 h-[700px]">
      <div className={`${selected ? 'hidden md:block' : 'block'} flex-1 overflow-y-auto`}>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <select className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">{t('tenancy.allStatuses', 'All statuses')}</option>
            {['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => setShowPrint(true)} className="ml-auto px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded">
            🖨 {t('tenancy.sched.printSchedule', 'Print Schedule')}
          </button>
          <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded">
            + {t('tenancy.sched.newTask', 'New Scheduled Task')}
          </button>
        </div>

        {tasks.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">{t('tenancy.sched.none', 'No scheduled maintenance tasks.')}</p>}
        {tasks.map((tsk: Record<string, unknown>) => (
          <div key={String(tsk['id'])} onClick={() => setSelected(String(tsk['id']))}
            className={`p-3 rounded border mb-2 cursor-pointer transition-colors ${selected === String(tsk['id']) ? 'border-blue-500 bg-slate-700' : 'border-slate-700 bg-slate-800 hover:bg-slate-750'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-slate-200 font-medium truncate">{String(tsk['title'])}</span>
                  <span className="text-xs text-slate-500">{String(tsk['frequency']).replace(/_/g, ' ')}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {tsk['unit_number'] ? `Unit ${String(tsk['unit_number'])}` : String(tsk['property_name'] ?? '—')}
                  {Boolean(tsk['contractor_name']) && ` · ${String(tsk['contractor_name'])}`}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <div className="flex items-center gap-1">
                  {Boolean(tsk['priority']) && (
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${PRIORITY_COLORS[String(tsk['priority'])] ?? ''}`}>{String(tsk['priority'])}</span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLORS[String(tsk['status'])] ?? ''}`}>{String(tsk['status'])}</span>
                </div>
                <DueBadge dateStr={String(tsk['next_due_date'])} status={String(tsk['status'])} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className={`${!selected ? 'hidden md:block' : 'block'} w-full md:w-96 border-l-0 md:border-l border-slate-700 md:pl-4 overflow-y-auto`}>
        {!selected && <p className="hidden md:block text-sm text-slate-500 mt-8 text-center">{t('tenancy.sched.selectTask', 'Select a task.')}</p>}
        {detail && (
          <div className="space-y-3">
            <button onClick={() => setSelected(null)} className="md:hidden text-sm text-blue-400 hover:text-blue-300">
              {t('common.back', '← Back')}
            </button>
            <div>
              <p className="text-sm font-medium text-slate-200">{String(detail['title'])}</p>
              {Boolean(detail['description']) && <p className="text-sm text-slate-400 mt-1">{String(detail['description'])}</p>}
              <p className="text-xs text-slate-400 mt-1">
                {detail['unit_number'] ? `Unit ${String(detail['unit_number'])}` : String(detail['property_name'] ?? '—')} · {String(detail['frequency']).replace(/_/g, ' ')}
              </p>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLORS[String(detail['status'])] ?? ''}`}>{String(detail['status'])}</span>
                <DueBadge dateStr={String(detail['next_due_date'])} status={String(detail['status'])} />
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <select className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100"
                value={String(detail['status'])} onChange={e => patchMut.mutate({ status: e.target.value })}>
                {['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {detail['status'] !== 'CANCELLED' && detail['status'] !== 'COMPLETED' && (
                <button onClick={() => setShowComplete(true)} className="px-2 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded">
                  {t('tenancy.sched.logCompletion', 'Log Completion')}
                </button>
              )}
              <button onClick={() => { if (confirm(t('tenancy.sched.confirmDelete', 'Delete this scheduled task?') as string)) deleteMut.mutate() }}
                className="px-2 py-1 text-xs text-red-400 hover:text-red-300 ml-auto">
                {t('common.delete', 'Delete')}
              </button>
            </div>

            <div className="space-y-2 border-t border-slate-700 pt-3">
              <p className="text-xs font-medium text-slate-400">{t('tenancy.contractorAssign', 'Contractor Assignment')}</p>
              <select className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100"
                value={String(detail['assigned_contractor_id'] ?? '')}
                onChange={e => patchMut.mutate({ assigned_contractor_id: e.target.value || null })}>
                <option value="">{t('tenancy.noContractor', '— Not assigned —')}</option>
                {contractors.map((c: Record<string, unknown>) => (
                  <option key={String(c['id'])} value={String(c['id'])}>
                    {String(c['name'])} · {String(c['trade'])}
                  </option>
                ))}
              </select>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('tenancy.sched.nextDue', 'Next Due Date')}</label>
                <input type="date" className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100"
                  value={String(detail['next_due_date']).slice(0, 10)}
                  onChange={e => patchMut.mutate({ next_due_date: e.target.value })} />
              </div>
            </div>

            <div key={String(detail['id'])} className="space-y-2 border-t border-slate-700 pt-3">
              <p className="text-xs font-medium text-slate-400">{t('tenancy.sched.scheduleDetails', 'Schedule Details')}</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">{t('tenancy.sched.frequency', 'Frequency')}</label>
                  <select className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100"
                    value={String(detail['frequency'])} onChange={e => patchMut.mutate({ frequency: e.target.value })}>
                    {FREQUENCIES.map(f => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">{t('tenancy.sched.priority', 'Priority')}</label>
                  <select className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100"
                    value={String(detail['priority'] ?? 'MED')} onChange={e => patchMut.mutate({ priority: e.target.value })}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">{t('tenancy.sched.responsible', 'Responsible')}</label>
                  <select className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100"
                    value={String(detail['responsible'] ?? 'IN_HOUSE')} onChange={e => patchMut.mutate({ responsible: e.target.value })}>
                    {RESPONSIBLES.map(r => <option key={r} value={r}>{RESPONSIBLE_LABELS[r]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">{t('tenancy.sched.estHours', 'Est. Hours')}</label>
                  <input type="number" min="0" step="0.5" defaultValue={detail['est_hours'] != null ? String(detail['est_hours']) : ''}
                    onBlur={e => { const v = e.target.value; patchMut.mutate({ est_hours: v ? parseFloat(v) : null }) }}
                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">{t('tenancy.sched.trade', 'Trade')}</label>
                  <input defaultValue={detail['trade'] != null ? String(detail['trade']) : ''}
                    onBlur={e => patchMut.mutate({ trade: e.target.value || null })}
                    placeholder="e.g. Roofer"
                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">{t('tenancy.sched.category', 'Category')}</label>
                  <input defaultValue={detail['category'] != null ? String(detail['category']) : ''}
                    onBlur={e => patchMut.mutate({ category: e.target.value || null })}
                    list="sched-category-options"
                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100" />
                  <datalist id="sched-category-options">
                    {CATEGORY_OPTIONS.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs text-slate-500 mb-1">{t('tenancy.sched.history', 'Completion History')}</p>
              {((detail['completion_log'] as unknown[]) ?? []).length === 0 && (
                <p className="text-xs text-slate-600">{t('tenancy.sched.noHistory', 'No completions logged yet.')}</p>
              )}
              {((detail['completion_log'] as unknown[]) ?? []).map((entry: unknown) => {
                const e = entry as Record<string, unknown>
                return (
                  <div key={String(e['id'])} className="text-xs text-slate-400 border-l-2 border-slate-600 pl-2 mb-1">
                    <span className="text-slate-300">{new Date(String(e['completed_date'])).toLocaleDateString('en-TT')}</span>
                    {Boolean(e['actual_cost_ttd']) && <span> · TT${String(e['actual_cost_ttd'])}</span>}
                    {Boolean(e['completed_by']) && <span> · {String(e['completed_by'])}</span>}
                    {Boolean(e['notes']) && <p className="text-slate-300">{String(e['notes'])}</p>}
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
            <h2 className="text-lg font-semibold mb-4">{t('tenancy.sched.newTask', 'New Scheduled Task')}</h2>
            <div className="space-y-3">
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.title', 'Title')}</label>
                <input className={cls} value={form.title} onChange={set('title')} placeholder={t('tenancy.sched.titlePlaceholder', 'e.g. Service AC units') as string} /></div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.property', 'Property')}</label>
                <select className={cls} value={form.property_id} onChange={e => setForm(f => ({ ...f, property_id: e.target.value, unit_id: '' }))}>
                  <option value="">{t('tenancy.selectProperty', '— Select property —')}</option>
                  {properties.map((p: Property) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.unit', 'Unit (optional — leave blank for whole property)')}</label>
                <select className={cls} value={form.unit_id} onChange={set('unit_id')} disabled={!form.property_id}>
                  <option value="">{t('tenancy.noUnit', '— Whole property —')}</option>
                  {propertyUnits.map((u: Unit) => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.frequency', 'Frequency')}</label>
                <select className={cls} value={form.frequency} onChange={set('frequency')}>
                  {FREQUENCIES.map(f => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.nextDue', 'Next Due Date')}</label>
                <input type="date" className={cls} value={form.next_due_date} onChange={set('next_due_date')} /></div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.contractor', 'Contractor (optional)')}</label>
                <select className={cls} value={form.assigned_contractor_id} onChange={set('assigned_contractor_id')}>
                  <option value="">{t('tenancy.noContractor', '— Not assigned —')}</option>
                  {contractors.map((c: Record<string, unknown>) => (
                    <option key={String(c['id'])} value={String(c['id'])}>{String(c['name'])} · {String(c['trade'])}</option>
                  ))}
                </select>
              </div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.estimatedCost', 'Estimated Cost TTD (optional)')}</label>
                <input type="number" className={cls} value={form.estimated_cost_ttd} onChange={set('estimated_cost_ttd')} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.priority', 'Priority')}</label>
                  <select className={cls} value={form.priority} onChange={set('priority')}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.responsible', 'Responsible')}</label>
                  <select className={cls} value={form.responsible} onChange={set('responsible')}>
                    {RESPONSIBLES.map(r => <option key={r} value={r}>{RESPONSIBLE_LABELS[r]}</option>)}
                  </select>
                </div>
                <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.trade', 'Trade (optional)')}</label>
                  <input className={cls} value={form.trade} onChange={set('trade')} placeholder="e.g. Roofer" />
                </div>
                <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.estHours', 'Est. Hours (optional)')}</label>
                  <input type="number" min="0" step="0.5" className={cls} value={form.est_hours} onChange={set('est_hours')} />
                </div>
                <div className="col-span-2"><label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.category', 'Category (optional)')}</label>
                  <input className={cls} value={form.category} onChange={set('category')} list="sched-category-options-create" />
                  <datalist id="sched-category-options-create">
                    {CATEGORY_OPTIONS.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
              </div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.description', 'Description')}</label>
                <textarea className={cls} rows={2} value={form.description} onChange={set('description')} /></div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel', 'Cancel')}</button>
              <button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.property_id || !form.title || !form.next_due_date}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
                {createMut.isPending ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showComplete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">{t('tenancy.sched.logCompletion', 'Log Completion')}</h2>
            <div className="space-y-3">
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.completedDate', 'Completed Date')}</label>
                <input type="date" className={cls} value={completeForm.completed_date} onChange={e => setCompleteForm(f => ({ ...f, completed_date: e.target.value }))} /></div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.actualCost', 'Actual Cost TTD')}</label>
                <input type="number" className={cls} value={completeForm.actual_cost_ttd} onChange={e => setCompleteForm(f => ({ ...f, actual_cost_ttd: e.target.value }))} /></div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.completedBy', 'Completed By')}</label>
                <input className={cls} value={completeForm.completed_by} onChange={e => setCompleteForm(f => ({ ...f, completed_by: e.target.value }))} /></div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.notes', 'Notes')}</label>
                <textarea className={cls} rows={2} value={completeForm.notes} onChange={e => setCompleteForm(f => ({ ...f, notes: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowComplete(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel', 'Cancel')}</button>
              <button onClick={() => completeMut.mutate()} disabled={completeMut.isPending || !completeForm.completed_date}
                className="px-4 py-2 text-sm bg-green-700 hover:bg-green-600 text-white rounded disabled:opacity-40">
                {completeMut.isPending ? t('common.saving', 'Saving...') : t('tenancy.sched.markComplete', 'Mark Complete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPrint && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">🖨 {t('tenancy.sched.printSchedule', 'Print Schedule')}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.printMode', 'View')}</label>
                <div className="flex gap-2">
                  {(['WEEKLY', 'DAILY'] as const).map(m => (
                    <button key={m} onClick={() => setPrintForm(f => ({ ...f, mode: m }))}
                      className={`flex-1 px-3 py-1.5 text-sm rounded border ${printForm.mode === m ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}>
                      {m === 'WEEKLY' ? t('tenancy.sched.weekly', 'Weekly') : t('tenancy.sched.daily', 'Daily')}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {printForm.mode === 'DAILY' ? t('tenancy.sched.date', 'Date') : t('tenancy.sched.weekStarting', 'Week Starting (Monday)')}
                </label>
                <input type="date" className={cls} value={printForm.start_date} onChange={setPrint('start_date')} />
              </div>
              {printForm.mode === 'WEEKLY' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">{t('tenancy.sched.numWeeks', 'Number of Weeks')}</label>
                  <input type="number" min="1" max="13" className={cls} value={printForm.weeks} onChange={setPrint('weeks')} />
                </div>
              )}
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.property', 'Property')} ({t('common.optional', 'optional')})</label>
                <select className={cls} value={printForm.property_id} onChange={setPrint('property_id')}>
                  <option value="">{t('tenancy.sched.allProperties', '— All properties —')}</option>
                  {properties.map((p: Property) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowPrint(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel', 'Cancel')}</button>
              <button onClick={() => void runPrint()} disabled={printing || !printForm.start_date}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
                {printing ? t('common.loading', 'Loading...') : `🖨 ${t('common.print', 'Print')}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Print Schedule ─────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function fmtOccDate(dateStr: string): { weekday: string; label: string } {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const weekday = WEEKDAY_NAMES[dt.getDay()]
  const label = dt.toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' })
  return { weekday, label }
}

function buildMaintenanceSchedulePrintHtml(occurrences: Record<string, unknown>[], from: string, to: string): string {
  const fromLabel = fmtOccDate(from).label
  const toLabel = fmtOccDate(to).label
  const generatedOn = new Date().toLocaleDateString('en-TT', { day: '2-digit', month: 'long', year: 'numeric' })

  const byDate = new Map<string, Record<string, unknown>[]>()
  for (const occ of occurrences) {
    const date = String(occ['occurrence_date'])
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date)!.push(occ)
  }
  const dates = Array.from(byDate.keys()).sort()

  const dayBlocks = dates.map(date => {
    const { weekday, label } = fmtOccDate(date)
    const rows = byDate.get(date)!.map(occ => {
      const priority = String(occ['priority'] ?? '')
      const priorityCls = priority === 'HIGH' ? 'flag-high' : ''
      const property = occ['unit_number']
        ? `${escapeHtml(String(occ['property_name'] ?? ''))} — Unit ${escapeHtml(String(occ['unit_number']))}`
        : escapeHtml(String(occ['property_name'] ?? ''))
      const responsibleLabel = RESPONSIBLE_LABELS[String(occ['responsible'] ?? '')] ?? String(occ['responsible'] ?? '')
      return `<tr class="${priorityCls}">
        <td>${property}</td>
        <td>${escapeHtml(String(occ['title'] ?? ''))}</td>
        <td>${escapeHtml(String(occ['category'] ?? ''))}</td>
        <td>${escapeHtml(priority)}</td>
        <td>${escapeHtml(responsibleLabel)}</td>
        <td>${escapeHtml(String(occ['trade'] ?? occ['contractor_name'] ?? ''))}</td>
        <td>${occ['est_hours'] != null ? escapeHtml(String(occ['est_hours'])) : ''}</td>
        <td class="done-col">☐</td>
        <td class="notes-col"></td>
      </tr>`
    }).join('')
    return `<div class="day-block">
      <h2>${weekday} <span class="date">${label}</span></h2>
      <table>
        <thead><tr><th>Property</th><th>Task</th><th>Category</th><th>Priority</th><th>Responsible</th><th>Trade</th><th>Hrs</th><th>Done</th><th>Notes / Findings</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
  }).join('')

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Preventive Maintenance Schedule — ${fromLabel} to ${toLabel}</title>
<style>
  @page { margin: 14mm 12mm; size: landscape; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; margin: 0; padding: 24px; font-size: 12px; line-height: 1.4; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .subtitle { color: #555; font-size: 12px; margin-bottom: 16px; }
  .day-block { margin-bottom: 18px; break-inside: avoid; }
  h2 { font-size: 13px; margin: 0 0 6px; padding-bottom: 4px; border-bottom: 1.5px solid #1a1a1a; text-transform: uppercase; letter-spacing: 0.03em; }
  h2 .date { text-transform: none; font-weight: normal; color: #666; letter-spacing: normal; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 4px 6px; text-align: left; border-bottom: 1px solid #eee; vertical-align: top; }
  th { font-size: 9px; text-transform: uppercase; color: #666; border-bottom: 1px solid #ccc; }
  tr.flag-high td { background: #fff3f0; }
  .done-col { text-align: center; font-size: 14px; }
  .notes-col { min-width: 140px; }
  .footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #ccc; font-size: 9px; color: #777; }
  @media print { .no-print { display: none; } }
</style></head>
<body>
  <div class="no-print" style="text-align:right; margin-bottom: 12px;">
    <button onclick="window.print()" style="padding:8px 16px; font-size:13px; cursor:pointer;">Print</button>
  </div>

  <h1>JAG Properties — Preventive Maintenance Schedule</h1>
  <div class="subtitle">${fromLabel} to ${toLabel} · Generated ${generatedOn}</div>

  ${dayBlocks || '<p style="color:#888;font-style:italic;">No tasks due in this range.</p>'}

  <div class="footer">Generated by JAG Holdings — Properties Preventive Maintenance module.</div>
</body></html>`
}

function printMaintenanceSchedule(occurrences: Record<string, unknown>[], from: string, to: string) {
  const w = window.open('', '_blank')
  if (!w) return
  w.document.open()
  w.document.write(buildMaintenanceSchedulePrintHtml(occurrences, from, to))
  w.document.close()
}
