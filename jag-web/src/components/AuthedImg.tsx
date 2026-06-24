import { useEffect, useState } from 'react'
import { api } from '../api/client'

interface AuthedImgProps {
  /** BASE-relative path (without the /api/v1 prefix), e.g. /ims/items/x/photos/y/download */
  path: string
  alt?: string
  className?: string
}

/**
 * Renders an image from an auth-gated streaming endpoint.
 *
 * A plain <img src="/api/v1/..."> can't send the Authorization header, and the
 * backend's requireAuth is header-only, so such requests 401 and the image never
 * loads. This component fetches the bytes via api.objectUrl() (Bearer token) and
 * renders the resulting blob object URL, revoking it on unmount / path change.
 */
export default function AuthedImg({ path, alt = '', className }: AuthedImgProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setSrc(null)
    setFailed(false)

    api.objectUrl(path)
      .then(url => {
        if (!active) { URL.revokeObjectURL(url); return }
        objectUrl = url
        setSrc(url)
      })
      .catch(() => { if (active) setFailed(true) })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-slate-800 text-slate-600 text-xl ${className ?? ''}`}>
        ⚠
      </div>
    )
  }

  if (!src) {
    return <div className={`animate-pulse bg-slate-700 ${className ?? ''}`} />
  }

  return <img src={src} alt={alt} className={className} />
}
