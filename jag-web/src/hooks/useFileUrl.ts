import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { filesApi, type KnownBucket } from '../api/files'

// Returns a blob URL for an authenticated MinIO file, cached for 10 minutes.
// Returns undefined while loading or if key/bucket are absent.
export function useFileUrl(bucket: KnownBucket | null | undefined, key: string | null | undefined) {
  const { token } = useAuth()

  return useQuery({
    queryKey: ['file-url', bucket, key],
    enabled: !!token && !!bucket && !!key,
    staleTime: 10 * 60 * 1000,
    queryFn: () => filesApi.download(token!, bucket!, key!),
  })
}
