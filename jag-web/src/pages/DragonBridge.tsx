import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { dbApi } from '../api/dragonbridge'
import type {
  QuoteSummary, QuoteItem, OrderSummary,
  ShipmentSummary, Reconciliation, JagRole, QuoteStatus, OrderStatus, ShipmentStatus,
} from '../types/dragonbridge'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtM   = (v: number | null | undefined) => v == null ? '—' : `TTD ${fmt.format(v)}`
const fmtCNY = (v: number) => `¥${fmt.format(v)}`
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const cls = 'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500'

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

const QUOTE_STYLES: Record<QuoteStatus, string> = {
  DRAFT:     'bg-slate-700   text-slate-300 border border-slate-600',
  SENT:      'bg-blue-900/50 text-blue-300  border border-blue-700',
  ACCEPTED:  'bg-green-900/50 text-green-300 border border-green-700',
  EXPIRED:   'bg-yellow-900/50 text-yellow-400 border border-yellow-700',
  CANCELLED: 'bg-red-900/50  text-red-400   border border-red-800',
}

const ORDER_STYLES: Record<OrderStatus, string> = {
  CONFIRMED:      'bg-slate-700   text-slate-300 border border-slate-600',
  IN_PRODUCTION:  'bg-blue-900/50 text-blue-300  border border-blue-700',
  READY_TO_SHIP:  'bg-purple-900/50 text-purple-300 border border-purple-700',
  IN_TRANSIT:     'bg-orange-900/50 text-orange-300 border border-orange-700',
  CUSTOMS:        'bg-yellow-900/50 text-yellow-400 border border-yellow-700',
  DELIVERED:      'bg-green-900/50 text-green-300 border border-green-700',
  CANCELLED:      'bg-red-900/50  text-red-400   border border-red-800',
}

const SHIP_STYLES: Record<ShipmentStatus, string> = {
  BOOKING:    'bg-slate-700   text-slate-300 border border-slate-600',
  LOADING:    'bg-blue-900/50 text-blue-300  border border-blue-700',
  IN_TRANSIT: 'bg-orange-900/50 text-orange-300 border border-orange-700',
  ARRIVED:    'bg-purple-900/50 text-purple-300 border border-purple-700',
  CLEARED:    'bg-green-900/50 text-green-300 border border-green-700',
}

// ── Suppliers Tab ─────────────────────────────────────────────────────────────

function AddSupplierModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', contact_name: '', contact_email: '', contact_phone: '', payment_terms: '', currency: 'CNY' })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => dbApi.createSupplier({
      name: form.name,
      contact_name: form.contact_name || undefined,
      contact_email: form.contact_email || undefined,
      contact_phone: form.contact_phone || undefined,
      payment_terms: form.payment_terms || undefined,
      currency: form.currency,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['db-suppliers'] }); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">Add Supplier</h2>
        <div className="space-y-3">
          {[
            { k: 'name',          label: 'Name *',          ph: 'Shenzhen Electronics Co.' },
            { k: 'contact_name',  label: 'Contact',         ph: 'Wei Zhang' },
            { k: 'contact_email', label: 'Email',           ph: 'wei@supplier.cn' },
            { k: 'contact_phone', label: 'Phone / WeChat',  ph: '+86 ...' },
            { k: 'currency',      label: 'Currency',        ph: 'CNY' },
            { k: 'payment_terms', label: 'Payment Terms',   ph: '30% deposit, 70% on B/L' },
          ].map(({ k, label, ph }) => (
            <div key={k}>
              <label className="block text-xs text-slate-400 mb-1">{label}</label>
              <input value={(form as Record<string, string>)[k]} onChange={set(k)} placeholder={ph} className={cls} />
            </div>
          ))}
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.name}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? 'Saving…' : 'Create Supplier'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function SuppliersTab() {
  const [showAdd, setShowAdd] = useState(false)
  const { data: suppliers = [], isLoading } = useQuery({ queryKey: ['db-suppliers'], queryFn: dbApi.getSuppliers })

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <span className="text-slate-400 text-sm">{suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-colors">+ Add Supplier</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading…</div>}
        {!isLoading && suppliers.length === 0 && <div className="flex items-center justify-center h-32 text-slate-500 text-sm">No suppliers yet.</div>}
        {suppliers.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700 sticky top-0 bg-slate-800">
              <tr>
                {['Name', 'Contact', 'Email / Phone', 'Currency', 'Payment Terms', 'Status'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suppliers.map(s => (
                <tr key={s.id} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                  <td className="px-4 py-3 text-white font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-slate-300">{s.contact_name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {s.contact_email && <p>{s.contact_email}</p>}
                    {s.contact_phone && <p>{s.contact_phone}</p>}
                    {!s.contact_email && !s.contact_phone && '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{s.currency}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs max-w-48 truncate">{s.payment_terms ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${s.is_active ? 'bg-green-900/40 text-green-300' : 'bg-slate-700 text-slate-400'}`}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {showAdd && <AddSupplierModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}

// ── Products Tab ──────────────────────────────────────────────────────────────

function AddProductModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data: suppliers = [] } = useQuery({ queryKey: ['db-suppliers'], queryFn: dbApi.getSuppliers })
  const { data: config } = useQuery({ queryKey: ['db-config'], queryFn: dbApi.getConfig })
  const [form, setForm] = useState({
    supplier_id: '', name: '', hs_code: '', unit_cost_cny: '',
    duty_rate: '', unit: 'EACH', description: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => dbApi.createProduct({
      supplier_id: form.supplier_id, name: form.name, hs_code: form.hs_code,
      unit_cost_cny: Number(form.unit_cost_cny), duty_rate: Number(form.duty_rate) / 100,
      unit: form.unit, description: form.description || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['db-products'] }); onClose() },
  })

  const defaultVat = config?.default_vat_pct ?? 12.5
  const unitCost   = Number(form.unit_cost_cny) || 0
  // Quick preview — no FX rates here, just a duty + VAT indicator
  const dutyRate   = Number(form.duty_rate) / 100

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">Add Product</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Supplier *</label>
            <select value={form.supplier_id} onChange={set('supplier_id')} className={cls}>
              <option value="">— select —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Product Name *</label>
            <input value={form.name} onChange={set('name')} className={cls} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">HS Code *</label>
              <input value={form.hs_code} onChange={set('hs_code')} placeholder="8471.30" className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Unit</label>
              <input value={form.unit} onChange={set('unit')} placeholder="EACH" className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Unit Cost (CNY) *</label>
              <input type="number" min="0.01" step="0.01" value={form.unit_cost_cny} onChange={set('unit_cost_cny')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Duty Rate (%) *</label>
              <input type="number" min="0" max="100" step="0.5" value={form.duty_rate} onChange={set('duty_rate')} className={cls} />
            </div>
          </div>
          {unitCost > 0 && Number(form.duty_rate) >= 0 && (
            <div className="bg-slate-900/50 rounded-lg p-3 text-xs text-slate-400 space-y-1">
              <p className="text-slate-300 font-medium">Cost indicators (excl. freight/insurance)</p>
              <div className="flex justify-between"><span>Unit cost</span><span>{fmtCNY(unitCost)}</span></div>
              <div className="flex justify-between"><span>Duty ({form.duty_rate}%)</span><span>{fmtCNY(unitCost * dutyRate)}</span></div>
              <div className="flex justify-between"><span>VAT ({defaultVat}% on CIF+duty)</span><span>~{fmtCNY(unitCost * (1 + dutyRate) * defaultVat / 100)}</span></div>
            </div>
          )}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Description</label>
            <textarea value={form.description} onChange={set('description')} rows={2} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.supplier_id || !form.name || !form.hs_code || !form.unit_cost_cny || form.duty_rate === ''}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? 'Saving…' : 'Create Product'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function ProductsTab() {
  const [showAdd, setShowAdd] = useState(false)
  const [supplierFilter, setSupplierFilter] = useState('')
  const { data: suppliers = [] } = useQuery({ queryKey: ['db-suppliers'], queryFn: dbApi.getSuppliers })
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['db-products', supplierFilter],
    queryFn: () => dbApi.getProducts({ supplier_id: supplierFilter || undefined }),
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between gap-3">
        <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-xs">
          <option value="">All Suppliers</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-slate-400 text-sm">{products.length} product{products.length !== 1 ? 's' : ''}</span>
          <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-colors">+ Add Product</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading…</div>}
        {products.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700 sticky top-0 bg-slate-800">
              <tr>
                {['Product', 'Supplier', 'HS Code', 'Unit Cost (CNY)', 'Duty Rate', 'Unit'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{p.name}</p>
                    {p.description && <p className="text-slate-500 text-xs truncate max-w-48">{p.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{p.supplier_name}</td>
                  <td className="px-4 py-3 text-slate-400 font-mono text-xs">{p.hs_code}</td>
                  <td className="px-4 py-3 text-orange-300 font-medium">{fmtCNY(p.unit_cost_cny)}</td>
                  <td className="px-4 py-3 text-slate-300">{(p.duty_rate * 100).toFixed(1)}%</td>
                  <td className="px-4 py-3 text-slate-400">{p.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {showAdd && <AddProductModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}

// ── Clients Tab ───────────────────────────────────────────────────────────────

function AddClientModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data: tiers = [] } = useQuery({ queryKey: ['db-pricing-tiers'], queryFn: dbApi.getPricingTiers })
  const [form, setForm] = useState({
    client_type: 'B2B' as 'B2B' | 'B2C', name: '', company_name: '', contact_name: '',
    contact_email: '', contact_phone: '', pricing_tier_id: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => dbApi.createClient({
      client_type: form.client_type, name: form.name,
      company_name: form.company_name || undefined,
      contact_name: form.contact_name || undefined,
      contact_email: form.contact_email || undefined,
      contact_phone: form.contact_phone || undefined,
      pricing_tier_id: form.pricing_tier_id || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['db-clients'] }); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">Add Client</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Type</label>
            <select value={form.client_type} onChange={set('client_type')} className={cls}>
              <option value="B2B">B2B</option>
              <option value="B2C">B2C</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Name *</label>
            <input value={form.name} onChange={set('name')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Company Name</label>
            <input value={form.company_name} onChange={set('company_name')} className={cls} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Contact Name</label>
              <input value={form.contact_name} onChange={set('contact_name')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Phone</label>
              <input value={form.contact_phone} onChange={set('contact_phone')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Email</label>
            <input type="email" value={form.contact_email} onChange={set('contact_email')} className={cls} />
          </div>
          {tiers.length > 0 && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Pricing Tier</label>
              <select value={form.pricing_tier_id} onChange={set('pricing_tier_id')} className={cls}>
                <option value="">— standard —</option>
                {tiers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.default_margin_pct}% margin)</option>)}
              </select>
            </div>
          )}
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.name}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? 'Saving…' : 'Create Client'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function ClientsTab() {
  const [showAdd, setShowAdd] = useState(false)
  const { data: clients = [], isLoading } = useQuery({ queryKey: ['db-clients'], queryFn: () => dbApi.getClients() })

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <span className="text-slate-400 text-sm">{clients.length} client{clients.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-colors">+ Add Client</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading…</div>}
        {clients.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700 sticky top-0 bg-slate-800">
              <tr>
                {['Name', 'Type', 'Company', 'Contact', 'Pricing Tier', 'Status'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.id} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                  <td className="px-4 py-3 text-white font-medium">{c.name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${c.client_type === 'B2B' ? 'bg-blue-900/40 text-blue-300' : 'bg-purple-900/40 text-purple-300'}`}>
                      {c.client_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{c.company_name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {c.contact_name && <p>{c.contact_name}</p>}
                    {c.contact_email && <p>{c.contact_email}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {c.pricing_tier_name ? `${c.pricing_tier_name} (${c.default_margin_pct}%)` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${c.is_active ? 'bg-green-900/40 text-green-300' : 'bg-slate-700 text-slate-400'}`}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {showAdd && <AddClientModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}

// ── Create Quote Modal ────────────────────────────────────────────────────────

function CreateQuoteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { data: clients = [] } = useQuery({ queryKey: ['db-clients'], queryFn: () => dbApi.getClients() })
  const { data: config }       = useQuery({ queryKey: ['db-config'], queryFn: dbApi.getConfig })
  const [form, setForm] = useState({
    client_id: '', jag_role: 'IMPORTER' as JagRole,
    fx_cny_usd: '7.25', fx_usd_ttd: '6.80',
    margin_pct: '', agency_fee_pct: '',
    est_freight_usd: '0', est_insurance_usd: '0', est_local_delivery_ttd: '0',
    valid_until: '', notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => dbApi.createQuote({
      client_id: form.client_id, jag_role: form.jag_role,
      fx_cny_usd: Number(form.fx_cny_usd), fx_usd_ttd: Number(form.fx_usd_ttd),
      margin_pct:     form.jag_role === 'IMPORTER' && form.margin_pct     ? Number(form.margin_pct)     : undefined,
      agency_fee_pct: form.jag_role === 'AGENT'    && form.agency_fee_pct ? Number(form.agency_fee_pct) : undefined,
      est_freight_usd:        Number(form.est_freight_usd),
      est_insurance_usd:      Number(form.est_insurance_usd),
      est_local_delivery_ttd: Number(form.est_local_delivery_ttd),
      valid_until: form.valid_until || undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: (d) => { onCreated(d.id) },
  })

  const defaultMargin = config?.agency_fee_pct ?? 10

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">Create Quote</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Client *</label>
            <select value={form.client_id} onChange={set('client_id')} className={cls}>
              <option value="">— select client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.company_name ? ` (${c.company_name})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">JAG Role</label>
            <select value={form.jag_role} onChange={set('jag_role')} className={cls}>
              <option value="IMPORTER">Importer (buy goods, sell landed to client)</option>
              <option value="AGENT">Agent (arrange shipment, charge agency fee)</option>
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">CNY / USD *</label>
              <input type="number" step="0.0001" value={form.fx_cny_usd} onChange={set('fx_cny_usd')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">USD / TTD *</label>
              <input type="number" step="0.0001" value={form.fx_usd_ttd} onChange={set('fx_usd_ttd')} className={cls} />
            </div>
          </div>
          {form.jag_role === 'IMPORTER' && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Margin % (default {defaultMargin}%)</label>
              <input type="number" min="0" step="0.5" placeholder={String(defaultMargin)} value={form.margin_pct} onChange={set('margin_pct')} className={cls} />
            </div>
          )}
          {form.jag_role === 'AGENT' && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Agency Fee % (default {defaultMargin}%)</label>
              <input type="number" min="0" step="0.5" placeholder={String(defaultMargin)} value={form.agency_fee_pct} onChange={set('agency_fee_pct')} className={cls} />
            </div>
          )}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Est. Freight (USD)</label>
              <input type="number" min="0" step="0.01" value={form.est_freight_usd} onChange={set('est_freight_usd')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Est. Insurance (USD)</label>
              <input type="number" min="0" step="0.01" value={form.est_insurance_usd} onChange={set('est_insurance_usd')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Est. Delivery (TTD)</label>
              <input type="number" min="0" step="0.01" value={form.est_local_delivery_ttd} onChange={set('est_local_delivery_ttd')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Valid Until</label>
            <input type="date" value={form.valid_until} onChange={set('valid_until')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.client_id || !form.fx_cny_usd || !form.fx_usd_ttd}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? 'Creating…' : 'Create Quote'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Add Quote Item Modal ──────────────────────────────────────────────────────

function AddItemModal({ quoteId, onClose }: { quoteId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: products = [] } = useQuery({ queryKey: ['db-products'], queryFn: () => dbApi.getProducts() })
  const [mode, setMode] = useState<'product' | 'manual'>('product')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [form, setForm] = useState({
    product_name: '', hs_code: '', unit_cost_cny: '', duty_rate: '',
    qty: '1', unit: 'EACH', gross_volume_cbm: '', notes: '',
  })

  const selectedProduct = products.find(p => p.id === selectedProductId)

  const handleProductSelect = (id: string) => {
    setSelectedProductId(id)
    const p = products.find(x => x.id === id)
    if (p) setForm(f => ({
      ...f, product_name: p.name, hs_code: p.hs_code,
      unit_cost_cny: String(p.unit_cost_cny), duty_rate: String((p.duty_rate * 100).toFixed(2)), unit: p.unit,
    }))
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => dbApi.addQuoteItem(quoteId, {
      product_id:   mode === 'product' && selectedProductId ? selectedProductId : undefined,
      product_name: form.product_name, hs_code: form.hs_code,
      unit_cost_cny: Number(form.unit_cost_cny), duty_rate: Number(form.duty_rate) / 100,
      qty: Number(form.qty), unit: form.unit,
      gross_volume_cbm: form.gross_volume_cbm ? Number(form.gross_volume_cbm) : undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['db-quote', quoteId] }); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">Add Quote Item</h2>

        <div className="flex gap-2 mb-4">
          {(['product', 'manual'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${mode === m ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'}`}>
              {m === 'product' ? 'From Catalogue' : 'Manual Entry'}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {mode === 'product' && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Select Product</label>
              <select value={selectedProductId} onChange={e => handleProductSelect(e.target.value)} className={cls}>
                <option value="">— select —</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} — {p.supplier_name} ({fmtCNY(p.unit_cost_cny)}/{p.unit})</option>)}
              </select>
            </div>
          )}
          {mode === 'manual' && (
            <>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Product Name *</label>
                <input value={form.product_name} onChange={set('product_name')} className={cls} />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">HS Code *</label>
                  <input value={form.hs_code} onChange={set('hs_code')} className={cls} />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">Unit Cost (CNY) *</label>
                  <input type="number" min="0.01" step="0.01" value={form.unit_cost_cny} onChange={set('unit_cost_cny')} className={cls} />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">Duty Rate (%)</label>
                  <input type="number" min="0" max="100" step="0.5" value={form.duty_rate} onChange={set('duty_rate')} className={cls} />
                </div>
              </div>
            </>
          )}
          {(mode === 'manual' || selectedProduct) && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">Quantity *</label>
                <input type="number" min="1" step="1" value={form.qty} onChange={set('qty')} className={cls} />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">Unit</label>
                <input value={form.unit} onChange={set('unit')} className={cls} />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">Volume (CBM)</label>
                <input type="number" min="0" step="0.001" value={form.gross_volume_cbm} onChange={set('gross_volume_cbm')} className={cls} />
              </div>
            </div>
          )}
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()}
            disabled={isPending || !form.product_name || !form.hs_code || !form.unit_cost_cny || form.duty_rate === ''}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? 'Adding…' : 'Add Item'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Quote Detail Panel ────────────────────────────────────────────────────────

function QuoteDetailPanel({ quoteId, onClose }: { quoteId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [showAddItem, setShowAddItem] = useState(false)

  const { data: quote, isLoading } = useQuery({
    queryKey: ['db-quote', quoteId],
    queryFn: () => dbApi.getQuote(quoteId),
  })

  const { mutate: send, isPending: sending } = useMutation({
    mutationFn: () => dbApi.sendQuote(quoteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['db-quote', quoteId] }),
  })
  const { mutate: accept, isPending: accepting } = useMutation({
    mutationFn: () => dbApi.acceptQuote(quoteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['db-quote', quoteId] })
      qc.invalidateQueries({ queryKey: ['db-quotes'] })
      qc.invalidateQueries({ queryKey: ['db-orders'] })
    },
  })
  const { mutate: cancel } = useMutation({
    mutationFn: () => dbApi.cancelQuote(quoteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['db-quote', quoteId] })
      qc.invalidateQueries({ queryKey: ['db-quotes'] })
    },
  })
  const { mutate: removeItem } = useMutation({
    mutationFn: (itemId: string) => dbApi.removeQuoteItem(quoteId, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['db-quote', quoteId] }),
  })

  if (isLoading) return <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading…</div>
  if (!quote) return null

  const canEdit   = quote.status === 'DRAFT'
  const canSend   = quote.status === 'DRAFT'
  const canAccept = quote.status === 'SENT' || quote.status === 'DRAFT'
  const canCancel = quote.status === 'DRAFT' || quote.status === 'SENT'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-xs ${QUOTE_STYLES[quote.status]}`}>{quote.status}</span>
            <span className="text-slate-400 text-xs">{quote.jag_role}</span>
          </div>
          <p className="text-white font-semibold mt-1">{quote.client_name}</p>
          <p className="text-slate-400 text-sm">{fmtDate(quote.created_at)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {canEdit   && <button onClick={() => setShowAddItem(true)} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors">+ Item</button>}
          {canSend   && <button onClick={() => send()} disabled={sending} className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded transition-colors">{sending ? '…' : 'Send'}</button>}
          {canAccept && <button onClick={() => accept()} disabled={accepting} className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded transition-colors">{accepting ? '…' : 'Accept → Order'}</button>}
          {canCancel && <button onClick={() => cancel()} className="px-3 py-1.5 text-xs bg-red-800 hover:bg-red-700 text-white rounded transition-colors">Cancel</button>}
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
      </div>

      {/* FX + Cost Summary */}
      <div className="px-5 py-3 border-b border-slate-700 grid grid-cols-4 gap-3 text-center">
        <div>
          <p className="text-orange-400 font-semibold">{fmtM(quote.total_ttd)}</p>
          <p className="text-slate-500 text-xs">Total (TTD)</p>
        </div>
        <div>
          <p className="text-white text-sm">¥{quote.fx_cny_usd} / USD</p>
          <p className="text-slate-500 text-xs">CNY Rate</p>
        </div>
        <div>
          <p className="text-white text-sm">${quote.fx_usd_ttd} TTD</p>
          <p className="text-slate-500 text-xs">USD Rate</p>
        </div>
        <div>
          <p className="text-white text-sm">
            {quote.jag_role === 'IMPORTER' ? `${quote.margin_pct ?? 0}% margin` : `${quote.agency_fee_pct ?? 0}% fee`}
          </p>
          <p className="text-slate-500 text-xs">{quote.jag_role === 'IMPORTER' ? 'Margin' : 'Agency Fee'}</p>
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {quote.items.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-slate-500 text-sm gap-2">
            <p>No items yet.</p>
            {canEdit && <button onClick={() => setShowAddItem(true)} className="text-orange-400 hover:text-orange-300 text-xs">+ Add Item</button>}
          </div>
        )}
        {quote.items.length > 0 && (
          <table className="w-full text-xs">
            <thead className="text-slate-400 uppercase tracking-wide border-b border-slate-700 sticky top-0 bg-slate-800">
              <tr>
                {['Item', 'Qty', 'Unit Cost', 'Duty', 'CIF (TTD)', 'Landed Cost', ''].map(h => (
                  <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item: QuoteItem) => (
                <tr key={item.id} className="border-b border-slate-700/40">
                  <td className="px-4 py-2.5">
                    <p className="text-white">{item.product_name}</p>
                    <p className="text-slate-500">HS {item.hs_code} · {item.unit}</p>
                  </td>
                  <td className="px-4 py-2.5 text-slate-300">{item.qty}</td>
                  <td className="px-4 py-2.5 text-slate-300">{fmtCNY(item.unit_cost_cny)}</td>
                  <td className="px-4 py-2.5 text-slate-400">{(item.duty_rate * 100).toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-slate-300">{fmtM(item.cif_ttd)}</td>
                  <td className="px-4 py-2.5 text-orange-300 font-medium">{fmtM(item.item_landed_cost)}</td>
                  <td className="px-4 py-2.5">
                    {canEdit && (
                      <button onClick={() => removeItem(item.id)} className="text-slate-500 hover:text-red-400 transition-colors">×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAddItem && <AddItemModal quoteId={quoteId} onClose={() => setShowAddItem(false)} />}
    </div>
  )
}

// ── Quotes Tab ────────────────────────────────────────────────────────────────

function QuotesTab() {
  const [selected, setSelected] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ['db-quotes', statusFilter],
    queryFn: () => dbApi.getQuotes({ status: statusFilter || undefined }),
  })

  const STATUSES: QuoteStatus[] = ['DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED']

  return (
    <div className="flex h-full gap-0">
      <div className={`flex flex-col ${selected ? 'hidden lg:flex lg:w-80 lg:shrink-0' : 'flex-1'}`}>
        <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2 flex-wrap">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-xs">
            <option value="">All Statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="text-slate-400 text-xs ml-auto">{quotes.length} quotes</span>
          <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-colors">+ New Quote</button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-700/50">
          {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading…</div>}
          {!isLoading && quotes.length === 0 && <div className="flex items-center justify-center h-32 text-slate-500 text-sm">No quotes.</div>}
          {quotes.map((q: QuoteSummary) => (
            <button key={q.id} onClick={() => setSelected(q.id)}
              className={`w-full text-left px-4 py-3 hover:bg-slate-700/40 transition-colors ${selected === q.id ? 'bg-slate-700/60' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-white text-sm font-medium truncate">{q.client_name}</p>
                <span className={`px-2 py-0.5 rounded-full text-xs shrink-0 ${QUOTE_STYLES[q.status]}`}>{q.status}</span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                <span>{q.jag_role}</span>
                <span>{q.item_count} item{q.item_count !== 1 ? 's' : ''}</span>
                <span className="ml-auto text-orange-400">{fmtM(q.total_ttd)}</span>
              </div>
              <p className="text-slate-600 text-xs mt-0.5">{fmtDate(q.created_at)}</p>
            </button>
          ))}
        </div>
      </div>
      {selected && (
        <div className="flex-1 border-l border-slate-700 bg-slate-800/50 overflow-hidden flex flex-col">
          <QuoteDetailPanel quoteId={selected} onClose={() => setSelected(null)} />
        </div>
      )}
      {showCreate && (
        <CreateQuoteModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); setSelected(id) }}
        />
      )}
    </div>
  )
}

// ── Order Detail Panel ────────────────────────────────────────────────────────

function OrderDetailPanel({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: order, isLoading } = useQuery({
    queryKey: ['db-order', orderId],
    queryFn: () => dbApi.getOrder(orderId),
  })

  const { mutate: updateStatus } = useMutation({
    mutationFn: (status: OrderStatus) => dbApi.updateOrderStatus(orderId, status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['db-order', orderId] }); qc.invalidateQueries({ queryKey: ['db-orders'] }) },
  })
  const { mutate: markDeposit, isPending: depositing } = useMutation({
    mutationFn: () => dbApi.recordDeposit(orderId, uuidv4()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['db-order', orderId] }),
  })
  const { mutate: issueInv } = useMutation({
    mutationFn: (id: string) => dbApi.issueInvoice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['db-order', orderId] }),
  })
  const { mutate: payInv } = useMutation({
    mutationFn: (id: string) => dbApi.payInvoice(id, 'BANK_TRANSFER'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['db-order', orderId] }),
  })
  const { mutate: dispatch } = useMutation({
    mutationFn: () => dbApi.dispatchDelivery(orderId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['db-order', orderId] }),
  })
  const { mutate: deliver } = useMutation({
    mutationFn: () => dbApi.completeDelivery(orderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['db-order', orderId] })
      qc.invalidateQueries({ queryKey: ['db-orders'] })
    },
  })

  if (isLoading) return <div className="flex items-center justify-center h-32 text-slate-400">Loading…</div>
  if (!order) return null

  const NEXT_STATUSES: Record<OrderStatus, OrderStatus | null> = {
    CONFIRMED: 'IN_PRODUCTION', IN_PRODUCTION: 'READY_TO_SHIP',
    READY_TO_SHIP: 'IN_TRANSIT', IN_TRANSIT: 'CUSTOMS',
    CUSTOMS: 'DELIVERED', DELIVERED: null, CANCELLED: null,
  }
  const next = NEXT_STATUSES[order.status]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2 py-0.5 rounded-full text-xs ${ORDER_STYLES[order.status]}`}>{order.status}</span>
            <span className="text-slate-400 text-xs">{order.jag_role}</span>
          </div>
          <p className="text-white font-semibold">{order.client_name}</p>
          <p className="text-slate-400 text-sm">{fmtDate(order.created_at)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {next && (
            <button onClick={() => updateStatus(next)}
              className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors">
              → {next.replace('_', ' ')}
            </button>
          )}
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
      </div>

      {/* Financials */}
      <div className="px-5 py-3 border-b border-slate-700 grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-orange-400 font-semibold">{fmtM(order.quoted_total_ttd)}</p>
          <p className="text-slate-500 text-xs">Order Total</p>
        </div>
        <div>
          <p className={`font-semibold ${order.deposit_paid ? 'text-green-400' : 'text-yellow-400'}`}>
            {fmtM(order.deposit_amount_ttd)}
          </p>
          <p className="text-slate-500 text-xs">Deposit ({order.deposit_pct}%)</p>
        </div>
        <div>
          {!order.deposit_paid ? (
            <button onClick={() => markDeposit()} disabled={depositing}
              className="px-3 py-1.5 text-xs bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded transition-colors">
              {depositing ? 'Marking…' : 'Mark Deposit Paid'}
            </button>
          ) : (
            <span className="text-green-400 text-xs">✓ Deposit paid</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Invoices */}
        {order.invoices.length > 0 && (
          <div>
            <p className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-2">Invoices</p>
            <div className="space-y-2">
              {order.invoices.map(inv => (
                <div key={inv.id} className="flex items-center justify-between p-3 bg-slate-900/40 rounded-lg border border-slate-700">
                  <div>
                    <p className="text-white text-sm">{inv.invoice_type.replace('_', ' ')} Invoice</p>
                    <p className="text-slate-400 text-xs">{fmtM(inv.amount_ttd)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      inv.status === 'PAID' ? 'text-green-400' :
                      inv.status === 'ISSUED' ? 'text-blue-400' : 'text-slate-400'
                    }`}>{inv.status}</span>
                    {inv.status === 'DRAFT'  && <button onClick={() => issueInv(inv.id)} className="text-xs text-blue-400 hover:text-blue-300">Issue</button>}
                    {inv.status === 'ISSUED' && <button onClick={() => payInv(inv.id)}  className="text-xs text-green-400 hover:text-green-300">Mark Paid</button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Delivery */}
        {order.delivery && (
          <div>
            <p className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-2">Delivery</p>
            <div className="p-3 bg-slate-900/40 rounded-lg border border-slate-700 space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-white text-sm">{order.delivery.delivery_address}</p>
                <span className="text-slate-400 text-xs">{order.delivery.status}</span>
              </div>
              {order.delivery.scheduled_date && <p className="text-slate-400 text-xs">Scheduled: {fmtDate(order.delivery.scheduled_date)}</p>}
              {order.delivery.contact_name && <p className="text-slate-400 text-xs">{order.delivery.contact_name} · {order.delivery.contact_phone}</p>}
              <div className="flex gap-2 mt-2">
                {order.delivery.status === 'PENDING' && (
                  <button onClick={() => dispatch()} className="text-xs px-2 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded">Dispatch</button>
                )}
                {order.delivery.status === 'OUT_FOR_DELIVERY' && (
                  <button onClick={() => deliver()} className="text-xs px-2 py-1 bg-green-700 hover:bg-green-600 text-white rounded">Mark Delivered</button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Orders Tab ────────────────────────────────────────────────────────────────

function OrdersTab() {
  const [selected, setSelected] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['db-orders', statusFilter],
    queryFn: () => dbApi.getOrders({ status: statusFilter || undefined }),
  })

  const ORDER_STATUS_LIST: OrderStatus[] = ['CONFIRMED','IN_PRODUCTION','READY_TO_SHIP','IN_TRANSIT','CUSTOMS','DELIVERED','CANCELLED']

  return (
    <div className="flex h-full gap-0">
      <div className={`flex flex-col ${selected ? 'hidden lg:flex lg:w-80 lg:shrink-0' : 'flex-1'}`}>
        <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-xs">
            <option value="">All Statuses</option>
            {ORDER_STATUS_LIST.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <span className="text-slate-400 text-xs ml-auto">{orders.length} orders</span>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-700/50">
          {isLoading && <div className="flex items-center justify-center h-32 text-slate-400">Loading…</div>}
          {!isLoading && orders.length === 0 && <div className="flex items-center justify-center h-32 text-slate-500 text-sm">No orders.</div>}
          {orders.map((o: OrderSummary) => (
            <button key={o.id} onClick={() => setSelected(o.id)}
              className={`w-full text-left px-4 py-3 hover:bg-slate-700/40 transition-colors ${selected === o.id ? 'bg-slate-700/60' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-white text-sm font-medium truncate">{o.client_name}</p>
                <span className={`px-2 py-0.5 rounded-full text-xs shrink-0 ${ORDER_STYLES[o.status]}`}>
                  {o.status.replace('_', ' ')}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                <span>{o.jag_role}</span>
                <span className={o.deposit_paid ? 'text-green-500' : 'text-yellow-500'}>
                  {o.deposit_paid ? '✓ deposit' : '⚠ deposit due'}
                </span>
                <span className="ml-auto text-orange-400">{fmtM(o.quoted_total_ttd)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
      {selected && (
        <div className="flex-1 border-l border-slate-700 bg-slate-800/50 overflow-hidden flex flex-col">
          <OrderDetailPanel orderId={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  )
}

// ── Shipments Tab ─────────────────────────────────────────────────────────────

function CreateShipmentModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    container_ref: '', vessel_name: '', port_of_origin: 'SHANGHAI',
    port_of_destination: 'PORT OF SPAIN', etd: '', eta: '', freight_forwarder: '', notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending } = useMutation({
    mutationFn: () => dbApi.createShipment({
      container_ref: form.container_ref || undefined,
      vessel_name: form.vessel_name || undefined,
      port_of_origin: form.port_of_origin,
      port_of_destination: form.port_of_destination,
      etd: form.etd || undefined,
      eta: form.eta || undefined,
      freight_forwarder: form.freight_forwarder || undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['db-shipments'] }); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">New Shipment</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Container Ref</label>
              <input value={form.container_ref} onChange={set('container_ref')} placeholder="TEMU1234567" className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Vessel Name</label>
              <input value={form.vessel_name} onChange={set('vessel_name')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Port of Origin</label>
              <input value={form.port_of_origin} onChange={set('port_of_origin')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Port of Destination</label>
              <input value={form.port_of_destination} onChange={set('port_of_destination')} className={cls} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">ETD</label>
              <input type="date" value={form.etd} onChange={set('etd')} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">ETA</label>
              <input type="date" value={form.eta} onChange={set('eta')} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Freight Forwarder</label>
            <input value={form.freight_forwarder} onChange={set('freight_forwarder')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? 'Creating…' : 'Create Shipment'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function ShipmentsTab() {
  const [showCreate, setShowCreate] = useState(false)
  const { data: shipments = [], isLoading } = useQuery({ queryKey: ['db-shipments'], queryFn: dbApi.getShipments })

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <span className="text-slate-400 text-sm">{shipments.length} shipment{shipments.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-colors">+ New Shipment</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading…</div>}
        {!isLoading && shipments.length === 0 && <div className="flex items-center justify-center h-32 text-slate-500 text-sm">No shipments.</div>}
        {shipments.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700 sticky top-0 bg-slate-800">
              <tr>
                {['Container / Vessel', 'Route', 'ETD', 'ETA', 'Orders', 'Status'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shipments.map((s: ShipmentSummary) => (
                <tr key={s.id} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-white font-mono">{s.container_ref ?? '—'}</p>
                    {s.vessel_name && <p className="text-slate-400 text-xs">{s.vessel_name}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">
                    <p>{s.port_of_origin}</p>
                    <p className="text-slate-500">→ {s.port_of_destination}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(s.etd)}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(s.eta)}</td>
                  <td className="px-4 py-3 text-slate-300">{s.order_count}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${SHIP_STYLES[s.status]}`}>{s.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {showCreate && <CreateShipmentModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}

// ── Reconciliations Tab ───────────────────────────────────────────────────────

function ReconciliationsTab() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const { data: recons = [], isLoading } = useQuery({
    queryKey: ['db-reconciliations', statusFilter],
    queryFn: () => dbApi.getReconciliations(statusFilter || undefined),
  })

  const { mutate: approve } = useMutation({
    mutationFn: (id: string) => dbApi.approveReconciliation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['db-reconciliations'] }),
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-3">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-xs">
          <option value="">All</option>
          <option value="PENDING_REVIEW">Pending Review</option>
          <option value="APPROVED">Approved</option>
        </select>
        <span className="text-slate-400 text-sm ml-auto">{recons.length} reconciliation{recons.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading…</div>}
        {!isLoading && recons.length === 0 && <div className="flex items-center justify-center h-32 text-slate-500 text-sm">No reconciliations yet.</div>}
        {recons.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700 sticky top-0 bg-slate-800">
              <tr>
                {['Client', 'Role', 'Quoted', 'Actual', 'Variance', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recons.map((r: Reconciliation) => (
                <tr key={r.id} className={`border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors ${r.variance_pct !== null && Math.abs(r.variance_pct) > 5 ? 'bg-orange-950/10' : ''}`}>
                  <td className="px-4 py-3 text-white font-medium">{r.client_name}</td>
                  <td className="px-4 py-3 text-slate-400">{r.jag_role}</td>
                  <td className="px-4 py-3 text-slate-300">{fmtM(r.quoted_total_ttd)}</td>
                  <td className="px-4 py-3 text-slate-300">{r.actual_total_ttd != null ? fmtM(r.actual_total_ttd) : '—'}</td>
                  <td className="px-4 py-3">
                    {r.variance_ttd != null ? (
                      <span className={r.variance_ttd > 0 ? 'text-green-400' : r.variance_ttd < 0 ? 'text-red-400' : 'text-slate-400'}>
                        {r.variance_ttd > 0 ? '+' : ''}{fmtM(r.variance_ttd)}
                        {r.variance_pct != null && ` (${r.variance_pct > 0 ? '+' : ''}${r.variance_pct.toFixed(1)}%)`}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${r.status === 'APPROVED' ? 'bg-green-900/40 text-green-300' : 'bg-yellow-900/40 text-yellow-400'}`}>
                      {r.status === 'PENDING_REVIEW' ? 'Pending Review' : 'Approved'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {r.status === 'PENDING_REVIEW' && (
                      <button onClick={() => approve(r.id)} className="text-xs text-green-400 hover:text-green-300 transition-colors">Approve</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type DBTab = 'suppliers' | 'products' | 'clients' | 'quotes' | 'orders' | 'shipments' | 'reconciliations'

export default function DragonBridge() {
  const [tab, setTab] = useState<DBTab>('quotes')

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="px-6 py-4 border-b border-slate-700">
        <h1 className="text-xl font-semibold text-white">DragonBridge</h1>
        <p className="text-slate-400 text-sm mt-0.5">China sourcing, import logistics, landed-cost quoting</p>
      </div>

      <div className="flex border-b border-slate-700 px-6 overflow-x-auto">
        {([
          { key: 'quotes',           label: 'Quotes' },
          { key: 'orders',           label: 'Orders' },
          { key: 'shipments',        label: 'Shipments' },
          { key: 'reconciliations',  label: 'Reconciliations' },
          { key: 'clients',          label: 'Clients' },
          { key: 'products',         label: 'Products' },
          { key: 'suppliers',        label: 'Suppliers' },
        ] as { key: DBTab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === key ? 'border-orange-500 text-orange-400' : 'border-transparent text-slate-400 hover:text-white'
            }`}>{label}</button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'suppliers'       && <SuppliersTab />}
        {tab === 'products'        && <ProductsTab />}
        {tab === 'clients'         && <ClientsTab />}
        {tab === 'quotes'          && <QuotesTab />}
        {tab === 'orders'          && <OrdersTab />}
        {tab === 'shipments'       && <ShipmentsTab />}
        {tab === 'reconciliations' && <ReconciliationsTab />}
      </div>
    </div>
  )
}
