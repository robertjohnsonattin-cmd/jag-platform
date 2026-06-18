export type Venue = 'BAR' | 'CLUB'
export type ProductCategory = 'DRINK' | 'FOOD' | 'MERCHANDISE' | 'OTHER'
export type TabStatus = 'OPEN' | 'CLOSED' | 'SETTLED' | 'VOIDED'
export type PaymentMethod = 'CASH' | 'CARD' | 'MEMBER_CREDIT' | 'COMPLIMENTARY'
export type MemberStatus = 'ACTIVE' | 'SUSPENDED' | 'EXPIRED'
export type IdType = 'NATIONAL_ID' | 'PASSPORT' | 'DRIVERS_LICENSE' | 'OTHER'
export type EventVenue = 'BAR' | 'CLUB' | 'BOTH'

// ── BAR ───────────────────────────────────────────────────────────────────────

export interface Product {
  id: string
  name: string
  category: ProductCategory
  price: number
  cost: number | null
  sku: string | null
  stock_qty: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface TabItem {
  id: string
  product_id: string
  product_name: string
  category: ProductCategory
  quantity: number
  unit_price: number
  notes: string | null
  voided: boolean
  created_at: string
}

export interface TabPayment {
  id: string
  method: PaymentMethod
  amount: number
  reference: string | null
  created_at: string
}

export interface Tab {
  id: string
  tab_number: string
  venue: Venue
  customer_name: string | null
  member_id: string | null
  member_name: string | null
  table_ref: string | null
  status: TabStatus
  discount_pct: number
  subtotal: number
  total: number
  staff_user_id: string
  opened_at: string
  closed_at: string | null
  settled_at: string | null
}

export interface TabDetail extends Tab {
  items: TabItem[]
  payments: TabPayment[]
}

export interface BarConfig {
  tenant_id: string
  vat_pct: number
  service_charge_pct: number
  bar_license_expiry: string | null
  club_license_expiry: string | null
  created_at?: string
  updated_at?: string
}

// ── CLUB ──────────────────────────────────────────────────────────────────────

export interface Member {
  id: string
  member_number: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  credit_balance: number
  status: MemberStatus
  crm_contact_id: string | null
  created_at: string
  updated_at: string
}

export interface ActiveMembership {
  id: string
  started_at: string
  expires_at: string | null
  status: string
  tier_id: string
  tier_name: string
  bar_discount_pct: number
  guest_passes_per_month: number
  monthly_fee: number
}

export interface MemberDetail extends Member {
  active_membership?: ActiveMembership
}

export interface Membership {
  id: string
  tier_id: string
  tier_name: string
  bar_discount_pct: number
  started_at: string
  expires_at: string | null
  status: string
  created_at: string
}

export interface CreditEntry {
  id: string
  amount: number
  description: string
  tab_payment_id: string | null
  created_at: string
}

export interface CreditsResponse {
  balance: number
  ledger: CreditEntry[]
}

export interface Tier {
  id: string
  name: string
  monthly_fee: number
  bar_discount_pct: number
  guest_passes_per_month: number
  credit_on_join: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ClubEvent {
  id: string
  title: string
  venue: EventVenue
  starts_at: string
  ends_at: string | null
  capacity: number | null
  ticket_price: number
  member_price: number
  confirmed_bookings: number
}

export interface Booking {
  id: string
  member_id: string
  member_name: string
  guests: number
  amount_paid: number
  payment_method: PaymentMethod
  status: 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED'
  created_at: string
}

export interface EventDetail extends ClubEvent {
  description: string | null
  waitlisted_bookings: number
  bookings: Booking[]
}

export interface VisitorLog {
  id: string
  visitor_name: string
  id_type: IdType
  id_number: string
  address: string
  member_id: string | null
  member_name: string | null
  admitted_by: string
  time_in: string
  time_out: string | null
  notes: string | null
}

export interface ChipFloat {
  id: string
  float_date: string
  status: 'OPEN' | 'CLOSED'
  opening_cash: number
  opening_chips: number
  closing_cash: number | null
  closing_chips: number | null
  cash_in_ttd: number | null
  cash_variance: number | null
  chips_variance: number | null
  opened_by: string
  closed_by: string | null
  opened_at: string
  closed_at: string | null
  notes: string | null
}

// ── Shared ────────────────────────────────────────────────────────────────────

export interface Utility {
  id: string
  venue: Venue
  description: string
  amount: number
  bill_date: string
  due_date: string | null
  paid: boolean
  paid_at: string | null
  created_at: string
}

export interface SupplierInvoice {
  id: string
  venue: Venue
  supplier_name: string
  invoice_number: string | null
  net_amount: number
  vat_amount: number
  gross_amount: number
  invoice_date: string
  due_date: string | null
  status: 'PENDING' | 'APPROVED' | 'PAID'
  created_at: string
}

export interface PLReport {
  venue: Venue
  period: { from: string; to: string }
  revenue: {
    tab_count: number
    subtotal: number
    discount_total: number
    service_charge_total: number
    vat_total: number
    total: number
  }
  expenses: {
    utilities: { count: number; net_amount: number; vat: number; gross: number }
    supplier_invoices: { count: number; net_amount: number; vat: number; gross: number }
    total: number
  }
  net_pl: number
}
