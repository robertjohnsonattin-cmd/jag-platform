export type ProjectStatus =
  | 'TENDER'
  | 'AWARDED'
  | 'ACTIVE'
  | 'PRACTICAL_COMPLETION'
  | 'DEFECTS_LIABILITY'
  | 'CLOSED'
  | 'CANCELLED'

export interface Project {
  id: string
  project_code: string
  name: string
  client_name: string
  client_type: 'GOVERNMENT' | 'PRIVATE'
  contract_value: string
  contract_currency: string
  vat_inclusive: boolean
  vat_pct: string
  start_date: string | null
  expected_end_date: string | null
  actual_end_date: string | null
  site_address: string | null
  project_manager_id: string
  client_company_id: string | null
  client_company_name: string | null
  status: ProjectStatus
  handover_document_url: string | null
  created_at: string
  updated_at: string
}

export interface BoqItem {
  id: string
  project_id: string
  section: string
  item_number: string | null
  description: string
  unit: string
  quantity_budgeted: string
  unit_rate: string
  amount_budgeted: string
  amount_actual: string
  quantity_actual: string | null
  internal_cost_rate: string | null
  markup_percent: string | null
  final_bid_rate: string | null
  work_package_tag: string | null
  created_at: string
}

export type VOStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'

export interface VariationOrder {
  id: string
  project_id: string
  vo_number: string
  description: string
  amount: string
  currency: string
  status: VOStatus
  submitted_date: string | null
  approved_date: string | null
  created_at: string
}

export interface ProgressClaim {
  id: string
  project_id: string
  claim_number: number
  period_from: string
  period_to: string
  amount_claimed: string
  status: string
  created_at: string
}

export interface PaymentCertificate {
  id: string
  project_id: string
  progress_claim_id: string
  certificate_number: string
  amount_certified: string
  issued_date: string
  due_date: string | null
  paid_date: string | null
  status: string
  created_at: string
}

export interface VendorInvoice {
  id: string
  project_id: string
  vendor_name: string
  vendor_type: 'SUPPLIER' | 'SUBCONTRACTOR'
  invoice_ref: string | null
  invoice_date: string
  due_date: string | null
  amount: string
  vat_amount: string
  vat_code: string
  status: 'RECEIVED' | 'APPROVED' | 'PAID'
  approved_by: string | null
  approved_date: string | null
  paid_date: string | null
  payment_reference: string | null
  notes: string | null
  created_at: string
}

export interface SiteDiaryEntry {
  id: string
  project_id: string
  entry_date: string
  weather: string | null
  workers_on_site: number | null
  activities_completed: string | null
  materials_received: string | null
  equipment_on_site: string | null
  instructions_received: string | null
  issues_noted: string | null
  foreman_id: string
  created_at: string
}

export interface ProjectTask {
  id: string
  project_id: string
  task_type: 'MOBILIZATION' | 'POST_MORTEM' | 'GENERAL'
  title: string
  description: string | null
  assigned_to: string | null
  due_date: string | null
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE'
  completed_at: string | null
  last_modified_at: string
  created_at: string
}

export interface PunchListItem {
  id: string
  project_id: string
  description: string
  location: string | null
  trade: string | null
  status: 'IDENTIFIED' | 'RECTIFIED' | 'VERIFIED'
  identified_by: string
  identified_date: string
  rectified_date: string | null
  verified_by: string | null
  verified_date: string | null
  photo_url: string | null
  last_modified_at: string
  created_at: string
}

export interface SiteIncident {
  id: string
  project_id: string
  incident_date: string
  incident_type: 'NEAR_MISS' | 'MINOR_INJURY' | 'MAJOR_INJURY' | 'PROPERTY_DAMAGE' | 'ENVIRONMENTAL' | 'OTHER'
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  description: string
  reported_by: string
  corrective_action: string | null
  status: 'OPEN' | 'CLOSED'
  closed_date: string | null
  photos: string[]
  last_modified_at: string
  created_at: string
}

export interface QualityInspection {
  id: string
  project_id: string
  inspection_date: string
  inspector_name: string
  area_inspected: string
  checklist_result: 'PASS' | 'FAIL' | 'CONDITIONAL'
  defects_noted: string | null
  follow_up_required: boolean
  follow_up_date: string | null
  photos: string[]
  last_modified_at: string
  created_at: string
}
