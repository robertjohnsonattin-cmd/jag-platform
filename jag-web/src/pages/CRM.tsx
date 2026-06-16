import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '../api/crm'
import { pipelineApi } from '../api/pipeline'
import type { Company, Contact, InteractionType, CreateCompanyPayload } from '../types/crm'
import type { PipelineOpportunity, PipelineStage, ReasonCategory, PackageVariance } from '../types/pipeline'
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

// ── Tender Pipeline helpers ───────────────────────────────────────────────────

const tenderFmt = new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtMoney = (v: string | number | null) => v ? `TTD ${tenderFmt.format(Number(v))}` : '—'
const fmtDeadline = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const ACTIVE_STAGES: PipelineStage[] = ['LEAD', 'QUALIFIED', 'PROPOSAL', 'SUBMITTED', 'NEGOTIATION']
const CLOSED_STAGES: PipelineStage[] = ['WON', 'LOST', 'NO_GO']
const ALL_STAGES: PipelineStage[] = [...ACTIVE_STAGES, ...CLOSED_STAGES]

const STAGE_STYLES: Record<PipelineStage, string> = {
  LEAD:        'bg-slate-700/60 text-slate-300 border border-slate-600',
  QUALIFIED:   'bg-blue-900/50 text-blue-300 border border-blue-700',
  PROPOSAL:    'bg-purple-900/50 text-purple-300 border border-purple-700',
  SUBMITTED:   'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
  NEGOTIATION: 'bg-orange-900/50 text-orange-300 border border-orange-700',
  WON:         'bg-green-900/50 text-green-300 border border-green-700',
  LOST:        'bg-red-900/50 text-red-400 border border-red-700',
  NO_GO:       'bg-slate-700/40 text-slate-500 border border-slate-700',
}

const REASON_CATEGORIES: ReasonCategory[] = [
  'RESOURCE_CONSTRAINTS', 'HIGH_RISK', 'LOW_MARGIN',
  'STRATEGIC_MISFIT', 'CLIENT_RELATIONSHIP', 'SCHEDULE_CONFLICT', 'OTHER',
]

function StageBadge({ stage }: { stage: PipelineStage }) {
  const { t } = useTranslation()
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${STAGE_STYLES[stage]}`}>
      {t(`tender.stages.${stage}`, stage)}
    </span>
  )
}

// ── Go/No-Go Modal ────────────────────────────────────────────────────────────

function GoNoGoModal({
  opp,
  onClose,
}: {
  opp: PipelineOpportunity
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [decision, setDecision] = useState<'GO' | 'NO_GO'>('GO')
  const [projectCode, setProjectCode] = useState('')
  const [clientType, setClientType] = useState<'GOVERNMENT' | 'PRIVATE'>('GOVERNMENT')
  const [reasonCategory, setReasonCategory] = useState<ReasonCategory>('HIGH_RISK')
  const [reasonText, setReasonText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: intel } = useQuery({
    queryKey: ['pipeline-intelligence', opp.company_id],
    queryFn: () => pipelineApi.intelligence(opp.company_id!),
    enabled: !!opp.company_id,
  })

  const mutation = useMutation({
    mutationFn: () =>
      pipelineApi.goNoGo(opp.id, {
        decision,
        ...(decision === 'GO'
          ? { project_code: projectCode, client_type: clientType, contract_currency: 'TTD' }
          : { reason_category: reasonCategory, reason_text: reasonText }),
        idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tender-pipeline'] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  const canSubmit = decision === 'GO'
    ? projectCode.trim().length > 0
    : reasonText.trim().length > 0

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-white font-semibold">{t('tender.goNoGoTitle', 'Go / No-Go Decision')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-slate-400 text-sm truncate">{opp.title}</p>

          {/* Decision radio */}
          <div className="flex gap-4">
            {(['GO', 'NO_GO'] as const).map(d => (
              <label key={d} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="gng-decision"
                  value={d}
                  checked={decision === d}
                  onChange={() => setDecision(d)}
                  className="accent-orange-500"
                />
                <span className={`text-sm font-medium ${d === 'GO' ? 'text-green-400' : 'text-red-400'}`}>
                  {d === 'GO' ? t('tender.goDecision', 'Go') : t('tender.noGoDecision', 'No-Go')}
                </span>
              </label>
            ))}
          </div>

          {/* GO fields */}
          {decision === 'GO' && (
            <>
              <div>
                <label className="block text-slate-400 text-xs mb-1">{t('tender.projectCode', 'Project Code')} *</label>
                <input
                  type="text"
                  value={projectCode}
                  onChange={e => setProjectCode(e.target.value)}
                  placeholder="JABCO-2026-001"
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs mb-1">{t('tender.clientType', 'Client Type')} *</label>
                <select
                  value={clientType}
                  onChange={e => setClientType(e.target.value as 'GOVERNMENT' | 'PRIVATE')}
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
                >
                  <option value="GOVERNMENT">Government</option>
                  <option value="PRIVATE">Private</option>
                </select>
              </div>
            </>
          )}

          {/* NO_GO fields */}
          {decision === 'NO_GO' && (
            <>
              <div>
                <label className="block text-slate-400 text-xs mb-1">{t('tender.reasonCategory', 'Reason Category')} *</label>
                <select
                  value={reasonCategory}
                  onChange={e => setReasonCategory(e.target.value as ReasonCategory)}
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
                >
                  {REASON_CATEGORIES.map(rc => (
                    <option key={rc} value={rc}>{rc.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 text-xs mb-1">{t('tender.reasonText', 'Reason / Notes')} *</label>
                <textarea
                  value={reasonText}
                  onChange={e => setReasonText(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm resize-none"
                />
              </div>
            </>
          )}

          {/* Intelligence summary */}
          {intel && (
            <div className="bg-slate-700/40 border border-slate-600 rounded p-3 space-y-1.5">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">
                {t('tender.pastHistory', 'Past History with this Client')}
              </p>
              <p className="text-slate-300 text-xs">
                {t('tender.intelligence.wins', 'Wins')}: <span className="text-green-400 font-medium">{intel.win_loss_ratio.won}</span>
                {' · '}
                {t('tender.intelligence.losses', 'Losses')}: <span className="text-red-400 font-medium">{intel.win_loss_ratio.lost}</span>
              </p>
              {intel.package_rate_warnings.map(w => (
                <p key={w.work_package_tag} className="text-yellow-400 text-xs">{w.warning}</p>
              ))}
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm text-slate-300 hover:text-white transition-colors">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !canSubmit}
            className="px-4 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mutation.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Submit Proposal Modal ─────────────────────────────────────────────────────

function SubmitModal({
  opp,
  onClose,
}: {
  opp: PipelineOpportunity
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [url, setUrl] = useState(opp.proposal_document_url ?? '')
  const [submittedAt, setSubmittedAt] = useState(() => new Date().toISOString().slice(0, 16))
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      pipelineApi.submit(opp.id, {
        proposal_document_url: url,
        submitted_at: new Date(submittedAt).toISOString(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tender-pipeline'] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-white font-semibold">{t('tender.submitTitle', 'Submit Proposal')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-slate-400 text-sm truncate">{opp.title}</p>
          <div>
            <label className="block text-slate-400 text-xs mb-1">{t('tender.proposalUrl', 'Proposal Document URL')} *</label>
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label className="block text-slate-400 text-xs mb-1">{t('crm.dateTime')}</label>
            <input
              type="datetime-local"
              value={submittedAt}
              onChange={e => setSubmittedAt(e.target.value)}
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
            disabled={mutation.isPending || !url.trim()}
            className="px-4 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mutation.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Win/Loss (Decide) Modal ───────────────────────────────────────────────────

function DecideModal({
  opp,
  onClose,
}: {
  opp: PipelineOpportunity
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [decision, setDecision] = useState<'WON' | 'LOST'>('WON')
  const [competitorName, setCompetitorName] = useState('')
  const [winningPrice, setWinningPrice] = useState('')
  const [ourPrice, setOurPrice] = useState('')
  const [techScore, setTechScore] = useState('')
  const [finScore, setFinScore] = useState('')
  const [variances, setVariances] = useState<PackageVariance[]>([])
  const [error, setError] = useState<string | null>(null)

  const addVarianceRow = () =>
    setVariances(v => [...v, { work_package_tag: '', our_rate: 0, market_rate: 0 }])

  const updateVariance = (idx: number, field: keyof PackageVariance, val: string) =>
    setVariances(v => v.map((row, i) => i === idx ? { ...row, [field]: field === 'work_package_tag' ? val : Number(val) } : row))

  const removeVariance = (idx: number) =>
    setVariances(v => v.filter((_, i) => i !== idx))

  const mutation = useMutation({
    mutationFn: () =>
      pipelineApi.decide(opp.id, {
        decision,
        ...(ourPrice ? { our_total_price: Number(ourPrice) } : {}),
        ...(decision === 'LOST' ? {
          competitor_name: competitorName || undefined,
          winning_total_price: winningPrice ? Number(winningPrice) : undefined,
          technical_score: techScore ? Number(techScore) : undefined,
          financial_score: finScore ? Number(finScore) : undefined,
          package_variances: variances.filter(v => v.work_package_tag.trim()),
        } : {}),
        idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tender-pipeline'] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  const canSubmit = decision === 'WON' || competitorName.trim().length > 0

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-800 border border-slate-700 rounded-lg w-full max-w-lg shadow-xl my-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-white font-semibold">{t('tender.decideTitle', 'Win / Loss Decision')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-slate-400 text-sm truncate">{opp.title}</p>

          {/* Decision radio */}
          <div className="flex gap-4">
            {(['WON', 'LOST'] as const).map(d => (
              <label key={d} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="decide-decision"
                  value={d}
                  checked={decision === d}
                  onChange={() => setDecision(d)}
                  className="accent-orange-500"
                />
                <span className={`text-sm font-medium ${d === 'WON' ? 'text-green-400' : 'text-red-400'}`}>
                  {d === 'WON' ? t('tender.wonDecision', 'Won') : t('tender.lostDecision', 'Lost')}
                </span>
              </label>
            ))}
          </div>

          {/* Our price — both WON and LOST */}
          <div>
            <label className="block text-slate-400 text-xs mb-1">{t('tender.ourPrice', 'Our Total Price')}</label>
            <input
              type="number"
              value={ourPrice}
              onChange={e => setOurPrice(e.target.value)}
              placeholder="0.00"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
            />
          </div>

          {/* LOST-only fields */}
          {decision === 'LOST' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 text-xs mb-1">{t('tender.competitorName', 'Competitor Name')} *</label>
                  <input
                    type="text"
                    value={competitorName}
                    onChange={e => setCompetitorName(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-xs mb-1">{t('tender.winningPrice', 'Their Total Price')}</label>
                  <input
                    type="number"
                    value={winningPrice}
                    onChange={e => setWinningPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 text-xs mb-1">Technical Score</label>
                  <input
                    type="number"
                    value={techScore}
                    onChange={e => setTechScore(e.target.value)}
                    placeholder="0–100"
                    className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-xs mb-1">Financial Score</label>
                  <input
                    type="number"
                    value={finScore}
                    onChange={e => setFinScore(e.target.value)}
                    placeholder="0–100"
                    className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
                  />
                </div>
              </div>

              {/* Package variances */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-slate-400 text-xs font-medium">{t('tender.packageVariances', 'Rate Variances by Package')}</label>
                  <button
                    onClick={addVarianceRow}
                    className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                  >{t('tender.addVariance', '+ Add Row')}</button>
                </div>
                {variances.map((vr, idx) => (
                  <div key={idx} className="flex gap-2 mb-2 items-center">
                    <input
                      type="text"
                      value={vr.work_package_tag}
                      onChange={e => updateVariance(idx, 'work_package_tag', e.target.value)}
                      placeholder="Package tag"
                      className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-white text-xs"
                    />
                    <input
                      type="number"
                      value={vr.our_rate || ''}
                      onChange={e => updateVariance(idx, 'our_rate', e.target.value)}
                      placeholder="Our rate"
                      className="w-24 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-white text-xs"
                    />
                    <input
                      type="number"
                      value={vr.market_rate || ''}
                      onChange={e => updateVariance(idx, 'market_rate', e.target.value)}
                      placeholder="Market"
                      className="w-24 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-white text-xs"
                    />
                    <button onClick={() => removeVariance(idx)} className="text-slate-600 hover:text-red-400 text-sm shrink-0">&times;</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm text-slate-300 hover:text-white transition-colors">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !canSubmit}
            className="px-4 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mutation.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── New Opportunity Modal ─────────────────────────────────────────────────────

function NewOpportunityModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [estimatedValue, setEstimatedValue] = useState('')
  const [bidDeadline, setBidDeadline] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: companiesData } = useQuery({
    queryKey: ['crm-companies-picker'],
    queryFn: () => crmApi.getCompanies({ limit: 200 }),
  })
  const companies = companiesData?.companies ?? []

  const mutation = useMutation({
    mutationFn: () =>
      pipelineApi.create({
        title,
        pipeline_type: 'JABCO_TENDER',
        company_id: companyId || undefined,
        estimated_value: estimatedValue ? Number(estimatedValue) : undefined,
        bid_deadline: bidDeadline || undefined,
        notes: notes || undefined,
        idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tender-pipeline'] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-white font-semibold">{t('tender.newOpportunity', 'New Opportunity')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-slate-400 text-xs mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Highway Rehabilitation Phase 2"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label className="block text-slate-400 text-xs mb-1">{t('crm.tabCompanies')}</label>
            <select
              value={companyId}
              onChange={e => setCompanyId(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
            >
              <option value="">— None —</option>
              {companies.map(co => (
                <option key={co.id} value={co.id}>{co.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 text-xs mb-1">Est. Value (TTD)</label>
              <input
                type="number"
                value={estimatedValue}
                onChange={e => setEstimatedValue(e.target.value)}
                placeholder="0.00"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1">Bid Deadline</label>
              <input
                type="date"
                value={bidDeadline}
                onChange={e => setBidDeadline(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
              />
            </div>
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
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm text-slate-300 hover:text-white transition-colors">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !title.trim()}
            className="px-4 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mutation.isPending ? t('common.saving') : t('tender.newOpportunity', 'New Opportunity')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Opportunity Modal ────────────────────────────────────────────────────

function EditModal({
  opp,
  onClose,
}: {
  opp: PipelineOpportunity
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [title, setTitle] = useState(opp.title)
  const [estimatedValue, setEstimatedValue] = useState(opp.estimated_value ?? '')
  const [bidDeadline, setBidDeadline] = useState(opp.bid_deadline ? opp.bid_deadline.slice(0, 10) : '')
  const [notes, setNotes] = useState(opp.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      pipelineApi.patch(opp.id, {
        title,
        estimated_value: estimatedValue ? Number(estimatedValue) : undefined,
        bid_deadline: bidDeadline || null,
        notes: notes || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tender-pipeline'] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-white font-semibold">Edit Opportunity</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-slate-400 text-xs mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 text-xs mb-1">Est. Value (TTD)</label>
              <input
                type="number"
                value={estimatedValue}
                onChange={e => setEstimatedValue(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1">Bid Deadline</label>
              <input
                type="date"
                value={bidDeadline}
                onChange={e => setBidDeadline(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
              />
            </div>
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
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm text-slate-300 hover:text-white transition-colors">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !title.trim()}
            className="px-4 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mutation.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Opportunity Detail Drawer ─────────────────────────────────────────────────

type TenderModal = 'gonogo' | 'submit' | 'decide' | 'edit' | null

function OppDetail({
  opp,
  onClose,
}: {
  opp: PipelineOpportunity
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [modal, setModal] = useState<TenderModal>(null)

  const showGoNoGo = ['LEAD', 'QUALIFIED'].includes(opp.stage)
  const showSubmit = ['QUALIFIED', 'PROPOSAL', 'NEGOTIATION'].includes(opp.stage)
  const showDecide = opp.stage === 'SUBMITTED'
  const showEdit   = ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION'].includes(opp.stage)

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-white font-semibold leading-snug">{opp.title}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <StageBadge stage={opp.stage} />
              {opp.company_name && (
                <span className="text-slate-400 text-xs">{opp.company_name}</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none shrink-0">&times;</button>
        </div>

        {/* Info grid */}
        <div className="px-5 py-3 border-b border-slate-700 space-y-2">
          {[
            ['estValue', 'Est. Value', fmtMoney(opp.estimated_value)],
            ['bidDeadline', 'Bid Deadline', fmtDeadline(opp.bid_deadline)],
            ['submittedAt', 'Submitted', opp.submitted_at ? fmtDeadline(opp.submitted_at) : '—'],
            ['proposalUrl', t('tender.proposalUrl', 'Proposal URL'), opp.proposal_document_url ?? '—'],
            ['assignedTo', 'Assigned To', opp.assigned_to ?? '—'],
            ['linkedProject', 'Project', opp.linked_project_id ?? '—'],
            ['created', 'Created', fmtDeadline(opp.created_at)],
          ].map(([key, label, value]) => (
            <div key={key} className="flex gap-2 text-sm">
              <span className="text-slate-500 w-28 shrink-0">{label}</span>
              <span className="text-slate-300 truncate">{value}</span>
            </div>
          ))}
          {opp.notes && (
            <div className="flex gap-2 text-sm">
              <span className="text-slate-500 w-28 shrink-0">Notes</span>
              <span className="text-slate-300 text-xs leading-relaxed">{opp.notes}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 py-3 flex flex-wrap gap-2">
          {showGoNoGo && (
            <button
              onClick={() => setModal('gonogo')}
              className="px-3 py-1.5 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white transition-colors"
            >{t('tender.goNoGoTitle', 'Go / No-Go')}</button>
          )}
          {showSubmit && (
            <button
              onClick={() => setModal('submit')}
              className="px-3 py-1.5 rounded text-xs bg-purple-700 hover:bg-purple-600 text-white transition-colors"
            >{t('tender.submitTitle', 'Submit Proposal')}</button>
          )}
          {showDecide && (
            <button
              onClick={() => setModal('decide')}
              className="px-3 py-1.5 rounded text-xs bg-yellow-700 hover:bg-yellow-600 text-white transition-colors"
            >{t('tender.decideTitle', 'Win / Loss')}</button>
          )}
          {showEdit && (
            <button
              onClick={() => setModal('edit')}
              className="px-3 py-1.5 rounded text-xs bg-slate-600 hover:bg-slate-500 text-white transition-colors"
            >Edit</button>
          )}
        </div>
      </div>

      {modal === 'gonogo' && <GoNoGoModal opp={opp} onClose={() => setModal(null)} />}
      {modal === 'submit' && <SubmitModal opp={opp} onClose={() => setModal(null)} />}
      {modal === 'decide' && <DecideModal opp={opp} onClose={() => setModal(null)} />}
      {modal === 'edit'   && <EditModal   opp={opp} onClose={() => setModal(null)} />}
    </>
  )
}

// ── Opportunity Card ──────────────────────────────────────────────────────────

function OppCard({ opp, onClick }: { opp: PipelineOpportunity; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-slate-800 hover:bg-slate-700/70 border border-slate-700 rounded-lg p-3 transition-colors space-y-1.5"
    >
      <p className="text-white text-sm font-medium leading-snug line-clamp-2">{opp.title}</p>
      {opp.company_name && (
        <p className="text-slate-400 text-xs truncate">{opp.company_name}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-orange-300 text-xs font-medium">{fmtMoney(opp.estimated_value)}</span>
        {opp.bid_deadline && (
          <span className="text-slate-500 text-xs shrink-0">{fmtDeadline(opp.bid_deadline)}</span>
        )}
      </div>
      <StageBadge stage={opp.stage} />
    </button>
  )
}

// ── Tender Pipeline Tab ───────────────────────────────────────────────────────

function TenderPipelineTab() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<PipelineOpportunity | null>(null)
  const [mobileStage, setMobileStage] = useState<PipelineStage | 'ALL'>('ALL')
  const [newModal, setNewModal] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['tender-pipeline'],
    queryFn: () => pipelineApi.list({ pipeline_type: 'JABCO_TENDER', limit: 200 }),
  })

  const opps = data?.opportunities ?? []

  const byStage = (stage: PipelineStage) => opps.filter(o => o.stage === stage)
  const closedCounts = CLOSED_STAGES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = byStage(s).length
    return acc
  }, {})

  const mobileOpps = mobileStage === 'ALL' ? opps : opps.filter(o => o.stage === mobileStage)

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Closed stage counts */}
          {CLOSED_STAGES.map(s => (
            <span key={s} className={`text-xs px-2 py-0.5 rounded-full ${STAGE_STYLES[s]}`}>
              {t(`tender.stages.${s}`, s)}: {closedCounts[s]}
            </span>
          ))}
        </div>
        <button
          onClick={() => setNewModal(true)}
          className="px-3 py-1.5 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white transition-colors shrink-0"
        >{t('tender.newOpportunity', 'New Opportunity')}</button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center flex-1 text-slate-400 text-sm">{t('common.loading')}</div>
      )}

      {!isLoading && opps.length === 0 && (
        <div className="flex items-center justify-center flex-1 text-slate-500 text-sm">{t('tender.noOpportunities', 'No opportunities found.')}</div>
      )}

      {!isLoading && opps.length > 0 && (
        <>
          {/* ── Mobile: stage filter + list ─────────────────────────── */}
          <div className={`md:hidden flex flex-col flex-1 overflow-hidden ${selected ? 'hidden' : ''}`}>
            <div className="px-4 py-2 border-b border-slate-700">
              <select
                value={mobileStage}
                onChange={e => setMobileStage(e.target.value as PipelineStage | 'ALL')}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
              >
                <option value="ALL">{t('tender.stageFilter', 'All Stages')}</option>
                {ALL_STAGES.map(s => (
                  <option key={s} value={s}>{t(`tender.stages.${s}`, s)}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {mobileOpps.length === 0 && (
                <p className="text-slate-500 text-sm text-center py-8">{t('tender.noOpportunities', 'No opportunities found.')}</p>
              )}
              {mobileOpps.map(opp => (
                <OppCard key={opp.id} opp={opp} onClick={() => setSelected(opp)} />
              ))}
            </div>
          </div>

          {/* Mobile detail */}
          {selected && (
            <div className="md:hidden flex flex-col flex-1 overflow-y-auto">
              <button
                onClick={() => setSelected(null)}
                className="flex items-center gap-1 px-4 py-2 text-sm text-slate-400 hover:text-white border-b border-slate-700 transition-colors"
              >← {t('common.back', 'Back')}</button>
              <OppDetail opp={selected} onClose={() => setSelected(null)} />
            </div>
          )}

          {/* ── Desktop: kanban ────────────────────────────────────── */}
          <div className="hidden md:flex flex-1 overflow-hidden">
            {/* Kanban columns */}
            <div className="flex-1 overflow-x-auto">
              <div className="flex h-full gap-0 min-w-max">
                {ACTIVE_STAGES.map(stage => {
                  const stageOpps = byStage(stage)
                  return (
                    <div key={stage} className="flex flex-col w-56 border-r border-slate-700/60 last:border-r-0">
                      {/* Column header */}
                      <div className="px-3 py-2.5 border-b border-slate-700 flex items-center justify-between shrink-0">
                        <span className={`text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${STAGE_STYLES[stage]}`}>
                          {t(`tender.stages.${stage}`, stage)}
                        </span>
                        <span className="text-slate-500 text-xs font-medium">{stageOpps.length}</span>
                      </div>
                      {/* Cards */}
                      <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {stageOpps.length === 0 && (
                          <p className="text-slate-700 text-xs text-center py-4">—</p>
                        )}
                        {stageOpps.map(opp => (
                          <OppCard
                            key={opp.id}
                            opp={opp}
                            onClick={() => setSelected(opp)}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Desktop detail panel */}
            {selected && (
              <div className="w-80 shrink-0 border-l border-slate-700 bg-slate-800/50 overflow-y-auto">
                <OppDetail opp={selected} onClose={() => setSelected(null)} />
              </div>
            )}
          </div>
        </>
      )}

      {newModal && <NewOpportunityModal onClose={() => setNewModal(false)} />}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'companies' | 'contacts' | 'tender'

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
          { key: 'tender',    label: t('crm.tabTender', 'Tender Pipeline') },
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
        {tab === 'tender'    && <TenderPipelineTab />}
      </div>
    </div>
  )
}
