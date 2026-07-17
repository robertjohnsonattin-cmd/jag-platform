import { logger } from './logger';

interface TimeSlot {
  start: string; // ISO
  end: string;   // ISO
}

function getEnv() {
  return {
    calendarId:     process.env.GOOGLE_CALENDAR_ID ?? '',
    saEmail:        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '',
    saKeyB64:       process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? '',
    lookaheadDays:  parseInt(process.env.GOOGLE_CALENDAR_LOOKAHEAD_DAYS ?? '14', 10),
    slotMinutes:    parseInt(process.env.GOOGLE_CALENDAR_SLOT_DURATION_MIN ?? '30', 10),
    timezone:       process.env.GOOGLE_CALENDAR_TIMEZONE ?? 'America/Port_of_Spain',
  };
}

// Daily viewing windows (Trinidad local time) — three fixed slots per day instead
// of one continuous work-hours range.
const VIEWING_WINDOWS: Array<{ start: string; end: string }> = [
  { start: '07:30', end: '08:30' },
  { start: '12:00', end: '13:00' },
  { start: '16:00', end: '18:00' },
];

async function getAccessToken(): Promise<string> {
  const env = getEnv();
  if (!env.saEmail) throw new Error('Google service account not configured');

  // Prefer reading the key file directly (avoids base64 env var encoding issues).
  // Falls back to base64-encoded env var if file not present.
  let keyJson: Record<string, string>;
  const keyFilePath = '/opt/jag/jag-api/google-calendar-key.json';
  try {
    const { readFileSync } = await import('fs');
    keyJson = JSON.parse(readFileSync(keyFilePath, 'utf-8'));
  } catch {
    if (!env.saKeyB64) throw new Error('Google service account not configured');
    keyJson = JSON.parse(Buffer.from(env.saKeyB64, 'base64').toString('utf-8'));
  }

  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({
    credentials: keyJson,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  const client = await auth.getClient();
  const token = await (client as { getAccessToken: () => Promise<{ token: string }> }).getAccessToken();
  return token.token;
}

export async function getAvailableSlots(from: Date, to: Date): Promise<TimeSlot[]> {
  const env = getEnv();
  try {
    const token = await getAccessToken();
    const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        timeZone: env.timezone,
        items: [{ id: env.calendarId }],
      }),
    });
    if (!res.ok) throw new Error(`FreeBusy API error ${res.status}`);
    const data = (await res.json()) as { calendars: Record<string, { busy: TimeSlot[] }> };
    const busy: TimeSlot[] = data.calendars[env.calendarId]?.busy ?? [];
    return buildAvailableSlots(from, to, busy, env);
  } catch (e) {
    logger.error({ entity: 'GOOGLE_CALENDAR', action: 'GET_SLOTS_ERROR', error_message: (e as Error).message });
    throw e;
  }
}

// Returns the calendar date (Y/M/D) that `date` falls on inside `timeZone`.
function ymdInTz(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return { y: Number(map.year), m: Number(map.month), d: Number(map.day) };
}

// Finds the UTC instant whose wall-clock reading in `timeZone` is y/m/d hh:mm.
// The VM's system clock runs in UTC, so building "7:30am Trinidad" via plain
// Date.setHours() silently produces 7:30am UTC (3:30am Trinidad) instead —
// this converges on the correct instant regardless of the server's local TZ.
function zonedWallTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const targetMs = Date.UTC(y, m - 1, d, hh, mm, 0);
  let guessMs = targetMs;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(guessMs));
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    const wallAsUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
    const offsetMs = wallAsUtc - guessMs;
    guessMs = targetMs - offsetMs;
  }
  return new Date(guessMs);
}

function buildAvailableSlots(from: Date, to: Date, busy: TimeSlot[], env: ReturnType<typeof getEnv>): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const slotMs = env.slotMinutes * 60_000;

  const fromYmd = ymdInTz(from, env.timezone);
  const toYmd = ymdInTz(to, env.timezone);
  let cursor = Date.UTC(fromYmd.y, fromYmd.m - 1, fromYmd.d);
  const cursorEnd = Date.UTC(toYmd.y, toYmd.m - 1, toYmd.d);

  while (cursor <= cursorEnd) {
    const y = new Date(cursor).getUTCFullYear();
    const m = new Date(cursor).getUTCMonth() + 1;
    const d = new Date(cursor).getUTCDate();
    const dayOfWeek = new Date(cursor).getUTCDay();

    if (dayOfWeek !== 0) { // skip Sunday
      for (const window of VIEWING_WINDOWS) {
        const [startH, startM] = window.start.split(':').map(Number);
        const [endH, endM] = window.end.split(':').map(Number);
        const dayStart = zonedWallTimeToUtc(y, m, d, startH, startM, env.timezone);
        const dayEnd = zonedWallTimeToUtc(y, m, d, endH, endM, env.timezone);

        let slotStart = dayStart;
        while (slotStart.getTime() + slotMs <= dayEnd.getTime()) {
          const slotEnd = new Date(slotStart.getTime() + slotMs);
          const overlaps = busy.some(b => {
            const bs = new Date(b.start).getTime();
            const be = new Date(b.end).getTime();
            return slotStart.getTime() < be && slotEnd.getTime() > bs;
          });
          if (!overlaps && slotStart > new Date()) {
            slots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString() });
          }
          slotStart = new Date(slotStart.getTime() + slotMs);
        }
      }
    }
    cursor += 86_400_000;
  }
  return slots;
}

export interface CalendarEventInput {
  title: string;
  description: string;
  start: string; // ISO
  end: string;   // ISO
}

// Used exclusively for property viewing bookings. Multiple prospects can be shown
// an apartment together, so a booked viewing must NOT remove that slot from
// availability for the next prospect — created as "transparent" (free) so
// Google's freeBusy check ignores it. Robert's own manually-added calendar
// events stay opaque/busy by default and still block as normal.
// NOTE: does NOT invite attendees — the calendar's service account has no
// Domain-Wide Delegation, so Google rejects any event with an `attendees` list
// (403 forbiddenForServiceAccounts) and the event is never created at all.
// Prospects are notified separately via WhatsApp (see publicScheduleRouter).
export async function createCalendarEvent(event: CalendarEventInput): Promise<string> {
  const env = getEnv();
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.calendarId)}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      summary: event.title,
      description: event.description,
      start: { dateTime: event.start, timeZone: env.timezone },
      end: { dateTime: event.end, timeZone: env.timezone },
      transparency: 'transparent',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Calendar Events API error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function createAllDayCalendarEvent(params: {
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
}): Promise<string> {
  const env = getEnv();
  const token = await getAccessToken();
  // All-day events use 'date' not 'dateTime'; end must be the following day
  const end = new Date(params.date + 'T00:00:00Z');
  end.setUTCDate(end.getUTCDate() + 1);
  const endDate = end.toISOString().slice(0, 10);
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.calendarId)}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      summary: params.title,
      description: params.description,
      start: { date: params.date },
      end:   { date: endDate },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Calendar Events API error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const env = getEnv();
  const token = await getAccessToken();
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.calendarId)}/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Moves an existing viewing event to a new start/end (reschedule). Same no-attendees
// constraint as createCalendarEvent.
export async function updateCalendarEventTime(eventId: string, start: string, end: string): Promise<void> {
  const env = getEnv();
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.calendarId)}/events/${eventId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      start: { dateTime: start, timeZone: env.timezone },
      end: { dateTime: end, timeZone: env.timezone },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Calendar Events API error ${res.status}: ${body}`);
  }
}
