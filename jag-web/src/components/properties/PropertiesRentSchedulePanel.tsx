import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'
import { api } from '../../api/client'
import AuthedImg from '../AuthedImg'

const STATUS_COLORS: Record<string, string> = {
  UPCOMING:     'bg-slate-700 text-slate-300 border-slate-600',
  REMINDER_SENT:'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  PAID:         'bg-green-900/50 text-green-300 border-green-700',
  PARTIAL:      'bg-orange-900/50 text-orange-300 border-orange-700',
  LATE:         'bg-red-900/50 text-red-300 border-red-700',
  WAIVED:       'bg-slate-700 text-slate-500 border-slate-600',
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

// due_date is a PG DATE and arrives as 'YYYY-MM-DD' or a midnight-UTC ISO
// timestamp. Rendering it raw printed '2026-08-01T00:00:00.000Z' on screen;
// passing it through `new Date(iso)` would instead render 31 July in Trinidad.
// Build the local date from the Y/M/D parts explicitly.
const fmtDue = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  if (!s) return '—'
  const d = new Date(`${s.slice(0, 10)}T00:00:00`)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function PropertiesRentSchedulePanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [ocrOnly, setOcrOnly] = useState(false)
  const [payModal, setPayModal] = useState<Record<string, unknown> | null>(null)
  const [payForm, setPayForm] = useState({ paid_amount_ttd: '', paid_date: new Date().toISOString().slice(0,10), payment_method: 'BANK_TRANSFER', payment_reference: '', idempotency_key: crypto.randomUUID() })

  const { data: schedule = [] } = useQuery({
    queryKey: ['rent-schedule', statusFilter, ocrOnly],
    queryFn: () => tenancyApi.getRentSchedule({
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(ocrOnly ? { ocr_review_needed: 'true' } : {}),
    }),
  })

  const { data: ocrPending = [] } = useQuery({
    queryKey: ['rent-schedule-ocr-count'],
    queryFn: () => tenancyApi.getRentSchedule({ ocr_review_needed: 'true' }),
    refetchInterval: 60_000,
  })

  const payMut = useMutation({
    mutationFn: (id: string) => tenancyApi.recordPayment(id, {
      ...payForm,
      paid_amount_ttd: parseFloat(payForm.paid_amount_ttd),
    }),
    onSuccess: () => {
      setPayModal(null)
      qc.invalidateQueries({ queryKey: ['rent-schedule'] })
      qc.invalidateQueries({ queryKey: ['rent-schedule-ocr-count'] })
    },
  })

  const dismissOcrMut = useMutation({
    mutationFn: (id: string) => tenancyApi.dismissRentOcrReview(id),
    onSuccess: () => {
      setPayModal(null)
      qc.invalidateQueries({ queryKey: ['rent-schedule'] })
      qc.invalidateQueries({ queryKey: ['rent-schedule-ocr-count'] })
    },
  })

  const setP = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setPayForm(f => ({ ...f, [k]: e.target.value }))

  // Pre-fills the Record Payment modal from the WhatsApp OCR extract so
  // confirming is a review-and-click, not re-typing the whole form — Robert
  // still has to look at the slip photo and press Save before anything sends.
  const openReview = (rs: Record<string, unknown>) => {
    setPayModal(rs)
    setPayForm({
      paid_amount_ttd: rs['ocr_extracted_amount_ttd'] != null ? String(rs['ocr_extracted_amount_ttd']) : String(rs['amount_due_ttd'] ?? ''),
      paid_date: rs['ocr_extracted_date'] ? String(rs['ocr_extracted_date']).slice(0, 10) : new Date().toISOString().slice(0, 10),
      payment_method: 'BANK_TRANSFER',
      payment_reference: '',
      idempotency_key: crypto.randomUUID(),
    })
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <label htmlFor="rent-status-filter" className="text-xs text-slate-400 uppercase tracking-wide">
          {t('tenancy.filterStatus', 'Status')}
        </label>
        <select id="rent-status-filter" className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100"
          value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">{t('tenancy.allStatuses', 'All statuses')}</option>
          {['UPCOMING','REMINDER_SENT','PAID','PARTIAL','LATE','WAIVED'].map(s =>
            <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => setOcrOnly(v => !v)}
          className={`text-xs px-2.5 py-1.5 rounded border ${ocrOnly ? 'bg-amber-900/50 border-amber-600 text-amber-300' : 'bg-slate-700 border-slate-600 text-slate-300 hover:text-slate-100'}`}>
          {t('tenancy.ocrReviewFilter', 'Needs Payment-Slip Review')}
          {ocrPending.length > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-600 text-white text-[10px]">{ocrPending.length}</span>}
        </button>
        <span className="ml-auto text-xs text-slate-500">
          {t('tenancy.periodCount', '{{n}} periods', { n: schedule.length })}
        </span>
      </div>

      {schedule.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">{t('tenancy.noSchedule', 'No rent schedule found.')}</p>}
      <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="text-xs text-slate-500 border-b border-slate-700">
            <th className="text-left pb-2 pr-4">{t('tenancy.tenant', 'Tenant')}</th>
            <th className="text-left pb-2 pr-4">{t('tenancy.unit', 'Unit')}</th>
            <th className="text-left pb-2 pr-4">{t('tenancy.period', 'Period')}</th>
            <th className="text-left pb-2 pr-4">{t('tenancy.dueDate', 'Due Date')}</th>
            <th className="text-right pb-2 pr-4">{t('tenancy.amountDue', 'Amount Due')}</th>
            <th className="text-left pb-2 pr-4">{t('tenancy.status', 'Status')}</th>
            <th className="text-left pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((rs: Record<string, unknown>) => (
            <tr key={String(rs['id'])} className="border-b border-slate-800 hover:bg-slate-800/50">
              <td className="py-2 pr-4 text-slate-300">
                {String(rs['tenant_name'])}
                {/* The reminder batch does `if (!row.tenant_phone) continue` — a
                    row with no phone is skipped with no error and no log, so the
                    only place that can ever surface it is here. */}
                {!rs['tenant_phone'] && (
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded border border-amber-700 text-amber-400 align-middle"
                    title={t('tenancy.noPhoneHint', 'No phone on this row — WhatsApp rent reminders for it are skipped silently. Add a phone to the tenant record, then regenerate the schedule.')}>
                    {t('tenancy.noPhone', 'no phone')}
                  </span>
                )}
              </td>
              <td className="py-2 pr-4 text-slate-400">{String(rs['unit_number'] ?? '—')}</td>
              <td className="py-2 pr-4 text-slate-400">{String(rs['period_year'])}-{String(rs['period_month']).padStart(2,'0')}</td>
              <td className="py-2 pr-4 text-slate-400 whitespace-nowrap">{fmtDue(rs['due_date'])}</td>
              <td className="py-2 pr-4 text-right text-slate-200 font-mono whitespace-nowrap">
                TTD ${parseFloat(String(rs['amount_due_ttd'] ?? 0)).toLocaleString('en-TT', { minimumFractionDigits: 2 })}
              </td>
              <td className="py-2 pr-4">
                <span className={`text-xs px-2 py-0.5 rounded border whitespace-nowrap ${STATUS_COLORS[String(rs['status'])] ?? ''}`}>
                  {String(rs['status'])}
                </span>
                {Boolean(rs['ocr_review_needed']) && (
                  <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded border border-amber-600 bg-amber-900/50 text-amber-300 whitespace-nowrap"
                    title={t('tenancy.ocrReviewHint', 'A tenant sent a WhatsApp payment-slip photo — OCR read the amount/date below. Nothing is recorded and no receipt is sent until you confirm.')}>
                    {t('tenancy.ocrReview', 'slip received')}
                  </span>
                )}
              </td>
              <td className="py-2">
                {Boolean(rs['ocr_review_needed']) ? (
                  <button onClick={() => openReview(rs)}
                    className="px-2 py-0.5 text-xs bg-amber-700 hover:bg-amber-600 text-white rounded">
                    {t('tenancy.reviewSlip', 'Review Slip')}
                  </button>
                ) : ['UPCOMING','REMINDER_SENT','LATE'].includes(String(rs['status'])) && (
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
      </div>

      {payModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-base font-semibold mb-1">
              {Boolean(payModal['ocr_review_needed'])
                ? t('tenancy.reviewSlipTitle', 'Confirm Payment')
                : t('tenancy.recordPayment', 'Record Payment')} — {String(payModal['tenant_name'])}
            </h3>

            {Boolean(payModal['ocr_review_needed']) && (
              <div className="mb-4">
                <p className="text-xs text-amber-400 mb-2">
                  {t('tenancy.ocrReviewNote', 'Sent via WhatsApp — check the slip against the amount below, then confirm. No receipt goes to the tenant until you press Save.')}
                  {payModal['ocr_confidence'] ? ` (${t('tenancy.ocrConfidence', 'OCR confidence')}: ${String(payModal['ocr_confidence'])})` : ''}
                </p>
                <AuthedImg
                  path={`/properties/rent-schedule/${String(payModal['id'])}/payment-slip`}
                  alt={t('tenancy.paymentSlip', 'Payment slip')}
                  className="w-full max-h-72 object-contain rounded border border-slate-600 bg-slate-900"
                />
              </div>
            )}

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
              {Boolean(payModal['ocr_review_needed']) && (
                <button onClick={() => dismissOcrMut.mutate(String(payModal['id']))} disabled={dismissOcrMut.isPending}
                  className="px-4 py-2 text-sm text-red-400 hover:text-red-300 mr-auto disabled:opacity-40">
                  {t('tenancy.notAPayment', 'Not a payment — dismiss')}
                </button>
              )}
              <button onClick={() => setPayModal(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel','Cancel')}</button>
              <button onClick={() => payMut.mutate(String(payModal['id']))} disabled={payMut.isPending || !payForm.paid_amount_ttd}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
                {payMut.isPending ? t('common.saving','Saving...') : t('tenancy.confirmAndSendReceipt', 'Confirm & Send Receipt')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
