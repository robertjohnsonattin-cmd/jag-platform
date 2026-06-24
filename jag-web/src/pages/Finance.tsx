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

const TABS = [
  { id: 'accounts',        key: 'finance.tabs.accounts' },
  { id: 'transactions',    key: 'finance.tabs.transactions' },
  { id: 'bank-statements', key: 'finance.tabs.bankStatements' },
  { id: 'documents',       key: 'finance.tabs.documents' },
  { id: 'investments',     key: 'finance.tabs.investments' },
  { id: 'loans',           key: 'finance.tabs.loans' },
  { id: 'insurance',       key: 'finance.tabs.insurance' },
  { id: 'intercompany',    key: 'finance.tabs.intercompany' },
  { id: 'net-worth',       key: 'finance.tabs.netWorth' },
  { id: 'fx-rates',        key: 'finance.tabs.fxRates' },
  { id: 'cards',           key: 'finance.tabs.cards' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function Finance() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<TabId>('accounts')

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">{t('finance.title')}</h1>

      <div className="flex gap-1 mb-6 border-b border-slate-700 flex-wrap">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
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
