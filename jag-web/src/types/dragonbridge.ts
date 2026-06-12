export type QuoteStatus    = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED'
export type OrderStatus    = 'CONFIRMED' | 'IN_PRODUCTION' | 'READY_TO_SHIP' | 'IN_TRANSIT' | 'CUSTOMS' | 'DELIVERED' | 'CANCELLED'
export type ShipmentStatus = 'BOOKING' | 'LOADING' | 'IN_TRANSIT' | 'ARRIVED' | 'CLEARED'
export type JagRole        = 'AGENT' | 'IMPORTER'
export type InvoiceStatus  = 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID'
export type ReconStatus    = 'PENDING_REVIEW' | 'APPROVED'

export interface DBConfig {
  deposit_pct_default:          number
  balance_trigger:              'PRE_DELIVERY' | 'ON_DELIVERY'
  variance_threshold_pct:       number
  default_vat_pct:              number
  agency_fee_pct:               number
  freight_apportionment_method: 'CBM' | 'VALUE' | 'EQUAL'
  updated_at:                   string
}

export interface DBSupplier {
  id:             string
  name:           string
  contact_name:   string | null
  contact_email:  string | null
  contact_phone:  string | null
  currency:       string
  payment_terms:  string | null
  is_active:      boolean
  created_at:     string
  last_modified_at: string
}

export interface DBProduct {
  id:            string
  name:          string
  description:   string | null
  hs_code:       string
  unit_cost_cny: number
  unit:          string
  duty_rate:     number
  is_active:     boolean
  supplier_id:   string
  supplier_name: string
  created_at:    string
  last_modified_at: string
}

export interface DBClient {
  id:                 string
  client_type:        'B2B' | 'B2C'
  name:               string
  company_name:       string | null
  contact_name:       string | null
  contact_email:      string | null
  contact_phone:      string | null
  is_active:          boolean
  pricing_tier_id:    string | null
  pricing_tier_name:  string | null
  default_margin_pct: number | null
  created_at:         string
}

export interface DBPricingTier {
  id:                string
  name:              string
  default_margin_pct:number
  notes:             string | null
  is_active:         boolean
}

export interface QuoteSummary {
  id:                     string
  jag_role:               JagRole
  status:                 QuoteStatus
  total_ttd:              number
  fx_cny_usd:             number
  fx_usd_ttd:             number
  est_freight_usd:        number
  est_insurance_usd:      number
  est_local_delivery_ttd: number
  margin_pct:             number | null
  agency_fee_pct:         number | null
  valid_until:            string | null
  client_name:            string
  item_count:             number
  created_at:             string
  last_modified_at:       string
}

export interface QuoteItem {
  id:                 string
  product_id:         string | null
  product_name:       string
  hs_code:            string
  unit_cost_cny:      number
  duty_rate:          number
  qty:                number
  unit:               string
  supplier_cost_ttd:  number
  freight_share_ttd:  number
  insurance_share_ttd:number
  cif_ttd:            number
  duty_ttd:           number
  vat_ttd:            number
  item_landed_cost:   number
  gross_volume_cbm:   number | null
  notes:              string | null
}

export interface QuoteDetail extends QuoteSummary {
  client_id:          string
  notes:              string | null
  est_agency_fee_ttd: number | null
  items:              QuoteItem[]
}

export interface OrderSummary {
  id:                string
  jag_role:          JagRole
  status:            OrderStatus
  quoted_total_ttd:  number
  deposit_pct:       number
  deposit_amount_ttd:number
  deposit_paid:      boolean
  client_name:       string
  quote_id:          string | null
  shipment_id:       string | null
  created_at:        string
  last_modified_at:  string
}

export interface OrderInvoice {
  id:           string
  invoice_type: string
  status:       InvoiceStatus
  amount_ttd:   number
  issued_at:    string | null
  paid_at:      string | null
}

export interface OrderDelivery {
  id:               string
  status:           string
  delivery_address: string
  contact_name:     string | null
  contact_phone:    string | null
  cost_ttd:         number
  scheduled_date:   string | null
  dispatched_at:    string | null
  delivered_at:     string | null
  notes:            string | null
}

export interface OrderDetail extends OrderSummary {
  client_id:    string
  invoices:     OrderInvoice[]
  delivery:     OrderDelivery | null
}

export interface ShipmentSummary {
  id:                  string
  status:              ShipmentStatus
  container_ref:       string | null
  vessel_name:         string | null
  port_of_origin:      string
  port_of_destination: string
  etd:                 string | null
  eta:                 string | null
  atd:                 string | null
  ata:                 string | null
  freight_forwarder:   string | null
  order_count:         number
  created_at:          string
}

export interface Reconciliation {
  id:               string
  order_id:         string
  status:           ReconStatus
  quoted_total_ttd: number
  actual_total_ttd: number | null
  variance_ttd:     number | null
  variance_pct:     number | null
  approved_at:      string | null
  client_name:      string
  jag_role:         JagRole
  created_at:       string
}
