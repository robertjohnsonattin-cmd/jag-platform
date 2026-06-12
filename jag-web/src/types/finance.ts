export interface FinAccount {
  id: string
  owner_entity_id: string
  account_name: string
  institution_name: string
  account_type: string
  currency: string
  current_balance: string
  credit_limit: string | null
  interest_rate: string | null
  account_number_last4: string | null
  is_active: boolean
  opened_date: string | null
  closed_date: string | null
  created_at: string
  updated_at: string
}

export interface FinTransaction {
  id: string
  account_id: string
  transaction_date: string
  posted_date: string | null
  amount: string
  currency: string
  amount_ttd: string | null
  description: string
  merchant_name: string | null
  category: string
  is_reconciled: boolean
  is_pending_review: boolean
  reference_number: string | null
  created_at: string
}

export interface NetWorthSnapshot {
  id: string
  owner_entity_id: string
  snapshot_date: string
  total_assets_ttd: string
  total_liabilities_ttd: string
  net_worth_ttd: string
  liquid_assets_ttd: string
  investment_assets_ttd: string
  property_assets_ttd: string
}

export interface FxRate {
  id: string
  currency: string
  rate_date: string
  rate_to_ttd: string
  source: string
}

export type InvestmentType =
  | 'EQUITY' | 'BOND' | 'MUTUAL_FUND' | 'ETF' | 'UNIT_TRUST'
  | 'REAL_ESTATE' | 'PRIVATE_EQUITY' | 'CASH_EQUIVALENT' | 'OTHER'

export interface Investment {
  id: string
  owner_entity_id: string
  account_id: string | null
  investment_type: InvestmentType
  asset_name: string
  ticker_symbol: string | null
  quantity: string | null
  cost_basis_ttd: string | null
  current_value_ttd: string
  unrealised_gain_ttd: string | null
  institution_name: string | null
  maturity_date: string | null
  currency: string
  notes: string | null
  created_at: string
  updated_at: string
}

// ── Financial Statement types ─────────────────────────────────────────────────

export interface ReportLineItem {
  id: string
  account_code: string
  account_name: string
  amount: number
}

export interface IncomeStatement {
  period: { from: string; to: string }
  owner_entity_id: string | null
  revenue: ReportLineItem[]
  total_revenue: number
  expenses: ReportLineItem[]
  total_expenses: number
  operating_income: number
  other_income: ReportLineItem[]
  total_other_income: number
  other_expense: ReportLineItem[]
  total_other_expense: number
  net_income: number
}

export interface BalanceSheetLineItem {
  id: string
  account_code: string
  account_name: string
  balance: number
}

export interface BalanceSheet {
  as_of: string
  owner_entity_id: string | null
  gl: {
    assets: BalanceSheetLineItem[]
    total_assets: number
    liabilities: BalanceSheetLineItem[]
    total_liabilities: number
    equity: BalanceSheetLineItem[]
    total_equity: number
    check: number
  }
  standalone: {
    bank_liquid: number
    investments: number
    total_assets: number
    credit_liabilities: number
    loans: number
    total_liabilities: number
    net_equity: number
  }
}

export interface CashFlowActivity {
  category: string
  txn_count: number
  inflows: number
  outflows: number
  net: number
}

export interface CashFlow {
  period: { from: string; to: string }
  owner_entity_id: string | null
  operating: { activities: CashFlowActivity[]; inflows: number; outflows: number; net: number }
  investing:  { activities: CashFlowActivity[]; inflows: number; outflows: number; net: number }
  financing:  { activities: CashFlowActivity[]; inflows: number; outflows: number; net: number }
  net_change: number
}

export type LoanType = 'MORTGAGE' | 'CAR_LOAN' | 'PERSONAL_LOAN' | 'BUSINESS_LOAN' | 'OVERDRAFT' | 'OTHER'

export interface Loan {
  id: string
  owner_entity_id: string
  account_id: string | null
  loan_type: LoanType
  lender_name: string
  original_principal: string
  outstanding_balance: string
  currency: string
  interest_rate: string
  interest_type: 'FIXED' | 'VARIABLE'
  start_date: string | null
  maturity_date: string | null
  monthly_payment: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// ── Insurance types ───────────────────────────────────────────────────────────

export type InsurancePolicyType =
  | 'PROPERTY' | 'VEHICLE' | 'LIABILITY' | 'LIFE' | 'HEALTH'
  | 'BUSINESS_INTERRUPTION' | 'MARINE' | 'PROFESSIONAL_INDEMNITY' | 'OTHER'

export type InsuranceAssetType = 'VEHICLE' | 'PROPERTY' | 'BUSINESS' | 'PERSON' | 'OTHER'
export type PremiumFrequency = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL' | 'ONE_OFF'
export type PremiumStatus = 'DUE' | 'PAID' | 'OVERDUE' | 'WAIVED'
export type ClaimStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SETTLED' | 'WITHDRAWN'

export interface InsurancePolicy {
  id: string
  owner_entity_id: string
  policy_number: string
  insurer_name: string
  broker_name: string | null
  policy_type: InsurancePolicyType
  insured_asset_type: InsuranceAssetType
  coverage_amount: string
  coverage_amount_ttd: string
  premium_amount: string
  premium_amount_ttd: string
  premium_frequency: PremiumFrequency
  start_date: string
  expiry_date: string
  renewal_alert_days: number
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface InsurancePremium {
  id: string
  policy_id: string
  due_date: string
  paid_date: string | null
  amount: string
  amount_ttd: string
  payment_method: string
  status: PremiumStatus
  notes: string | null
  created_at: string
}

export interface InsuranceClaim {
  id: string
  policy_id: string
  claim_reference: string | null
  incident_date: string
  claim_date: string
  description: string
  claimed_amount_ttd: string
  settled_amount_ttd: string | null
  status: ClaimStatus
  settlement_date: string | null
  notes: string | null
  created_at: string
}

// ── Intercompany types ────────────────────────────────────────────────────────

export type IntercompanyChargeType =
  | 'MANAGEMENT_FEE' | 'LOAN_INTEREST' | 'SHARED_SERVICE'
  | 'DIVIDEND' | 'RENT' | 'RECHARGE' | 'OTHER'

export type IntercompanyChargeStatus = 'DRAFT' | 'POSTED' | 'ELIMINATED'

export interface IntercompanyCharge {
  id: string
  from_entity_id: string
  to_entity_id: string
  charge_date: string
  description: string
  charge_type: IntercompanyChargeType
  amount_ttd: string
  currency: string
  amount_original: string | null
  fx_rate_used: string | null
  status: IntercompanyChargeStatus
  notes: string | null
  idempotency_key: string
  created_at: string
  updated_at: string
}

export interface IntercompanyElimination {
  id: string
  charge_id: string
  elimination_date: string
  period_year: number
  period_month: number
  eliminated_by: string
  notes: string | null
  from_entity_id: string
  to_entity_id: string
  charge_type: IntercompanyChargeType
  amount_ttd: string
  created_at: string
}

export type BankStatementJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'PARTIAL' | 'FAILED'

export interface BankStatementJob {
  id: string
  account_id: string
  status: BankStatementJobStatus
  file_name: string
  mime_type: string
  statement_from: string | null
  statement_to: string | null
  rows_parsed: number
  rows_imported: number
  rows_skipped: number
  error_detail: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}
