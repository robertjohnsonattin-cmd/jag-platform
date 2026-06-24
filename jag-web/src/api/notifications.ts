import { api } from './client'

export type NotificationTier = 1 | 2 | 3

export interface AppNotification {
  id:            string
  tenant_id:     string | null
  tier:          NotificationTier
  channel:       string
  title:         string
  body:          string
  payload:       unknown
  is_read:       boolean
  is_sent:       boolean
  sent_at:       string | null
  scheduled_for: string | null
  created_at:    string
}

interface ListResponse {
  notifications: AppNotification[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

export const notificationsApi = {
  list: (opts: { page?: number; limit?: number; unreadOnly?: boolean } = {}) => {
    const q = new URLSearchParams()
    if (opts.page)  q.set('page', String(opts.page))
    if (opts.limit) q.set('limit', String(opts.limit))
    if (opts.unreadOnly) q.set('unread_only', 'true')
    const qs = q.toString()
    return api.get<ListResponse>(`/notifications${qs ? `?${qs}` : ''}`)
  },

  unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),

  markRead: (id: string) => api.patch<AppNotification>(`/notifications/${id}/read`, {}),

  markAllRead: () => api.patch<{ updated: number }>('/notifications/read-all', {}),
}
