import { api } from './client'

export interface ClinicRegistration {
  id: string
  family_member_id: string
  facility_name: string
  department: string | null
  registration_number: string | null
  next_appointment_date: string | null
  calendar_event_id: string | null
  notes: string | null
  last_modified_at: string
  created_at: string
}

export const clinicRegistrationsApi = {
  list: (params?: { family_member_id?: string }) => {
    const q = new URLSearchParams()
    if (params?.family_member_id) q.set('family_member_id', params.family_member_id)
    const qs = q.toString()
    return api.get<ClinicRegistration[]>(`/lifestyle/clinic-registrations${qs ? `?${qs}` : ''}`)
  },

  create: (data: {
    family_member_id: string
    facility_name: string
    department?: string
    registration_number?: string
    next_appointment_date?: string
    notes?: string
  }) => api.post<ClinicRegistration>('/lifestyle/clinic-registrations', data),

  update: (id: string, data: Partial<{
    family_member_id: string
    facility_name: string
    department: string
    registration_number: string
    next_appointment_date: string
    notes: string
  }>) => api.patch<ClinicRegistration>(`/lifestyle/clinic-registrations/${id}`, data),

  delete: (id: string) => api.delete<{ deleted: boolean }>(`/lifestyle/clinic-registrations/${id}`),

  syncCalendar: (id: string) => api.post<ClinicRegistration>(`/lifestyle/clinic-registrations/${id}/sync-calendar`, {}),
}
