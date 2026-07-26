import { api } from './client'

export type RecordType =
  | 'LAB_RESULT' | 'IMAGING' | 'PRESCRIPTION' | 'CLINIC_CARD' | 'REFERRAL'
  | 'DISCHARGE_SUMMARY' | 'VISIT_NOTE' | 'IMMUNIZATION' | 'DEVICE_EQUIPMENT'
  | 'INVOICE' | 'CHRONOLOGY_SUMMARY' | 'OTHER'

export type RecordStatus = 'REVIEW' | 'APPROVED' | 'REJECTED'
export type ExtractedBy = 'CLAUDE' | 'OLLAMA' | 'MANUAL'

export interface MedicalRecord {
  id: string
  family_member_id: string
  record_type: RecordType
  specialty: string | null
  provider_name: string | null
  facility_name: string | null
  record_date: string | null
  record_date_end: string | null
  title: string
  summary: string | null
  details: Record<string, unknown>
  source_file_name: string | null
  status: RecordStatus
  extracted_by: ExtractedBy
  reviewed_at: string | null
  last_modified_at: string
  created_at: string
}

export interface Diagnosis { name: string; since?: string; status?: string; notes?: string }
export interface Medication { name: string; dose?: string; frequency?: string; prescribed_by?: string; since?: string }
export interface Allergy { allergen: string; reaction?: string }
export interface CareTeamMember { name: string; specialty?: string; facility?: string; phone?: string }

export interface MedicalProfile {
  family_member_id: string
  active_diagnoses: Diagnosis[]
  current_medications: Medication[]
  allergies: Allergy[]
  care_team: CareTeamMember[]
  summary_notes: string | null
  last_synthesized_at: string | null
}

export const medicalRecordsApi = {
  list: (params?: { family_member_id?: string; status?: RecordStatus; record_type?: RecordType; specialty?: string }) => {
    const q = new URLSearchParams()
    if (params?.family_member_id) q.set('family_member_id', params.family_member_id)
    if (params?.status) q.set('status', params.status)
    if (params?.record_type) q.set('record_type', params.record_type)
    if (params?.specialty) q.set('specialty', params.specialty)
    const qs = q.toString()
    return api.get<MedicalRecord[]>(`/lifestyle/medical-records${qs ? `?${qs}` : ''}`)
  },

  get: (id: string) => api.get<MedicalRecord>(`/lifestyle/medical-records/${id}`),

  create: (data: {
    family_member_id: string
    record_type: RecordType
    specialty?: string
    provider_name?: string
    facility_name?: string
    record_date?: string
    record_date_end?: string
    title: string
    summary?: string
    details?: Record<string, unknown>
    source_file_name?: string
    extracted_by?: ExtractedBy
  }) => api.post<MedicalRecord>('/lifestyle/medical-records', data),

  update: (id: string, data: Partial<{
    record_type: RecordType
    specialty: string
    provider_name: string
    facility_name: string
    record_date: string
    record_date_end: string
    title: string
    summary: string
    details: Record<string, unknown>
    source_file_name: string
    family_member_id: string
  }>) => api.patch<MedicalRecord>(`/lifestyle/medical-records/${id}`, data),

  approve: (id: string) => api.post<MedicalRecord>(`/lifestyle/medical-records/${id}/approve`, {}),
  reject: (id: string) => api.post<MedicalRecord>(`/lifestyle/medical-records/${id}/reject`, {}),
  delete: (id: string) => api.delete<{ deleted: boolean }>(`/lifestyle/medical-records/${id}`),

  getProfile: (familyMemberId: string) => api.get<MedicalProfile>(`/lifestyle/medical-records/profile/${familyMemberId}`),
  saveProfile: (familyMemberId: string, data: {
    active_diagnoses?: Diagnosis[]
    current_medications?: Medication[]
    allergies?: Allergy[]
    care_team?: CareTeamMember[]
    summary_notes?: string
  }) => api.put<MedicalProfile>(`/lifestyle/medical-records/profile/${familyMemberId}`, data),
}
