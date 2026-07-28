import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'
import { propertiesApi } from '../../api/properties'
import { api } from '../../api/client'

const STATUS_COLORS: Record<string, string> = {
  HELD:              'bg-blue-900/50 text-blue-300 border-blue-700',
  PARTIALLY_RETURNED:'bg-orange-900/50 text-orange-300 border-orange-700',
  RETURNED:          'bg-green-900/50 text-green-300 border-green-700',
  FORFEITED:         'bg-red-900/50 text-red-300 border-red-700',
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function PropertiesDepositsPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [reconcileId, setReconcileId] = useState<string | null>(null)
  const [form, setForm] = useState({ application_id: '', property_id: '', unit_id: '', tenant_id: '', tenant_name: '', amount_ttd: '', months_equivalent: '', payment_method: 'BANK_TRANSFER', received_date: new Date().toISOString().slice(0,10), reference_bank: '', reference_number: '', held_in_account: '' })
  const [recForm, setRecForm] = useState({ deductions_ttd: '0', deduction_notes: '', refund_amount_ttd: '', refund_date: '', status: 'RETURNED', tenant_signed_off: false })

  const { data: deposits = [] } = useQuery({ queryKey: ['deposits'], queryFn: () => tenancyApi.getDeposits() })

  // APPROVED applications already have the tenant's name/unit on file, so a deposit
  // taken right after approval -- before any lease exists -- can still resolve to the
  // right tenant and send its WhatsApp receipt immediately (see deposits.ts).
  const { data: approvedApps = [] } = useQuery({
    queryKey: ['applications', 'APPROVED'],
    queryFn: () => tenancyApi.getApplications({ status: 'APPROVED' }),
    enabled: showAdd,
  })

  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => propertiesApi.getProperties(),
    enabled: showAdd,
  })

  const { data: units = [] } = useQuery({
    queryKey: ['properties', form.property_id, 'units'],
    queryFn: () => propertiesApi.getUnits(form.property_id),
    enabled: showAdd && !!form.property_id,
  })

  // Picking a tenant here is what makes the deposit show up on that tenant's record.
  // Without it the deposit can only reach a tenant through a lease that may not exist
  // for weeks -- which is exactly how deposits went missing from tenant records.
  const { data: tenants = [] } = useQuery({
    queryKey: ['properties', 'tenants', ''],
    queryFn: () => propertiesApi.getTenants(),
    enabled: showAdd,
  })

  const tenantLabel = (tn: { is_company: boolean; company_name: string | null; first_name: string; last_name: string | null }) =>
    tn.is_company ? (tn.company_name ?? '—') : `${tn.first_name}${tn.last_name ? ` ${tn.last_name}` : ''}`

  const selectApplication = (appId: string) => {
    const app = approvedApps.find((a: Record<string, unknown>) => String(a['id']) === appId)
    setForm(f => ({
      ...f,
      application_id: appId,
      property_id:  app ? String(app['property_id'] ?? '') : f.property_id,
      unit_id:      app ? String(app['unit_id'] ?? '') : f.unit_id,
      tenant_id:    app ? String(app['tenant_id'] ?? '') : f.tenant_id,
      tenant_name:  app ? String(app['full_name'] ?? '') : f.tenant_name,
    }))
  }

  const selectTenant = (tenantId: string) => {
    const tn = tenants.find(x => x.id === tenantId)
    setForm(f => ({
      ...f,
      tenant_id: tenantId,
      tenant_name: tn ? tenantLabel(tn) : f.tenant_name,
    }))
  }

  const createMut = useMutation({
    mutationFn: () => tenancyApi.createDeposit({
      ...form,
      property_id: undefined,          // UI-only — narrows the unit picker, not a column
      application_id: form.application_id || undefined,
      tenant_id: form.tenant_id || undefined,
      amount_ttd: parseFloat(form.amount_ttd),
      months_equivalent: parseFloat(form.months_equivalent) || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: () => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['deposits'] }) },
  })

  const reconcileMut = useMutation({
    mutationFn: (id: string) => tenancyApi.reconcileDeposit(id, { ...recForm, deductions_ttd: parseFloat(recForm.deductions_ttd), refund_amount_ttd: parseFloat(recForm.refund_amount_ttd) }),
    onSuccess: () => { setReconcileId(null); qc.invalidateQueries({ queryKey: ['deposits'] }) },
  })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }))
  const setR = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setRecForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded">
          + {t('tenancy.recordDeposit', 'Record Deposit')}
        </button>
      </div>

      {deposits.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">{t('tenancy.noDeposits', 'No deposits recorded.')}</p>}
      <div className="space-y-3">
        {deposits.map((d: Record<string, unknown>) => (
          <div key={String(d['id'])} className="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-200">{String(d['tenant_name'])}</p>
                <p className="text-xs text-slate-400">Unit {String(d['unit_number'] ?? '—')} · {String(d['received_date'])}</p>
                <p className="text-sm font-mono text-slate-300 mt-1">
                  TTD ${parseFloat(String(d['amount_ttd'] ?? 0)).toLocaleString('en-TT', { minimumFractionDigits: 2 })}
                  {Boolean(d['months_equivalent']) && <span className="text-xs text-slate-500 ml-1">({String(d['months_equivalent'])} months)</span>}
                </p>
                <p className="text-xs text-slate-500">{String(d['payment_method'] ?? '')} · {String(d['reference_number'] ?? '')}</p>
                <p className="text-xs text-slate-500">{t('tenancy.receiptNo', 'Receipt')}: {String(d['receipt_number'] ?? '—')}
                  <button onClick={() => void api.openHtml(`/properties/deposits/${String(d['id'])}/receipt`).catch(() => alert('Could not open the receipt.'))}
                    className="text-blue-400 hover:text-blue-300 ml-2">{t('tenancy.printReceipt', 'Print receipt')}</button>
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLORS[String(d['status'])] ?? ''}`}>{String(d['status'])}</span>
            </div>
            {String(d['status']) === 'HELD' && (
              <button onClick={() => { setReconcileId(String(d['id'])); setRecForm(f => ({ ...f, refund_amount_ttd: String(d['amount_ttd']) })) }}
                className="mt-3 px-3 py-1 text-xs bg-orange-700 hover:bg-orange-600 text-white rounded">
                {t('tenancy.reconcile', 'Exit Reconciliation')}
              </button>
            )}
            {Boolean(d['deductions_ttd']) && parseFloat(String(d['deductions_ttd'])) > 0 && (
              <p className="text-xs text-red-400 mt-2">{t('tenancy.deductions', 'Deductions')}: TTD ${parseFloat(String(d['deductions_ttd'])).toFixed(2)} — {String(d['deduction_notes'] ?? '')}</p>
            )}
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md overflow-y-auto max-h-[90vh]">
            <h2 className="text-lg font-semibold mb-4">{t('tenancy.recordDeposit', 'Record Deposit')}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.fromApprovedApp', 'From Approved Application (optional)')}</label>
                <select className={cls} value={form.application_id} onChange={e => selectApplication(e.target.value)}>
                  <option value="">{t('tenancy.fromApprovedAppNone', '— None, enter manually —')}</option>
                  {approvedApps.map((a: Record<string, unknown>) => (
                    <option key={String(a['id'])} value={String(a['id'])}>
                      {String(a['full_name'])} — {String(a['unit_number'] ?? '')} {String(a['property_name'] ?? '')}
                    </option>
                  ))}
                </select>
                {form.application_id && (
                  <p className="text-xs text-slate-500 mt-1">{t('tenancy.fromApprovedAppHint', "Receipt will be sent to this applicant's phone on file — no lease needed yet.")}</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.property', 'Property')}</label>
                <select
                  className={cls}
                  value={form.property_id}
                  onChange={e => setForm(f => ({ ...f, property_id: e.target.value, unit_id: '' }))}
                >
                  <option value="">{t('tenancy.selectProperty', '— Select property —')}</option>
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.unit', 'Unit')}</label>
                <select className={cls} value={form.unit_id} onChange={set('unit_id')} disabled={!form.property_id}>
                  <option value="">
                    {form.property_id
                      ? t('tenancy.selectUnit', '— Select unit —')
                      : t('tenancy.selectPropertyFirst', '— Select a property first —')}
                  </option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.tenant', 'Tenant')}</label>
                <select className={cls} value={form.tenant_id} onChange={e => selectTenant(e.target.value)}>
                  <option value="">{t('tenancy.tenantUnlinked', '— Not a registered tenant —')}</option>
                  {tenants.map(tn => <option key={tn.id} value={tn.id}>{tenantLabel(tn)}</option>)}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  {form.tenant_id
                    ? t('tenancy.tenantLinkedHint', 'This deposit will appear on the tenant record straight away.')
                    : t('tenancy.tenantUnlinkedHint', 'Leave unset only if the payer has no tenant record yet — the deposit will not show under any tenant until one is linked.')}
                </p>
              </div>

              {[['tenant_name','Tenant Name (as it appears on the receipt)'],['amount_ttd','Amount TTD'],['months_equivalent','Months Equivalent'],['received_date','Received Date'],['reference_bank','Bank'],['reference_number','Bank Reference'],['held_in_account','Held in Account']].map(([k,label]) => (
                <div key={k}>
                  <label className="block text-xs text-slate-400 mb-1">{label}</label>
                  <input type={k === 'received_date' ? 'date' : 'text'} className={cls} value={(form as Record<string,string>)[k] ?? ''} onChange={set(k)} />
                </div>
              ))}
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.method', 'Method')}</label>
                <select className={cls} value={form.payment_method} onChange={set('payment_method')}>
                  {['BANK_TRANSFER','CHEQUE','CASH'].map(m => <option key={m} value={m}>{m.replace(/_/g,' ')}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel','Cancel')}</button>
              <button
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending || !form.unit_id || !form.tenant_name || !(parseFloat(form.amount_ttd) > 0)}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
                {createMut.isPending ? t('common.saving','Saving...') : t('common.save','Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {reconcileId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">{t('tenancy.exitReconciliation', 'Exit Reconciliation')}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.deductions', 'Deductions TTD')}</label>
                <input type="number" className={cls} value={recForm.deductions_ttd} onChange={setR('deductions_ttd')} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.deductionNotes', 'Deduction Notes')}</label>
                <textarea className={cls} rows={2} value={recForm.deduction_notes} onChange={setR('deduction_notes')} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.refundAmount', 'Refund Amount TTD')}</label>
                <input type="number" className={cls} value={recForm.refund_amount_ttd} onChange={setR('refund_amount_ttd')} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.refundDate', 'Refund Date')}</label>
                <input type="date" className={cls} value={recForm.refund_date} onChange={setR('refund_date')} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.outcome', 'Outcome')}</label>
                <select className={cls} value={recForm.status} onChange={setR('status')}>
                  {['RETURNED','PARTIALLY_RETURNED','FORFEITED'].map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setReconcileId(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel','Cancel')}</button>
              <button onClick={() => reconcileMut.mutate(reconcileId)} disabled={reconcileMut.isPending}
                className="px-4 py-2 text-sm bg-orange-700 hover:bg-orange-600 text-white rounded disabled:opacity-40">
                {reconcileMut.isPending ? t('common.saving','Saving...') : t('tenancy.confirm', 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
