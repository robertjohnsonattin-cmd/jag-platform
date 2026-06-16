import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { financeApi } from '../../api/finance'
import { entityName, fmtTTD } from '../../lib/entities'
import type { FinAccount } from '../../types/finance'
import ConfirmDeleteModal from '../ui/ConfirmDeleteModal'

const ACCOUNT_TYPES = [
  'CHEQUING','SAVINGS','CURRENT','CALL_DEPOSIT','CREDIT_CARD','LINE_OF_CREDIT',
  'BROKERAGE','RETIREMENT','MUTUAL_FUND','MORTGAGE','TERM_LOAN','PERSONAL_LOAN','OTHER',
]

const ENTITY_OPTIONS = [
  { id: '00000000-0000-0000-0001-000000000001', name: 'JAG Holdings' },
  { id: '00000000-0000-0000-0001-000000000002', name: 'JABCO' },
  { id: '00000000-0000-0000-0001-000000000003', name: 'JAG Properties' },
  { id: '00000000-0000-0000-0001-000000000004', name: 'JAG Entertainment' },
  { id: '00000000-0000-0000-0001-000000000005', name: 'JAG Finance' },
  { id: '00000000-0000-0000-0001-000000000006', name: 'DragonBridge' },
  { id: '00000000-0000-0000-0001-000000000008', name: 'Personal — Robert' },
  { id: '00000000-0000-0000-0001-000000000009', name: 'Isabella Johnson-Attin' },
  { id: '00000000-0000-0000-0001-000000000010', name: 'Phillip Ajack Johnson-Attin' },
  { id: '00000000-0000-0000-0001-000000000011', name: 'Brian Johnson-Attin' },
  { id: '00000000-0000-0000-0001-000000000012', name: 'Zhanghua Chang' },
  { id: '00000000-0000-0000-0001-000000000013', name: 'Theresa Johnson-Attin' },
]

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

function NewAccountModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    owner_entity_id: ENTITY_OPTIONS[0].id,
    account_name: '',
    institution_name: '',
    account_type: 'CHEQUING',
    currency: 'TTD',
    current_balance: '',
    account_number_last4: '',
    opened_date: new Date().toISOString().slice(0, 10),
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => financeApi.createAccount({
      owner_entity_id: form.owner_entity_id,
      account_name: form.account_name,
      institution_name: form.institution_name,
      account_type: form.account_type,
      currency: form.currency,
      current_balance: form.current_balance ? Number(form.current_balance) : undefined,
      account_number_last4: form.account_number_last4 || undefined,
      opened_date: form.opened_date || undefined,
    }),
    onSuccess: () => { onCreated(); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('finance.accounts.createAccount')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.entity')}</label>
            <select value={form.owner_entity_id} onChange={set('owner_entity_id')} className={cls}>
              {ENTITY_OPTIONS.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('finance.accounts.accountName')}</label>
            <input value={form.account_name} onChange={set('account_name')} className={cls} placeholder="e.g. RBC Current Account" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('finance.accounts.institution')}</label>
            <input value={form.institution_name} onChange={set('institution_name')} className={cls} placeholder="e.g. RBC Royal Bank" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('common.type')}</label>
              <select value={form.account_type} onChange={set('account_type')} className={cls}>
                {ACCOUNT_TYPES.map(tp => <option key={tp} value={tp}>{t(`finance.accounts.accountTypes.${tp}`)}</option>)}
              </select>
            </div>
            <div className="w-24">
              <label className="block text-xs text-slate-400 mb-1">{t('common.currency')}</label>
              <input maxLength={3} value={form.currency} onChange={set('currency')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('finance.accounts.openingBalance')}</label>
              <input type="number" step="0.01" value={form.current_balance} onChange={set('current_balance')} className={cls} placeholder="0.00" />
            </div>
            <div className="w-32">
              <label className="block text-xs text-slate-400 mb-1">{t('finance.accounts.last4digits')}</label>
              <input maxLength={4} value={form.account_number_last4} onChange={set('account_number_last4')} className={cls} placeholder="1234" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('finance.accounts.openedDate')}</label>
            <input type="date" value={form.opened_date} onChange={set('opened_date')} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.account_name || !form.institution_name} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('finance.accounts.createAccount')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

export default function AccountsPanel() {
  const { t } = useTranslation()
  const [showNew, setShowNew] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState<FinAccount | null>(null)
  const qc = useQueryClient()

  const { data: accounts = [], isLoading, error } = useQuery({
    queryKey: ['finance', 'accounts'],
    queryFn: () => financeApi.getAccounts({ is_active: 'true' }),
  })

  if (isLoading) return <Loading />
  if (error) return <p className="text-red-400 text-sm">{t('finance.accounts.failedLoad')}</p>

  const handleCreated = () => void qc.invalidateQueries({ queryKey: ['finance', 'accounts'] })

  const grouped = accounts.reduce<Record<string, FinAccount[]>>((acc, a) => {
    const key = a.owner_entity_id
    ;(acc[key] ??= []).push(a)
    return acc
  }, {})

  const entityIds = Object.keys(grouped).sort((a, b) =>
    entityName(a).localeCompare(entityName(b))
  )

  if (entityIds.length === 0) {
    return <p className="text-slate-400 text-sm">{t('finance.accounts.noAccounts')}</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={() => setShowNew(true)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
          {t('finance.accounts.newAccount')}
        </button>
      </div>

      {showNew && <NewAccountModal onClose={() => setShowNew(false)} onCreated={handleCreated} />}

      {deletingAccount && (
        <ConfirmDeleteModal
          label={deletingAccount.account_name}
          onConfirm={() => financeApi.deleteAccount(deletingAccount.id).then(() => {
            void qc.invalidateQueries({ queryKey: ['finance', 'accounts'] })
          })}
          onClose={() => setDeletingAccount(null)}
        />
      )}

      {entityIds.map((entityId) => {
        const rows = grouped[entityId]
        const total = rows.reduce((s, r) => s + parseFloat(r.current_balance), 0)
        return (
          <div key={entityId}>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">{entityName(entityId)}</h3>
              <span className="text-sm text-slate-400">{fmtTTD(total)} {t('finance.accounts.total')}</span>
            </div>
            <div className="rounded-lg overflow-hidden border border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                    <th className="text-left px-4 py-2">{t('finance.accounts.colAccount')}</th>
                    <th className="text-left px-4 py-2">{t('finance.accounts.colInstitution')}</th>
                    <th className="text-left px-4 py-2">{t('finance.accounts.colType')}</th>
                    <th className="text-left px-4 py-2">{t('finance.accounts.colCcy')}</th>
                    <th className="text-right px-4 py-2">{t('finance.accounts.colBalance')}</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {rows.map((a) => {
                    const bal = parseFloat(a.current_balance)
                    return (
                      <tr key={a.id} className="hover:bg-slate-700/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-100">
                          {a.account_name}
                          {a.account_number_last4 && (
                            <span className="ml-2 text-xs text-slate-500">···{a.account_number_last4}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-300">{a.institution_name}</td>
                        <td className="px-4 py-3 text-slate-400">{t(`finance.accounts.accountTypes.${a.account_type}`, a.account_type)}</td>
                        <td className="px-4 py-3 text-slate-400">{a.currency}</td>
                        <td className={`px-4 py-3 text-right font-mono font-medium ${bal < 0 ? 'text-red-400' : 'text-slate-100'}`}>
                          {fmtTTD(a.current_balance)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setDeletingAccount(a)}
                            className="text-xs text-slate-600 hover:text-red-400 transition-colors"
                            title={t('common.delete')}
                          >&#x1F5D1;</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Loading() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-10 bg-slate-700/40 rounded animate-pulse" />
      ))}
    </div>
  )
}
