import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { financeApi } from '../api/finance'
import { fmtTTD, entityName } from '../lib/entities'
import type { ReportLineItem, BalanceSheetLineItem, CashFlowActivity } from '../types/finance'

const ENTITY_IDS = [
  '00000000-0000-0000-0001-000000000001',
  '00000000-0000-0000-0001-000000000002',
  '00000000-0000-0000-0001-000000000003',
  '00000000-0000-0000-0001-000000000004',
  '00000000-0000-0000-0001-000000000005',
  '00000000-0000-0000-0001-000000000006',
  '00000000-0000-0000-0001-000000000007',
]

const curYear  = new Date().getFullYear()
const yearStart = `${curYear}-01-01`
const today    = new Date().toISOString().slice(0, 10)

type Tab = 'income' | 'balance' | 'cashflow'

export default function Reports() {
  const { t } = useTranslation()
  const [tab,        setTab]        = useState<Tab>('income')
  const [entityId,   setEntityId]   = useState<string>('')
  const [dateFrom,   setDateFrom]   = useState(yearStart)
  const [dateTo,     setDateTo]     = useState(today)
  const [asOf,       setAsOf]       = useState(today)

  const entityParam = entityId || undefined

  const { data: income, isFetching: fetchingIncome } = useQuery({
    queryKey: ['reports', 'income-statement', entityParam, dateFrom, dateTo],
    queryFn: () => financeApi.getIncomeStatement({ date_from: dateFrom, date_to: dateTo, owner_entity_id: entityParam }),
    enabled: tab === 'income',
  })

  const { data: balance, isFetching: fetchingBalance } = useQuery({
    queryKey: ['reports', 'balance-sheet', entityParam, asOf],
    queryFn: () => financeApi.getBalanceSheet({ as_of_date: asOf, owner_entity_id: entityParam }),
    enabled: tab === 'balance',
  })

  const { data: cashflow, isFetching: fetchingCashflow } = useQuery({
    queryKey: ['reports', 'cash-flow', entityParam, dateFrom, dateTo],
    queryFn: () => financeApi.getCashFlow({ date_from: dateFrom, date_to: dateTo, owner_entity_id: entityParam }),
    enabled: tab === 'cashflow',
  })

  const loading = fetchingIncome || fetchingBalance || fetchingCashflow

  const tabs: [Tab, string][] = [
    ['income',   t('reports.incomeStatement')],
    ['balance',  t('reports.balanceSheet')],
    ['cashflow', t('reports.cashFlow')],
  ]

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-semibold">{t('reports.title')}</h1>
        {loading && <span className="text-xs text-slate-500 animate-pulse">{t('common.loading')}</span>}
      </div>

      {/* Controls */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 mb-6 flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-40">
          <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wide">{t('reports.entity')}</label>
          <select
            value={entityId}
            onChange={e => setEntityId(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">{t('reports.allEntities')}</option>
            {ENTITY_IDS.map(id => (
              <option key={id} value={id}>{entityName(id)}</option>
            ))}
          </select>
        </div>

        {tab !== 'balance' && (
          <>
            <div>
              <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wide">{t('reports.from')}</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wide">{t('reports.to')}</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </>
        )}

        {tab === 'balance' && (
          <div>
            <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wide">{t('reports.asOfDate')}</label>
            <input
              type="date"
              value={asOf}
              onChange={e => setAsOf(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        {tab !== 'balance' && (
          <div className="flex gap-1">
            {[
              { label: t('reports.ytd'), from: yearStart,            to: today },
              { label: 'Q1',            from: `${curYear}-01-01`,   to: `${curYear}-03-31` },
              { label: 'Q2',            from: `${curYear}-04-01`,   to: `${curYear}-06-30` },
              { label: 'Q3',            from: `${curYear}-07-01`,   to: `${curYear}-09-30` },
              { label: 'Q4',            from: `${curYear}-10-01`,   to: `${curYear}-12-31` },
            ].map(p => (
              <button
                key={p.label}
                onClick={() => { setDateFrom(p.from); setDateTo(p.to) }}
                className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6">
        {tabs.map(([tabId, label]) => (
          <button
            key={tabId}
            onClick={() => setTab(tabId)}
            className={`px-4 py-2 text-sm rounded-md transition-colors ${
              tab === tabId ? 'bg-blue-600 text-white font-medium' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Report content */}
      {tab === 'income' && income && <IncomeStatementView data={income} />}
      {tab === 'balance' && balance && <BalanceSheetView data={balance} />}
      {tab === 'cashflow' && cashflow && <CashFlowView data={cashflow} />}

      {!loading && tab === 'income'    && !income    && <EmptyState />}
      {!loading && tab === 'balance'   && !balance   && <EmptyState />}
      {!loading && tab === 'cashflow'  && !cashflow  && <EmptyState />}
    </div>
  )
}

// ── Income Statement ──────────────────────────────────────────────────────────

function IncomeStatementView({ data }: { data: ReturnType<typeof financeApi.getIncomeStatement> extends Promise<infer T> ? T : never }) {
  const { t } = useTranslation()
  const isPositive = data.net_income >= 0
  return (
    <div className="space-y-0">
      <ReportCard title={t('reports.incomeStatement')} subtitle={`${data.period.from} — ${data.period.to}`}>
        <LineGroup title={t('reports.revenue')} lines={data.revenue} total={data.total_revenue} totalColor="text-green-400" />
        <Divider />
        <LineGroup title={t('reports.operatingExpenses')} lines={data.expenses} total={-data.total_expenses} totalColor="text-red-400" totalPrefix="-" />
        <Divider />
        <SummaryRow label={t('reports.operatingIncome')} value={data.operating_income} />

        {(data.other_income.length > 0 || data.other_expense.length > 0) && (
          <>
            <Divider />
            {data.other_income.length > 0  && <LineGroup title={t('reports.otherIncome')}   lines={data.other_income}  total={data.total_other_income} />}
            {data.other_expense.length > 0 && <LineGroup title={t('reports.otherExpenses')} lines={data.other_expense} total={-data.total_other_expense} totalPrefix="-" />}
          </>
        )}

        <div className="mt-4 pt-4 border-t-2 border-slate-600 flex justify-between items-center">
          <span className="text-base font-bold text-slate-100">{t('reports.netIncome')}</span>
          <span className={`text-lg font-bold font-mono ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
            {isPositive ? '' : '-'}{fmtTTD(Math.abs(data.net_income))}
          </span>
        </div>

        {data.revenue.length === 0 && data.expenses.length === 0 && (
          <p className="text-sm text-slate-500 mt-4">{t('reports.noIncomeStatementData')}</p>
        )}
      </ReportCard>
    </div>
  )
}

// ── Balance Sheet ─────────────────────────────────────────────────────────────

function BalanceSheetView({ data }: { data: ReturnType<typeof financeApi.getBalanceSheet> extends Promise<infer T> ? T : never }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Standalone (live) */}
      <ReportCard title={t('reports.balanceSheetLive')} subtitle={t('reports.asOf', { date: data.as_of })}>
        <SectionHeader title={t('reports.assets')} />
        <StandaloneRow label={t('reports.cashAndBankAccounts')} value={data.standalone.bank_liquid} />
        <StandaloneRow label={t('reports.investments')}         value={data.standalone.investments} />
        <SummaryRow    label={t('reports.totalAssets')}         value={data.standalone.total_assets} />

        <div className="h-4" />
        <SectionHeader title={t('reports.liabilities')} />
        <StandaloneRow label={t('reports.creditCards')}      value={data.standalone.credit_liabilities} negate />
        <StandaloneRow label={t('reports.loansAndMortgages')} value={data.standalone.loans}             negate />
        <SummaryRow    label={t('reports.totalLiabilities')} value={data.standalone.total_liabilities} negate />

        <div className="mt-4 pt-4 border-t-2 border-slate-600 flex justify-between items-center">
          <span className="text-base font-bold text-slate-100">{t('reports.netEquity')}</span>
          <span className={`text-lg font-bold font-mono ${data.standalone.net_equity >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
            {fmtTTD(data.standalone.net_equity)}
          </span>
        </div>
        <p className="text-xs text-slate-600 mt-3">{t('reports.propertyImsNote')}</p>
      </ReportCard>

      {/* GL-based */}
      <ReportCard title={t('reports.balanceSheetGl')} subtitle={t('reports.asOfCumulative', { date: data.as_of })}>
        {data.gl.assets.length > 0 && (
          <GlLineGroup title={t('reports.assets')} lines={data.gl.assets} total={data.gl.total_assets} />
        )}
        {data.gl.liabilities.length > 0 && (
          <>
            <div className="h-3" />
            <GlLineGroup title={t('reports.liabilities')} lines={data.gl.liabilities} total={data.gl.total_liabilities} negate />
          </>
        )}
        {data.gl.equity.length > 0 && (
          <>
            <div className="h-3" />
            <GlLineGroup title={t('reports.equity')} lines={data.gl.equity} total={data.gl.total_equity} />
          </>
        )}
        {data.gl.assets.length + data.gl.liabilities.length + data.gl.equity.length === 0 && (
          <p className="text-sm text-slate-500">{t('reports.noGlAccounts')}</p>
        )}
        {data.gl.check !== 0 && data.gl.assets.length > 0 && (
          <p className="text-xs text-amber-500 mt-3">{t('reports.checkDifference', { amount: fmtTTD(data.gl.check) })}</p>
        )}
      </ReportCard>
    </div>
  )
}

// ── Cash Flow ─────────────────────────────────────────────────────────────────

function CashFlowView({ data }: { data: ReturnType<typeof financeApi.getCashFlow> extends Promise<infer T> ? T : never }) {
  const { t } = useTranslation()
  return (
    <ReportCard title={t('reports.cashFlow')} subtitle={`${data.period.from} — ${data.period.to}`}>
      <CfSection title={t('reports.operatingActivities')} section={data.operating} />
      <div className="h-2" />
      <CfSection title={t('reports.investingActivities')} section={data.investing} />
      <div className="h-2" />
      <CfSection title={t('reports.financingActivities')} section={data.financing} />

      <div className="mt-4 pt-4 border-t-2 border-slate-600 flex justify-between items-center">
        <span className="text-base font-bold text-slate-100">{t('reports.netChangeInCash')}</span>
        <span className={`text-lg font-bold font-mono ${data.net_change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {data.net_change >= 0 ? '+' : ''}{fmtTTD(data.net_change)}
        </span>
      </div>

      {data.operating.activities.length + data.investing.activities.length + data.financing.activities.length === 0 && (
        <p className="text-sm text-slate-500 mt-4">{t('reports.noTransactionsFound')}</p>
      )}
    </ReportCard>
  )
}

function CfSection({ title, section }: {
  title: string
  section: { activities: CashFlowActivity[]; inflows: number; outflows: number; net: number }
}) {
  const { t } = useTranslation()
  return (
    <div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">{title}</p>
      {section.activities.length === 0 ? (
        <p className="text-xs text-slate-600 mb-2 pl-2">{t('reports.noActivity')}</p>
      ) : (
        <div className="space-y-0 mb-2">
          {section.activities.map(a => (
            <div key={a.category} className="flex justify-between items-center py-1.5 border-b border-slate-700/50 last:border-0">
              <span className="text-sm text-slate-300 pl-2">
                {t(`reports.categories.${a.category}`, a.category)}
              </span>
              <div className="flex items-center gap-4 text-xs font-mono">
                {a.inflows > 0  && <span className="text-green-400">+{fmtTTD(a.inflows)}</span>}
                {a.outflows < 0 && <span className="text-red-400">{fmtTTD(a.outflows)}</span>}
                <span className={`font-medium w-28 text-right ${a.net >= 0 ? 'text-slate-200' : 'text-red-300'}`}>{a.net >= 0 ? '+' : ''}{fmtTTD(a.net)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-between items-center py-1.5 bg-slate-700/30 rounded px-2">
        <span className="text-sm font-semibold text-slate-200">{t('reports.netSection', { section: title.split(' ')[0] })}</span>
        <span className={`text-sm font-mono font-bold ${section.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {section.net >= 0 ? '+' : ''}{fmtTTD(section.net)}
        </span>
      </div>
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function ReportCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">{title}</p>
}

function LineGroup({ title, lines, total, totalColor = 'text-slate-100', totalPrefix = '' }: {
  title: string; lines: ReportLineItem[]; total: number; totalColor?: string; totalPrefix?: string
}) {
  const { t } = useTranslation()
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">{title}</p>
      {lines.length === 0 ? (
        <p className="text-xs text-slate-600 pl-2 mb-1">{t('reports.noAccounts')}</p>
      ) : (
        lines.map(l => (
          <div key={l.id} className="flex justify-between items-center py-1.5 pl-4 border-b border-slate-700/50 last:border-0">
            <span className="text-sm text-slate-300">{l.account_code} — {l.account_name}</span>
            <span className="text-sm font-mono text-slate-200">{fmtTTD(l.amount)}</span>
          </div>
        ))
      )}
      <div className="flex justify-between items-center py-1.5 pl-4">
        <span className="text-sm font-semibold text-slate-200">{t('reports.totalRevenue', { section: title })}</span>
        <span className={`text-sm font-mono font-bold ${totalColor}`}>{totalPrefix}{fmtTTD(Math.abs(total))}</span>
      </div>
    </div>
  )
}

function GlLineGroup({ title, lines, total, negate = false }: {
  title: string; lines: BalanceSheetLineItem[]; total: number; negate?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">{title}</p>
      {lines.map(l => (
        <div key={l.id} className="flex justify-between items-center py-1.5 pl-4 border-b border-slate-700/50 last:border-0">
          <span className="text-sm text-slate-300">{l.account_code} — {l.account_name}</span>
          <span className="text-sm font-mono text-slate-200">{fmtTTD(l.balance)}</span>
        </div>
      ))}
      <div className="flex justify-between items-center py-1.5 pl-4">
        <span className="text-sm font-semibold text-slate-200">{t('reports.totalRevenue', { section: title })}</span>
        <span className={`text-sm font-mono font-bold ${negate ? 'text-red-400' : 'text-slate-100'}`}>{fmtTTD(total)}</span>
      </div>
    </div>
  )
}

function StandaloneRow({ label, value, negate = false }: { label: string; value: number; negate?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-slate-700/50 last:border-0 pl-2">
      <span className="text-sm text-slate-300">{label}</span>
      <span className={`text-sm font-mono ${negate ? 'text-red-400' : 'text-slate-200'}`}>
        {negate ? '-' : ''}{fmtTTD(value)}
      </span>
    </div>
  )
}

function SummaryRow({ label, value, negate = false }: { label: string; value: number; negate?: boolean }) {
  const isNeg = negate || value < 0
  return (
    <div className="flex justify-between items-center py-1.5 border-t border-slate-600 mt-1">
      <span className="text-sm font-semibold text-slate-200">{label}</span>
      <span className={`text-sm font-mono font-bold ${isNeg ? 'text-red-400' : 'text-slate-100'}`}>
        {fmtTTD(Math.abs(value))}
      </span>
    </div>
  )
}

function Divider() {
  return <div className="h-px bg-slate-700 my-3" />
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-12 text-center">
      <p className="text-slate-500 text-sm">{t('reports.selectDateRange')}</p>
    </div>
  )
}
