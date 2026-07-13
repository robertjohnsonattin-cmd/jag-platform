import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { notificationsApi, type AppNotification } from '../api/notifications'

// Maps a notification's payload (set by enqueueNotification() call sites in
// jag-api) to a destination route. Falls back to no navigation (mark-read only)
// for payload shapes not covered here — see enqueueNotification usages for the
// full set of { module, kind } combinations in use.
function notificationTarget(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const module = p['module']
  const kind = p['kind']
  if (module === 'PROPERTIES' && kind === 'ENQUIRY' && typeof p['enquiry_id'] === 'string') {
    return `/properties?tab=enquiries&focus=${p['enquiry_id']}`
  }
  if (module === 'PROPERTIES' && kind === 'APPLICATION' && typeof p['application_id'] === 'string') {
    return `/properties?tab=applications&focus=${p['application_id']}`
  }
  if (module === 'PROPERTIES' && (kind === 'MAINTENANCE' || kind === 'MAINTENANCE_SLA') && typeof p['ticket_id'] === 'string') {
    return `/properties?tab=maintenance&focus=${p['ticket_id']}`
  }
  if (module === 'FINANCE' && kind === 'EXPENSE_APPROVAL') {
    return '/expenses'
  }
  return null
}

function useRelativeTime() {
  const { t } = useTranslation()
  return (iso: string): string => {
    const diffMs = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diffMs / 60_000)
    if (mins < 1)  return t('notifications.justNow')
    if (mins < 60) return t('notifications.minutesAgo', { count: mins })
    const hrs = Math.floor(mins / 60)
    if (hrs < 24)  return t('notifications.hoursAgo', { count: hrs })
    const days = Math.floor(hrs / 24)
    return t('notifications.daysAgo', { count: days })
  }
}

const TIER_DOT: Record<number, string> = {
  1: 'bg-red-500',
  2: 'bg-amber-500',
  3: 'bg-slate-400',
}

export default function NotificationBell() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const rel = useRelativeTime()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Unread badge — polls every 60s.
  const { data: unread } = useQuery({
    queryKey: ['notif-unread'],
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: 60_000,
  })
  const count = unread?.count ?? 0

  // Recent list — only fetched while the panel is open.
  const { data: list, isLoading } = useQuery({
    queryKey: ['notif-list'],
    queryFn: () => notificationsApi.list({ limit: 20 }),
    enabled: open,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['notif-unread'] })
    qc.invalidateQueries({ queryKey: ['notif-list'] })
  }

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: invalidate,
  })
  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: invalidate,
  })
  const deleteOne = useMutation({
    mutationFn: (id: string) => notificationsApi.delete(id),
    onSuccess: invalidate,
  })

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const rows: AppNotification[] = list?.notifications ?? []

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative text-slate-400 hover:text-white transition-colors p-1"
        aria-label={t('notifications.title')}
        title={t('notifications.title')}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-red-600 text-white text-[10px] font-semibold rounded-full">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <span className="text-sm font-semibold text-white">{t('notifications.title')}</span>
            {count > 0 && (
              <button
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
                className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
              >
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isLoading && (
              <div className="px-4 py-8 text-center text-slate-400 text-sm">{t('common.loading')}</div>
            )}
            {!isLoading && rows.length === 0 && (
              <div className="px-4 py-10 text-center text-slate-500 text-sm">
                <p className="text-2xl mb-2">🔔</p>
                {t('notifications.empty')}
              </div>
            )}
            {rows.map(n => (
              <div
                key={n.id}
                className={`flex items-start gap-2 px-4 py-3 border-b border-slate-700/60 last:border-0 transition-colors ${
                  n.is_read ? 'hover:bg-slate-700/40' : 'bg-slate-700/30 hover:bg-slate-700/50'
                }`}
              >
                <button
                  onClick={() => {
                    if (!n.is_read) markRead.mutate(n.id)
                    const target = notificationTarget(n.payload)
                    if (target) { setOpen(false); navigate(target) }
                  }}
                  className="flex-1 min-w-0 text-left flex items-start gap-2.5"
                >
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${TIER_DOT[n.tier] ?? 'bg-slate-400'} ${n.is_read ? 'opacity-30' : ''}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm leading-tight ${n.is_read ? 'text-slate-300' : 'text-white font-medium'}`}>{n.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{n.body}</p>
                    <p className="text-[11px] text-slate-500 mt-1">{rel(n.created_at)}</p>
                  </div>
                </button>
                <div className="flex flex-col items-center gap-1.5 shrink-0 pt-0.5">
                  {!n.is_read && (
                    <button
                      onClick={() => markRead.mutate(n.id)}
                      disabled={markRead.isPending}
                      title={t('notifications.markRead', 'Mark as read')}
                      className="text-slate-500 hover:text-emerald-400 disabled:opacity-50 text-xs leading-none p-0.5"
                    >
                      ✓
                    </button>
                  )}
                  <button
                    onClick={() => deleteOne.mutate(n.id)}
                    disabled={deleteOne.isPending}
                    title={t('notifications.delete', 'Delete')}
                    className="text-slate-500 hover:text-red-400 disabled:opacity-50 text-xs leading-none p-0.5"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
