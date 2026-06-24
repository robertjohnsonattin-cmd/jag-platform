import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { notificationsApi, type AppNotification } from '../api/notifications'

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
              <button
                key={n.id}
                onClick={() => { if (!n.is_read) markRead.mutate(n.id) }}
                className={`w-full text-left px-4 py-3 border-b border-slate-700/60 last:border-0 transition-colors ${
                  n.is_read ? 'hover:bg-slate-700/40' : 'bg-slate-700/30 hover:bg-slate-700/50'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${TIER_DOT[n.tier] ?? 'bg-slate-400'} ${n.is_read ? 'opacity-30' : ''}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm leading-tight ${n.is_read ? 'text-slate-300' : 'text-white font-medium'}`}>{n.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{n.body}</p>
                    <p className="text-[11px] text-slate-500 mt-1">{rel(n.created_at)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
