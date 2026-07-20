import { useEffect } from 'react'
import AuthedImg from './AuthedImg'

interface PhotoLightboxProps {
  /** Auth-gated download paths, in display order. */
  paths: string[]
  index: number
  onClose: () => void
  onIndexChange: (i: number) => void
}

/**
 * Full-screen viewer for a photo grid. Reuses AuthedImg since photo downloads
 * are auth-gated (see AuthedImg.tsx) -- a plain <img src> / lightbox library
 * pointed at the raw API path would just 401.
 */
export default function PhotoLightbox({ paths, index, onClose, onIndexChange }: PhotoLightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && index < paths.length - 1) onIndexChange(index + 1)
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, paths.length, onClose, onIndexChange])

  return (
    <div
      className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100]"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl flex items-center justify-center"
      >&times;</button>

      {paths.length > 1 && index > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onIndexChange(index - 1) }}
          className="absolute left-2 sm:left-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl flex items-center justify-center"
        >&#8249;</button>
      )}

      <div className="max-w-[90vw] max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <AuthedImg path={paths[index]} alt="" className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg" />
      </div>

      {paths.length > 1 && index < paths.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onIndexChange(index + 1) }}
          className="absolute right-2 sm:right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl flex items-center justify-center"
        >&#8250;</button>
      )}

      {paths.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-xs">
          {index + 1} / {paths.length}
        </div>
      )}
    </div>
  )
}
