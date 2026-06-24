import keycloak from '../keycloak'

const BASE = '/api/v1'

async function request<T>(path: string, init: RequestInit = {}, skipContentType = false): Promise<T> {
  await keycloak.updateToken(30).catch(() => {
    // Token refresh failed — let the request proceed with whatever token remains.
    // AuthProvider's 30s interval will eventually redirect to login if fully expired.
  })

  const baseHeaders: Record<string, string> = { Authorization: `Bearer ${keycloak.token}` }
  if (!skipContentType) baseHeaders['Content-Type'] = 'application/json'

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...baseHeaders, ...(init.headers ?? {}) },
  })

  const body = await res.json() as { success: boolean; data: T; error?: string; code?: string; blocking?: Record<string, number> }

  if (!res.ok || !body.success) {
    const err = new Error(body.error ?? `HTTP ${res.status}`)
    ;(err as Error & { code?: string; blocking?: Record<string, number> }).code = body.code
    ;(err as Error & { code?: string; blocking?: Record<string, number> }).blocking = body.blocking
    throw err
  }

  return body.data
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  deleteBody: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'DELETE', body: JSON.stringify(data) }),
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: 'POST', body: form }, true),

  download: async (path: string, fileName: string): Promise<void> => {
    await keycloak.updateToken(30).catch(() => {})
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${keycloak.token ?? ''}` } })
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },

  // Authenticated fetch of a binary resource → blob object URL, for use as an
  // <img src> / <a href>. A browser-native fetch (img/anchor) can't carry the
  // Authorization header, and requireAuth is header-only — so streaming endpoints
  // must be loaded this way. Caller is responsible for URL.revokeObjectURL().
  objectUrl: async (path: string): Promise<string> => {
    await keycloak.updateToken(30).catch(() => {})
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${keycloak.token ?? ''}` } })
    if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`)
    return URL.createObjectURL(await res.blob())
  },
}

export function tenantApi(tenantId: string) {
  const h = { 'X-Tenant-Id': tenantId }
  return {
    get: <T>(path: string) => request<T>(path, { headers: h }),
    post: <T>(path: string, data: unknown) =>
      request<T>(path, { method: 'POST', body: JSON.stringify(data), headers: h }),
    patch: <T>(path: string, data: unknown) =>
      request<T>(path, { method: 'PATCH', body: JSON.stringify(data), headers: h }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE', headers: h }),
    deleteBody: <T>(path: string, data: unknown) =>
      request<T>(path, { method: 'DELETE', body: JSON.stringify(data), headers: h }),
    postForm: <T>(path: string, form: FormData) =>
      request<T>(path, { method: 'POST', body: form, headers: h }, true),
  }
}
