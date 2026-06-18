import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { propertiesApi } from '../../api/properties'
import type { PropertyTenant } from '../../types/properties'
import { fmtDate } from '../../lib/entities'
import ConfirmDeleteModal from '../ui/ConfirmDeleteModal'

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

const ID_TYPES = ['TT_NIC', 'PASSPORT', 'COMPANY_REG', 'DRIVERS_LICENCE', 'OTHER'] as const

function AddTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    first_name: '', last_name: '', company_name: '', is_company: false,
    phone: '', phone2: '', email: '',
    identification_type: '', identification_number: '',
    emergency_contact_name: '', emergency_contact_phone: '',
    notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))
  const setCheck = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.checked }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.createTenant({
      first_name: form.first_name,
      last_name: form.last_name || undefined,
      company_name: form.company_name || undefined,
      is_company: form.is_company,
      phone: form.phone || undefined,
      phone2: form.phone2 || undefined,
      email: form.email || undefined,
      identification_type: form.identification_type || undefined,
      identification_number: form.identification_number || undefined,
      emergency_contact_name: form.emergency_contact_name || undefined,
      emergency_contact_phone: form.emergency_contact_phone || undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('tenants.addTenant')}</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input type="checkbox" id="is_company" checked={form.is_company} onChange={setCheck('is_company')} className="rounded" />
            <label htmlFor="is_company" className="text-sm text-slate-300">{t('tenants.company')}</label>
          </div>
          {form.is_company ? (
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.companyName')}</label>
              <input value={form.company_name} onChange={set('company_name')} className={cls} placeholder="e.g. ABC Holdings Ltd" />
            </div>
          ) : (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">{t('tenants.firstName')}</label>
                <input value={form.first_name} onChange={set('first_name')} className={cls} />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">{t('tenants.lastName')}</label>
                <input value={form.last_name} onChange={set('last_name')} className={cls} />
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.phone')}</label>
              <input value={form.phone} onChange={set('phone')} className={cls} placeholder="+1-868-..." />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.phone2')}</label>
              <input value={form.phone2} onChange={set('phone2')} className={cls} placeholder="+1-868-..." />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.email')}</label>
              <input type="email" value={form.email} onChange={set('email')} className={cls} />
            </div>
            <div className="flex-1" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.idType')}</label>
              <select value={form.identification_type} onChange={set('identification_type')} className={cls}>
                <option value="">— none —</option>
                {ID_TYPES.map(tp => <option key={tp} value={tp}>{t(`tenants.idTypes.${tp}`, tp.replace(/_/g, ' '))}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.idNumber')}</label>
              <input value={form.identification_number} onChange={set('identification_number')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.emergencyContact')}</label>
              <input value={form.emergency_contact_name} onChange={set('emergency_contact_name')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.emergencyPhone')}</label>
              <input value={form.emergency_contact_phone} onChange={set('emergency_contact_phone')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => mutate()}
            disabled={isPending || (!form.is_company && !form.first_name) || (form.is_company && !form.company_name)}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {isPending ? t('common.saving') : t('tenants.addTenant')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function EditTenantModal({ tenant, onClose, onSaved }: { tenant: PropertyTenant; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    first_name: tenant.first_name,
    last_name: tenant.last_name ?? '',
    company_name: tenant.company_name ?? '',
    is_company: tenant.is_company,
    phone: tenant.phone ?? '',
    phone2: tenant.phone2 ?? '',
    email: tenant.email ?? '',
    identification_type: (tenant as unknown as Record<string, string>).identification_type ?? '',
    identification_number: (tenant as unknown as Record<string, string>).identification_number ?? '',
    emergency_contact_name: (tenant as unknown as Record<string, string>).emergency_contact_name ?? '',
    emergency_contact_phone: (tenant as unknown as Record<string, string>).emergency_contact_phone ?? '',
    notes: (tenant as unknown as Record<string, string>).notes ?? '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))
  const setCheck = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.checked }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => propertiesApi.updateTenant(tenant.id, {
      first_name: form.first_name || undefined,
      last_name: form.last_name || null,
      company_name: form.company_name || null,
      is_company: form.is_company,
      phone: form.phone || null,
      phone2: form.phone2 || null,
      email: form.email || null,
      identification_type: form.identification_type || null,
      identification_number: form.identification_number || null,
      emergency_contact_name: form.emergency_contact_name || null,
      emergency_contact_phone: form.emergency_contact_phone || null,
      notes: form.notes || null,
    }),
    onSuccess: () => { onSaved(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('tenants.editTenant')}</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input type="checkbox" id="edit_is_company" checked={form.is_company} onChange={setCheck('is_company')} className="rounded" />
            <label htmlFor="edit_is_company" className="text-sm text-slate-300">{t('tenants.company')}</label>
          </div>
          {form.is_company ? (
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.companyName')}</label>
              <input value={form.company_name} onChange={set('company_name')} className={cls} />
            </div>
          ) : (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">{t('tenants.firstName')}</label>
                <input value={form.first_name} onChange={set('first_name')} className={cls} />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">{t('tenants.lastName')}</label>
                <input value={form.last_name} onChange={set('last_name')} className={cls} />
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.phone')}</label>
              <input value={form.phone} onChange={set('phone')} className={cls} placeholder="+1-868-..." />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.phone2')}</label>
              <input value={form.phone2} onChange={set('phone2')} className={cls} placeholder="+1-868-..." />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.email')}</label>
              <input type="email" value={form.email} onChange={set('email')} className={cls} />
            </div>
            <div className="flex-1" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.idType')}</label>
              <select value={form.identification_type} onChange={set('identification_type')} className={cls}>
                <option value="">— none —</option>
                {ID_TYPES.map(tp => <option key={tp} value={tp}>{t(`tenants.idTypes.${tp}`, tp.replace(/_/g, ' '))}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.idNumber')}</label>
              <input value={form.identification_number} onChange={set('identification_number')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.emergencyContact')}</label>
              <input value={form.emergency_contact_name} onChange={set('emergency_contact_name')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('tenants.emergencyPhone')}</label>
              <input value={form.emergency_contact_phone} onChange={set('emergency_contact_phone')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => mutate()}
            disabled={isPending || (!form.is_company && !form.first_name) || (form.is_company && !form.company_name)}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {isPending ? t('common.saving') : t('tenants.saveChanges')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

export default function TenantsPanel() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editingTenant, setEditingTenant] = useState<PropertyTenant | null>(null)
  const [deletingTenant, setDeletingTenant] = useState<PropertyTenant | null>(null)
  const qc = useQueryClient()

  const handleSearch = (val: string) => {
    setSearch(val)
    clearTimeout((window as unknown as { _tenantSearchTimer?: ReturnType<typeof setTimeout> })._tenantSearchTimer)
    ;(window as unknown as { _tenantSearchTimer?: ReturnType<typeof setTimeout> })._tenantSearchTimer = setTimeout(() => setDebouncedSearch(val), 300)
  }

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['properties', 'tenants', debouncedSearch],
    queryFn: () => propertiesApi.getTenants(debouncedSearch || undefined),
  })

  const refresh = () => void qc.invalidateQueries({ queryKey: ['properties', 'tenants'] })

  return (
    <div>
      <div className="flex gap-3 mb-4 items-center">
        <input
          type="text"
          placeholder={t('tenants.search')}
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className="w-80 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
        >
          {t('tenants.addBtn')}
        </button>
      </div>

      {isLoading && <p className="text-slate-400 text-sm">{t('common.loading')}</p>}
      {!isLoading && tenants.length === 0 && <p className="text-slate-500 text-sm">{t('tenants.noTenants')}</p>}

      {tenants.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2">{t('tenants.colName')}</th>
                <th className="text-left px-4 py-2">{t('tenants.colEmail')}</th>
                <th className="text-left px-4 py-2">{t('tenants.colPhone')}</th>
                <th className="text-left px-4 py-2">{t('tenants.colAdded')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {tenants.map(tn => (
                <tr key={tn.id} className="hover:bg-slate-700/30">
                  <td className="px-4 py-3">
                    <p className="text-slate-100 font-medium">
                      {tn.is_company ? tn.company_name : `${tn.first_name}${tn.last_name ? ` ${tn.last_name}` : ''}`}
                    </p>
                    {tn.is_company && <p className="text-xs text-slate-500 mt-0.5">{t('tenants.colType')}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-sm">{tn.email ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-sm">{tn.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(tn.created_at)}</td>
                  <td className="px-4 py-3 text-right flex gap-3 justify-end items-center">
                    <button
                      onClick={() => setEditingTenant(tn)}
                      className="text-xs text-slate-500 hover:text-blue-400 transition-colors"
                    >{t('tenants.editBtn')}</button>
                    <button
                      onClick={() => setDeletingTenant(tn)}
                      className="text-xs text-slate-600 hover:text-red-400 transition-colors"
                      title={t('tenants.deleteTitle')}
                    >&#x1F5D1;</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddTenantModal onClose={() => setShowAdd(false)} onCreated={refresh} />}
      {deletingTenant && (
        <ConfirmDeleteModal
          label={deletingTenant.is_company ? (deletingTenant.company_name ?? 'Tenant') : `${deletingTenant.first_name}${deletingTenant.last_name ? ` ${deletingTenant.last_name}` : ''}`}
          onConfirm={() => propertiesApi.deleteTenant(deletingTenant.id).then(() => {
            void qc.invalidateQueries({ queryKey: ['properties', 'tenants'] })
          })}
          onClose={() => setDeletingTenant(null)}
        />
      )}
      {editingTenant && (
        <EditTenantModal
          tenant={editingTenant}
          onClose={() => setEditingTenant(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}
