import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { nlcbApi } from '../api/nlcb'
import type { SessionSummary, Settlement, NLCBGame, NLCBScratchGame, NLCBBiller } from '../api/nlcb'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtM   = (v: number | null | undefined) => v == null ? '—' : `$${fmt.format(v)}`
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-TT', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const cls = 'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500'

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

// ── Session Detail Panel ──────────────────────────────────────────────────────

function RecordSalesModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: games = [] } = useQuery({ queryKey: ['nlcb-games'], queryFn: nlcbApi.getGames })
  const [gameId, setGameId] = useState('')
  const [grossSales, setGrossSales] = useState('')

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => nlcbApi.recordSales(sessionId, gameId, Number(grossSales), uuidv4()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nlcb-session', sessionId] }); onClose() },
  })

  const activeGames = games.filter(g => g.is_active)
  const selected = activeGames.find(g => g.id === gameId)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('nlcb.recordDrawSales')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.game')}</label>
            <select value={gameId} onChange={e => setGameId(e.target.value)} className={cls}>
              <option value="">— select —</option>
              {activeGames.map(g => <option key={g.id} value={g.id}>{g.name} ({g.commission_rate}%)</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.grossSalesTTD')}</label>
            <input type="number" min="0.01" step="0.01" value={grossSales} onChange={e => setGrossSales(e.target.value)} className={cls} />
          </div>
          {selected && grossSales && (
            <div className="bg-slate-900/50 rounded-lg p-3 text-xs text-slate-400">
              <div className="flex justify-between"><span>{t('nlcb.grossSales')}</span><span>{fmtM(Number(grossSales))}</span></div>
              <div className="flex justify-between"><span>{t('nlcb.commissionRate', { rate: selected.commission_rate })}</span><span className="text-green-400">{fmtM(Number(grossSales) * selected.commission_rate / 100)}</span></div>
            </div>
          )}
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !gameId || !grossSales}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('nlcb.recordSales')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function RecordPayoutModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: games = [] } = useQuery({ queryKey: ['nlcb-games'], queryFn: nlcbApi.getGames })
  const [form, setForm] = useState({ game_id: '', payout_amount: '', ticket_ref: '', notes: '' })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => nlcbApi.recordPayout(sessionId, {
      game_id: form.game_id, payout_amount: Number(form.payout_amount),
      ticket_ref: form.ticket_ref || undefined,
      notes: form.notes || undefined, idempotency_key: uuidv4(),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nlcb-session', sessionId] }); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('nlcb.recordDrawPayout')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.game')}</label>
            <select value={form.game_id} onChange={set('game_id')} className={cls}>
              <option value="">— select —</option>
              {games.filter(g => g.is_active).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.payoutAmountTTD')}</label>
            <input type="number" min="0.01" step="0.01" value={form.payout_amount} onChange={set('payout_amount')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.ticketRef')}</label>
            <input value={form.ticket_ref} onChange={set('ticket_ref')} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.game_id || !form.payout_amount}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('nlcb.recordPayout')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function RecordScratchSalesModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: scratchGames = [] } = useQuery({ queryKey: ['nlcb-scratch-games'], queryFn: nlcbApi.getScratchGames })
  const [gameId, setGameId] = useState('')
  const [tickets, setTickets] = useState('')

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => nlcbApi.recordScratchSales(sessionId, { game_id: gameId, tickets_sold: Number(tickets), idempotency_key: uuidv4() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nlcb-session', sessionId] }); onClose() },
  })

  const selected = scratchGames.find(g => g.id === gameId)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('nlcb.recordScratchSales')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.scratchGame')}</label>
            <select value={gameId} onChange={e => setGameId(e.target.value)} className={cls}>
              <option value="">— select —</option>
              {scratchGames.filter(g => g.is_active).map(g => <option key={g.id} value={g.id}>{g.name} (${g.denomination})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.ticketsSold')}</label>
            <input type="number" min="1" step="1" value={tickets} onChange={e => setTickets(e.target.value)} className={cls} />
          </div>
          {selected && tickets && (
            <div className="bg-slate-900/50 rounded-lg p-3 text-xs text-slate-400">
              <div className="flex justify-between"><span>{t('nlcb.grossAmount')}</span><span>{fmtM(Number(tickets) * selected.denomination)}</span></div>
              <div className="flex justify-between"><span>{t('nlcb.commissionRate', { rate: selected.commission_rate })}</span><span className="text-green-400">{fmtM(Number(tickets) * selected.denomination * selected.commission_rate / 100)}</span></div>
            </div>
          )}
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !gameId || !tickets}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('nlcb.recordSales')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function RecordScratchWinningModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: scratchGames = [] } = useQuery({ queryKey: ['nlcb-scratch-games'], queryFn: nlcbApi.getScratchGames })
  const [form, setForm] = useState({ game_id: '', amount: '', ticket_ref: '' })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const [result, setResult] = useState<{ is_large_win: boolean } | null>(null)

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => nlcbApi.recordScratchWinning(sessionId, {
      game_id: form.game_id, amount: Number(form.amount),
      ticket_ref: form.ticket_ref || undefined, idempotency_key: uuidv4(),
    }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['nlcb-session', sessionId] })
      setResult(d)
    },
  })

  if (result) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl text-center">
          {result.is_large_win ? (
            <>
              <p className="text-yellow-400 text-2xl mb-2">{t('nlcb.largeWinTitle')}</p>
              <p className="text-white font-semibold">{t('nlcb.largeWinMsg')}</p>
              <p className="text-slate-400 text-sm mt-1">{t('nlcb.largeWinNote')}</p>
            </>
          ) : (
            <>
              <p className="text-green-400 text-2xl mb-2">{t('nlcb.logged')}</p>
              <p className="text-white font-semibold">{t('nlcb.payoutRecorded')}</p>
            </>
          )}
          <button onClick={onClose} className="mt-4 px-6 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm rounded-lg">{t('nlcb.done')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('nlcb.recordScratchWinning')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.scratchGame')}</label>
            <select value={form.game_id} onChange={set('game_id')} className={cls}>
              <option value="">— select —</option>
              {scratchGames.filter(g => g.is_active).map(g => <option key={g.id} value={g.id}>{g.name} (${g.denomination})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.winningAmountTTD')}</label>
            <input type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.ticketRef')}</label>
            <input value={form.ticket_ref} onChange={set('ticket_ref')} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.game_id || !form.amount}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('nlcb.recordWinning')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function RecordBillPaymentModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: billers = [] } = useQuery({ queryKey: ['nlcb-billers'], queryFn: nlcbApi.getBillers })
  const [form, setForm] = useState({ biller_id: '', amount_collected: '', customer_ref: '' })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => nlcbApi.recordBillPayment(sessionId, {
      biller_id: form.biller_id, amount_collected: Number(form.amount_collected),
      customer_ref: form.customer_ref || undefined, idempotency_key: uuidv4(),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nlcb-session', sessionId] }); onClose() },
  })

  const selected = billers.find(b => b.id === form.biller_id)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('nlcb.recordBillPayment')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.biller')}</label>
            <select value={form.biller_id} onChange={set('biller_id')} className={cls}>
              <option value="">— select —</option>
              {billers.filter(b => b.is_active).map(b => <option key={b.id} value={b.id}>{b.name} (fee: {fmtM(b.flat_fee)})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.amountCollectedTTD')}</label>
            <input type="number" min="0.01" step="0.01" value={form.amount_collected} onChange={set('amount_collected')} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.customerRef')}</label>
            <input value={form.customer_ref} onChange={set('customer_ref')} className={cls} />
          </div>
          {selected && form.amount_collected && (
            <div className="bg-slate-900/50 rounded-lg p-3 text-xs text-slate-400">
              <div className="flex justify-between"><span>{t('nlcb.collected')}</span><span>{fmtM(Number(form.amount_collected))}</span></div>
              <div className="flex justify-between"><span>{t('nlcb.feeEarned')}</span><span className="text-green-400">{fmtM(selected.flat_fee)}</span></div>
            </div>
          )}
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.biller_id || !form.amount_collected}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('nlcb.recordPayment')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function CloseSessionModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [closeFloat, setCloseFloat] = useState('')
  const [notes, setNotes] = useState('')

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => nlcbApi.closeSession(sessionId, Number(closeFloat), notes || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nlcb-session', sessionId] })
      qc.invalidateQueries({ queryKey: ['nlcb-sessions'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('nlcb.closeSession')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.closingCashFloat')}</label>
            <input type="number" min="0" step="0.01" value={closeFloat} onChange={e => setCloseFloat(e.target.value)} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || closeFloat === ''}
            className="flex-1 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('nlcb.closing') : t('nlcb.closeSession')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

type SessionModal = 'sales' | 'payout' | 'scratch-sales' | 'scratch-win' | 'bill' | 'close' | null

function SessionDetailPanel({ session, onClose }: { session: SessionSummary; onClose: () => void }) {
  const { t } = useTranslation()
  const [modal, setModal] = useState<SessionModal>(null)

  const { data: detail, isLoading } = useQuery({
    queryKey: ['nlcb-session', session.id],
    queryFn: () => nlcbApi.getSession(session.id),
  })

  const isOpen = session.status === 'OPEN'

  const net = detail
    ? detail.total_sales - detail.total_payouts + detail.total_commission
      + (detail.scratch_sales.reduce((s, x) => s + x.commission_amount, 0))
      - (detail.scratch_winnings.filter(w => !w.is_large_win).reduce((s, x) => s + x.amount, 0))
      + (detail.bill_payments.reduce((s, x) => s + x.flat_fee, 0))
    : null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-xs ${isOpen ? 'bg-green-900/50 text-green-300 border border-green-700' : 'bg-slate-700 text-slate-400 border border-slate-600'}`}>
              {session.status}
            </span>
          </div>
          <p className="text-white font-semibold mt-1">{fmtDate(session.session_date)}</p>
          <p className="text-slate-400 text-sm">{t('nlcb.openingFloat', { amount: fmtM(session.cash_float_open) })}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
          {isOpen && (
            <>
              <button onClick={() => setModal('sales')} className="px-2.5 py-1.5 bg-blue-800 hover:bg-blue-700 text-white text-xs rounded transition-colors">{t('nlcb.drawSalesBtn')}</button>
              <button onClick={() => setModal('payout')} className="px-2.5 py-1.5 bg-purple-800 hover:bg-purple-700 text-white text-xs rounded transition-colors">{t('nlcb.drawPayoutBtn')}</button>
              <button onClick={() => setModal('scratch-sales')} className="px-2.5 py-1.5 bg-blue-900 hover:bg-blue-800 text-white text-xs rounded transition-colors">{t('nlcb.scratchSalesBtn')}</button>
              <button onClick={() => setModal('scratch-win')} className="px-2.5 py-1.5 bg-yellow-800 hover:bg-yellow-700 text-white text-xs rounded transition-colors">{t('nlcb.scratchWinBtn')}</button>
              <button onClick={() => setModal('bill')} className="px-2.5 py-1.5 bg-teal-800 hover:bg-teal-700 text-white text-xs rounded transition-colors">{t('nlcb.billBtn')}</button>
              <button onClick={() => setModal('close')} className="px-2.5 py-1.5 bg-red-800 hover:bg-red-700 text-white text-xs rounded transition-colors">{t('nlcb.closeSessionBtn')}</button>
            </>
          )}
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
      </div>

      {/* Summary cards */}
      {detail && (
        <div className="px-5 py-3 border-b border-slate-700 grid grid-cols-5 gap-2 text-center">
          {[
            { label: t('nlcb.drawSales'), value: fmtM(detail.total_sales), cls: 'text-blue-300' },
            { label: t('nlcb.drawPayouts'), value: fmtM(detail.total_payouts), cls: 'text-red-400' },
            { label: t('nlcb.drawComm'), value: fmtM(detail.total_commission), cls: 'text-green-400' },
            { label: t('nlcb.scratchComm'), value: fmtM(detail.scratch_sales.reduce((s, x) => s + x.commission_amount, 0)), cls: 'text-green-400' },
            { label: t('nlcb.netEarnings'), value: fmtM(net), cls: 'text-orange-400 font-bold' },
          ].map(({ label, value, cls: c }) => (
            <div key={label}>
              <p className={`text-sm ${c}`}>{value}</p>
              <p className="text-slate-500 text-xs">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Transaction log */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>}
        {detail && (
          <div className="divide-y divide-slate-700/50">
            {/* Draw sales */}
            {detail.sales.map(s => (
              <div key={s.id} className="px-5 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-white text-sm">{t('nlcb.drawSaleEntry', { game: s.game_name })}</p>
                  <p className="text-slate-500 text-xs">{t('nlcb.commissionLabel')} {fmtM(s.commission_amount)}</p>
                </div>
                <span className="text-blue-300 font-medium">{fmtM(s.gross_sales)}</span>
              </div>
            ))}
            {/* Draw payouts */}
            {detail.payouts.map(p => (
              <div key={p.id} className="px-5 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-white text-sm">{t('nlcb.drawPayoutEntry', { game: p.game_name })}</p>
                  {p.ticket_ref && <p className="text-slate-500 text-xs">{t('nlcb.refLabel', { ref: p.ticket_ref })}</p>}
                </div>
                <span className="text-red-400 font-medium">-{fmtM(p.payout_amount)}</span>
              </div>
            ))}
            {/* Scratch sales */}
            {detail.scratch_sales.map(s => (
              <div key={s.id} className="px-5 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-white text-sm">{t('nlcb.scratchSalesEntry', { game: s.game_name })}</p>
                  <p className="text-slate-500 text-xs">{t('nlcb.scratchTicketsInfo', { tickets: s.tickets_sold, denom: s.denomination, comm: fmtM(s.commission_amount) })}</p>
                </div>
                <span className="text-blue-300 font-medium">{fmtM(s.gross_amount)}</span>
              </div>
            ))}
            {/* Scratch winnings */}
            {detail.scratch_winnings.map(w => (
              <div key={w.id} className={`px-5 py-2.5 flex items-center justify-between ${w.is_large_win ? 'bg-yellow-950/30' : ''}`}>
                <div>
                  <p className="text-white text-sm">
                    {t('nlcb.scratchWinningEntry', { game: w.game_name })}
                    {w.is_large_win && <span className="ml-2 text-xs text-yellow-400">{t('nlcb.largeWinLabel')}</span>}
                  </p>
                  {w.ticket_ref && <p className="text-slate-500 text-xs">{t('nlcb.refLabel', { ref: w.ticket_ref })}</p>}
                </div>
                <span className={`font-medium ${w.is_large_win ? 'text-yellow-400' : 'text-red-400'}`}>
                  {w.is_large_win ? '—' : `-${fmtM(w.amount)}`}
                </span>
              </div>
            ))}
            {/* Bill payments */}
            {detail.bill_payments.map(b => (
              <div key={b.id} className="px-5 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-white text-sm">{t('nlcb.billEntry', { biller: b.biller_name })}</p>
                  <p className="text-slate-500 text-xs">
                    {t('nlcb.billInfo', { collected: fmtM(b.amount_collected), fee: fmtM(b.flat_fee) })}
                    {b.customer_ref && ` · ${b.customer_ref}`}
                  </p>
                </div>
                <span className="text-teal-300 font-medium">{fmtM(b.flat_fee)}</span>
              </div>
            ))}
            {detail.sales.length === 0 && detail.payouts.length === 0 && detail.scratch_sales.length === 0 &&
             detail.scratch_winnings.length === 0 && detail.bill_payments.length === 0 && (
              <div className="flex items-center justify-center h-32 text-slate-500 text-sm">{t('nlcb.noTransactions')}</div>
            )}
          </div>
        )}
      </div>

      {modal === 'sales'        && <RecordSalesModal       sessionId={session.id} onClose={() => setModal(null)} />}
      {modal === 'payout'       && <RecordPayoutModal      sessionId={session.id} onClose={() => setModal(null)} />}
      {modal === 'scratch-sales'&& <RecordScratchSalesModal sessionId={session.id} onClose={() => setModal(null)} />}
      {modal === 'scratch-win'  && <RecordScratchWinningModal sessionId={session.id} onClose={() => setModal(null)} />}
      {modal === 'bill'         && <RecordBillPaymentModal  sessionId={session.id} onClose={() => setModal(null)} />}
      {modal === 'close'        && <CloseSessionModal       sessionId={session.id} onClose={() => setModal(null)} />}
    </div>
  )
}

// ── Sessions Tab ──────────────────────────────────────────────────────────────

function OpenSessionModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ session_date: today, cash_float_open: '', notes: '' })

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => nlcbApi.openSession({
      session_date: form.session_date, cash_float_open: Number(form.cash_float_open),
      notes: form.notes || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nlcb-sessions'] }); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('nlcb.openDailySession')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.sessionDate')}</label>
            <input type="date" value={form.session_date} onChange={e => setForm(f => ({ ...f, session_date: e.target.value }))} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.openingCashFloat')}</label>
            <input type="number" min="0" step="0.01" value={form.cash_float_open} onChange={e => setForm(f => ({ ...f, cash_float_open: e.target.value }))} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending || !form.cash_float_open}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('nlcb.opening') : t('nlcb.openSession')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function SessionsTab() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<SessionSummary | null>(null)
  const [showOpen, setShowOpen] = useState(false)

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['nlcb-sessions'],
    queryFn: () => nlcbApi.getSessions(),
  })

  const openSession = sessions.find(s => s.status === 'OPEN')

  return (
    <div className="flex h-full gap-0">
      <div className={`flex flex-col ${selected ? 'hidden lg:flex lg:w-80 lg:shrink-0' : 'flex-1'}`}>
        <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
          <span className="text-slate-400 text-sm">
            {openSession ? <span className="text-green-400">{t('nlcb.sessionOpenToday')}</span> : t('nlcb.noOpenSession')}
          </span>
          <button onClick={() => setShowOpen(true)} disabled={!!openSession}
            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors">
            {t('nlcb.openSessionBtn')}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-700/50">
          {isLoading && <div className="flex items-center justify-center h-32 text-slate-400">{t('common.loading')}</div>}
          {sessions.map((s: SessionSummary) => {
            const net = s.total_sales - s.total_payouts + s.total_commission
            return (
              <button key={s.id} onClick={() => setSelected(s)}
                className={`w-full text-left px-4 py-3 hover:bg-slate-700/40 transition-colors ${selected?.id === s.id ? 'bg-slate-700/60' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-white text-sm font-medium">{fmtDate(s.session_date)}</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${s.status === 'OPEN' ? 'bg-green-900/50 text-green-300 border border-green-700' : 'bg-slate-700 text-slate-400 border border-slate-600'}`}>
                    {s.status}
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
                  <span>{t('nlcb.salesLabel')} <span className="text-blue-300">{fmtM(s.total_sales)}</span></span>
                  <span>{t('nlcb.payoutsLabel')} <span className="text-red-400">{fmtM(s.total_payouts)}</span></span>
                  <span className="ml-auto text-green-400">{fmtM(net)}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
      {selected && (
        <div className="flex-1 border-l border-slate-700 bg-slate-800/50 overflow-hidden flex flex-col">
          <SessionDetailPanel session={selected} onClose={() => setSelected(null)} />
        </div>
      )}
      {showOpen && <OpenSessionModal onClose={() => setShowOpen(false)} />}
    </div>
  )
}

// ── Settlements Tab ───────────────────────────────────────────────────────────

function CreateSettlementModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const today = new Date()
  const dayOfWeek = today.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(today); monday.setDate(today.getDate() + mondayOffset)
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const toISO = (d: Date) => d.toISOString().slice(0, 10)

  const [form, setForm] = useState({ week_start: toISO(monday), week_end: toISO(sunday), notes: '' })

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => nlcbApi.createSettlement({ ...form, notes: form.notes || undefined, idempotency_key: uuidv4() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nlcb-settlements'] }); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">{t('nlcb.generateWeeklySettlement')}</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('nlcb.weekStart')}</label>
              <input type="date" value={form.week_start} onChange={e => setForm(f => ({ ...f, week_start: e.target.value }))} className={cls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">{t('nlcb.weekEnd')}</label>
              <input type="date" value={form.week_end} onChange={e => setForm(f => ({ ...f, week_end: e.target.value }))} className={cls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('nlcb.generating') : t('nlcb.generateSettlement')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function PaySettlementModal({ settlement, onClose }: { settlement: Settlement; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState({ paid_amount: String(settlement.net_owed), reference_number: '', notes: '' })

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => nlcbApi.paySettlement(settlement.id, {
      paid_amount: Number(form.paid_amount),
      reference_number: form.reference_number || undefined,
      notes: form.notes || undefined,
      idempotency_key: uuidv4(),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nlcb-settlements'] }); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-1 text-white">{t('nlcb.markSettlementPaid')}</h2>
        <p className="text-slate-400 text-sm mb-4">{fmtDate(settlement.week_start)} → {fmtDate(settlement.week_end)}</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.amountPaidTTD')}</label>
            <input type="number" step="0.01" value={form.paid_amount} onChange={e => setForm(f => ({ ...f, paid_amount: e.target.value }))} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('nlcb.referenceReceiptNo')}</label>
            <input value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} className={cls} />
          </div>
          {error && <p className="text-red-400 text-xs">{error instanceof Error ? error.message : 'Failed.'}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => mutate()} disabled={isPending}
            className="flex-1 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving') : t('nlcb.markPaid')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function SettlementsTab() {
  const { t } = useTranslation()
  const [showCreate, setShowCreate] = useState(false)
  const [paying, setPaying] = useState<Settlement | null>(null)

  const { data: settlements = [], isLoading } = useQuery({
    queryKey: ['nlcb-settlements'],
    queryFn: nlcbApi.getSettlements,
  })

  const pending = settlements.filter(s => s.status === 'PENDING')

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <span className="text-slate-400 text-sm">
          {pending.length > 0
            ? <span className="text-yellow-400">{t('nlcb.pendingSettlements', { count: pending.length })}</span>
            : t('nlcb.settlementCount', { count: settlements.length })}
        </span>
        <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-colors">{t('nlcb.generateSettlementBtn')}</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>}
        {settlements.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700 sticky top-0 bg-slate-800">
              <tr>
                {[t('nlcb.colWeek'), t('nlcb.colDrawSales'), t('nlcb.colPayouts'), t('nlcb.colCommissions'), t('nlcb.colBillFees'), t('nlcb.colNetOwed'), t('common.status'), ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settlements.map((s: Settlement) => (
                <tr key={s.id} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                  <td className="px-4 py-3 text-white text-xs">
                    <p>{fmtDate(s.week_start)}</p>
                    <p className="text-slate-500">→ {fmtDate(s.week_end)}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{fmtM(s.total_sales)}</td>
                  <td className="px-4 py-3 text-red-400 text-xs">{fmtM(s.total_payouts)}</td>
                  <td className="px-4 py-3 text-green-400 text-xs">{fmtM(s.total_commission + s.total_draw_cashing_commission + s.total_scratch_cashing_commission)}</td>
                  <td className="px-4 py-3 text-teal-300 text-xs">{fmtM(s.total_bill_fees)}</td>
                  <td className="px-4 py-3">
                    <span className={`font-semibold ${s.net_owed > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {fmtM(Math.abs(s.net_owed))} {s.net_owed > 0 ? t('nlcb.owed') : t('nlcb.due')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${s.status === 'PAID' ? 'bg-green-900/40 text-green-300' : 'bg-yellow-900/40 text-yellow-400'}`}>
                      {s.status}
                    </span>
                    {s.status === 'PAID' && s.paid_at && <p className="text-slate-500 text-xs mt-0.5">{fmtDate(s.paid_at)}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {s.status === 'PENDING' && (
                      <button onClick={() => setPaying(s)} className="text-xs text-green-400 hover:text-green-300 transition-colors">{t('nlcb.markPaid')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {showCreate && <CreateSettlementModal onClose={() => setShowCreate(false)} />}
      {paying && <PaySettlementModal settlement={paying} onClose={() => setPaying(null)} />}
    </div>
  )
}

// ── Catalogue Tabs ────────────────────────────────────────────────────────────

function GamesTab() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: games = [], isLoading } = useQuery({ queryKey: ['nlcb-games'], queryFn: nlcbApi.getGames })
  const [form, setForm] = useState({ name: '', draw_frequency: '', commission_rate: '' })
  const [adding, setAdding] = useState(false)

  const { mutate, isPending } = useMutation({
    mutationFn: () => nlcbApi.createGame({ name: form.name, draw_frequency: form.draw_frequency, commission_rate: Number(form.commission_rate) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nlcb-games'] }); setForm({ name: '', draw_frequency: '', commission_rate: '' }); setAdding(false) },
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <span className="text-slate-400 text-sm">{t('nlcb.gameCount', { count: games.length })}</span>
        <button onClick={() => setAdding(!adding)} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-colors">
          {adding ? t('common.cancel') : t('nlcb.addGame')}
        </button>
      </div>
      {adding && (
        <div className="px-4 py-3 border-b border-slate-700 flex items-end gap-3 bg-slate-800/80">
          <div className="flex-1"><label className="block text-xs text-slate-400 mb-1">{t('common.name')}</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={cls} /></div>
          <div className="flex-1"><label className="block text-xs text-slate-400 mb-1">{t('nlcb.drawFrequency')}</label><input value={form.draw_frequency} placeholder={t('nlcb.frequencyPlaceholder')} onChange={e => setForm(f => ({ ...f, draw_frequency: e.target.value }))} className={cls} /></div>
          <div className="w-32"><label className="block text-xs text-slate-400 mb-1">{t('nlcb.commissionPct')}</label><input type="number" min="0" max="100" step="0.1" value={form.commission_rate} onChange={e => setForm(f => ({ ...f, commission_rate: e.target.value }))} className={cls} /></div>
          <button onClick={() => mutate()} disabled={isPending || !form.name || !form.draw_frequency || !form.commission_rate}
            className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">{t('common.save')}</button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>}
        <table className="w-full text-sm">
          <thead className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700 sticky top-0 bg-slate-800">
            <tr>{[t('common.name'), t('nlcb.colFrequency'), t('nlcb.colCommission'), t('common.status')].map(h => <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {games.map((g: NLCBGame) => (
              <tr key={g.id} className="border-b border-slate-700/50">
                <td className="px-4 py-3 text-white font-medium">{g.name}</td>
                <td className="px-4 py-3 text-slate-400">{g.draw_frequency}</td>
                <td className="px-4 py-3 text-green-400">{g.commission_rate}%</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${g.is_active ? 'bg-green-900/40 text-green-300' : 'bg-slate-700 text-slate-400'}`}>{g.is_active ? t('nlcb.active') : t('nlcb.inactive')}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ScratchGamesTab() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: games = [], isLoading } = useQuery({ queryKey: ['nlcb-scratch-games'], queryFn: nlcbApi.getScratchGames })
  const [form, setForm] = useState({ name: '', denomination: '', commission_rate: '' })
  const [adding, setAdding] = useState(false)

  const { mutate, isPending } = useMutation({
    mutationFn: () => nlcbApi.createScratchGame({ name: form.name, denomination: Number(form.denomination), commission_rate: Number(form.commission_rate) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nlcb-scratch-games'] }); setForm({ name: '', denomination: '', commission_rate: '' }); setAdding(false) },
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <span className="text-slate-400 text-sm">{t('nlcb.scratchGameCount', { count: games.length })}</span>
        <button onClick={() => setAdding(!adding)} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-colors">
          {adding ? t('common.cancel') : t('nlcb.addScratchGame')}
        </button>
      </div>
      {adding && (
        <div className="px-4 py-3 border-b border-slate-700 flex items-end gap-3 bg-slate-800/80">
          <div className="flex-1"><label className="block text-xs text-slate-400 mb-1">{t('common.name')}</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={cls} /></div>
          <div className="w-32"><label className="block text-xs text-slate-400 mb-1">{t('nlcb.denominationLabel')}</label><input type="number" min="1" step="1" value={form.denomination} onChange={e => setForm(f => ({ ...f, denomination: e.target.value }))} className={cls} /></div>
          <div className="w-32"><label className="block text-xs text-slate-400 mb-1">{t('nlcb.commissionPct')}</label><input type="number" min="0" step="0.1" value={form.commission_rate} onChange={e => setForm(f => ({ ...f, commission_rate: e.target.value }))} className={cls} /></div>
          <button onClick={() => mutate()} disabled={isPending || !form.name || !form.denomination || !form.commission_rate}
            className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">{t('common.save')}</button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>}
        <table className="w-full text-sm">
          <thead className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700 sticky top-0 bg-slate-800">
            <tr>{[t('common.name'), t('nlcb.denominationLabel'), t('nlcb.colCommission'), t('common.status')].map(h => <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {games.map((g: NLCBScratchGame) => (
              <tr key={g.id} className="border-b border-slate-700/50">
                <td className="px-4 py-3 text-white font-medium">{g.name}</td>
                <td className="px-4 py-3 text-orange-300">${g.denomination}</td>
                <td className="px-4 py-3 text-green-400">{g.commission_rate}%</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${g.is_active ? 'bg-green-900/40 text-green-300' : 'bg-slate-700 text-slate-400'}`}>{g.is_active ? t('nlcb.active') : t('nlcb.inactive')}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BillersTab() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: billers = [], isLoading } = useQuery({ queryKey: ['nlcb-billers'], queryFn: nlcbApi.getBillers })
  const [form, setForm] = useState({ name: '', flat_fee: '' })
  const [adding, setAdding] = useState(false)

  const { mutate, isPending } = useMutation({
    mutationFn: () => nlcbApi.createBiller({ name: form.name, flat_fee: Number(form.flat_fee) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nlcb-billers'] }); setForm({ name: '', flat_fee: '' }); setAdding(false) },
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <span className="text-slate-400 text-sm">{t('nlcb.billerCount', { count: billers.length })}</span>
        <button onClick={() => setAdding(!adding)} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-colors">
          {adding ? t('common.cancel') : t('nlcb.addBiller')}
        </button>
      </div>
      {adding && (
        <div className="px-4 py-3 border-b border-slate-700 flex items-end gap-3 bg-slate-800/80">
          <div className="flex-1"><label className="block text-xs text-slate-400 mb-1">{t('nlcb.billerNameLabel')}</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="TSTT, T&TEC, WASA…" className={cls} /></div>
          <div className="w-36"><label className="block text-xs text-slate-400 mb-1">{t('nlcb.flatFeeTTD')}</label><input type="number" min="0" step="0.01" value={form.flat_fee} onChange={e => setForm(f => ({ ...f, flat_fee: e.target.value }))} className={cls} /></div>
          <button onClick={() => mutate()} disabled={isPending || !form.name || form.flat_fee === ''}
            className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">{t('common.save')}</button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>}
        <table className="w-full text-sm">
          <thead className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700 sticky top-0 bg-slate-800">
            <tr>{[t('nlcb.colBiller'), t('nlcb.colFlatFee'), t('common.status')].map(h => <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {billers.map((b: NLCBBiller) => (
              <tr key={b.id} className="border-b border-slate-700/50">
                <td className="px-4 py-3 text-white font-medium">{b.name}</td>
                <td className="px-4 py-3 text-teal-300">{fmtM(b.flat_fee)}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${b.is_active ? 'bg-green-900/40 text-green-300' : 'bg-slate-700 text-slate-400'}`}>{b.is_active ? t('nlcb.active') : t('nlcb.inactive')}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type NLCBTab = 'sessions' | 'settlements' | 'games' | 'scratch-games' | 'billers'

export default function NLCB() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<NLCBTab>('sessions')

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="px-6 py-4 border-b border-slate-700">
        <h1 className="text-xl font-semibold text-white">{t('nlcb.title')}</h1>
        <p className="text-slate-400 text-sm mt-0.5">{t('nlcb.subtitle')}</p>
      </div>
      <div className="flex border-b border-slate-700 px-6">
        {([
          { key: 'sessions',     label: t('nlcb.tabSessions') },
          { key: 'settlements',  label: t('nlcb.tabSettlements') },
          { key: 'games',        label: t('nlcb.tabDrawGames') },
          { key: 'scratch-games',label: t('nlcb.tabScratchGames') },
          { key: 'billers',      label: t('nlcb.tabBillers') },
        ] as { key: NLCBTab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key ? 'border-orange-500 text-orange-400' : 'border-transparent text-slate-400 hover:text-white'
            }`}>{label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'sessions'      && <SessionsTab />}
        {tab === 'settlements'   && <SettlementsTab />}
        {tab === 'games'         && <GamesTab />}
        {tab === 'scratch-games' && <ScratchGamesTab />}
        {tab === 'billers'       && <BillersTab />}
      </div>
    </div>
  )
}
