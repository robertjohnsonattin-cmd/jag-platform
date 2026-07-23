import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { imsApi } from '../api/ims'
import type { Supplier, PurchaseOrder, PurchaseOrderDetail, POLine, POStatus } from '../types/ims'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (d: string | null) => {
  if (!d) return '—'
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' })
}
const fmtMoney = (v: number | string) =>
  `TTD ${new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2 }).format(Number(v))}`

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-orange-500'

const STATUS_STYLES: Record<POStatus, string> = {
  DRAFT:      'bg-slate-700   text-slate-300  border border-slate-600',
  SUBMITTED:  'bg-blue-900/50 text-blue-300   border border-blue-700',
  PARTIAL:    'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
  RECEIVED:   'bg-green-900/50 text-green-300  border border-green-700',
  CANCELLED:  'bg-red-900/50  text-red-400    border border-red-800',
}

// ── Add Supplier Modal ────────────────────────────────────────────────────────

function AddSupplierModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: '', contact_name: '', phone: '', email: '',
    address: '', payment_terms_days: '30', notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => imsApi.createSupplier({
      name: form.name,
      contact_name: form.contact_name || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      address: form.address || undefined,
      payment_terms_days: form.payment_terms_days ? Number(form.payment_terms_days) : undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ims-suppliers'] }); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('purchasing.addSupplier')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('purchasing.supplierNameStar')}</label>
            <input value={form.name} onChange={set('name')} className={cls} autoFocus />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('purchasing.contactName')}</label>
              <input value={form.contact_name} onChange={set('contact_name')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('crm.phone')}</label>
              <input value={form.phone} onChange={set('phone')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('crm.email')}</label>
              <input type="email" value={form.email} onChange={set('email')} className={cls} />
            </div>
            <div className="w-28">
              <label className="block text-xs text-slate-400 mb-1">{t('purchasing.paymentTermsDays')}</label>
              <input type="number" min="0" value={form.payment_terms_days} onChange={set('payment_terms_days')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('purchasing.address')}</label>
            <textarea value={form.address} onChange={set('address')} rows={2} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.name}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('purchasing.addSupplier')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Create PO Modal ───────────────────────────────────────────────────────────

function CreatePOModal({ suppliers, onClose }: { suppliers: Supplier[]; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: items } = useQuery({ queryKey: ['ims-items-all'], queryFn: () => imsApi.getItems({ limit: 100 }) })

  const [form, setForm] = useState({ supplier_id: '', order_date: '', expected_delivery_date: '', notes: '' })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const emptyLine = () => ({ item_id: '', description: '', quantity_ordered: '1', unit_cost: '' })
  const [lines, setLines] = useState([emptyLine()])

  const setLine = (i: number, k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, [k]: e.target.value } : l))
  }

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => imsApi.createPurchaseOrder({
      supplier_id: form.supplier_id,
      order_date: form.order_date || undefined,
      expected_delivery_date: form.expected_delivery_date || undefined,
      notes: form.notes || undefined,
      lines: lines
        .filter(l => l.item_id || l.description)
        .map(l => ({
          item_id: l.item_id || undefined,
          description: !l.item_id ? l.description : undefined,
          quantity_ordered: Number(l.quantity_ordered),
          unit_cost: l.unit_cost ? Number(l.unit_cost) : undefined,
        })),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ims-pos'] }); onClose() },
  })

  const allItems = items?.items ?? []

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('purchasing.createPO')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('purchasing.supplierStar')}</label>
              <select value={form.supplier_id} onChange={set('supplier_id')} className={cls}>
                <option value="">— select supplier —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('purchasing.orderDate')}</label>
              <input type="date" value={form.order_date} onChange={set('order_date')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('purchasing.expectedDelivery')}</label>
              <input type="date" value={form.expected_delivery_date} onChange={set('expected_delivery_date')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>

          {/* Lines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-slate-400 font-medium">{t('purchasing.linesStar')}</label>
              <button onClick={() => setLines(ls => [...ls, emptyLine()])}
                className="text-xs text-orange-400 hover:text-orange-300 transition-colors">{t('purchasing.addLine')}</button>
            </div>
            <div className="space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="bg-slate-700/50 rounded-lg p-3 space-y-2">
                  <div className="flex gap-2 items-start">
                    <div className="flex-1">
                      <label className="block text-xs text-slate-500 mb-1">{t('purchasing.itemCatalogue')}</label>
                      <select value={line.item_id} onChange={setLine(i, 'item_id')} className={cls}>
                        <option value="">— or enter description below —</option>
                        {allItems.map(it => (
                          <option key={it.id} value={it.id}>{it.name}{it.sku ? ` (${it.sku})` : ''}</option>
                        ))}
                      </select>
                    </div>
                    {lines.length > 1 && (
                      <button onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))}
                        className="mt-5 text-slate-500 hover:text-red-400 transition-colors text-lg leading-none">&times;</button>
                    )}
                  </div>
                  {!line.item_id && (
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">{t('purchasing.descriptionNote')}</label>
                      <input value={line.description} onChange={setLine(i, 'description')} className={cls} placeholder="e.g. 3/4 inch PVC pipe" />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <div className="w-28">
                      <label className="block text-xs text-slate-500 mb-1">{t('purchasing.qtyStar')}</label>
                      <input type="number" min="0.0001" step="0.01" value={line.quantity_ordered} onChange={setLine(i, 'quantity_ordered')} className={cls} />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-slate-500 mb-1">{t('purchasing.unitCostTTD')}</label>
                      <input type="number" min="0" step="0.01" value={line.unit_cost} onChange={setLine(i, 'unit_cost')} className={cls} placeholder="optional" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => mutate()}
            disabled={isPending || !form.supplier_id || !lines.some(l => l.item_id || l.description)}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('purchasing.creatingEllipsis') : t('purchasing.createPOBtn')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Receive PO Modal ──────────────────────────────────────────────────────────

function ReceivePOModal({ po, onClose }: { po: PurchaseOrderDetail; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: locations } = useQuery({ queryKey: ['ims-locations'], queryFn: imsApi.getLocations })
  const [locationId, setLocationId] = useState('')
  const [notes, setNotes] = useState('')
  const [qtys, setQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(po.lines.map(l => [l.id, String(Math.max(0, l.quantity_ordered - l.quantity_received))]))
  )

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => imsApi.receivePO(po.id, {
      lines: po.lines
        .filter(l => Number(qtys[l.id] ?? 0) > 0)
        .map(l => ({ line_id: l.id, quantity_received: Number(qtys[l.id]) })),
      receive_location_id: locationId,
      idempotency_key: uuidv4(),
      notes: notes || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ims-pos'] })
      qc.invalidateQueries({ queryKey: ['ims-po', po.id] })
      qc.invalidateQueries({ queryKey: ['ims-items'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-1 text-white">{t('purchasing.receiveGoods')}</h2>
        <p className="text-slate-400 text-sm mb-4">{po.po_number} · {po.supplier_name}</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('purchasing.deliverToLocation')}</label>
            <select value={locationId} onChange={e => setLocationId(e.target.value)} className={cls}>
              <option value="">— select location —</option>
              {(locations ?? []).map(l => <option key={l.id} value={l.id}>[{l.code}] {l.name}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-slate-400 font-medium">{t('purchasing.qtysReceived')}</p>
            {po.lines.map(line => {
              const remaining = line.quantity_ordered - line.quantity_received
              return (
                <div key={line.id} className="bg-slate-700/50 rounded-lg px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white text-sm truncate">{line.item_name ?? line.description}</p>
                      <p className="text-slate-500 text-xs">
                        {t('purchasing.orderedLabel')}: {line.quantity_ordered} · {t('purchasing.receivedSoFar')}: {line.quantity_received} · {t('purchasing.remainingLabel')}: {remaining}
                      </p>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max={remaining}
                      step="0.01"
                      value={qtys[line.id] ?? ''}
                      onChange={e => setQtys(q => ({ ...q, [line.id]: e.target.value }))}
                      className="w-24 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white text-right shrink-0"
                      disabled={remaining <= 0}
                    />
                  </div>
                  {!line.item_id && (
                    <p className="text-xs text-yellow-600 mt-1">{t('purchasing.nonCatalogueWarn')}</p>
                  )}
                </div>
              )
            })}
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={cls} />
          </div>

          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>

        <div className="flex gap-3 mt-5">
          <button
            onClick={() => mutate()}
            disabled={isPending || !locationId || !po.lines.some(l => Number(qtys[l.id] ?? 0) > 0)}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('purchasing.confirmReceipt')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── PO Detail Panel ───────────────────────────────────────────────────────────

function PODetailPanel({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [receiveModal, setReceiveModal] = useState(false)

  const { data: detail } = useQuery({
    queryKey: ['ims-po', po.id],
    queryFn: () => imsApi.getPurchaseOrder(po.id),
  })

  const { mutate: updateStatus } = useMutation({
    mutationFn: (status: 'SUBMITTED' | 'CANCELLED') => imsApi.updatePOStatus(po.id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ims-pos'] })
      qc.invalidateQueries({ queryKey: ['ims-po', po.id] })
    },
  })

  const d = detail ?? po as unknown as PurchaseOrderDetail
  const lines: POLine[] = (d as PurchaseOrderDetail).lines ?? []

  const totalCost = lines.reduce((sum, l) => sum + (l.unit_cost ?? 0) * l.quantity_ordered, 0)
  const canSubmit   = d.status === 'DRAFT'
  const canReceive  = d.status === 'SUBMITTED' || d.status === 'PARTIAL'
  const canCancel   = d.status === 'DRAFT' || d.status === 'SUBMITTED'

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-white font-semibold">{d.po_number}</h2>
            <p className="text-slate-400 text-sm mt-0.5">{d.supplier_name}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canSubmit  && <button onClick={() => updateStatus('SUBMITTED')} className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors">{t('purchasing.submitPO')}</button>}
            {canReceive && <button onClick={() => setReceiveModal(true)} className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded transition-colors">{t('purchasing.receivePO')}</button>}
            {canCancel  && <button onClick={() => updateStatus('CANCELLED')} className="px-3 py-1.5 text-xs bg-red-800 hover:bg-red-700 text-white rounded transition-colors">{t('purchasing.cancelPO')}</button>}
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
          </div>
        </div>

        {/* Meta */}
        <div className="px-5 py-3 border-b border-slate-700 flex flex-wrap gap-4 text-xs text-slate-400">
          <div><span className="text-slate-500">{t('purchasing.statusLabel')}:</span> <span className={`px-2 py-0.5 rounded-full ${STATUS_STYLES[d.status as POStatus]}`}>{d.status}</span></div>
          <div><span className="text-slate-500">{t('purchasing.orderDateLabel')}:</span> {fmtDate(d.order_date)}</div>
          <div><span className="text-slate-500">{t('purchasing.expectedLabel')}:</span> {fmtDate(d.expected_delivery_date)}</div>
          <div><span className="text-slate-500">{t('purchasing.totalLabel')}:</span> <span className="text-white font-medium">{fmtMoney(totalCost || po.total_cost)}</span></div>
        </div>

        {/* Lines */}
        <div className="flex-1 overflow-y-auto p-5">
          {d.notes && <p className="text-slate-400 text-sm mb-4 italic">{d.notes}</p>}

          {lines.length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t('common.loading')}</p>}

          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-slate-700">
                <th className="text-left py-1.5">{t('purchasing.colItemDescription')}</th>
                <th className="text-right py-1.5">{t('purchasing.colOrdered')}</th>
                <th className="text-right py-1.5">{t('purchasing.colReceived')}</th>
                <th className="text-right py-1.5">{t('purchasing.colUnitCost')}</th>
                <th className="text-right py-1.5">{t('purchasing.colLineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(line => {
                const remaining = line.quantity_ordered - line.quantity_received
                return (
                  <tr key={line.id} className="border-b border-slate-700/40">
                    <td className="py-2.5">
                      <p className="text-white">{line.item_name ?? line.description}</p>
                      {line.sku && <p className="text-slate-500 text-xs">{line.sku}</p>}
                      {!line.item_id && <p className="text-xs text-slate-500 italic">{t('purchasing.nonCatalogue')}</p>}
                    </td>
                    <td className="py-2.5 text-right text-slate-300">{line.quantity_ordered}<span className="text-slate-500 text-xs ml-1">{line.unit_of_measure ?? ''}</span></td>
                    <td className={`py-2.5 text-right font-medium ${remaining > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                      {line.quantity_received}
                    </td>
                    <td className="py-2.5 text-right text-slate-300">{line.unit_cost != null ? fmtMoney(line.unit_cost) : '—'}</td>
                    <td className="py-2.5 text-right text-slate-300">
                      {line.unit_cost != null ? fmtMoney(line.unit_cost * line.quantity_ordered) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {receiveModal && detail && (
        <ReceivePOModal po={detail} onClose={() => setReceiveModal(false)} />
      )}
    </>
  )
}

// ── Suppliers Tab ─────────────────────────────────────────────────────────────

function SuppliersTab() {
  const { t } = useTranslation()
  const [showAdd, setShowAdd] = useState(false)
  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ['ims-suppliers'],
    queryFn: imsApi.getSuppliers,
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <span className="text-slate-400 text-sm">{t('purchasing.supplierCount', { count: suppliers.length })}</span>
        <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-colors">{t('purchasing.addSupplierBtn')}</button>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>}
        {!isLoading && suppliers.length === 0 && (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">{t('purchasing.noSuppliers')}</div>
        )}
        {suppliers.length > 0 && (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700 sticky top-0 bg-slate-800">
              <tr>
                {[t('crm.colName'), t('purchasing.colContact'), t('crm.phone'), t('crm.email'), t('purchasing.colPaymentTerms')].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suppliers.map(s => (
                <tr key={s.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-2.5 text-white font-medium">{s.name}</td>
                  <td className="px-4 py-2.5 text-slate-300">{s.contact_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-300">{s.phone ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-300">{s.email ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-300">{s.payment_terms_days} {t('purchasing.days')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {showAdd && <AddSupplierModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}

// ── Purchase Orders Tab ───────────────────────────────────────────────────────

function PurchaseOrdersTab() {
  const { t } = useTranslation()
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<PurchaseOrder | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const { data: suppliers = [] } = useQuery({ queryKey: ['ims-suppliers'], queryFn: imsApi.getSuppliers })

  const { data, isLoading } = useQuery({
    queryKey: ['ims-pos', statusFilter, page],
    queryFn: () => imsApi.getPurchaseOrders({ status: statusFilter || undefined, page, limit: 25 }),
  })

  const pos = data?.purchase_orders ?? []
  const pagination = data?.pagination

  return (
    <div className="flex h-full gap-0">
      {/* List */}
      <div className={`flex flex-col min-w-0 ${selected ? 'hidden lg:flex lg:w-96 lg:shrink-0' : 'flex-1'}`}>
        <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-white text-xs"
          >
            <option value="">{t('purchasing.allStatuses')}</option>
            {(['DRAFT','SUBMITTED','PARTIAL','RECEIVED','CANCELLED'] as POStatus[]).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button onClick={() => setShowCreate(true)} className="ml-auto px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-colors">{t('purchasing.newPO')}</button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-700/50">
          {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>}
          {!isLoading && pos.length === 0 && <div className="flex items-center justify-center h-32 text-slate-500 text-sm">{t('purchasing.noPOs')}</div>}
          {pos.map(po => (
            <button
              key={po.id}
              onClick={() => setSelected(po)}
              className={`w-full text-left px-4 py-3 hover:bg-slate-700/40 transition-colors ${selected?.id === po.id ? 'bg-slate-700/60' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-white text-sm font-mono font-medium">{po.po_number}</p>
                <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLES[po.status as POStatus]}`}>{po.status}</span>
              </div>
              <p className="text-slate-400 text-xs mt-0.5 truncate">{po.supplier_name}</p>
              <div className="flex items-center justify-between mt-1 text-xs text-slate-500">
                <span>{fmtDate(po.order_date)} · {po.line_count} line{po.line_count !== 1 ? 's' : ''}</span>
                <span className="text-slate-300">{fmtMoney(po.total_cost)}</span>
              </div>
            </button>
          ))}
        </div>

        {pagination && pagination.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-slate-700 text-xs text-slate-400">
            <span>{t('purchasing.posPagination', { total: pagination.total, page: pagination.page, pages: pagination.pages })}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 rounded bg-slate-700 disabled:opacity-40">‹</button>
              <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page === pagination.pages} className="px-2 py-1 rounded bg-slate-700 disabled:opacity-40">›</button>
            </div>
          </div>
        )}
      </div>

      {/* Detail */}
      {selected && (
        <div className="flex-1 border-l border-slate-700 bg-slate-800/50 overflow-hidden flex flex-col">
          <PODetailPanel po={selected} onClose={() => setSelected(null)} />
        </div>
      )}

      {showCreate && <CreatePOModal suppliers={suppliers} onClose={() => setShowCreate(false)} />}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'purchase-orders' | 'suppliers'

export default function Purchasing() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('purchase-orders')

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="px-6 py-4 border-b border-slate-700">
        <h1 className="text-xl font-semibold text-white">{t('purchasing.title')}</h1>
        <p className="text-slate-400 text-sm mt-0.5">{t('purchasing.subtitle')}</p>
      </div>

      <div className="flex border-b border-slate-700 px-6 overflow-x-auto">
        {([
          { key: 'purchase-orders', label: t('purchasing.tabPOs') },
          { key: 'suppliers',       label: t('purchasing.tabSuppliers') },
        ] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === key ? 'border-orange-500 text-orange-400' : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >{label}</button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'purchase-orders' && <PurchaseOrdersTab />}
        {tab === 'suppliers'       && <SuppliersTab />}
      </div>
    </div>
  )
}
