import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { propertiesApi } from '../../api/properties'
import type { Lease } from '../../types/properties'

// Flat cross-property lease list. Consumes GET /properties/leases, which was
// dead until Phase 1a moved it out from behind `GET /:id` — every other lease
// route is nested under /:propertyId/leases, so there was no way to see the
// portfolio's leases in one place.

const STATUS_STYLES: Record<string, string> = {
  ACTIVE:     'bg-green-900/40 text-green-300 border-green-700',
  PENDING:    'bg-amber-900/40 text-amber-300 border-amber-700',
  EXPIRED:    'bg-slate-700 text-slate-400 border-slate-600',
  TERMINATED: 'bg-red-900/40 text-red-300 border-red-700',
}

const SIGNATURE_STYLES: Record<string, string> = {
  SIGNED:            'bg-green-900/40 text-green-300 border-green-700',
  PARTIALLY_SIGNED:  'bg-amber-900/40 text-amber-300 border-amber-700',
  SENT:              'bg-blue-900/40 text-blue-300 border-blue-700',
  DECLINED:          'bg-red-900/40 text-red-300 border-red-700',
  EXPIRED:           'bg-red-900/40 text-red-300 border-red-700',
  UNSIGNED:          'bg-slate-700 text-slate-400 border-slate-600',
}

// PG DATE values arrive as 'YYYY-MM-DD' (or a full ISO timestamp). Parsing them
// through `new Date(iso)` renders a day early in Trinidad — build the local date
// explicitly. Do not reuse this for real timestamps.
const fmtDate = (s: string | null) =>
  s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const fmtTTD = (v: string | number | null | undefined, currency = 'TTD') =>
  v === null || v === undefined || v === ''
    ? '—'
    : `${currency === 'TTD' ? 'TT$' : `${currency} `}${parseFloat(String(v)).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const tenantName = (l: Lease) =>
  l.is_company
    ? (l.company_name ?? '—')
    : `${l.first_name ?? ''}${l.last_name ? ` ${l.last_name}` : ''}`.trim() || '—'

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.ceil((new Date(`${dateStr.slice(0, 10)}T00:00:00`).getTime() - today.getTime()) / 86_400_000)
}

export default function LeasesPanel() {
  const { t } = useTranslation()
  const [propertyId, setPropertyId] = useState('')
  const [status, setStatus] = useState('')

  const { data: properties = [] } = useQuery({
    queryKey: ['properties', 'list'],
    queryFn: () => propertiesApi.getProperties({ limit: 200 }),
  })

  const { data: leases = [], isLoading, isError, error } = useQuery({
    queryKey: ['properties', 'leases-flat', propertyId, status],
    queryFn: () => propertiesApi.listLeases({
      ...(propertyId ? { property_id: propertyId } : {}),
      ...(status ? { status } : {}),
    }),
  })

  const active = leases.filter(l => l.status === 'ACTIVE').length
  const expiringSoon = leases.filter(
    l => l.status === 'ACTIVE' && l.end_date && daysUntil(l.end_date) >= 0 && daysUntil(l.end_date) <= 60,
  ).length

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select
          className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100"
          value={propertyId}
          onChange={e => setPropertyId(e.target.value)}
        >
          <option value="">{t('tenancy.leases.allProperties', 'All properties')}</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <select
          className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100"
          value={status}
          onChange={e => setStatus(e.target.value)}
        >
          <option value="">{t('tenancy.leases.allStatuses', 'All statuses')}</option>
          <option value="ACTIVE">{t('tenancy.leases.status.ACTIVE', 'Active')}</option>
          <option value="PENDING">{t('tenancy.leases.status.PENDING', 'Pending')}</option>
          <option value="EXPIRED">{t('tenancy.leases.status.EXPIRED', 'Expired')}</option>
          <option value="TERMINATED">{t('tenancy.leases.status.TERMINATED', 'Terminated')}</option>
        </select>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className="px-2 py-1 rounded border bg-slate-700 text-slate-300 border-slate-600">
            {t('tenancy.leases.countTotal', '{{n}} leases', { n: leases.length })}
          </span>
          <span className="px-2 py-1 rounded border bg-green-900/40 text-green-300 border-green-700">
            {t('tenancy.leases.countActive', '{{n}} active', { n: active })}
          </span>
          {expiringSoon > 0 && (
            <span className="px-2 py-1 rounded border bg-amber-900/40 text-amber-300 border-amber-700">
              {t('tenancy.leases.countExpiring', '{{n}} expiring within 60 days', { n: expiringSoon })}
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {t('tenancy.leases.editHint', 'Read-only overview. To create or edit a lease, open its property under Portfolio → Properties → Leases.')}
      </p>

      {/* Loading, error and empty are three different things — never one message. */}
      {isLoading && <p className="text-sm text-slate-500">{t('common.loading', 'Loading…')}</p>}
      {isError && (
        <p className="text-sm text-red-400">
          {t('tenancy.leases.loadFailed', 'Could not load leases:')} {(error as Error).message}
        </p>
      )}
      {!isLoading && !isError && leases.length === 0 && (
        <p className="text-sm text-slate-500 py-8 text-center">
          {t('tenancy.leases.none', 'No leases match these filters.')}
        </p>
      )}

      {leases.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-3 py-2">{t('tenancy.leases.tenant', 'Tenant')}</th>
                <th className="text-left px-3 py-2">{t('tenancy.leases.location', 'Unit / Property')}</th>
                <th className="text-left px-3 py-2">{t('tenancy.leases.term', 'Term')}</th>
                <th className="text-left px-3 py-2">{t('tenancy.leases.rent', 'Monthly rent')}</th>
                <th className="text-left px-3 py-2">{t('tenancy.leases.leaseStatus', 'Status')}</th>
                <th className="text-right px-3 py-2">{t('tenancy.leases.signature', 'Signature')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {leases.map(l => {
                const sig = l.signature_status ?? 'UNSIGNED'
                const days = l.end_date ? daysUntil(l.end_date) : null
                return (
                  <tr key={l.id} className="hover:bg-slate-700/20">
                    <td className="px-3 py-2 text-slate-100">{tenantName(l)}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {l.unit_number ? `Unit ${l.unit_number}` : '—'}{l.property_name ? ` · ${l.property_name}` : ''}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">
                      {fmtDate(l.start_date)} → {fmtDate(l.end_date)}
                      {l.status === 'ACTIVE' && days !== null && days >= 0 && days <= 60 && (
                        <span className="ml-1 text-amber-400">
                          {t('tenancy.leases.inDays', '(in {{n}}d)', { n: days })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-300 whitespace-nowrap">
                      {fmtTTD(l.monthly_rent, l.currency)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${STATUS_STYLES[l.status] ?? STATUS_STYLES['EXPIRED']}`}>
                        {t(`tenancy.leases.status.${l.status}`, l.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${SIGNATURE_STYLES[sig] ?? SIGNATURE_STYLES['UNSIGNED']}`}>
                        {t(`tenancy.leases.sig.${sig}`, sig)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
