import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AccountsPanel from '../components/finance/AccountsPanel'
import TransactionsPanel from '../components/finance/TransactionsPanel'
import NetWorthPanel from '../components/finance/NetWorthPanel'
import FxRatesPanel from '../components/finance/FxRatesPanel'
import InvestmentsPanel from '../components/finance/InvestmentsPanel'
import LoansPanel from '../components/finance/LoansPanel'
import InsurancePanel from '../components/finance/InsurancePanel'
import IntercompanyPanel from '../components/finance/IntercompanyPanel'
import BankStatementsPanel from '../components/finance/BankStatementsPanel'
import DocumentsPanel from '../components/finance/DocumentsPanel'
import CardsPanel from '../components/finance/CardsPanel'

// Tabs grouped into short sections so the nav fits two shallow rows
// instead of one 11-wide strip — mirrors the fix applied to Properties.
const GROUPS = [
  {
    id: 'banking',
    key: 'finance.groups.banking',
    tabs: [
      { id: 'accounts',        key: 'finance.tabs.accounts' },
      { id: 'transactions',    key: 'finance.tabs.transactions' },
      { id: 'bank-statements', key: 'finance.tabs.bankStatements' },
      { id: 'cards',           key: 'finance.tabs.cards' },
    ],
  },
  {
    id: 'assets_liabilities',
    key: 'finance.groups.assetsLiabilities',
    tabs: [
      { id: 'investments', key: 'finance.tabs.investments' },
      { id: 'loans',       key: 'finance.tabs.loans' },
      { id: 'insurance',   key: 'finance.tabs.insurance' },
      { id: 'net-worth',   key: 'finance.tabs.netWorth' },
    ],
  },
  {
    id: 'other',
    key: 'finance.groups.other',
    tabs: [
      { id: 'documents',    key: 'finance.tabs.documents' },
      { id: 'intercompany', key: 'finance.tabs.intercompany' },
      { id: 'fx-rates',     key: 'finance.tabs.fxRates' },
    ],
  },
] as const

type TabId = (typeof GROUPS)[number]['tabs'][number]['id']
type GroupId = (typeof GROUPS)[number]['id']

const TAB_TO_GROUP = new Map<TabId, GroupId>(
  GROUPS.flatMap(g => g.tabs.map(tb => [tb.id, g.id] as [TabId, GroupId])),
)

export default function Finance() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<TabId>('accounts')
  const [group, setGroup] = useState<GroupId>(TAB_TO_GROUP.get('accounts')!)

  const activeGroup = GROUPS.find(g => g.id === group)!

  const selectGroup = (g: GroupId) => {
    setGroup(g)
    setTab(GROUPS.find(gr => gr.id === g)!.tabs[0].id)
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">{t('finance.title')}</h1>

      <div className="flex gap-1 mb-1 overflow-x-auto">
        {GROUPS.map(g => (
          <button
            key={g.id}
            onClick={() => selectGroup(g.id)}
            className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wide rounded-t-md whitespace-nowrap transition-colors ${
              group === g.id ? 'bg-slate-800 text-white' : 'bg-slate-900 text-slate-500 hover:text-slate-300'
            }`}
          >
            {t(g.key, g.id)}
          </button>
        ))}
      </div>

      <div className="flex gap-1 mb-6 border-b border-slate-700 overflow-x-auto pb-0 bg-slate-800/50 rounded-t-md">
        {activeGroup.tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
              tab === tb.id
                ? 'border-blue-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t(tb.key)}
          </button>
        ))}
      </div>

      {tab === 'accounts'        && <AccountsPanel />}
      {tab === 'transactions'    && <TransactionsPanel />}
      {tab === 'bank-statements' && <BankStatementsPanel />}
      {tab === 'documents'       && <DocumentsPanel />}
      {tab === 'investments'     && <InvestmentsPanel />}
      {tab === 'loans'        && <LoansPanel />}
      {tab === 'insurance'    && <InsurancePanel />}
      {tab === 'intercompany' && <IntercompanyPanel />}
      {tab === 'net-worth'    && <NetWorthPanel />}
      {tab === 'fx-rates'     && <FxRatesPanel />}
      {tab === 'cards'        && <CardsPanel />}
    </div>
  )
}
