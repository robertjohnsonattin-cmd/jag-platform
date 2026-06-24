export interface PropertyValuationHistory {
  id: string
  property_id: string
  as_of_date: string
  valuation_ttd: string
  notes: string | null
  recorded_at: string
}

export interface Property {
  id: string
  property_code: string
  name: string
  address_line1: string | null
  address_line2: string | null
  city: string | null
  country: string | null
  property_type: 'RESIDENTIAL' | 'COMMERCIAL' | 'LAND' | 'MIXED' | 'AGRICULTURAL'
  tenure_type: string
  bedrooms: number | null
  bathrooms: number | null
  is_rented: boolean
  current_valuation: string | null
  valuation_date: string | null
  notes: string | null
  last_modified_at: string
  created_at: string
  // detail-only fields
  active_leases?: Lease[]
  mortgages?: Mortgage[]
}

export interface Lease {
  id: string
  lease_type: string
  start_date: string
  end_date: string | null
  monthly_rent: string
  currency: string
  security_deposit: string | null
  payment_due_day: number
  status: string
  first_name: string
  last_name: string | null
  company_name: string | null
  is_company: boolean
  email: string | null
  phone: string | null
  late_fee_type?: string | null
  late_fee_value?: string | null
  grace_days?: number | null
}

export interface RentPayment {
  id: string
  lease_id: string
  payment_date: string
  period_month: number
  period_year: number
  amount_due: string
  amount_paid: string
  payment_method: string
  receipt_number: string | null
  wipay_reference: string | null
  is_late: boolean
  late_fee_charged: string
  notes: string | null
  proof_image_url: string | null
  created_at: string
}

export interface RentReceipt {
  id: string
  payment_date: string
  period_month: number
  period_year: number
  amount_due: string
  amount_paid: string
  late_fee_charged: string
  payment_method: string
  receipt_number: string | null
  notes: string | null
  proof_image_url: string | null
  created_at: string
  lease_id: string
  monthly_rent: string
  tenant_name: string
  tenant_phone: string | null
  property_name: string
  property_address: string | null
  unit_number: string | null
}

export interface VendorInvoice {
  id: string
  vendor_name: string
  invoice_ref: string | null
  invoice_date: string
  due_date: string | null
  amount: string
  currency: string
  status: string
  paid_date: string | null
  payment_reference: string | null
  notes: string | null
  created_at: string
}

export interface Mortgage {
  id: string
  lender_name: string
  mortgage_type: string
  outstanding_balance: string
  interest_rate_percent: string
  monthly_payment: string
  status: string
  maturity_date: string | null
}

export interface PropertyTenant {
  id: string
  first_name: string
  last_name: string | null
  company_name: string | null
  is_company: boolean
  phone: string | null
  phone2: string | null
  email: string | null
  last_modified_at: string
  created_at: string
}

export type TenantDocType =
  | 'national_id' | 'passport' | 'drivers_licence' | 'employment_letter' | 'payslip'
  | 'company_reg' | 'bank_statement' | 'utility_bill' | 'reference_letter'
  | 'tenancy_agreement' | 'other'

export interface TenantDocument {
  id: string
  tenant_id: string
  doc_type: TenantDocType
  label: string
  file_name: string
  file_size_bytes: number | null
  mime_type: string | null
  notes: string | null
  source: 'MANUAL' | 'APPLICATION'
  application_id: string | null
  created_at: string
}

export interface ApplicationDocument {
  id: string
  application_id: string
  doc_type: string
  label: string
  file_name: string
  created_at: string
}

export interface MaintenanceRequest {
  id: string
  category: string
  description: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  status: string
  assigned_to: string | null
  estimated_cost: string | null
  actual_cost: string | null
  reported_date: string
  scheduled_date: string | null
  completed_date: string | null
  completion_notes: string | null
  last_modified_at: string
  created_at: string
}

export type PipelineStage = 'WATCH' | 'INTERESTED' | 'OFFER_MADE' | 'DUE_DILIGENCE' | 'CONTRACT' | 'ACQUIRED' | 'PASSED'

export interface PipelineItem {
  id: string
  name: string
  address: string | null
  property_type: string
  asking_price: string | null
  estimated_value: string | null
  currency: string
  lot_size_sqm: string | null
  floor_area_sqm: string | null
  estimated_monthly_rent: string | null
  gross_yield_percent?: string | null
  net_yield_percent?: string | null
  stage: PipelineStage
  source: string | null
  agent_name: string | null
  last_modified_at: string
  created_at: string
}

export interface UtilityBill {
  id: string
  utility_type: string
  provider: string
  bill_date: string
  paid_date: string | null
  amount: string
  vat_amount: string
  vat_code: string
  notes: string | null
  created_at: string
}

export interface InsurancePolicy {
  id: string
  property_id: string
  insurance_type: 'BUILDING' | 'CONTENTS' | 'COMPREHENSIVE' | 'LIABILITY' | 'FLOOD' | 'FIRE' | 'OTHER'
  insurer: string
  policy_number: string | null
  premium_amount: string | null
  premium_currency: string
  premium_frequency: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'
  coverage_amount: string | null
  start_date: string | null
  expiry_date: string | null
  auto_renew: boolean
  notes: string | null
  created_at: string
}

export interface PropertyTaxRecord {
  id: string
  property_id: string
  tax_year: number
  assessment_value: string | null
  tax_amount: string
  currency: string
  due_date: string | null
  paid_date: string | null
  payment_reference: string | null
  notes: string | null
  created_at: string
}

export interface Inspection {
  id: string
  property_id: string
  inspection_type: 'MOVE_IN' | 'MOVE_OUT' | 'PERIODIC' | 'PRE_TENANCY' | 'MAINTENANCE' | 'VALUATION'
  inspection_date: string
  inspector_name: string | null
  condition_rating: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | null
  notes: string | null
  next_due_date: string | null
  created_at: string
}

export interface ArrearsRecord {
  id: string
  property_id: string
  property_name: string
  property_code: string
  tenant_name: string
  tenant_email: string | null
  tenant_phone: string | null
  lease_id: string
  payment_date: string
  period_month: number
  period_year: number
  amount_due: string
  amount_paid: string
  balance_owed: string
  late_fee_charged: string
  days_overdue: number
}

export interface LeaseExpiryRecord {
  id: string
  property_id: string
  property_name: string
  property_code: string
  tenant_name: string
  tenant_email: string | null
  tenant_phone: string | null
  start_date: string
  end_date: string
  monthly_rent: string
  currency: string
  lease_type: string
  days_remaining: number
}

export interface UtilityAccount {
  id: string
  utility_type: 'ELECTRICITY' | 'WATER' | 'GAS' | 'INTERNET' | 'OTHER'
  provider: string
  account_number: string | null
  account_name: string | null
  is_active: boolean
  notes: string | null
  created_at: string
}

export interface Unit {
  id: string
  unit_number: string
  floor: number | null
  bedrooms: number | null
  bathrooms: number | null
  floor_area_sqm: string | null
  is_rented: boolean
  notes: string | null
  created_at: string
  listing_status: 'VACANT' | 'LISTED' | 'OCCUPIED' | 'MAINTENANCE' | null
  listing_description: string | null
  wasa_included: boolean | null
  electricity_included: boolean | null
  internet_included: boolean | null
  rent_amount: string | null
  suggested_rent_recommended_ttd: string | null
  booking_slug: string | null
  listed_at: string | null
  // from join
  lease_id: string | null
  monthly_rent: string | null
  currency: string | null
  tenant_first_name: string | null
  tenant_last_name: string | null
  company_name: string | null
  is_company: boolean | null
  tenant_phone: string | null
}

export interface UnitPhoto {
  id: string
  object_key: string
  url: string
  caption: string | null
  display_order: number
  created_at: string
}

export interface FinancialSummary {
  property_id: string
  period_months: number
  rent_collected: number
  maintenance_cost: number
  utility_cost: number
  vendor_invoice_cost: number
  mortgage_cost: number
  total_expenses: number
  net_income: number
  current_valuation: number
  gross_yield_percent: number | null
  net_yield_percent: number | null
}

export interface PropertyDocument {
  id: string
  property_id: string
  lease_id: string | null
  document_type: 'TITLE_DEED' | 'TENANCY_AGREEMENT' | 'INSURANCE_CERTIFICATE' | 'INSPECTION_REPORT' | 'PERMIT' | 'INVOICE' | 'OTHER'
  label: string
  minio_object_key: string
  file_name: string
  file_size_bytes: number
  notes: string | null
  uploaded_at: string
  created_at: string
  uploaded_by: string | null
}
