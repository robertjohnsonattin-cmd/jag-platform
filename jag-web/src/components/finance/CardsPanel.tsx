import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '../../api/finance'
import type { CreditCard } from '../../types/finance'

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

const CARD_TYPE_OPTIONS = [
  { value: 'CREDIT',  label: 'Credit Card' },
  { value: 'DEBIT',   label: 'Debit Card' },
  { value: 'CHARGE',  label: 'Charge Card' },
  { value: 'PREPAID', label: 'Prepaid Card' },
]

const CARD_TYPE_STYLES: Record<string, string> = {
  CREDIT:  'bg-blue-900/40  text-blue-300  border border-blue-700',
  DEBIT:   'bg-green-900/40 text-green-300 border border-green-700',
  CHARGE:  'bg-purple-900/40 text-purple-300 border border-purple-700',
  PREPAID: 'bg-slate-700   text-slate-300  border border-slate-600',
}

// ── Add Modal ─────────────────────────────────────────────────────────────────

function AddCardModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ card_name: '', last_four: '', card_type: 'CREDIT' })
  const [err, setErr] = useState('')

  const { mutate, isPending } = useMutation({
    mutationFn: () => financeApi.createCreditCard({
      card_name: form.card_name.trim(),
      last_four: form.last_four || undefined,
      card_type: form.card_type || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['credit-cards'] }); onClose() },
    onError: (e) => setErr((e as Error).message),
  })

  const submit = () => {
    if (!form.card_name.trim()) { setErr('Card name is required.'); return }
    if (form.last_four && !/^\d{4}$/.test(form.last_four)) { setErr('Last four digits must be exactly 4 digits.'); return }
    setErr('')
    mutate()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-white font-semibold">Add Card</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Card Name *</label>
            <input value={form.card_name} onChange={e => setForm(f => ({ ...f, card_name: e.target.value }))} className={cls}
              placeholder="e.g. RBC Visa Platinum" autoFocus />
            <p className="text-xs text-slate-500 mt-1">A nickname to identify this card in the mobile expense form.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Card Type</label>
              <select value={form.card_type} onChange={e => setForm(f => ({ ...f, card_type: e.target.value }))} className={cls}>
                {CARD_TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Last 4 Digits</label>
              <input value={form.last_four} onChange={e => setForm(f => ({ ...f, last_four: e.target.value }))} className={cls}
                placeholder="0512" maxLength={4} pattern="\d{4}" />
            </div>
          </div>
          {err && <p className="text-red-400 text-sm">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
          <button onClick={submit} disabled={isPending}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors">
            {isPending ? 'Saving…' : 'Add Card'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

function EditCardModal({ card, onClose }: { card: CreditCard; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    card_name: card.card_name,
    last_four: card.last_four ?? '',
    card_type: card.card_type ?? 'CREDIT',
  })
  const [err, setErr] = useState('')

  const { mutate, isPending } = useMutation({
    mutationFn: () => financeApi.updateCreditCard(card.id, {
      card_name: form.card_name.trim(),
      last_four: form.last_four || undefined,
      card_type: form.card_type || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['credit-cards'] }); onClose() },
    onError: (e) => setErr((e as Error).message),
  })

  const submit = () => {
    if (!form.card_name.trim()) { setErr('Card name is required.'); return }
    if (form.last_four && !/^\d{4}$/.test(form.last_four)) { setErr('Last four digits must be exactly 4 digits.'); return }
    setErr('')
    mutate()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-white font-semibold">Edit Card</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Card Name *</label>
            <input value={form.card_name} onChange={e => setForm(f => ({ ...f, card_name: e.target.value }))} className={cls} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Card Type</label>
              <select value={form.card_type} onChange={e => setForm(f => ({ ...f, card_type: e.target.value }))} className={cls}>
                {CARD_TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Last 4 Digits</label>
              <input value={form.last_four} onChange={e => setForm(f => ({ ...f, last_four: e.target.value }))} className={cls}
                placeholder="0512" maxLength={4} pattern="\d{4}" />
            </div>
          </div>
          {err && <p className="text-red-400 text-sm">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
          <button onClick={submit} disabled={isPending}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors">
            {isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Cards Panel ───────────────────────────────────────────────────────────────

export default function CardsPanel() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd]     = useState(false)
  const [editCard, setEditCard]   = useState<CreditCard | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data: cards = [], isLoading } = useQuery<CreditCard[]>({
    queryKey: ['credit-cards'],
    queryFn: () => financeApi.getCreditCards(),
  })

  const { mutate: deactivate, isPending: deactivating } = useMutation({
    mutationFn: (id: string) => financeApi.deleteCreditCard(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['credit-cards'] }); setDeletingId(null) },
  })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Credit &amp; Debit Cards</h2>
          <p className="text-xs text-slate-400 mt-0.5">Cards listed here appear in the mobile expense entry form for payment selection.</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
          + Add Card
        </button>
      </div>

      {/* Cards list */}
      {isLoading && <p className="text-slate-400 text-sm py-4">Loading…</p>}

      {!isLoading && cards.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          <p className="text-lg mb-1">No cards registered.</p>
          <p className="text-sm">Add a card to enable card selection in the mobile expense form.</p>
        </div>
      )}

      {cards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {cards.map(card => {
            const typeStyle = CARD_TYPE_STYLES[card.card_type ?? ''] ?? CARD_TYPE_STYLES.PREPAID
            const typeLabel = CARD_TYPE_OPTIONS.find(opt => opt.value === card.card_type)?.label ?? card.card_type ?? 'Card'
            return (
              <div key={card.id}
                className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col gap-3 hover:border-slate-600 transition-colors">
                {/* Card art area */}
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-slate-300 text-lg">
                    💳
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeStyle}`}>{typeLabel}</span>
                </div>

                {/* Card details */}
                <div className="flex-1">
                  <p className="text-white font-medium text-sm leading-tight">{card.card_name}</p>
                  {card.last_four && (
                    <p className="text-slate-400 text-xs mt-1">•••• •••• •••• {card.last_four}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1 border-t border-slate-700">
                  <button onClick={() => setEditCard(card)}
                    className="flex-1 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors text-center">
                    Edit
                  </button>
                  {deletingId === card.id ? (
                    <div className="flex-1 flex items-center gap-1 justify-center">
                      <span className="text-xs text-red-400">Deactivate?</span>
                      <button onClick={() => deactivate(card.id)} disabled={deactivating}
                        className="text-xs text-red-400 hover:text-red-300 font-medium">Yes</button>
                      <span className="text-slate-600">·</span>
                      <button onClick={() => setDeletingId(null)} className="text-xs text-slate-400 hover:text-white">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setDeletingId(card.id)}
                      className="flex-1 py-1.5 text-xs text-slate-600 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors text-center">
                      Remove
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Usage note */}
      {cards.length > 0 && (
        <div className="mt-4 p-3 bg-slate-800/50 border border-slate-700 rounded-lg text-xs text-slate-400 space-y-1">
          <p><span className="text-slate-300 font-medium">Mobile app:</span> Cards appear in the payment method picker when CREDIT_CARD or DEBIT_CARD is selected on the expense form.</p>
          <p><span className="text-slate-300 font-medium">Removing a card</span> deactivates it — it disappears from the mobile picker but existing expenses linked to it are unaffected.</p>
        </div>
      )}

      {showAdd   && <AddCardModal  onClose={() => setShowAdd(false)} />}
      {editCard  && <EditCardModal card={editCard} onClose={() => setEditCard(null)} />}
    </div>
  )
}
