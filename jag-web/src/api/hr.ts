import { api } from './client';
import type {
  HrDepartment, HrPosition, HrEmployee, HrEmergencyContact, HrEmploymentHistory,
  HrLeaveType, HrLeaveBalance, HrLeaveRequest,
  HrPayrollRun, HrPayrollEntry,
  HrPerformanceReview,
  HrTrainingType, HrTrainingRecord,
  HrDisciplinaryRecord,
  HrJobPosting, HrJobApplication, HrInterview,
  HrTimesheet, HrTimeEntry,
} from '../types/hr';

function qs(params?: object): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null);
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

export const hrApi = {
  // Departments
  getDepartments: ()                => api.get<HrDepartment[]>('/hr/departments'),
  createDepartment: (d: object)     => api.post<HrDepartment>('/hr/departments', d),
  updateDepartment: (id: string, d: object) => api.patch<HrDepartment>(`/hr/departments/${id}`, d),
  deleteDepartment: (id: string)    => api.delete<{ id: string }>(`/hr/departments/${id}`),

  // Positions
  getPositions: (params?: object)   => api.get<HrPosition[]>(`/hr/positions${qs(params)}`),
  createPosition: (d: object)       => api.post<HrPosition>('/hr/positions', d),
  updatePosition: (id: string, d: object) => api.patch<HrPosition>(`/hr/positions/${id}`, d),
  deletePosition: (id: string)      => api.delete<{ id: string }>(`/hr/positions/${id}`),

  // Employees
  getEmployees: (params?: object)   => api.get<HrEmployee[]>(`/hr/employees${qs(params)}`),
  getEmployee: (id: string)         => api.get<HrEmployee>(`/hr/employees/${id}`),
  createEmployee: (d: object)       => api.post<HrEmployee>('/hr/employees', d),
  updateEmployee: (id: string, d: object) => api.patch<HrEmployee>(`/hr/employees/${id}`, d),
  terminateEmployee: (id: string, d: object) => api.post<HrEmployee>(`/hr/employees/${id}/terminate`, d),
  getEmergencyContacts: (empId: string) => api.get<HrEmergencyContact[]>(`/hr/employees/${empId}/emergency-contacts`),
  addEmergencyContact: (empId: string, d: object) => api.post<HrEmergencyContact>(`/hr/employees/${empId}/emergency-contacts`, d),
  deleteEmergencyContact: (empId: string, ecId: string) => api.delete<{ id: string }>(`/hr/employees/${empId}/emergency-contacts/${ecId}`),
  getEmploymentHistory: (empId: string) => api.get<HrEmploymentHistory[]>(`/hr/employees/${empId}/history`),

  // Leave types
  getLeaveTypes: ()                 => api.get<HrLeaveType[]>('/hr/leave/types'),
  createLeaveType: (d: object)      => api.post<HrLeaveType>('/hr/leave/types', d),
  updateLeaveType: (id: string, d: object) => api.patch<HrLeaveType>(`/hr/leave/types/${id}`, d),

  // Leave balances
  getLeaveBalances: (params?: object) => api.get<HrLeaveBalance[]>(`/hr/leave/balances${qs(params)}`),
  upsertLeaveBalance: (d: object)   => api.post<HrLeaveBalance>('/hr/leave/balances', d),

  // Leave requests
  getLeaveRequests: (params?: object) => api.get<HrLeaveRequest[]>(`/hr/leave/requests${qs(params)}`),
  createLeaveRequest: (d: object)   => api.post<HrLeaveRequest>('/hr/leave/requests', d),
  approveLeave: (id: string)        => api.patch<HrLeaveRequest>(`/hr/leave/requests/${id}/approve`, {}),
  rejectLeave: (id: string, d: object) => api.patch<HrLeaveRequest>(`/hr/leave/requests/${id}/reject`, d),
  cancelLeave: (id: string)         => api.patch<HrLeaveRequest>(`/hr/leave/requests/${id}/cancel`, {}),

  // Payroll runs
  getPayrollRuns: (params?: object) => api.get<HrPayrollRun[]>(`/hr/payroll/runs${qs(params)}`),
  createPayrollRun: (d: object)     => api.post<HrPayrollRun>('/hr/payroll/runs', d),
  getPayrollEntries: (runId: string) => api.get<HrPayrollEntry[]>(`/hr/payroll/runs/${runId}/entries`),
  calculatePayrollRun: (runId: string) => api.post<HrPayrollRun>(`/hr/payroll/runs/${runId}/calculate`, {}),
  finalizePayrollRun: (runId: string) => api.post<HrPayrollRun>(`/hr/payroll/runs/${runId}/finalize`, {}),
  updatePayrollEntry: (runId: string, entryId: string, d: object) =>
    api.patch<HrPayrollEntry>(`/hr/payroll/runs/${runId}/entries/${entryId}`, d),
  getPayslip: (runId: string, empId: string) =>
    api.get<{ run: HrPayrollRun; entry: HrPayrollEntry; employee: HrEmployee }>(`/hr/payroll/runs/${runId}/payslip/${empId}`),

  // Performance reviews
  getReviews: (params?: object)     => api.get<HrPerformanceReview[]>(`/hr/performance/reviews${qs(params)}`),
  createReview: (d: object)         => api.post<HrPerformanceReview>('/hr/performance/reviews', d),
  updateReview: (id: string, d: object) => api.patch<HrPerformanceReview>(`/hr/performance/reviews/${id}`, d),
  submitReview: (id: string)        => api.patch<HrPerformanceReview>(`/hr/performance/reviews/${id}/submit`, {}),
  acknowledgeReview: (id: string)   => api.patch<HrPerformanceReview>(`/hr/performance/reviews/${id}/acknowledge`, {}),
  deleteReview: (id: string)        => api.delete<{ id: string }>(`/hr/performance/reviews/${id}`),

  // Training types
  getTrainingTypes: ()              => api.get<HrTrainingType[]>('/hr/training/types'),
  createTrainingType: (d: object)   => api.post<HrTrainingType>('/hr/training/types', d),

  // Training records
  getTrainingRecords: (params?: object) => api.get<HrTrainingRecord[]>(`/hr/training/records${qs(params)}`),
  createTrainingRecord: (d: object) => api.post<HrTrainingRecord>('/hr/training/records', d),
  updateTrainingRecord: (id: string, d: object) => api.patch<HrTrainingRecord>(`/hr/training/records/${id}`, d),
  deleteTrainingRecord: (id: string) => api.delete<{ id: string }>(`/hr/training/records/${id}`),

  // Disciplinary
  getDisciplinaryRecords: (params?: object) => api.get<HrDisciplinaryRecord[]>(`/hr/disciplinary${qs(params)}`),
  createDisciplinaryRecord: (d: object) => api.post<HrDisciplinaryRecord>('/hr/disciplinary', d),
  updateDisciplinaryRecord: (id: string, d: object) => api.patch<HrDisciplinaryRecord>(`/hr/disciplinary/${id}`, d),
  acknowledgeDisciplinaryRecord: (id: string) => api.patch<HrDisciplinaryRecord>(`/hr/disciplinary/${id}/acknowledge`, {}),
  deleteDisciplinaryRecord: (id: string) => api.delete<{ id: string }>(`/hr/disciplinary/${id}`),

  // Recruitment — postings
  getJobPostings: (params?: object) => api.get<HrJobPosting[]>(`/hr/recruitment/postings${qs(params)}`),
  createJobPosting: (d: object)     => api.post<HrJobPosting>('/hr/recruitment/postings', d),
  updateJobPosting: (id: string, d: object) => api.patch<HrJobPosting>(`/hr/recruitment/postings/${id}`, d),
  deleteJobPosting: (id: string)    => api.delete<{ id: string }>(`/hr/recruitment/postings/${id}`),

  // Recruitment — applications
  getApplications: (params?: object) => api.get<HrJobApplication[]>(`/hr/recruitment/applications${qs(params)}`),
  createApplication: (d: object)    => api.post<HrJobApplication>('/hr/recruitment/applications', d),
  updateApplication: (id: string, d: object) => api.patch<HrJobApplication>(`/hr/recruitment/applications/${id}`, d),
  advanceApplication: (id: string)  => api.post<HrJobApplication>(`/hr/recruitment/applications/${id}/advance`, {}),
  rejectApplication: (id: string, d: object) => api.post<HrJobApplication>(`/hr/recruitment/applications/${id}/reject`, d),
  hireApplicant: (id: string, d: object) => api.post<HrJobApplication>(`/hr/recruitment/applications/${id}/hire`, d),

  // Recruitment — interviews
  getInterviews: (params?: object)  => api.get<HrInterview[]>(`/hr/recruitment/interviews${qs(params)}`),
  createInterview: (d: object)      => api.post<HrInterview>('/hr/recruitment/interviews', d),
  updateInterview: (id: string, d: object) => api.patch<HrInterview>(`/hr/recruitment/interviews/${id}`, d),
  deleteInterview: (id: string)     => api.delete<{ id: string }>(`/hr/recruitment/interviews/${id}`),

  // Attendance — timesheets
  getTimesheets: (params?: object)  => api.get<HrTimesheet[]>(`/hr/attendance/timesheets${qs(params)}`),
  createTimesheet: (d: object)      => api.post<HrTimesheet>('/hr/attendance/timesheets', d),
  submitTimesheet: (id: string)     => api.patch<HrTimesheet>(`/hr/attendance/timesheets/${id}/submit`, {}),
  approveTimesheet: (id: string)    => api.patch<HrTimesheet>(`/hr/attendance/timesheets/${id}/approve`, {}),
  rejectTimesheet: (id: string, d: object) => api.patch<HrTimesheet>(`/hr/attendance/timesheets/${id}/reject`, d),

  // Attendance — time entries
  getTimeEntries: (params?: object) => api.get<HrTimeEntry[]>(`/hr/attendance/entries${qs(params)}`),
  createTimeEntry: (d: object)      => api.post<HrTimeEntry>('/hr/attendance/entries', d),
  updateTimeEntry: (id: string, d: object) => api.patch<HrTimeEntry>(`/hr/attendance/entries/${id}`, d),
  deleteTimeEntry: (id: string)     => api.delete<{ id: string }>(`/hr/attendance/entries/${id}`),
};
