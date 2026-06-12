import { useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { filesApi, type KnownBucket } from '../../api/files'

interface Props {
  bucket: KnownBucket
  module: string
  entityId: string
  accept?: string
  label?: string
  onUploaded: (key: string, bucket: KnownBucket, originalName: string) => void
}

export default function FileUpload({ bucket, module, entityId, accept, label = 'Upload file', onUploaded }: Props) {
  const { token } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !token) return
    setError(null)
    setUploading(true)
    try {
      const result = await filesApi.upload(token, file, bucket, module, entityId)
      onUploaded(result.key, result.bucket as KnownBucket, result.original_name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm rounded-lg border border-slate-600 transition-colors"
      >
        {uploading ? 'Uploading…' : label}
      </button>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}
