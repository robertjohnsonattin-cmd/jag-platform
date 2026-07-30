// GET  /api/v1/properties/wa-inbox                   — list conversations (threads)
// GET  /api/v1/properties/wa-inbox/:phone             — full thread (messages + contact log)
// POST /api/v1/properties/wa-inbox/:phone/reply       — send free-text WA reply
// POST /api/v1/properties/wa-inbox/:phone/log         — log call / note
//
// The inbox is a unified view of:
//   prop_whatsapp_messages (WA API messages, INBOUND + OUTBOUND)
//   prop_contact_log (manual calls, notes, emails, in-person visits)
// keyed on contact phone number

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { sendText } from '../../lib/whatsapp';
import { getObjectStream, getObjectStat, BUCKET_DOCUMENTS } from '../../lib/minio';

export const waInboxRouter = Router();

const PhoneParam = z.object({ phone: z.string().min(7).max(30) });
const MediaParam = z.object({ id: z.string().uuid() });

const ReplySchema = z.object({
  body: z.string().min(1).max(4096),
}).strict();

const LogSchema = z.object({
  log_type:     z.enum(['CALL_INBOUND','CALL_OUTBOUND','WHATSAPP_CALL','IN_PERSON','NOTE','EMAIL']),
  body:         z.string().min(1),
  duration_mins: z.number().int().min(0).optional(),
  enquiry_id:   z.string().uuid().nullable().optional(),
  ticket_id:    z.string().uuid().nullable().optional(),
}).strict();

// ── GET /wa-inbox — recent conversations grouped by phone ────────────────────
waInboxRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: r } = await client.query<Record<string, unknown>>(
        `WITH thread_summary AS (
           SELECT from_number AS phone, MAX(created_at) AS last_at,
                  COUNT(*) FILTER (WHERE direction = 'INBOUND' AND read_at IS NULL) AS unread
           FROM prop_whatsapp_messages
           WHERE owner_id = $1
           GROUP BY from_number
           UNION ALL
           SELECT contact_phone AS phone, MAX(created_at) AS last_at, 0 AS unread
           FROM prop_contact_log
           WHERE owner_id = $1
           GROUP BY contact_phone
         )
         SELECT phone, MAX(last_at) AS last_at, SUM(unread) AS unread
         FROM thread_summary
         WHERE phone IS NOT NULL
         GROUP BY phone
         ORDER BY last_at DESC
         LIMIT 200`,
        [ownerId],
      );
      return r;
    });
    res.json(ok(rows));
  } catch (e) { next(e); }
});

// ── GET /wa-inbox/media/:id — stream an inbound attachment from MinIO ────────
// Two path segments, so this does not collide with the single-segment
// `/:phone` route below regardless of registration order — kept above it
// anyway to match the flat-route-above-:id convention used everywhere else
// in Properties (see docs/rules/properties.md).
waInboxRouter.get('/media/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = MediaParam.parse(req.params);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query<{ media_url: string | null }>(
        `SELECT media_url FROM prop_whatsapp_messages WHERE id = $1 AND owner_id = $2`,
        [id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!row?.media_url) { err(res, 404, 'NOT_FOUND', 'No attachment on this message.'); return; }

    const [stream, stat] = await Promise.all([
      getObjectStream(BUCKET_DOCUMENTS, row.media_url),
      getObjectStat(BUCKET_DOCUMENTS, row.media_url),
    ]);
    res.set({ 'Content-Type': stat.contentType, 'Cache-Control': 'private, no-cache' });
    stream.pipe(res);
  } catch (e) { next(e); }
});

// ── GET /wa-inbox/:phone — full timeline for a contact ───────────────────────
waInboxRouter.get('/:phone', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { phone } = PhoneParam.parse(req.params);

    const data = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: messages } = await client.query<Record<string, unknown>>(
        `SELECT id, direction, message_type, body, template_name, delivery_status,
                created_at, read_at, (media_url IS NOT NULL) AS has_media,
                'WA_MESSAGE' AS entry_type
         FROM prop_whatsapp_messages
         WHERE owner_id = $1 AND (from_number = $2 OR to_number = $2)
         ORDER BY created_at DESC LIMIT 200`,
        [ownerId, phone],
      );

      const { rows: log } = await client.query<Record<string, unknown>>(
        `SELECT id, log_type, body, duration_mins, enquiry_id, ticket_id,
                created_at, created_by,
                'CONTACT_LOG' AS entry_type
         FROM prop_contact_log
         WHERE owner_id = $1 AND contact_phone = $2
         ORDER BY created_at DESC LIMIT 200`,
        [ownerId, phone],
      );

      const { rows: enquiries } = await client.query<Record<string, unknown>>(
        `SELECT e.id, e.stage, e.prospect_name, e.channel, e.created_at,
                u.unit_number, p.name AS property_name
         FROM prop_enquiries e
         LEFT JOIN prop_units u ON u.id = e.unit_id
         LEFT JOIN prop_properties p ON p.id = e.property_id
         WHERE e.owner_id = $1 AND e.prospect_phone = $2
         ORDER BY e.created_at DESC LIMIT 10`,
        [ownerId, phone],
      );

      // Mark unread inbound messages as read
      await client.query(
        `UPDATE prop_whatsapp_messages SET read_at = NOW()
         WHERE owner_id = $1 AND from_number = $2 AND direction = 'INBOUND' AND read_at IS NULL`,
        [ownerId, phone],
      );

      return { phone, messages, log, enquiries };
    });

    res.json(ok(data));
  } catch (e) { next(e); }
});

// ── POST /wa-inbox/:phone/reply — send a free-text WA reply ─────────────────
waInboxRouter.post('/:phone/reply', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { phone } = PhoneParam.parse(req.params);
    const { body: msgBody } = ReplySchema.parse(req.body);

    await sendText({ to: phone, body: msgBody });

    await withOwnerRLS(propertiesPool, ownerId, async client => {
      await client.query(
        `INSERT INTO prop_whatsapp_messages
           (owner_id, direction, to_number, from_number, message_type, body, delivery_status, sent_at)
         VALUES ($1,'OUTBOUND',$2,$3,'TEXT',$4,'SENT',NOW())`,
        [ownerId, phone, process.env.WHATSAPP_PHONE_NUMBER_ID ?? 'JAG', msgBody],
      );
    });

    logger.info({ entity: 'PROPERTIES', action: 'WA_INBOX_REPLY', to: phone, user_id: ownerId });
    res.json(ok({ sent: true }));
  } catch (e) { next(e); }
});

// ── POST /wa-inbox/:phone/log — log a call or note ──────────────────────────
waInboxRouter.post('/:phone/log', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { phone } = PhoneParam.parse(req.params);
    const body = LogSchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `INSERT INTO prop_contact_log
           (owner_id, contact_phone, log_type, body, duration_mins, enquiry_id, ticket_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [ownerId, phone, body.log_type, body.body, body.duration_mins ?? null,
         body.enquiry_id ?? null, body.ticket_id ?? null, ownerId],
      );
      return rows[0];
    });

    logger.info({ entity: 'PROPERTIES', action: 'CONTACT_LOG_CREATED', record_id: row.id, log_type: body.log_type, user_id: ownerId });
    res.status(201).json(ok(row));
  } catch (e) { next(e); }
});
