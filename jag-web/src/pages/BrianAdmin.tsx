import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { brianApi } from '../api/brian'
import type { AccessLevel, BrianModule } from '../api/brian'

const MODULE_LABELS: Record<BrianModule, string> = {
  PROPERTIES:    'Properties',
  JABCO:         'JABCO',
  IMS:           'Inventory',
  CRM:           'CRM',
  FAMILY:        'Family',
  LIFESTYLE:     'Lifestyle',
  DOCVAULT:      'DocVault',
  SUCCESSION:    'Succession',
  BAR:           'BAR',
  CLUB:          'Members Club',
  ENTERTAINMENT: 'Entertainment',
  DRAGONBRIDGE:  'DragonBridge',
  FINANCE:       'Finance',
  NLCB:          'NLCB',
}

const LEVEL_STYLES: Record<AccessLevel, string> = {
  NONE:  'bg-slate-700 text-slate-400',
  READ:  'bg-blue-900/60 text-blue-300',
  WRITE: 'bg-green-900/60 text-green-300',
}

export default function BrianAdmin() {
  const qc = useQueryClient()

  const { data: permissions = [], isLoading } = useQuery({
    queryKey: ['brian-permissions'],
    queryFn: brianApi.getPermissions,
  })

  const setLevel = useMutation({
    mutationFn: ({ module, level }: { module: BrianModule; level: AccessLevel }) =>
      brianApi.setPermission(module, { access_level: level }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brian-permissions'] }),
  })

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="px-6 py-4 border-b border-slate-700">
        <h1 className="text-xl font-semibold text-white">Brian's Portal — Access Control</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          Set module-level access for Brian's portal. Changes take effect within 60 seconds (cache TTL).
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading && (
          <p className="text-slate-400 text-sm">Loading permissions…</p>
        )}

        {!isLoading && (
          <div className="max-w-2xl space-y-2">
            {permissions.map(p => (
              <div
                key={p.module}
                className="bg-slate-800 border border-slate-700 rounded-lg px-5 py-4 flex items-center gap-4"
              >
                {/* Module name */}
                <div className="w-40 shrink-0">
                  <p className="text-white text-sm font-medium">{MODULE_LABELS[p.module]}</p>
                  {p.granted_at && (
                    <p className="text-slate-500 text-xs mt-0.5">Updated {fmtDate(p.updated_at ?? p.granted_at)}</p>
                  )}
                </div>

                {/* Current level badge */}
                <span className={`px-3 py-1 rounded-full text-xs font-semibold w-16 text-center ${LEVEL_STYLES[p.access_level]}`}>
                  {p.access_level}
                </span>

                {/* Level buttons */}
                <div className="flex gap-1 ml-auto">
                  {(['NONE', 'READ', 'WRITE'] as AccessLevel[]).map(level => (
                    <button
                      key={level}
                      onClick={() => setLevel.mutate({ module: p.module, level })}
                      disabled={setLevel.isPending || p.access_level === level}
                      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                        p.access_level === level
                          ? `${LEVEL_STYLES[level]} opacity-60`
                          : 'bg-slate-700 text-slate-300 hover:text-white hover:bg-slate-600'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {permissions.length === 0 && (
              <p className="text-slate-500 text-sm text-center py-12">
                No permissions configured. Brian's account may not be provisioned yet.
              </p>
            )}
          </div>
        )}

        {/* Notes */}
        <div className="max-w-2xl mt-8 p-4 bg-slate-800/50 border border-slate-700 rounded-lg text-sm text-slate-400 space-y-1">
          <p><span className="text-slate-300 font-medium">NONE</span> — module is hidden and all requests are blocked</p>
          <p><span className="text-slate-300 font-medium">READ</span> — Brian can view data; all write operations are blocked</p>
          <p><span className="text-slate-300 font-medium">WRITE</span> — full create, read, update access within the module</p>
          <p className="pt-1 text-slate-500">Changes are cached for up to 60 seconds before taking effect.</p>
        </div>
      </div>
    </div>
  )
}
