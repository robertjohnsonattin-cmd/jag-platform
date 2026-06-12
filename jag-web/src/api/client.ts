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
