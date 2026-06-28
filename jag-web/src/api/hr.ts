import { api, tenantApi } from './client';
import type {
  HrDepartment, HrPosition, HrEmployee, HrEmergencyContact, HrEmploymentHistory,
  HrLeaveType, HrLeaveBalance, HrLeaveRequest,
  HrPayrollRun, HrPayrollEntry,
  HrPerformanceReview,
  HrTrainingType, HrTrainingRecord,
  HrDisciplinaryRecord,
  HrJobPosting, HrJobApplication, HrInterview,
  HrTimesheet, HrTimeEntry,
  HrSalaryAdvance, HrStaffLoan,
} from '../types/hr';

function qs(params?: object): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null);
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

function makeHrApi(entityId?: string) {
  const a = entityId ? tenantApi(entityId) : api;
  return {
    // Departments
    getDepartments: ()                => a.get<HrDepartment[]>('/hr/departments'),
    createDepartment: (d: object)     => a.post<HrDepartment>('/hr/departments', d),
    updateDepartment: (id: string, d: object) => a.patch<HrDepartment>(`/hr/departments/${id}`, d),
    deleteDepartment: (id: string)    => a.delete<{ id: string }>(`/hr/departments/${id}`),

    // Positions
    getPositions: (params?: object)   => a.get<HrPosition[]>(`/hr/positions${qs(params)}`),
    createPosition: (d: object)       => a.post<HrPosition>('/hr/positions', d),
    updatePosition: (id: string, d: object) => a.patch<HrPosition>(`/hr/positions/${id}`, d),
    deletePosition: (id: string)      => a.delete<{ id: string }>(`/hr/positions/${id}`),

    // Employees
    getEmployees: (params?: object)   => a.get<HrEmployee[]>(`/hr/employees${qs(params)}`),
    getEmployee: (id: string)         => a.get<HrEmployee>(`/hr/employees/${id}`),
    createEmployee: (d: object)       => a.post<HrEmployee>('/hr/employees', d),
    updateEmployee: (id: string, d: object) => a.patch<HrEmployee>(`/hr/employees/${id}`, d),
    terminateEmployee: (id: string, d: object) => a.post<HrEmployee>(`/hr/employees/${id}/terminate`, d),
    getEmergencyContacts: (empId: string) => a.get<HrEmergencyContact[]>(`/hr/employees/${empId}/emergency-contacts`),
    addEmergencyContact: (empId: string, d: object) => a.post<HrEmergencyContact>(`/hr/employees/${empId}/emergency-contacts`, d),
    deleteEmergencyContact: (empId: string, ecId: string) => a.delete<{ id: string }>(`/hr/employees/${empId}/emergency-contacts/${ecId}`),
    getEmploymentHistory: (empId: string) => a.get<HrEmploymentHistory[]>(`/hr/employees/${empId}/history`),

    // Leave types
    getLeaveTypes: ()                 => a.get<HrLeaveType[]>('/hr/leave/types'),
    createLeaveType: (d: object)      => a.post<HrLeaveType>('/hr/leave/types', d),
    updateLeaveType: (id: string, d: object) => a.patch<HrLeaveType>(`/hr/leave/types/${id}`, d),

    // Leave balances
    getLeaveBalances: (params?: object) => a.get<HrLeaveBalance[]>(`/hr/leave/balances${qs(params)}`),
    upsertLeaveBalance: (d: object)   => a.post<HrLeaveBalance>('/hr/leave/balances', d),

    // Leave requests
    getLeaveRequests: (params?: object) => a.get<HrLeaveRequest[]>(`/hr/leave/requests${qs(params)}`),
    createLeaveRequest: (d: object)   => a.post<HrLeaveRequest>('/hr/leave/requests', d),
    approveLeave: (id: string)        => a.patch<HrLeaveRequest>(`/hr/leave/requests/${id}/approve`, {}),
    rejectLeave: (id: string, d: object) => a.patch<HrLeaveRequest>(`/hr/leave/requests/${id}/reject`, d),
    cancelLeave: (id: string)         => a.patch<HrLeaveRequest>(`/hr/leave/requests/${id}/cancel`, {}),

    // Payroll runs
    getPayrollRuns: (params?: object) => a.get<HrPayrollRun[]>(`/hr/payroll/runs${qs(params)}`),
    createPayrollRun: (d: object)     => a.post<HrPayrollRun>('/hr/payroll/runs', d),
    getPayrollEntries: (runId: string) => a.get<HrPayrollEntry[]>(`/hr/payroll/runs/${runId}/entries`),
    calculatePayrollRun: (runId: string) => a.post<HrPayrollRun>(`/hr/payroll/runs/${runId}/calculate`, {}),
    finalizePayrollRun: (runId: string) => a.post<HrPayrollRun>(`/hr/payroll/runs/${runId}/finalize`, {}),
    updatePayrollEntry: (runId: string, entryId: string, d: object) =>
      a.patch<HrPayrollEntry>(`/hr/payroll/runs/${runId}/entries/${entryId}`, d),
    getPayslip: (runId: string, empId: string) =>
      a.get<{ run: HrPayrollRun; entry: HrPayrollEntry; employee: HrEmployee }>(`/hr/payroll/runs/${runId}/payslip/${empId}`),

    // Performance reviews
    getReviews: (params?: object)     => a.get<HrPerformanceReview[]>(`/hr/performance/reviews${qs(params)}`),
    createReview: (d: object)         => a.post<HrPerformanceReview>('/hr/performance/reviews', d),
    updateReview: (id: string, d: object) => a.patch<HrPerformanceReview>(`/hr/performance/reviews/${id}`, d),
    submitReview: (id: string)        => a.patch<HrPerformanceReview>(`/hr/performance/reviews/${id}/submit`, {}),
    acknowledgeReview: (id: string)   => a.patch<HrPerformanceReview>(`/hr/performance/reviews/${id}/acknowledge`, {}),
    deleteReview: (id: string)        => a.delete<{ id: string }>(`/hr/performance/reviews/${id}`),

    // Training types
    getTrainingTypes: ()              => a.get<HrTrainingType[]>('/hr/training/types'),
    createTrainingType: (d: object)   => a.post<HrTrainingType>('/hr/training/types', d),

    // Training records
    getTrainingRecords: (params?: object) => a.get<HrTrainingRecord[]>(`/hr/training/records${qs(params)}`),
    createTrainingRecord: (d: object) => a.post<HrTrainingRecord>('/hr/training/records', d),
    updateTrainingRecord: (id: string, d: object) => a.patch<HrTrainingRecord>(`/hr/training/records/${id}`, d),
    deleteTrainingRecord: (id: string) => a.delete<{ id: string }>(`/hr/training/records/${id}`),

    // Disciplinary
    getDisciplinaryRecords: (params?: object) => a.get<HrDisciplinaryRecord[]>(`/hr/disciplinary${qs(params)}`),
    createDisciplinaryRecord: (d: object) => a.post<HrDisciplinaryRecord>('/hr/disciplinary', d),
    updateDisciplinaryRecord: (id: string, d: object) => a.patch<HrDisciplinaryRecord>(`/hr/disciplinary/${id}`, d),
    acknowledgeDisciplinaryRecord: (id: string) => a.patch<HrDisciplinaryRecord>(`/hr/disciplinary/${id}/acknowledge`, {}),
    deleteDisciplinaryRecord: (id: string) => a.delete<{ id: string }>(`/hr/disciplinary/${id}`),

    // Recruitment — postings
    getJobPostings: (params?: object) => a.get<HrJobPosting[]>(`/hr/recruitment/postings${qs(params)}`),
    createJobPosting: (d: object)     => a.post<HrJobPosting>('/hr/recruitment/postings', d),
    updateJobPosting: (id: string, d: object) => a.patch<HrJobPosting>(`/hr/recruitment/postings/${id}`, d),
    deleteJobPosting: (id: string)    => a.delete<{ id: string }>(`/hr/recruitment/postings/${id}`),

    // Recruitment — applications
    getApplications: (params?: object) => a.get<HrJobApplication[]>(`/hr/recruitment/applications${qs(params)}`),
    createApplication: (d: object)    => a.post<HrJobApplication>('/hr/recruitment/applications', d),
    updateApplication: (id: string, d: object) => a.patch<HrJobApplication>(`/hr/recruitment/applications/${id}`, d),
    advanceApplication: (id: string)  => a.post<HrJobApplication>(`/hr/recruitment/applications/${id}/advance`, {}),
    rejectApplication: (id: string, d: object) => a.post<HrJobApplication>(`/hr/recruitment/applications/${id}/reject`, d),
    hireApplicant: (id: string, d: object) => a.post<HrJobApplication>(`/hr/recruitment/applications/${id}/hire`, d),

    // Recruitment — interviews
    getInterviews: (params?: object)  => a.get<HrInterview[]>(`/hr/recruitment/interviews${qs(params)}`),
    createInterview: (d: object)      => a.post<HrInterview>('/hr/recruitment/interviews', d),
    updateInterview: (id: string, d: object) => a.patch<HrInterview>(`/hr/recruitment/interviews/${id}`, d),
    deleteInterview: (id: string)     => a.delete<{ id: string }>(`/hr/recruitment/interviews/${id}`),

    // Attendance — timesheets
    getTimesheets: (params?: object)  => a.get<HrTimesheet[]>(`/hr/attendance/timesheets${qs(params)}`),
    createTimesheet: (d: object)      => a.post<HrTimesheet>('/hr/attendance/timesheets', d),
    submitTimesheet: (id: string)     => a.patch<HrTimesheet>(`/hr/attendance/timesheets/${id}/submit`, {}),
    approveTimesheet: (id: string)    => a.patch<HrTimesheet>(`/hr/attendance/timesheets/${id}/approve`, {}),
    rejectTimesheet: (id: string, d: object) => a.patch<HrTimesheet>(`/hr/attendance/timesheets/${id}/reject`, d),

    // Attendance — time entries
    getTimeEntries: (params?: object) => a.get<HrTimeEntry[]>(`/hr/attendance/entries${qs(params)}`),
    createTimeEntry: (d: object)      => a.post<HrTimeEntry>('/hr/attendance/entries', d),
    updateTimeEntry: (id: string, d: object) => a.patch<HrTimeEntry>(`/hr/attendance/entries/${id}`, d),
    deleteTimeEntry: (id: string)     => a.delete<{ id: string }>(`/hr/attendance/entries/${id}`),

    // Salary advances
    getAdvances: (params?: object)    => a.get<HrSalaryAdvance[]>(`/hr/advances${qs(params)}`),
    createAdvance: (d: object)        => a.post<HrSalaryAdvance>('/hr/advances', d),
    updateAdvance: (id: string, d: object) => a.patch<HrSalaryAdvance>(`/hr/advances/${id}`, d),
    cancelAdvance: (id: string)       => a.delete<{ id: string }>(`/hr/advances/${id}`),

    // Staff loans
    getLoans: (params?: object)       => a.get<HrStaffLoan[]>(`/hr/loans${qs(params)}`),
    createLoan: (d: object)           => a.post<HrStaffLoan>('/hr/loans', d),
    updateLoan: (id: string, d: object) => a.patch<HrStaffLoan>(`/hr/loans/${id}`, d),
    cancelLoan: (id: string)          => a.delete<{ id: string }>(`/hr/loans/${id}`),
  };
}

export const hrApi = makeHrApi();
export const hrApiFor = (entityId: string) => makeHrApi(entityId);
