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

// Robert has both Samsung Health and Google Fit installed. If more than one app is
// writing its own sensor-derived records into Health Connect for the same time
// window, summing every record blindly double-counts (each app reports its own
// full tally of the same steps/calories, not a shared partial contribution).
// Always prefer Samsung Health's own records; only fall back to another single
// source if Samsung Health hasn't written anything for that window.
const PREFERRED_PACKAGE = 'com.sec.android.app.shealth'

function pickSingleSource<T extends { metadata?: { dataOrigin?: string } }>(records: T[]): T[] {
  if (records.length === 0) return records
  const preferred = records.filter(r => r.metadata?.dataOrigin === PREFERRED_PACKAGE)
  if (preferred.length > 0) return preferred

  // No Samsung Health records — fall back to whichever single other origin
  // contributed the most records, rather than summing every origin together.
  const counts = new Map<string, number>()
  for (const r of records) {
    const origin = r.metadata?.dataOrigin ?? 'unknown'
    counts.set(origin, (counts.get(origin) ?? 0) + 1)
  }
  const topOrigin = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  return records.filter(r => (r.metadata?.dataOrigin ?? 'unknown') === topOrigin)
}

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

  const steps = pickSingleSource((await readRecords('Steps', { timeRangeFilter })).records)
  const totalSteps = steps.reduce((sum, r) => sum + r.count, 0)
  if (totalSteps > 0) entries.push({ entry_date: dateStr, metric_type: 'STEPS', value: totalSteps, unit: 'steps' })

  const distance = pickSingleSource((await readRecords('Distance', { timeRangeFilter })).records)
  const totalDistanceM = distance.reduce((sum, r) => sum + r.distance.inMeters, 0)
  if (totalDistanceM > 0) entries.push({ entry_date: dateStr, metric_type: 'DISTANCE_KM', value: Math.round((totalDistanceM / 1000) * 100) / 100, unit: 'km' })

  const calories = pickSingleSource((await readRecords('TotalCaloriesBurned', { timeRangeFilter })).records)
  const totalKcal = calories.reduce((sum, r) => sum + r.energy.inKilocalories, 0)
  if (totalKcal > 0) entries.push({ entry_date: dateStr, metric_type: 'CALORIES', value: Math.round(totalKcal), unit: 'kcal' })

  const exercise = pickSingleSource((await readRecords('ExerciseSession', { timeRangeFilter })).records)
  const activeMinutes = exercise.reduce((sum, r) => {
    const mins = (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000
    return sum + mins
  }, 0)
  if (activeMinutes > 0) entries.push({ entry_date: dateStr, metric_type: 'EXERCISE_MINUTES', value: Math.round(activeMinutes), unit: 'min' })

  const floors = pickSingleSource((await readRecords('FloorsClimbed', { timeRangeFilter })).records)
  const totalFloors = floors.reduce((sum, r) => sum + r.floors, 0)
  if (totalFloors > 0) entries.push({ entry_date: dateStr, metric_type: 'FLOORS_CLIMBED', value: Math.round(totalFloors), unit: 'floors' })

  // Sleep sessions are timestamped by when they END, so a night's sleep (e.g. 11pm-7am)
  // needs a wider window than the calendar day it's attributed to — look back 12h from
  // the start of `dateStr` to catch sessions that ended shortly after midnight.
  const sleepWindowStart = new Date(start.getTime() - 12 * 60 * 60 * 1000)
  const sleep = pickSingleSource((await readRecords('SleepSession', {
    timeRangeFilter: { operator: 'between', startTime: sleepWindowStart.toISOString(), endTime: end.toISOString() },
  })).records)
  const totalSleepHours = sleep.reduce((sum, r) => {
    const hours = (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 3_600_000
    return sum + hours
  }, 0)
  if (totalSleepHours > 0) entries.push({ entry_date: dateStr, metric_type: 'SLEEP_HOURS', value: Math.round(totalSleepHours * 10) / 10, unit: 'hrs' })

  return entries
}

// Syncs today + the previous 6 days (upsert — safe to re-run), so a week of not
// opening the app still self-heals, and an in-progress day's running total gets
// refreshed on each open. Keep BACKFILL_DAYS * (number of metric types) under the
// server's per-request entry cap in routes/lifestyle/index.ts (HealthSyncSchema).
const BACKFILL_DAYS = 7

export async function syncHealthConnect(): Promise<{ synced: number } | null> {
  try {
    const ready = await ensureReady()
    if (!ready) return null
    const hasPerms = await ensurePermissions()
    if (!hasPerms) return null

    const entries: HealthSyncEntry[] = []
    for (let daysAgo = 0; daysAgo < BACKFILL_DAYS; daysAgo++) {
      const { start, end, dateStr } = dayBounds(daysAgo)
      entries.push(...(await summarizeDay(dateStr, start, end)))
    }
    if (entries.length === 0) return { synced: 0 }
    return await healthApi.sync(entries)
  } catch {
    // Non-blocking — Health Connect may not be installed, permissions may be
    // denied, or the sync may fail transiently. Never blocks app usage.
    // Deliberately not logged: the payload is personal health data and logcat
    // is readable by anyone with adb access to the device.
    return null
  }
}
