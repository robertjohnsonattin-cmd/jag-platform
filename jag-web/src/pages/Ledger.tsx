import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ChartOfAccounts from '../components/ledger/ChartOfAccounts'
import JournalEntries from '../components/ledger/JournalEntries'
import TrialBalance from '../components/ledger/TrialBalance'

const TABS = [
  { id: 'chart',   key: 'ledger.tabs.chart' },
  { id: 'entries', key: 'ledger.tabs.entries' },
  { id: 'trial',   key: 'ledger.tabs.trial' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function Ledger() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<TabId>('chart')

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">{t('ledger.title')}</h1>

      <div className="flex gap-1 mb-6 border-b border-slate-700">
        {TABS.map(tb => (
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

      {tab === 'chart'   && <ChartOfAccounts />}
      {tab === 'entries' && <JournalEntries />}
      {tab === 'trial'   && <TrialBalance />}
    </div>
  )
}
