// GET  /api/v1/club/events            — list events
// POST /api/v1/club/events            — create event
// GET  /api/v1/club/events/:id        — event detail with booking count
// POST /api/v1/club/events/:id/bookings — book event for a member (idempotency)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { entertainmentPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const clubEventsRouter = Router();
clubEventsRouter.use(requireAuth());

const UUIDParam    = z.object({ id: z.string().uuid() });
const VenueEnum    = z.enum(['BAR', 'CLUB', 'BOTH']);
const PaymentEnum  = z.enum(['CASH', 'CARD', 'MEMBER_CREDIT', 'COMPLIMENTARY']);

const CreateEventSchema = z.object({
  title:        z.string().min(1).max(300),
  description:  z.string().max(2000).optional(),
  venue:        VenueEnum,
  starts_at:    z.string().datetime(),
  ends_at:      z.string().datetime().optional(),
  capacity:     z.number().int().min(1).optional(),
  ticket_price: z.number().min(0).default(0),
  member_price: z.number().min(0).default(0),
}).strict();

const BookEventSchema = z.object({
  member_id:       z.string().uuid(),
  guests:          z.number().int().min(0).default(0),
  amount_paid:     z.number().min(0).default(0),
  payment_method:  PaymentEnum.default('CASH'),
  idempotency_key: z.string().uuid(),
}).strict();

// ── GET /club/events ──────────────────────────────────────────────────────────

clubEventsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const venueFilter  = req.query.venue as string | undefined;
    const upcomingOnly = req.query.upcoming !== 'false';

    const client = await entertainmentPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions = ['e.is_active = true'];
        if (upcomingOnly) conditions.push(`e.starts_at >= now()`);
        if (venueFilter)  conditions.push(`e.venue = ${push(venueFilter)}`);
        return c.query(
          `SELECT e.id, e.title, e.venue, e.starts_at, e.ends_at, e.capacity,
                  e.ticket_price, e.member_price,
                  COUNT(b.id) FILTER (WHERE b.status = 'CONFIRMED') AS confirmed_bookings
           FROM   ent_events e
           LEFT JOIN ent_event_bookings b ON b.event_id = e.id
           WHERE  ${conditions.join(' AND ')}
           GROUP  BY e.id
           ORDER  BY e.starts_at`,
          params,
        ).then(r => r.rows);
      });
      logger.info({ entity: 'CLUB', action: 'EVENTS_LIST', user_id: req.rlsCtx.userId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /club/events ─────────────────────────────────────────────────────────

clubEventsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateEventSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { tenantId, userId } = req.rlsCtx;

    const client = await entertainmentPool.connect();
    try {
      const rec = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO ent_events
             (tenant_id, title, description, venue, starts_at, ends_at, capacity, ticket_price, member_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [tenantId, body.title, body.description ?? null, body.venue, body.starts_at,
           body.ends_at ?? null, body.capacity ?? null, body.ticket_price, body.member_price],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'CLUB', action: 'EVENT_CREATED', user_id: userId, record_id: rec.id });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /club/events/:id ──────────────────────────────────────────────────────

clubEventsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }

    const client = await entertainmentPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const event = await c.query(
          `SELECT e.*,
                  COUNT(b.id) FILTER (WHERE b.status = 'CONFIRMED')  AS confirmed_bookings,
                  COUNT(b.id) FILTER (WHERE b.status = 'WAITLISTED') AS waitlisted_bookings
           FROM   ent_events e
           LEFT JOIN ent_event_bookings b ON b.event_id = e.id
           WHERE  e.id = $1
           GROUP  BY e.id`,
          [idP.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!event) return null;

        const bookings = await c.query(
          `SELECT b.id, b.member_id, m.first_name || ' ' || m.last_name AS member_name,
                  b.guests, b.amount_paid, b.payment_method, b.status, b.created_at
           FROM   ent_event_bookings b
           JOIN   ent_members m ON m.id = b.member_id
           WHERE  b.event_id = $1 ORDER BY b.created_at`,
          [idP.data.id],
        ).then(r => r.rows);

        return { ...event, bookings };
      });
      if (!result) { err(res, 404, 'EVENT_NOT_FOUND', 'Event not found.'); return; }
      ok(res, result);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /club/events/:id/bookings ────────────────────────────────────────────

clubEventsRouter.post('/:id/bookings', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = BookEventSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const { tenantId, userId } = req.rlsCtx;

    const client = await entertainmentPool.connect();
    try {
      const { booking, created } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Idempotency check.
        const dup = await c.query<{ id: string }>(
          `SELECT id FROM ent_event_bookings WHERE idempotency_key = $1`, [body.idempotency_key],
        ).then(r => r.rows[0] ?? null);
        if (dup) {
          const existing = await c.query(`SELECT * FROM ent_event_bookings WHERE id = $1`, [dup.id]).then(r => r.rows[0]);
          return { booking: existing, created: false };
        }

        const event = await c.query<{ capacity: number | null; is_active: boolean }>(
          `SELECT capacity, is_active FROM ent_events WHERE id = $1`, [idP.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!event || !event.is_active) throw Object.assign(new Error('EVENT_NOT_FOUND'), { httpStatus: 404 });

        // Check capacity.
        let status = 'CONFIRMED';
        if (event.capacity !== null) {
          const confirmedRow = await c.query<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt FROM ent_event_bookings WHERE event_id = $1 AND status = 'CONFIRMED'`,
            [idP.data.id],
          ).then(r => r.rows[0]);
          if (parseInt(confirmedRow.cnt, 10) >= event.capacity) status = 'WAITLISTED';
        }

        const rec = await c.query(
          `INSERT INTO ent_event_bookings
             (tenant_id, event_id, member_id, guests, amount_paid, payment_method, status, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [tenantId, idP.data.id, body.member_id, body.guests,
           body.amount_paid, body.payment_method, status, body.idempotency_key],
        ).then(r => r.rows[0]);
        return { booking: rec, created: true };
      });
      logger.info({ entity: 'CLUB', action: created ? 'BOOKING_CREATED' : 'BOOKING_DUPLICATE', user_id: userId, record_id: booking.id });
      ok(res, booking, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'EVENT_NOT_FOUND', 'Event not found or inactive.'); return; }
    next(e);
  }
});
