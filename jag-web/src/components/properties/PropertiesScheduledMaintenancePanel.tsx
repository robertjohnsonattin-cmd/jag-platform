import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'
import { propertiesApi } from '../../api/properties'
import type { Property, Unit } from '../../types/properties'

const FREQUENCIES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL', 'ONE_TIME']

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:    'bg-blue-900/50 text-blue-300 border-blue-700',
  PAUSED:    'bg-slate-700 text-slate-400 border-slate-600',
  COMPLETED: 'bg-green-900/50 text-green-300 border-green-700',
  CANCELLED: 'bg-slate-700 text-slate-500 border-slate-600',
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

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
  })
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
    enabled: showCreate,
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
    }),
    onSuccess: () => {
      setShowCreate(false)
      setForm({ property_id: '', unit_id: '', title: '', description: '', frequency: 'MONTHLY', next_due_date: '', assigned_contractor_id: '', estimated_cost_ttd: '', notes: '' })
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
          <button onClick={() => setShowCreate(true)} className="ml-auto px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded">
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
                <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLORS[String(tsk['status'])] ?? ''}`}>{String(tsk['status'])}</span>
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
    </div>
  )
}
