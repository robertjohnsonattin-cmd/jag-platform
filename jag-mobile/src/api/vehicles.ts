import { api } from './client'

export interface MobileVehicle {
  id: string
  registration_number: string
  make: string
  model: string
  current_mileage_km: number | null
}

interface FuelLogRow {
  cost_per_litre_ttd: string
  fuel_type: string
}

export const vehiclesApi = {
  list: (): Promise<{ vehicles: MobileVehicle[] }> =>
    api.get('/ims/vehicles?limit=100'),

  // Most recent fill-up first — used to prefill price/litre + fuel type.
  lastFuelLog: (vehicleId: string): Promise<{ fuel_logs: FuelLogRow[] }> =>
    api.get(`/ims/vehicles/${vehicleId}/fuel-logs`),
}
