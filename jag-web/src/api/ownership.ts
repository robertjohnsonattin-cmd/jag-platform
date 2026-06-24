import { api } from './client'

export type SubjectKind = 'ENTITY' | 'PROPERTY' | 'ITEM'

export interface OwnershipStake {
  id:                string
  family_member_id:  string
  subject_kind:      SubjectKind
  subject_id:        string
  subject_label:     string
  ownership_percent: string   // pg numeric → string; parseFloat before arithmetic
  notes:             string | null
  created_at:        string
}

export interface SubjectOption { kind: SubjectKind; id: string; label: string; value?: number; group?: string }

export interface OwnershipSubjects {
  entities:   SubjectOption[]
  properties: SubjectOption[]
  items:      SubjectOption[]
}

export interface AllocationRow {
  subject_kind:      SubjectKind
  subject_id:        string
  subject_label:     string
  allocated_percent: number
  owner_count:       number
}

export interface HoldingEntity { subject_id: string; label: string; percent: number; entity_net_worth: number; attributed_value: number }
export interface HoldingAsset  { subject_kind: SubjectKind; subject_id: string; label: string; percent: number; asset_value: number; attributed_value: number }
export interface MemberHoldings {
  member_id:            string
  entities:             HoldingEntity[]
  assets:               HoldingAsset[]
  total_attributed_ttd: number
}

export interface CreateStakeInput {
  family_member_id:  string
  subject_kind:      SubjectKind
  subject_id:        string
  subject_label:     string
  ownership_percent: number
  notes?:            string
}

export const ownershipApi = {
  list:        () => api.get<OwnershipStake[]>('/family/ownership'),
  subjects:    () => api.get<OwnershipSubjects>('/family/ownership/subjects'),
  allocation:  () => api.get<AllocationRow[]>('/family/ownership/allocation'),
  holdings:    (memberId: string) => api.get<MemberHoldings>(`/family/members/${memberId}/holdings`),
  create:      (body: CreateStakeInput) => api.post<OwnershipStake>('/family/ownership', body),
  update:      (id: string, body: Partial<{ ownership_percent: number; subject_label: string; notes: string | null }>) =>
                 api.patch<OwnershipStake>(`/family/ownership/${id}`, body),
  remove:      (id: string) => api.delete<{ deleted: boolean; id: string }>(`/family/ownership/${id}`),
}
