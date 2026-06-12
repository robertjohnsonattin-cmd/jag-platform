import { useState } from 'react'
import ChartOfAccounts from '../components/ledger/ChartOfAccounts'
import JournalEntries from '../components/ledger/JournalEntries'
import TrialBalance from '../components/ledger/TrialBalance'

const TABS = [
  { id: 'chart',    label: 'Chart of Accounts' },
  { id: 'entries',  label: 'Journal Entries' },
  { id: 'trial',    label: 'Trial Balance' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function Ledger() {
  const [tab, setTab] = useState<TabId>('chart')

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Ledger</h1>

      <div className="flex gap-1 mb-6 border-b border-slate-700">
        {TABS.map(t => (
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

      {tab === 'chart'   && <ChartOfAccounts />}
      {tab === 'entries' && <JournalEntries />}
      {tab === 'trial'   && <TrialBalance />}
    </div>
  )
}
