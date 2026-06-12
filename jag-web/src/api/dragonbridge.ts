import { tenantApi } from './client'
import type {
  DBConfig, DBSupplier, DBProduct, DBClient, DBPricingTier,
  QuoteSummary, QuoteDetail, OrderSummary, OrderDetail,
  ShipmentSummary, Reconciliation,
} from '../types/dragonbridge'

// DragonBridge tenant UUID
const DB_TENANT = '00000000-0000-0000-0001-000000000006'
const client = tenantApi(DB_TENANT)

export const dbApi = {
  // ── Config ────────────────────────────────────────────────────────────────

  getConfig: (): Promise<DBConfig> =>
    client.get('/dragonbridge/config'),

  updateConfig: (data: Partial<DBConfig>): Promise<DBConfig> =>
    client.patch('/dragonbridge/config', data),

  // ── Suppliers ─────────────────────────────────────────────────────────────

  getSuppliers: (): Promise<DBSupplier[]> =>
    client.get('/dragonbridge/suppliers'),

  createSupplier: (data: {
    name: string; contact_name?: string; contact_email?: string;
    contact_phone?: string; address?: string; currency?: string;
    payment_terms?: string; notes?: string;
  }): Promise<DBSupplier> =>
    client.post('/dragonbridge/suppliers', data),

  updateSupplier: (id: string, data: Partial<DBSupplier & { is_active: boolean }>): Promise<DBSupplier> =>
    client.patch(`/dragonbridge/suppliers/${id}`, data),

  // ── Products ──────────────────────────────────────────────────────────────

  getProducts: (params: { supplier_id?: string; active?: boolean } = {}): Promise<DBProduct[]> => {
    const q = new URLSearchParams()
    if (params.supplier_id) q.set('supplier_id', params.supplier_id)
    if (params.active === false) q.set('active', 'false')
    const qs = q.toString()
    return client.get(`/dragonbridge/products${qs ? `?${qs}` : ''}`)
  },

  createProduct: (data: {
    supplier_id: string; name: string; description?: string;
    hs_code: string; unit_cost_cny: number; unit?: string;
    duty_rate: number; notes?: string;
  }): Promise<DBProduct> =>
    client.post('/dragonbridge/products', data),

  updateProduct: (id: string, data: Partial<DBProduct & { is_active: boolean }>): Promise<DBProduct> =>
    client.patch(`/dragonbridge/products/${id}`, data),

  // ── Pricing Tiers ─────────────────────────────────────────────────────────

  getPricingTiers: (): Promise<DBPricingTier[]> =>
    client.get('/dragonbridge/pricing-tiers'),

  createPricingTier: (data: { name: string; default_margin_pct: number; notes?: string }): Promise<DBPricingTier> =>
    client.post('/dragonbridge/pricing-tiers', data),

  // ── Clients ───────────────────────────────────────────────────────────────

  getClients: (params: { type?: string; active?: boolean } = {}): Promise<DBClient[]> => {
    const q = new URLSearchParams()
    if (params.type) q.set('type', params.type)
    if (params.active === false) q.set('active', 'false')
    const qs = q.toString()
    return client.get(`/dragonbridge/clients${qs ? `?${qs}` : ''}`)
  },

  createClient: (data: {
    client_type: 'B2B' | 'B2C'; name: string; company_name?: string;
    contact_name?: string; contact_email?: string; contact_phone?: string;
    address?: string; pricing_tier_id?: string; notes?: string;
  }): Promise<DBClient> =>
    client.post('/dragonbridge/clients', data),

  updateClient: (id: string, data: Partial<DBClient & { is_active: boolean; notes: string }>): Promise<DBClient> =>
    client.patch(`/dragonbridge/clients/${id}`, data),

  // ── Quotes ────────────────────────────────────────────────────────────────

  getQuotes: (params: { status?: string } = {}): Promise<QuoteSummary[]> => {
    const q = new URLSearchParams()
    if (params.status) q.set('status', params.status)
    const qs = q.toString()
    return client.get(`/dragonbridge/quotes${qs ? `?${qs}` : ''}`)
  },

  getQuote: (id: string): Promise<QuoteDetail> =>
    client.get(`/dragonbridge/quotes/${id}`),

  createQuote: (data: {
    client_id: string; jag_role: 'AGENT' | 'IMPORTER';
    margin_pct?: number; agency_fee_pct?: number;
    fx_cny_usd: number; fx_usd_ttd: number;
    est_freight_usd?: number; est_insurance_usd?: number;
    est_local_delivery_ttd?: number; notes?: string; valid_until?: string;
  }): Promise<{ id: string }> =>
    client.post('/dragonbridge/quotes', data),

  addQuoteItem: (quoteId: string, data: {
    product_id?: string; product_name: string; hs_code: string;
    unit_cost_cny: number; duty_rate: number; qty: number; unit: string;
    gross_volume_cbm?: number; notes?: string;
  }): Promise<{ id: string }> =>
    client.post(`/dragonbridge/quotes/${quoteId}/items`, data),

  removeQuoteItem: (quoteId: string, itemId: string): Promise<{ deleted: boolean }> =>
    client.delete(`/dragonbridge/quotes/${quoteId}/items/${itemId}`),

  sendQuote: (id: string): Promise<{ id: string; status: string }> =>
    client.patch(`/dragonbridge/quotes/${id}/send`, {}),

  acceptQuote: (id: string): Promise<{ quote_id: string; order_id: string }> =>
    client.patch(`/dragonbridge/quotes/${id}/accept`, {}),

  cancelQuote: (id: string): Promise<{ id: string; status: string }> =>
    client.patch(`/dragonbridge/quotes/${id}/cancel`, {}),

  // ── Orders ────────────────────────────────────────────────────────────────

  getOrders: (params: { status?: string; client_id?: string } = {}): Promise<OrderSummary[]> => {
    const q = new URLSearchParams()
    if (params.status)    q.set('status', params.status)
    if (params.client_id) q.set('client_id', params.client_id)
    const qs = q.toString()
    return client.get(`/dragonbridge/orders${qs ? `?${qs}` : ''}`)
  },

  getOrder: (id: string): Promise<OrderDetail> =>
    client.get(`/dragonbridge/orders/${id}`),

  updateOrderStatus: (id: string, status: string, notes?: string): Promise<{ id: string; status: string }> =>
    client.patch(`/dragonbridge/orders/${id}/status`, { status, notes }),

  recordDeposit: (id: string, idempotency_key: string, notes?: string): Promise<{ already_processed: boolean }> =>
    client.post(`/dragonbridge/orders/${id}/deposit`, { idempotency_key, notes }),

  createDelivery: (id: string, data: {
    delivery_address: string; contact_name?: string; contact_phone?: string;
    cost_ttd?: number; scheduled_date?: string; notes?: string; idempotency_key: string;
  }): Promise<{ id: string }> =>
    client.post(`/dragonbridge/orders/${id}/delivery`, data),

  dispatchDelivery: (id: string): Promise<{ status: string }> =>
    client.patch(`/dragonbridge/orders/${id}/delivery/dispatch`, {}),

  completeDelivery: (id: string): Promise<{ status: string }> =>
    client.patch(`/dragonbridge/orders/${id}/delivery/deliver`, {}),

  createInvoice: (id: string, invoice_type: 'FINAL' | 'AGENCY_FEE', idempotency_key: string, notes?: string): Promise<{ id: string }> =>
    client.post(`/dragonbridge/orders/${id}/invoices`, { invoice_type, idempotency_key, notes }),

  issueInvoice: (invoiceId: string): Promise<{ id: string; status: string }> =>
    client.patch(`/dragonbridge/invoices/${invoiceId}/issue`, {}),

  payInvoice: (invoiceId: string, payment_method: string, notes?: string): Promise<{ id: string; status: string }> =>
    client.patch(`/dragonbridge/invoices/${invoiceId}/pay`, { payment_method, notes }),

  // ── Shipments ─────────────────────────────────────────────────────────────

  getShipments: (): Promise<ShipmentSummary[]> =>
    client.get('/dragonbridge/shipments'),

  createShipment: (data: {
    container_ref?: string; vessel_name?: string;
    port_of_origin?: string; port_of_destination?: string;
    etd?: string; eta?: string; freight_forwarder?: string; notes?: string;
  }): Promise<{ id: string }> =>
    client.post('/dragonbridge/shipments', data),

  updateShipment: (id: string, data: object): Promise<{ id: string }> =>
    client.patch(`/dragonbridge/shipments/${id}`, data),

  assignOrderToShipment: (shipmentId: string, order_id: string, freight_share_pct?: number): Promise<{ assigned: boolean }> =>
    client.post(`/dragonbridge/shipments/${shipmentId}/orders`, { order_id, freight_share_pct }),

  // ── Reconciliations ───────────────────────────────────────────────────────

  getReconciliations: (status?: string): Promise<Reconciliation[]> => {
    const q = status ? `?status=${status}` : ''
    return client.get(`/dragonbridge/reconciliations${q}`)
  },

  approveReconciliation: (id: string, notes?: string): Promise<{ id: string; status: string }> =>
    client.patch(`/dragonbridge/reconciliations/${id}/approve`, { notes }),
}
