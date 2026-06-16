// GET    /api/v1/properties/viewings
// PATCH  /api/v1/properties/viewings/:id
// GET    /api/v1/properties/viewings/available-slots
// GET    /api/v1/public/book/:slug
// POST   /api/v1/public/book/:slug

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { getAvailableSlots, createCalendarEvent } from '../../lib/google-calendar';
import { sendTemplate } from '../../lib/whatsapp';

export const viewingsRouter = Router();
export const publicBookingRouter = Router();

const IdParam      = z.object({ id: z.string().uuid() });
const SlugParam    = z.object({ slug: z.string().min(1) });
const ViewingStatusEnum = z.enum(['SCHEDULED','CONFIRMED','COMPLETED','NO_SHOW','CANCELLED','RESCHEDULED']);

const PatchViewingSchema = z.object({
  status: ViewingStatusEnum.optional(),
  notes:  z.string().nullable().optional(),
  scheduled_at: z.string().optional(),
}).strict();

const BookingSchema = z.object({
  prospect_name:  z.string().min(1).max(200),
  prospect_phone: z.string().min(7).max(30),
  prospect_email: z.string().email().optional(),
  slot_start:     z.string(), // ISO datetime
}).strict();

viewingsRouter.get('/available-slots', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const fromDate = req.query['from'] ? new Date(req.query['from'] as string) : new Date();
    const toDate   = req.query['to']
      ? new Date(req.query['to'] as string)
      : new Date(Date.now() + parseInt(process.env.GOOGLE_CALENDAR_LOOKAHEAD_DAYS ?? '14', 10) * 86400_000);

    const slots = await getAvailableSlots(fromDate, toDate);
    res.json(ok(slots));
  } catch (e) { next(e); }
});

viewingsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const status = req.query['status'] as string | undefined;
    const unitId = req.query['unit_id'] as string | undefined;

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const conds: string[] = [];
      const vals: unknown[] = [ownerId];
      if (status) { vals.push(status); conds.push(`v.status = $${vals.length}`); }
      if (unitId) { vals.push(unitId); conds.push(`v.unit_id = $${vals.length}`); }
      const where = conds.length ? ' AND ' + conds.join(' AND ') : '';
      const { rows: r } = await client.query(
        `SELECT v.*, e.prospect_name, e.prospect_phone, e.prospect_email,
                u.unit_number, p.name AS property_name, p.address_line1
         FROM prop_viewings v
         JOIN prop_enquiries e ON e.id = v.enquiry_id
         JOIN prop_units u ON u.id = v.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE v.owner_id = $1${where}
         ORDER BY v.scheduled_at DESC LIMIT 200`,
        vals,
      );
      return r;
    });
    res.json(ok(rows));
  } catch (e) { next(e); }
});

// ── Batch: send viewing reminders ─────────────────────────────────────────────
viewingsRouter.post('/send-reminders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const hoursAhead = z.object({ hours_ahead: z.number().int().min(1).max(48).default(2) }).parse(req.body).hours_ahead;

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query<Record<string, unknown>>(
        `SELECT v.id, v.scheduled_at, e.prospect_phone, e.prospect_name
         FROM prop_viewings v
         JOIN prop_enquiries e ON e.id = v.enquiry_id
         WHERE v.owner_id = $1
           AND v.status IN ('SCHEDULED','CONFIRMED')
           AND v.scheduled_at BETWEEN NOW() AND NOW() + ($2 || ' hours')::INTERVAL
           AND v.reminder_sent_at IS NULL`,
        [ownerId, hoursAhead],
      );
      return rows;
    });

    const sent: string[] = [];
    for (const row of rows) {
      if (!row['prospect_phone']) continue;
      try {
        await sendTemplate({
          to: String(row['prospect_phone']),
          templateName: 'viewing_reminder',
          languageCode: 'en',
          components: [{ type: 'body', parameters: [
            { type: 'text', text: String(row['prospect_name'] ?? '') },
            { type: 'text', text: new Date(String(row['scheduled_at'])).toLocaleString('en-TT') },
          ]}],
        });
        await withOwnerRLS(propertiesPool, ownerId, async client => {
          await client.query(`UPDATE prop_viewings SET reminder_sent_at = NOW() WHERE id = $1`, [row['id']]);
        });
        sent.push(String(row['id']));
      } catch { /* skip on WA error */ }
    }
    res.json(ok({ sent: sent.length }));
  } catch (e) { next(e); }
});

// ── Batch: send application link after completed viewing ──────────────────────
viewingsRouter.post('/send-post-viewing-links', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query<Record<string, unknown>>(
        `SELECT e.id, e.prospect_phone, e.prospect_name
         FROM prop_viewings v
         JOIN prop_enquiries e ON e.id = v.enquiry_id
         WHERE v.owner_id = $1
           AND v.status = 'COMPLETED'
           AND v.completed_at >= NOW() - INTERVAL '24 hours'
           AND e.stage = 'VIEWED'`,
        [ownerId],
      );
      return rows;
    });

    const sent: string[] = [];
    for (const row of rows) {
      if (!row['prospect_phone']) continue;
      try {
        await sendTemplate({
          to: String(row['prospect_phone']),
          templateName: 'prop_app_link',
          languageCode: 'en',
          components: [{ type: 'body', parameters: [{ type: 'text', text: String(row['prospect_name'] ?? '') }] }],
        });
        await withOwnerRLS(propertiesPool, ownerId, async client => {
          await client.query(
            `UPDATE prop_enquiries SET stage = 'APPLICATION_SENT' WHERE id = $1`,
            [row['id']],
          );
        });
        sent.push(String(row['id']));
      } catch { /* skip on WA error */ }
    }
    res.json(ok({ sent: sent.length }));
  } catch (e) { next(e); }
});

viewingsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = PatchViewingSchema.parse(req.body);
    if (Object.keys(body).length === 0) return void res.status(400).json(err('No fields to update', 'VALIDATION_ERROR'));

    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      vals.push(v); sets.push(`${k} = $${vals.length}`);
    }
    vals.push(id); vals.push(ownerId);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_viewings SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND owner_id = $${vals.length} RETURNING *`,
        vals,
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Viewing not found', 'NOT_FOUND'));
    res.json(ok(row));
  } catch (e) { next(e); }
});

// ── Public booking (no Keycloak auth) ────────────────────────────────────────

publicBookingRouter.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = SlugParam.parse(req.params);
    const lookahead = parseInt(process.env.GOOGLE_CALENDAR_LOOKAHEAD_DAYS ?? '14', 10);
    const from = new Date();
    const to   = new Date(Date.now() + lookahead * 86400_000);

    const unit = await propertiesPool.connect().then(async client => {
      try {
        const { rows } = await client.query(
          `SELECT u.*, p.name AS property_name, p.address_line1, p.city
           FROM prop_units u
           LEFT JOIN prop_properties p ON p.id = u.property_id
           WHERE u.booking_slug = $1 AND u.listing_status = 'LISTED'`,
          [slug],
        );
        return rows[0] ?? null;
      } finally { client.release(); }
    });

    if (!unit) return void res.status(404).json(err('Unit not found or not currently listed', 'NOT_FOUND'));

    let slots: unknown[] = [];
    try { slots = await getAvailableSlots(from, to); } catch (e) {
      logger.warn({ entity: 'PUBLIC_BOOKING', action: 'SLOTS_UNAVAILABLE', error_message: (e as Error).message });
    }

    res.json(ok({ unit, available_slots: slots }));
  } catch (e) { next(e); }
});

publicBookingRouter.post('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = SlugParam.parse(req.params);
    const body = BookingSchema.parse(req.body);

    const unit = await propertiesPool.connect().then(async client => {
      try {
        const { rows } = await client.query(
          `SELECT u.*, p.name AS property_name, p.address_line1, p.city, p.owner_id
           FROM prop_units u
           LEFT JOIN prop_properties p ON p.id = u.property_id
           WHERE u.booking_slug = $1 AND u.listing_status = 'LISTED'`,
          [slug],
        );
        return rows[0] ?? null;
      } finally { client.release(); }
    });

    if (!unit) return void res.status(404).json(err('Unit not found or not listed', 'NOT_FOUND'));

    const slotStart = new Date(body.slot_start);
    const slotEnd   = new Date(slotStart.getTime() + parseInt(process.env.GOOGLE_CALENDAR_SLOT_DURATION_MIN ?? '30', 10) * 60_000);
    const ownerId: string = unit.owner_id;
    const address = `${unit.address_line1 ?? unit.unit_number}, ${unit.city ?? ''}`;

    let googleEventId: string | null = null;
    try {
      googleEventId = await createCalendarEvent({
        title: `Property Viewing — ${address} — ${body.prospect_name}`,
        description: `Unit: ${unit.unit_number}\nAddress: ${address}\nProspect phone: ${body.prospect_phone}\nJAG Properties`,
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        attendeeEmails: [process.env.GOOGLE_CALENDAR_ID ?? '', ...(body.prospect_email ? [body.prospect_email] : [])],
      });
    } catch (e) {
      logger.warn({ entity: 'PUBLIC_BOOKING', action: 'CALENDAR_EVENT_FAILED', error_message: (e as Error).message });
    }

    const result = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [enquiry] } = await client.query(
        `INSERT INTO prop_enquiries (owner_id, unit_id, property_id, prospect_name, prospect_phone, prospect_email, channel, stage)
         VALUES ($1,$2,$3,$4,$5,$6,'WHATSAPP','VIEWING_SCHEDULED') RETURNING id`,
        [ownerId, unit.id, unit.property_id, body.prospect_name, body.prospect_phone, body.prospect_email ?? null],
      );
      const { rows: [viewing] } = await client.query(
        `INSERT INTO prop_viewings (owner_id, enquiry_id, unit_id, scheduled_at, google_event_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [ownerId, enquiry.id, unit.id, slotStart, googleEventId],
      );
      return { enquiry_id: enquiry.id, viewing };
    });

    try {
      await sendTemplate({
        to: body.prospect_phone,
        templateName: 'prop_viewing_confirmation',
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: body.prospect_name },
            { type: 'text', text: address },
            { type: 'text', text: slotStart.toLocaleDateString('en-TT') },
            { type: 'text', text: slotStart.toLocaleTimeString('en-TT', { hour: '2-digit', minute: '2-digit' }) },
          ],
        }],
      });
    } catch (e) {
      logger.warn({ entity: 'PUBLIC_BOOKING', action: 'WA_CONFIRM_FAILED', error_message: (e as Error).message });
    }

    res.status(201).json(ok({ ...result, slot_start: slotStart, slot_end: slotEnd }));
  } catch (e) { next(e); }
});
