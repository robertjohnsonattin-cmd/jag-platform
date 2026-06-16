import { useState } from 'react'
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
import PropertiesContractorsPanel from '../components/properties/PropertiesContractorsPanel'
import PropertiesHandoverPanel from '../components/properties/PropertiesHandoverPanel'
import PropertiesRenewalsPanel from '../components/properties/PropertiesRenewalsPanel'
import PropertiesWhatsAppPanel from '../components/properties/PropertiesWhatsAppPanel'

const TABS = [
  { id: 'properties',  key: 'properties.tabs.properties' },
  { id: 'tenants',     key: 'properties.tabs.tenants' },
  { id: 'pipeline',    key: 'properties.tabs.pipeline' },
  { id: 'enquiries',   key: 'tenancy.tabs.enquiries' },
  { id: 'viewings',    key: 'tenancy.tabs.viewings' },
  { id: 'applications',key: 'tenancy.tabs.applications' },
  { id: 'deposits',    key: 'tenancy.tabs.deposits' },
  { id: 'rent',        key: 'tenancy.tabs.rent' },
  { id: 'maintenance', key: 'tenancy.tabs.maintenance' },
  { id: 'contractors', key: 'tenancy.tabs.contractors' },
  { id: 'handover',    key: 'tenancy.tabs.handover' },
  { id: 'renewals',    key: 'tenancy.tabs.renewals' },
  { id: 'whatsapp',    key: 'tenancy.tabs.whatsapp' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function Properties() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<TabId>('properties')

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">{t('properties.title')}</h1>

      <div className="flex gap-1 mb-6 border-b border-slate-700 overflow-x-auto pb-0">
        {TABS.map(tb => (
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
      {tab === 'pipeline'     && <PipelinePanel />}
      {tab === 'enquiries'    && <PropertiesEnquiriesPanel />}
      {tab === 'viewings'     && <PropertiesViewingsPanel />}
      {tab === 'applications' && <PropertiesApplicationsPanel />}
      {tab === 'deposits'     && <PropertiesDepositsPanel />}
      {tab === 'rent'         && <PropertiesRentSchedulePanel />}
      {tab === 'maintenance'  && <PropertiesMaintenancePanel />}
      {tab === 'contractors'  && <PropertiesContractorsPanel />}
      {tab === 'handover'     && <PropertiesHandoverPanel />}
      {tab === 'renewals'     && <PropertiesRenewalsPanel />}
      {tab === 'whatsapp'     && <PropertiesWhatsAppPanel />}
    </div>
  )
}
