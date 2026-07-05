import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '../../api/crm'
import type { Contact, InteractionType } from '../../types/crm'

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

// Inline display of a linked CRM contact with action links
export function CrmContactBadge({ contactId }: { contactId: string }) {
  const { t } = useTranslation()
  const { data: c } = useQuery({
    queryKey: ['crm-contact', contactId],
    queryFn: () => crmApi.getContact(contactId),
    staleTime: 300_000,
  })
  if (!c) return <span className="text-xs text-slate-500 animate-pulse">🔗 …</span>

  const quickLog = (type: InteractionType, subject: string) => {
    crmApi.quickLog(c.id, type, subject).catch(err => console.error('Quick-log interaction failed', err))
  }

  return (
    <div className="flex items-center gap-1 flex-wrap mt-0.5">
      <span className="text-xs text-indigo-400 font-medium">🔗 {c.first_name} {c.last_name}</span>
      {c.phone && (
        <>
          <a href={`tel:${c.phone}`} onClick={() => quickLog('CALL', `Called ${c.phone}`)} title={t('crm.callLand')} className="text-xs text-blue-400 hover:text-blue-300">📞</a>
          <a href={`https://wa.me/${c.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" onClick={() => quickLog('WHATSAPP_MESSAGE', `WhatsApp to ${c.phone}`)} title={t('crm.whatsapp')} className="text-xs text-green-400 hover:text-green-300">💬</a>
        </>
      )}
      {c.phone2 && (
        <a href={`tel:${c.phone2}`} onClick={() => quickLog('CALL', `Called ${c.phone2}`)} title={t('crm.callCell')} className="text-xs text-blue-400 hover:text-blue-300">📱</a>
      )}
      {c.email && (
        <a href={`mailto:${c.email}`} onClick={() => quickLog('EMAIL', `Email to ${c.email}`)} title={t('crm.sendEmail')} className="text-xs text-yellow-400 hover:text-yellow-300">✉️</a>
      )}
    </div>
  )
}

interface Props {
  value: string | null
  onChange: (id: string | null) => void
}

// Picker: shows search input when unlinked; shows contact name + action buttons + unlink when linked
export default function CrmContactPicker({ value, onChange }: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const { data: linkedContact } = useQuery({
    queryKey: ['crm-contact', value],
    queryFn: () => crmApi.getContact(value!),
    enabled: !!value,
    staleTime: 60_000,
  })

  const { data: results } = useQuery({
    queryKey: ['crm-contacts-picker', search],
    queryFn: () => crmApi.getContacts({ search: search || undefined, limit: 10 }),
    enabled: open && search.length >= 1,
    staleTime: 10_000,
  })

  if (value) {
    const c = linkedContact
    const quickLog = (type: InteractionType, subject: string) => {
      if (!c) return
      crmApi.quickLog(c.id, type, subject).catch(err => console.error('Quick-log interaction failed', err))
    }
    return (
      <div className="flex items-center gap-1.5 flex-wrap rounded border border-slate-600 bg-slate-700 px-3 py-1.5">
        <span className="text-white text-sm flex-1 min-w-0 truncate">
          {c ? `${c.first_name} ${c.last_name}` : '…'}
        </span>
        {c?.phone && (
          <>
            <a href={`tel:${c.phone}`} onClick={() => quickLog('CALL', `Called ${c.phone}`)} title={t('crm.callLand')} className="text-blue-400 hover:text-blue-300 text-sm">📞</a>
            <a href={`https://wa.me/${c.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" onClick={() => quickLog('WHATSAPP_MESSAGE', `WhatsApp to ${c.phone}`)} title={t('crm.whatsapp')} className="text-green-400 hover:text-green-300 text-sm">💬</a>
          </>
        )}
        {c?.phone2 && (
          <a href={`tel:${c.phone2}`} onClick={() => quickLog('CALL', `Called ${c.phone2}`)} title={t('crm.callCell')} className="text-blue-400 hover:text-blue-300 text-sm">📱</a>
        )}
        {c?.email && (
          <a href={`mailto:${c.email}`} onClick={() => quickLog('EMAIL', `Email to ${c.email}`)} title={t('crm.sendEmail')} className="text-yellow-400 hover:text-yellow-300 text-sm">✉️</a>
        )}
        <button
          onClick={() => onChange(null)}
          title={t('crm.unlinkContact')}
          className="text-red-400 hover:text-red-300 text-xs ml-1 shrink-0"
        >✕</button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={search}
        onChange={e => { setSearch(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={t('crm.searchContacts')}
        className={cls}
      />
      {open && results?.contacts && results.contacts.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-slate-800 border border-slate-600 rounded shadow-xl max-h-44 overflow-y-auto">
          {results.contacts.map((c: Contact) => (
            <button
              key={c.id}
              onMouseDown={() => { onChange(c.id); setSearch(''); setOpen(false) }}
              className="w-full text-left px-3 py-2 hover:bg-slate-700 text-sm text-white border-b border-slate-700/50 last:border-0"
            >
              <span className="font-medium">{c.first_name} {c.last_name}</span>
              {c.company_name && <span className="text-slate-400 text-xs ml-1.5">· {c.company_name}</span>}
              {c.email && <span className="text-slate-500 text-xs ml-1.5">{c.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
