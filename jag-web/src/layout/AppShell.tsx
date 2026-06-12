import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/finance', label: 'Finance' },
  { to: '/ledger', label: 'Ledger' },
  { to: '/reports', label: 'Reports' },
  { to: '/expenses', label: 'Expenses' },
  { to: '/properties', label: 'Properties' },
  { to: '/jabco', label: 'JABCO' },
  { to: '/inventory', label: 'Inventory' },
  { to: '/purchasing', label: 'Purchasing' },
  { to: '/crm', label: 'CRM' },
  { to: '/entertainment', label: 'Entertainment' },
  { to: '/dragonbridge', label: 'DragonBridge' },
  { to: '/nlcb', label: 'NLCB Booth' },
  { to: '/docvault', label: 'DocVault' },
  { to: '/lifestyle', label: 'Lifestyle' },
  { to: '/brian-admin', label: "Brian's Portal" },
]

export default function AppShell() {
  const { logout } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 overflow-hidden">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fixed overlay on mobile, static in flex flow on desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-56 bg-slate-800 flex flex-col transition-transform duration-200 md:static md:translate-x-0 md:z-auto md:flex-shrink-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
          <span className="text-sm font-semibold tracking-widest text-slate-400 uppercase">JAG Holdings</span>
          <button
            className="md:hidden text-slate-400 hover:text-white p-1"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `block px-5 py-2 text-sm rounded-r-md transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white font-medium'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-slate-700">
          <button
            onClick={logout}
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar with hamburger */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-slate-800 border-b border-slate-700 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-slate-400 hover:text-white"
            aria-label="Open navigation"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-semibold tracking-widest text-slate-400 uppercase">JAG Holdings</span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
