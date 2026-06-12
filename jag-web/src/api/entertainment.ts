import { tenantApi } from './client'
import type {
  Product, Tab, TabDetail, TabItem, TabPayment, BarConfig,
  Member, MemberDetail, Membership, CreditsResponse, CreditEntry,
  Tier, ClubEvent, EventDetail, Booking,
  VisitorLog, ChipFloat,
  PLReport,
  Venue, ProductCategory, PaymentMethod, IdType, EventVenue,
} from '../types/entertainment'

const ENT_TENANT = '00000000-0000-0000-0001-000000000004'
const c = tenantApi(ENT_TENANT)

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

// ── BAR — Products ────────────────────────────────────────────────────────────

export const barProductsApi = {
  list: (params: { category?: ProductCategory; active?: boolean } = {}): Promise<Product[]> =>
    c.get(`/bar/products${qs(params)}`),

  create: (data: {
    name: string; category: ProductCategory; price: number
    cost?: number; sku?: string; stock_qty?: number
  }): Promise<Product> =>
    c.post('/bar/products', data),

  update: (id: string, data: Partial<{
    name: string; category: ProductCategory; price: number
    cost: number; sku: string; stock_qty: number | null; is_active: boolean
  }>): Promise<Product> =>
    c.patch(`/bar/products/${id}`, data),
}

// ── BAR — Tabs ────────────────────────────────────────────────────────────────

export const barTabsApi = {
  list: (params: { status?: string; venue?: Venue } = {}): Promise<Tab[]> =>
    c.get(`/bar/tabs${qs(params)}`),

  get: (id: string): Promise<TabDetail> =>
    c.get(`/bar/tabs/${id}`),

  open: (data: {
    venue: Venue; customer_name?: string; member_id?: string
    table_ref?: string; add_service_charge?: boolean
  }): Promise<Tab> =>
    c.post('/bar/tabs', data),

  addItem: (tabId: string, data: {
    product_id: string; quantity: number; notes?: string
  }): Promise<TabItem> =>
    c.post(`/bar/tabs/${tabId}/items`, data),

  voidItem: (tabId: string, itemId: string): Promise<TabItem> =>
    c.post(`/bar/tabs/${tabId}/items/${itemId}/void`, {}),

  close: (tabId: string): Promise<TabDetail> =>
    c.post(`/bar/tabs/${tabId}/close`, {}),

  settle: (tabId: string, data: {
    method: PaymentMethod; amount: number
    reference?: string; idempotency_key: string
  }): Promise<{ payment: TabPayment; tab: Tab }> =>
    c.post(`/bar/tabs/${tabId}/settle`, data),

  void: (tabId: string): Promise<Tab> =>
    c.post(`/bar/tabs/${tabId}/void`, {}),
}

// ── BAR — Config ──────────────────────────────────────────────────────────────

export const barConfigApi = {
  get: (): Promise<BarConfig> => c.get('/bar/config'),
  update: (data: Partial<{
    vat_pct: number; service_charge_pct: number
    bar_license_expiry: string; club_license_expiry: string
  }>): Promise<BarConfig> => c.patch('/bar/config', data),
}

// ── Shared — Utilities & Invoices ─────────────────────────────────────────────

export type UtilityType = 'ELECTRICITY' | 'WATER' | 'GAS' | 'INTERNET' | 'OTHER'

export interface UtilityBill {
  id: string; venue: Venue; utility_type: UtilityType; provider: string
  bill_date: string; paid_date: string | null; amount: number
  vat_code: string; vat_amount: number; notes: string | null
  idempotency_key: string; created_at: string; updated_at: string
}

export interface SupplierInvoiceRaw {
  id: string; venue: Venue; supplier_name: string; invoice_ref: string | null
  invoice_date: string; due_date: string | null; amount: number
  vat_code: string; vat_amount: number; status: 'PENDING' | 'APPROVED' | 'PAID'
  approved_by: string | null; approved_at: string | null
  paid_date: string | null; payment_reference: string | null
  notes: string | null; idempotency_key: string; created_at: string; updated_at: string
}

function makeSharedApi(prefix: string) {
  return {
    utilities: {
      list: (): Promise<{ utility_bills: UtilityBill[]; pagination: { page: number; limit: number; total: number; pages: number } }> =>
        c.get(`/${prefix}/utilities`),
      create: (data: {
        utility_type: UtilityType; provider: string; bill_date: string
        amount: number; vat_amount?: number; notes?: string; idempotency_key: string
      }): Promise<UtilityBill> => c.post(`/${prefix}/utilities`, data),
    },
    invoices: {
      list: (): Promise<{ supplier_invoices: SupplierInvoiceRaw[]; pagination: { page: number; limit: number; total: number; pages: number } }> =>
        c.get(`/${prefix}/supplier-invoices`),
      create: (data: {
        supplier_name: string; amount: number; vat_amount?: number
        invoice_date: string; invoice_ref?: string; due_date?: string
        notes?: string; idempotency_key: string
      }): Promise<SupplierInvoiceRaw> => c.post(`/${prefix}/supplier-invoices`, data),
      approve: (id: string): Promise<SupplierInvoiceRaw> =>
        c.patch(`/${prefix}/supplier-invoices/${id}/approve`, {}),
      pay: (id: string, data: { paid_date: string; payment_reference?: string }): Promise<SupplierInvoiceRaw> =>
        c.patch(`/${prefix}/supplier-invoices/${id}/pay`, data),
    },
  }
}

export const barSharedApi = makeSharedApi('bar')
export const clubSharedApi = makeSharedApi('club')

// ── CLUB — Members ────────────────────────────────────────────────────────────

export const clubMembersApi = {
  list: (params: { status?: string; search?: string } = {}): Promise<Member[]> =>
    c.get(`/club/members${qs(params)}`),

  get: (id: string): Promise<MemberDetail> =>
    c.get(`/club/members/${id}`),

  create: (data: {
    first_name: string; last_name: string
    email?: string; phone?: string; date_of_birth?: string; notes?: string
  }): Promise<Member> =>
    c.post('/club/members', data),

  update: (id: string, data: Partial<{
    first_name: string; last_name: string; email: string; phone: string
    date_of_birth: string; notes: string; status: string
  }>): Promise<Member> =>
    c.patch(`/club/members/${id}`, data),

  getMemberships: (id: string): Promise<Membership[]> =>
    c.get(`/club/members/${id}/memberships`),

  subscribe: (id: string, data: {
    tier_id: string; started_at: string; expires_at?: string; idempotency_key: string
  }): Promise<Membership> =>
    c.post(`/club/members/${id}/memberships`, data),

  cancelMembership: (memberId: string, msId: string, data: {
    status: 'CANCELLED' | 'EXPIRED'; expires_at?: string
  }): Promise<Membership> =>
    c.patch(`/club/members/${memberId}/memberships/${msId}`, data),

  getCredits: (id: string): Promise<CreditsResponse> =>
    c.get(`/club/members/${id}/credits`),

  addCredit: (id: string, data: {
    amount: number; description: string; idempotency_key: string
  }): Promise<CreditEntry> =>
    c.post(`/club/members/${id}/credits`, data),
}

// ── CLUB — Tiers ──────────────────────────────────────────────────────────────

export const clubTiersApi = {
  list: (active = true): Promise<Tier[]> =>
    c.get(`/club/tiers${qs({ active })}`),

  create: (data: {
    name: string; monthly_fee?: number; bar_discount_pct?: number
    guest_passes_per_month?: number; credit_on_join?: number
  }): Promise<Tier> =>
    c.post('/club/tiers', data),

  update: (id: string, data: Partial<{
    name: string; monthly_fee: number; bar_discount_pct: number
    guest_passes_per_month: number; credit_on_join: number; is_active: boolean
  }>): Promise<Tier> =>
    c.patch(`/club/tiers/${id}`, data),
}

// ── CLUB — Events ─────────────────────────────────────────────────────────────

export const clubEventsApi = {
  list: (params: { venue?: EventVenue; upcoming?: boolean } = {}): Promise<ClubEvent[]> =>
    c.get(`/club/events${qs(params)}`),

  get: (id: string): Promise<EventDetail> =>
    c.get(`/club/events/${id}`),

  create: (data: {
    title: string; venue: EventVenue; starts_at: string
    description?: string; ends_at?: string; capacity?: number
    ticket_price?: number; member_price?: number
  }): Promise<ClubEvent> =>
    c.post('/club/events', data),

  book: (eventId: string, data: {
    member_id: string; guests?: number; amount_paid?: number
    payment_method?: PaymentMethod; idempotency_key: string
  }): Promise<Booking> =>
    c.post(`/club/events/${eventId}/bookings`, data),
}

// ── CLUB — Visitor Log ────────────────────────────────────────────────────────

export const clubVisitorApi = {
  list: (params: { date?: string; member_id?: string } = {}): Promise<VisitorLog[]> =>
    c.get(`/club/visitor-log${qs(params)}`),

  logIn: (data: {
    visitor_name: string; id_type: IdType; id_number: string
    address: string; member_id?: string; notes?: string
  }): Promise<VisitorLog> =>
    c.post('/club/visitor-log', data),

  checkOut: (id: string, data: { notes?: string }): Promise<VisitorLog> =>
    c.patch(`/club/visitor-log/${id}/checkout`, data),
}

// ── CLUB — Chip Float ─────────────────────────────────────────────────────────

export const clubFloatApi = {
  list: (): Promise<ChipFloat[]> => c.get('/club/chip-float'),
  get: (id: string): Promise<ChipFloat> => c.get(`/club/chip-float/${id}`),

  open: (data: {
    float_date: string; opening_cash: number; opening_chips: number; notes?: string
  }): Promise<ChipFloat> =>
    c.post('/club/chip-float', data),

  close: (id: string, data: {
    closing_cash: number; closing_chips: number; notes?: string
  }): Promise<ChipFloat> =>
    c.patch(`/club/chip-float/${id}/close`, data),
}

// ── P&L Report ────────────────────────────────────────────────────────────────

export const entertainmentReportsApi = {
  pl: (params: { venue: Venue; from: string; to: string }): Promise<PLReport> =>
    c.get(`/entertainment/reports/pl${qs(params)}`),
}

