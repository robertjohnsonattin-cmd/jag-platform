import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { brianApi } from '../api/brian'
import { useAuth } from '../auth/AuthProvider'
import type { BrianModule } from '../api/brian'

// Brian's portal is a read-only simplified shell. Pages are loaded lazily based
// on which modules Robert has granted access to.

// Inline lightweight views for each module Brian may see.
// These use the standard API clients — the backend brianPortalGate enforces
// READ/WRITE limits server-side; the frontend just renders what comes back.

import { jabcoApi } from '../api/jabco'
import { propertiesApi } from '../api/properties'
import type { Property } from '../types/properties'
import { imsApi } from '../api/ims'
import { crmApi } from '../api/crm'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtM = (v: number | string | null | undefined) => v == null ? '—' : `TTD ${fmt.format(parseFloat(String(v)))}`

// ── Module views ──────────────────────────────────────────────────────────────

function JabcoView() {
  const { data } = useQuery({ queryKey: ['brian-jabco-projects'], queryFn: () => jabcoApi.getProjects({}) })
  const projects = data?.projects ?? []
  return (
    <div className="space-y-3">
      <h2 className="text-white font-semibold text-lg">JABCO Projects</h2>
      {projects.length === 0 && <p className="text-slate-400 text-sm">No projects.</p>}
      {projects.map(p => (
        <div key={p.id} className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-white font-medium">{p.name}</p>
              <p className="text-slate-400 text-sm">{p.client_name ?? '—'} · {p.site_address ?? '—'}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-white text-sm">{fmtM(p.contract_value)}</p>
              <p className="text-slate-400 text-xs">{p.status}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function PropertiesView() {
  const { data: properties = [] } = useQuery({ queryKey: ['brian-properties'], queryFn: () => propertiesApi.getProperties() })
  return (
    <div className="space-y-3">
      <h2 className="text-white font-semibold text-lg">Properties</h2>
      {(properties as Property[]).length === 0 && <p className="text-slate-400 text-sm">No properties.</p>}
      {(properties as Property[]).map(p => (
        <div key={p.id} className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 flex justify-between items-center gap-3">
          <div>
            <p className="text-white font-medium">{p.name}</p>
            <p className="text-slate-400 text-sm">{p.address_line1}, {p.city} · {p.property_type}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-white text-sm">{p.current_valuation ? fmtM(parseFloat(p.current_valuation)) : '—'}</p>
            <p className="text-slate-400 text-xs">{p.is_rented ? 'Rented' : 'Vacant'}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function InventoryView() {
  const { data } = useQuery({ queryKey: ['brian-ims'], queryFn: () => imsApi.getItems({ limit: 50 }) })
  const items = data?.items ?? []
  return (
    <div className="space-y-3">
      <h2 className="text-white font-semibold text-lg">Inventory</h2>
      {items.length === 0 && <p className="text-slate-400 text-sm">No items.</p>}
      {items.map(item => (
        <div key={item.id} className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 flex justify-between items-center gap-3">
          <div>
            <p className="text-white font-medium">{item.name}</p>
            <p className="text-slate-400 text-sm">{item.location_code} · {item.category_name ?? 'Uncategorised'}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-white text-sm">{item.quantity_on_hand} {item.unit_of_measure}</p>
            <p className="text-slate-400 text-xs">{item.condition}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function CRMView() {
  const [search, setSearch] = useState('')
  const { data } = useQuery({
    queryKey: ['brian-crm', search],
    queryFn: () => crmApi.getCompanies({ search: search || undefined, limit: 30 }),
  })
  const companies = data?.companies ?? []
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-white font-semibold text-lg">CRM — Companies</h2>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm w-48" />
      </div>
      {companies.length === 0 && <p className="text-slate-400 text-sm">No companies.</p>}
      {companies.map(co => (
        <div key={co.id} className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 flex justify-between items-center gap-3">
          <div>
            <p className="text-white font-medium">{co.name}</p>
            <p className="text-slate-400 text-sm">{co.industry ?? '—'} · {co.country}</p>
          </div>
          <p className="text-slate-400 text-sm shrink-0">{co.contact_count} contacts</p>
        </div>
      ))}
    </div>
  )
}

function ComingSoonView({ module }: { module: string }) {
  return (
    <div className="flex items-center justify-center h-48">
      <p className="text-slate-500 text-sm">{module} view coming soon.</p>
    </div>
  )
}

// ── Module registry ───────────────────────────────────────────────────────────

const MODULE_LABELS: Record<BrianModule, string> = {
  PROPERTIES:    'Properties',
  JABCO:         'JABCO',
  IMS:           'Inventory',
  CRM:           'CRM',
  FAMILY:        'Family',
  LIFESTYLE:     'Lifestyle',
  DOCVAULT:      'DocVault',
  SUCCESSION:    'Succession',
  BAR:           'BAR',
  CLUB:          'Members Club',
  ENTERTAINMENT: 'Entertainment',
  DRAGONBRIDGE:  'DragonBridge',
  FINANCE:       'Finance',
  NLCB:          'NLCB',
}

function ModuleView({ module }: { module: BrianModule }) {
  switch (module) {
    case 'JABCO':      return <JabcoView />
    case 'PROPERTIES': return <PropertiesView />
    case 'IMS':        return <InventoryView />
    case 'CRM':        return <CRMView />
    default:           return <ComingSoonView module={MODULE_LABELS[module]} />
  }
}

// ── Portal shell ──────────────────────────────────────────────────────────────

export default function BrianPortal() {
  const { logout } = useAuth()
  const [activeModule, setActiveModule] = useState<BrianModule | null>(null)

  const { data: permissions = [], isLoading } = useQuery({
    queryKey: ['brian-permissions'],
    queryFn: brianApi.getPermissions,
  })

  const accessible = permissions.filter(p => p.access_level !== 'NONE')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900 text-slate-400 text-sm">
        Loading portal…
      </div>
    )
  }

  const current = activeModule ?? (accessible[0]?.module ?? null)

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-700">
          <p className="text-white font-bold text-base">JAG Holdings</p>
          <p className="text-slate-400 text-xs mt-0.5">Brian's Portal</p>
        </div>

        <nav className="flex-1 overflow-y-auto py-3">
          {accessible.length === 0 && (
            <p className="px-5 text-slate-500 text-xs py-4">No modules granted yet.</p>
          )}
          {accessible.map(p => (
            <button
              key={p.module}
              onClick={() => setActiveModule(p.module)}
              className={`w-full text-left px-5 py-2.5 text-sm transition-colors flex items-center justify-between gap-2 ${
                current === p.module
                  ? 'bg-slate-700 text-white font-medium'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <span>{MODULE_LABELS[p.module]}</span>
              {p.access_level === 'READ' && (
                <span className="text-xs text-blue-400 shrink-0">Read</span>
              )}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <button
            onClick={logout}
            className="w-full text-left text-slate-400 hover:text-white text-sm transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {current === null ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            No modules have been granted access yet. Contact Robert.
          </div>
        ) : (
          <div className="p-6 max-w-3xl">
            <ModuleView module={current} />
          </div>
        )}
      </main>
    </div>
  )
}
