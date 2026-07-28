import { useTranslation } from 'react-i18next'

/**
 * Loading / error / empty state for a per-tenant record section.
 *
 * Every tenant section used to render `useQuery`'s `data = []` fallback with a
 * flat "No X on file for this tenant." That message was shown for three very
 * different situations — still loading, request failed, and genuinely nothing
 * recorded — which is how a broken leases endpoint went unnoticed: it 422'd on
 * every call and the UI reported it as "no leases".
 *
 * A failed request now says so and shows the error. An empty section says why
 * it is empty and what would fill it.
 */
export default function TenantSectionState({
  isLoading,
  error,
  isEmpty,
  reason,
  actionLabel,
  onAction,
}: {
  isLoading: boolean
  error: unknown
  isEmpty: boolean
  /** Why this section is empty, and what fills it. Plain language, tenant's-eye view. */
  reason: string
  actionLabel?: string
  onAction?: () => void
}) {
  const { t } = useTranslation()

  if (isLoading) {
    return <p className="text-slate-400 text-sm py-6 text-center">{t('common.loading')}</p>
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-5 text-center">
        <p className="text-sm text-red-300">
          {t('tenants.section.loadFailed', "Couldn't load this section.")}
        </p>
        <p className="text-xs text-red-400/80 mt-1.5 font-mono break-words">
          {error instanceof Error ? error.message : String(error)}
        </p>
        <p className="text-xs text-slate-500 mt-2">
          {t('tenants.section.loadFailedHint', 'This is a fault, not an empty record — nothing has been lost.')}
        </p>
      </div>
    )
  }

  if (isEmpty) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 px-4 py-6 text-center">
        <p className="text-sm text-slate-400">{reason}</p>
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="mt-2.5 text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            {actionLabel}
          </button>
        )}
      </div>
    )
  }

  return null
}
