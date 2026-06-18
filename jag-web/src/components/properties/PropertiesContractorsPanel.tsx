import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'
import CrmContactPicker, { CrmContactBadge } from '../crm/CrmContactPicker'

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'
const TRADES = ['PLUMBING','ELECTRICAL','STRUCTURAL','PEST_CONTROL','APPLIANCE','PAINTING','GENERAL','OTHER'] as const

export default function PropertiesContractorsPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [form, setForm] = useState({ name: '', trade: 'GENERAL', phone: '', whatsapp: '', email: '', rate_description: '', notes: '', crm_contact_id: null as string | null })

  const { data: contractors = [] } = useQuery({ queryKey: ['contractors'], queryFn: () => tenancyApi.getContractors() })

  const createMut = useMutation({
    mutationFn: () => tenancyApi.createContractor(form),
    onSuccess: () => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['contractors'] }) },
  })

  const patchMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => tenancyApi.patchContractor(String(editing!['id']), body),
    onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ['contractors'] }) },
  })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }))
  const setE = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setEditing(ed => ed ? { ...ed, [k]: e.target.value } : ed)

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => { setForm({ name: '', trade: 'GENERAL', phone: '', whatsapp: '', email: '', rate_description: '', notes: '', crm_contact_id: null }); setShowAdd(true) }}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded">
          + {t('tenancy.addContractor', 'Add Contractor')}
        </button>
      </div>

      {contractors.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">{t('tenancy.noContractors', 'No contractors yet.')}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {contractors.map((c: Record<string, unknown>) => (
          <div key={String(c['id'])} className="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-200">{String(c['name'])}</p>
                <p className="text-xs text-blue-400">{String(c['trade'])}</p>
                <p className="text-xs text-slate-400 mt-1">{String(c['phone'] ?? '')} {c['whatsapp'] ? `· WA: ${String(c['whatsapp'])}` : ''}</p>
                {Boolean(c['email']) && <p className="text-xs text-slate-500">{String(c['email'])}</p>}
                {Boolean(c['rate_description']) && <p className="text-xs text-slate-500 mt-1">{String(c['rate_description'])}</p>}
                {Boolean(c['crm_contact_id']) && <CrmContactBadge contactId={String(c['crm_contact_id'])} />}
              </div>
              <div className="flex flex-col gap-1 items-end">
                <span className={`text-xs px-1.5 py-0.5 rounded ${c['is_active'] ? 'bg-green-900/50 text-green-400' : 'bg-slate-700 text-slate-500'}`}>
                  {c['is_active'] ? t('tenancy.active','Active') : t('tenancy.inactive','Inactive')}
                </span>
                <button onClick={() => setEditing(c)} className="text-xs text-blue-400 hover:text-blue-300">{t('common.edit','Edit')}</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(showAdd || editing) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md overflow-y-auto max-h-[90vh]">
            <h2 className="text-lg font-semibold mb-4">{editing ? t('tenancy.editContractor','Edit Contractor') : t('tenancy.addContractor','Add Contractor')}</h2>
            <div className="space-y-3">
              {([['name','Name'],['phone','Phone'],['whatsapp','WhatsApp'],['email','Email'],['rate_description','Rate / Fee Description'],['notes','Notes']] as const).map(([k, label]) => (
                <div key={k}>
                  <label className="block text-xs text-slate-400 mb-1">{label}</label>
                  {editing
                    ? <input className={cls} value={String((editing as Record<string,unknown>)[k] ?? '')} onChange={setE(k)} />
                    : <input className={cls} value={(form as Record<string,string>)[k] ?? ''} onChange={set(k)} />}
                </div>
              ))}
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('tenancy.trade','Trade')}</label>
                {editing
                  ? <select className={cls} value={String(editing['trade'])} onChange={setE('trade')}>{TRADES.map(tr => <option key={tr} value={tr}>{tr.replace(/_/g,' ')}</option>)}</select>
                  : <select className={cls} value={form.trade} onChange={set('trade')}>{TRADES.map(tr => <option key={tr} value={tr}>{tr.replace(/_/g,' ')}</option>)}</select>}
              </div>
              {editing && (
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="is_active" checked={Boolean(editing['is_active'])} onChange={e => setEditing(ed => ed ? { ...ed, is_active: e.target.checked } : ed)} />
                  <label htmlFor="is_active" className="text-sm text-slate-300">{t('tenancy.active','Active')}</label>
                </div>
              )}
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('crm.linkedContact','CRM Contact')}</label>
                {editing
                  ? <CrmContactPicker value={editing['crm_contact_id'] as string | null} onChange={id => setEditing(ed => ed ? { ...ed, crm_contact_id: id } : ed)} />
                  : <CrmContactPicker value={form.crm_contact_id} onChange={id => setForm(f => ({ ...f, crm_contact_id: id }))} />}
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => { setShowAdd(false); setEditing(null) }} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel','Cancel')}</button>
              <button onClick={() => editing ? patchMut.mutate(editing as Record<string,unknown>) : createMut.mutate()}
                disabled={editing ? patchMut.isPending : createMut.isPending}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
                {(editing ? patchMut.isPending : createMut.isPending) ? t('common.saving','Saving...') : t('common.save','Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
