import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  barTabsApi, barProductsApi, barConfigApi, barSharedApi,
  clubMembersApi, clubTiersApi, clubEventsApi,
  clubVisitorApi, clubFloatApi, clubSharedApi,
  entertainmentReportsApi,
} from '../api/entertainment'
import CrmContactPicker, { CrmContactBadge } from '../components/crm/CrmContactPicker'
import type { UtilityBill, SupplierInvoiceRaw, UtilityType } from '../api/entertainment'
import type {
  Tab, Product, Member, MemberDetail,
  Tier, ClubEvent, ChipFloat, VisitorLog,
  Venue, ProductCategory, PaymentMethod, TabStatus, IdType,
} from '../types/entertainment'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtM = (v: number | null | undefined) => v == null ? '—' : `TTD ${fmt.format(v)}`
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtTime = (d: string) =>
  new Date(d).toLocaleTimeString('en-TT', { hour: '2-digit', minute: '2-digit' })
const fmtDT = (d: string) => `${fmtDate(d)} ${fmtTime(d)}`

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

const TAB_STATUS_STYLES: Record<TabStatus, string> = {
  OPEN:    'bg-green-900/50 text-green-300 border border-green-700',
  CLOSED:  'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
  SETTLED: 'bg-slate-700/60 text-slate-400 border border-slate-600',
  VOIDED:  'bg-red-900/50 text-red-400 border border-red-700',
}

// ── Shared: Invoice panel ─────────────────────────────────────────────────────

function InvoicePanel({ prefix }: { prefix: 'bar' | 'club' }) {
  const { t } = useTranslation()
  const api = prefix === 'bar' ? barSharedApi : clubSharedApi
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ supplier_name: '', amount: '', vat_amount: '', invoice_date: new Date().toISOString().slice(0, 10), invoice_ref: '', due_date: '' })
  const [payingId, setPayingId] = useState<string | null>(null)
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10))
  const [err, setErr] = useState<string | null>(null)

  const { data: resp } = useQuery({ queryKey: [`${prefix}-invoices`], queryFn: api.invoices.list })
  const invoices: SupplierInvoiceRaw[] = resp?.supplier_invoices ?? []

  const blank = { supplier_name: '', amount: '', vat_amount: '', invoice_date: new Date().toISOString().slice(0, 10), invoice_ref: '', due_date: '' }
  const addMut = useMutation({
    mutationFn: () => api.invoices.create({ supplier_name: form.supplier_name, amount: parseFloat(form.amount), vat_amount: parseFloat(form.vat_amount || '0'), invoice_date: form.invoice_date, invoice_ref: form.invoice_ref || undefined, due_date: form.due_date || undefined, idempotency_key: uuidv4() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`${prefix}-invoices`] }); setShowAdd(false); setForm(blank) },
    onError: (e: Error) => setErr(e.message),
  })
  const approveMut = useMutation({ mutationFn: (id: string) => api.invoices.approve(id), onSuccess: () => qc.invalidateQueries({ queryKey: [`${prefix}-invoices`] }) })
  const payMut = useMutation({
    mutationFn: (id: string) => api.invoices.pay(id, { paid_date: paidDate }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`${prefix}-invoices`] }); setPayingId(null) },
  })

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-white font-medium">{t('ent.supplierInvoices')}</h3>
        <button onClick={() => setShowAdd(s => !s)} className="px-3 py-1.5 rounded text-xs bg-orange-600 hover:bg-orange-500 text-white transition-colors">+ {t('common.add')}</button>
      </div>
      {showAdd && (
        <div className="bg-slate-700/50 rounded-lg p-4 space-y-3">
          {[
            { label: t('ent.supplierStar'), key: 'supplier_name', type: 'text', placeholder: 'Supplier name' },
            { label: t('ent.invoiceRef'), key: 'invoice_ref', type: 'text', placeholder: 'Optional' },
            { label: t('ent.amountExclVat'), key: 'amount', type: 'number', placeholder: '0.00' },
            { label: t('ent.vatAmount'), key: 'vat_amount', type: 'number', placeholder: '0.00' },
            { label: t('ent.invoiceDateStar'), key: 'invoice_date', type: 'date', placeholder: '' },
            { label: t('ent.dueDate'), key: 'due_date', type: 'date', placeholder: '' },
          ].map(({ label, key, type, placeholder }) => (
            <div key={key}>
              <label className="block text-slate-400 text-xs mb-1">{label}</label>
              <input type={type} value={(form as Record<string, string>)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
            </div>
          ))}
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <button onClick={() => addMut.mutate()} disabled={addMut.isPending || !form.supplier_name || !form.amount} className="px-4 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors">{addMut.isPending ? t('common.saving') : t('common.save')}</button>
        </div>
      )}
      {payingId && (
        <div className="bg-slate-700/50 rounded-lg p-3 flex items-center gap-3">
          <label className="text-slate-400 text-xs">{t('ent.paidDate')}</label>
          <input type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
          <button onClick={() => payMut.mutate(payingId)} disabled={payMut.isPending} className="px-3 py-1.5 rounded text-xs bg-green-700 hover:bg-green-600 text-white disabled:opacity-50 transition-colors">{t('ent.confirm')}</button>
          <button onClick={() => setPayingId(null)} className="px-3 py-1.5 rounded text-xs bg-slate-600 text-slate-300 transition-colors">{t('common.cancel')}</button>
        </div>
      )}
      <div className="space-y-2">
        {invoices.map(inv => (
          <div key={inv.id} className="bg-slate-700/40 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-white text-sm font-medium">{inv.supplier_name}</p>
              <p className="text-slate-400 text-xs">{inv.invoice_ref ?? t('ent.noRef')} · {fmtDate(inv.invoice_date)} · {fmtM(inv.amount + inv.vat_amount)} {t('ent.inclVat')}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${inv.status === 'PAID' ? 'bg-green-900/50 text-green-300' : inv.status === 'APPROVED' ? 'bg-blue-900/50 text-blue-300' : 'bg-yellow-900/50 text-yellow-300'}`}>{inv.status}</span>
              {inv.status === 'PENDING' && <button onClick={() => approveMut.mutate(inv.id)} className="px-2 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white transition-colors">{t('ent.approve')}</button>}
              {inv.status === 'APPROVED' && <button onClick={() => setPayingId(inv.id)} className="px-2 py-1 rounded text-xs bg-green-700 hover:bg-green-600 text-white transition-colors">{t('ent.markPaid')}</button>}
            </div>
          </div>
        ))}
        {invoices.length === 0 && <p className="text-slate-500 text-sm text-center py-6">{t('ent.noInvoices')}</p>}
      </div>
    </div>
  )
}

// ── Shared: Utilities panel ───────────────────────────────────────────────────

const UTILITY_TYPES: UtilityType[] = ['ELECTRICITY', 'WATER', 'GAS', 'INTERNET', 'OTHER']

function UtilitiesPanel({ prefix }: { prefix: 'bar' | 'club' }) {
  const { t } = useTranslation()
  const api = prefix === 'bar' ? barSharedApi : clubSharedApi
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ utility_type: 'ELECTRICITY' as UtilityType, provider: '', amount: '', vat_amount: '', bill_date: new Date().toISOString().slice(0, 10) })
  const [err, setErr] = useState<string | null>(null)

  const { data: resp } = useQuery({ queryKey: [`${prefix}-utilities`], queryFn: api.utilities.list })
  const utilities: UtilityBill[] = resp?.utility_bills ?? []

  const addMut = useMutation({
    mutationFn: () => api.utilities.create({ utility_type: form.utility_type, provider: form.provider, amount: parseFloat(form.amount), vat_amount: parseFloat(form.vat_amount || '0'), bill_date: form.bill_date, idempotency_key: uuidv4() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`${prefix}-utilities`] }); setShowAdd(false); setForm({ utility_type: 'ELECTRICITY', provider: '', amount: '', vat_amount: '', bill_date: new Date().toISOString().slice(0, 10) }) },
    onError: (e: Error) => setErr(e.message),
  })

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-white font-medium">{t('ent.utilities')}</h3>
        <button onClick={() => setShowAdd(s => !s)} className="px-3 py-1.5 rounded text-xs bg-orange-600 hover:bg-orange-500 text-white transition-colors">+ {t('common.add')}</button>
      </div>
      {showAdd && (
        <div className="bg-slate-700/50 rounded-lg p-4 space-y-3">
          <div>
            <label className="block text-slate-400 text-xs mb-1">{t('common.type')} *</label>
            <select value={form.utility_type} onChange={e => setForm(f => ({ ...f, utility_type: e.target.value as UtilityType }))} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm">
              {UTILITY_TYPES.map(ut => <option key={ut} value={ut}>{ut}</option>)}
            </select>
          </div>
          {[
            { label: t('ent.providerStar'), key: 'provider', type: 'text', placeholder: 'T&TEC, WASA…' },
            { label: t('ent.amountExclVat'), key: 'amount', type: 'number', placeholder: '0.00' },
            { label: t('ent.vatAmount'), key: 'vat_amount', type: 'number', placeholder: '0.00' },
            { label: t('ent.billDateStar'), key: 'bill_date', type: 'date', placeholder: '' },
          ].map(({ label, key, type, placeholder }) => (
            <div key={key}>
              <label className="block text-slate-400 text-xs mb-1">{label}</label>
              <input type={type} value={(form as Record<string, string>)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
            </div>
          ))}
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <button onClick={() => addMut.mutate()} disabled={addMut.isPending || !form.provider || !form.amount} className="px-4 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors">{addMut.isPending ? t('common.saving') : t('common.save')}</button>
        </div>
      )}
      <div className="space-y-2">
        {utilities.map(u => (
          <div key={u.id} className="bg-slate-700/40 rounded-lg px-4 py-3 flex justify-between items-center">
            <div>
              <p className="text-white text-sm font-medium">{u.utility_type} · {u.provider}</p>
              <p className="text-slate-400 text-xs">{fmtDate(u.bill_date)} · {fmtM(u.amount + u.vat_amount)} {t('ent.inclVat')}</p>
            </div>
            <span className={`px-2 py-0.5 rounded text-xs ${u.paid_date ? 'bg-green-900/50 text-green-300' : 'bg-yellow-900/50 text-yellow-300'}`}>{u.paid_date ? t('ent.paid') : t('ent.unpaid')}</span>
          </div>
        ))}
        {utilities.length === 0 && <p className="text-slate-500 text-sm text-center py-6">{t('ent.noUtilities')}</p>}
      </div>
    </div>
  )
}

// ── BAR: Tab Detail ───────────────────────────────────────────────────────────

function TabDetailPanel({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState('1')
  const [itemNotes, setItemNotes] = useState('')
  const [settleMethod, setSettleMethod] = useState<PaymentMethod>('CASH')
  const [settleAmount, setSettleAmount] = useState('')
  const [settleRef, setSettleRef] = useState('')
  const [actionErr, setActionErr] = useState<string | null>(null)

  const { data: tab, isLoading } = useQuery({ queryKey: ['bar-tab', tabId], queryFn: () => barTabsApi.get(tabId) })
  const { data: products = [] } = useQuery({ queryKey: ['bar-products'], queryFn: () => barProductsApi.list({ active: true }) })

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['bar-tab', tabId] }); qc.invalidateQueries({ queryKey: ['bar-tabs'] }) }

  const addItem = useMutation({ mutationFn: () => barTabsApi.addItem(tabId, { product_id: productId, quantity: parseInt(qty), notes: itemNotes || undefined }), onSuccess: () => { invalidate(); setProductId(''); setQty('1'); setItemNotes('') }, onError: (e: Error) => setActionErr(e.message) })
  const voidItem = useMutation({ mutationFn: (itemId: string) => barTabsApi.voidItem(tabId, itemId), onSuccess: invalidate })
  const closeTab = useMutation({ mutationFn: () => barTabsApi.close(tabId), onSuccess: invalidate, onError: (e: Error) => setActionErr(e.message) })
  const voidTab = useMutation({ mutationFn: () => barTabsApi.void(tabId), onSuccess: () => { invalidate(); onClose() }, onError: (e: Error) => setActionErr(e.message) })
  const settle = useMutation({
    mutationFn: () => barTabsApi.settle(tabId, { method: settleMethod, amount: parseFloat(settleAmount), reference: settleRef || undefined, idempotency_key: uuidv4() }),
    onSuccess: () => { invalidate(); setSettleAmount('') },
    onError: (e: Error) => setActionErr(e.message),
  })

  if (isLoading || !tab) return <div className="flex items-center justify-center h-full text-slate-400 text-sm">{t('common.loading')}</div>

  const paid = tab.payments.reduce((s, p) => s + p.amount, 0)
  const remaining = Math.max(0, tab.total - paid)
  const isOpen = tab.status === 'OPEN'
  const isClosed = tab.status === 'CLOSED'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-white font-semibold">Tab #{tab.tab_number}</h2>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${TAB_STATUS_STYLES[tab.status]}`}>{tab.status}</span>
          </div>
          <p className="text-slate-400 text-sm mt-0.5">
            {tab.customer_name ?? tab.member_name ?? t('ent.walkIn')} · {tab.venue}
            {tab.table_ref ? ` · ${t('ent.tableLabel', { ref: tab.table_ref })}` : ''}
          </p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none shrink-0">&times;</button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Items */}
        <div>
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-2">{t('ent.items')}</p>
          <div className="space-y-1">
            {tab.items.length === 0 && <p className="text-slate-500 text-sm">{t('ent.noItems')}</p>}
            {tab.items.map(item => (
              <div key={item.id} className={`flex items-center justify-between text-sm gap-2 py-1 ${item.voided ? 'opacity-40 line-through' : ''}`}>
                <span className="text-white truncate">{item.quantity}× {item.product_name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-slate-300">{fmtM(item.unit_price * item.quantity)}</span>
                  {isOpen && !item.voided && (
                    <button onClick={() => voidItem.mutate(item.id)} className="text-red-400 hover:text-red-300 text-xs transition-colors">{t('ent.void')}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Add item (OPEN only) */}
        {isOpen && (
          <div className="bg-slate-700/40 rounded-lg p-3 space-y-2">
            <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{t('ent.addItem')}</p>
            <select value={productId} onChange={e => setProductId(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm">
              <option value="">— select product —</option>
              {(products as Product[]).map(p => <option key={p.id} value={p.id}>{p.name} — {fmtM(p.price)}</option>)}
            </select>
            <div className="flex gap-2">
              <input type="number" value={qty} onChange={e => setQty(e.target.value)} min="1" placeholder={t('ent.qty')} className="w-20 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm" />
              <input type="text" value={itemNotes} onChange={e => setItemNotes(e.target.value)} placeholder={t('common.notes') + ' (optional)'} className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm" />
            </div>
            <button onClick={() => addItem.mutate()} disabled={addItem.isPending || !productId} className="w-full py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors">{addItem.isPending ? t('ent.adding') : t('common.add')}</button>
          </div>
        )}

        {/* Totals */}
        {tab.status !== 'OPEN' && (
          <div className="bg-slate-700/30 rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">{t('ent.subtotal')}</span><span className="text-white">{fmtM(tab.subtotal)}</span></div>
            <div className="flex justify-between font-semibold border-t border-slate-600 pt-1 mt-1"><span className="text-white">{t('common.total')}</span><span className="text-white">{fmtM(tab.total)}</span></div>
            {tab.payments.length > 0 && tab.payments.map(p => (
              <div key={p.id} className="flex justify-between text-xs text-slate-400">
                <span>{p.method}</span><span>{fmtM(p.amount)}</span>
              </div>
            ))}
            {remaining > 0 && <div className="flex justify-between font-medium text-red-400 border-t border-slate-600 pt-1 mt-1"><span>{t('ent.remaining')}</span><span>{fmtM(remaining)}</span></div>}
          </div>
        )}

        {/* Payments (CLOSED — settle) */}
        {isClosed && remaining > 0 && (
          <div className="bg-slate-700/40 rounded-lg p-3 space-y-2">
            <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{t('ent.recordPayment')}</p>
            <select value={settleMethod} onChange={e => setSettleMethod(e.target.value as PaymentMethod)} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm">
              {(['CASH', 'CARD', 'MEMBER_CREDIT', 'COMPLIMENTARY'] as PaymentMethod[]).map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select>
            <div className="flex gap-2">
              <input type="number" value={settleAmount} onChange={e => setSettleAmount(e.target.value)} placeholder={`Amount (max ${fmtM(remaining)})`} step="0.01" className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm" />
              <input type="text" value={settleRef} onChange={e => setSettleRef(e.target.value)} placeholder={t('ent.refOptional')} className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm" />
            </div>
            <button onClick={() => settle.mutate()} disabled={settle.isPending || !settleAmount} className="w-full py-2 rounded text-sm bg-green-700 hover:bg-green-600 text-white disabled:opacity-50 transition-colors">{settle.isPending ? t('ent.recording') : t('ent.recordPayment')}</button>
          </div>
        )}

        {actionErr && <p className="text-red-400 text-sm">{actionErr}</p>}

        {/* Actions */}
        <div className="flex gap-2">
          {isOpen && (
            <>
              <button onClick={() => closeTab.mutate()} disabled={closeTab.isPending || tab.items.filter(i => !i.voided).length === 0} className="flex-1 py-2 rounded text-sm bg-yellow-700 hover:bg-yellow-600 text-white disabled:opacity-50 transition-colors">{closeTab.isPending ? t('ent.closingEllipsis') : t('ent.closeTab')}</button>
              <button onClick={() => voidTab.mutate()} disabled={voidTab.isPending} className="px-4 py-2 rounded text-sm bg-red-800 hover:bg-red-700 text-white disabled:opacity-50 transition-colors">{t('ent.void')}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── BAR: Tabs section ─────────────────────────────────────────────────────────

function BarTabs({ defaultVenue }: { defaultVenue: Venue }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<TabStatus | 'ALL'>('OPEN')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ venue: defaultVenue, customer_name: '', table_ref: '', add_service_charge: false })
  const [newErr, setNewErr] = useState<string | null>(null)

  const { data: tabs = [] } = useQuery({
    queryKey: ['bar-tabs', statusFilter],
    queryFn: () => barTabsApi.list(statusFilter === 'ALL' ? {} : { status: statusFilter }),
    refetchInterval: 30000,
  })

  const openTab = useMutation({
    mutationFn: () => barTabsApi.open({ venue: newForm.venue, customer_name: newForm.customer_name || undefined, table_ref: newForm.table_ref || undefined, add_service_charge: newForm.add_service_charge }),
    onSuccess: (tab) => { qc.invalidateQueries({ queryKey: ['bar-tabs'] }); setShowNew(false); setSelectedId(tab.id) },
    onError: (e: Error) => setNewErr(e.message),
  })

  return (
    <div className="flex h-full">
      {/* List */}
      <div className={`flex flex-col ${selectedId ? 'hidden lg:flex lg:w-80 lg:shrink-0' : 'flex-1'}`}>
        <div className="px-3 py-2 border-b border-slate-700 flex gap-1 flex-wrap">
          {(['OPEN', 'CLOSED', 'SETTLED', 'VOIDED', 'ALL'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter === s ? 'bg-orange-700 text-white' : 'bg-slate-700 text-slate-300 hover:text-white'}`}>{s}</button>
          ))}
          <button onClick={() => setShowNew(true)} className="ml-auto px-3 py-1 rounded text-xs bg-green-700 hover:bg-green-600 text-white transition-colors">{t('ent.newTab')}</button>
        </div>

        {showNew && (
          <div className="border-b border-slate-700 p-3 bg-slate-800 space-y-2">
            <div className="flex gap-2">
              {(['BAR', 'CLUB'] as Venue[]).map(v => (
                <button key={v} onClick={() => setNewForm(f => ({ ...f, venue: v }))} className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${newForm.venue === v ? 'bg-orange-700 text-white' : 'bg-slate-700 text-slate-300'}`}>{v}</button>
              ))}
            </div>
            <input type="text" value={newForm.customer_name} onChange={e => setNewForm(f => ({ ...f, customer_name: e.target.value }))} placeholder={t('ent.customerNameOptional')} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
            <input type="text" value={newForm.table_ref} onChange={e => setNewForm(f => ({ ...f, table_ref: e.target.value }))} placeholder={t('ent.tableRefOptional')} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" checked={newForm.add_service_charge} onChange={e => setNewForm(f => ({ ...f, add_service_charge: e.target.checked }))} className="accent-orange-500" />
              {t('ent.addServiceCharge')}
            </label>
            {newErr && <p className="text-red-400 text-xs">{newErr}</p>}
            <div className="flex gap-2">
              <button onClick={() => openTab.mutate()} disabled={openTab.isPending} className="flex-1 py-1.5 rounded text-xs bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors">{openTab.isPending ? t('ent.opening') : t('ent.openTab')}</button>
              <button onClick={() => setShowNew(false)} className="px-3 py-1.5 rounded text-xs bg-slate-700 text-slate-300 hover:text-white transition-colors">{t('common.cancel')}</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-slate-700/50">
          {(tabs as Tab[]).length === 0 && <p className="text-slate-500 text-sm text-center py-10">{t('ent.noTabs')}</p>}
          {(tabs as Tab[]).map(tab => (
            <button key={tab.id} onClick={() => setSelectedId(tab.id)} className={`w-full text-left px-4 py-3 hover:bg-slate-700/40 transition-colors ${selectedId === tab.id ? 'bg-slate-700/60' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-white text-sm font-medium truncate">#{tab.tab_number} · {tab.customer_name ?? tab.member_name ?? t('ent.walkIn')}</p>
                  <p className="text-slate-400 text-xs mt-0.5">{tab.venue}{tab.table_ref ? ` · ${tab.table_ref}` : ''} · {fmtTime(tab.opened_at)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-white text-sm font-medium">{fmtM(tab.total)}</p>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${TAB_STATUS_STYLES[tab.status]}`}>{tab.status}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail */}
      {selectedId && (
        <div className="flex-1 border-l border-slate-700 bg-slate-800/50 flex flex-col overflow-hidden">
          <TabDetailPanel tabId={selectedId} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  )
}

// ── BAR: Products ─────────────────────────────────────────────────────────────

function BarProducts() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [catFilter, setCatFilter] = useState<ProductCategory | 'ALL'>('ALL')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', category: 'DRINK' as ProductCategory, price: '', cost: '', sku: '', stock_qty: '' })
  const [err, setErr] = useState<string | null>(null)

  const { data: products = [] } = useQuery({
    queryKey: ['bar-products', catFilter],
    queryFn: () => barProductsApi.list(catFilter === 'ALL' ? {} : { category: catFilter }),
  })

  const createMut = useMutation({
    mutationFn: () => barProductsApi.create({ name: form.name, category: form.category, price: parseFloat(form.price), cost: form.cost ? parseFloat(form.cost) : undefined, sku: form.sku || undefined, stock_qty: form.stock_qty ? parseInt(form.stock_qty) : undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bar-products'] }); setShowAdd(false); setForm({ name: '', category: 'DRINK', price: '', cost: '', sku: '', stock_qty: '' }) },
    onError: (e: Error) => setErr(e.message),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => barProductsApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bar-products'] }) },
  })

  const CAT_COLORS: Record<ProductCategory, string> = {
    DRINK: 'bg-blue-900/50 text-blue-300',
    FOOD: 'bg-green-900/50 text-green-300',
    MERCHANDISE: 'bg-purple-900/50 text-purple-300',
    OTHER: 'bg-slate-700 text-slate-400',
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {(['ALL', 'DRINK', 'FOOD', 'MERCHANDISE', 'OTHER'] as const).map(c => (
          <button key={c} onClick={() => setCatFilter(c)} className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${catFilter === c ? 'bg-orange-700 text-white' : 'bg-slate-700 text-slate-300 hover:text-white'}`}>{c}</button>
        ))}
        <button onClick={() => setShowAdd(s => !s)} className="ml-auto px-3 py-1.5 rounded text-xs bg-orange-600 hover:bg-orange-500 text-white transition-colors">{t('ent.addProductBtn')}</button>
      </div>

      {showAdd && (
        <div className="bg-slate-700/50 rounded-lg p-4 space-y-3">
          {[
            { label: `${t('common.name')} *`, key: 'name', type: 'text' },
            { label: t('ent.priceStar'), key: 'price', type: 'number' },
            { label: t('ent.cost'), key: 'cost', type: 'number' },
            { label: 'SKU', key: 'sku', type: 'text' },
            { label: t('ent.stockQty'), key: 'stock_qty', type: 'number' },
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label className="block text-slate-400 text-xs mb-1">{label}</label>
              <input type={type} value={(form as Record<string, string>)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
            </div>
          ))}
          <div>
            <label className="block text-slate-400 text-xs mb-1">{t('ent.categoryStar')}</label>
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as ProductCategory }))} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm">
              {(['DRINK', 'FOOD', 'MERCHANDISE', 'OTHER'] as ProductCategory[]).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.name || !form.price} className="px-4 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors">{createMut.isPending ? t('common.saving') : t('ent.addProduct')}</button>
        </div>
      )}

      <div className="space-y-2">
        {(products as Product[]).map(p => (
          <div key={p.id} className="bg-slate-700/40 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-white text-sm font-medium">{p.name}</p>
                <span className={`px-1.5 py-0.5 rounded text-xs ${CAT_COLORS[p.category]}`}>{p.category}</span>
                {!p.is_active && <span className="text-xs text-slate-500">{t('ent.inactive')}</span>}
              </div>
              <p className="text-slate-400 text-xs mt-0.5">{p.sku ? `SKU: ${p.sku} · ` : ''}{p.stock_qty != null ? `Stock: ${p.stock_qty}` : t('ent.noStockTracking')}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-white font-medium">{fmtM(p.price)}</span>
              <button onClick={() => updateMut.mutate({ id: p.id, data: { is_active: !p.is_active } })} className={`px-2 py-1 rounded text-xs transition-colors ${p.is_active ? 'bg-slate-600 text-slate-300 hover:text-white' : 'bg-green-800 text-green-300 hover:bg-green-700'}`}>{p.is_active ? t('ent.deactivate') : t('ent.activate')}</button>
            </div>
          </div>
        ))}
        {(products as Product[]).length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t('ent.noProducts')}</p>}
      </div>
    </div>
  )
}

// ── BAR: Config ───────────────────────────────────────────────────────────────

function BarConfig() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: config } = useQuery({ queryKey: ['bar-config'], queryFn: barConfigApi.get })
  const [form, setForm] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  const updateMut = useMutation({
    mutationFn: () => barConfigApi.update({
      vat_pct: form.vat_pct ? parseFloat(form.vat_pct) : undefined,
      service_charge_pct: form.service_charge_pct ? parseFloat(form.service_charge_pct) : undefined,
      bar_license_expiry: form.bar_license_expiry || undefined,
      club_license_expiry: form.club_license_expiry || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bar-config'] }); setSaved(true); setTimeout(() => setSaved(false), 2000) },
  })

  if (!config) return <div className="p-4 text-slate-400 text-sm">{t('common.loading')}</div>

  const val = (key: string, fallback: string | number) => key in form ? form[key] : String(fallback ?? '')

  return (
    <div className="p-6 max-w-md space-y-4">
      <h3 className="text-white font-medium">{t('ent.ratesLicences')}</h3>
      {[
        { label: t('ent.vatPct'), key: 'vat_pct', fallback: config.vat_pct, type: 'number' },
        { label: t('ent.serviceChargePct'), key: 'service_charge_pct', fallback: config.service_charge_pct, type: 'number' },
        { label: t('ent.barLicenceExpiry'), key: 'bar_license_expiry', fallback: config.bar_license_expiry ?? '', type: 'date' },
        { label: t('ent.clubLicenceExpiry'), key: 'club_license_expiry', fallback: config.club_license_expiry ?? '', type: 'date' },
      ].map(({ label, key, fallback, type }) => (
        <div key={key}>
          <label className="block text-slate-400 text-xs mb-1">{label}</label>
          <input type={type} value={val(key, fallback)} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm" />
        </div>
      ))}
      <button onClick={() => updateMut.mutate()} disabled={updateMut.isPending} className="px-4 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors">
        {saved ? t('ent.saved') : updateMut.isPending ? t('common.saving') : t('common.save')}
      </button>
    </div>
  )
}

// ── BAR section ───────────────────────────────────────────────────────────────

type BarSubTab = 'tabs' | 'products' | 'utilities' | 'invoices' | 'config'

function BarSection() {
  const { t } = useTranslation()
  const [sub, setSub] = useState<BarSubTab>('tabs')
  const BAR_TABS: { key: BarSubTab; label: string }[] = [
    { key: 'tabs', label: t('ent.tabTabs') },
    { key: 'products', label: t('ent.tabProducts') },
    { key: 'utilities', label: t('ent.tabUtilities') },
    { key: 'invoices', label: t('ent.tabInvoices') },
    { key: 'config', label: t('ent.tabConfig') },
  ]
  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-slate-700/60 px-4">
        {BAR_TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setSub(key)} className={`py-2 px-3 text-sm font-medium border-b-2 -mb-px transition-colors ${sub === key ? 'border-orange-500 text-orange-400' : 'border-transparent text-slate-400 hover:text-white'}`}>{label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {sub === 'tabs'      && <BarTabs defaultVenue="BAR" />}
        {sub === 'products'  && <div className="h-full overflow-y-auto"><BarProducts /></div>}
        {sub === 'utilities' && <div className="h-full overflow-y-auto"><UtilitiesPanel prefix="bar" /></div>}
        {sub === 'invoices'  && <div className="h-full overflow-y-auto"><InvoicePanel prefix="bar" /></div>}
        {sub === 'config'    && <div className="h-full overflow-y-auto"><BarConfig /></div>}
      </div>
    </div>
  )
}

// ── CLUB: Members ─────────────────────────────────────────────────────────────

function ClubMembers() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<MemberDetail | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ first_name: '', last_name: '', email: '', phone: '', crm_contact_id: null as string | null })
  const [creditForm, setCreditForm] = useState({ amount: '', description: '' })
  const [addErr, setAddErr] = useState<string | null>(null)
  const [creditErr, setCreditErr] = useState<string | null>(null)

  const { data: members = [] } = useQuery({
    queryKey: ['club-members', search, statusFilter],
    queryFn: () => clubMembersApi.list({ search: search || undefined, status: statusFilter || undefined }),
  })

  const { data: credits } = useQuery({
    queryKey: ['club-credits', selected?.id],
    queryFn: () => clubMembersApi.getCredits(selected!.id),
    enabled: !!selected,
  })

  const { data: tiers = [] } = useQuery({ queryKey: ['club-tiers'], queryFn: () => clubTiersApi.list() })

  const createMut = useMutation({
    mutationFn: () => clubMembersApi.create({ first_name: addForm.first_name, last_name: addForm.last_name, email: addForm.email || undefined, phone: addForm.phone || undefined, crm_contact_id: addForm.crm_contact_id || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['club-members'] }); setShowAdd(false); setAddForm({ first_name: '', last_name: '', email: '', phone: '', crm_contact_id: null }) },
    onError: (e: Error) => setAddErr(e.message),
  })

  const addCreditMut = useMutation({
    mutationFn: () => clubMembersApi.addCredit(selected!.id, { amount: parseFloat(creditForm.amount), description: creditForm.description, idempotency_key: uuidv4() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['club-credits', selected?.id] }); qc.invalidateQueries({ queryKey: ['club-members'] }); setCreditForm({ amount: '', description: '' }) },
    onError: (e: Error) => setCreditErr(e.message),
  })

  const subscribeMut = useMutation({
    mutationFn: (tierId: string) => clubMembersApi.subscribe(selected!.id, { tier_id: tierId, started_at: new Date().toISOString().slice(0, 10), idempotency_key: uuidv4() }),
    onSuccess: (ms) => {
      qc.invalidateQueries({ queryKey: ['club-members'] })
      if (selected) {
        const tier = (tiers as Tier[]).find(tr => tr.id === ms.tier_id)
        setSelected({ ...selected, active_membership: { id: ms.id, started_at: ms.started_at, expires_at: ms.expires_at, status: ms.status, tier_id: ms.tier_id, tier_name: ms.tier_name, bar_discount_pct: ms.bar_discount_pct, guest_passes_per_month: tier?.guest_passes_per_month ?? 0, monthly_fee: tier?.monthly_fee ?? 0 } })
      }
    },
  })

  const crmLinkMut = useMutation({
    mutationFn: (id: string | null) => clubMembersApi.update(selected!.id, { crm_contact_id: id }),
    onSuccess: (rec) => { qc.invalidateQueries({ queryKey: ['club-members'] }); setSelected(s => s ? { ...s, crm_contact_id: rec.crm_contact_id } : s) },
  })

  return (
    <div className="flex h-full">
      {/* List */}
      <div className={`flex flex-col ${selected ? 'hidden lg:flex lg:w-80 lg:shrink-0' : 'flex-1'}`}>
        <div className="px-3 py-2 border-b border-slate-700 space-y-2">
          <div className="flex gap-2">
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
            <button onClick={() => setShowAdd(s => !s)} className="px-3 py-1.5 rounded text-xs bg-orange-600 hover:bg-orange-500 text-white transition-colors">+ {t('common.add')}</button>
          </div>
          <div className="flex gap-1">
            {(['', 'ACTIVE', 'SUSPENDED', 'EXPIRED'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} className={`px-2 py-0.5 rounded text-xs transition-colors ${statusFilter === s ? 'bg-orange-700 text-white' : 'bg-slate-700 text-slate-300'}`}>{s || t('common.all')}</button>
            ))}
          </div>
        </div>

        {showAdd && (
          <div className="border-b border-slate-700 p-3 bg-slate-800 space-y-2">
            {[{ label: t('ent.firstNameStar'), key: 'first_name' }, { label: t('ent.lastNameStar'), key: 'last_name' }, { label: t('ent.email'), key: 'email' }, { label: t('ent.phone'), key: 'phone' }].map(({ label, key }) => (
              <div key={key}>
                <label className="block text-slate-400 text-xs mb-0.5">{label}</label>
                <input type="text" value={(addForm as Record<string, string>)[key]} onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
              </div>
            ))}
            <div>
              <label className="block text-slate-400 text-xs mb-0.5">{t('crm.linkedContact', 'CRM Contact')}</label>
              <CrmContactPicker value={addForm.crm_contact_id} onChange={id => setAddForm(f => ({ ...f, crm_contact_id: id }))} />
            </div>
            {addErr && <p className="text-red-400 text-xs">{addErr}</p>}
            <div className="flex gap-2">
              <button onClick={() => createMut.mutate()} disabled={createMut.isPending || !addForm.first_name || !addForm.last_name} className="flex-1 py-1.5 rounded text-xs bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors">{createMut.isPending ? t('common.saving') : t('ent.addMember')}</button>
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 rounded text-xs bg-slate-700 text-slate-300">{t('common.cancel')}</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-slate-700/50">
          {(members as Member[]).length === 0 && <p className="text-slate-500 text-sm text-center py-10">{t('ent.noMembers')}</p>}
          {(members as Member[]).map(m => (
            <button key={m.id} onClick={async () => { const d = await clubMembersApi.get(m.id); setSelected(d) }} className={`w-full text-left px-4 py-3 hover:bg-slate-700/40 transition-colors ${selected?.id === m.id ? 'bg-slate-700/60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-white text-sm font-medium">{m.first_name} {m.last_name}</p>
                  <p className="text-slate-400 text-xs">{m.member_number} · {m.email ?? m.phone ?? '—'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-white text-sm">{fmtM(m.credit_balance)}</p>
                  <span className={`text-xs ${m.status === 'ACTIVE' ? 'text-green-400' : m.status === 'SUSPENDED' ? 'text-red-400' : 'text-slate-400'}`}>{m.status}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail */}
      {selected && (
        <div className="flex-1 border-l border-slate-700 bg-slate-800/50 overflow-y-auto">
          <div className="p-5 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-white font-semibold">{selected.first_name} {selected.last_name}</h2>
                <p className="text-slate-400 text-sm">{selected.member_number} · {selected.status}</p>
                <p className="text-white font-medium mt-1">{t('ent.balance')} {fmtM(selected.credit_balance)}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-white text-xl">&times;</button>
            </div>

            {/* CRM contact link */}
            <div className="bg-slate-700/40 rounded-lg p-3 space-y-2">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{t('crm.linkedContact', 'CRM Contact')}</p>
              {selected.crm_contact_id
                ? <CrmContactBadge contactId={selected.crm_contact_id} />
                : <p className="text-slate-500 text-xs">{t('crm.noContactLinked', 'No CRM contact linked.')}</p>}
              <CrmContactPicker
                value={selected.crm_contact_id}
                onChange={id => crmLinkMut.mutate(id)}
              />
            </div>

            {/* Active membership */}
            {selected.active_membership ? (
              <div className="bg-slate-700/40 rounded-lg p-3">
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-2">{t('ent.activeMembership')}</p>
                <p className="text-white text-sm font-medium">{selected.active_membership.tier_name}</p>
                <p className="text-slate-400 text-xs">{fmtDate(selected.active_membership.started_at)} → {fmtDate(selected.active_membership.expires_at)} · {t('ent.barDiscount', { pct: selected.active_membership.bar_discount_pct })}</p>
              </div>
            ) : (
              <div className="bg-slate-700/40 rounded-lg p-3">
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-2">{t('ent.subscribeToTier')}</p>
                <div className="flex gap-2 flex-wrap">
                  {(tiers as Tier[]).map(t => (
                    <button key={t.id} onClick={() => subscribeMut.mutate(t.id)} disabled={subscribeMut.isPending} className="px-3 py-1.5 rounded text-xs bg-orange-700 hover:bg-orange-600 text-white disabled:opacity-50 transition-colors">{t.name} — {fmtM(t.monthly_fee)}/mo</button>
                  ))}
                </div>
              </div>
            )}

            {/* Credit top-up */}
            <div className="bg-slate-700/40 rounded-lg p-3 space-y-2">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{t('ent.addCredit')}</p>
              <div className="flex gap-2">
                <input type="number" value={creditForm.amount} onChange={e => setCreditForm(f => ({ ...f, amount: e.target.value }))} placeholder={t('common.amount')} step="0.01" className="w-32 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
                <input type="text" value={creditForm.description} onChange={e => setCreditForm(f => ({ ...f, description: e.target.value }))} placeholder={t('common.description')} className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
              </div>
              {creditErr && <p className="text-red-400 text-xs">{creditErr}</p>}
              <button onClick={() => addCreditMut.mutate()} disabled={addCreditMut.isPending || !creditForm.amount || !creditForm.description} className="px-4 py-1.5 rounded text-xs bg-green-700 hover:bg-green-600 text-white disabled:opacity-50 transition-colors">{addCreditMut.isPending ? t('common.saving') : t('ent.addCredit')}</button>
            </div>

            {/* Credit ledger */}
            {credits && (
              <div>
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-2">{t('ent.creditHistory')}</p>
                <div className="space-y-1">
                  {credits.ledger.map(entry => (
                    <div key={entry.id} className="flex justify-between text-sm">
                      <span className="text-slate-300 truncate">{entry.description}</span>
                      <span className={entry.amount >= 0 ? 'text-green-400 shrink-0 ml-2' : 'text-red-400 shrink-0 ml-2'}>{entry.amount >= 0 ? '+' : ''}{fmtM(entry.amount)}</span>
                    </div>
                  ))}
                  {credits.ledger.length === 0 && <p className="text-slate-500 text-sm">{t('ent.noHistory')}</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── CLUB: Events ──────────────────────────────────────────────────────────────

function ClubEvents() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<ClubEvent | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ title: '', venue: 'CLUB' as 'BAR' | 'CLUB' | 'BOTH', starts_at: '', ends_at: '', capacity: '', ticket_price: '', member_price: '' })
  const [err, setErr] = useState<string | null>(null)

  const { data: events = [] } = useQuery({ queryKey: ['club-events'], queryFn: () => clubEventsApi.list({ upcoming: true }) })
  const { data: detail } = useQuery({ queryKey: ['club-event', selected?.id], queryFn: () => clubEventsApi.get(selected!.id), enabled: !!selected })

  const createMut = useMutation({
    mutationFn: () => clubEventsApi.create({ title: form.title, venue: form.venue, starts_at: new Date(form.starts_at).toISOString(), ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : undefined, capacity: form.capacity ? parseInt(form.capacity) : undefined, ticket_price: form.ticket_price ? parseFloat(form.ticket_price) : undefined, member_price: form.member_price ? parseFloat(form.member_price) : undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['club-events'] }); setShowAdd(false) },
    onError: (e: Error) => setErr(e.message),
  })

  return (
    <div className="flex h-full">
      <div className={`flex flex-col ${selected ? 'hidden lg:flex lg:w-80 lg:shrink-0' : 'flex-1'}`}>
        <div className="px-3 py-2 border-b border-slate-700 flex justify-between">
          <p className="text-slate-300 text-sm font-medium">{t('ent.upcomingEvents')}</p>
          <button onClick={() => setShowAdd(s => !s)} className="px-3 py-1 rounded text-xs bg-orange-600 hover:bg-orange-500 text-white transition-colors">+ {t('common.add')}</button>
        </div>
        {showAdd && (
          <div className="border-b border-slate-700 p-3 bg-slate-800 space-y-2">
            <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder={t('ent.eventTitleStar')} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
            <select value={form.venue} onChange={e => setForm(f => ({ ...f, venue: e.target.value as 'BAR' | 'CLUB' | 'BOTH' }))} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm">
              {['BAR', 'CLUB', 'BOTH'].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <input type="datetime-local" value={form.starts_at} onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
            <div className="flex gap-2">
              <input type="number" value={form.ticket_price} onChange={e => setForm(f => ({ ...f, ticket_price: e.target.value }))} placeholder={t('ent.ticketPrice')} className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
              <input type="number" value={form.member_price} onChange={e => setForm(f => ({ ...f, member_price: e.target.value }))} placeholder={t('ent.memberPrice')} className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
            </div>
            {err && <p className="text-red-400 text-xs">{err}</p>}
            <button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.title || !form.starts_at} className="w-full py-1.5 rounded text-xs bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors">{createMut.isPending ? t('common.saving') : t('common.create')}</button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-700/50">
          {(events as ClubEvent[]).length === 0 && <p className="text-slate-500 text-sm text-center py-10">{t('ent.noUpcomingEvents')}</p>}
          {(events as ClubEvent[]).map(ev => (
            <button key={ev.id} onClick={() => setSelected(ev)} className={`w-full text-left px-4 py-3 hover:bg-slate-700/40 transition-colors ${selected?.id === ev.id ? 'bg-slate-700/60' : ''}`}>
              <p className="text-white text-sm font-medium">{ev.title}</p>
              <p className="text-slate-400 text-xs mt-0.5">{fmtDT(ev.starts_at)} · {ev.venue}</p>
              <p className="text-slate-500 text-xs">{t('ent.confirmedCount', { count: `${ev.confirmed_bookings}${ev.capacity ? `/${ev.capacity}` : ''}` })}</p>
            </button>
          ))}
        </div>
      </div>

      {selected && detail && (
        <div className="flex-1 border-l border-slate-700 bg-slate-800/50 overflow-y-auto p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-white font-semibold">{detail.title}</h2>
              <p className="text-slate-400 text-sm">{fmtDT(detail.starts_at)}{detail.ends_at ? ` — ${fmtDT(detail.ends_at)}` : ''} · {detail.venue}</p>
              <p className="text-slate-400 text-sm">{t('ent.confirmedCount', { count: `${detail.confirmed_bookings}${detail.capacity ? `/${detail.capacity}` : ''}` })} · {detail.waitlisted_bookings} {t('ent.waitlisted')}</p>
            </div>
            <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-white text-xl">&times;</button>
          </div>
          <div>
            <p className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-2">{t('ent.bookings')}</p>
            {detail.bookings.length === 0 && <p className="text-slate-500 text-sm">{t('ent.noBookings')}</p>}
            <div className="space-y-1">
              {detail.bookings.map(b => (
                <div key={b.id} className="flex items-center justify-between text-sm">
                  <span className="text-white">{b.member_name}</span>
                  <div className="flex items-center gap-2 text-slate-400 text-xs">
                    <span>{b.guests > 0 ? t('ent.guestPlus', { n: b.guests }) : ''}</span>
                    <span>{fmtM(b.amount_paid)}</span>
                    <span className={b.status === 'CONFIRMED' ? 'text-green-400' : b.status === 'WAITLISTED' ? 'text-yellow-400' : 'text-slate-500'}>{b.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── CLUB: Visitor Log ─────────────────────────────────────────────────────────

function ClubVisitorLog() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ visitor_name: '', id_type: 'NATIONAL_ID' as IdType, id_number: '', address: '', notes: '' })
  const [err, setErr] = useState<string | null>(null)

  const { data: log = [] } = useQuery({ queryKey: ['club-visitor-log', date], queryFn: () => clubVisitorApi.list({ date }) })

  const logInMut = useMutation({
    mutationFn: () => clubVisitorApi.logIn({ visitor_name: form.visitor_name, id_type: form.id_type, id_number: form.id_number, address: form.address, notes: form.notes || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['club-visitor-log'] }); setShowAdd(false); setForm({ visitor_name: '', id_type: 'NATIONAL_ID', id_number: '', address: '', notes: '' }) },
    onError: (e: Error) => setErr(e.message),
  })

  const checkOutMut = useMutation({
    mutationFn: (id: string) => clubVisitorApi.checkOut(id, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['club-visitor-log'] }),
  })

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-slate-400 text-xs">{t('ent.dateLabel')}</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
        </div>
        <button onClick={() => setShowAdd(s => !s)} className="px-3 py-1.5 rounded text-xs bg-orange-600 hover:bg-orange-500 text-white transition-colors">{t('ent.logVisitor')}</button>
      </div>

      {showAdd && (
        <div className="bg-slate-700/50 rounded-lg p-4 space-y-3">
          {[
            { label: t('ent.visitorNameStar'), key: 'visitor_name', type: 'text' },
            { label: t('ent.idNumberStar'), key: 'id_number', type: 'text' },
            { label: t('ent.addressStar'), key: 'address', type: 'text' },
            { label: t('common.notes'), key: 'notes', type: 'text' },
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label className="block text-slate-400 text-xs mb-1">{label}</label>
              <input type={type} value={(form as Record<string, string>)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
            </div>
          ))}
          <div>
            <label className="block text-slate-400 text-xs mb-1">{t('ent.idType')}</label>
            <select value={form.id_type} onChange={e => setForm(f => ({ ...f, id_type: e.target.value as IdType }))} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm">
              {(['NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE', 'OTHER'] as IdType[]).map(it => <option key={it} value={it}>{it.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <button onClick={() => logInMut.mutate()} disabled={logInMut.isPending || !form.visitor_name || !form.id_number || !form.address} className="px-4 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors">{logInMut.isPending ? t('ent.logging') : t('ent.logIn')}</button>
        </div>
      )}

      <div className="space-y-2">
        {(log as VisitorLog[]).length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t('ent.noVisitors')}</p>}
        {(log as VisitorLog[]).map(v => (
          <div key={v.id} className="bg-slate-700/40 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-white text-sm font-medium">{v.visitor_name}</p>
              <p className="text-slate-400 text-xs">{v.id_type.replace(/_/g, ' ')} · {v.id_number}</p>
              <p className="text-slate-500 text-xs">{t('ent.timeIn', { time: fmtTime(v.time_in) })}{v.time_out ? ` · ${t('ent.timeOut', { time: fmtTime(v.time_out) })}` : ''}{v.member_name ? ` · ${t('ent.sponsor', { name: v.member_name })}` : ''}</p>
            </div>
            {!v.time_out && (
              <button onClick={() => checkOutMut.mutate(v.id)} className="px-2.5 py-1 rounded text-xs bg-slate-600 hover:bg-slate-500 text-white transition-colors">{t('ent.checkOut')}</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── CLUB: Chip Float ──────────────────────────────────────────────────────────

function ClubChipFloat() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)
  const [showOpen, setShowOpen] = useState(false)
  const [openForm, setOpenForm] = useState({ float_date: today, opening_cash: '', opening_chips: '', notes: '' })
  const [closeForm, setCloseForm] = useState({ closing_cash: '', closing_chips: '', notes: '' })
  const [closingId, setClosingId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const { data: floats = [] } = useQuery({ queryKey: ['club-floats'], queryFn: clubFloatApi.list })

  const openMut = useMutation({
    mutationFn: () => clubFloatApi.open({ float_date: openForm.float_date, opening_cash: parseFloat(openForm.opening_cash), opening_chips: parseFloat(openForm.opening_chips), notes: openForm.notes || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['club-floats'] }); setShowOpen(false) },
    onError: (e: Error) => setErr(e.message),
  })

  const closeMut = useMutation({
    mutationFn: () => clubFloatApi.close(closingId!, { closing_cash: parseFloat(closeForm.closing_cash), closing_chips: parseFloat(closeForm.closing_chips), notes: closeForm.notes || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['club-floats'] }); setClosingId(null) },
    onError: (e: Error) => setErr(e.message),
  })

  const openFloat = (floats as ChipFloat[]).find(f => f.status === 'OPEN')

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-medium">{t('ent.chipFloat')}</h3>
        {!openFloat && <button onClick={() => setShowOpen(s => !s)} className="px-3 py-1.5 rounded text-xs bg-orange-600 hover:bg-orange-500 text-white transition-colors">{t('ent.openFloat')}</button>}
      </div>

      {showOpen && (
        <div className="bg-slate-700/50 rounded-lg p-4 space-y-3">
          {[
            { label: t('common.date'), key: 'float_date', type: 'date' },
            { label: t('ent.openingCashStar'), key: 'opening_cash', type: 'number' },
            { label: t('ent.openingChipsStar'), key: 'opening_chips', type: 'number' },
            { label: t('common.notes'), key: 'notes', type: 'text' },
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label className="block text-slate-400 text-xs mb-1">{label}</label>
              <input type={type} value={(openForm as Record<string, string>)[key]} onChange={e => setOpenForm(f => ({ ...f, [key]: e.target.value }))} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
            </div>
          ))}
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <button onClick={() => openMut.mutate()} disabled={openMut.isPending || !openForm.opening_cash} className="px-4 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors">{openMut.isPending ? t('ent.opening') : t('ent.open')}</button>
        </div>
      )}

      {closingId && (
        <div className="bg-slate-700/50 rounded-lg p-4 space-y-3">
          <p className="text-white text-sm font-medium">{t('ent.closeFloat')}</p>
          {[
            { label: t('ent.closingCashStar'), key: 'closing_cash', type: 'number' },
            { label: t('ent.closingChipsStar'), key: 'closing_chips', type: 'number' },
            { label: t('common.notes'), key: 'notes', type: 'text' },
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label className="block text-slate-400 text-xs mb-1">{label}</label>
              <input type={type} value={(closeForm as Record<string, string>)[key]} onChange={e => setCloseForm(f => ({ ...f, [key]: e.target.value }))} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm" />
            </div>
          ))}
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <div className="flex gap-2">
            <button onClick={() => closeMut.mutate()} disabled={closeMut.isPending || !closeForm.closing_cash} className="flex-1 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors">{closeMut.isPending ? t('ent.closingEllipsis') : t('ent.closeFloat')}</button>
            <button onClick={() => setClosingId(null)} className="px-4 py-2 rounded text-sm bg-slate-700 text-slate-300 hover:text-white transition-colors">{t('common.cancel')}</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {(floats as ChipFloat[]).length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t('ent.noFloats')}</p>}
        {(floats as ChipFloat[]).map(f => (
          <div key={f.id} className="bg-slate-700/40 rounded-lg px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-medium">{fmtDate(f.float_date)}</p>
                <p className="text-slate-400 text-xs">{t('ent.cashInLabel', { open: f.opening_cash, close: f.closing_cash ?? '?' })} · {t('ent.chipsLabel', { open: f.opening_chips, close: f.closing_chips ?? '?' })}</p>
                {f.status === 'CLOSED' && (
                  <p className={`text-xs mt-0.5 ${(f.cash_variance ?? 0) !== 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {t('ent.cashVariance', { v: fmtM(f.cash_variance) })} · {t('ent.chipVariance', { v: fmtM(f.chips_variance) })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`px-2 py-0.5 rounded text-xs ${f.status === 'OPEN' ? 'bg-green-900/50 text-green-300' : 'bg-slate-700 text-slate-400'}`}>{f.status}</span>
                {f.status === 'OPEN' && <button onClick={() => setClosingId(f.id)} className="px-2.5 py-1 rounded text-xs bg-orange-700 hover:bg-orange-600 text-white transition-colors">{t('ent.closeBtn')}</button>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── CLUB section ──────────────────────────────────────────────────────────────

type ClubSubTab = 'members' | 'events' | 'visitor-log' | 'float' | 'utilities' | 'invoices'

function ClubSection() {
  const { t } = useTranslation()
  const [sub, setSub] = useState<ClubSubTab>('members')
  const CLUB_TABS: { key: ClubSubTab; label: string }[] = [
    { key: 'members', label: t('ent.tabMembers') },
    { key: 'events', label: t('ent.tabEvents') },
    { key: 'visitor-log', label: t('ent.tabVisitorLog') },
    { key: 'float', label: t('ent.tabFloat') },
    { key: 'utilities', label: t('ent.tabUtilities') },
    { key: 'invoices', label: t('ent.tabInvoices') },
  ]
  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-slate-700/60 px-4 overflow-x-auto">
        {CLUB_TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setSub(key)} className={`py-2 px-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${sub === key ? 'border-orange-500 text-orange-400' : 'border-transparent text-slate-400 hover:text-white'}`}>{label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {sub === 'members'     && <ClubMembers />}
        {sub === 'events'      && <ClubEvents />}
        {sub === 'visitor-log' && <div className="h-full overflow-y-auto"><ClubVisitorLog /></div>}
        {sub === 'float'       && <div className="h-full overflow-y-auto"><ClubChipFloat /></div>}
        {sub === 'utilities'   && <div className="h-full overflow-y-auto"><UtilitiesPanel prefix="club" /></div>}
        {sub === 'invoices'    && <div className="h-full overflow-y-auto"><InvoicePanel prefix="club" /></div>}
      </div>
    </div>
  )
}

// ── P&L Report ────────────────────────────────────────────────────────────────

function PLReportSection() {
  const { t } = useTranslation()
  const [venue, setVenue] = useState<Venue>('BAR')
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10) })
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [trigger, setTrigger] = useState(0)

  const { data: report, isLoading, error } = useQuery({
    queryKey: ['ent-pl', venue, from, to, trigger],
    queryFn: () => entertainmentReportsApi.pl({ venue, from, to }),
    enabled: trigger > 0,
  })

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-slate-400 text-xs mb-1">{t('ent.venue')}</label>
          <select value={venue} onChange={e => setVenue(e.target.value as Venue)} className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm">
            <option value="BAR">BAR</option>
            <option value="CLUB">CLUB</option>
          </select>
        </div>
        <div>
          <label className="block text-slate-400 text-xs mb-1">{t('common.from')}</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm" />
        </div>
        <div>
          <label className="block text-slate-400 text-xs mb-1">{t('common.to')}</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm" />
        </div>
        <button onClick={() => setTrigger(n => n + 1)} disabled={isLoading} className="px-4 py-2 rounded text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors">{isLoading ? t('common.loading') : t('ent.runReport')}</button>
      </div>

      {error && <p className="text-red-400 text-sm">{(error as Error).message}</p>}

      {report && (
        <div className="space-y-4">
          <h3 className="text-white font-semibold">{report.venue} · {fmtDate(report.period.from)} — {fmtDate(report.period.to)}</h3>

          <div className="bg-slate-700/40 rounded-lg p-4 space-y-2">
            <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{t('ent.revenue')}</p>
            {([
              ['tabs', t('ent.tabsLabel'), t('ent.tabCount', { count: report.revenue.tab_count })],
              ['subtotal', t('ent.subtotal'), fmtM(report.revenue.subtotal)],
              ['discounts', t('ent.discounts'), `(${fmtM(report.revenue.discount_total)})`],
              ['serviceCharge', t('ent.serviceCharge'), fmtM(report.revenue.service_charge_total)],
              ['vat', t('ent.vat'), fmtM(report.revenue.vat_total)],
            ] as [string, string, string][]).map(([key, label, value]) => (
              <div key={key} className="flex justify-between text-sm">
                <span className="text-slate-400">{label}</span>
                <span className="text-white">{value}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-semibold border-t border-slate-600 pt-2 mt-2">
              <span className="text-white">{t('ent.totalRevenue')}</span>
              <span className="text-green-400">{fmtM(report.revenue.total)}</span>
            </div>
          </div>

          <div className="bg-slate-700/40 rounded-lg p-4 space-y-2">
            <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{t('ent.expenses')}</p>
            {([
              ['utilities', t('ent.utilitiesCount', { count: report.expenses.utilities.count }), fmtM(report.expenses.utilities.gross)],
              ['invoices', t('ent.supplierInvoicesCount', { count: report.expenses.supplier_invoices.count }), fmtM(report.expenses.supplier_invoices.gross)],
            ] as [string, string, string][]).map(([key, label, value]) => (
              <div key={key} className="flex justify-between text-sm">
                <span className="text-slate-400">{label}</span>
                <span className="text-white">{value}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-semibold border-t border-slate-600 pt-2 mt-2">
              <span className="text-white">{t('ent.totalExpenses')}</span>
              <span className="text-red-400">{fmtM(report.expenses.total)}</span>
            </div>
          </div>

          <div className={`rounded-lg p-4 flex justify-between items-center ${report.net_pl >= 0 ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}>
            <span className="text-white font-semibold">{t('ent.netPL')}</span>
            <span className={`text-xl font-bold ${report.net_pl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtM(report.net_pl)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type TopTab = 'bar' | 'club' | 'pl'

export default function Entertainment() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<TopTab>('bar')

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="px-6 py-4 border-b border-slate-700">
        <h1 className="text-xl font-semibold text-white">{t('ent.title')}</h1>
        <p className="text-slate-400 text-sm mt-0.5">{t('ent.subtitle')}</p>
      </div>

      <div className="flex border-b border-slate-700 px-6">
        {([
          { key: 'bar', label: t('ent.tabBar') },
          { key: 'club', label: t('ent.tabClub') },
          { key: 'pl', label: t('ent.tabPL') },
        ] as { key: TopTab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)} className={`py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === key ? 'border-orange-500 text-orange-400' : 'border-transparent text-slate-400 hover:text-white'}`}>{label}</button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'bar'  && <BarSection />}
        {tab === 'club' && <ClubSection />}
        {tab === 'pl'   && <div className="h-full overflow-y-auto"><PLReportSection /></div>}
      </div>
    </div>
  )
}
