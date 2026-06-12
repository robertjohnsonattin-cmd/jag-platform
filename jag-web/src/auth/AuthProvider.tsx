import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import keycloak from '../keycloak'

interface AuthContextValue {
  token: string | undefined
  userId: string | undefined
  tenantId: string | undefined
  roles: string[]
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [token, setToken] = useState<string | undefined>()
  const [userId, setUserId] = useState<string | undefined>()
  const [tenantId, setTenantId] = useState<string | undefined>()
  const [roles, setRoles] = useState<string[]>([])

  useEffect(() => {
    keycloak
      .init({ onLoad: 'login-required', checkLoginIframe: false })
      .then((authenticated) => {
        if (authenticated) {
          const parsed = keycloak.tokenParsed as Record<string, unknown>
          setToken(keycloak.token)
          setUserId(parsed['jag_user_id'] as string | undefined)
          setTenantId(parsed['jag_tenant_id'] as string | undefined)
          setRoles((parsed['realm_access'] as { roles: string[] } | undefined)?.roles ?? [])
        }
        setReady(true)
      })
      .catch(() => setReady(true))

    // Refresh token 60s before expiry
    const interval = setInterval(() => {
      keycloak.updateToken(60).then((refreshed) => {
        if (refreshed) setToken(keycloak.token)
      })
    }, 30_000)

    return () => clearInterval(interval)
  }, [])

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900 text-white">
        Authenticating…
      </div>
    )
  }

  return (
    <AuthContext.Provider
      value={{ token, userId, tenantId, roles, logout: () => keycloak.logout() }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
