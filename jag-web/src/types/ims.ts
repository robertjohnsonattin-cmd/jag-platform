export type ItemCondition = 'NEW' | 'GOOD' | 'FAIR' | 'POOR' | 'WRITTEN_OFF'
export type MovementType = 'RECEIVE' | 'TRANSFER' | 'ADJUSTMENT' | 'CONSUME' | 'RETURN' | 'DISPOSAL' | 'SALE'
export type VatCode = 'STANDARD' | 'ZERO' | 'EXEMPT'
export type FleetType = 'JABCO_FLEET' | 'PERSONAL_FLEET' // kept for backward compat

export const VEHICLE_OWNER_OPTIONS = [
  'JAG Holdings',
  'JABCO',
  'JAG Properties',
  'JAG Entertainment',
  'JAG Finance',
  'Personal — Robert',
  'Personal — Brian',
  'Personal — Phillip',
  'Other',
] as const

export interface Tag {
  id: string
  name: string
  color: string
}

export interface Barcode {
  id: string
  barcode_value: string
  barcode_type: string
  is_primary: boolean
}

export interface Location {
  id: string
  code: string
  name: string
  address: string
  is_active: boolean
  created_at: string
  last_modified_at: string
}

export interface Category {
  id: string
  name: string
  parent_category_id: string | null
  description: string | null
  created_at: string
  last_modified_at: string
}

export interface Item {
  id: string
  name: string
  sku: string | null
  description: string | null
  unit_of_measure: string
  quantity_on_hand: number
  quantity_reserved: number
  reorder_point: number | null
  unit_value: number | null
  serial_number: string | null
  condition: ItemCondition
  is_asset: boolean
  is_vehicle: boolean
  is_active: boolean
  disposed_at: string | null
  disposal_type: 'SALE' | 'WRITE_OFF' | 'TRANSFER' | null
  disposal_notes: string | null
  sale_price_ttd: string | null
  buyer_name: string | null
  disposal_gl_entry_id: string | null
  last_modified_at: string
  created_at: string
  location_name: string
  location_code: string
  category_name: string | null
  tags: Tag[]
}

export interface ItemDetail extends Item {
  barcodes: Barcode[]
  vehicle: Vehicle | null
}

export interface ItemsResponse {
  items: Item[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

export interface Movement {
  id: string
  item_id: string
  movement_type: MovementType
  quantity: number
  from_location_id: string | null
  from_location_name: string | null
  to_location_id: string | null
  to_location_name: string | null
  item_name: string
  sku: string | null
  vat_code: VatCode
  sale_price: number | null
  vat_amount: number | null
  customer_name: string | null
  internal_entity: string | null
  reference_type: string | null
  reference_id: string | null
  notes: string | null
  performed_by: string
  idempotency_key: string
  last_modified_at: string
  created_at: string
}

export interface MovementsResponse {
  movements: Movement[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

export type VehicleStatus = 'ACTIVE' | 'IN_MAINTENANCE' | 'OFF_ROAD' | 'DISPOSED'

export interface Vehicle {
  id: string
  owner_entity: string | null    // replaces fleet_type (migration 012)
  fleet_type: FleetType          // kept for compat
  status: VehicleStatus
  registration_number: string
  make: string
  model: string
  year: number
  colour: string
  vehicle_type: string
  fuel_type: string
  vin: string | null
  engine_number: string | null
  sim_number: string | null
  insurance_policy_number: string | null
  insurance_provider: string | null
  insurance_expiry: string | null
  registration_expiry: string | null
  purchase_date: string | null
  purchase_price: number | null
  current_mileage_km: number | null
  assigned_to_user_id: string | null
  last_service_date: string | null
  next_service_date: string | null
  service_interval_days: number
  // Calendar event IDs (migration 029)
  cal_service_event_id: string | null
  cal_insurance_event_id: string | null
  cal_registration_event_id: string | null
  last_modified_at: string
  created_at: string
  item_id: string
  item_name: string
  sku: string | null
  item_condition: ItemCondition
  current_value: number | null
  serial_number: string | null
  location_id: string | null
  location_name: string | null
}

export type VehicleServiceType = 'OIL_CHANGE' | 'FULL_SERVICE' | 'TYRES' | 'BRAKES' | 'INSPECTION' | 'WASH' | 'OTHER'

export interface VehicleServiceLog {
  id: string
  vehicle_id: string
  tenant_id: string
  service_date: string
  mileage_km: number | null
  service_type: VehicleServiceType
  description: string | null
  cost_ttd: string | null
  performed_by: string | null
  next_service_date: string | null
  created_at: string
  last_modified_at: string
}

export interface VehiclesResponse {
  vehicles: Vehicle[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

export interface Supplier {
  id: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  country_code: string
  payment_terms_days: number
  is_active: boolean
  last_modified_at: string
  created_at: string
}

export type POStatus = 'DRAFT' | 'SUBMITTED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED'

export interface PurchaseOrder {
  id: string
  po_number: string
  status: POStatus
  order_date: string
  expected_delivery_date: string | null
  notes: string | null
  supplier_name: string
  line_count: number
  total_cost: number
  last_modified_at: string
  created_at: string
}

export interface POLine {
  id: string
  item_id: string | null
  description: string | null
  quantity_ordered: number
  quantity_received: number
  unit_cost: number | null
  notes: string | null
  item_name: string | null
  unit_of_measure: string | null
  sku: string | null
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  supplier_id: string
  payment_terms_days: number
  lines: POLine[]
}

export interface PurchaseOrdersResponse {
  purchase_orders: PurchaseOrder[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

export interface POLineInput {
  item_id?: string
  description?: string
  quantity_ordered: number
  unit_cost?: number
  notes?: string
}

export type StockTakeStatus = 'OPEN' | 'COUNTING' | 'FINALISED' | 'CANCELLED'

export interface StockTakeSummary {
  id: string
  reference: string
  status: StockTakeStatus
  location_id: string | null
  location_name: string | null
  notes: string | null
  line_count: number
  counted_count: number
  variance_count: number
  finalised_at: string | null
  last_modified_at: string
  created_at: string
}

export interface StockTakeLine {
  id: string
  item_id: string
  item_name: string
  sku: string | null
  unit_of_measure: string
  location_code: string
  location_name: string
  expected_qty: number
  counted_qty: number | null
  variance: number | null
  notes: string | null
  counted_at: string | null
}

export interface StockTakeDetail extends StockTakeSummary {
  lines: StockTakeLine[]
}

export interface DepreciationSchedule {
  id: string
  item_id: string
  item_name: string
  sku: string | null
  condition: string
  method: 'STRAIGHT_LINE' | 'DECLINING_BALANCE'
  useful_life_years: number
  residual_value: number
  depreciation_start: string
  cost_at_start: number
  accumulated_depreciation: number
  net_book_value: number
  last_posted_period: string | null
  is_active: boolean
  notes: string | null
  dep_expense_gl_account_id: string | null
  acc_dep_gl_account_id: string | null
  last_modified_at: string
  created_at: string
}

export interface DepreciationEntry {
  id: string
  period_start: string
  period_end: string
  depreciation_amount: number
  accumulated_depreciation: number
  net_book_value: number
  notes: string | null
  created_at: string
}

// ── VMS extended types ────────────────────────────────────────────────────────

export type WorkOrderType   = 'CORRECTIVE' | 'PREVENTIVE' | 'INSPECTION' | 'BODYWORK' | 'OTHER'
export type WorkOrderStatus = 'OPEN' | 'IN_PROGRESS' | 'AWAITING_PARTS' | 'COMPLETE' | 'CANCELLED'
export type WorkOrderItemType = 'PART' | 'LABOUR' | 'CONSUMABLE' | 'SUBLET'
export type PMIntervalType   = 'DAYS' | 'KM' | 'HOURS'
export type ComplianceDocType = 'MOT' | 'ROADWORTHY' | 'FIRE_EXTINGUISHER' | 'FIRST_AID' | 'THIRD_PARTY_CERT' | 'DRIVER_LICENSE_COPY' | 'ROAD_LICENCE' | 'OTHER'

export interface WorkOrderItem {
  id: string
  work_order_id: string
  item_type: WorkOrderItemType
  description: string
  quantity: number
  unit_cost: string
  line_total: string
}

export interface WorkOrder {
  id: string
  vehicle_id: string
  wo_number: string
  wo_type: WorkOrderType
  status: WorkOrderStatus
  description: string
  opened_date: string
  closed_date: string | null
  mileage_at_open: number | null
  mechanic_name: string | null
  workshop_name: string | null
  total_labour_cost: string
  total_parts_cost: string
  notes: string | null
  created_at: string
  last_modified_at: string
  items?: WorkOrderItem[]
}

export interface PMSchedule {
  id: string
  vehicle_id: string
  task_name: string
  interval_type: PMIntervalType
  interval_value: number
  last_done_date: string | null
  last_done_km: number | null
  next_due_date: string | null
  next_due_km: number | null
  is_active: boolean
  notes: string | null
  created_at: string
  last_modified_at: string
}

export interface FuelLog {
  id: string
  vehicle_id: string
  fill_date: string
  litres: string
  price_per_litre: string
  total_cost_ttd: string
  mileage_km: number | null
  fuel_type: string
  station_name: string | null
  full_tank: boolean
  notes: string | null
  created_at: string
}

export interface OperatingCost {
  id: string
  vehicle_id: string
  cost_date: string
  cost_type: string
  description: string | null
  amount_ttd: string
  vendor_name: string | null
  notes: string | null
  created_at: string
}

export interface VehicleTCO {
  vehicle_id: string
  registration_number: string
  period_start: string | null
  period_end: string | null
  purchase_price: string | null
  accumulated_depreciation: string | null
  net_book_value: string | null
  total_maintenance_cost: string
  total_fuel_cost: string
  total_operating_cost: string
  total_ownership_cost: string
  work_order_count: number
  fuel_log_count: number
}

export interface ComplianceDoc {
  id: string
  vehicle_id: string
  doc_type: ComplianceDocType
  doc_number: string | null
  issued_by: string | null
  issue_date: string | null
  expiry_date: string | null
  is_expired: boolean
  is_expiring_soon: boolean
  file_path: string | null
  notes: string | null
  last_modified_at: string
  created_at: string
}

export interface VehicleDisposal {
  id: string
  vehicle_id: string
  disposal_type: 'SALE' | 'WRITE_OFF' | 'TRANSFER'
  disposal_date: string
  cost_at_disposal: string
  accumulated_dep: string
  nbv_at_disposal: string
  sale_price_ttd: string | null
  gain_loss_ttd: string | null
  tco_snapshot: Record<string, unknown> | null
  buyer_name: string | null
  final_mileage_km: number | null
  notes: string | null
  journal_entry_id: string | null
  created_at: string
}

// ── GPS tracking (Traccar integration) ────────────────────────────────────────

export type TrackerStatus = 'UNASSIGNED' | 'ASSIGNED' | 'RETIRED'

export interface GpsTracker {
  id: string
  device_serial: string
  model: string | null
  protocol: string | null
  traccar_device_id: number | null
  sim_phone: string | null
  status: TrackerStatus
  vehicle_id: string | null
  notes: string | null
  last_seen_at: string | null
  last_modified_at: string
  created_at: string
  vehicle_registration?: string | null
  vehicle_name?: string | null
}

export interface GpsPosition {
  latitude: number
  longitude: number
  speed_kmh: number
  course: number
  altitude: number
  fix_time: string
  device_id: number
  attributes: Record<string, unknown>
}

export interface GpsEvent {
  id: number
  type: string
  eventTime: string
  deviceId: number
  geofenceId?: number
  attributes: Record<string, unknown>
}

export interface Geofence {
  id: number
  name: string
  description?: string
  area: string
}

export interface FleetVehiclePosition {
  vehicle_id: string
  registration_number: string
  make: string
  model: string
  item_name: string
  traccar_device_id: number
  position: {
    latitude: number
    longitude: number
    speed_kmh: number
    course: number
    fix_time: string
  } | null
}

export interface RecordMovementPayload {
  item_id: string
  movement_type: MovementType
  quantity: number
  from_location_id?: string
  to_location_id?: string
  reference_type?: string
  notes?: string
  idempotency_key: string
  sale_price?: number
  customer_name?: string
}
