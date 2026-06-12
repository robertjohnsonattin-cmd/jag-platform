import { useState } from 'react'
import AccountsPanel from '../components/finance/AccountsPanel'
import TransactionsPanel from '../components/finance/TransactionsPanel'
import NetWorthPanel from '../components/finance/NetWorthPanel'
import FxRatesPanel from '../components/finance/FxRatesPanel'
import InvestmentsPanel from '../components/finance/InvestmentsPanel'
import LoansPanel from '../components/finance/LoansPanel'
import InsurancePanel from '../components/finance/InsurancePanel'
import IntercompanyPanel from '../components/finance/IntercompanyPanel'
import BankStatementsPanel from '../components/finance/BankStatementsPanel'

const TABS = [
  { id: 'accounts',        label: 'Accounts' },
  { id: 'transactions',    label: 'Transactions' },
  { id: 'bank-statements', label: 'Bank Statements' },
  { id: 'investments',     label: 'Investments' },
  { id: 'loans',           label: 'Loans' },
  { id: 'insurance',       label: 'Insurance' },
  { id: 'intercompany',    label: 'Intercompany' },
  { id: 'net-worth',       label: 'Net Worth' },
  { id: 'fx-rates',        label: 'FX Rates' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function Finance() {
  const [tab, setTab] = useState<TabId>('accounts')

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Finance</h1>

      <div className="flex gap-1 mb-6 border-b border-slate-700 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? 'border-blue-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'accounts'        && <AccountsPanel />}
      {tab === 'transactions'    && <TransactionsPanel />}
      {tab === 'bank-statements' && <BankStatementsPanel />}
      {tab === 'investments'     && <InvestmentsPanel />}
      {tab === 'loans'        && <LoansPanel />}
      {tab === 'insurance'    && <InsurancePanel />}
      {tab === 'intercompany' && <IntercompanyPanel />}
      {tab === 'net-worth'    && <NetWorthPanel />}
      {tab === 'fx-rates'     && <FxRatesPanel />}
    </div>
  )
}
