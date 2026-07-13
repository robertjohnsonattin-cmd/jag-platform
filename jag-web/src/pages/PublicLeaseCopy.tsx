import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

const API_BASE = '/api/v1/public/lease-copy'

interface LeaseCopyData {
  tenantName: string
  propertyName: string
  unitNumber: string | null
  downloadUrl: string
}

export default function PublicLeaseCopy() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<LeaseCopyData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { document.title = 'JAG Properties — Your Signed Lease' }, [])

  useEffect(() => {
    if (!token) return
    fetch(`${API_BASE}/${token}`)
      .then(async res => {
        const body = await res.json() as { success: boolean; data: LeaseCopyData; error?: string }
        if (!res.ok || !body.success) throw new Error(body.error ?? 'This link is invalid or has expired.')
        setData(body.data)
      })
      .catch(e => setLoadError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl p-6 text-center">
        <img src="/jag-logo.png" alt="JAG Properties" className="w-14 h-14 mx-auto mb-4 rounded-lg" />
        {loading && <p className="text-slate-400">Loading…</p>}
        {!loading && loadError && (
          <p className="text-rose-400">{loadError}</p>
        )}
        {!loading && data && (
          <>
            <h1 className="text-lg font-semibold mb-1">Your Lease Is Signed</h1>
            <p className="text-sm text-slate-400 mb-4">
              Hi {data.tenantName}, here is your fully-signed tenancy agreement for{' '}
              {data.propertyName}{data.unitNumber ? ` — Unit ${data.unitNumber}` : ''}.
            </p>
            <a
              href={data.downloadUrl}
              className="inline-block w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg px-4 py-3"
            >
              ⬇ Download Signed Lease
            </a>
            <p className="text-xs text-slate-500 mt-4">
              Keep this copy for your records. Managed on behalf of the Landlord, Robert Johnson-Attin.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
