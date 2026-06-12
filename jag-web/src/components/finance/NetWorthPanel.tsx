import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '../../api/finance'
import { entityName, fmtTTD, fmtDate } from '../../lib/entities'

const CONSOLIDATED_ID = '00000000-0000-0000-0000-000000000000'

export default function NetWorthPanel() {
  const qc = useQueryClient()

  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ['finance', 'net-worth'],
    queryFn: financeApi.getNetWorth,
  })

  const { mutate: takeSnapshot, isPending } = useMutation({
    mutationFn: financeApi.triggerSnapshot,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'net-worth'] })
    },
  })

  if (isLoading) return <p className="text-slate-400 text-sm">Loading…</p>

  const consolidated = snapshots.find((s) => s.owner_entity_id === CONSOLIDATED_ID)
  const entities = snapshots
    .filter((s) => s.owner_entity_id !== CONSOLIDATED_ID)
    .sort((a, b) => entityName(a.owner_entity_id).localeCompare(entityName(b.owner_entity_id)))

  return (
    <div>
      {/* Consolidated summary cards */}
      {consolidated && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <SummaryCard label="Net Worth" value={fmtTTD(consolidated.net_worth_ttd)} color="blue" />
          <SummaryCard label="Total Assets" value={fmtTTD(consolidated.total_assets_ttd)} color="green" />
          <SummaryCard label="Total Liabilities" value={fmtTTD(consolidated.total_liabilities_ttd)} color="red" />
        </div>
      )}

      {/* Per-entity breakdown */}
      {entities.length > 0 && (
        <div className="rounded-lg overflow-hidden border border-slate-700 mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2">Entity</th>
                <th className="text-right px-4 py-2">Assets</th>
                <th className="text-right px-4 py-2">Liabilities</th>
                <th className="text-right px-4 py-2">Net Worth</th>
                <th className="text-right px-4 py-2">Liquid</th>
                <th className="text-right px-4 py-2">Investments</th>
                <th className="text-right px-4 py-2">Snapshot Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {entities.map((s) => {
                const nw = parseFloat(s.net_worth_ttd)
                return (
                  <tr key={s.id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-100">
                      {entityName(s.owner_entity_id)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">
                      {fmtTTD(s.total_assets_ttd)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-red-400">
                      {fmtTTD(s.total_liabilities_ttd)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${nw >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {fmtTTD(s.net_worth_ttd)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-400">
                      {fmtTTD(s.liquid_assets_ttd)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-400">
                      {fmtTTD(s.investment_assets_ttd)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 text-xs">
                      {fmtDate(s.snapshot_date)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {snapshots.length === 0 && (
        <p className="text-slate-400 text-sm mb-4">No snapshots yet. Take one to see your net worth.</p>
      )}

      <button
        onClick={() => takeSnapshot()}
        disabled={isPending}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
      >
        {isPending ? 'Computing…' : 'Take Snapshot Now'}
      </button>
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: 'blue' | 'green' | 'red' }) {
  const border = { blue: 'border-blue-500', green: 'border-green-500', red: 'border-red-500' }[color]
  return (
    <div className={`bg-slate-800 rounded-lg p-4 border-l-4 ${border}`}>
      <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-lg font-semibold font-mono">{value}</p>
    </div>
  )
}
