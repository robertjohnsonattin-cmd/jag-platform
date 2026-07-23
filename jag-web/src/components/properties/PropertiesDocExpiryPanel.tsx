import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { propertiesApi } from '../../api/properties'
import type { ExpiringDocument } from '../../types/properties'

const DOC_TYPE_LABELS: Record<string, string> = {
  national_id: 'National ID', passport: 'Passport', drivers_licence: "Driver's Licence",
  employment_letter: 'Employment Letter', payslip: 'Payslip', company_reg: 'Company Registration',
  bank_statement: 'Bank Statement', utility_bill: 'Utility Bill', reference_letter: 'Reference Letter',
  tenancy_agreement: 'Tenancy Agreement', other: 'Other',
}

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  // dateStr may be a full ISO timestamp; take just the date part to avoid Invalid Date (NaN).
  return Math.ceil((new Date(`${dateStr.slice(0, 10)}T00:00:00`).getTime() - today.getTime()) / 86_400_000)
}

const fmtDate = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' })

const tenantName = (d: ExpiringDocument) =>
  d.is_company ? (d.company_name ?? '—') : `${d.first_name ?? ''}${d.last_name ? ` ${d.last_name}` : ''}`.trim() || '—'

const WINDOWS = [30, 60, 90, 180, 365]

export default function PropertiesDocExpiryPanel() {
  const { t } = useTranslation()
  const [withinDays, setWithinDays] = useState(90)

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['expiring-documents', withinDays],
    queryFn: () => propertiesApi.getExpiringDocuments(withinDays),
  })

  const expired = docs.filter(d => daysUntil(d.expiry_date) < 0).length
  const soon = docs.filter(d => { const n = daysUntil(d.expiry_date); return n >= 0 && n <= 30 }).length

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">{t('tenancy.docExpiry.showing', 'Expiring within')}</span>
          <select className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100"
            value={withinDays} onChange={e => setWithinDays(Number(e.target.value))}>
            {WINDOWS.map(w => <option key={w} value={w}>{t('tenancy.docExpiry.days', '{{n}} days', { n: w })}</option>)}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          {expired > 0 && <span className="px-2 py-1 rounded border bg-red-900/40 text-red-300 border-red-700">{t('tenancy.docExpiry.expiredCount', '{{n}} expired', { n: expired })}</span>}
          {soon > 0 && <span className="px-2 py-1 rounded border bg-amber-900/40 text-amber-300 border-amber-700">{t('tenancy.docExpiry.soonCount', '{{n}} within 30 days', { n: soon })}</span>}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {t('tenancy.docExpiry.editHint', 'Read-only overview. To update an expiry date, open the tenant under the Tenants tab → Docs.')}
      </p>

      {isLoading && <p className="text-sm text-slate-500">{t('common.loading', 'Loading…')}</p>}
      {!isLoading && docs.length === 0 && (
        <p className="text-sm text-slate-500 py-8 text-center">{t('tenancy.docExpiry.none', 'No documents expiring in this window.')}</p>
      )}

      {docs.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-3 py-2">{t('tenancy.docExpiry.tenant', 'Tenant')}</th>
                <th className="text-left px-3 py-2">{t('tenancy.docExpiry.location', 'Unit / Property')}</th>
                <th className="text-left px-3 py-2">{t('tenancy.docExpiry.docType', 'Document')}</th>
                <th className="text-left px-3 py-2">{t('tenancy.docExpiry.expiry', 'Expiry')}</th>
                <th className="text-right px-3 py-2">{t('tenancy.docExpiry.status', 'Status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {docs.map((d: ExpiringDocument) => {
                const days = daysUntil(d.expiry_date)
                const style = days < 0 ? 'bg-red-900/40 text-red-300 border-red-700'
                  : days <= 30 ? 'bg-amber-900/40 text-amber-300 border-amber-700'
                  : 'bg-slate-700 text-slate-300 border-slate-600'
                const label = days < 0 ? t('tenancy.docExpiry.expiredBy', 'Expired {{n}}d ago', { n: Math.abs(days) })
                  : days === 0 ? t('tenancy.docExpiry.today', 'Today')
                  : t('tenancy.docExpiry.inDays', 'In {{n}}d', { n: days })
                return (
                  <tr key={d.id} className="hover:bg-slate-700/20">
                    <td className="px-3 py-2 text-slate-100">{tenantName(d)}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {d.unit_number ? `Unit ${d.unit_number}` : '—'}{d.property_name ? ` · ${d.property_name}` : ''}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-300">
                      {t(`tenants.docs.types.${d.doc_type}`, DOC_TYPE_LABELS[d.doc_type] ?? d.doc_type)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">{fmtDate(d.expiry_date)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${style}`}>{label}</span>
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
