import { getValidAccessToken } from '../auth/keycloak'
import { JAG_API_BASE } from '../constants/config'

// ── Error types ───────────────────────────────────────────────────────────────

export class AuthError extends Error {
  readonly type = 'AuthError' as const
}

export class ApiError extends Error {
  readonly type = 'ApiError' as const
  constructor(message: string, readonly code?: string) {
    super(message)
  }
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────

async function request<T>(
  path: string,
  init: RequestInit = {},
  skipContentType = false,
): Promise<T> {
  const token = await getValidAccessToken()
  if (!token) throw new AuthError('Not authenticated')

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(skipContentType ? {} : { 'Content-Type': 'application/json' }),
    ...(init.headers as Record<string, string> | undefined ?? {}),
  }

  const res = await fetch(`${JAG_API_BASE}${path}`, { ...init, headers })

  const body = (await res.json()) as {
    success: boolean
    data: T
    error?: string
    code?: string
  }

  if (!res.ok || !body.success) {
    if (res.status === 401) throw new AuthError('Session expired')
    throw new ApiError(body.error ?? `HTTP ${res.status}`, body.code)
  }

  return body.data
}

// ── API surface — mirrors jag-web/src/api/client.ts ──────────────────────────

export const api = {
  get:      <T>(path: string)                 => request<T>(path),
  post:     <T>(path: string, data: unknown)  => request<T>(path, { method: 'POST',  body: JSON.stringify(data) }),
  patch:    <T>(path: string, data: unknown)  => request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  delete:   <T>(path: string)                 => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST',  body: form }, true),
}
