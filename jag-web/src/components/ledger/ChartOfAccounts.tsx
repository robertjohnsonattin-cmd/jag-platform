import { useQuery } from '@tanstack/react-query'
import { glApi } from '../../api/gl'
import { entityName } from '../../lib/entities'
import type { GlAccount, GlAccountType } from '../../types/gl'

const TYPE_ORDER: GlAccountType[] = ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','OTHER_INCOME','OTHER_EXPENSE']
const TYPE_LABELS: Record<GlAccountType, string> = {
  ASSET: 'Assets', LIABILITY: 'Liabilities', EQUITY: 'Equity',
  REVENUE: 'Revenue', EXPENSE: 'Expenses',
  OTHER_INCOME: 'Other Income', OTHER_EXPENSE: 'Other Expense',
}
const TYPE_COLORS: Record<GlAccountType, string> = {
  ASSET: 'text-blue-400', LIABILITY: 'text-red-400', EQUITY: 'text-purple-400',
  REVENUE: 'text-green-400', EXPENSE: 'text-orange-400',
  OTHER_INCOME: 'text-teal-400', OTHER_EXPENSE: 'text-yellow-400',
}

export default function ChartOfAccounts() {
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['gl', 'accounts'],
    queryFn: () => glApi.getAccounts({ is_active: 'true' }),
  })

  if (isLoading) return <Skeleton />
  if (accounts.length === 0) return <p className="text-slate-400 text-sm">No GL accounts. Add accounts to get started.</p>

  // Group by account_type, then sort within each group by account_code
  const grouped = TYPE_ORDER.reduce<Partial<Record<GlAccountType, GlAccount[]>>>((acc, type) => {
    const group = accounts.filter(a => a.account_type === type)
    if (group.length > 0) acc[type] = group
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {(Object.entries(grouped) as [GlAccountType, GlAccount[]][]).map(([type, rows]) => (
        <div key={type}>
          <h3 className={`text-xs font-bold uppercase tracking-widest mb-2 ${TYPE_COLORS[type]}`}>
            {TYPE_LABELS[type]}
          </h3>
          <div className="rounded-lg overflow-hidden border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-2 w-28">Code</th>
                  <th className="text-left px-4 py-2">Account Name</th>
                  <th className="text-left px-4 py-2">Entity</th>
                  <th className="text-left px-4 py-2">Normal</th>
                  <th className="text-left px-4 py-2">CCY</th>
                  <th className="text-center px-4 py-2">Direct Post</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {rows.map(a => (
                  <tr key={a.id} className={`hover:bg-slate-700/30 transition-colors ${a.parent_id ? 'pl-8' : ''}`}>
                    <td className="px-4 py-2.5 font-mono text-slate-400 text-xs">{a.account_code}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-100">
                      {a.parent_id && <span className="text-slate-600 mr-2">└</span>}
                      {a.account_name}
                      {a.description && (
                        <span className="ml-2 text-xs text-slate-500" title={a.description}>ⓘ</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{entityName(a.owner_entity_id)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-mono ${a.normal_balance === 'DEBIT' ? 'text-blue-400' : 'text-green-400'}`}>
                        {a.normal_balance}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{a.currency}</td>
                    <td className="px-4 py-2.5 text-center">
                      {a.allow_direct_posting
                        ? <span className="text-green-500 text-xs">✓</span>
                        : <span className="text-slate-600 text-xs">–</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-3">
      {[1,2,3,4].map(i => <div key={i} className="h-8 bg-slate-700/40 rounded animate-pulse" />)}
    </div>
  )
}
