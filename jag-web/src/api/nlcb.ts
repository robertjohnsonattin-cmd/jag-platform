import { tenantApi } from './client'

const NLCB_TENANT = '00000000-0000-0000-0001-000000000007'
const client = tenantApi(NLCB_TENANT)

export interface NLCBGame {
  id: string; name: string; draw_frequency: string
  commission_rate: number; is_active: boolean
  created_at: string; last_modified_at: string
}

export interface NLCBScratchGame {
  id: string; name: string; denomination: number
  commission_rate: number; is_active: boolean
  created_at: string; last_modified_at: string
}

export interface NLCBBiller {
  id: string; name: string; flat_fee: number
  is_active: boolean; created_at: string; last_modified_at: string
}

export type SessionStatus = 'OPEN' | 'CLOSED'

export interface SessionSummary {
  id: string; session_date: string; status: SessionStatus
  cash_float_open: number; cash_float_close: number | null
  opened_at: string; closed_at: string | null
  total_sales: number; total_commission: number; total_payouts: number
}

export interface SessionSale {
  id: string; game_id: string; game_name: string
  gross_sales: number; commission_amount: number; created_at: string
}

export interface SessionPayout {
  id: string; game_id: string; game_name: string
  payout_amount: number; ticket_ref: string | null; notes: string | null; created_at: string
}

export interface SessionScratchSale {
  id: string; game_id: string; game_name: string; denomination: number
  tickets_sold: number; gross_amount: number; commission_amount: number; created_at: string
}

export interface SessionScratchWinning {
  id: string; game_id: string; game_name: string
  amount: number; is_large_win: boolean
  cashing_commission_amount: number; ticket_ref: string | null; created_at: string
}

export interface SessionBillPayment {
  id: string; biller_id: string; biller_name: string
  amount_collected: number; flat_fee: number
  customer_ref: string | null; created_at: string
}

export interface SessionDetail extends SessionSummary {
  notes: string | null
  sales:           SessionSale[]
  payouts:         SessionPayout[]
  scratch_sales:   SessionScratchSale[]
  scratch_winnings:SessionScratchWinning[]
  bill_payments:   SessionBillPayment[]
}

export interface Settlement {
  id: string; week_start: string; week_end: string
  total_sales: number; total_payouts: number; total_commission: number
  total_draw_cashing_commission: number
  total_scratch_winnings_paid: number; total_scratch_cashing_commission: number
  total_bill_collections: number; total_bill_fees: number
  net_owed: number; status: 'PENDING' | 'PAID'
  paid_at: string | null; paid_amount: number | null; reference_number: string | null
  created_at: string
}

export const nlcbApi = {
  // ── Reference data ────────────────────────────────────────────────────────

  getGames: (): Promise<NLCBGame[]> =>
    client.get('/nlcb/games'),

  createGame: (data: { name: string; draw_frequency: string; commission_rate: number }): Promise<NLCBGame> =>
    client.post('/nlcb/games', data),

  updateGame: (id: string, data: Partial<NLCBGame>): Promise<NLCBGame> =>
    client.patch(`/nlcb/games/${id}`, data),

  getScratchGames: (): Promise<NLCBScratchGame[]> =>
    client.get('/nlcb/scratch-games'),

  createScratchGame: (data: { name: string; denomination: number; commission_rate: number }): Promise<NLCBScratchGame> =>
    client.post('/nlcb/scratch-games', data),

  getBillers: (): Promise<NLCBBiller[]> =>
    client.get('/nlcb/billers'),

  createBiller: (data: { name: string; flat_fee: number }): Promise<NLCBBiller> =>
    client.post('/nlcb/billers', data),

  // ── Sessions ──────────────────────────────────────────────────────────────

  getSessions: (params?: { date_from?: string; date_to?: string }): Promise<SessionSummary[]> => {
    const q = new URLSearchParams()
    if (params?.date_from) q.set('date_from', params.date_from)
    if (params?.date_to)   q.set('date_to',   params.date_to)
    const qs = q.toString()
    return client.get(`/nlcb/sessions${qs ? `?${qs}` : ''}`)
  },

  getSession: (id: string): Promise<SessionDetail> =>
    client.get(`/nlcb/sessions/${id}`),

  openSession: (data: { session_date: string; cash_float_open: number; notes?: string }): Promise<{ id: string }> =>
    client.post('/nlcb/sessions', data),

  recordSales: (sessionId: string, game_id: string, gross_sales: number, idempotency_key: string): Promise<{ id: string; already_processed: boolean }> =>
    client.post(`/nlcb/sessions/${sessionId}/sales`, { game_id, gross_sales, idempotency_key }),

  recordPayout: (sessionId: string, data: { game_id: string; payout_amount: number; ticket_ref?: string; notes?: string; idempotency_key: string }): Promise<{ id: string; already_processed: boolean }> =>
    client.post(`/nlcb/sessions/${sessionId}/payouts`, data),

  closeSession: (sessionId: string, cash_float_close: number, notes?: string): Promise<{ id: string; status: string }> =>
    client.patch(`/nlcb/sessions/${sessionId}/close`, { cash_float_close, notes }),

  recordScratchSales: (sessionId: string, data: { game_id: string; tickets_sold: number; pack_purchase_id?: string; idempotency_key: string }): Promise<{ id: string }> =>
    client.post(`/nlcb/sessions/${sessionId}/scratch-sales`, data),

  recordScratchWinning: (sessionId: string, data: { game_id: string; amount: number; ticket_ref?: string; notes?: string; idempotency_key: string }): Promise<{ id: string; is_large_win: boolean }> =>
    client.post(`/nlcb/sessions/${sessionId}/scratch-winnings`, data),

  recordBillPayment: (sessionId: string, data: { biller_id: string; amount_collected: number; customer_ref?: string; idempotency_key: string }): Promise<{ id: string }> =>
    client.post(`/nlcb/sessions/${sessionId}/bill-payments`, data),

  // ── Settlements ───────────────────────────────────────────────────────────

  getSettlements: (): Promise<Settlement[]> =>
    client.get('/nlcb/settlements'),

  createSettlement: (data: { week_start: string; week_end: string; notes?: string; idempotency_key: string }): Promise<{ id: string }> =>
    client.post('/nlcb/settlements', data),

  paySettlement: (id: string, data: { paid_amount: number; reference_number?: string; notes?: string; idempotency_key: string }): Promise<{ id: string }> =>
    client.patch(`/nlcb/settlements/${id}/pay`, data),
}
