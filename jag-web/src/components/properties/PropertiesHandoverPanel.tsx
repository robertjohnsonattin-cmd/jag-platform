import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function PropertiesHandoverPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [unitId, setUnitId] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [form, setForm] = useState({
    unit_id: '', lease_id: '', type: 'ENTRY' as 'ENTRY' | 'EXIT',
    tec_meter_reading: '', tec_account_number: '', wasa_meter_reading: '', wasa_account_number: '',
    keys_issued: '0', gate_remotes_issued: '0', notes: '',
  })

  const { data: checklists = [] } = useQuery({
    queryKey: ['handover', unitId],
    queryFn: () => tenancyApi.getHandoverByUnit(unitId),
    enabled: !!unitId,
  })

  const { data: comparison } = useQuery({
    queryKey: ['handover-compare', compareId],
    queryFn: () => tenancyApi.compareHandover(compareId!),
    enabled: !!compareId,
  })

  const createMut = useMutation({
    mutationFn: () => tenancyApi.createHandover({
      ...form,
      keys_issued: parseInt(form.keys_issued) || 0,
      gate_remotes_issued: parseInt(form.gate_remotes_issued) || 0,
      lease_id: form.lease_id || undefined,
    }),
    onSuccess: () => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['handover', unitId] }) },
  })

  const signMut = useMutation({
    mutationFn: ({ id, field }: { id: string; field: 'tenant_signed' | 'manager_signed' }) =>
      tenancyApi.patchHandover(id, { [field]: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['handover', unitId] }),
  })

  const [signingUrls, setSigningUrls] = useState<{ landlord?: string; tenant?: string } | null>(null)
  const [signingRole, setSigningRole] = useState<'TENANT' | 'LANDLORD'>('TENANT')

  const sendForSigningMut = useMutation({
    mutationFn: (id: string) => tenancyApi.sendHandoverForSigning(id),
    onSuccess: (result) => {
      setSigningUrls({ landlord: result.landlordSigningUrl, tenant: result.tenantSigningUrl })
      setSigningRole('TENANT')
    },
    onError: () => alert('Could not start digital signing for this checklist.'),
  })

  const closeSigningModal = () => {
    setSigningUrls(null)
    void qc.invalidateQueries({ queryKey: ['handover', unitId] })
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <input className={cls} style={{ maxWidth: 300 }} placeholder={t('tenancy.enterUnitId', 'Enter Unit ID to load checklists...')}
          value={unitId} onChange={e => setUnitId(e.target.value)} />
        <button onClick={() => { setForm(f => ({ ...f, unit_id: unitId })); setShowCreate(true) }}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded">
          + {t('tenancy.newChecklist', 'New Checklist')}
        </button>
      </div>

      {!unitId && <p className="text-sm text-slate-500 py-6 text-center">{t('tenancy.enterUnitIdPrompt', 'Enter a Unit ID above to view handover checklists.')}</p>}
      {unitId && checklists.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">{t('tenancy.noChecklists', 'No checklists for this unit yet.')}</p>}

      <div className="space-y-3">
        {checklists.map((cl: Record<string, unknown>) => (
          <div key={String(cl['id'])} className="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-xs px-2 py-0.5 rounded border ${String(cl['type']) === 'ENTRY' ? 'bg-green-900/50 text-green-300 border-green-700' : 'bg-orange-900/50 text-orange-300 border-orange-700'}`}>
                  {String(cl['type'])}
                </span>
                <p className="text-xs text-slate-400 mt-1">{new Date(String(cl['created_at'])).toLocaleDateString('en-TT')}</p>
              </div>
              <div className="flex gap-2 items-center">
                {String(cl['type']) === 'EXIT' && (
                  <button onClick={() => setCompareId(String(cl['id']))} className="text-xs text-blue-400 hover:text-blue-300">
                    {t('tenancy.compareWithEntry', 'Compare vs Entry')}
                  </button>
                )}
                {!cl['tenant_signed'] && !cl['manager_signed'] && (
                  <button onClick={() => sendForSigningMut.mutate(String(cl['id']))}
                    disabled={sendForSigningMut.isPending}
                    className="text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white px-2 py-0.5 rounded">
                    ✍ {t('tenancy.signNow', 'Sign Now')}
                  </button>
                )}
                {!cl['tenant_signed'] && (
                  <button onClick={() => signMut.mutate({ id: String(cl['id']), field: 'tenant_signed' })}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-0.5 rounded"
                    title="Offline fallback — use only if digital signing isn't possible">
                    {t('tenancy.tenantSign', 'Tenant Sign (manual)')}
                  </button>
                )}
                {Boolean(cl['tenant_signed']) && !cl['manager_signed'] && (
                  <button onClick={() => signMut.mutate({ id: String(cl['id']), field: 'manager_signed' })}
                    className="text-xs bg-green-800 hover:bg-green-700 text-white px-2 py-0.5 rounded"
                    title="Offline fallback — use only if digital signing isn't possible">
                    {t('tenancy.managerSign', 'Manager Sign (manual)')}
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-slate-400">
              <span>{t('tenancy.tecReading', 'TEC')}: {String(cl['tec_meter_reading'] ?? '—')}</span>
              <span>{t('tenancy.wasaReading', 'WASA')}: {String(cl['wasa_meter_reading'] ?? '—')}</span>
              <span>{t('tenancy.keysIssued', 'Keys')}: {String(cl['keys_issued'] ?? 0)}</span>
              <span>{t('tenancy.tenantSigned', 'Tenant signed')}: {cl['tenant_signed'] ? '✓' : '—'}</span>
            </div>
          </div>
        ))}
      </div>

      {compareId && comparison && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-2xl overflow-y-auto max-h-[90vh]">
            <h2 className="text-lg font-semibold mb-4">{t('tenancy.entryVsExit', 'Entry vs Exit Comparison')}</h2>
            <div className="grid grid-cols-2 gap-4">
              {['entry', 'exit'].map(type => {
                const cl = (comparison as Record<string,unknown>)[type] as Record<string,unknown> | null
                return (
                  <div key={type}>
                    <p className="text-sm font-semibold text-slate-300 mb-2">{type.toUpperCase()}</p>
                    {!cl && <p className="text-xs text-slate-500">{t('tenancy.noChecklist', 'No checklist')}</p>}
                    {cl && (
                      <div className="space-y-1 text-xs text-slate-400">
                        <p>TEC: {String(cl['tec_meter_reading'] ?? '—')}</p>
                        <p>WASA: {String(cl['wasa_meter_reading'] ?? '—')}</p>
                        <p>{t('tenancy.keysIssued','Keys')}: {String(cl['keys_issued'] ?? 0)} / returned: {String(cl['keys_returned'] ?? '—')}</p>
                        <p className="text-slate-300 font-medium mt-2">{t('tenancy.conditionItems','Condition Items')}</p>
                        {((cl['condition_items'] as unknown[]) ?? []).map((item: unknown, i: number) => {
                          const it = item as Record<string, unknown>
                          return <p key={i} className="pl-2">{String(it['item'])}: {String(it['condition'])} {it['notes'] ? `— ${it['notes']}` : ''}</p>
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setCompareId(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.close','Close')}</button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md overflow-y-auto max-h-[90vh]">
            <h2 className="text-lg font-semibold mb-4">{t('tenancy.newChecklist','New Handover Checklist')}</h2>
            <div className="space-y-3">
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.type','Type')}</label>
                <select className={cls} value={form.type} onChange={set('type') as React.ChangeEventHandler<HTMLSelectElement>}><option value="ENTRY">ENTRY</option><option value="EXIT">EXIT</option></select>
              </div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.leaseId','Lease ID (optional)')}</label><input className={cls} value={form.lease_id} onChange={set('lease_id')} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="block text-xs text-slate-400 mb-1">TEC Reading</label><input className={cls} value={form.tec_meter_reading} onChange={set('tec_meter_reading')} /></div>
                <div><label className="block text-xs text-slate-400 mb-1">TEC Account</label><input className={cls} value={form.tec_account_number} onChange={set('tec_account_number')} /></div>
                <div><label className="block text-xs text-slate-400 mb-1">WASA Reading</label><input className={cls} value={form.wasa_meter_reading} onChange={set('wasa_meter_reading')} /></div>
                <div><label className="block text-xs text-slate-400 mb-1">WASA Account</label><input className={cls} value={form.wasa_account_number} onChange={set('wasa_account_number')} /></div>
                <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.keysIssued','Keys Issued')}</label><input type="number" className={cls} value={form.keys_issued} onChange={set('keys_issued')} /></div>
                <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.remotes','Remotes')}</label><input type="number" className={cls} value={form.gate_remotes_issued} onChange={set('gate_remotes_issued')} /></div>
              </div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.notes','Notes')}</label><textarea className={cls} rows={2} value={form.notes} onChange={set('notes')} /></div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel','Cancel')}</button>
              <button onClick={() => createMut.mutate()} disabled={createMut.isPending}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
                {createMut.isPending ? t('common.saving','Saving...') : t('common.save','Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {signingUrls && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg w-full max-w-3xl h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <h2 className="text-lg font-semibold">
                {signingRole === 'TENANT' ? t('tenancy.tenantSigning', 'Tenant — please sign below') : t('tenancy.landlordSigning', 'Landlord — please sign below')}
              </h2>
              <button onClick={closeSigningModal} className="text-slate-400 hover:text-slate-200 text-sm">{t('common.close', 'Close')}</button>
            </div>
            <iframe
              key={signingRole}
              src={signingRole === 'TENANT' ? signingUrls.tenant : signingUrls.landlord}
              className="flex-1 w-full"
              title="Documenso signing"
            />
            <div className="flex justify-between items-center p-4 border-t border-slate-700">
              <p className="text-xs text-slate-500">{t('tenancy.signingHint', 'Hand the device to the other party once you\'re done signing.')}</p>
              {signingRole === 'TENANT' ? (
                <button onClick={() => setSigningRole('LANDLORD')} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded">
                  {t('tenancy.tenantDoneNowLandlord', "Tenant done — Landlord's turn")}
                </button>
              ) : (
                <button onClick={closeSigningModal} className="px-4 py-2 text-sm bg-green-700 hover:bg-green-600 text-white rounded">
                  {t('tenancy.bothSignedDone', 'Both signed — Done')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
