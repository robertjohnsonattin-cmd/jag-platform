import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'
import { api } from '../../api/client'

const STATUS_COLORS: Record<string, string> = {
  UPCOMING:     'bg-slate-700 text-slate-300 border-slate-600',
  REMINDER_SENT:'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  PAID:         'bg-green-900/50 text-green-300 border-green-700',
  PARTIAL:      'bg-orange-900/50 text-orange-300 border-orange-700',
  LATE:         'bg-red-900/50 text-red-300 border-red-700',
  WAIVED:       'bg-slate-700 text-slate-500 border-slate-600',
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function PropertiesRentSchedulePanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [payModal, setPayModal] = useState<Record<string, unknown> | null>(null)
  const [payForm, setPayForm] = useState({ paid_amount_ttd: '', paid_date: new Date().toISOString().slice(0,10), payment_method: 'BANK_TRANSFER', payment_reference: '', idempotency_key: crypto.randomUUID() })

  const { data: schedule = [] } = useQuery({
    queryKey: ['rent-schedule', statusFilter],
    queryFn: () => tenancyApi.getRentSchedule(statusFilter ? { status: statusFilter } : undefined),
  })

  const payMut = useMutation({
    mutationFn: (id: string) => tenancyApi.recordPayment(id, {
      ...payForm,
      paid_amount_ttd: parseFloat(payForm.paid_amount_ttd),
    }),
    onSuccess: () => { setPayModal(null); qc.invalidateQueries({ queryKey: ['rent-schedule'] }) },
  })

  const setP = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setPayForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <select className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100"
          value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">{t('tenancy.allStatuses', 'All statuses')}</option>
          {['UPCOMING','REMINDER_SENT','PAID','PARTIAL','LATE','WAIVED'].map(s =>
            <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {schedule.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">{t('tenancy.noSchedule', 'No rent schedule found.')}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 border-b border-slate-700">
            <th className="text-left pb-2">{t('tenancy.tenant', 'Tenant')}</th>
            <th className="text-left pb-2">{t('tenancy.unit', 'Unit')}</th>
            <th className="text-left pb-2">{t('tenancy.period', 'Period')}</th>
            <th className="text-left pb-2">{t('tenancy.dueDate', 'Due Date')}</th>
            <th className="text-right pb-2">{t('tenancy.amountDue', 'Amount Due')}</th>
            <th className="text-left pb-2">{t('tenancy.status', 'Status')}</th>
            <th className="text-left pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((rs: Record<string, unknown>) => (
            <tr key={String(rs['id'])} className="border-b border-slate-800 hover:bg-slate-800/50">
              <td className="py-2 text-slate-300">{String(rs['tenant_name'])}</td>
              <td className="py-2 text-slate-400">{String(rs['unit_number'] ?? '—')}</td>
              <td className="py-2 text-slate-400">{String(rs['period_year'])}-{String(rs['period_month']).padStart(2,'0')}</td>
              <td className="py-2 text-slate-400">{String(rs['due_date'])}</td>
              <td className="py-2 text-right text-slate-200 font-mono">
                TTD ${parseFloat(String(rs['amount_due_ttd'] ?? 0)).toLocaleString('en-TT', { minimumFractionDigits: 2 })}
              </td>
              <td className="py-2">
                <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLORS[String(rs['status'])] ?? ''}`}>
                  {String(rs['status'])}
                </span>
              </td>
              <td className="py-2">
                {['UPCOMING','REMINDER_SENT','LATE'].includes(String(rs['status'])) && (
                  <button onClick={() => { setPayModal(rs); setPayForm(f => ({ ...f, paid_amount_ttd: String(rs['amount_due_ttd']), idempotency_key: crypto.randomUUID() })) }}
                    className="px-2 py-0.5 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded">
                    {t('tenancy.recordPayment', 'Record Payment')}
                  </button>
                )}
                {['PAID','PARTIAL'].includes(String(rs['status'])) && (
                  <button onClick={() => void api.openHtml(`/properties/rent-schedule/${rs['id']}/receipt`).catch(() => alert('Could not open the receipt.'))}
                    className="text-xs text-blue-400 hover:text-blue-300 ml-1">
                    {t('tenancy.receipt', 'Receipt')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {payModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-base font-semibold mb-4">{t('tenancy.recordPayment', 'Record Payment')} — {String(payModal['tenant_name'])}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.amountPaid', 'Amount Paid (TTD)')}</label>
                <input type="number" className={cls} value={payForm.paid_amount_ttd} onChange={setP('paid_amount_ttd')} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.paymentDate', 'Date')}</label>
                <input type="date" className={cls} value={payForm.paid_date} onChange={setP('paid_date')} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.method', 'Method')}</label>
                <select className={cls} value={payForm.payment_method} onChange={setP('payment_method')}>
                  {['BANK_TRANSFER','CHEQUE','CASH'].map(m => <option key={m} value={m}>{m.replace(/_/g,' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.reference', 'Reference')}</label>
                <input className={cls} value={payForm.payment_reference} onChange={setP('payment_reference')} />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setPayModal(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel','Cancel')}</button>
              <button onClick={() => payMut.mutate(String(payModal['id']))} disabled={payMut.isPending || !payForm.paid_amount_ttd}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
                {payMut.isPending ? t('common.saving','Saving...') : t('common.save','Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
