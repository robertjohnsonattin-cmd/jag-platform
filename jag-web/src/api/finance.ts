import { api } from './client'
import type {
  FinAccount, FinTransaction, NetWorthSnapshot, FxRate, Investment, InvestmentType, Loan, LoanType,
  IncomeStatement, BalanceSheet, CashFlow,
  InsurancePolicy, InsurancePremium, InsuranceClaim,
  IntercompanyCharge, IntercompanyElimination,
  InsurancePolicyType, InsuranceAssetType, PremiumFrequency,
  IntercompanyChargeType,
  BankStatementJob,
} from '../types/finance'

export const financeApi = {
  getAccounts: (params?: { owner_entity_id?: string; is_active?: 'true' | 'false' }) => {
    const qs = params
      ? '?' + new URLSearchParams(params as Record<string, string>).toString()
      : ''
    return api.get<FinAccount[]>(`/finance/accounts${qs}`)
  },

  getTransactions: (params?: {
    account_id?: string
    category?: string
    date_from?: string
    date_to?: string
    limit?: number
    offset?: number
  }) => {
    const qs = params
      ? '?' + new URLSearchParams(
          Object.fromEntries(
            Object.entries(params)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, String(v)])
          )
        ).toString()
      : ''
    return api.get<FinTransaction[]>(`/finance/transactions${qs}`)
  },

  getNetWorth: () => api.get<NetWorthSnapshot[]>('/finance/net-worth'),

  triggerSnapshot: () => api.post<{ snapshot_date: string; snapshots: NetWorthSnapshot[] }>(
    '/finance/net-worth/snapshot', {}
  ),

  getFxRates: () => api.get<FxRate[]>('/finance/fx-rates'),

  createAccount: (data: {
    owner_entity_id: string; account_name: string; institution_name: string
    account_type: string; currency: string; current_balance?: number
    credit_limit?: number; interest_rate?: number; account_number_last4?: string
    opened_date?: string
  }) => api.post<FinAccount>('/finance/accounts', data),

  reconcileTransaction: (id: string, data: { is_reconciled: boolean }) =>
    api.patch<FinTransaction>(`/finance/transactions/${id}`, data),

  getInvestments: (params?: { owner_entity_id?: string; investment_type?: InvestmentType; currency?: string }) => {
    const qs = params
      ? '?' + new URLSearchParams(Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
        )).toString()
      : ''
    return api.get<Investment[]>(`/finance/investments${qs}`)
  },

  createInvestment: (data: {
    owner_entity_id: string; investment_type: InvestmentType; asset_name: string
    current_value_ttd: number; currency?: string; cost_basis_ttd?: number
    unrealised_gain_ttd?: number; institution_name?: string; ticker_symbol?: string
    quantity?: number; maturity_date?: string; notes?: string
  }) => api.post<Investment>('/finance/investments', data),

  updateInvestment: (id: string, data: Partial<{
    asset_name: string; current_value_ttd: number; cost_basis_ttd: number
    unrealised_gain_ttd: number; institution_name: string; ticker_symbol: string
    quantity: number; maturity_date: string; notes: string
  }>) => api.patch<Investment>(`/finance/investments/${id}`, data),

  getLoans: (params?: { owner_entity_id?: string; loan_type?: LoanType; currency?: string }) => {
    const qs = params
      ? '?' + new URLSearchParams(Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
        )).toString()
      : ''
    return api.get<Loan[]>(`/finance/loans${qs}`)
  },

  createLoan: (data: {
    owner_entity_id: string; loan_type: LoanType; lender_name: string
    original_principal: number; outstanding_balance: number; interest_rate: number
    currency?: string; interest_type?: 'FIXED' | 'VARIABLE'
    start_date?: string; maturity_date?: string; monthly_payment?: number; notes?: string
  }) => api.post<Loan>('/finance/loans', data),

  updateLoan: (id: string, data: Partial<{
    outstanding_balance: number; interest_rate: number; interest_type: string
    monthly_payment: number; maturity_date: string; notes: string
  }>) => api.patch<Loan>(`/finance/loans/${id}`, data),

  getIncomeStatement: (params: { date_from: string; date_to: string; owner_entity_id?: string }) => {
    const qs = '?' + new URLSearchParams(Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
    )).toString()
    return api.get<IncomeStatement>(`/finance/reports/income-statement${qs}`)
  },

  getBalanceSheet: (params?: { as_of_date?: string; owner_entity_id?: string }) => {
    const qs = params
      ? '?' + new URLSearchParams(Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
        )).toString()
      : ''
    return api.get<BalanceSheet>(`/finance/reports/balance-sheet${qs}`)
  },

  getCashFlow: (params: { date_from: string; date_to: string; owner_entity_id?: string }) => {
    const qs = '?' + new URLSearchParams(Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
    )).toString()
    return api.get<CashFlow>(`/finance/reports/cash-flow${qs}`)
  },

  deleteAccount: (id: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/finance/accounts/${id}`),

  deleteExpense: (id: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/finance/expenses/${id}`),

  getPolicies: (params?: { is_active?: 'true' | 'false'; policy_type?: InsurancePolicyType }) => {
    const qs = params
      ? '?' + new URLSearchParams(Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
        )).toString()
      : ''
    return api.get<InsurancePolicy[]>(`/finance/insurance/policies${qs}`)
  },

  getExpiringPolicies: () =>
    api.get<InsurancePolicy[]>('/finance/insurance/policies/expiring'),

  createPolicy: (data: {
    owner_entity_id: string; policy_number: string; insurer_name: string; broker_name?: string
    policy_type: InsurancePolicyType; insured_asset_type: InsuranceAssetType
    coverage_amount: number; currency?: string; coverage_amount_ttd: number
    premium_amount: number; premium_amount_ttd: number; premium_frequency: PremiumFrequency
    start_date: string; expiry_date: string; renewal_alert_days?: number; notes?: string
  }) => api.post<InsurancePolicy>('/finance/insurance/policies', data),

  updatePolicy: (id: string, data: Partial<{
    policy_number: string; insurer_name: string; broker_name: string
    coverage_amount: number; coverage_amount_ttd: number
    premium_amount: number; premium_amount_ttd: number
    expiry_date: string; renewal_alert_days: number; is_active: boolean; notes: string
  }>) => api.patch<InsurancePolicy>(`/finance/insurance/policies/${id}`, data),

  deletePolicy: (id: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/finance/insurance/policies/${id}`),

  getPremiums: (policyId: string) =>
    api.get<InsurancePremium[]>(`/finance/insurance/policies/${policyId}/premiums`),

  createPremium: (policyId: string, data: {
    due_date: string; amount: number; currency?: string; amount_ttd: number
    payment_method?: string; notes?: string; idempotency_key: string
  }) => api.post<InsurancePremium>(`/finance/insurance/policies/${policyId}/premiums`, data),

  markPremiumPaid: (id: string, data: {
    paid_date: string; payment_method?: string; notes?: string; idempotency_key: string
  }) => api.post<InsurancePremium>(`/finance/insurance/premiums/${id}/mark-paid`, data),

  getClaims: (policyId: string) =>
    api.get<InsuranceClaim[]>(`/finance/insurance/policies/${policyId}/claims`),

  createClaim: (policyId: string, data: {
    incident_date: string; claim_date: string; description: string
    claimed_amount_ttd: number; claim_reference?: string; notes?: string; idempotency_key: string
  }) => api.post<InsuranceClaim>(`/finance/insurance/policies/${policyId}/claims`, data),

  settleClaim: (id: string, data: {
    settled_amount_ttd: number; settlement_date: string; notes?: string; idempotency_key: string
  }) => api.post<InsuranceClaim>(`/finance/insurance/claims/${id}/settle`, data),

  getCharges: (params?: {
    from_entity_id?: string; to_entity_id?: string
    status?: 'DRAFT' | 'POSTED' | 'ELIMINATED'; charge_type?: IntercompanyChargeType
    date_from?: string; date_to?: string; limit?: number; offset?: number
  }) => {
    const qs = params
      ? '?' + new URLSearchParams(Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
        )).toString()
      : ''
    return api.get<IntercompanyCharge[]>(`/finance/intercompany/charges${qs}`)
  },

  createCharge: (data: {
    from_entity_id: string; to_entity_id: string; charge_date: string
    description: string; charge_type: IntercompanyChargeType; amount_ttd: number
    currency?: string; amount_original?: number; fx_rate_used?: number
    notes?: string; idempotency_key: string
  }) => api.post<IntercompanyCharge>('/finance/intercompany/charges', data),

  postCharge: (id: string, data: {
    from_gl_debit_account_id: string; from_gl_credit_account_id: string
    to_gl_debit_account_id: string; to_gl_credit_account_id: string
    idempotency_key: string; notes?: string
  }) => api.post<IntercompanyCharge>(`/finance/intercompany/charges/${id}/post`, data),

  eliminateCharge: (id: string, data: {
    elim_debit_account_id: string; elim_credit_account_id: string
    idempotency_key: string; notes?: string
  }) => api.post<IntercompanyElimination>(`/finance/intercompany/charges/${id}/eliminate`, data),

  getEliminations: (params?: { period_year?: number; period_month?: number }) => {
    const qs = params
      ? '?' + new URLSearchParams(Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
        )).toString()
      : ''
    return api.get<IntercompanyElimination[]>(`/finance/intercompany/eliminations${qs}`)
  },

  // ── Bank Statements ──────────────────────────────────────────────────────────

  uploadBankStatement: (file: File, account_id: string, idempotency_key: string) => {
    const form = new FormData()
    form.append('statement', file)
    form.append('account_id', account_id)
    form.append('idempotency_key', idempotency_key)
    return api.postForm<BankStatementJob>('/finance/bank-statements/upload', form)
  },

  getBankStatementJobs: (params?: { account_id?: string; status?: string; limit?: number; offset?: number }) => {
    const qs = params
      ? '?' + new URLSearchParams(Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
        )).toString()
      : ''
    return api.get<BankStatementJob[]>(`/finance/bank-statements${qs}`)
  },

  deleteBankStatementJob: (id: string) =>
    api.delete<{ deleted: boolean }>(`/finance/bank-statements/${id}`),

  getConsolidated: (params: { period_year: number; period_month?: number }) => {
    const qs = '?' + new URLSearchParams(Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
    )).toString()
    return api.get<{
      period_year: number; period_month: number | null; fdw_available: boolean
      entities: Array<{ entity_id: string; period_year: number; period_month: number; revenue_ttd: string; expenses_ttd: string; net_income_ttd: string }>
      eliminations: Array<{ from_entity_id: string; to_entity_id: string; eliminated_ttd: string }>
      total_eliminated_ttd: string
    }>(`/finance/intercompany/consolidated${qs}`)
  },
}
