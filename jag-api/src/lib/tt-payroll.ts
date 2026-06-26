/**
 * Trinidad & Tobago statutory payroll calculations.
 *
 * Rates in effect as of 2025 fiscal year:
 *   NIS employee:     3.15% of insurable monthly earnings (ceiling $15,000 TTD/month)
 *   NIS employer:     6.30% of insurable monthly earnings (same ceiling)
 *   Health Surcharge: $8.25/week = $35.75/month (flat rate for employed persons)
 *   PAYE:             personal allowance $84,000/year; 25% on first $1,000,000 chargeable; 30% above
 *
 * All inputs and outputs are in TTD. Inputs are monthly gross salary.
 */

// NIS
const NIS_EMPLOYEE_RATE            = 0.0315
const NIS_EMPLOYER_RATE            = 0.0630
const NIS_MONTHLY_INSURABLE_CEILING = 15_000   // TTD

// Health Surcharge — flat per month for salaried/monthly employees
const HEALTH_SURCHARGE_MONTHLY = 35.75          // 8.25 × 52 / 12, rounded

// PAYE
const PERSONAL_ALLOWANCE_ANNUAL    = 84_000     // TTD
const PAYE_LOWER_RATE              = 0.25        // 25%
const PAYE_UPPER_RATE              = 0.30        // 30%
const PAYE_UPPER_THRESHOLD_ANNUAL  = 1_000_000  // TTD — threshold where upper rate kicks in

export interface PayrollCalculation {
  grossSalaryTtd:      number
  nisEmployeeTtd:      number
  nisEmployerTtd:      number
  healthSurchargeTtd:  number
  payeTtd:             number
  totalDeductionsTtd:  number   // employee-side only (nis + health + paye)
  netPayTtd:           number
}

/**
 * Calculate statutory deductions for a monthly-paid employee.
 * Pass the monthly gross salary (base + allowances) in TTD.
 */
export function calculateTTPayroll(monthlyGross: number): PayrollCalculation {
  const gross = Math.max(0, monthlyGross)

  // NIS — capped at insurable ceiling
  const insurableBase    = Math.min(gross, NIS_MONTHLY_INSURABLE_CEILING)
  const nisEmployee      = round2(insurableBase * NIS_EMPLOYEE_RATE)
  const nisEmployer      = round2(insurableBase * NIS_EMPLOYER_RATE)

  // Health Surcharge — flat
  const healthSurcharge  = gross > 0 ? HEALTH_SURCHARGE_MONTHLY : 0

  // PAYE — annualise → subtract personal allowance → apply rates → monthly
  const annualGross      = gross * 12
  const chargeableAnnual = Math.max(0, annualGross - PERSONAL_ALLOWANCE_ANNUAL)

  let annualPaye = 0
  if (chargeableAnnual > 0) {
    if (chargeableAnnual <= PAYE_UPPER_THRESHOLD_ANNUAL) {
      annualPaye = chargeableAnnual * PAYE_LOWER_RATE
    } else {
      annualPaye = PAYE_UPPER_THRESHOLD_ANNUAL * PAYE_LOWER_RATE
               + (chargeableAnnual - PAYE_UPPER_THRESHOLD_ANNUAL) * PAYE_UPPER_RATE
    }
  }
  const paye = round2(annualPaye / 12)

  const totalDeductions = round2(nisEmployee + healthSurcharge + paye)
  const netPay          = round2(gross - totalDeductions)

  return {
    grossSalaryTtd:     round2(gross),
    nisEmployeeTtd:     nisEmployee,
    nisEmployerTtd:     nisEmployer,
    healthSurchargeTtd: round2(healthSurcharge),
    payeTtd:            paye,
    totalDeductionsTtd: totalDeductions,
    netPayTtd:          netPay,
  }
}

/**
 * Calculate deductions for a biweekly or weekly pay frequency.
 * Converts to a monthly-equivalent internally, applies the monthly formula,
 * then scales back.
 */
export function calculateTTPayrollForFrequency(
  periodicGross: number,
  frequency: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY',
): PayrollCalculation {
  const periodsPerMonth = frequency === 'MONTHLY' ? 1
                        : frequency === 'BIWEEKLY' ? 26 / 12
                        : 52 / 12

  const monthlyEquivalent = periodicGross * periodsPerMonth
  const monthly           = calculateTTPayroll(monthlyEquivalent)

  if (frequency === 'MONTHLY') return monthly

  const scale = 1 / periodsPerMonth
  return {
    grossSalaryTtd:     round2(periodicGross),
    nisEmployeeTtd:     round2(monthly.nisEmployeeTtd * scale),
    nisEmployerTtd:     round2(monthly.nisEmployerTtd * scale),
    healthSurchargeTtd: round2(monthly.healthSurchargeTtd * scale),
    payeTtd:            round2(monthly.payeTtd * scale),
    totalDeductionsTtd: round2(monthly.totalDeductionsTtd * scale),
    netPayTtd:          round2(periodicGross - round2(monthly.totalDeductionsTtd * scale)),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
