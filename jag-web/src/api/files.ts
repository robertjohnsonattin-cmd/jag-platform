const API = import.meta.env.VITE_API_URL as string

export type KnownBucket = 'jag-bank-statements' | 'jag-receipts' | 'jag-documents' | 'jag-photos'

interface UploadResult {
  key: string
  bucket: KnownBucket
  original_name: string
  size: number
  content_type: string
}

async function authedFetch(token: string, input: RequestInfo, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res
}

export const filesApi = {
  async upload(
    token: string,
    file: File,
    bucket: KnownBucket,
    module: string,
    entityId: string,
  ): Promise<UploadResult> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('bucket', bucket)
    fd.append('module', module)
    fd.append('entity_id', entityId)
    const res = await authedFetch(token, `${API}/api/v1/files/upload`, { method: 'POST', body: fd })
    const body = await res.json()
    return (body as { data: UploadResult }).data
  },

  async download(token: string, bucket: KnownBucket, key: string): Promise<string> {
    const url = `${API}/api/v1/files/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`
    const res = await authedFetch(token, url)
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  },

  async remove(token: string, bucket: KnownBucket, key: string): Promise<void> {
    await authedFetch(token, `${API}/api/v1/files`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket, key }),
    })
  },
}
