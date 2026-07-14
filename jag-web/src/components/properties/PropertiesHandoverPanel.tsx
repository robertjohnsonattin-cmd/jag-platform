import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'
import { propertiesApi } from '../../api/properties'
import type { Property, Unit } from '../../types/properties'

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

// Same 27-item list as Schedule C in the lease PDF (jag-api/src/lib/lease-pdf.ts
// CHECKLIST_ITEMS) — kept in sync manually since the two projects don't share code.
const CONDITION_CHECKLIST_ITEMS = [
  'Living Room — walls, ceiling, floor',
  'Living Room — doors & windows',
  'Living Room — light fixtures & switches',
  'Living Room — ceiling fan(s)',
  'Dining Area — walls, ceiling, floor',
  'Kitchen — cabinets & counter-tops',
  'Kitchen — sink & taps',
  'Kitchen — light fixtures & switches',
  'Kitchen — appliances (if any)',
  'Bedroom(s) — walls, ceiling, floor',
  'Bedroom(s) — doors & windows',
  'Bedroom(s) — light fixtures & switches',
  'Bedroom(s) — ceiling fan(s)',
  'Bathroom — toilet bowl & cistern',
  'Bathroom — toilet seat & cover',
  'Bathroom — basin & taps',
  'Bathroom — shower/tub & fittings',
  'Bathroom — tiles & grouting',
  'Bathroom — light fixture & extractor',
  'Electrical — switches, sockets & panel',
  'Plumbing — taps & water pressure',
  'Air-conditioning unit(s)',
  'Locks & keys',
  'Gallery / Balcony',
  'Parking space',
  'Common area / stairwell',
]

const CONDITION_OPTIONS = ['', 'E', 'G', 'F', 'P', 'N/A']

interface ConditionItemForm { item: string; condition: string; notes: string }

function blankConditionItems(): ConditionItemForm[] {
  return CONDITION_CHECKLIST_ITEMS.map(item => ({ item, condition: '', notes: '' }))
}

export default function PropertiesHandoverPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [propertyId, setPropertyId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [editConditionsId, setEditConditionsId] = useState<string | null>(null)
  const [editConditionItems, setEditConditionItems] = useState<ConditionItemForm[]>([])
  const [form, setForm] = useState({
    unit_id: '', lease_id: '', type: 'ENTRY' as 'ENTRY' | 'EXIT',
    tec_meter_reading: '', tec_account_number: '', wasa_meter_reading: '', wasa_account_number: '',
    keys_issued: '0', gate_remotes_issued: '0', notes: '',
  })
  const [conditionItems, setConditionItems] = useState<ConditionItemForm[]>(blankConditionItems())

  const { data: properties = [] } = useQuery({
    queryKey: ['properties-picker'],
    queryFn: () => propertiesApi.getProperties({ limit: 500 }),
    staleTime: 60_000,
  })

  const { data: units = [] } = useQuery({
    queryKey: ['properties', propertyId, 'units-picker'],
    queryFn: () => propertiesApi.getUnits(propertyId),
    enabled: !!propertyId,
    staleTime: 60_000,
  })

  const { data: propertyLeases = [] } = useQuery({
    queryKey: ['properties', propertyId, 'leases-picker'],
    queryFn: () => propertiesApi.getLeases(propertyId),
    enabled: showCreate && !!propertyId,
    staleTime: 60_000,
  })
  // Lease type doesn't declare unit_id in its TS interface, but the backend
  // SELECTs la.* so it's present on every row — filter client-side by unit.
  const unitLeases = propertyLeases.filter((l) => (l as unknown as { unit_id?: string }).unit_id === unitId)

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
      condition_items: conditionItems.filter(ci => ci.condition || ci.notes),
    }),
    onSuccess: () => {
      setShowCreate(false)
      setConditionItems(blankConditionItems())
      qc.invalidateQueries({ queryKey: ['handover', unitId] })
    },
  })

  const saveConditionsMut = useMutation({
    mutationFn: () => tenancyApi.patchHandover(editConditionsId!, {
      condition_items: editConditionItems.filter(ci => ci.condition || ci.notes),
    }),
    onSuccess: () => { setEditConditionsId(null); qc.invalidateQueries({ queryKey: ['handover', unitId] }) },
  })

  const openEditConditions = (cl: Record<string, unknown>) => {
    const existing = ((cl['condition_items'] as ConditionItemForm[]) ?? [])
    const byItem = new Map(existing.map(ci => [ci.item, ci]))
    setEditConditionItems(CONDITION_CHECKLIST_ITEMS.map(item => ({
      item,
      condition: byItem.get(item)?.condition ?? '',
      notes: byItem.get(item)?.notes ?? '',
    })))
    setEditConditionsId(String(cl['id']))
  }

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
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select className={cls} style={{ maxWidth: 260 }}
          value={propertyId}
          onChange={e => { setPropertyId(e.target.value); setUnitId('') }}>
          <option value="">{t('tenancy.selectProperty', '— Select property —')}</option>
          {properties.map((p: Property) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className={cls} style={{ maxWidth: 200 }}
          value={unitId} onChange={e => setUnitId(e.target.value)} disabled={!propertyId}>
          <option value="">{t('tenancy.selectUnit', '— Select unit —')}</option>
          {units.map((u: Unit) => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
        </select>
        <button onClick={() => { setForm(f => ({ ...f, unit_id: unitId, lease_id: '' })); setShowCreate(true) }}
          disabled={!unitId}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded">
          + {t('tenancy.newChecklist', 'New Checklist')}
        </button>
      </div>

      {!unitId && <p className="text-sm text-slate-500 py-6 text-center">{t('tenancy.enterUnitIdPrompt', 'Select a property and unit above to view handover checklists.')}</p>}
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
                  <button onClick={() => openEditConditions(cl)} className="text-xs text-blue-400 hover:text-blue-300">
                    📋 {t('tenancy.editConditions', 'Condition Checklist')}
                  </button>
                )}
                {!cl['tenant_signed'] && !cl['manager_signed'] && (
                  <button onClick={() => sendForSigningMut.mutate(String(cl['id']))}
                    disabled={sendForSigningMut.isPending}
                    className="text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white px-2 py-0.5 rounded">
                    ✍ {t('tenancy.signNow', 'Sign Now')}
                  </button>
                )}
                {/* Manual fallback only makes sense when no real e-signing session has
                    been started — otherwise it's easy to mark this "signed" in our
                    records while Documenso still shows the tenant as NOT_SIGNED,
                    with no actual document ever produced (found session 44). */}
                {!cl['tenant_signed'] && !cl['documenso_document_id'] && (
                  <button onClick={() => signMut.mutate({ id: String(cl['id']), field: 'tenant_signed' })}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-0.5 rounded"
                    title="Offline fallback — use only if digital signing isn't possible">
                    {t('tenancy.tenantSign', 'Tenant Sign (manual)')}
                  </button>
                )}
                {Boolean(cl['tenant_signed']) && !cl['manager_signed'] && !cl['documenso_document_id'] && (
                  <button onClick={() => signMut.mutate({ id: String(cl['id']), field: 'manager_signed' })}
                    className="text-xs bg-green-800 hover:bg-green-700 text-white px-2 py-0.5 rounded"
                    title="Offline fallback — use only if digital signing isn't possible">
                    {t('tenancy.managerSign', 'Manager Sign (manual)')}
                  </button>
                )}
                {Boolean(cl['signed_pdf_object_key']) && (
                  <button onClick={() => tenancyApi.downloadHandoverSignedPdf(String(cl['id']))}
                    className="text-xs bg-emerald-800 hover:bg-emerald-700 text-white px-2 py-0.5 rounded">
                    ⬇ {t('tenancy.downloadSignedPdf', 'Signed PDF')}
                  </button>
                )}
              </div>
            </div>
            {Boolean(cl['documenso_document_id']) && !cl['signed_pdf_object_key'] && (
              <p className="text-xs text-amber-400 mt-2">
                {t('tenancy.awaitingDocumensoCompletion', 'Sent for e-signing — awaiting both parties to finish signing in Documenso.')}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-slate-400">
              <span>{t('tenancy.tecReading', 'TEC')}: {String(cl['tec_meter_reading'] ?? '—')}</span>
              <span>{t('tenancy.wasaReading', 'WASA')}: {String(cl['wasa_meter_reading'] ?? '—')}</span>
              <span>{t('tenancy.keysIssued', 'Keys')}: {String(cl['keys_issued'] ?? 0)}</span>
              <span>{t('tenancy.tenantSigned', 'Tenant signed')}: {cl['tenant_signed'] ? '✓' : '—'}</span>
              <span>
                {t('tenancy.conditionItems', 'Condition Items')}: {
                  ((cl['condition_items'] as unknown[]) ?? []).filter((ci) => (ci as Record<string, unknown>)['condition']).length
                } / {CONDITION_CHECKLIST_ITEMS.length}
              </span>
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
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.lease','Lease (optional)')}</label>
                <select className={cls} value={form.lease_id} onChange={set('lease_id')}>
                  <option value="">{t('tenancy.noLeaseLinked', '— Not linked to a lease —')}</option>
                  {unitLeases.map((lease) => {
                    const name = lease.is_company && lease.company_name
                      ? lease.company_name
                      : `${lease.first_name ?? ''} ${lease.last_name ?? ''}`.trim()
                    return <option key={lease.id} value={lease.id}>{name || 'Tenant'} · {lease.status}</option>
                  })}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="block text-xs text-slate-400 mb-1">TEC Reading</label><input className={cls} value={form.tec_meter_reading} onChange={set('tec_meter_reading')} /></div>
                <div><label className="block text-xs text-slate-400 mb-1">TEC Account</label><input className={cls} value={form.tec_account_number} onChange={set('tec_account_number')} /></div>
                <div><label className="block text-xs text-slate-400 mb-1">WASA Reading</label><input className={cls} value={form.wasa_meter_reading} onChange={set('wasa_meter_reading')} /></div>
                <div><label className="block text-xs text-slate-400 mb-1">WASA Account</label><input className={cls} value={form.wasa_account_number} onChange={set('wasa_account_number')} /></div>
                <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.keysIssued','Keys Issued')}</label><input type="number" className={cls} value={form.keys_issued} onChange={set('keys_issued')} /></div>
                <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.remotes','Remotes')}</label><input type="number" className={cls} value={form.gate_remotes_issued} onChange={set('gate_remotes_issued')} /></div>
              </div>
              <div><label className="block text-xs text-slate-400 mb-1">{t('tenancy.notes','Notes')}</label><textarea className={cls} rows={2} value={form.notes} onChange={set('notes')} /></div>

              <div className="pt-2 border-t border-slate-700">
                <p className="text-sm font-semibold text-slate-300 mb-1">{t('tenancy.conditionChecklist', 'Schedule C — Property Condition Checklist')}</p>
                <p className="text-xs text-slate-500 mb-2">{t('tenancy.conditionChecklistHint', 'E = Excellent · G = Good · F = Fair · P = Poor · N/A = Not Applicable')}</p>
                <ConditionItemsGrid items={conditionItems} onChange={setConditionItems} />
              </div>
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

      {editConditionsId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-lg overflow-y-auto max-h-[90vh]">
            <h2 className="text-lg font-semibold mb-1">{t('tenancy.conditionChecklist', 'Schedule C — Property Condition Checklist')}</h2>
            <p className="text-xs text-slate-500 mb-3">{t('tenancy.conditionChecklistHint', 'E = Excellent · G = Good · F = Fair · P = Poor · N/A = Not Applicable')}</p>
            <ConditionItemsGrid items={editConditionItems} onChange={setEditConditionItems} />
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setEditConditionsId(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel','Cancel')}</button>
              <button onClick={() => saveConditionsMut.mutate()} disabled={saveConditionsMut.isPending}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
                {saveConditionsMut.isPending ? t('common.saving','Saving...') : t('common.save','Save')}
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

function ConditionItemsGrid({ items, onChange }: { items: ConditionItemForm[]; onChange: (items: ConditionItemForm[]) => void }) {
  const updateItem = (idx: number, patch: Partial<ConditionItemForm>) => {
    onChange(items.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }
  return (
    <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
      {items.map((it, idx) => (
        <div key={it.item} className="grid grid-cols-[1fr_60px] gap-1.5 items-start bg-slate-900/40 rounded p-1.5">
          <div>
            <p className="text-xs text-slate-300 leading-tight">{it.item}</p>
            <input
              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 mt-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Notes"
              value={it.notes}
              onChange={e => updateItem(idx, { notes: e.target.value })}
            />
          </div>
          <select
            className="bg-slate-700 border border-slate-600 rounded px-1 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={it.condition}
            onChange={e => updateItem(idx, { condition: e.target.value })}
          >
            {CONDITION_OPTIONS.map(opt => <option key={opt || 'blank'} value={opt}>{opt || '—'}</option>)}
          </select>
        </div>
      ))}
    </div>
  )
}
