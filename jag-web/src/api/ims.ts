import { tenantApi } from './client'
import type {
  Item, ItemDetail, ItemsResponse,
  Location, Category,
  MovementsResponse, RecordMovementPayload, Movement,
  VehiclesResponse,
  Supplier,
  PurchaseOrdersResponse, PurchaseOrderDetail, POLineInput,
  StockTakeSummary, StockTakeDetail,
  DepreciationSchedule, DepreciationEntry,
} from '../types/ims'

// IMS uses jag_commercial with withTenantRLS.
// Owner (Robert) has app.bypass_rls=true so JAG_HOLDINGS tenant shows all items.
const IMS_TENANT = '00000000-0000-0000-0001-000000000001'
const client = tenantApi(IMS_TENANT)

export const imsApi = {
  // ── Reference data ────────────────────────────────────────────────────────────

  getLocations: (): Promise<Location[]> =>
    client.get('/ims/locations'),

  createLocation: (data: { name: string; code: string; address?: string }): Promise<Location> =>
    client.post('/ims/locations', data),

  getCategories: (): Promise<Category[]> =>
    client.get('/ims/categories'),

  // ── Items ─────────────────────────────────────────────────────────────────────

  getItems: (params: {
    location_id?: string
    category_id?: string
    is_asset?: boolean
    is_active?: boolean
    search?: string
    page?: number
    limit?: number
  } = {}): Promise<ItemsResponse> => {
    const q = new URLSearchParams()
    if (params.location_id)            q.set('location_id', params.location_id)
    if (params.category_id)            q.set('category_id', params.category_id)
    if (params.is_asset !== undefined)  q.set('is_asset', String(params.is_asset))
    if (params.is_active !== undefined) q.set('is_active', String(params.is_active))
    if (params.search)                 q.set('search', params.search)
    if (params.page)                   q.set('page', String(params.page))
    if (params.limit)                  q.set('limit', String(params.limit))
    const qs = q.toString()
    return client.get(`/ims/items${qs ? `?${qs}` : ''}`)
  },

  getItem: (id: string): Promise<ItemDetail> =>
    client.get(`/ims/items/${id}`),

  createItem: (data: {
    name: string; location_id: string; unit_of_measure?: string; description?: string;
    sku?: string; category_id?: string; quantity_on_hand?: number; reorder_point?: number;
    unit_value?: number; serial_number?: string; condition?: string; is_asset?: boolean; vat_code?: string;
  }): Promise<ItemDetail> =>
    client.post('/ims/items', data),

  updateItem: (id: string, data: Partial<Pick<Item,
    'name' | 'description' | 'unit_of_measure' | 'quantity_on_hand' |
    'reorder_point' | 'unit_value' | 'serial_number' | 'condition' | 'is_active'
  >>): Promise<ItemDetail> =>
    client.patch(`/ims/items/${id}`, data),

  // ── Movements ─────────────────────────────────────────────────────────────────

  getMovements: (params: {
    item_id?: string
    movement_type?: string
    page?: number
    limit?: number
  } = {}): Promise<MovementsResponse> => {
    const q = new URLSearchParams()
    if (params.item_id)       q.set('item_id', params.item_id)
    if (params.movement_type) q.set('movement_type', params.movement_type)
    if (params.page)          q.set('page', String(params.page))
    if (params.limit)         q.set('limit', String(params.limit))
    const qs = q.toString()
    return client.get(`/ims/movements${qs ? `?${qs}` : ''}`)
  },

  recordMovement: (data: RecordMovementPayload): Promise<Movement> =>
    client.post('/ims/movements', data),

  createVehicle: (data: {
    name: string; owner_entity: string; location_id?: string; unit_value?: number; serial_number?: string; condition?: string;
    registration_number: string; make: string; model: string; year: number;
    colour?: string; vehicle_type: string; fuel_type?: string; vin?: string; engine_number?: string;
    insurance_policy_number?: string; insurance_provider?: string; insurance_expiry?: string;
    registration_expiry?: string; purchase_date?: string; purchase_price?: number; current_mileage_km?: number;
    last_service_date?: string; service_interval_days?: number;
  }): Promise<{ item_id: string; vehicle_id: string }> =>
    client.post('/ims/vehicles', data),

  updateVehicle: (vehicleId: string, data: {
    owner_entity?: string; colour?: string; condition?: string; current_mileage_km?: number;
    unit_value?: number; insurance_policy_number?: string; insurance_provider?: string;
    insurance_expiry?: string; registration_expiry?: string;
    last_service_date?: string; service_interval_days?: number; location_id?: string;
  }): Promise<{ updated: boolean }> =>
    client.patch(`/ims/vehicles/${vehicleId}`, data),

  // ── Photos ───────────────────────────────────────────────────────────────────

  getPhotos: (itemId: string): Promise<{ id: string; storage_path: string; is_primary: boolean; created_at: string }[]> =>
    client.get(`/ims/items/${itemId}/photos`),

  uploadPhoto: (itemId: string, file: File, isPrimary = false): Promise<{ id: string; storage_path: string; is_primary: boolean }> => {
    const form = new FormData()
    form.append('photo', file)
    form.append('is_primary', String(isPrimary))
    return client.postForm(`/ims/items/${itemId}/photos`, form)
  },

  deletePhoto: (itemId: string, photoId: string): Promise<{ deleted: boolean }> =>
    client.delete(`/ims/items/${itemId}/photos/${photoId}`),

  photoDownloadUrl: (itemId: string, photoId: string): string =>
    `/api/v1/ims/items/${itemId}/photos/${photoId}/download`,

  // ── Valuation ─────────────────────────────────────────────────────────────────

  getValuation: (): Promise<{
    summary: { total_items: number; low_stock_count: number; out_of_stock_count: number; total_stock_value: number; total_asset_value: number }
    by_location: { location_name: string; location_code: string; item_count: number; total_value: number }[]
    by_category: { category_name: string; item_count: number; total_value: number }[]
  }> => client.get('/ims/valuation'),

  // ── Barcodes ──────────────────────────────────────────────────────────────────

  getLowStock: (): Promise<Item[]> =>
    client.get('/ims/items/low-stock'),

  addBarcode: (itemId: string, data: {
    barcode_value: string; barcode_type?: string; is_primary?: boolean
  }): Promise<{ id: string; barcode_value: string; barcode_type: string; is_primary: boolean }> =>
    client.post(`/ims/items/${itemId}/barcodes`, data),

  deleteBarcode: (itemId: string, barcodeId: string): Promise<{ deleted: boolean }> =>
    client.delete(`/ims/items/${itemId}/barcodes/${barcodeId}`),

  // ── Suppliers ─────────────────────────────────────────────────────────────────

  getSuppliers: (): Promise<Supplier[]> =>
    client.get('/ims/suppliers'),

  createSupplier: (data: {
    name: string; contact_name?: string; phone?: string; email?: string;
    address?: string; country_code?: string; payment_terms_days?: number; notes?: string;
  }): Promise<{ id: string }> =>
    client.post('/ims/suppliers', data),

  updateSupplier: (id: string, data: Partial<{
    name: string; contact_name: string | null; phone: string | null; email: string | null;
    address: string | null; payment_terms_days: number; notes: string | null; is_active: boolean;
  }>): Promise<{ id: string }> =>
    client.patch(`/ims/suppliers/${id}`, data),

  // ── Purchase Orders ───────────────────────────────────────────────────────────

  getPurchaseOrders: (params?: { supplier_id?: string; status?: string; page?: number; limit?: number }): Promise<PurchaseOrdersResponse> => {
    const q = new URLSearchParams()
    if (params?.supplier_id) q.set('supplier_id', params.supplier_id)
    if (params?.status)      q.set('status', params.status)
    if (params?.page)        q.set('page', String(params.page))
    if (params?.limit)       q.set('limit', String(params.limit))
    const qs = q.toString()
    return client.get(`/ims/purchase-orders${qs ? `?${qs}` : ''}`)
  },

  getPurchaseOrder: (id: string): Promise<PurchaseOrderDetail> =>
    client.get(`/ims/purchase-orders/${id}`),

  createPurchaseOrder: (data: {
    supplier_id: string; order_date?: string; expected_delivery_date?: string;
    notes?: string; lines: POLineInput[];
  }): Promise<{ id: string; po_number: string }> =>
    client.post('/ims/purchase-orders', data),

  updatePOStatus: (id: string, status: 'SUBMITTED' | 'CANCELLED'): Promise<{ id: string; status: string }> =>
    client.patch(`/ims/purchase-orders/${id}/status`, { status }),

  receivePO: (id: string, data: {
    lines: { line_id: string; quantity_received: number }[];
    receive_location_id: string;
    idempotency_key: string;
    notes?: string;
  }): Promise<{ status: string; already_processed: boolean }> =>
    client.post(`/ims/purchase-orders/${id}/receive`, data),

  // ── Stock Takes ───────────────────────────────────────────────────────────────

  getStockTakes: (): Promise<StockTakeSummary[]> =>
    client.get('/ims/stock-takes'),

  getStockTake: (id: string): Promise<StockTakeDetail> =>
    client.get(`/ims/stock-takes/${id}`),

  createStockTake: (data: { location_id?: string; notes?: string }): Promise<{ id: string; reference: string; line_count: number }> =>
    client.post('/ims/stock-takes', data),

  countStockTakeLines: (id: string, lines: { line_id: string; counted_qty: number; notes?: string }[]): Promise<{ updated: number }> =>
    client.patch(`/ims/stock-takes/${id}/count`, { lines }),

  finaliseStockTake: (id: string, idempotency_key: string, notes?: string): Promise<{ adjustments: number; already_processed: boolean }> =>
    client.post(`/ims/stock-takes/${id}/finalise`, { idempotency_key, notes }),

  // ── Depreciation ──────────────────────────────────────────────────────────────

  getDepreciationSchedules: (): Promise<DepreciationSchedule[]> =>
    client.get('/ims/depreciation/schedules'),

  createDepreciationSchedule: (data: {
    item_id: string; method?: string; useful_life_years: number;
    residual_value?: number; depreciation_start: string; cost_at_start: number; notes?: string;
  }): Promise<{ id: string }> =>
    client.post('/ims/depreciation/schedules', data),

  getDepreciationEntries: (scheduleId: string): Promise<DepreciationEntry[]> =>
    client.get(`/ims/depreciation/schedules/${scheduleId}/entries`),

  postDepreciationEntry: (scheduleId: string, data: { period_start: string; period_end: string; notes?: string }): Promise<DepreciationEntry> =>
    client.post(`/ims/depreciation/schedules/${scheduleId}/post`, data),

  // ── Vehicles ──────────────────────────────────────────────────────────────────

  getVehicles: (params: {
    owner_entity?: string
    page?: number
    limit?: number
  } = {}): Promise<VehiclesResponse> => {
    const q = new URLSearchParams()
    if (params.owner_entity) q.set('owner_entity', params.owner_entity)
    if (params.page)         q.set('page', String(params.page))
    if (params.limit)        q.set('limit', String(params.limit))
    const qs = q.toString()
    return client.get(`/ims/vehicles${qs ? `?${qs}` : ''}`)
  },

  deleteItem: (id: string) =>
    client.delete<{ deleted: boolean; id: string }>(`/ims/items/${id}`),

  deleteVehicle: (id: string) =>
    client.delete<{ deleted: boolean; id: string }>(`/ims/vehicles/${id}`),
}
