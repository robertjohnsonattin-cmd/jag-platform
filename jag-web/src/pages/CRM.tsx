import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '../api/crm'
import type { Company, Contact, InteractionType, CreateCompanyPayload } from '../types/crm'
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' })


// ── Log Interaction Modal ─────────────────────────────────────────────────────

function LogInteractionModal({
  contact,
  onClose,
}: {
  contact: Contact
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [type, setType] = useState<InteractionType>('CALL')
  const [subject, setSubject] = useState('')
  const [notes, setNotes] = useState('')
  const [occurredAt, setOccurredAt] = useState(() =>
    new Date().toISOString().slice(0, 16)
  )
  const [followUpDate, setFollowUpDate] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      crmApi.logInteraction({
        contact_id: contact.id,
        interaction_type: type,
        subject,
        notes: notes || undefined,
        occurred_at: new Date(occurredAt).toISOString(),
        follow_up_date: followUpDate || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-contacts'] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-white font-semibold">{t('crm.logInteractionTitle')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-slate-400 text-sm">
            {t('crm.contactLabel')}: <span className="text-white font-medium">{contact.first_name} {contact.last_name}</span>
            {contact.company_name && <span className="text-slate-500"> · {contact.company_name}</span>}
          </p>

          <div>
            <label className="block text-slate-400 text-xs mb-1">{t('crm.typeLabel')}</label>
            <select
              value={type}
              onChange={e => setType(e.target.value as InteractionType)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
            >
              {(['CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'OTHER'] as InteractionType[]).map(tp => (
                <option key={tp} value={tp}>{tp.replace('_', ' ')}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 text-xs mb-1">{t('crm.subject')}</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder={t('crm.subjectPlaceholder')}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
            />
          </div>

          <div>
            <label className="block text-slate-400 text-xs mb-1">{t('crm.dateTime')}</label>
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={e => setOccurredAt(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
            />
          </div>

          <div>
            <label className="block text-slate-400 text-xs mb-1">{t('crm.notesOptional')}</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm resize-none"
            />
          </div>

          <div>
            <label className="block text-slate-400 text-xs mb-1">{t('crm.followUpDate')}</label>
            <input
              type="date"
              value={followUpDate}
              onChange={e => setFollowUpDate(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm text-slate-300 hover:text-white transition-colors">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !subject.trim()}
            className="px-4 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mutation.isPending ? t('common.saving') : t('crm.logBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Company Modal ─────────────────────────────────────────────────────────

function AddCompanyModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState<CreateCompanyPayload>({ name: '', country: 'TT' })
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof CreateCompanyPayload) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const mutation = useMutation({
    mutationFn: () => crmApi.createCompany({
      ...form,
      industry: form.industry || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      website: form.website || undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-companies'] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-white font-semibold">{t('crm.addCompany')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {[
            { label: t('crm.companyNameStar'), key: 'name' as const, placeholder: 'Acme Ltd' },
            { label: t('crm.industry'), key: 'industry' as const, placeholder: 'Construction' },
            { label: t('crm.countryCode'), key: 'country' as const, placeholder: 'TT' },
            { label: t('crm.phone'), key: 'phone' as const, placeholder: '+1 868 000 0000' },
            { label: t('crm.email'), key: 'email' as const, placeholder: 'info@acme.com' },
            { label: t('crm.website'), key: 'website' as const, placeholder: 'https://acme.com' },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label className="block text-slate-400 text-xs mb-1">{label}</label>
              <input
                type="text"
                value={(form[key] as string) ?? ''}
                onChange={set(key)}
                placeholder={placeholder}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
              />
            </div>
          ))}
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm text-slate-300 hover:text-white transition-colors">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.name.trim()}
            className="px-4 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mutation.isPending ? t('common.saving') : t('crm.addCompany')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Company Detail Panel ──────────────────────────────────────────────────────

function CompanyPanel({
  company,
  onClose,
}: {
  company: Company
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [logContact, setLogContact] = useState<Contact | null>(null)
  const [contactSearch, setContactSearch] = useState('')
  const [contactPage, setContactPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['crm-contacts', company.id, contactSearch, contactPage],
    queryFn: () => crmApi.getContacts({ company_id: company.id, search: contactSearch || undefined, page: contactPage, limit: 20 }),
  })

  const contacts = data?.contacts ?? []
  const pagination = data?.pagination

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-white font-semibold truncate">{company.name}</h2>
            <p className="text-slate-400 text-sm mt-0.5">
              {company.industry ?? t('crm.noIndustry')} · {company.country}
              {company.contact_count > 0 && ` · ${t('crm.contactCount', { count: company.contact_count })}`}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none shrink-0">&times;</button>
        </div>

        {/* Company info */}
        <div className="px-5 py-3 border-b border-slate-700 space-y-1.5">
          {company.email && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500 w-16 shrink-0">{t('crm.email')}</span>
              <a href={`mailto:${company.email}`} className="text-orange-400 hover:text-orange-300 truncate">{company.email}</a>
            </div>
          )}
          {company.phone && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500 w-16 shrink-0">{t('crm.phone')}</span>
              <span className="text-slate-300">{company.phone}</span>
            </div>
          )}
          {company.website && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500 w-16 shrink-0">{t('crm.website')}</span>
              <span className="text-slate-300 truncate">{company.website}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500 w-16 shrink-0">{t('crm.added')}</span>
            <span className="text-slate-400">{fmtDate(company.created_at)}</span>
          </div>
        </div>

        {/* Contacts */}
        <div className="px-5 py-3 border-b border-slate-700">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-2">{t('crm.contactsSection')}</p>
          <input
            type="text"
            placeholder={t('crm.searchContacts')}
            value={contactSearch}
            onChange={e => { setContactSearch(e.target.value); setContactPage(1) }}
            className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm placeholder:text-slate-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-700/50">
          {isLoading && (
            <div className="flex items-center justify-center h-24 text-slate-400 text-sm">{t('common.loading')}</div>
          )}
          {!isLoading && contacts.length === 0 && (
            <div className="flex items-center justify-center h-24 text-slate-500 text-sm">{t('crm.noContactsFnd')}</div>
          )}
          {contacts.map(c => (
            <div key={c.id} className="px-5 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-white text-sm font-medium">{c.first_name} {c.last_name}</p>
                <p className="text-slate-400 text-xs mt-0.5">{c.role || '—'}</p>
                {c.email && <p className="text-slate-500 text-xs">{c.email}</p>}
                {c.phone && <p className="text-slate-500 text-xs">{c.phone}</p>}
              </div>
              <button
                onClick={() => setLogContact(c)}
                className="shrink-0 px-2.5 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition-colors"
              >
                {t('crm.logShort')}
              </button>
            </div>
          ))}
        </div>

        {pagination && pagination.pages > 1 && (
          <div className="flex items-center justify-between px-5 py-2 border-t border-slate-700 text-xs text-slate-400">
            <span>{t('common.page')} {pagination.page} / {pagination.pages}</span>
            <div className="flex gap-1">
              <button onClick={() => setContactPage(p => Math.max(1, p - 1))} disabled={contactPage === 1} className="px-2 py-1 rounded bg-slate-700 disabled:opacity-40">‹</button>
              <button onClick={() => setContactPage(p => Math.min(pagination.pages, p + 1))} disabled={contactPage === pagination.pages} className="px-2 py-1 rounded bg-slate-700 disabled:opacity-40">›</button>
            </div>
          </div>
        )}
      </div>

      {logContact && (
        <LogInteractionModal contact={logContact} onClose={() => setLogContact(null)} />
      )}
    </>
  )
}

// ── Companies Tab ─────────────────────────────────────────────────────────────

function CompaniesTab() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Company | null>(null)
  const [addModal, setAddModal] = useState(false)
  const [deletingCompany, setDeletingCompany] = useState<Company | null>(null)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['crm-companies', search, page],
    queryFn: () => crmApi.getCompanies({ search: search || undefined, page, limit: 25 }),
  })

  const companies = data?.companies ?? []
  const pagination = data?.pagination

  return (
    <div className="flex h-full">
      {/* List */}
      <div className={`flex flex-col ${selected ? 'hidden lg:flex lg:w-96 lg:shrink-0' : 'flex-1'}`}>
        <div className="px-4 py-3 border-b border-slate-700 flex gap-2">
          <input
            type="text"
            placeholder={t('crm.searchCompanies')}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm placeholder:text-slate-500"
          />
          <button
            onClick={() => setAddModal(true)}
            className="px-3 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white transition-colors shrink-0"
          >{t('crm.addBtn')}</button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-700/50">
          {isLoading && (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>
          )}
          {!isLoading && companies.length === 0 && (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">{t('crm.noCompaniesFnd')}</div>
          )}
          {companies.map(co => (
            <div key={co.id} className={`flex items-stretch hover:bg-slate-700/40 transition-colors ${selected?.id === co.id ? 'bg-slate-700/60' : ''}`}>
              <button
                onClick={() => setSelected(co)}
                className="flex-1 text-left px-4 py-3 min-w-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{co.name}</p>
                    <p className="text-slate-400 text-xs mt-0.5">{co.industry ?? '—'} · {co.country}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500 mt-0.5">
                    {t('crm.contactCount', { count: co.contact_count })}
                  </span>
                </div>
                {(co.email || co.phone) && (
                  <p className="text-slate-500 text-xs mt-1 truncate">{co.email ?? co.phone}</p>
                )}
              </button>
              <button
                onClick={e => { e.stopPropagation(); setDeletingCompany(co) }}
                className="px-3 text-slate-700 hover:text-red-400 transition-colors shrink-0"
                title="Delete company"
              >&#x1F5D1;</button>
            </div>
          ))}
        </div>

        {pagination && pagination.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-slate-700 text-xs text-slate-400">
            <span>{t('crm.companiesPagination', { total: pagination.total, page: pagination.page, pages: pagination.pages })}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 rounded bg-slate-700 disabled:opacity-40">‹</button>
              <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page === pagination.pages} className="px-2 py-1 rounded bg-slate-700 disabled:opacity-40">›</button>
            </div>
          </div>
        )}
      </div>

      {/* Detail */}
      {selected && (
        <div className="flex-1 border-l border-slate-700 bg-slate-800/50 overflow-hidden flex flex-col">
          <CompanyPanel company={selected} onClose={() => setSelected(null)} />
        </div>
      )}

      {addModal && <AddCompanyModal onClose={() => setAddModal(false)} />}
      {deletingCompany && (
        <ConfirmDeleteModal
          label={deletingCompany.name}
          onConfirm={() => crmApi.deleteCompany(deletingCompany.id).then(() => {
            void qc.invalidateQueries({ queryKey: ['crm-companies'] })
            if (selected?.id === deletingCompany.id) setSelected(null)
          })}
          onClose={() => setDeletingCompany(null)}
        />
      )}
    </div>
  )
}

// ── All Contacts Tab ──────────────────────────────────────────────────────────

function ContactsTab() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [logContact, setLogContact] = useState<Contact | null>(null)
  const [deletingContact, setDeletingContact] = useState<Contact | null>(null)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['crm-contacts', '', search, page],
    queryFn: () => crmApi.getContacts({ search: search || undefined, page, limit: 30 }),
  })

  const contacts = data?.contacts ?? []
  const pagination = data?.pagination

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-700">
        <input
          type="text"
          placeholder={t('crm.searchByName')}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm placeholder:text-slate-500"
        />
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>
        )}
        {!isLoading && contacts.length === 0 && (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">{t('crm.noContactsFnd')}</div>
        )}
        {contacts.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700 sticky top-0 bg-slate-800">
              <tr>
                {[t('crm.colName'), t('crm.colCompany'), t('crm.role'), t('crm.email'), t('crm.phone'), t('crm.added'), ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contacts.map(c => (
                <tr key={c.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-2.5 text-white font-medium">{c.first_name} {c.last_name}</td>
                  <td className="px-4 py-2.5 text-slate-300">{c.company_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-400">{c.role || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-300">{c.email || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-300">{c.phone || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{fmtDate(c.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-2 items-center">
                      <button
                        onClick={() => setLogContact(c)}
                        className="px-2.5 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition-colors"
                      >{t('crm.logShort')}</button>
                      <button
                        onClick={() => setDeletingContact(c)}
                        className="text-slate-600 hover:text-red-400 transition-colors text-sm"
                        title="Delete contact"
                      >&#x1F5D1;</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-700 text-xs text-slate-400">
          <span>{t('crm.contactsPagination', { total: pagination.total, page: pagination.page, pages: pagination.pages })}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 rounded bg-slate-700 disabled:opacity-40">‹</button>
            <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page === pagination.pages} className="px-2 py-1 rounded bg-slate-700 disabled:opacity-40">›</button>
          </div>
        </div>
      )}

      {logContact && (
        <LogInteractionModal contact={logContact} onClose={() => setLogContact(null)} />
      )}
      {deletingContact && (
        <ConfirmDeleteModal
          label={`${deletingContact.first_name} ${deletingContact.last_name ?? ''}`.trim()}
          onConfirm={() => crmApi.deleteContact(deletingContact.id).then(() => {
            void qc.invalidateQueries({ queryKey: ['crm-contacts'] })
          })}
          onClose={() => setDeletingContact(null)}
        />
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'companies' | 'contacts'

export default function CRM() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('companies')

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="px-6 py-4 border-b border-slate-700">
        <h1 className="text-xl font-semibold text-white">{t('crm.title')}</h1>
        <p className="text-slate-400 text-sm mt-0.5">{t('crm.subtitle')}</p>
      </div>

      <div className="flex border-b border-slate-700 px-6">
        {([
          { key: 'companies', label: t('crm.tabCompanies') },
          { key: 'contacts',  label: t('crm.tabContacts') },
        ] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >{label}</button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'companies' && <CompaniesTab />}
        {tab === 'contacts'  && <ContactsTab />}
      </div>
    </div>
  )
}
