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
    workStart:      process.env.GOOGLE_CALENDAR_WORK_START ?? '09:00',
    workEnd:        process.env.GOOGLE_CALENDAR_WORK_END ?? '17:00',
    timezone:       process.env.GOOGLE_CALENDAR_TIMEZONE ?? 'America/Port_of_Spain',
  };
}

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

function buildAvailableSlots(from: Date, to: Date, busy: TimeSlot[], env: ReturnType<typeof getEnv>): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const [startH, startM] = env.workStart.split(':').map(Number);
  const [endH, endM] = env.workEnd.split(':').map(Number);
  const slotMs = env.slotMinutes * 60_000;
  const current = new Date(from);
  current.setHours(0, 0, 0, 0);

  while (current <= to) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0) { // skip Sunday
      const dayStart = new Date(current);
      dayStart.setHours(startH, startM, 0, 0);
      const dayEnd = new Date(current);
      dayEnd.setHours(endH, endM, 0, 0);

      let slotStart = new Date(dayStart);
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
    current.setDate(current.getDate() + 1);
  }
  return slots;
}

export interface CalendarEventInput {
  title: string;
  description: string;
  start: string; // ISO
  end: string;   // ISO
  attendeeEmails: string[];
}

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
      attendees: event.attendeeEmails.map(email => ({ email })),
      sendUpdates: 'all',
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
