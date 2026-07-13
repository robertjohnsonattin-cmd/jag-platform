// GET    /api/v1/properties/viewings
// PATCH  /api/v1/properties/viewings/:id
// GET    /api/v1/properties/viewings/available-slots
// GET    /api/v1/public/book/:slug
// POST   /api/v1/public/book/:slug

import { randomBytes } from 'crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { getAvailableSlots, createCalendarEvent } from '../../lib/google-calendar';
import { sendTemplate } from '../../lib/whatsapp';
import { BUCKET_PHOTOS, getPresignedGetUrl } from '../../lib/minio';
import { enqueueNotification } from '../../lib/notifications';

export const viewingsRouter = Router();
export const publicBookingRouter = Router();
export const publicScheduleRouter = Router();

// The public booking page has no authenticated user/owner context, but prop_units
// is RLS-protected on owner_id. JAG is a single-owner platform, so the public route
// scopes to the known platform owner rather than bypassing RLS.
const PUBLIC_LISTING_OWNER_ID =
  process.env['NOTIFY_OWNER_USER_ID'] ?? '95ca3f77-60ba-4a0f-af70-2832b247b525';

const IdParam      = z.object({ id: z.string().uuid() });
const SlugParam    = z.object({ slug: z.string().min(1) });
const TokenParam   = z.object({ token: z.string().min(1) });
const ViewingStatusEnum = z.enum(['SCHEDULED','CONFIRMED','COMPLETED','NO_SHOW','CANCELLED','RESCHEDULED']);

const PatchViewingSchema = z.object({
  status: ViewingStatusEnum.optional(),
  notes:  z.string().nullable().optional(),
  scheduled_at: z.string().optional(),
}).strict();

const ScreeningAnswersSchema = z.object({
  employment_status:        z.string().max(50),
  monthly_income_range:     z.string().max(50),
  adults:                    z.number().int().min(1).max(50),
  children:                  z.number().int().min(0).max(50),
  has_pets:                  z.boolean(),
  pet_details:               z.string().max(200).optional(),
  is_smoker:                 z.boolean(),
  move_in_date:              z.string(), // YYYY-MM-DD
  reason_for_moving:         z.string().max(500),
  consents_background_check: z.boolean(),
  evicted_or_broke_lease:    z.boolean(),
  eviction_details:          z.string().max(500).optional(),
  can_provide_references:    z.boolean(),
}).strict();

// Step 1 (public, no auth): prospect submits screening answers only — no slot yet.
// The owner reviews these before any date is offered (see enquiriesRouter POST
// /:id/screening-decision). Only on approval is a schedule_token issued.
const ScreeningSubmitSchema = z.object({
  prospect_name:      z.string().min(1).max(200),
  prospect_phone:     z.string().min(7).max(30),
  prospect_email:     z.string().email().optional(),
  screening_answers:  ScreeningAnswersSchema,
}).strict();

// Step 2 (public, no auth): prospect uses the schedule_token issued after approval to pick a slot.
const ScheduleBookingSchema = z.object({
  slot_start: z.string(), // ISO datetime
}).strict();

viewingsRouter.get('/available-slots', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
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
    const ownerId = req.rlsCtx.userId;
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

// ── Batch: send 24h viewing reminders ────────────────────────────────────────
viewingsRouter.post('/send-reminders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: r } = await client.query<Record<string, unknown>>(
        `SELECT v.id, v.scheduled_at, e.prospect_phone, e.prospect_name,
                u.unit_number, p.name AS property_name, p.address_line1
         FROM prop_viewings v
         JOIN prop_enquiries e ON e.id = v.enquiry_id
         JOIN prop_units u ON u.id = v.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE v.owner_id = $1
           AND v.status IN ('SCHEDULED','CONFIRMED')
           AND v.scheduled_at BETWEEN NOW() + INTERVAL '23 hours' AND NOW() + INTERVAL '25 hours'
           AND v.reminder_sent_at IS NULL`,
        [ownerId],
      );
      return r;
    });

    const sent: string[] = [];
    for (const row of rows) {
      if (!row['prospect_phone']) continue;
      try {
        await sendTemplate({
          to: String(row['prospect_phone']),
          templateName: 'jag_enq_viewing_reminder_24h',
          languageCode: 'en_US',
          components: [{ type: 'body', parameters: [
            { type: 'text', text: String(row['prospect_name'] ?? '') },
            { type: 'text', text: String(row['property_name'] ?? '') },
            { type: 'text', text: String(row['unit_number'] ?? '') },
            { type: 'text', text: new Date(String(row['scheduled_at'])).toLocaleDateString('en-TT') },
            { type: 'text', text: new Date(String(row['scheduled_at'])).toLocaleTimeString('en-TT', { hour: '2-digit', minute: '2-digit' }) },
            { type: 'text', text: String(row['address_line1'] ?? '') },
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

// ── Batch: send 1h viewing reminders ─────────────────────────────────────────
viewingsRouter.post('/send-reminders-1h', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: r } = await client.query<Record<string, unknown>>(
        `SELECT v.id, v.scheduled_at, e.prospect_phone, e.prospect_name,
                u.unit_number, p.name AS property_name, p.address_line1
         FROM prop_viewings v
         JOIN prop_enquiries e ON e.id = v.enquiry_id
         JOIN prop_units u ON u.id = v.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE v.owner_id = $1
           AND v.status IN ('SCHEDULED','CONFIRMED')
           AND v.scheduled_at BETWEEN NOW() + INTERVAL '45 minutes' AND NOW() + INTERVAL '90 minutes'
           AND v.reminder_1h_sent_at IS NULL`,
        [ownerId],
      );
      return r;
    });

    const sent: string[] = [];
    for (const row of rows) {
      if (!row['prospect_phone']) continue;
      try {
        await sendTemplate({
          to: String(row['prospect_phone']),
          templateName: 'jag_enq_viewing_reminder_1h',
          languageCode: 'en_US',
          components: [{ type: 'body', parameters: [
            { type: 'text', text: String(row['prospect_name'] ?? '') },
            { type: 'text', text: String(row['unit_number'] ?? '') },
            { type: 'text', text: new Date(String(row['scheduled_at'])).toLocaleTimeString('en-TT', { hour: '2-digit', minute: '2-digit' }) },
            { type: 'text', text: String(row['address_line1'] ?? '') },
            { type: 'text', text: process.env.JAG_MANAGER_PHONE ?? '' },
          ]}],
        });
        await withOwnerRLS(propertiesPool, ownerId, async client => {
          await client.query(`UPDATE prop_viewings SET reminder_1h_sent_at = NOW() WHERE id = $1`, [row['id']]);
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
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query<Record<string, unknown>>(
        `SELECT v.id AS viewing_id, e.id, e.prospect_phone, e.prospect_name
         FROM prop_viewings v
         JOIN prop_enquiries e ON e.id = v.enquiry_id
         WHERE v.owner_id = $1
           AND v.status = 'COMPLETED'
           AND v.post_viewing_app_link_sent_at IS NULL
           AND e.stage = 'VIEWED'`,
        [ownerId],
      );
      return rows;
    });

    const applyBase = process.env.PUBLIC_APPLY_BASE_URL ?? 'https://jagcorporate.com/apply';
    const sent: string[] = [];
    for (const row of rows) {
      if (!row['prospect_phone']) continue;
      // One-time application token → public /apply/<token> form (30-day validity).
      // Token/stage are persisted regardless of WhatsApp delivery — the link must
      // exist even during a WhatsApp outage (e.g. template pending Meta approval)
      // so the owner can still share it manually.
      const token = randomBytes(24).toString('hex');
      try {
        await withOwnerRLS(propertiesPool, ownerId, async client => {
          await client.query(
            `UPDATE prop_enquiries
             SET stage = 'APPLICATION_SENT', application_token = $2,
                 application_token_expires_at = NOW() + INTERVAL '30 days'
             WHERE id = $1`,
            [row['id'], token],
          );
          await client.query(
            `UPDATE prop_viewings SET post_viewing_app_link_sent_at = NOW() WHERE id = $1`,
            [row['viewing_id']],
          );
        });
        sent.push(String(row['id']));
        sendTemplate({
          to: String(row['prospect_phone']),
          templateName: 'jag_enq_post_viewing',
          languageCode: 'en_US',
          components: [{ type: 'body', parameters: [
            { type: 'text', text: String(row['prospect_name'] ?? '') },
            { type: 'text', text: `${applyBase}/${token}` },
          ] }],
        }).catch(e => logger.warn({ entity: 'PROPERTIES', action: 'WA_POST_VIEWING_LINK_FAILED', error_message: (e as Error).message }));
      } catch { /* skip on DB error */ }
    }
    res.json(ok({ sent: sent.length }));
  } catch (e) { next(e); }
});

viewingsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
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
      const viewing = rows[0] ?? null;
      // Marking a viewing COMPLETED moves the enquiry to VIEWED, which is the
      // precondition send-post-viewing-links checks before issuing an application link.
      if (viewing && body.status === 'COMPLETED') {
        await client.query(
          `UPDATE prop_enquiries SET stage = 'VIEWED' WHERE id = $1 AND stage = 'VIEWING_SCHEDULED'`,
          [viewing.enquiry_id],
        );
      }
      return viewing;
    });
    if (!row) return void res.status(404).json(err('Viewing not found', 'NOT_FOUND'));
    res.json(ok(row));
  } catch (e) { next(e); }
});

// ── Public booking (no Keycloak auth) ────────────────────────────────────────
// Two steps: (1) prospect submits screening answers only, no date is offered;
// (2) after the owner reviews and approves (enquiriesRouter POST
// /:id/screening-decision), a one-time link at /api/v1/public/schedule/:token
// lets the prospect pick an actual slot.

publicBookingRouter.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = SlugParam.parse(req.params);

    const unit = await withOwnerRLS(propertiesPool, PUBLIC_LISTING_OWNER_ID, async client => {
      const { rows } = await client.query(
        `SELECT u.*, p.name AS property_name, p.address_line1, p.city
         FROM prop_units u
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE u.booking_slug = $1 AND u.listing_status = 'LISTED'`,
        [slug],
      );
      return rows[0] ?? null;
    });

    if (!unit) return void res.status(404).json(err('Unit not found or not currently listed', 'NOT_FOUND'));

    // Fetch unit photos (presigned GET, 1-hour TTL — public booking page is ephemeral)
    const photoRows = await withOwnerRLS(propertiesPool, PUBLIC_LISTING_OWNER_ID, async client => {
      const { rows } = await client.query(
        `SELECT object_key, caption, display_order FROM prop_unit_photos
         WHERE unit_id = $1 ORDER BY display_order, created_at`,
        [unit.id],
      );
      return rows as Array<{ object_key: string; caption: string | null; display_order: number }>;
    });
    const photos = await Promise.all(
      photoRows.map(async p => ({
        url: await getPresignedGetUrl(BUCKET_PHOTOS, p.object_key, 3600).catch(() => null),
        caption: p.caption,
        display_order: p.display_order,
      })),
    ).then(arr => arr.filter(p => p.url !== null));

    res.json(ok({ unit, photos }));
  } catch (e) { next(e); }
});

publicBookingRouter.post('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = SlugParam.parse(req.params);
    const body = ScreeningSubmitSchema.parse(req.body);

    const unit = await withOwnerRLS(propertiesPool, PUBLIC_LISTING_OWNER_ID, async client => {
      const { rows } = await client.query(
        `SELECT u.*, p.owner_id
         FROM prop_units u
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE u.booking_slug = $1 AND u.listing_status = 'LISTED'`,
        [slug],
      );
      return rows[0] ?? null;
    });

    if (!unit) return void res.status(404).json(err('Unit not found or not listed', 'NOT_FOUND'));

    const ownerId: string = unit.owner_id;

    const enquiry = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [row] } = await client.query(
        `INSERT INTO prop_enquiries (owner_id, unit_id, property_id, prospect_name, prospect_phone, prospect_email, channel, stage, screening_answers)
         VALUES ($1,$2,$3,$4,$5,$6,'WHATSAPP','SCREENING',$7) RETURNING id`,
        [ownerId, unit.id, unit.property_id, body.prospect_name, body.prospect_phone, body.prospect_email ?? null,
         JSON.stringify(body.screening_answers)],
      );
      return row;
    });

    logger.info({ entity: 'PROPERTIES', action: 'PUBLIC_SCREENING_SUBMITTED', record_id: enquiry.id });

    // Owner in-app notification — a viewing request is awaiting screening review (non-blocking).
    void enqueueNotification({
      tier: 2,
      title: 'Viewing request awaiting screening review',
      body: `${body.prospect_name} (${body.prospect_phone}) requested a viewing of ${unit.unit_number ?? 'a unit'} — review their answers to approve or decline.`,
      payload: { module: 'PROPERTIES', kind: 'ENQUIRY', enquiry_id: enquiry.id },
    });

    res.status(201).json(ok({ enquiry_id: enquiry.id }));
  } catch (e) { next(e); }
});

// ── Public scheduling (no Keycloak auth) — step 2, after owner approval ─────

publicScheduleRouter.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = TokenParam.parse(req.params);
    const lookahead = parseInt(process.env.GOOGLE_CALENDAR_LOOKAHEAD_DAYS ?? '14', 10);
    const from = new Date();
    const to   = new Date(Date.now() + lookahead * 86400_000);

    const enquiry = await withOwnerRLS(propertiesPool, PUBLIC_LISTING_OWNER_ID, async client => {
      const { rows } = await client.query(
        `SELECT e.id, e.stage, e.schedule_token_expires_at, e.prospect_name,
                u.unit_number, p.address_line1, p.city, p.name AS property_name
         FROM prop_enquiries e
         JOIN prop_units u ON u.id = e.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE e.schedule_token = $1`,
        [token],
      );
      return rows[0] ?? null;
    });

    const expired = enquiry?.schedule_token_expires_at && new Date(enquiry.schedule_token_expires_at) < new Date();
    if (!enquiry || enquiry.stage !== 'APPROVED' || expired) {
      return void res.status(404).json(err('This scheduling link is invalid or has expired', 'NOT_FOUND'));
    }

    let slots: unknown[] = [];
    try { slots = await getAvailableSlots(from, to); } catch (e) {
      logger.warn({ entity: 'PUBLIC_SCHEDULE', action: 'SLOTS_UNAVAILABLE', error_message: (e as Error).message });
    }

    res.json(ok({ enquiry, available_slots: slots }));
  } catch (e) { next(e); }
});

publicScheduleRouter.post('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = TokenParam.parse(req.params);
    const body = ScheduleBookingSchema.parse(req.body);

    const enquiry = await withOwnerRLS(propertiesPool, PUBLIC_LISTING_OWNER_ID, async client => {
      const { rows } = await client.query(
        `SELECT e.*, u.unit_number, p.address_line1, p.city
         FROM prop_enquiries e
         JOIN prop_units u ON u.id = e.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE e.schedule_token = $1`,
        [token],
      );
      return rows[0] ?? null;
    });

    const expired = enquiry?.schedule_token_expires_at && new Date(enquiry.schedule_token_expires_at) < new Date();
    if (!enquiry || enquiry.stage !== 'APPROVED' || expired) {
      return void res.status(404).json(err('This scheduling link is invalid or has expired', 'NOT_FOUND'));
    }

    const ownerId: string = enquiry.owner_id;
    const slotStart = new Date(body.slot_start);
    const slotEnd   = new Date(slotStart.getTime() + parseInt(process.env.GOOGLE_CALENDAR_SLOT_DURATION_MIN ?? '30', 10) * 60_000);
    const address = `${enquiry.address_line1 ?? enquiry.unit_number}, ${enquiry.city ?? ''}`;

    let googleEventId: string | null = null;
    try {
      googleEventId = await createCalendarEvent({
        title: `Property Viewing — ${address} — ${enquiry.prospect_name}`,
        description: `Unit: ${enquiry.unit_number}\nAddress: ${address}\nProspect phone: ${enquiry.prospect_phone}\nJAG Properties`,
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        attendeeEmails: [process.env.GOOGLE_CALENDAR_ID ?? '', ...(enquiry.prospect_email ? [enquiry.prospect_email] : [])],
      });
    } catch (e) {
      logger.warn({ entity: 'PUBLIC_SCHEDULE', action: 'CALENDAR_EVENT_FAILED', error_message: (e as Error).message });
    }

    const viewing = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [v] } = await client.query(
        `INSERT INTO prop_viewings (owner_id, enquiry_id, unit_id, scheduled_at, google_event_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [ownerId, enquiry.id, enquiry.unit_id, slotStart, googleEventId],
      );
      await client.query(
        `UPDATE prop_enquiries SET stage = 'VIEWING_SCHEDULED', schedule_token = NULL, schedule_token_expires_at = NULL WHERE id = $1`,
        [enquiry.id],
      );
      return v;
    });

    try {
      await sendTemplate({
        to: enquiry.prospect_phone,
        templateName: 'jag_enq_viewing_confirm',
        components: [
          { type: 'body',
            parameters: [
              { type: 'text', text: enquiry.prospect_name },
              { type: 'text', text: address },
              { type: 'text', text: slotStart.toLocaleDateString('en-TT') },
              { type: 'text', text: slotStart.toLocaleTimeString('en-TT', { hour: '2-digit', minute: '2-digit' }) },
            ],
          },
          // URL button is https://maps.google.com/?q={{1}} — no GPS coords stored,
          // so pass the address as the map query (URL-encoded).
          { type: 'button', sub_type: 'url', index: '0', parameters: [
            { type: 'text', text: encodeURIComponent(String(address)) },
          ]},
        ],
      });
    } catch (e) {
      logger.warn({ entity: 'PUBLIC_SCHEDULE', action: 'WA_CONFIRM_FAILED', error_message: (e as Error).message });
    }

    res.status(201).json(ok({ viewing, slot_start: slotStart, slot_end: slotEnd }));
  } catch (e) { next(e); }
});
