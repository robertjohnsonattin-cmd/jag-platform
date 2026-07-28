import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import PropertiesPanel from '../components/properties/PropertiesPanel'
import TenantsPanel from '../components/properties/TenantsPanel'
import PipelinePanel from '../components/properties/PipelinePanel'
import PropertiesEnquiriesPanel from '../components/properties/PropertiesEnquiriesPanel'
import PropertiesViewingsPanel from '../components/properties/PropertiesViewingsPanel'
import PropertiesApplicationsPanel from '../components/properties/PropertiesApplicationsPanel'
import PropertiesRentSchedulePanel from '../components/properties/PropertiesRentSchedulePanel'
import PropertiesDepositsPanel from '../components/properties/PropertiesDepositsPanel'
import PropertiesMaintenancePanel from '../components/properties/PropertiesMaintenancePanel'
import PropertiesScheduledMaintenancePanel from '../components/properties/PropertiesScheduledMaintenancePanel'
import PropertiesReconciliationPanel from '../components/properties/PropertiesReconciliationPanel'
import PropertiesDocExpiryPanel from '../components/properties/PropertiesDocExpiryPanel'
import PropertiesContractorsPanel from '../components/properties/PropertiesContractorsPanel'
import PropertiesHandoverPanel from '../components/properties/PropertiesHandoverPanel'
import PropertiesRenewalsPanel from '../components/properties/PropertiesRenewalsPanel'
import PropertiesWhatsAppPanel from '../components/properties/PropertiesWhatsAppPanel'
import PropertiesWaApprovalsPanel from '../components/properties/PropertiesWaApprovalsPanel'
import UnitsPanel from '../components/properties/UnitsPanel'
import LeasesPanel from '../components/properties/LeasesPanel'

// Tabs are grouped into short sections so the nav fits two shallow rows
// instead of one 17-wide scroll strip — the flat list was unusable on mobile.
//
// Restructured in Phase 3: acquisitions moved out of Leasing (buying a property
// is not part of letting one), the whole tenancy lifecycle now reads left to
// right inside Leasing, and the money tabs stopped being called "Tenancy Ops".
const GROUPS = [
  {
    id: 'portfolio',
    key: 'properties.groups.portfolio',
    tabs: [
      { id: 'properties',   key: 'properties.tabs.properties' },
      { id: 'units',        key: 'properties.tabs.units' },
      { id: 'acquisitions', key: 'properties.tabs.acquisitions' },
    ],
  },
  {
    id: 'leasing',
    key: 'properties.groups.leasing',
    tabs: [
      { id: 'enquiries',    key: 'tenancy.tabs.enquiries' },
      { id: 'viewings',     key: 'tenancy.tabs.viewings' },
      { id: 'applications', key: 'tenancy.tabs.applications' },
      { id: 'leases',       key: 'tenancy.tabs.leases' },
      { id: 'handover',     key: 'tenancy.tabs.handover' },
      { id: 'renewals',     key: 'tenancy.tabs.renewals' },
    ],
  },
  {
    id: 'tenants',
    key: 'properties.groups.tenants',
    tabs: [
      { id: 'tenants',    key: 'properties.tabs.tenant360' },
      // The plan retired this tab in favour of a Phase 5 landing card. Phase 5
      // is explicitly droppable, so retiring it now would make a working,
      // deployed portfolio-wide view unreachable. It lives here — every row it
      // shows is a tenant document — until that card actually exists.
      { id: 'doc_expiry', key: 'tenancy.tabs.docExpiry' },
    ],
  },
  {
    id: 'money',
    key: 'properties.groups.money',
    tabs: [
      { id: 'rent',           key: 'tenancy.tabs.rent' },
      { id: 'deposits',       key: 'tenancy.tabs.deposits' },
      { id: 'reconciliation', key: 'tenancy.tabs.reconciliation' },
    ],
  },
  {
    id: 'maintenance',
    key: 'properties.groups.maintenance',
    tabs: [
      { id: 'maintenance',       key: 'tenancy.tabs.maintenance' },
      { id: 'sched_maintenance', key: 'tenancy.tabs.schedMaintenance' },
      { id: 'contractors',       key: 'tenancy.tabs.contractors' },
    ],
  },
  {
    id: 'inbox',
    key: 'properties.groups.inbox',
    tabs: [
      { id: 'whatsapp',  key: 'tenancy.tabs.whatsapp' },
      { id: 'approvals', key: 'tenancy.tabs.approvals' },
    ],
  },
] as const

type TabId = (typeof GROUPS)[number]['tabs'][number]['id']
type GroupId = (typeof GROUPS)[number]['id']

const TAB_TO_GROUP = new Map<TabId, GroupId>(
  GROUPS.flatMap(g => g.tabs.map(tb => [tb.id, g.id] as [TabId, GroupId])),
)
const VALID_TAB_IDS = new Set(TAB_TO_GROUP.keys())

// Tab ids are a public contract: the notification bell, WhatsApp deep links and
// anything Robert has bookmarked all arrive as `?tab=`. Renaming one without an
// alias silently drops the caller onto the default tab.
const LEGACY_TAB_IDS: Record<string, TabId> = {
  pipeline: 'acquisitions',
}

function resolveTab(raw: string | null): TabId | null {
  if (!raw) return null
  const mapped = LEGACY_TAB_IDS[raw] ?? raw
  return VALID_TAB_IDS.has(mapped as TabId) ? (mapped as TabId) : null
}

export default function Properties() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab')
  const focusId = searchParams.get('focus')
  const startTab: TabId = resolveTab(initialTab) ?? 'properties'
  const [tab, setTab] = useState<TabId>(startTab)
  const [group, setGroup] = useState<GroupId>(TAB_TO_GROUP.get(startTab)!)

  // `useState` reads its initial value once, so a `?tab=` that arrives while
  // this page is already mounted used to change the URL and nothing else. That
  // is the case for every cross-reference link out of Tenant 360 (and for the
  // notification bell when Properties is already open). Follow the URL when it
  // moves; the tab row still drives itself through setTab for ordinary clicks.
  useEffect(() => {
    const next = resolveTab(initialTab)
    if (next) {
      setTab(next)
      setGroup(TAB_TO_GROUP.get(next)!)
    }
  }, [initialTab])

  const activeGroup = GROUPS.find(g => g.id === group)!

  const selectGroup = (g: GroupId) => {
    setGroup(g)
    setTab(GROUPS.find(gr => gr.id === g)!.tabs[0].id)
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">{t('properties.title')}</h1>

      {/* Section row */}
      <div className="flex gap-1 mb-1 overflow-x-auto">
        {GROUPS.map(g => (
          <button
            key={g.id}
            onClick={() => selectGroup(g.id)}
            className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wide rounded-t-md whitespace-nowrap transition-colors ${
              group === g.id
                ? 'bg-slate-800 text-white'
                : 'bg-slate-900 text-slate-500 hover:text-slate-300'
            }`}
          >
            {t(g.key, g.id)}
          </button>
        ))}
      </div>

      {/* Tab row for the active section */}
      <div className="flex gap-1 mb-6 border-b border-slate-700 overflow-x-auto pb-0 bg-slate-800/50 rounded-t-md">
        {activeGroup.tabs.map(tb => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
              tab === tb.id
                ? 'border-blue-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t(tb.key, tb.id.charAt(0).toUpperCase() + tb.id.slice(1))}
          </button>
        ))}
      </div>

      {tab === 'properties'   && <PropertiesPanel />}
      {tab === 'units'        && <UnitsPanel />}
      {tab === 'acquisitions' && <PipelinePanel />}
      {tab === 'tenants'      && <TenantsPanel />}
      {tab === 'doc_expiry'   && <PropertiesDocExpiryPanel />}
      {tab === 'leases'       && <LeasesPanel />}
      {tab === 'enquiries'    && <PropertiesEnquiriesPanel focusId={focusId} />}
      {tab === 'viewings'     && <PropertiesViewingsPanel />}
      {tab === 'applications' && <PropertiesApplicationsPanel focusId={focusId} />}
      {tab === 'deposits'     && <PropertiesDepositsPanel />}
      {tab === 'rent'         && <PropertiesRentSchedulePanel />}
      {tab === 'reconciliation' && <PropertiesReconciliationPanel />}
      {tab === 'maintenance'  && <PropertiesMaintenancePanel focusId={focusId} />}
      {tab === 'sched_maintenance' && <PropertiesScheduledMaintenancePanel />}
      {tab === 'contractors'  && <PropertiesContractorsPanel />}
      {tab === 'handover'     && <PropertiesHandoverPanel />}
      {tab === 'renewals'     && <PropertiesRenewalsPanel />}
      {tab === 'whatsapp'     && <PropertiesWhatsAppPanel />}
      {tab === 'approvals'    && <PropertiesWaApprovalsPanel />}
    </div>
  )
}
