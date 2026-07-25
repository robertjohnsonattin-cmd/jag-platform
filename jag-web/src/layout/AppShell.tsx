import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import i18n from '../i18n'
import NotificationBell from '../components/NotificationBell'

const NAV = [
  { to: '/dashboard',     key: 'nav.dashboard' },
  { to: '/finance',       key: 'nav.finance' },
  { to: '/ledger',        key: 'nav.ledger' },
  { to: '/reports',       key: 'nav.reports' },
  { to: '/export',        key: 'nav.export' },
  { to: '/expenses',      key: 'nav.expenses' },
  { to: '/properties',    key: 'nav.properties' },
  { to: '/jabco',         key: 'nav.jabco' },
  { to: '/inventory',     key: 'nav.inventory' },
  { to: '/purchasing',    key: 'nav.purchasing' },
  { to: '/crm',           key: 'nav.crm' },
  { to: '/entertainment', key: 'nav.entertainment' },
  { to: '/dragonbridge',  key: 'nav.dragonbridge' },
  { to: '/nlcb',          key: 'nav.nlcb' },
  { to: '/docvault',      key: 'nav.docvault' },
  { to: '/succession',    key: 'nav.succession' },
  { to: '/family',        key: 'nav.family' },
  { to: '/ownership',     key: 'nav.ownership' },
  { to: '/lifestyle',     key: 'nav.lifestyle' },
  { to: '/fitness',       key: 'nav.fitness' },
  { to: '/hr',            key: 'nav.hr' },
  { to: '/brian-admin',   key: 'nav.brianPortal' },
]

function LangToggle() {
  const { t } = useTranslation()
  const current = i18n.language
  const next = current === 'en' ? 'zh-CN' : 'en'
  const label = current === 'en' ? '中文' : 'EN'
  return (
    <button
      onClick={() => i18n.changeLanguage(next)}
      className="text-xs text-slate-400 hover:text-white transition-colors"
      title={t('common.language')}
    >
      {label}
    </button>
  )
}

export default function AppShell() {
  const { logout } = useAuth()
  const { t } = useTranslation()
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
          <span className="flex items-center gap-2 min-w-0">
            <img src="/jag-logo.png" alt="JAG" className="w-6 h-6 rounded shrink-0" />
            <span className="text-sm font-semibold tracking-widest text-slate-400 uppercase truncate">
              {t('nav.jagHoldings')}
            </span>
          </span>
          <div className="flex items-center gap-2">
            {/* Desktop notification bell — mobile uses the top bar instance */}
            <div className="hidden md:block">
              <NotificationBell align="left" />
            </div>
            <button
              className="md:hidden text-slate-400 hover:text-white p-1"
              onClick={() => setSidebarOpen(false)}
              aria-label={t('nav.closeNav')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <nav className="flex-1 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, key }) => (
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
              {t(key)}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-slate-700 flex items-center justify-between">
          <button
            onClick={logout}
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            {t('common.signOut')}
          </button>
          <LangToggle />
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar with hamburger */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-slate-800 border-b border-slate-700 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-slate-400 hover:text-white"
            aria-label={t('nav.openNav')}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="flex items-center gap-2 flex-1 min-w-0">
            <img src="/jag-logo.png" alt="JAG" className="w-6 h-6 rounded shrink-0" />
            <span className="text-sm font-semibold tracking-widest text-slate-400 uppercase truncate">
              {t('nav.jagHoldings')}
            </span>
          </span>
          <NotificationBell />
          <LangToggle />
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
