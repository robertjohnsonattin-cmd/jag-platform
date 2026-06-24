import { api } from './client'

export type Relationship = 'SELF' | 'WIFE' | 'DAUGHTER' | 'FATHER' | 'BROTHER' | 'OTHER'
export type PreferredLanguage = 'en' | 'zh' | 'es'

export interface FamilyMember {
  id:                     string
  relationship:           Relationship
  first_name:             string
  last_name:              string
  date_of_birth:          string | null
  email:                  string | null
  phone:                  string | null
  preferred_language:     PreferredLanguage
  is_emergency_designate: boolean
  keycloak_user_id:       string | null
  notes:                  string | null
  created_at:             string
}

export interface FamilyMemberInput {
  relationship:            Relationship
  first_name:              string
  last_name:               string
  date_of_birth?:          string
  email?:                  string
  phone?:                  string
  preferred_language:      PreferredLanguage
  is_emergency_designate:  boolean
  notes?:                  string
}

export const familyApi = {
  list: () => api.get<FamilyMember[]>('/family/members'),
  create: (body: FamilyMemberInput) => api.post<FamilyMember>('/family/members', body),
  update: (id: string, body: Partial<FamilyMemberInput>) =>
    api.patch<FamilyMember>(`/family/members/${id}`, body),
}
