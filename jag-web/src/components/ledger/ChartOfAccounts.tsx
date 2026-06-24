import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { glApi } from '../../api/gl'
import { ENTITY_NAMES, entityName } from '../../lib/entities'
import type { GlAccount, GlAccountType } from '../../types/gl'

const TYPE_ORDER: GlAccountType[] = ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','OTHER_INCOME','OTHER_EXPENSE']
const TYPE_COLORS: Record<GlAccountType, string> = {
  ASSET: 'text-blue-400', LIABILITY: 'text-red-400', EQUITY: 'text-purple-400',
  REVENUE: 'text-green-400', EXPENSE: 'text-orange-400',
  OTHER_INCOME: 'text-teal-400', OTHER_EXPENSE: 'text-yellow-400',
}

// Auto-derive normal balance from account type
const DEFAULT_BALANCE: Record<GlAccountType, 'DEBIT' | 'CREDIT'> = {
  ASSET: 'DEBIT', EXPENSE: 'DEBIT', OTHER_EXPENSE: 'DEBIT',
  LIABILITY: 'CREDIT', EQUITY: 'CREDIT', REVENUE: 'CREDIT', OTHER_INCOME: 'CREDIT',
}

const ENTITY_OPTIONS = Object.entries(ENTITY_NAMES)
  .filter(([id]) => id !== '00000000-0000-0000-0000-000000000000')
  .map(([id, name]) => ({ id, name }))

const ACCOUNT_TYPE_LABELS: Record<GlAccountType, string> = {
  ASSET: 'Asset', LIABILITY: 'Liability', EQUITY: 'Equity',
  REVENUE: 'Revenue', EXPENSE: 'Expense',
  OTHER_INCOME: 'Other Income', OTHER_EXPENSE: 'Other Expense',
}

// ── Add Account Modal ─────────────────────────────────────────────────────────

function AddAccountModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    owner_entity_id:      '',
    account_code:         '',
    account_name:         '',
    account_type:         'OTHER_INCOME' as GlAccountType,
    description:          '',
    allow_direct_posting: true,
  })
  const [err, setErr] = useState('')

  const normalBalance = DEFAULT_BALANCE[form.account_type]

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      if (!form.owner_entity_id) throw new Error('Select an entity.')
      if (!form.account_code.trim()) throw new Error('Account code is required.')
      if (!form.account_name.trim()) throw new Error('Account name is required.')
      return glApi.createAccount({
        owner_entity_id:      form.owner_entity_id,
        account_code:         form.account_code.trim(),
        account_name:         form.account_name.trim(),
        account_type:         form.account_type,
        normal_balance:       normalBalance,
        description:          form.description || undefined,
        allow_direct_posting: form.allow_direct_posting,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gl', 'accounts'] })
      onClose()
    },
    onError: (e: unknown) => setErr((e as Error).message),
  })

  const cls = 'bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 w-full'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Add GL Account</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Entity *</label>
            <select value={form.owner_entity_id} onChange={set('owner_entity_id')} className={cls}>
              <option value="">— select entity —</option>
              {ENTITY_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Account Code *</label>
              <input value={form.account_code} onChange={set('account_code')} className={cls} placeholder="e.g. 7000" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Account Type *</label>
              <select value={form.account_type} onChange={e => setForm(f => ({ ...f, account_type: e.target.value as GlAccountType }))} className={cls}>
                {TYPE_ORDER.map(t => <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Account Name *</label>
            <input value={form.account_name} onChange={set('account_name')} className={cls} placeholder="e.g. Gain on Disposal of Fixed Assets" />
          </div>

          <div className="flex items-center gap-3 px-0.5">
            <span className="text-xs text-slate-400">Normal balance:</span>
            <span className={`text-xs font-medium font-mono ${normalBalance === 'DEBIT' ? 'text-blue-400' : 'text-green-400'}`}>
              {normalBalance}
            </span>
            <span className="text-xs text-slate-500">(auto-set from type)</span>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Description (optional)</label>
            <input value={form.description} onChange={set('description')} className={cls} placeholder="Short note on what this account tracks" />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input type="checkbox" checked={form.allow_direct_posting}
              onChange={e => setForm(f => ({ ...f, allow_direct_posting: e.target.checked }))}
              className="accent-blue-500" />
            Allow direct posting (show in journal entry dropdowns)
          </label>
        </div>

        {err && <p className="text-red-400 text-xs mt-3">{err}</p>}

        <div className="flex gap-3 mt-4">
          <button onClick={() => { setErr(''); mutate() }} disabled={isPending}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? 'Saving…' : 'Add Account'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Chart of Accounts ─────────────────────────────────────────────────────────

export default function ChartOfAccounts() {
  const { t } = useTranslation()
  const [showAdd, setShowAdd] = useState(false)
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['gl', 'accounts'],
    queryFn: () => glApi.getAccounts({ is_active: 'true' }),
  })

  if (isLoading) return <Skeleton />

  const grouped = TYPE_ORDER.reduce<Partial<Record<GlAccountType, GlAccount[]>>>((acc, type) => {
    const group = accounts.filter(a => a.account_type === type)
    if (group.length > 0) acc[type] = group
    return acc
  }, {})

  return (
    <>
      {showAdd && <AddAccountModal onClose={() => setShowAdd(false)} />}

      <div className="flex justify-between items-center mb-4">
        <p className="text-slate-400 text-sm">{accounts.length} accounts across all entities</p>
        <button onClick={() => setShowAdd(true)}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
          + Add Account
        </button>
      </div>

      {accounts.length === 0 && <p className="text-slate-400 text-sm">{t('chartOfAccounts.noAccounts')}</p>}

      <div className="space-y-6">
        {(Object.entries(grouped) as [GlAccountType, GlAccount[]][]).map(([type, rows]) => (
          <div key={type}>
            <h3 className={`text-xs font-bold uppercase tracking-widest mb-2 ${TYPE_COLORS[type]}`}>
              {t(`chartOfAccounts.types.${type}`)}
            </h3>
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                    <th className="text-left px-4 py-2 w-28">{t('chartOfAccounts.colCode')}</th>
                    <th className="text-left px-4 py-2">{t('chartOfAccounts.colName')}</th>
                    <th className="text-left px-4 py-2">{t('chartOfAccounts.colEntity')}</th>
                    <th className="text-left px-4 py-2">{t('chartOfAccounts.colNormal')}</th>
                    <th className="text-left px-4 py-2">{t('chartOfAccounts.colCurrency')}</th>
                    <th className="text-center px-4 py-2">{t('chartOfAccounts.colDirectPost')}</th>
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
    </>
  )
}

function Skeleton() {
  return (
    <div className="space-y-3">
      {[1,2,3,4].map(i => <div key={i} className="h-8 bg-slate-700/40 rounded animate-pulse" />)}
    </div>
  )
}
