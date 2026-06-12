import { api } from './client'

export type AccessLevel = 'NONE' | 'READ' | 'WRITE'

export type BrianModule =
  | 'CRM' | 'FAMILY' | 'PROPERTIES' | 'JABCO' | 'IMS'
  | 'DOCVAULT' | 'SUCCESSION' | 'BAR' | 'CLUB'
  | 'LIFESTYLE' | 'ENTERTAINMENT' | 'DRAGONBRIDGE' | 'FINANCE' | 'NLCB'

export interface ModulePermission {
  module: BrianModule
  access_level: AccessLevel
  granted_by: string | null
  granted_at: string | null
  notes: string | null
  updated_at: string | null
}

export const brianApi = {
  getPermissions: (): Promise<ModulePermission[]> =>
    api.get('/brian/permissions'),

  setPermission: (module: BrianModule, data: {
    access_level: AccessLevel
    notes?: string
  }): Promise<ModulePermission> =>
    api.patch(`/brian/permissions/${module}`, data),
}
