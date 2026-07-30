import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { propertiesApi } from '../../api/properties'
import { tenancyApi } from '../../api/tenancy'
import { api } from '../../api/client'
import type { PropertyTenant, TenantDocument, TenantDocType, Lease } from '../../types/properties'
import { fmtDate, fmtTTD } from '../../lib/entities'
import TenantSectionState from './TenantSectionState'
import TenantTimeline, { deriveLifecycle, type Translate } from './TenantTimeline'
import AuthedImg from '../AuthedImg'

/**
 * Tenant 360 — one detail pane replacing the eight near-identical modals that
 * used to hang off the tenants table.
 *
 * The old shape put every record type behind its own button and its own modal,
 * so answering "what is going on with this tenant" meant opening eight dialogs
 * and holding the answer in your head. Nothing showed the tenancy as a whole,
 * and a record that had failed to link simply looked like an empty modal.
 *
 * Sections keep the queries they already had -- all of them already filter by
 * tenant_id -- and are gated on the active tab, matching how PropertyDetail
 * gates its own tabs. The five queries the lifecycle timeline reads are also
 * enabled on Overview, since the timeline is the point of that tab.
 */

type Row = Record<string, unknown>

type DetailTab = 'overview' | 'tenancy' | 'money' | 'maintenance' | 'documents' | 'messages'

const DEPOSIT_STATUS_COLORS: Record<string, string> = {
  HELD:               'bg-blue-900/50 text-blue-300 border-blue-700',
  PARTIALLY_RETURNED: 'bg-orange-900/50 text-orange-300 border-orange-700',
  RETURNED:           'bg-green-900/50 text-green-300 border-green-700',
  FORFEITED:          'bg-red-900/50 text-red-300 border-red-700',
}

const LEASE_STATUS_COLORS: Record<string, string> = {
  ACTIVE:      'bg-green-900/50 text-green-300 border-green-700',
  PENDING:     'bg-blue-900/50 text-blue-300 border-blue-700',
  EXPIRED:     'bg-slate-700 text-slate-400 border-slate-600',
  TERMINATED:  'bg-red-900/50 text-red-300 border-red-700',
}

const APPLICATION_STATUS_COLORS: Record<string, string> = {
  PENDING:       'bg-slate-700 text-slate-400 border-slate-600',
  UNDER_REVIEW:  'bg-blue-900/50 text-blue-300 border-blue-700',
  APPROVED:      'bg-green-900/50 text-green-300 border-green-700',
  REJECTED:      'bg-red-900/50 text-red-300 border-red-700',
  WITHDRAWN:     'bg-slate-700 text-slate-400 border-slate-600',
}

const TICKET_STATUS_COLORS: Record<string, string> = {
  OPEN:            'bg-red-900/50 text-red-300 border-red-700',
  ASSIGNED:        'bg-orange-900/50 text-orange-300 border-orange-700',
  IN_PROGRESS:     'bg-blue-900/50 text-blue-300 border-blue-700',
  PENDING_PARTS:   'bg-orange-900/50 text-orange-300 border-orange-700',
  RESOLVED:        'bg-green-900/50 text-green-300 border-green-700',
  CLOSED:          'bg-slate-700 text-slate-400 border-slate-600',
  CANCELLED:       'bg-slate-700 text-slate-400 border-slate-600',
}

const RENEWAL_RESPONSE_COLORS: Record<string, string> = {
  RENEWING:    'bg-green-900/50 text-green-300 border-green-700',
  VACATING:    'bg-red-900/50 text-red-300 border-red-700',
  DISCUSSING:  'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  NO_RESPONSE: 'bg-slate-700 text-slate-400 border-slate-600',
}

const RENT_STATUS_COLORS: Record<string, string> = {
  UPCOMING:      'bg-slate-700 text-slate-300 border-slate-600',
  REMINDER_SENT: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  PAID:          'bg-green-900/50 text-green-300 border-green-700',
  PARTIAL:       'bg-orange-900/50 text-orange-300 border-orange-700',
  LATE:          'bg-red-900/50 text-red-300 border-red-700',
  WAIVED:        'bg-slate-700 text-slate-500 border-slate-600',
}

const DOC_TYPE_LABELS: Record<string, string> = {
  national_id: 'National ID', passport: 'Passport', drivers_licence: "Driver's Licence",
  employment_letter: 'Employment Letter', payslip: 'Payslip', company_reg: 'Company Registration',
  bank_statement: 'Bank Statement', utility_bill: 'Utility Bill', reference_letter: 'Reference Letter',
  tenancy_agreement: 'Tenancy Agreement', other: 'Other',
}

const TENANT_DOC_TYPES: TenantDocType[] = [
  'national_id','passport','drivers_licence','employment_letter','payslip',
  'company_reg','bank_statement','utility_bill','reference_letter','tenancy_agreement','other',
]

export function tenantDisplayName(tenant: PropertyTenant): string {
  return tenant.is_company
    ? (tenant.company_name ?? 'Tenant')
    : `${tenant.first_name}${tenant.last_name ? ` ${tenant.last_name}` : ''}`
}

/**
 * Tenant phones are typed by hand ('+1-868-291-2786', '291-2786'); WhatsApp
 * stores the E.164 digits it received from Meta ('18682912786'), and
 * GET /wa-inbox/:phone matches `from_number`/`to_number` exactly. Without
 * normalising, the Messages tab would show an empty thread for essentially
 * every tenant and look like "no messages" rather than "wrong key".
 *
 * Trinidad & Tobago is +1 868, so a bare 7-digit subscriber number and a
 * 10-digit number both expand to the same 11-digit form.
 */
export function waNumber(phone: string): string | null {
  const d = phone.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return d
  if (d.length === 10) return `1${d}`
  if (d.length === 7) return `1868${d}`
  return d.length >= 7 ? d : null
}

// ── Small shared pieces ───────────────────────────────────────────────────────

function Section({ title, count, action, children }: {
  title: string
  count?: number
  action?: { label: string; onClick: () => void }
  children: React.ReactNode
}) {
  return (
    <section className="mb-6 last:mb-0">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          {title}
          {count != null && count > 0 && <span className="ml-1.5 text-slate-500 normal-case">({count})</span>}
        </h3>
        {action && (
          <button onClick={action.onClick} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
            {action.label}
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-slate-700/50 rounded-lg border border-slate-700 p-3">{children}</div>
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm text-slate-200 mt-0.5 break-words">{value || '—'}</p>
    </div>
  )
}

function placeLabel(r: Row): string {
  const property = r['property_name'] ? String(r['property_name']) : '—'
  return r['unit_number'] ? `${property} · Unit ${String(r['unit_number'])}` : property
}

function daysUntilExpiry(expiry: string | null): number | null {
  if (!expiry) return null
  return Math.ceil((new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function ExpiryBadge({ expiry }: { expiry: string | null }) {
  const { t } = useTranslation()
  if (!expiry) return null
  const days = daysUntilExpiry(expiry)!
  const style =
    days < 0   ? 'bg-red-900/50 text-red-300 border-red-700' :
    days <= 30 ? 'bg-amber-900/50 text-amber-300 border-amber-700' :
    'bg-slate-600/50 text-slate-300 border-slate-600'
  const label =
    days < 0   ? t('tenants.docs.expired', 'Expired {{days}}d ago', { days: Math.abs(days) }) :
    days === 0 ? t('tenants.docs.expiresToday', 'Expires today') :
    t('tenants.docs.expiresIn', 'Expires in {{days}}d', { days })
  return <span className={`text-xs border px-1.5 py-0.5 rounded ${style}`}>{label}</span>
}

// ── Detail pane ───────────────────────────────────────────────────────────────

export default function TenantDetail({ tenant, onEdit, onDelete }: {
  tenant: PropertyTenant
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState<DetailTab>('overview')

  const name = tenantDisplayName(tenant)
  const hasPhone = Boolean(tenant.phone)
  const waPhone = tenant.phone ? waNumber(tenant.phone) : null

  // Overview needs the five lifecycle inputs; each other tab needs its own.
  const onOverview = tab === 'overview'

  const enquiriesQ = useQuery({
    queryKey: ['tenant-enquiries', tenant.id, tenant.phone],
    queryFn: () => tenancyApi.getEnquiries({ phone: tenant.phone! }),
    enabled: onOverview && hasPhone,
  })
  const applicationsQ = useQuery({
    queryKey: ['tenant-applications', tenant.id],
    queryFn: () => tenancyApi.getApplications({ tenant_id: tenant.id }),
    enabled: onOverview || tab === 'tenancy',
  })
  const leasesQ = useQuery({
    queryKey: ['tenant-leases', tenant.id],
    queryFn: () => propertiesApi.getLeasesForTenant(tenant.id),
    enabled: onOverview || tab === 'tenancy',
  })
  const handoverQ = useQuery({
    queryKey: ['tenant-handover', tenant.id],
    queryFn: () => tenancyApi.getHandoverForTenant(tenant.id),
    enabled: onOverview || tab === 'tenancy',
  })
  const depositsQ = useQuery({
    queryKey: ['tenant-deposits', tenant.id],
    queryFn: () => tenancyApi.getDeposits({ tenant_id: tenant.id }),
    enabled: onOverview || tab === 'money',
  })
  const renewalsQ = useQuery({
    queryKey: ['tenant-renewals', tenant.id],
    queryFn: () => tenancyApi.getRenewals({ tenant_id: tenant.id }),
    enabled: tab === 'tenancy',
  })
  const rentQ = useQuery({
    queryKey: ['tenant-rent-schedule', tenant.id],
    queryFn: () => tenancyApi.getRentSchedule({ tenant_id: tenant.id }),
    enabled: tab === 'money',
  })
  const ticketsQ = useQuery({
    queryKey: ['tenant-maintenance', tenant.id],
    queryFn: () => tenancyApi.getMaintenanceTickets({ tenant_id: tenant.id }),
    enabled: tab === 'maintenance',
  })
  const docsQ = useQuery({
    queryKey: ['tenant-docs', tenant.id],
    queryFn: () => propertiesApi.getTenantDocuments(tenant.id),
    enabled: tab === 'documents',
  })
  const threadQ = useQuery({
    queryKey: ['tenant-wa-thread', waPhone],
    queryFn: () => tenancyApi.getWaThread(waPhone!),
    enabled: tab === 'messages' && waPhone !== null,
  })

  const enquiries    = enquiriesQ.data ?? []
  const applications = applicationsQ.data ?? []
  const leases       = leasesQ.data ?? []
  const handover     = handoverQ.data ?? []
  const deposits     = depositsQ.data ?? []
  const renewals     = renewalsQ.data ?? []
  const rentPeriods  = rentQ.data ?? []
  const tickets      = ticketsQ.data ?? []
  const docs         = docsQ.data ?? []

  // i18next's `t` carries a large overload set; the timeline only ever calls it
  // as (key, fallback, opts), so it is passed through that narrower signature.
  const translate: Translate = (key, fallback, opts) => t(key, fallback, opts)

  const lifecycle = deriveLifecycle(
    { hasPhone, enquiries, applications, deposits, leases, handover },
    translate,
  )

  const lifecycleLoading =
    (hasPhone && enquiriesQ.isLoading) || applicationsQ.isLoading ||
    leasesQ.isLoading || depositsQ.isLoading || handoverQ.isLoading

  const goToTab = (target: string, focus?: string) =>
    navigate(`/properties?tab=${target}${focus ? `&focus=${focus}` : ''}`)

  const TABS: { id: DetailTab; label: string }[] = [
    { id: 'overview',    label: t('tenants.tabs.overview', 'Overview') },
    { id: 'tenancy',     label: t('tenants.tabs.tenancy', 'Tenancy') },
    { id: 'money',       label: t('tenants.tabs.money', 'Money') },
    { id: 'maintenance', label: t('tenants.tabs.maintenance', 'Maintenance') },
    { id: 'documents',   label: t('tenants.tabs.documents', 'Documents') },
    { id: 'messages',    label: t('tenants.tabs.messages', 'Messages') },
  ]

  return (
    <div className="flex-1 min-w-0 bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 bg-slate-800/80">
        <div className="flex justify-between items-start gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-100 truncate">{name}</h2>
            <p className="text-sm text-slate-400 mt-0.5">
              {tenant.phone ?? t('tenants.noPhone', 'No phone')}
              {tenant.email ? ` · ${tenant.email}` : ''}
            </p>
            <div className="flex gap-2 mt-2 flex-wrap">
              {tenant.is_company && (
                <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">
                  {t('tenants.colType', 'Company')}
                </span>
              )}
              <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">
                {t('tenants.addedOn', 'Added')} {fmtDate(tenant.created_at)}
              </span>
            </div>
          </div>
          <div className="flex gap-3 flex-shrink-0">
            <button onClick={onEdit} className="text-xs text-slate-400 hover:text-blue-400 transition-colors">
              {t('tenants.editBtn')}
            </button>
            <button
              onClick={onDelete}
              className="text-xs text-slate-600 hover:text-red-400 transition-colors"
              title={t('tenants.deleteTitle')}
            >&#x1F5D1;</button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-slate-700 overflow-x-auto">
        {TABS.map(tb => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
              tab === tb.id ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {/* ── Overview ───────────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div className="space-y-5">
            {lifecycleLoading
              ? <p className="text-slate-400 text-sm py-6 text-center">{t('common.loading')}</p>
              : <TenantTimeline lifecycle={lifecycle} />}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <InfoField label={t('tenants.phone')} value={tenant.phone ?? ''} />
              <InfoField label={t('tenants.phone2')} value={tenant.phone2 ?? ''} />
              <InfoField label={t('tenants.email')} value={tenant.email ?? ''} />
            </div>

            <Section title={t('tenants.overview.atAGlance', 'At a glance')}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {([
                  { id: 'leases',       tab: 'tenancy', n: leases.length,       label: t('tenants.overview.leases', 'leases') },
                  { id: 'deposits',     tab: 'money',   n: deposits.length,     label: t('tenants.overview.deposits', 'deposits') },
                  { id: 'applications', tab: 'tenancy', n: applications.length, label: t('tenants.overview.applications', 'applications') },
                  { id: 'handovers',    tab: 'tenancy', n: handover.length,     label: t('tenants.overview.handovers', 'handovers') },
                ] as { id: string; tab: DetailTab; n: number; label: string }[]).map(card => (
                  <button
                    key={card.id}
                    onClick={() => setTab(card.tab)}
                    className="text-left rounded-lg border border-slate-700 bg-slate-700/30 px-3 py-2 hover:border-slate-500 transition-colors"
                  >
                    <p className="text-lg font-semibold text-slate-100">{card.n}</p>
                    <p className="text-xs text-slate-400 leading-tight">{card.label}</p>
                  </button>
                ))}
              </div>
            </Section>
          </div>
        )}

        {/* ── Tenancy ────────────────────────────────────────────────────── */}
        {tab === 'tenancy' && (
          <div>
            <Section title={t('tenants.applications.title', 'Applications')} count={applications.length}>
              <TenantSectionState
                isLoading={applicationsQ.isLoading}
                error={applicationsQ.error}
                isEmpty={applications.length === 0}
                reason={t('tenants.applications.none', 'No application on file. Tenants added straight from the Tenants list have no application behind them — only those created from an approved application are linked back here.')}
              />
              <div className="space-y-2">
                {applications.map((a: Row) => (
                  <Card key={String(a['id'])}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-200">{placeLabel(a)}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {t('tenants.applications.submitted', 'Submitted')} {a['submitted_at'] ? fmtDate(String(a['submitted_at'])) : '—'}
                          {a['decision_at'] ? ` · ${t('tenants.applications.decided', 'Decided')} ${fmtDate(String(a['decision_at']))}` : ''}
                        </p>
                        {Boolean(a['monthly_income_ttd']) && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            {t('tenants.applications.income', 'Income')}: {fmtTTD(String(a['monthly_income_ttd']))}
                            {a['employer_name'] ? ` · ${String(a['employer_name'])}` : ''}
                          </p>
                        )}
                        <button
                          onClick={() => goToTab('applications', String(a['id']))}
                          className="text-xs text-blue-400 hover:text-blue-300 mt-1.5 transition-colors"
                        >
                          {t('tenants.openInList', 'Open in list →')}
                        </button>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 ${APPLICATION_STATUS_COLORS[String(a['status'])] ?? ''}`}>
                        {String(a['status'])}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            </Section>

            <Section title={t('tenants.leases.title', 'Leases')} count={leases.length}>
              <TenantSectionState
                isLoading={leasesQ.isLoading}
                error={leasesQ.error}
                isEmpty={leases.length === 0}
                reason={t('tenants.leases.none', 'No lease has been created for this tenant yet. The lease is what starts the rent schedule and links the deposit, so create it once the application is approved and the deposit is in.')}
              />
              <div className="space-y-2">
                {leases.map((l: Lease) => (
                  <Card key={l.id}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-200">
                          {l.property_name ?? '—'}{l.unit_number ? ` · Unit ${l.unit_number}` : ''}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {fmtDate(l.start_date)} — {l.end_date ? fmtDate(l.end_date) : t('tenants.leases.ongoing', 'ongoing')}
                        </p>
                        <p className="text-sm font-mono text-slate-300 mt-1">
                          {l.currency} ${parseFloat(l.monthly_rent).toLocaleString('en-TT', { minimumFractionDigits: 2 })}/mo
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 ${LEASE_STATUS_COLORS[l.status] ?? ''}`}>
                        {l.status}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            </Section>

            <Section title={t('tenants.handover.title', 'Handover')} count={handover.length}>
              <TenantSectionState
                isLoading={handoverQ.isLoading}
                error={handoverQ.error}
                isEmpty={handover.length === 0}
                reason={t('tenants.handover.none', 'No handover recorded. An ENTRY checklist is done at move-in and an EXIT one at move-out, so this stays empty until the tenant takes the keys.')}
                actionLabel={t('tenants.handover.goTo', 'Go to Handover →')}
                onAction={() => goToTab('handover')}
              />
              <div className="space-y-2">
                {handover.map((h: Row) => (
                  <Card key={String(h['id'])}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-200">{placeLabel(h)}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{fmtDate(String(h['created_at']))}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {t('tenants.handover.keys', 'Keys')}: {String(h['keys_issued'] ?? 0)}
                          {h['keys_returned'] != null ? ` / ${String(h['keys_returned'])} ${t('tenants.handover.returned', 'returned')}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-600">
                          {String(h['type'] ?? '')}
                        </span>
                        {Boolean(h['completed_at']) && (
                          <span className="text-xs px-2 py-0.5 rounded border bg-green-900/50 text-green-300 border-green-700">
                            {t('tenants.handover.completed', 'Completed')}
                          </span>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </Section>

            <Section title={t('tenants.renewals.title', 'Renewals')} count={renewals.length}>
              <TenantSectionState
                isLoading={renewalsQ.isLoading}
                error={renewalsQ.error}
                isEmpty={renewals.length === 0}
                reason={t('tenants.renewals.none', 'No renewal notices. These are raised against a lease as it nears its end date — 60, 30 and 14 days out — so there is nothing here until this tenant holds a lease approaching expiry.')}
              />
              <div className="space-y-2">
                {renewals.map((r: Row) => (
                  <Card key={String(r['id'])}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-200">{placeLabel(r)}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {t('tenancy.leaseEnd', 'Lease Ends')}: {r['lease_end_date'] ? fmtDate(String(r['lease_end_date'])) : '—'}
                        </p>
                        {Boolean(r['monthly_rent']) && (
                          <p className="text-xs text-slate-400 mt-0.5">{fmtTTD(String(r['monthly_rent']))}/mo</p>
                        )}
                      </div>
                      {r['tenant_response']
                        ? <span className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 ${RENEWAL_RESPONSE_COLORS[String(r['tenant_response'])] ?? ''}`}>
                            {String(r['tenant_response']).replace(/_/g, ' ')}
                          </span>
                        : <span className="text-xs text-slate-500 flex-shrink-0">{t('tenancy.awaitingResponse', 'Awaiting Response')}</span>}
                    </div>
                  </Card>
                ))}
              </div>
            </Section>
          </div>
        )}

        {/* ── Money ──────────────────────────────────────────────────────── */}
        {tab === 'money' && (
          <div>
            <Section
              title={t('tenants.deposits.title', 'Deposits')}
              count={deposits.length}
              action={{ label: t('tenants.openInList', 'Open in list →'), onClick: () => goToTab('deposits') }}
            >
              <TenantSectionState
                isLoading={depositsQ.isLoading}
                error={depositsQ.error}
                isEmpty={deposits.length === 0}
                reason={t('tenants.deposits.none', 'No deposits linked to this tenant. Deposits recorded without naming a tenant stay unlinked — open the deposit in Money → Deposits and pick the tenant to attach it.')}
                actionLabel={t('tenants.deposits.goTo', 'Go to Deposits →')}
                onAction={() => goToTab('deposits')}
              />
              <div className="space-y-2">
                {deposits.map((d: Row) => (
                  <Card key={String(d['id'])}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-slate-400">
                          {t('tenants.deposits.unit', 'Unit')} {String(d['unit_number'] ?? '—')} · {String(d['received_date'] ?? '')}
                        </p>
                        <p className="text-sm font-mono text-slate-200 mt-1">{fmtTTD(String(d['amount_ttd'] ?? 0))}</p>
                        <p className="text-xs text-slate-500">
                          {t('tenancy.receiptNo', 'Receipt')}: {String(d['receipt_number'] ?? '—')}
                          <button
                            onClick={() => void api.openHtml(`/properties/deposits/${String(d['id'])}/receipt`)
                              .catch(() => alert(t('tenants.deposits.receiptFailed', 'Could not open the receipt.')))}
                            className="text-blue-400 hover:text-blue-300 ml-2"
                          >
                            {t('tenancy.printReceipt', 'Print receipt')}
                          </button>
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 ${DEPOSIT_STATUS_COLORS[String(d['status'])] ?? ''}`}>
                        {String(d['status'])}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            </Section>

            <Section
              title={t('tenants.rentSchedule.title', 'Rent Schedule')}
              count={rentPeriods.length}
              action={{ label: t('tenants.openInList', 'Open in list →'), onClick: () => goToTab('rent') }}
            >
              <TenantSectionState
                isLoading={rentQ.isLoading}
                error={rentQ.error}
                isEmpty={rentPeriods.length === 0}
                reason={t('tenants.rentSchedule.none', 'No rent schedule yet. Periods are generated from the lease, so this fills in once a lease exists for this tenant.')}
              />
              <div className="space-y-2">
                {rentPeriods.map((rs: Row) => (
                  <Card key={String(rs['id'])}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-200">{placeLabel(rs)}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {t('tenancy.due', 'Due')}: {fmtDate(String(rs['due_date']))}
                        </p>
                        <p className="text-sm font-mono text-slate-300 mt-1">{fmtTTD(String(rs['amount_due_ttd'] ?? 0))}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 ${RENT_STATUS_COLORS[String(rs['status'])] ?? ''}`}>
                        {String(rs['status'])}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            </Section>
          </div>
        )}

        {/* ── Maintenance ────────────────────────────────────────────────── */}
        {tab === 'maintenance' && (
          <Section
            title={t('tenants.maintenance.title', 'Maintenance')}
            count={tickets.length}
            action={{ label: t('tenants.openInList', 'Open in list →'), onClick: () => goToTab('maintenance') }}
          >
            <TenantSectionState
              isLoading={ticketsQ.isLoading}
              error={ticketsQ.error}
              isEmpty={tickets.length === 0}
              reason={t('tenants.maintenance.none', 'No maintenance tickets for this tenant. A ticket is attached to whoever holds the unit — pick the tenant on the ticket form if the unit has no active lease.')}
              actionLabel={t('tenants.maintenance.goTo', 'Go to Tickets →')}
              onAction={() => goToTab('maintenance')}
            />
            <div className="space-y-2">
              {tickets.map((tk: Row) => (
                <Card key={String(tk['id'])}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200">
                        {String(tk['ticket_ref'] ?? '—')} · {String(tk['category'] ?? '')}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">{placeLabel(tk)} · {fmtDate(String(tk['created_at']))}</p>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2">{String(tk['description'] ?? '')}</p>
                      <button
                        onClick={() => goToTab('maintenance', String(tk['id']))}
                        className="text-xs text-blue-400 hover:text-blue-300 mt-1.5 transition-colors"
                      >
                        {t('tenants.openInList', 'Open in list →')}
                      </button>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-600">
                        {String(tk['priority'] ?? '')}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded border ${TICKET_STATUS_COLORS[String(tk['status'])] ?? ''}`}>
                        {String(tk['status'])}
                      </span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </Section>
        )}

        {/* ── Documents ──────────────────────────────────────────────────── */}
        {tab === 'documents' && (
          <TenantDocuments tenantId={tenant.id} docs={docs} isLoading={docsQ.isLoading} error={docsQ.error} qc={qc} />
        )}

        {/* ── Messages ───────────────────────────────────────────────────── */}
        {tab === 'messages' && (
          <Section title={t('tenants.messages.title', 'Messages')}>
            {!waPhone ? (
              <div className="rounded-lg border border-dashed border-slate-700 px-4 py-6 text-center">
                <p className="text-sm text-slate-400">
                  {t('tenants.messages.noPhone', 'No phone number on file, so there is no WhatsApp thread to show. Add one on the tenant record.')}
                </p>
              </div>
            ) : (
              <>
                <TenantSectionState
                  isLoading={threadQ.isLoading}
                  error={threadQ.error}
                  isEmpty={(threadQ.data?.messages?.length ?? 0) === 0}
                  // Naming the number that was searched makes a format mismatch
                  // diagnosable instead of indistinguishable from "no messages".
                  reason={`${t('tenants.messages.none', 'No WhatsApp messages with this number yet. Threads appear here once the tenant messages the business number, or once a reminder or reply is sent to them.')} (${waPhone})`}
                  actionLabel={t('tenants.messages.goTo', 'Go to WhatsApp inbox →')}
                  onAction={() => goToTab('whatsapp')}
                />
                <div className="space-y-2">
                  {(threadQ.data?.messages ?? []).map((m: Row) => {
                    const inbound = String(m['direction'] ?? '') === 'INBOUND'
                    const hasMedia = Boolean(m['has_media'])
                    const messageType = String(m['message_type'] ?? '')
                    const mediaPath = `/properties/wa-inbox/media/${String(m['id'])}`
                    return (
                      <div
                        key={String(m['id'])}
                        className={`rounded-lg border p-3 ${
                          inbound
                            ? 'bg-slate-700/50 border-slate-700'
                            : 'bg-blue-900/20 border-blue-800 ml-6'
                        }`}
                      >
                        {hasMedia && messageType === 'IMAGE' && (
                          <button
                            type="button"
                            onClick={() => { void api.objectUrl(mediaPath).then(url => window.open(url, '_blank')) }}
                            className="block mb-2"
                          >
                            <AuthedImg path={mediaPath} className="max-h-48 rounded border border-slate-600 object-cover" />
                          </button>
                        )}
                        {hasMedia && messageType !== 'IMAGE' && (
                          <button
                            type="button"
                            onClick={() => { void api.objectUrl(mediaPath).then(url => window.open(url, '_blank')) }}
                            className="mb-2 flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200"
                          >
                            📎 {t('tenants.messages.attachment', 'Open attachment')} ({messageType.toLowerCase()})
                          </button>
                        )}
                        {Boolean(m['body']) && (
                          <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">
                            {String(m['body'] ?? '')}
                          </p>
                        )}
                        <p className="text-xs text-slate-500 mt-1">
                          {inbound ? t('tenants.messages.received', 'Received') : t('tenants.messages.sent', 'Sent')}
                          {m['created_at'] ? ` · ${fmtDate(String(m['created_at']))}` : ''}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </Section>
        )}
      </div>
    </div>
  )
}

// ── Documents tab ─────────────────────────────────────────────────────────────
// Lifted wholesale from the old TenantDocsModal -- upload, expiry editing,
// download and delete all behaved correctly, they were just trapped in a dialog.

function TenantDocuments({ tenantId, docs, isLoading, error, qc }: {
  tenantId: string
  docs: TenantDocument[]
  isLoading: boolean
  error: unknown
  qc: ReturnType<typeof useQueryClient>
}) {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)
  const [docType, setDocType] = useState<TenantDocType>('national_id')
  const [expiryDate, setExpiryDate] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingExpiryId, setEditingExpiryId] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['tenant-docs', tenantId] })

  const deleteMut = useMutation({
    mutationFn: (docId: string) => propertiesApi.deleteTenantDocument(tenantId, docId),
    onSuccess: () => { setDeletingId(null); invalidate() },
  })

  const expiryMut = useMutation({
    mutationFn: ({ docId, expiry }: { docId: string; expiry: string | null }) =>
      propertiesApi.updateTenantDocumentExpiry(tenantId, docId, expiry),
    onSuccess: () => { setEditingExpiryId(null); invalidate() },
  })

  async function handleUpload(file: File) {
    setUploading(true)
    setUploadError(null)
    try {
      await propertiesApi.uploadTenantDocument(tenantId, docType, file, undefined, expiryDate || undefined)
      setExpiryDate('')
      invalidate()
    } catch {
      setUploadError(t('tenants.docs.uploadError', 'Upload failed. Please try again.'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDownload(doc: TenantDocument) {
    setDownloading(doc.id)
    try { await propertiesApi.downloadTenantDocument(tenantId, doc.id, doc.file_name) }
    catch { /* silent — the browser surfaces a network error itself */ }
    finally { setDownloading(null) }
  }

  return (
    <Section title={t('tenants.docs.title', 'Documents')} count={docs.length}>
      <div className="flex gap-2 mb-4 flex-wrap">
        <select
          value={docType}
          onChange={e => setDocType(e.target.value as TenantDocType)}
          className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {TENANT_DOC_TYPES.map(dt => (
            <option key={dt} value={dt}>{t(`tenants.docs.types.${dt}`, DOC_TYPE_LABELS[dt])}</option>
          ))}
        </select>
        <input
          type="date"
          value={expiryDate}
          onChange={e => setExpiryDate(e.target.value)}
          title={t('tenants.docs.expiryOptional', 'Expiry date (optional)')}
          className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) void handleUpload(f) }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
        >
          {uploading ? t('common.uploading', 'Uploading…') : t('tenants.docs.uploadBtn', '+ Upload')}
        </button>
        {uploadError && <p className="text-red-400 text-xs self-center">{uploadError}</p>}
      </div>

      <TenantSectionState
        isLoading={isLoading}
        error={error}
        isEmpty={docs.length === 0}
        reason={t('tenants.docs.none', 'No documents on file. Anything supplied with an online application is copied here automatically; otherwise upload ID, employment letter and references above.')}
      />

      <div className="space-y-2">
        {docs.map(doc => (
          <div key={doc.id} className="flex items-center gap-3 bg-slate-700/50 rounded-lg px-3 py-2.5 border border-slate-700">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-xs font-medium text-slate-300 bg-slate-600 px-1.5 py-0.5 rounded">
                  {t(`tenants.docs.types.${doc.doc_type}`, DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type)}
                </span>
                {doc.source === 'APPLICATION' && (
                  <span className="text-xs bg-blue-900/50 text-blue-300 border border-blue-700 px-1.5 py-0.5 rounded">
                    {t('tenants.docs.fromApp', 'from app')}
                  </span>
                )}
                <ExpiryBadge expiry={doc.expiry_date} />
              </div>
              <p className="text-sm text-slate-200 mt-1 truncate">{doc.file_name}</p>
              <p className="text-xs text-slate-500">{fmtDate(doc.created_at)}</p>
              {editingExpiryId === doc.id ? (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <input
                    type="date"
                    defaultValue={doc.expiry_date ?? ''}
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') expiryMut.mutate({ docId: doc.id, expiry: (e.target as HTMLInputElement).value || null })
                      if (e.key === 'Escape') setEditingExpiryId(null)
                    }}
                    onBlur={e => expiryMut.mutate({ docId: doc.id, expiry: e.target.value || null })}
                    className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  {expiryMut.isPending && <span className="text-xs text-slate-500">…</span>}
                </div>
              ) : (
                <button
                  onClick={() => setEditingExpiryId(doc.id)}
                  className="text-xs text-slate-500 hover:text-blue-400 transition-colors mt-1"
                >
                  {doc.expiry_date
                    ? t('tenants.docs.editExpiry', 'Edit expiry')
                    : t('tenants.docs.setExpiry', '+ Set expiry date')}
                </button>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => void handleDownload(doc)}
                disabled={downloading === doc.id}
                className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
              >
                {downloading === doc.id ? '…' : t('common.download', 'Download')}
              </button>
              {deletingId === doc.id ? (
                <span className="text-xs text-red-400">
                  <button onClick={() => deleteMut.mutate(doc.id)} className="hover:text-red-300">{t('common.yes', 'Yes')}</button>
                  {' / '}
                  <button onClick={() => setDeletingId(null)} className="hover:text-slate-200">{t('common.no', 'No')}</button>
                </span>
              ) : (
                <button
                  onClick={() => setDeletingId(doc.id)}
                  className="text-xs text-slate-600 hover:text-red-400 transition-colors"
                  title={t('tenants.docs.delete', 'Delete document')}
                >&#x1F5D1;</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
