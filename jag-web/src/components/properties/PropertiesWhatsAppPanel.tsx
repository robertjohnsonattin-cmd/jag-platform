import { useState, useRef, useEffect, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'
import { api } from '../../api/client'
import AuthedImg from '../AuthedImg'

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

const LOG_TYPES = ['CALL_INBOUND','CALL_OUTBOUND','WHATSAPP_CALL','IN_PERSON','NOTE','EMAIL'] as const
type LogType = typeof LOG_TYPES[number]

const LOG_ICON: Record<string, string> = {
  CALL_INBOUND:  '📞↙',
  CALL_OUTBOUND: '📞↗',
  WHATSAPP_CALL: '📲',
  IN_PERSON:     '🤝',
  NOTE:          '📝',
  EMAIL:         '✉️',
}

export default function PropertiesWhatsAppPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [msgBody, setMsgBody] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [logForm, setLogForm] = useState<{ log_type: LogType; body: string; duration_mins: string }>({
    log_type: 'NOTE', body: '', duration_mins: '',
  })

  const { data: conversations = [] } = useQuery({
    queryKey: ['wa-inbox'],
    queryFn: () => tenancyApi.getWaInbox(),
    refetchInterval: 30_000,
  })

  const { data: threadData } = useQuery({
    queryKey: ['wa-thread', selectedPhone],
    queryFn: () => tenancyApi.getWaThread(selectedPhone!),
    enabled: !!selectedPhone,
    refetchInterval: 15_000,
  })

  const phone = selectedPhone ?? newPhone
  const timelineEndRef = useRef<HTMLDivElement>(null)

  // Merge WA messages + contact log into a unified timeline sorted by time,
  // flagging the first entry of each calendar day for a date divider
  const timeline = (() => {
    if (!threadData) return []
    const msgs = (threadData.messages ?? []).map((m: Record<string, unknown>) => ({ ...m, _type: 'WA', _time: String(m['created_at']) }))
    const log  = (threadData.log ?? []).map((l: Record<string, unknown>) => ({ ...l, _type: 'LOG', _time: String(l['created_at']) }))
    const sorted: Array<Record<string, unknown>> = [...msgs, ...log].sort((a, b) => new Date(a._time).getTime() - new Date(b._time).getTime())
    let prevDay = ''
    for (const e of sorted) {
      const day = new Date(String(e['sent_at'] ?? e['created_at'])).toDateString()
      e['_showDate'] = day !== prevDay
      prevDay = day
    }
    return sorted
  })()

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ block: 'end' })
  }, [selectedPhone, timeline.length])

  const sendMut = useMutation({
    mutationFn: () => tenancyApi.sendWaInboxReply(phone, msgBody),
    onSuccess: () => { setMsgBody(''); qc.invalidateQueries({ queryKey: ['wa-thread', selectedPhone] }) },
  })

  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaMut = useMutation({
    mutationFn: (file: File) => tenancyApi.sendWaInboxMedia(phone, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wa-thread', selectedPhone] })
      qc.invalidateQueries({ queryKey: ['wa-inbox'] })
    },
    onSettled: () => { if (fileInputRef.current) fileInputRef.current.value = '' },
  })

  const logMut = useMutation({
    mutationFn: () => tenancyApi.logContact(phone, {
      log_type: logForm.log_type,
      body: logForm.body,
      duration_mins: logForm.duration_mins ? parseInt(logForm.duration_mins) : undefined,
    }),
    onSuccess: () => {
      setLogForm({ log_type: 'NOTE', body: '', duration_mins: '' })
      setShowLog(false)
      qc.invalidateQueries({ queryKey: ['wa-thread', selectedPhone] })
      qc.invalidateQueries({ queryKey: ['wa-inbox'] })
    },
  })

  return (
    <div className="flex gap-4 h-[700px]">
      {/* Conversations sidebar */}
      <div className="w-64 overflow-y-auto border-r border-slate-700 pr-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-slate-300">{t('tenancy.conversations', 'Contacts')}</p>
          <button onClick={() => setShowNew(!showNew)} className="text-xs text-blue-400 hover:text-blue-300">
            {t('tenancy.new', '+ New')}
          </button>
        </div>
        {showNew && (
          <input className={cls + ' mb-3'} placeholder="+18681234567"
            value={newPhone} onChange={e => setNewPhone(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newPhone) { setSelectedPhone(null); setShowNew(false) } }} />
        )}
        {conversations.length === 0 && (
          <p className="text-xs text-slate-500">{t('tenancy.noConversations', 'No conversations yet.')}</p>
        )}
        {conversations.map((c: Record<string, unknown>) => (
          <div key={String(c['phone'])}
            onClick={() => { setSelectedPhone(String(c['phone'])); setNewPhone('') }}
            className={`p-2.5 rounded cursor-pointer mb-1 transition-colors ${selectedPhone === String(c['phone']) ? 'bg-slate-700' : 'hover:bg-slate-800'}`}>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-slate-300 font-mono flex-1 truncate">{String(c['phone'])}</span>
              {Number(c['unread'] ?? 0) > 0 && (
                <span className="text-xs bg-blue-600 text-white rounded-full px-1.5 py-0.5 font-semibold">{String(c['unread'])}</span>
              )}
            </div>
            <p className="text-xs text-slate-600">{c['last_at'] ? new Date(String(c['last_at'])).toLocaleDateString('en-TT') : ''}</p>
          </div>
        ))}
      </div>

      {/* Thread / detail */}
      <div className="flex-1 flex flex-col min-w-0">
        {!phone && (
          <p className="text-sm text-slate-500 mt-16 text-center">{t('tenancy.selectConversation', 'Select a contact or enter a number.')}</p>
        )}
        {phone && (
          <>
            {/* Header */}
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-700">
              <span className="text-sm font-mono text-slate-200">{phone}</span>
              {threadData?.enquiries?.length ? (
                <span className="text-xs text-slate-500">{threadData.enquiries.length} enquir{threadData.enquiries.length === 1 ? 'y' : 'ies'}</span>
              ) : null}
              <button onClick={() => setShowLog(true)}
                className="ml-auto text-xs px-2.5 py-1 border border-slate-600 text-slate-300 hover:bg-slate-700 rounded">
                {t('tenancy.logCall', '+ Log Call / Note')}
              </button>
            </div>

            {/* Timeline */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-2 p-2 bg-slate-900 rounded mb-3">
              {timeline.length === 0 && (
                <p className="text-xs text-slate-600 text-center mt-4">{t('tenancy.noMessages', 'No messages yet.')}</p>
              )}
              {timeline.map((entry: Record<string, unknown>) => {
                const dateChip = entry['_showDate'] ? (
                  <div key={`day-${String(entry['id'])}`} className="flex justify-center my-1.5">
                    <span className="text-[11px] text-slate-500 bg-slate-800 rounded-full px-2 py-0.5">
                      {new Date(String(entry['sent_at'] ?? entry['created_at'])).toLocaleDateString('en-TT')}
                    </span>
                  </div>
                ) : null
                if (entry['_type'] === 'WA') {
                  const isOut = entry['direction'] === 'OUTBOUND'
                  const hasMedia = Boolean(entry['has_media'])
                  const messageType = String(entry['message_type'] ?? '')
                  const mediaPath = `/properties/wa-inbox/media/${String(entry['id'])}`
                  return (
                    <Fragment key={`wa-${entry['id']}`}>
                      {dateChip}
                      <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[72%] rounded-lg px-3 py-2 text-sm ${isOut ? 'bg-blue-700 text-white' : 'bg-slate-700 text-slate-200'}`}>
                          {hasMedia && messageType === 'IMAGE' && (
                            <button
                              type="button"
                              onClick={() => { void api.objectUrl(mediaPath).then(url => window.open(url, '_blank')) }}
                              className="block mb-1.5"
                            >
                              <AuthedImg path={mediaPath} className="max-h-40 rounded object-cover" />
                            </button>
                          )}
                          {hasMedia && messageType !== 'IMAGE' && (
                            <button
                              type="button"
                              onClick={() => { void api.objectUrl(mediaPath).then(url => window.open(url, '_blank')) }}
                              className="mb-1.5 flex items-center gap-1 text-xs underline opacity-90"
                            >
                              📎 {t('tenancy.openAttachment', 'Open attachment')} ({messageType.toLowerCase()})
                            </button>
                          )}
                          {entry['template_name']
                            ? <span className="italic text-xs opacity-80">[{String(entry['template_name'])}]</span>
                            : String(entry['body'] ?? '')}
                          <p className="text-xs opacity-60 mt-0.5">
                            {new Date(String(entry['sent_at'] ?? entry['created_at'])).toLocaleTimeString('en-TT', { hour: '2-digit', minute: '2-digit' })}
                            {isOut && Boolean(entry['delivery_status']) && <span className="ml-1">· {entry['delivery_status'] as string}</span>}
                          </p>
                        </div>
                      </div>
                    </Fragment>
                  )
                }
                // Contact log entry
                return (
                  <Fragment key={`log-${entry['id']}`}>
                    {dateChip}
                    <div className="flex justify-center">
                      <div className="text-xs text-slate-500 bg-slate-800 border border-slate-700 rounded px-3 py-1.5 max-w-[80%]">
                        <span className="mr-1.5">{LOG_ICON[String(entry['log_type'])] ?? '📌'}</span>
                        <span className="font-medium text-slate-400">{String(entry['log_type']).replace(/_/g,' ')}</span>
                        {Boolean(entry['duration_mins']) && <span className="ml-1">({String(entry['duration_mins'])}m)</span>}
                        {' — '}
                        {String(entry['body'])}
                        <span className="ml-2 text-slate-600">{new Date(String(entry['created_at'])).toLocaleTimeString('en-TT', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  </Fragment>
                )
              })}
              <div ref={timelineEndRef} />
            </div>

            {/* Compose */}
            <div className="flex gap-2 items-center">
              <input ref={fileInputRef} type="file" className="hidden"
                accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx"
                onChange={e => { const f = e.target.files?.[0]; if (f) mediaMut.mutate(f) }} />
              <button type="button" onClick={() => fileInputRef.current?.click()}
                disabled={mediaMut.isPending}
                title={t('tenancy.attachFile', 'Attach file')}
                className="px-3 py-1.5 text-sm border border-slate-600 text-slate-300 hover:bg-slate-700 rounded disabled:opacity-40">
                {mediaMut.isPending ? '…' : '📎'}
              </button>
              <input className={cls} placeholder={t('tenancy.typeMessage', 'WhatsApp message...')}
                value={msgBody} onChange={e => setMsgBody(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && msgBody.trim()) sendMut.mutate() }} />
              <button onClick={() => sendMut.mutate()} disabled={sendMut.isPending || !msgBody.trim()}
                className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
                {t('common.send', 'Send')}
              </button>
            </div>
            {mediaMut.isError && (
              <p className="text-xs text-red-400 mt-1">{t('tenancy.attachFailed', 'Attachment failed to send.')}</p>
            )}
          </>
        )}
      </div>

      {/* Log call / note modal */}
      {showLog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-sm">
            <h2 className="text-base font-semibold mb-4">{t('tenancy.logCall', 'Log Call / Note')}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.logType', 'Type')}</label>
                <select className={cls} value={logForm.log_type}
                  onChange={e => setLogForm(f => ({ ...f, log_type: e.target.value as LogType }))}>
                  {LOG_TYPES.map(lt => (
                    <option key={lt} value={lt}>{LOG_ICON[lt]} {lt.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.notes', 'Notes')}</label>
                <textarea className={cls} rows={3} value={logForm.body}
                  onChange={e => setLogForm(f => ({ ...f, body: e.target.value }))} />
              </div>
              {['CALL_INBOUND','CALL_OUTBOUND','WHATSAPP_CALL','IN_PERSON'].includes(logForm.log_type) && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">{t('tenancy.durationMins', 'Duration (minutes)')}</label>
                  <input type="number" className={cls} min={0} value={logForm.duration_mins}
                    onChange={e => setLogForm(f => ({ ...f, duration_mins: e.target.value }))} />
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowLog(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">
                {t('common.cancel', 'Cancel')}
              </button>
              <button onClick={() => logMut.mutate()} disabled={logMut.isPending || !logForm.body.trim()}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
                {logMut.isPending ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
