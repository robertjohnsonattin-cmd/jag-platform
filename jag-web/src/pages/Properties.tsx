import { useState } from 'react'
import PropertiesPanel from '../components/properties/PropertiesPanel'
import TenantsPanel from '../components/properties/TenantsPanel'
import PipelinePanel from '../components/properties/PipelinePanel'

const TABS = [
  { id: 'properties', label: 'Properties' },
  { id: 'tenants',    label: 'Tenants' },
  { id: 'pipeline',   label: 'Acquisition Pipeline' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function Properties() {
  const [tab, setTab] = useState<TabId>('properties')

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Properties</h1>

      <div className="flex gap-1 mb-6 border-b border-slate-700">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? 'border-blue-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'properties' && <PropertiesPanel />}
      {tab === 'tenants'    && <TenantsPanel />}
      {tab === 'pipeline'   && <PipelinePanel />}
    </div>
  )
}
