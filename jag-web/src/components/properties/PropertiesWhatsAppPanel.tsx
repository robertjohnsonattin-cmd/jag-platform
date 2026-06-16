import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function PropertiesWhatsAppPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [msgBody, setMsgBody] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [showNew, setShowNew] = useState(false)

  const { data: conversations = [] } = useQuery({
    queryKey: ['wa-conversations'],
    queryFn: () => tenancyApi.getConversations(),
    refetchInterval: 30_000,
  })

  const { data: thread = [] } = useQuery({
    queryKey: ['wa-thread', selectedPhone],
    queryFn: () => tenancyApi.getThread(selectedPhone!),
    enabled: !!selectedPhone,
    refetchInterval: 15_000,
  })

  const sendMut = useMutation({
    mutationFn: (to: string) => tenancyApi.sendWaText({ to, body: msgBody }),
    onSuccess: () => { setMsgBody(''); qc.invalidateQueries({ queryKey: ['wa-thread', selectedPhone] }) },
  })

  const phone = selectedPhone ?? newPhone

  return (
    <div className="flex gap-4 h-[700px]">
      {/* Conversations list */}
      <div className="w-64 overflow-y-auto border-r border-slate-700 pr-3">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-slate-300">{t('tenancy.conversations', 'Conversations')}</p>
          <button onClick={() => setShowNew(!showNew)} className="text-xs text-blue-400 hover:text-blue-300">
            {t('tenancy.new', 'New')}
          </button>
        </div>
        {showNew && (
          <input className={cls + ' mb-3'} placeholder="+18681234567"
            value={newPhone} onChange={e => setNewPhone(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newPhone) { setSelectedPhone(null); setShowNew(false) } }} />
        )}
        {conversations.length === 0 && <p className="text-xs text-slate-500">{t('tenancy.noConversations', 'No conversations yet.')}</p>}
        {conversations.map((c: Record<string, unknown>) => (
          <div key={String(c['phone'])} onClick={() => { setSelectedPhone(String(c['phone'])); setNewPhone('') }}
            className={`p-2.5 rounded cursor-pointer mb-1 transition-colors ${selectedPhone === String(c['phone']) ? 'bg-slate-700' : 'hover:bg-slate-800'}`}>
            <p className="text-sm text-slate-300 font-mono">{String(c['phone'])}</p>
            <p className="text-xs text-slate-500 truncate">{String(c['last_inbound'] ?? '—').slice(0, 50)}</p>
            <p className="text-xs text-slate-600">{c['last_message_at'] ? new Date(String(c['last_message_at'])).toLocaleDateString('en-TT') : ''}</p>
          </div>
        ))}
      </div>

      {/* Thread */}
      <div className="flex-1 flex flex-col">
        {!phone && <p className="text-sm text-slate-500 mt-16 text-center">{t('tenancy.selectConversation', 'Select a conversation or enter a number to start.')}</p>}
        {phone && (
          <>
            <div className="flex-1 overflow-y-auto flex flex-col gap-2 p-2 bg-slate-900 rounded mb-3">
              {thread.length === 0 && <p className="text-xs text-slate-600 text-center mt-4">{t('tenancy.noMessages', 'No messages yet.')}</p>}
              {thread.map((msg: Record<string, unknown>) => (
                <div key={String(msg['id'])} className={`flex ${msg['direction'] === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${msg['direction'] === 'OUTBOUND' ? 'bg-blue-700 text-white' : 'bg-slate-700 text-slate-200'}`}>
                    {msg['template_name']
                      ? <span className="italic text-xs opacity-80">[{String(msg['template_name'])}]</span>
                      : String(msg['body'] ?? '')}
                    <p className="text-xs opacity-60 mt-1">
                      {msg['sent_at'] ? new Date(String(msg['sent_at'])).toLocaleTimeString('en-TT', { hour: '2-digit', minute: '2-digit' }) : ''}
                      {msg['direction'] === 'OUTBOUND' && Boolean(msg['delivery_status']) && <span className="ml-1">· {String(msg['delivery_status'])}</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input className={cls} placeholder={t('tenancy.typeMessage', 'Type a message...')}
                value={msgBody} onChange={e => setMsgBody(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && msgBody.trim()) sendMut.mutate(phone) }} />
              <button onClick={() => sendMut.mutate(phone)} disabled={sendMut.isPending || !msgBody.trim()}
                className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
                {t('common.send', 'Send')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
