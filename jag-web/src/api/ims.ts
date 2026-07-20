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
  WorkOrder, WorkOrderItem, PMSchedule,
  FuelLog, OperatingCost, VehicleTCO,
  ComplianceDoc, VehicleDisposal,
  GpsTracker, GpsPosition, GpsEvent, Geofence, FleetVehiclePosition, TrackerStatus,
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
    is_active?: boolean | 'all'
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
    unit_value?: number; serial_number?: string; manufacturer?: string; model_number?: string;
    condition?: string; is_asset?: boolean; vat_code?: string;
  }): Promise<ItemDetail> =>
    client.post('/ims/items', data),

  updateItem: (id: string, data: Partial<Pick<Item,
    'name' | 'description' | 'unit_of_measure' | 'quantity_on_hand' |
    'reorder_point' | 'unit_value' | 'serial_number' | 'manufacturer' | 'model_number' |
    'condition' | 'is_active'
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
    vin?: string; engine_number?: string; sim_number?: string;
  }): Promise<{ updated: boolean }> =>
    client.patch(`/ims/vehicles/${vehicleId}`, data),

  getVehicleServiceLog: (vehicleId: string): Promise<import('../types/ims').VehicleServiceLog[]> =>
    client.get(`/ims/vehicles/${vehicleId}/service-log`),

  logVehicleService: (vehicleId: string, data: {
    service_date: string;
    mileage_km?: number;
    service_type?: string;
    description?: string;
    cost_ttd?: number;
    performed_by?: string;
    service_interval_days?: number;
  }): Promise<import('../types/ims').VehicleServiceLog> =>
    client.post(`/ims/vehicles/${vehicleId}/service-log`, data),

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

  // BASE-relative (no /api/v1 prefix) — consumed via <AuthedImg> / api.objectUrl,
  // which prepend BASE. This endpoint streams bytes behind header-only auth, so it
  // cannot be used as a bare <img src>.
  photoDownloadUrl: (itemId: string, photoId: string): string =>
    `/ims/items/${itemId}/photos/${photoId}/download`,

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
    dep_expense_gl_account_id?: string; acc_dep_gl_account_id?: string;
  }): Promise<{ id: string }> =>
    client.post('/ims/depreciation/schedules', data),

  getDepreciationEntries: (scheduleId: string): Promise<DepreciationEntry[]> =>
    client.get(`/ims/depreciation/schedules/${scheduleId}/entries`),

  postDepreciationEntry: (scheduleId: string, data: { period_start: string; period_end: string; notes?: string }): Promise<DepreciationEntry> =>
    client.post(`/ims/depreciation/schedules/${scheduleId}/post`, data),

  updateDepreciationGlAccounts: (scheduleId: string, data: { dep_expense_gl_account_id: string | null; acc_dep_gl_account_id: string | null }): Promise<{ updated: boolean }> =>
    client.patch(`/ims/depreciation/schedules/${scheduleId}/gl-accounts`, data),

  // ── Vehicles ──────────────────────────────────────────────────────────────────

  getVehicles: (params: {
    owner_entity?: string
    include_disposed?: 'true' | 'false'
    page?: number
    limit?: number
  } = {}): Promise<VehiclesResponse> => {
    const q = new URLSearchParams()
    if (params.owner_entity)     q.set('owner_entity', params.owner_entity)
    if (params.include_disposed) q.set('include_disposed', params.include_disposed)
    if (params.page)             q.set('page', String(params.page))
    if (params.limit)            q.set('limit', String(params.limit))
    const qs = q.toString()
    return client.get(`/ims/vehicles${qs ? `?${qs}` : ''}`)
  },

  disposeItem: (id: string, data: {
    disposal_type: 'SALE' | 'WRITE_OFF' | 'TRANSFER'
    disposal_date: string
    disposal_notes?: string
    sale_price_ttd?: number
    buyer_name?: string
    owner_entity_id?: string
    asset_gl_account_id?: string
    acc_dep_gl_account_id?: string
    proceeds_gl_account_id?: string
    gain_gl_account_id?: string
    loss_gl_account_id?: string
  }) => client.post<{ disposed: boolean; item_id: string }>(`/ims/items/${id}/dispose`, data),

  deleteItem: (id: string) =>
    client.delete<{ deleted: boolean; id: string }>(`/ims/items/${id}`),

  deleteVehicle: (id: string) =>
    client.delete<{ deleted: boolean; id: string }>(`/ims/vehicles/${id}`),

  // ── Work Orders ───────────────────────────────────────────────────────────────

  getWorkOrders: (vehicleId: string, params?: { status?: string; limit?: number }): Promise<{ work_orders: WorkOrder[] }> => {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.limit)  q.set('limit', String(params.limit))
    const qs = q.toString()
    return client.get(`/ims/vehicles/${vehicleId}/work-orders${qs ? `?${qs}` : ''}`)
  },

  createWorkOrder: (vehicleId: string, data: {
    wo_type: string; description: string; opened_date: string;
    mileage_at_open?: number; mechanic_name?: string; workshop_name?: string; notes?: string;
  }): Promise<WorkOrder> =>
    client.post(`/ims/vehicles/${vehicleId}/work-orders`, data),

  updateWorkOrderStatus: (vehicleId: string, woId: string, status: string): Promise<{ updated: boolean }> =>
    client.patch(`/ims/vehicles/${vehicleId}/work-orders/${woId}/status`, { status }),

  getWorkOrderItems: (vehicleId: string, woId: string): Promise<{ items: WorkOrderItem[] }> =>
    client.get(`/ims/vehicles/${vehicleId}/work-orders/${woId}/items`),

  addWorkOrderItem: (vehicleId: string, woId: string, data: {
    item_type: string; description: string; quantity?: number; unit_cost: number;
  }): Promise<WorkOrderItem> =>
    client.post(`/ims/vehicles/${vehicleId}/work-orders/${woId}/items`, data),

  // ── PM Schedules ──────────────────────────────────────────────────────────────

  getPMSchedules: (vehicleId: string): Promise<{ pm_schedules: PMSchedule[] }> =>
    client.get(`/ims/vehicles/${vehicleId}/pm-schedules`),

  createPMSchedule: (vehicleId: string, data: {
    task_name: string; interval_type: string; interval_value: number; notes?: string;
  }): Promise<PMSchedule> =>
    client.post(`/ims/vehicles/${vehicleId}/pm-schedules`, data),

  markPMDone: (vehicleId: string, pmId: string, data: { done_date: string; done_km?: number }): Promise<{ updated: boolean }> =>
    client.patch(`/ims/vehicles/${vehicleId}/pm-schedules/${pmId}`, { ...data, action: 'mark_done' }),

  deletePMSchedule: (vehicleId: string, pmId: string): Promise<{ deleted: boolean }> =>
    client.delete(`/ims/vehicles/${vehicleId}/pm-schedules/${pmId}`),

  // ── Fuel Logs ─────────────────────────────────────────────────────────────────

  getFuelLogs: (vehicleId: string, params?: { limit?: number }): Promise<{ fuel_logs: FuelLog[] }> => {
    const q = new URLSearchParams()
    if (params?.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return client.get(`/ims/vehicles/${vehicleId}/fuel-logs${qs ? `?${qs}` : ''}`)
  },

  addFuelLog: (vehicleId: string, data: {
    log_date: string; litres: number; cost_per_litre_ttd: number;
    odometer_km?: number; fuel_type?: string; station_name?: string;
    is_full_tank?: boolean; notes?: string;
  }): Promise<FuelLog> =>
    client.post(`/ims/vehicles/${vehicleId}/fuel-logs`, {
      log_date:           data.log_date,
      litres:             data.litres,
      cost_per_litre_ttd: data.cost_per_litre_ttd,
      odometer_km:        data.odometer_km,
      fuel_type:          data.fuel_type,
      station_name:       data.station_name,
      is_full_tank:       data.is_full_tank ?? true,
      notes:              data.notes,
      idempotency_key:    crypto.randomUUID(),
    }),

  deleteFuelLog: (vehicleId: string, logId: string): Promise<{ deleted: boolean }> =>
    client.delete(`/ims/vehicles/${vehicleId}/fuel-logs/${logId}`),

  // ── Operating Costs ───────────────────────────────────────────────────────────

  getOperatingCosts: (vehicleId: string, params?: { limit?: number }): Promise<{ operating_costs: OperatingCost[] }> => {
    const q = new URLSearchParams()
    if (params?.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return client.get(`/ims/vehicles/${vehicleId}/operating-costs${qs ? `?${qs}` : ''}`)
  },

  addOperatingCost: (vehicleId: string, data: {
    cost_date: string; cost_type: string; amount_ttd: number;
    description?: string; vendor_name?: string; notes?: string;
  }): Promise<OperatingCost> =>
    client.post(`/ims/vehicles/${vehicleId}/operating-costs`, data),

  deleteOperatingCost: (vehicleId: string, costId: string): Promise<{ deleted: boolean }> =>
    client.delete(`/ims/vehicles/${vehicleId}/operating-costs/${costId}`),

  // ── TCO ───────────────────────────────────────────────────────────────────────

  getVehicleTCO: (vehicleId: string): Promise<VehicleTCO> =>
    client.get(`/ims/vehicles/${vehicleId}/tco`),

  // ── Compliance Docs ───────────────────────────────────────────────────────────

  getComplianceDocs: (vehicleId: string): Promise<{ compliance_docs: ComplianceDoc[] }> =>
    client.get(`/ims/vehicles/${vehicleId}/compliance-docs`),

  createComplianceDoc: (vehicleId: string, data: {
    doc_type: string; doc_number?: string; issued_by?: string;
    issue_date?: string; expiry_date?: string; notes?: string;
  }): Promise<ComplianceDoc> =>
    client.post(`/ims/vehicles/${vehicleId}/compliance-docs`, data),

  deleteComplianceDoc: (vehicleId: string, docId: string): Promise<{ deleted: boolean }> =>
    client.delete(`/ims/vehicles/${vehicleId}/compliance-docs/${docId}`),

  // ── Disposal ──────────────────────────────────────────────────────────────────

  getDisposal: (vehicleId: string): Promise<VehicleDisposal> =>
    client.get(`/ims/vehicles/${vehicleId}/disposal`),

  disposeVehicle: (vehicleId: string, data: {
    disposal_type: string; disposal_date: string; sale_price_ttd?: number;
    buyer_name?: string; final_mileage_km?: number; notes?: string;
  }): Promise<VehicleDisposal> =>
    client.post(`/ims/vehicles/${vehicleId}/dispose`, data),

  // ── GPS tracking (Traccar) ──────────────────────────────────────────────────────

  getVehicleGpsCurrent: (vehicleId: string): Promise<{ position: GpsPosition | null }> =>
    client.get(`/ims/vehicles/${vehicleId}/gps/current`),

  getVehicleGpsHistory: (vehicleId: string, params?: { from?: string; to?: string }):
    Promise<{ from: string; to: string; count: number; points: GpsPosition[] }> => {
    const q = new URLSearchParams()
    if (params?.from) q.set('from', params.from)
    if (params?.to)   q.set('to', params.to)
    const qs = q.toString()
    return client.get(`/ims/vehicles/${vehicleId}/gps/history${qs ? `?${qs}` : ''}`)
  },

  getVehicleGpsEvents: (vehicleId: string, params?: { from?: string; to?: string }):
    Promise<{ from: string; to: string; events: GpsEvent[] }> => {
    const q = new URLSearchParams()
    if (params?.from) q.set('from', params.from)
    if (params?.to)   q.set('to', params.to)
    const qs = q.toString()
    return client.get(`/ims/vehicles/${vehicleId}/gps/events${qs ? `?${qs}` : ''}`)
  },

  getVehicleGeofences: (vehicleId: string): Promise<{ geofences: Geofence[] }> =>
    client.get(`/ims/vehicles/${vehicleId}/gps/geofences`),

  createGeofence: (vehicleId: string, data: {
    name: string; type: 'circle' | 'polygon';
    center?: { lat: number; lng: number }; radius_m?: number;
    points?: Array<{ lat: number; lng: number }>;
  }): Promise<{ geofence: Geofence }> =>
    client.post(`/ims/vehicles/${vehicleId}/gps/geofences`, data),

  deleteGeofence: (vehicleId: string, gfid: number): Promise<{ deleted: boolean }> =>
    client.delete(`/ims/vehicles/${vehicleId}/gps/geofences/${gfid}`),

  // ── Fleet map ─────────────────────────────────────────────────────────────────

  getFleetPositions: (): Promise<{ fleet: FleetVehiclePosition[] }> =>
    client.get('/ims/gps/fleet'),

  // ── Tracker registry ────────────────────────────────────────────────────────────

  getTrackers: (): Promise<{ trackers: GpsTracker[] }> =>
    client.get('/ims/gps/trackers'),

  createTracker: (data: {
    device_serial: string; model?: string; protocol?: string;
    traccar_device_id?: number; sim_phone?: string; vehicle_id?: string; notes?: string;
  }): Promise<GpsTracker> =>
    client.post('/ims/gps/trackers', data),

  updateTracker: (tid: string, data: {
    model?: string; protocol?: string; traccar_device_id?: number | null;
    sim_phone?: string | null; vehicle_id?: string | null;
    status?: TrackerStatus; notes?: string;
  }): Promise<{ updated: boolean }> =>
    client.patch(`/ims/gps/trackers/${tid}`, data),

  deleteTracker: (tid: string): Promise<{ deleted: boolean }> =>
    client.delete(`/ims/gps/trackers/${tid}`),

  getTrackerBattery: (tid: string): Promise<import('../types/ims').TrackerBattery> =>
    client.get(`/ims/gps/trackers/${tid}/battery`),
}
