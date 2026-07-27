import {
  initialize,
  requestPermission,
  readRecords,
  getSdkStatus,
  SdkAvailabilityStatus,
} from 'react-native-health-connect'
import { healthApi, type HealthSyncEntry } from '../api/health'

// Reads Samsung Health data via Android Health Connect (the only path available —
// Samsung has no cloud API for this) and pushes it to JAG's Biometrics tab.
// Runs on app open only (no background sync) — see CLAUDE.md "Health Connect
// biometrics sync" for the full write-up.

const RECORD_TYPES = ['Steps', 'Distance', 'TotalCaloriesBurned', 'SleepSession', 'ExerciseSession', 'FloorsClimbed'] as const

let initialized = false

async function ensureReady(): Promise<boolean> {
  const status = await getSdkStatus()
  if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) return false
  if (!initialized) {
    await initialize()
    initialized = true
  }
  return true
}

async function ensurePermissions(): Promise<boolean> {
  const granted = await requestPermission(
    RECORD_TYPES.map(recordType => ({ accessType: 'read', recordType })),
  )
  return granted.length > 0
}

function dayBounds(daysAgo: number): { start: Date; end: Date; dateStr: string } {
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo)
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0)
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999)
  const dateStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  return { start, end, dateStr }
}

async function summarizeDay(dateStr: string, start: Date, end: Date): Promise<HealthSyncEntry[]> {
  const timeRangeFilter = { operator: 'between' as const, startTime: start.toISOString(), endTime: end.toISOString() }
  const entries: HealthSyncEntry[] = []

  const steps = await readRecords('Steps', { timeRangeFilter })
  const totalSteps = steps.records.reduce((sum, r) => sum + r.count, 0)
  if (totalSteps > 0) entries.push({ entry_date: dateStr, metric_type: 'STEPS', value: totalSteps, unit: 'steps' })

  const distance = await readRecords('Distance', { timeRangeFilter })
  const totalDistanceM = distance.records.reduce((sum, r) => sum + r.distance.inMeters, 0)
  if (totalDistanceM > 0) entries.push({ entry_date: dateStr, metric_type: 'DISTANCE_KM', value: Math.round((totalDistanceM / 1000) * 100) / 100, unit: 'km' })

  const calories = await readRecords('TotalCaloriesBurned', { timeRangeFilter })
  const totalKcal = calories.records.reduce((sum, r) => sum + r.energy.inKilocalories, 0)
  if (totalKcal > 0) entries.push({ entry_date: dateStr, metric_type: 'CALORIES', value: Math.round(totalKcal), unit: 'kcal' })

  const exercise = await readRecords('ExerciseSession', { timeRangeFilter })
  const activeMinutes = exercise.records.reduce((sum, r) => {
    const mins = (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000
    return sum + mins
  }, 0)
  if (activeMinutes > 0) entries.push({ entry_date: dateStr, metric_type: 'EXERCISE_MINUTES', value: Math.round(activeMinutes), unit: 'min' })

  const floors = await readRecords('FloorsClimbed', { timeRangeFilter })
  const totalFloors = floors.records.reduce((sum, r) => sum + r.floors, 0)
  if (totalFloors > 0) entries.push({ entry_date: dateStr, metric_type: 'FLOORS_CLIMBED', value: Math.round(totalFloors), unit: 'floors' })

  // Sleep sessions are timestamped by when they END, so a night's sleep (e.g. 11pm-7am)
  // needs a wider window than the calendar day it's attributed to — look back 12h from
  // the start of `dateStr` to catch sessions that ended shortly after midnight.
  const sleepWindowStart = new Date(start.getTime() - 12 * 60 * 60 * 1000)
  const sleep = await readRecords('SleepSession', {
    timeRangeFilter: { operator: 'between', startTime: sleepWindowStart.toISOString(), endTime: end.toISOString() },
  })
  const totalSleepHours = sleep.records.reduce((sum, r) => {
    const hours = (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 3_600_000
    return sum + hours
  }, 0)
  if (totalSleepHours > 0) entries.push({ entry_date: dateStr, metric_type: 'SLEEP_HOURS', value: Math.round(totalSleepHours * 10) / 10, unit: 'hrs' })

  return entries
}

// Syncs today + the previous 2 days (upsert — safe to re-run), so a missed app-open
// or an in-progress day's running total still gets backfilled next time it's opened.
export async function syncHealthConnect(): Promise<{ synced: number } | null> {
  try {
    const ready = await ensureReady()
    if (!ready) return null
    const hasPerms = await ensurePermissions()
    if (!hasPerms) return null

    const entries: HealthSyncEntry[] = []
    for (let daysAgo = 0; daysAgo < 3; daysAgo++) {
      const { start, end, dateStr } = dayBounds(daysAgo)
      entries.push(...(await summarizeDay(dateStr, start, end)))
    }
    if (entries.length === 0) return { synced: 0 }
    return await healthApi.sync(entries)
  } catch {
    // Non-blocking — Health Connect may not be installed, permissions may be
    // denied, or the sync may fail transiently. Never blocks app usage.
    return null
  }
}
