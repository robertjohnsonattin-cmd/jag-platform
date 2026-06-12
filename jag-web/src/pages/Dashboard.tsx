import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { financeApi } from '../api/finance'
import { propertiesApi } from '../api/properties'
import { imsApi } from '../api/ims'
import { jabcoApi } from '../api/jabco'
import { expensesApi } from '../api/expenses'
import { fmtTTD, fmtDate, entityName } from '../lib/entities'
import type { FinTransaction, Investment } from '../types/finance'
import type { Expense } from '../types/expenses'

const CONSOLIDATED = '00000000-0000-0000-0000-000000000000'

const CATEGORY_LABELS: Record<string, string> = {
  SALARY: 'Salary', DIVIDEND: 'Dividend', RENTAL_INCOME: 'Rental Income',
  INTEREST_INCOME: 'Interest', TRANSFER_IN: 'Transfer In',
  OPERATING_EXPENSE: 'Operating', PAYROLL: 'Payroll', TAX_PAYMENT: 'Tax',
  LOAN_REPAYMENT: 'Loan Repayment', INVESTMENT_PURCHASE: 'Investment',
  INVESTMENT_SALE: 'Inv. Sale', TRANSFER_OUT: 'Transfer Out',
  PERSONAL_EXPENSE: 'Personal', UTILITIES: 'Utilities', INSURANCE: 'Insurance',
  ENTERTAINMENT: 'Entertainment', TRAVEL: 'Travel', MEDICAL: 'Medical',
  EDUCATION: 'Education', CHARITY: 'Charity', UNCLASSIFIED: 'Unclassified',
}

export default function Dashboard() {
  const navigate = useNavigate()

  const { data: snapshots = [] } = useQuery({
    queryKey: ['finance', 'net-worth'],
    queryFn: financeApi.getNetWorth,
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['finance', 'accounts'],
    queryFn: () => financeApi.getAccounts({ is_active: 'true' }),
  })

  const { data: recentTxns = [] } = useQuery({
    queryKey: ['finance', 'transactions', 'recent'],
    queryFn: () => financeApi.getTransactions({ limit: 10 }),
  })

  // ── Operational KPIs ────────────────────────────────────────────────────────
  const { data: arrears = [] } = useQuery({
    queryKey: ['properties', 'arrears'],
    queryFn: propertiesApi.getArrears,
  })

  const { data: leaseExpiry = [] } = useQuery({
    queryKey: ['properties', 'lease-expiry'],
    queryFn: propertiesApi.getLeaseExpiry,
  })

  const { data: imsValuation } = useQuery({
    queryKey: ['ims', 'valuation'],
    queryFn: imsApi.getValuation,
  })

  const { data: properties = [] } = useQuery({
    queryKey: ['properties', 'all'],
    queryFn: () => propertiesApi.getProperties({ limit: 100 }),
    staleTime: 60_000,
  })

  const { data: investments = [] as Investment[] } = useQuery({
    queryKey: ['finance', 'investments'],
    queryFn: () => financeApi.getInvestments(),
    staleTime: 60_000,
  })

  const { data: jabcoProjects } = useQuery({
    queryKey: ['jabco', 'projects', 'active'],
    queryFn: () => jabcoApi.getProjects({ status: 'ACTIVE', limit: 1 }),
  })

  const { data: pendingExpenses = [] } = useQuery({
    queryKey: ['expenses', 'pending'],
    queryFn: () => expensesApi.getExpenses({ status: 'SUBMITTED', limit: 10 }),
  })

  const { data: recentApprovedExpenses = [] } = useQuery({
    queryKey: ['expenses', 'approved-recent'],
    queryFn: () => expensesApi.getExpenses({ status: 'APPROVED', limit: 5 }),
  })

  const consolidated = snapshots.find(s => s.owner_entity_id === CONSOLIDATED)
  const entitySnapshots = snapshots
    .filter(s => s.owner_entity_id !== CONSOLIDATED)
    .sort((a, b) => parseFloat(b.net_worth_ttd) - parseFloat(a.net_worth_ttd))

  // Total liquid balance across all accounts
  const totalLiquid = accounts.reduce((s, a) => s + parseFloat(a.current_balance), 0)

  // Accounts grouped by entity for the balance strip
  const accountsByEntity = accounts.reduce<Record<string, number>>((acc, a) => {
    acc[a.owner_entity_id] = (acc[a.owner_entity_id] ?? 0) + parseFloat(a.current_balance)
    return acc
  }, {})

  const today = new Date().toLocaleDateString('en-TT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  // Asset composition — live values
  const totalPropertyValue = properties.reduce((s, p) => s + parseFloat(p.current_valuation ?? '0'), 0)
  const totalImsAssets     = parseFloat(String(imsValuation?.summary.total_asset_value ?? 0))
  const totalImsStock      = parseFloat(String(imsValuation?.summary.total_stock_value ?? 0))
  const totalImsValue      = totalImsAssets + totalImsStock
  const totalInvestments   = investments.reduce((s, i) => s + parseFloat(i.current_value_ttd), 0)
  const liveTotalAssets    = totalLiquid + totalPropertyValue + totalImsValue + totalInvestments

  // Operational KPI derived values
  const arrearsCount    = arrears.length
  const arrearsTotal    = arrears.reduce((s, r) => s + parseFloat(r.balance_owed), 0)
  const expiringLeases  = leaseExpiry.filter(l => l.days_remaining <= 90).length
  const lowStockCount   = (imsValuation?.summary.low_stock_count ?? 0) + (imsValuation?.summary.out_of_stock_count ?? 0)
  const activeProjects  = jabcoProjects?.pagination?.total ?? 0
  const pendingExpCount = pendingExpenses.length

  return (
    <div>
      {/* Header */}
      <div className="flex items-baseline justify-between mb-8">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-slate-500">{today}</p>
      </div>

      {/* Operational KPI strip */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <OpsCard
          label="Rent Arrears"
          value={arrearsCount}
          sub={arrearsCount > 0 ? fmtTTD(arrearsTotal) + ' owed' : 'All clear'}
          status={arrearsCount > 0 ? 'warn' : 'ok'}
          onClick={() => navigate('/properties')}
        />
        <OpsCard
          label="Leases Expiring"
          value={expiringLeases}
          sub={expiringLeases > 0 ? 'within 90 days' : 'No expiries soon'}
          status={expiringLeases > 0 ? 'warn' : 'ok'}
          onClick={() => navigate('/properties')}
        />
        <OpsCard
          label="Low / Out of Stock"
          value={lowStockCount}
          sub={lowStockCount > 0 ? 'items need attention' : 'Stock healthy'}
          status={lowStockCount > 0 ? 'warn' : 'ok'}
          onClick={() => navigate('/inventory')}
        />
        <OpsCard
          label="Active Projects"
          value={activeProjects}
          sub="JABCO"
          status="neutral"
          onClick={() => navigate('/jabco')}
        />
        <OpsCard
          label="Expenses Pending"
          value={pendingExpCount}
          sub={pendingExpCount > 0 ? 'awaiting approval' : 'Nothing pending'}
          status={pendingExpCount > 0 ? 'warn' : 'ok'}
          onClick={() => navigate('/expenses')}
        />
      </div>

      {/* Net worth headline */}
      {consolidated ? (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard
            label="Consolidated Net Worth"
            value={fmtTTD(consolidated.net_worth_ttd)}
            sub={`as of ${fmtDate(consolidated.snapshot_date)}`}
            accent="blue"
            onClick={() => navigate('/finance')}
          />
          <StatCard
            label="Total Assets (live)"
            value={fmtTTD(liveTotalAssets)}
            sub={`Cash ${fmtTTD(totalLiquid)} · Props ${fmtTTD(totalPropertyValue)} · Inv ${fmtTTD(totalInvestments)}`}
            accent="green"
            onClick={() => navigate('/finance')}
          />
          <StatCard
            label="Total Liabilities"
            value={fmtTTD(consolidated.total_liabilities_ttd)}
            sub=" "
            accent="red"
            onClick={() => navigate('/finance')}
          />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[0,1,2].map(i => <div key={i} className="h-24 bg-slate-800 rounded-lg animate-pulse" />)}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Left column — entity net worth + account balances */}
        <div className="col-span-2 space-y-6">

          {/* Asset composition — live breakdown */}
          <Section title="Asset Composition (Live)">
            <div className="divide-y divide-slate-700">
              <AssetRow
                label="Cash & Bank Accounts"
                value={totalLiquid}
                sub={`${accounts.length} account${accounts.length !== 1 ? 's' : ''}`}
                onClick={() => navigate('/finance')}
              />
              <AssetRow
                label="Property Portfolio"
                value={totalPropertyValue}
                sub={`${properties.length} propert${properties.length !== 1 ? 'ies' : 'y'}`}
                onClick={() => navigate('/properties')}
              />
              <AssetRow
                label="Investments"
                value={totalInvestments}
                sub={`${investments.length} holding${investments.length !== 1 ? 's' : ''}`}
                onClick={() => navigate('/finance')}
              />
              <AssetRow
                label="IMS — Fixed Assets & Stock"
                value={totalImsValue}
                sub={`Fixed ${fmtTTD(totalImsAssets)} · Stock ${fmtTTD(totalImsStock)}`}
                onClick={() => navigate('/inventory')}
              />
              <div className="flex justify-between items-center py-3">
                <span className="text-sm font-semibold text-slate-200">Total</span>
                <span className="text-sm font-semibold font-mono text-blue-300">{fmtTTD(liveTotalAssets)}</span>
              </div>
            </div>
          </Section>

          {/* Entity net worth breakdown */}
          {entitySnapshots.length > 0 && (
            <Section title="Net Worth by Entity">
              <div className="space-y-2">
                {entitySnapshots.map(s => {
                  const nw = parseFloat(s.net_worth_ttd)
                  const assets = parseFloat(consolidated?.total_assets_ttd ?? '1') || 1
                  const pct = Math.min(100, Math.abs(parseFloat(s.total_assets_ttd)) / assets * 100)
                  return (
                    <div key={s.id}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-300">{entityName(s.owner_entity_id)}</span>
                        <span className={`font-mono font-medium ${nw >= 0 ? 'text-slate-100' : 'text-red-400'}`}>
                          {fmtTTD(s.net_worth_ttd)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${nw >= 0 ? 'bg-blue-500' : 'bg-red-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {/* Account balances by entity */}
          {Object.keys(accountsByEntity).length > 0 && (
            <Section title="Bank Balances by Entity">
              <div className="divide-y divide-slate-700">
                {Object.entries(accountsByEntity)
                  .sort(([,a],[,b]) => b - a)
                  .map(([entityId, balance]) => (
                    <div key={entityId} className="flex justify-between items-center py-2.5">
                      <span className="text-sm text-slate-300">{entityName(entityId)}</span>
                      <span className={`text-sm font-mono font-medium ${balance < 0 ? 'text-red-400' : 'text-slate-100'}`}>
                        {fmtTTD(balance)}
                      </span>
                    </div>
                  ))}
                <div className="flex justify-between items-center py-2.5">
                  <span className="text-sm text-slate-400 font-semibold">Total</span>
                  <span className={`text-sm font-mono font-semibold ${totalLiquid < 0 ? 'text-red-400' : 'text-blue-300'}`}>
                    {fmtTTD(totalLiquid)}
                  </span>
                </div>
              </div>
            </Section>
          )}
        </div>

        {/* Right column — recent transactions + approved expenses */}
        <div className="space-y-6">
          <Section title="Recent Transactions">
            {recentTxns.length === 0 ? (
              <p className="text-slate-500 text-sm">No transactions yet.</p>
            ) : (
              <div className="space-y-0 divide-y divide-slate-700">
                {recentTxns.map(t => <TxnRow key={t.id} txn={t} />)}
              </div>
            )}
          </Section>

          <Section title="Recently Approved Expenses">
            {recentApprovedExpenses.length === 0 ? (
              <p className="text-slate-500 text-sm">No approved expenses yet.</p>
            ) : (
              <div className="space-y-0 divide-y divide-slate-700">
                {recentApprovedExpenses.map(e => <ExpenseRow key={e.id} expense={e} />)}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}

function TxnRow({ txn }: { txn: FinTransaction }) {
  const amt = parseFloat(txn.amount)
  const isCredit = amt > 0
  return (
    <div className="py-2.5">
      <div className="flex justify-between items-start">
        <div className="flex-1 min-w-0 mr-2">
          <p className="text-xs text-slate-100 truncate">{txn.merchant_name ?? txn.description}</p>
          <p className="text-xs text-slate-500 mt-0.5">{fmtDate(txn.transaction_date)}</p>
        </div>
        <span className={`text-xs font-mono font-medium whitespace-nowrap ${isCredit ? 'text-green-400' : 'text-red-400'}`}>
          {isCredit ? '+' : ''}{fmtTTD(txn.amount_ttd ?? txn.amount)}
        </span>
      </div>
      <span className="inline-block mt-1 text-xs text-slate-500 bg-slate-700/50 rounded px-1.5 py-0.5">
        {CATEGORY_LABELS[txn.category] ?? txn.category}
      </span>
    </div>
  )
}

function StatCard({ label, value, sub, accent, onClick }: {
  label: string; value: string; sub: string; accent: 'blue' | 'green' | 'red'; onClick?: () => void
}) {
  const border = { blue: 'border-blue-500', green: 'border-green-500', red: 'border-red-500' }[accent]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`text-left bg-slate-800 rounded-lg p-5 border-l-4 ${border} ${onClick ? 'hover:bg-slate-750 cursor-pointer transition-colors w-full' : ''}`}
    >
      <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-semibold font-mono">{value}</p>
      <p className="text-xs text-slate-500 mt-1">{sub}</p>
    </Tag>
  )
}

function AssetRow({ label, value, sub, onClick }: {
  label: string; value: number; sub: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex justify-between items-center py-3 w-full text-left hover:bg-slate-700/40 rounded px-1 -mx-1 transition-colors group"
    >
      <div>
        <p className="text-sm text-slate-200 group-hover:text-white">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
      </div>
      <span className="text-sm font-mono font-medium text-slate-100 whitespace-nowrap ml-4">
        {fmtTTD(value)}
      </span>
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">{title}</h2>
      {children}
    </div>
  )
}

function ExpenseRow({ expense }: { expense: Expense }) {
  const amt = parseFloat(expense.amount_ttd)
  return (
    <div className="py-2.5">
      <div className="flex justify-between items-start">
        <div className="flex-1 min-w-0 mr-2">
          <p className="text-xs text-slate-100 truncate">{expense.payee_name ?? expense.description}</p>
          <p className="text-xs text-slate-500 mt-0.5">{fmtDate(expense.expense_date)}</p>
        </div>
        <span className="text-xs font-mono font-medium whitespace-nowrap text-red-400">
          -{fmtTTD(amt)}
        </span>
      </div>
      <span className="inline-block mt-1 text-xs text-slate-500 bg-slate-700/50 rounded px-1.5 py-0.5">
        {expense.category}
      </span>
    </div>
  )
}

function OpsCard({ label, value, sub, status, onClick }: {
  label: string
  value: number
  sub: string
  status: 'ok' | 'warn' | 'neutral'
  onClick: () => void
}) {
  const border = status === 'warn' ? 'border-amber-500' : status === 'ok' ? 'border-green-600' : 'border-slate-600'
  const numColor = status === 'warn' && value > 0 ? 'text-amber-400' : status === 'ok' ? 'text-green-400' : 'text-slate-200'
  return (
    <button
      onClick={onClick}
      className={`text-left bg-slate-800 rounded-lg p-4 border-l-4 ${border} hover:bg-slate-750 transition-colors w-full`}
    >
      <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-semibold font-mono ${numColor}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-1 truncate">{sub}</p>
    </button>
  )
}
