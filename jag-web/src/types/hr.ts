export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'CASUAL';
export type EmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'TERMINATED' | 'ON_LEAVE';
export type IdType = 'NATIONAL_ID' | 'PASSPORT' | 'DRIVERS_LICENCE';
export type PayFrequency = 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY';

export interface HrDepartment {
  id: string;
  tenant_id: string;
  name: string;
  code: string | null;
  parent_dept_id: string | null;
  manager_employee_id: string | null;
  manager_name?: string;
  employee_count?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HrPosition {
  id: string;
  tenant_id: string;
  name: string;
  code: string | null;
  department_id: string | null;
  department_name?: string;
  min_salary_ttd: string | null;
  max_salary_ttd: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HrEmployee {
  id: string;
  tenant_id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  id_type: IdType | null;
  id_number: string | null;
  nis_number: string | null;
  birs_tax_id: string | null;
  address: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  phone2: string | null;
  position_id: string | null;
  department_id: string | null;
  manager_id: string | null;
  employment_type: EmploymentType;
  status: EmployeeStatus;
  hire_date: string | null;
  probation_end_date: string | null;
  termination_date: string | null;
  termination_reason: string | null;
  base_salary_ttd: string | null;
  pay_frequency: PayFrequency;
  bank_name: string | null;
  bank_branch: string | null;
  account_number: string | null;
  account_type: string | null;
  profile_photo_url: string | null;
  notes: string | null;
  // joined
  position_name?: string;
  department_name?: string;
  manager_name?: string;
  created_at: string;
  updated_at: string;
}

export interface HrEmergencyContact {
  id: string;
  employee_id: string;
  name: string;
  relationship: string;
  phone: string;
  phone2: string | null;
  email: string | null;
  is_primary: boolean;
}

export interface HrEmploymentHistory {
  id: string;
  employee_id: string;
  effective_date: string;
  change_type: string;
  previous_position: string | null;
  new_position: string | null;
  previous_salary_ttd: string | null;
  new_salary_ttd: string | null;
  change_reason: string | null;
  changed_by: string | null;
  created_at: string;
}

// ── Leave ─────────────────────────────────────────────────────────────────────
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface HrLeaveType {
  id: string;
  name: string;
  code: string;
  days_per_year: number;
  is_paid: boolean;
  carry_over_days: number;
  requires_approval: boolean;
  description: string | null;
  is_active: boolean;
}

export interface HrLeaveBalance {
  id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  entitled_days: number;
  used_days: number;
  carried_over_days: number;
  employee_name?: string;
  leave_type_name?: string;
}

export interface HrLeaveRequest {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days_requested: number;
  reason: string | null;
  status: LeaveStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  employee_name?: string;
  leave_type_name?: string;
  created_at: string;
  updated_at: string;
}

// ── Payroll ───────────────────────────────────────────────────────────────────
export type PayrollRunStatus = 'DRAFT' | 'FINALIZED' | 'PAID';
export type PayrollEntryStatus = 'INCLUDED' | 'EXCLUDED';

export interface HrPayrollRun {
  id: string;
  tenant_id: string;
  period_month: number;
  period_year: number;
  pay_date: string | null;
  status: PayrollRunStatus;
  total_gross_ttd: string | null;
  total_net_ttd: string | null;
  total_nis_employee_ttd: string | null;
  total_nis_employer_ttd: string | null;
  total_paye_ttd: string | null;
  total_health_surcharge_ttd: string | null;
  journal_entry_id: string | null;
  idempotency_key: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HrPayrollDeductionItem {
  id: string;
  payroll_entry_id: string;
  label: string;
  amount_ttd: string;
  deduction_type: string;
  reference_id: string | null;
}

export interface HrPayrollEntry {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  base_salary_ttd: string;
  overtime_hours: string | null;
  overtime_rate_ttd: string | null;
  overtime_pay_ttd: string | null;
  bonus_ttd: string | null;
  other_allowances_ttd: string | null;
  total_gross_ttd: string;
  nis_employee_ttd: string | null;
  health_surcharge_ttd: string | null;
  paye_ttd: string | null;
  other_deductions_ttd: string | null;
  total_deductions_ttd: string | null;
  net_pay_ttd: string | null;
  nis_employer_ttd: string | null;
  unpaid_leave_days: string | null;
  notes: string | null;
  status: PayrollEntryStatus;
  employee_name?: string;
  employee_number?: string;
  position_name?: string;
  department_name?: string;
  pay_frequency?: string;
  deduction_items?: HrPayrollDeductionItem[];
}

// ── Performance ───────────────────────────────────────────────────────────────
export type ReviewPeriod = 'MID_YEAR' | 'ANNUAL' | 'PROBATION';
export type ReviewStatus = 'DRAFT' | 'SUBMITTED' | 'ACKNOWLEDGED';

export interface HrPerformanceReview {
  id: string;
  employee_id: string;
  reviewer_id: string | null;
  review_period: ReviewPeriod;
  review_year: number;
  review_date: string | null;
  overall_rating: number | null;
  goals_met_rating: number | null;
  competency_rating: number | null;
  attendance_rating: number | null;
  strengths: string | null;
  areas_for_improvement: string | null;
  goals_next_period: string | null;
  employee_comments: string | null;
  status: ReviewStatus;
  acknowledged_at: string | null;
  employee_name?: string;
  reviewer_name?: string;
  created_at: string;
  updated_at: string;
}

// ── Training ──────────────────────────────────────────────────────────────────
export type TrainingStatus = 'PLANNED' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';

export interface HrTrainingType {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  is_active: boolean;
}

export interface HrTrainingRecord {
  id: string;
  employee_id: string;
  training_type_id: string | null;
  training_name: string;
  provider: string | null;
  training_date: string | null;
  expiry_date: string | null;
  certificate_number: string | null;
  certificate_url: string | null;
  cost_ttd: string | null;
  status: TrainingStatus;
  notes: string | null;
  employee_name?: string;
  training_type_name?: string;
  expiry_status?: 'EXPIRED' | 'EXPIRING_SOON' | 'VALID';
  created_at: string;
  updated_at: string;
}

// ── Disciplinary ──────────────────────────────────────────────────────────────
export type DisciplinarySeverity = 'VERBAL_WARNING' | 'WRITTEN_WARNING' | 'FINAL_WARNING' | 'SUSPENSION' | 'DISMISSAL';

export interface HrDisciplinaryRecord {
  id: string;
  employee_id: string;
  incident_date: string;
  reported_date: string | null;
  incident_type: string;
  severity: DisciplinarySeverity;
  description: string;
  action_taken: string | null;
  outcome: string | null;
  investigation_conducted: boolean;
  union_involved: boolean;
  appeal_filed: boolean;
  appeal_outcome: string | null;
  issued_by_employee_id: string | null;
  acknowledged_by_employee: boolean;
  acknowledged_at: string | null;
  document_url: string | null;
  employee_name?: string;
  issued_by_name?: string;
  created_at: string;
  updated_at: string;
}

// ── Recruitment ───────────────────────────────────────────────────────────────
export type PostingStatus = 'DRAFT' | 'OPEN' | 'CLOSED' | 'FILLED' | 'CANCELLED';
export type ApplicationStage = 'APPLIED' | 'SCREENING' | 'INTERVIEW' | 'ASSESSMENT' | 'OFFER' | 'HIRED' | 'REJECTED' | 'WITHDRAWN';
export type InterviewType = 'PHONE' | 'VIDEO' | 'IN_PERSON' | 'PANEL' | 'TECHNICAL';
export type InterviewStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface HrJobPosting {
  id: string;
  tenant_id: string;
  position_id: string | null;
  title: string;
  description: string | null;
  requirements: string | null;
  salary_min_ttd: string | null;
  salary_max_ttd: string | null;
  employment_type: EmploymentType | null;
  location: string | null;
  department_id: string | null;
  vacancies: number;
  status: PostingStatus;
  posted_date: string | null;
  closing_date: string | null;
  department_name?: string;
  position_name?: string;
  created_at: string;
  updated_at: string;
}

export interface HrJobApplication {
  id: string;
  job_posting_id: string;
  applicant_name: string;
  email: string | null;
  phone: string | null;
  current_employer: string | null;
  current_title: string | null;
  years_experience: number | null;
  cv_url: string | null;
  source: string;
  stage: ApplicationStage;
  rejection_reason: string | null;
  notes: string | null;
  hired_employee_id: string | null;
  posting_title?: string;
  created_at: string;
  updated_at: string;
}

export interface HrInterview {
  id: string;
  application_id: string;
  interview_type: InterviewType;
  scheduled_at: string;
  duration_minutes: number;
  location: string | null;
  interviewer_employee_id: string | null;
  status: InterviewStatus;
  rating: number | null;
  notes: string | null;
  calendar_event_id: string | null;
  interviewer_name?: string;
  created_at: string;
  updated_at: string;
}

// ── Salary Advances & Staff Loans ─────────────────────────────────────────────
export type AdvanceStatus = 'ACTIVE' | 'RECOVERED' | 'WRITTEN_OFF' | 'CANCELLED';
export type LoanStatus    = 'ACTIVE' | 'PAID_OFF'  | 'WRITTEN_OFF' | 'CANCELLED';

export interface HrSalaryAdvance {
  id: string;
  tenant_id: string;
  employee_id: string;
  employee_name?: string;
  employee_number?: string;
  advance_date: string;
  amount_ttd: string;
  recovery_installment_ttd: string;
  total_recovered_ttd: string;
  outstanding_ttd?: string;
  status: AdvanceStatus;
  reason: string | null;
  approved_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface HrStaffLoan {
  id: string;
  tenant_id: string;
  employee_id: string;
  employee_name?: string;
  employee_number?: string;
  loan_date: string;
  principal_ttd: string;
  interest_rate: string;
  monthly_installment_ttd: string;
  total_repaid_ttd: string;
  outstanding_balance_ttd: string;
  status: LoanStatus;
  reason: string | null;
  approved_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── Attendance ────────────────────────────────────────────────────────────────
export type TimesheetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type TimeEntryType = 'REGULAR' | 'OVERTIME' | 'PUBLIC_HOLIDAY' | 'SICK' | 'OTHER';

export interface HrTimesheet {
  id: string;
  employee_id: string;
  week_start_date: string;
  week_end_date: string;
  status: TimesheetStatus;
  total_hours: string | null;
  total_overtime_hours: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  employee_name?: string;
  employee_number?: string;
  created_at: string;
  updated_at: string;
}

export interface HrTimeEntry {
  id: string;
  employee_id: string;
  timesheet_id: string | null;
  entry_date: string;
  clock_in: string | null;
  clock_out: string | null;
  break_minutes: number;
  hours_worked: string;
  is_overtime: boolean;
  entry_type: TimeEntryType;
  notes: string | null;
  employee_name?: string;
  created_at: string;
  updated_at: string;
}
