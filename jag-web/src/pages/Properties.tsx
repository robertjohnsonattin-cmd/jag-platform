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

// Tabs are grouped into short sections so the nav fits two shallow rows
// instead of one 17-wide scroll strip — the flat list was unusable on mobile.
const GROUPS = [
  {
    id: 'overview',
    key: 'properties.groups.overview',
    tabs: [
      { id: 'properties', key: 'properties.tabs.properties' },
      { id: 'tenants',    key: 'properties.tabs.tenants' },
      { id: 'doc_expiry', key: 'tenancy.tabs.docExpiry' },
    ],
  },
  {
    id: 'leasing',
    key: 'properties.groups.leasing',
    tabs: [
      { id: 'pipeline',     key: 'properties.tabs.pipeline' },
      { id: 'enquiries',    key: 'tenancy.tabs.enquiries' },
      { id: 'viewings',     key: 'tenancy.tabs.viewings' },
      { id: 'applications', key: 'tenancy.tabs.applications' },
      { id: 'renewals',     key: 'tenancy.tabs.renewals' },
    ],
  },
  {
    id: 'tenancy_ops',
    key: 'properties.groups.tenancyOps',
    tabs: [
      { id: 'deposits',       key: 'tenancy.tabs.deposits' },
      { id: 'rent',           key: 'tenancy.tabs.rent' },
      { id: 'reconciliation', key: 'tenancy.tabs.reconciliation' },
      { id: 'handover',       key: 'tenancy.tabs.handover' },
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
    id: 'comms',
    key: 'properties.groups.comms',
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

export default function Properties() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab')
  const focusId = searchParams.get('focus')
  const startTab: TabId = initialTab && VALID_TAB_IDS.has(initialTab as TabId) ? (initialTab as TabId) : 'properties'
  const [tab, setTab] = useState<TabId>(startTab)
  const [group, setGroup] = useState<GroupId>(TAB_TO_GROUP.get(startTab)!)

  // `useState` reads its initial value once, so a `?tab=` that arrives while
  // this page is already mounted used to change the URL and nothing else. That
  // is the case for every cross-reference link out of Tenant 360 (and for the
  // notification bell when Properties is already open). Follow the URL when it
  // moves; the tab row still drives itself through setTab for ordinary clicks.
  useEffect(() => {
    if (initialTab && VALID_TAB_IDS.has(initialTab as TabId)) {
      setTab(initialTab as TabId)
      setGroup(TAB_TO_GROUP.get(initialTab as TabId)!)
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
      {tab === 'tenants'      && <TenantsPanel />}
      {tab === 'doc_expiry'   && <PropertiesDocExpiryPanel />}
      {tab === 'pipeline'     && <PipelinePanel />}
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
