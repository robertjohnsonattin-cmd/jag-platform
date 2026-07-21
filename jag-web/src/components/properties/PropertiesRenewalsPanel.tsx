import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'

const RESPONSE_COLORS: Record<string, string> = {
  RENEWING:    'bg-green-900/50 text-green-300 border-green-700',
  VACATING:    'bg-red-900/50 text-red-300 border-red-700',
  DISCUSSING:  'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  NO_RESPONSE: 'bg-slate-700 text-slate-400 border-slate-600',
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function PropertiesRenewalsPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [renewModal, setRenewModal] = useState(false)
  const [vacateModal, setVacateModal] = useState(false)
  const [renewForm, setRenewForm] = useState({ new_rent_ttd: '', new_start_date: '', new_end_date: '' })
  const [vacateForm, setVacateForm] = useState({ vacating_date: '', exit_inspection_scheduled_at: '' })

  const { data: renewals = [] } = useQuery({ queryKey: ['renewals'], queryFn: () => tenancyApi.getRenewals() })

  const patchMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => tenancyApi.patchRenewal(selected!, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['renewals'] }),
  })

  const renewMut = useMutation({
    mutationFn: () => tenancyApi.processRenewal(selected!, { ...renewForm, new_rent_ttd: parseFloat(renewForm.new_rent_ttd) }),
    onSuccess: () => { setRenewModal(false); qc.invalidateQueries({ queryKey: ['renewals'] }) },
  })

  const vacateMut = useMutation({
    mutationFn: () => tenancyApi.processVacate(selected!, vacateForm),
    onSuccess: () => { setVacateModal(false); qc.invalidateQueries({ queryKey: ['renewals'] }) },
  })

  return (
    <div>
      {renewals.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">{t('tenancy.noRenewals','No leases approaching expiry.')}</p>}
      <div className="space-y-3">
        {renewals.map((r: Record<string, unknown>) => {
          const daysLeft = Number(r['days_remaining'] ?? 0)
          return (
            <div key={String(r['id'])}
              onClick={() => setSelected(String(r['id']))}
              className={`p-4 rounded-lg border cursor-pointer transition-colors ${selected === String(r['id']) ? 'border-blue-500 bg-slate-700' : 'border-slate-700 bg-slate-800 hover:bg-slate-750'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-200">{String(r['property_name'] ?? '—')} — Unit {String(r['unit_number'] ?? '—')}</p>
                  <p className="text-xs text-slate-400">{t('tenancy.leaseEnd','Lease Ends')}: {String(r['lease_end_date'])}</p>
                  <p className={`text-xs mt-1 font-semibold ${daysLeft <= 14 ? 'text-red-400' : daysLeft <= 30 ? 'text-orange-400' : 'text-yellow-400'}`}>
                    {daysLeft} {t('tenancy.daysRemaining','days remaining')}
                  </p>
                  <p className="text-xs text-slate-500">Rent: TTD ${parseFloat(String(r['monthly_rent'] ?? 0)).toFixed(2)}</p>
                </div>
                <div className="text-right">
                  {r['tenant_response']
                    ? <span className={`text-xs px-2 py-0.5 rounded border ${RESPONSE_COLORS[String(r['tenant_response'])] ?? ''}`}>{String(r['tenant_response']).replace(/_/g,' ')}</span>
                    : <span className="text-xs text-slate-500">{t('tenancy.awaitingResponse','Awaiting Response')}</span>
                  }
                </div>
              </div>

              {selected === String(r['id']) && (
                <div className="mt-3 pt-3 border-t border-slate-700 flex gap-2 flex-wrap">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{t('tenancy.tenantResponse','Tenant Response')}</label>
                    <select className={cls} style={{ width: 180 }} value={String(r['tenant_response'] ?? '')}
                      onChange={e => patchMut.mutate({ tenant_response: e.target.value })}>
                      <option value="">{t('tenancy.selectResponse','— Select —')}</option>
                      {['RENEWING','VACATING','DISCUSSING','NO_RESPONSE'].map(opt => <option key={opt} value={opt}>{opt.replace(/_/g,' ')}</option>)}
                    </select>
                  </div>
                  {String(r['tenant_response']) === 'RENEWING' && (
                    <button onClick={() => { setRenewModal(true); setRenewForm(f => ({ ...f, new_rent_ttd: String(r['monthly_rent']) })) }}
                      className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded self-end">
                      {t('tenancy.processRenewal','Process Renewal')}
                    </button>
                  )}
                  {String(r['tenant_response']) === 'VACATING' && (
                    <button onClick={() => setVacateModal(true)}
                      className="px-3 py-1.5 text-xs bg-orange-700 hover:bg-orange-600 text-white rounded self-end">
                      {t('tenancy.processVacate','Process Vacate')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {renewModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">{t('tenancy.processRenewal','Process Renewal')}</h2>
            <div className="space-y-3">
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.newRentTtd','New Rent TTD')}</label>
                <input type="number" className={cls} value={renewForm.new_rent_ttd} onChange={e => setRenewForm(f => ({ ...f, new_rent_ttd: e.target.value }))} /></div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.newStartDate','New Start Date')}</label>
                <input type="date" className={cls} value={renewForm.new_start_date} onChange={e => setRenewForm(f => ({ ...f, new_start_date: e.target.value }))} /></div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.newEndDate','New End Date')}</label>
                <input type="date" className={cls} value={renewForm.new_end_date} onChange={e => setRenewForm(f => ({ ...f, new_end_date: e.target.value }))} /></div>
            </div>
            <p className="text-xs text-slate-500 mt-2">{t('tenancy.renewalNote','A new lease will be created and rent schedule generated automatically.')}</p>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setRenewModal(false)} className="px-4 py-2 text-sm text-slate-400">{t('common.cancel','Cancel')}</button>
              <button onClick={() => renewMut.mutate()} disabled={renewMut.isPending || !renewForm.new_rent_ttd || !renewForm.new_start_date}
                className="px-4 py-2 text-sm bg-green-700 hover:bg-green-600 text-white rounded disabled:opacity-40">
                {renewMut.isPending ? t('common.saving','Saving...') : t('tenancy.createNewLease','Create New Lease')}
              </button>
            </div>
          </div>
        </div>
      )}

      {vacateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">{t('tenancy.processVacate','Process Vacate')}</h2>
            <div className="space-y-3">
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.vacatingDate','Vacating Date')}</label>
                <input type="date" className={cls} value={vacateForm.vacating_date} onChange={e => setVacateForm(f => ({ ...f, vacating_date: e.target.value }))} /></div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.exitInspectionDate','Exit Inspection Date/Time')}</label>
                <input type="datetime-local" className={cls} value={vacateForm.exit_inspection_scheduled_at} onChange={e => setVacateForm(f => ({ ...f, exit_inspection_scheduled_at: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setVacateModal(false)} className="px-4 py-2 text-sm text-slate-400">{t('common.cancel','Cancel')}</button>
              <button onClick={() => vacateMut.mutate()} disabled={vacateMut.isPending || !vacateForm.vacating_date}
                className="px-4 py-2 text-sm bg-red-800 hover:bg-red-700 text-white rounded disabled:opacity-40">
                {vacateMut.isPending ? t('common.saving','Saving...') : t('tenancy.confirmVacate','Confirm Vacate')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
