// Mirrors the backend CATEGORIES / PAYMENT_METHODS enums in expenses.ts.
// Update both places if the backend enum changes.

export const CATEGORIES = [
  'PERSONAL_EXPENSE', 'GROCERIES', 'DINING', 'TRANSPORT', 'FUEL',
  'UTILITIES', 'ENTERTAINMENT', 'TRAVEL', 'MEDICAL', 'EDUCATION',
  'CLOTHING', 'SUBSCRIPTIONS', 'MAINTENANCE', 'INSURANCE', 'CHARITY',
  'OPERATING_EXPENSE', 'PAYROLL', 'TAX_PAYMENT', 'LOAN_REPAYMENT',
  'INVESTMENT_PURCHASE', 'TRANSFER_OUT', 'UNCLASSIFIED',
] as const
export type ExpenseCategory = (typeof CATEGORIES)[number]

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  PERSONAL_EXPENSE:    'Personal Expense',
  GROCERIES:           'Groceries',
  DINING:              'Dining & Restaurants',
  TRANSPORT:           'Transport',
  FUEL:                'Fuel',
  UTILITIES:           'Utilities',
  ENTERTAINMENT:       'Entertainment',
  TRAVEL:              'Travel',
  MEDICAL:             'Medical',
  EDUCATION:           'Education',
  CLOTHING:            'Clothing',
  SUBSCRIPTIONS:       'Subscriptions',
  MAINTENANCE:         'Maintenance & Repairs',
  INSURANCE:           'Insurance',
  CHARITY:             'Charity',
  OPERATING_EXPENSE:   'Operating Expense',
  PAYROLL:             'Payroll',
  TAX_PAYMENT:         'Tax Payment',
  LOAN_REPAYMENT:      'Loan Repayment',
  INVESTMENT_PURCHASE: 'Investment Purchase',
  TRANSFER_OUT:        'Transfer Out',
  UNCLASSIFIED:        'Unclassified',
}

export const PAYMENT_METHODS = [
  'CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'CHEQUE', 'DIRECT_DEBIT', 'OTHER',
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH:          'Cash',
  BANK_TRANSFER: 'Bank Transfer',
  CREDIT_CARD:   'Credit Card',
  DEBIT_CARD:    'Debit Card',
  CHEQUE:        'Cheque',
  DIRECT_DEBIT:  'Direct Debit',
  OTHER:         'Other',
}

export const ENTITY_OPTIONS = [
  { id: '00000000-0000-0000-0001-000000000008', name: 'Personal — Robert' },
  { id: '00000000-0000-0000-0001-000000000001', name: 'JAG Holdings' },
  { id: '00000000-0000-0000-0001-000000000002', name: 'JABCO' },
  { id: '00000000-0000-0000-0001-000000000003', name: 'JAG Properties' },
  { id: '00000000-0000-0000-0001-000000000004', name: 'JAG Entertainment' },
  { id: '00000000-0000-0000-0001-000000000005', name: 'JAG Finance' },
  { id: '00000000-0000-0000-0001-000000000006', name: 'DragonBridge' },
  { id: '00000000-0000-0000-0001-000000000007', name: 'NLCB' },
] as const

export const CURRENCIES = ['TTD', 'USD', 'CNY', 'EUR', 'GBP'] as const
export type Currency = (typeof CURRENCIES)[number]
