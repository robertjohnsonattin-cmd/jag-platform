import { useState } from 'react'

interface Props {
  label: string
  onConfirm: () => Promise<unknown>
  onClose: () => void
}

export default function ConfirmDeleteModal({ label, onConfirm, onClose }: Props) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blocking, setBlocking] = useState<Record<string, number> | null>(null)

  async function handleDelete() {
    setIsPending(true)
    setError(null)
    setBlocking(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      const err = e as Error & { blocking?: Record<string, number> }
      if (err.blocking && Object.keys(err.blocking).length > 0) {
        setBlocking(err.blocking)
      } else {
        setError(err.message ?? 'Delete failed.')
      }
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-base font-semibold mb-2 text-white">Delete Record</h2>
        <p className="text-sm text-slate-300 mb-4">
          Permanently delete <span className="font-medium text-white">{label}</span>?
          This cannot be undone.
        </p>

        {blocking && (
          <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-3 mb-4">
            <p className="text-amber-300 text-sm font-medium mb-2">
              Cannot delete — dependent records exist:
            </p>
            <ul className="space-y-1">
              {Object.entries(blocking).map(([k, v]) => (
                <li key={k} className="text-sm text-amber-200">
                  <span className="capitalize">{k.replace(/_/g, ' ')}</span>: {v} record{v !== 1 ? 's' : ''}
                </li>
              ))}
            </ul>
            <p className="text-xs text-amber-400 mt-2">Remove these records first, then try again.</p>
          </div>
        )}

        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
          >
            {blocking ? 'Close' : 'Cancel'}
          </button>
          {!blocking && (
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {isPending ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
