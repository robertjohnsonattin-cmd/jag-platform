import { api } from './client'

export type HealthMetricType = 'STEPS' | 'DISTANCE_KM' | 'EXERCISE_MINUTES' | 'CALORIES' | 'SLEEP_HOURS' | 'FLOORS_CLIMBED'

export interface HealthSyncEntry {
  entry_date: string
  metric_type: HealthMetricType
  value: number
  unit: string
}

export const healthApi = {
  sync: (entries: HealthSyncEntry[]): Promise<{ synced: number }> =>
    api.post('/lifestyle/tracker/health-connect-sync', { entries }),
}
