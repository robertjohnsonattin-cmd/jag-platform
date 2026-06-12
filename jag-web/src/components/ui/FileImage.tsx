import { useFileUrl } from '../../hooks/useFileUrl'
import type { KnownBucket } from '../../api/files'

interface Props {
  bucket: KnownBucket | null | undefined
  fileKey: string | null | undefined
  alt?: string
  className?: string
}

// Renders an <img> whose src is fetched via authenticated proxy, cached 10 min.
export default function FileImage({ bucket, fileKey, alt = '', className }: Props) {
  const { data: url, isLoading } = useFileUrl(bucket, fileKey)

  if (!bucket || !fileKey) return null
  if (isLoading) return <div className={`animate-pulse bg-slate-700 rounded ${className ?? 'w-full h-32'}`} />
  if (!url) return <div className={`bg-slate-800 rounded flex items-center justify-center text-xs text-slate-500 ${className ?? 'w-full h-32'}`}>No image</div>

  return <img src={url} alt={alt} className={className} />
}
