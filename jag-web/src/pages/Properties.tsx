import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import PropertiesPanel from '../components/properties/PropertiesPanel'
import TenantsPanel from '../components/properties/TenantsPanel'
import PipelinePanel from '../components/properties/PipelinePanel'

const TABS = [
  { id: 'properties', key: 'properties.tabs.properties' },
  { id: 'tenants',    key: 'properties.tabs.tenants' },
  { id: 'pipeline',   key: 'properties.tabs.pipeline' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function Properties() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<TabId>('properties')

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">{t('properties.title')}</h1>

      <div className="flex gap-1 mb-6 border-b border-slate-700">
        {TABS.map(tb => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === tb.id
                ? 'border-blue-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t(tb.key)}
          </button>
        ))}
      </div>

      {tab === 'properties' && <PropertiesPanel />}
      {tab === 'tenants'    && <TenantsPanel />}
      {tab === 'pipeline'   && <PipelinePanel />}
    </div>
  )
}
