import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED:  'bg-blue-900/50 text-blue-300 border-blue-700',
  CONFIRMED:  'bg-indigo-900/50 text-indigo-300 border-indigo-700',
  COMPLETED:  'bg-green-900/50 text-green-300 border-green-700',
  NO_SHOW:    'bg-red-900/50 text-red-300 border-red-700',
  CANCELLED:  'bg-slate-700 text-slate-500 border-slate-600',
  RESCHEDULED:'bg-yellow-900/50 text-yellow-300 border-yellow-700',
}

export default function PropertiesViewingsPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [rescheduleId, setRescheduleId] = useState<string | null>(null)
  const [rescheduleValue, setRescheduleValue] = useState('')

  const { data: viewings = [] } = useQuery({
    queryKey: ['viewings', statusFilter],
    queryFn: () => tenancyApi.getViewings(statusFilter ? { status: statusFilter } : undefined),
  })

  const patchMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => tenancyApi.patchViewing(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['viewings'] }),
  })

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <select className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100"
          value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">{t('tenancy.allStatuses', 'All statuses')}</option>
          {['SCHEDULED','CONFIRMED','COMPLETED','NO_SHOW','CANCELLED','RESCHEDULED'].map(s =>
            <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
        </select>
        <p className="text-xs text-slate-500 ml-auto">{t('tenancy.calendarNote', 'Availability managed in Google Calendar. Book via /book/:slug page.')}</p>
      </div>

      {viewings.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">{t('tenancy.noViewings', 'No viewings scheduled.')}</p>}
      <div className="space-y-3">
        {viewings.map((v: Record<string, unknown>) => (
          <div key={String(v['id'])} className="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-200">{String(v['prospect_name'] ?? '—')}</p>
                <p className="text-xs text-slate-400">{String(v['prospect_phone'] ?? '')} · Unit {String(v['unit_number'] ?? '—')}</p>
                <p className="text-xs text-slate-300 mt-1 font-mono">
                  {v['scheduled_at'] ? new Date(String(v['scheduled_at'])).toLocaleString('en-TT') : '—'}
                </p>
                {Boolean(v['google_event_id']) && <p className="text-xs text-green-500 mt-0.5">✓ Calendar event created</p>}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLORS[String(v['status'])] ?? ''}`}>
                {String(v['status']).replace(/_/g,' ')}
              </span>
            </div>
            <div className="flex gap-2 mt-3">
              {String(v['status']) === 'SCHEDULED' && (
                <button onClick={() => patchMut.mutate({ id: String(v['id']), body: { status: 'CONFIRMED' } })}
                  className="px-3 py-1 text-xs bg-indigo-700 hover:bg-indigo-600 text-white rounded">
                  {t('tenancy.confirm', 'Confirm')}
                </button>
              )}
              {(String(v['status']) === 'SCHEDULED' || String(v['status']) === 'CONFIRMED') && (
                <>
                  <button onClick={() => {
                    setRescheduleId(String(v['id']))
                    const raw = v['scheduled_at'] ? String(v['scheduled_at']) : ''
                    setRescheduleValue(raw ? raw.slice(0, 16) : '')
                  }} className="px-3 py-1 text-xs bg-yellow-800 hover:bg-yellow-700 text-white rounded">
                    {t('tenancy.reschedule', 'Suggest Change / Reschedule')}
                  </button>
                  <button onClick={() => patchMut.mutate({ id: String(v['id']), body: { status: 'COMPLETED' } })}
                    className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded">
                    {t('tenancy.markCompleted', 'Mark Completed')}
                  </button>
                  <button onClick={() => patchMut.mutate({ id: String(v['id']), body: { status: 'NO_SHOW' } })}
                    className="px-3 py-1 text-xs bg-red-800 hover:bg-red-700 text-white rounded">
                    {t('tenancy.noShow', 'No Show')}
                  </button>
                  <button onClick={() => patchMut.mutate({ id: String(v['id']), body: { status: 'CANCELLED' } })}
                    className="px-3 py-1 text-xs bg-slate-600 hover:bg-slate-500 text-white rounded">
                    {t('common.cancel', 'Cancel')}
                  </button>
                </>
              )}
            </div>
            {rescheduleId === String(v['id']) && (
              <div className="flex items-center gap-2 mt-3 bg-slate-900/50 border border-slate-700 rounded p-2">
                <input type="datetime-local" value={rescheduleValue} onChange={e => setRescheduleValue(e.target.value)}
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100" />
                <button
                  disabled={!rescheduleValue}
                  onClick={() => {
                    patchMut.mutate({
                      id: String(v['id']),
                      body: { status: 'RESCHEDULED', scheduled_at: new Date(rescheduleValue).toISOString() },
                    })
                    setRescheduleId(null)
                  }}
                  className="px-3 py-1 text-xs bg-yellow-700 hover:bg-yellow-600 disabled:opacity-50 text-white rounded">
                  {t('common.save', 'Save')}
                </button>
                <button onClick={() => setRescheduleId(null)}
                  className="px-3 py-1 text-xs bg-slate-600 hover:bg-slate-500 text-white rounded">
                  {t('common.cancel', 'Cancel')}
                </button>
              </div>
            )}
            {Boolean(v['notes']) && <p className="text-xs text-slate-500 mt-2">{String(v['notes'])}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
