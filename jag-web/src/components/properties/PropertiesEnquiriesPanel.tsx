import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'

const STAGE_ORDER = ['NEW_LEAD','VIEWING_SCHEDULED','VIEWED','APPLICATION_SENT','APPLICATION_RECEIVED','SCREENING','APPROVED','REJECTED','WITHDRAWN','CONVERTED'] as const
const STAGE_COLORS: Record<string, string> = {
  NEW_LEAD: 'bg-slate-700 text-slate-300 border-slate-600',
  VIEWING_SCHEDULED: 'bg-blue-900/50 text-blue-300 border-blue-700',
  VIEWED: 'bg-indigo-900/50 text-indigo-300 border-indigo-700',
  APPLICATION_SENT: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  APPLICATION_RECEIVED: 'bg-orange-900/50 text-orange-300 border-orange-700',
  SCREENING: 'bg-purple-900/50 text-purple-300 border-purple-700',
  APPROVED: 'bg-green-900/50 text-green-300 border-green-700',
  REJECTED: 'bg-red-900/50 text-red-300 border-red-700',
  WITHDRAWN: 'bg-slate-700 text-slate-500 border-slate-600',
  CONVERTED: 'bg-teal-900/50 text-teal-300 border-teal-700',
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function PropertiesEnquiriesPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ prospect_name: '', prospect_phone: '', prospect_email: '', channel: 'WHATSAPP', initial_message: '' })

  const { data: enquiries = [] } = useQuery({
    queryKey: ['enquiries', stageFilter],
    queryFn: () => tenancyApi.getEnquiries(stageFilter ? { stage: stageFilter } : undefined),
  })

  const { data: detail } = useQuery({
    queryKey: ['enquiry', selected],
    queryFn: () => tenancyApi.getEnquiry(selected!),
    enabled: !!selected,
  })

  const patchMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => tenancyApi.patchEnquiry(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['enquiries'] }),
  })

  const replyMut = useMutation({
    mutationFn: (body: string) => tenancyApi.sendEnquiryReply(selected!, body),
    onSuccess: () => { setReplyBody(''); qc.invalidateQueries({ queryKey: ['enquiry', selected] }) },
  })

  const createMut = useMutation({
    mutationFn: () => tenancyApi.createEnquiry(form),
    onSuccess: () => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['enquiries'] }) },
  })

  const screeningMut = useMutation({
    mutationFn: (decision: 'APPROVE' | 'REJECT') => tenancyApi.screeningDecision(selected!, decision),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['enquiries'] }); qc.invalidateQueries({ queryKey: ['enquiry', selected] }) },
  })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="flex gap-4 h-[700px]">
      {/* List */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 mb-3">
          <select className={cls} value={stageFilter} onChange={e => setStageFilter(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">{t('tenancy.allStages', 'All stages')}</option>
            {STAGE_ORDER.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <button onClick={() => setShowAdd(true)}
            className="ml-auto px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded">
            + {t('tenancy.addEnquiry', 'Add Enquiry')}
          </button>
        </div>

        {enquiries.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">{t('tenancy.noEnquiries', 'No enquiries yet.')}</p>}
        {enquiries.map((eq: Record<string, unknown>) => (
          <div key={String(eq['id'])}
            onClick={() => setSelected(String(eq['id']))}
            className={`p-3 rounded border mb-2 cursor-pointer transition-colors ${selected === String(eq['id']) ? 'border-blue-500 bg-slate-700' : 'border-slate-700 bg-slate-800 hover:bg-slate-750'}`}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-200">{String(eq['prospect_name'] ?? '—')}</p>
              <span className={`text-xs px-2 py-0.5 rounded border ${STAGE_COLORS[String(eq['stage'])] ?? 'bg-slate-700 text-slate-400 border-slate-600'}`}>
                {String(eq['stage']).replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{String(eq['prospect_phone'] ?? '')}  ·  {String(eq['channel'] ?? '')}</p>
            {Boolean(eq['unit_number']) && <p className="text-xs text-slate-500">Unit {String(eq['unit_number'])}</p>}
          </div>
        ))}
      </div>

      {/* Detail */}
      <div className="w-96 border-l border-slate-700 pl-4 flex flex-col gap-3 overflow-y-auto">
        {!selected && <p className="text-sm text-slate-500 mt-8 text-center">{t('tenancy.selectEnquiry', 'Select an enquiry to view details.')}</p>}
        {detail && (
          <>
            <div>
              <p className="text-lg font-semibold text-slate-200">{String(detail['prospect_name'] ?? '—')}</p>
              <p className="text-sm text-slate-400">{String(detail['prospect_phone'] ?? '')} · {String(detail['prospect_email'] ?? '')}</p>
              <p className="text-xs text-slate-500 mt-1">{String(detail['channel'])} · {String(detail['initial_message'] ?? '').slice(0, 80)}</p>
            </div>

            <div>
              <p className="text-xs text-slate-500 mb-1">{t('tenancy.stage', 'Stage')}</p>
              {detail['stage'] === 'SCREENING' ? (
                <p className="text-sm px-3 py-1.5 rounded border border-purple-700 bg-purple-900/30 text-purple-300">
                  {t('tenancy.awaitingScreeningReview', 'Awaiting your screening review — see below')}
                </p>
              ) : (
                <select className={cls} value={String(detail['stage'])}
                  onChange={e => patchMut.mutate({ id: selected!, body: { stage: e.target.value } })}>
                  {STAGE_ORDER.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              )}
            </div>

            {/* Pre-viewing screening answers (collected on the public booking page) */}
            {detail['screening_answers'] != null && (() => {
              const sa = detail['screening_answers'] as Record<string, unknown>
              const rows: Array<[string, string]> = [
                ['Employment status', String(sa['employment_status'] ?? '—')],
                ['Monthly income range', String(sa['monthly_income_range'] ?? '—')],
                ['Adults', String(sa['adults'] ?? '—')],
                ['Children (12 & under)', String(sa['children'] ?? '—')],
                ['Pets', sa['has_pets'] ? String(sa['pet_details'] ?? 'Yes') : 'No'],
                ['Smoker in household', sa['is_smoker'] ? 'Yes' : 'No'],
                ['Desired move-in date', String(sa['move_in_date'] ?? '—')],
                ['Reason for moving', String(sa['reason_for_moving'] ?? '—')],
                ['Consents to background check', sa['consents_background_check'] ? 'Yes' : 'No'],
                ['Evicted / broke lease before', sa['evicted_or_broke_lease'] ? String(sa['eviction_details'] ?? 'Yes') : 'No'],
                ['Can provide references', sa['can_provide_references'] ? 'Yes' : 'No'],
              ]
              return (
                <div className="bg-slate-900/60 rounded p-3 border border-slate-700">
                  <p className="text-xs font-semibold text-slate-400 mb-2">{t('tenancy.screeningAnswers', 'Pre-Screening Answers')}</p>
                  <div className="space-y-1">
                    {rows.map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-2 text-xs">
                        <span className="text-slate-500">{label}</span>
                        <span className="text-slate-300 text-right">{value}</span>
                      </div>
                    ))}
                  </div>
                  {detail['stage'] === 'SCREENING' && (
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => screeningMut.mutate('APPROVE')} disabled={screeningMut.isPending}
                        className="flex-1 px-3 py-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 text-white rounded disabled:opacity-40">
                        {t('tenancy.approve', 'Approve')}
                      </button>
                      <button onClick={() => screeningMut.mutate('REJECT')} disabled={screeningMut.isPending}
                        className="flex-1 px-3 py-1.5 text-sm bg-red-800 hover:bg-red-700 text-white rounded disabled:opacity-40">
                        {t('tenancy.decline', 'Decline')}
                      </button>
                    </div>
                  )}
                  {detail['stage'] === 'APPROVED' && Boolean(detail['schedule_token']) && (
                    <p className="text-xs text-emerald-400 mt-3">
                      {t('tenancy.awaitingSlotPick', 'Approved — waiting for prospect to pick a time via their scheduling link.')}
                    </p>
                  )}
                </div>
              )
            })()}

            {/* WA thread */}
            <div className="flex-1">
              <p className="text-xs text-slate-500 mb-1">{t('tenancy.messages', 'Messages')}</p>
              <div className="bg-slate-900 rounded p-2 h-48 overflow-y-auto flex flex-col gap-2">
                {((detail['messages'] as unknown[]) ?? []).map((msg: unknown) => {
                  const m = msg as Record<string, unknown>
                  return (
                    <div key={String(m['id'])} className={`flex ${m['direction'] === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded p-2 text-xs ${m['direction'] === 'OUTBOUND' ? 'bg-blue-700 text-white' : 'bg-slate-700 text-slate-200'}`}>
                        {m['template_name'] ? `[${m['template_name']}]` : String(m['body'] ?? '')}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-2 mt-2">
                <input className={cls} placeholder={t('tenancy.typeMessage', 'Type a reply...')}
                  value={replyBody} onChange={e => setReplyBody(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && replyBody.trim()) replyMut.mutate(replyBody) }} />
                <button onClick={() => replyMut.mutate(replyBody)} disabled={!replyBody.trim()}
                  className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
                  {t('common.send', 'Send')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">{t('tenancy.addEnquiry', 'Add Enquiry')}</h2>
            {(['prospect_name','prospect_phone','prospect_email'] as const).map(k => (
              <div key={k} className="mb-3">
                <label className="block text-xs text-slate-400 mb-1">{k.replace(/_/g,' ')}</label>
                <input className={cls} value={form[k]} onChange={set(k)} />
              </div>
            ))}
            <div className="mb-3">
              <label className="block text-xs text-slate-400 mb-1">{t('tenancy.channel', 'Channel')}</label>
              <select className={cls} value={form.channel} onChange={set('channel')}>
                {['WHATSAPP','SMS','EMAIL','PHONE','WALK_IN','FACEBOOK'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-xs text-slate-400 mb-1">{t('tenancy.initialMessage', 'Initial message')}</label>
              <textarea className={cls} rows={3} value={form.initial_message} onChange={set('initial_message')} />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel', 'Cancel')}</button>
              <button onClick={() => createMut.mutate()} disabled={createMut.isPending}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
                {createMut.isPending ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
