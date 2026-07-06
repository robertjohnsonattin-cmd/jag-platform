import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import AppShell from './layout/AppShell'
import Dashboard from './pages/Dashboard'
import Finance from './pages/Finance'
import Ledger from './pages/Ledger'
import Properties from './pages/Properties'
import Expenses from './pages/Expenses'
import Jabco from './pages/JABCO'
import Inventory from './pages/Inventory'
import Purchasing from './pages/Purchasing'
import CRM from './pages/CRM'
import Entertainment from './pages/Entertainment'
import DragonBridge from './pages/DragonBridge'
import NLCB from './pages/NLCB'
import DocVault from './pages/DocVault'
import Succession from './pages/Succession'
import Family from './pages/Family'
import Ownership from './pages/Ownership'
import BrianAdmin from './pages/BrianAdmin'
import BrianPortal from './pages/BrianPortal'
import Lifestyle from './pages/Lifestyle'
import Reports from './pages/Reports'
import Export from './pages/Export'
import HR from './pages/HR'
import PublicBooking from './pages/PublicBooking'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function AppRoutes() {
  const { roles } = useAuth()
  const isBrian = roles.includes('brian_portal')

  if (isBrian) {
    return (
      <BrowserRouter>
        <BrianPortal />
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="finance" element={<Finance />} />
          <Route path="ledger" element={<Ledger />} />
          <Route path="reports" element={<Reports />} />
          <Route path="export" element={<Export />} />
          <Route path="expenses" element={<Expenses />} />
          <Route path="properties" element={<Properties />} />
          <Route path="jabco" element={<Jabco />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="purchasing" element={<Purchasing />} />
          <Route path="crm" element={<CRM />} />
          <Route path="entertainment" element={<Entertainment />} />
          <Route path="dragonbridge" element={<DragonBridge />} />
          <Route path="nlcb" element={<NLCB />} />
          <Route path="docvault" element={<DocVault />} />
          <Route path="succession" element={<Succession />} />
          <Route path="family" element={<Family />} />
          <Route path="ownership" element={<Ownership />} />
          <Route path="lifestyle" element={<Lifestyle />} />
          <Route path="hr" element={<HR />} />
          <Route path="brian-admin" element={<BrianAdmin />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default function App() {
  // Public booking pages must never touch Keycloak (AuthProvider forces
  // onLoad: 'login-required', which redirects anonymous prospects to login
  // before anything can render). Checked before AuthProvider ever mounts.
  const isPublicBooking = window.location.pathname.startsWith('/book/')

  return (
    <QueryClientProvider client={queryClient}>
      {isPublicBooking ? (
        <BrowserRouter>
          <Routes>
            <Route path="/book/:slug" element={<PublicBooking />} />
          </Routes>
        </BrowserRouter>
      ) : (
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      )}
    </QueryClientProvider>
  )
}
