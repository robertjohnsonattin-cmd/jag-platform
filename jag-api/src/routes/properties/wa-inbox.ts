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
import multer from 'multer';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { sendText, uploadMedia, sendMedia, mimeToWaMediaType } from '../../lib/whatsapp';
import { minioClient, ensureBucket, mediaObjectKey, getObjectStream, getObjectStat, BUCKET_DOCUMENTS } from '../../lib/minio';
import { phoneKey } from '../../lib/phone';

export const waInboxRouter = Router();

// Meta limits: images 5MB, documents 100MB — capping uploads at 16MB here
// covers every payment-slip/receipt photo case without holding a huge buffer
// in memory; a genuinely large document can still go through DocVault instead.
const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

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

    const businessKey = phoneKey(process.env.WHATSAPP_PHONE_NUMBER_ID ?? 'JAG');

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: r } = await client.query<Record<string, unknown>>(
        // A "conversation" is one person, not one phone string: inbound rows
        // carry the customer as from_number, outbound rows carry the BUSINESS
        // number as from_number and the customer as to_number. Group on the
        // customer side of each row, keyed by the last-7 digit key (so
        // '18687871973' and '8687871973' are the same person), and surface the
        // most recent full number string for display. The business number
        // itself is excluded so a thread of outbound messages can never appear
        // as its own contact.
        `WITH thread_summary AS (
           SELECT CASE WHEN direction = 'INBOUND' THEN from_number ELSE to_number END AS phone,
                  created_at AS last_at,
                  (direction = 'INBOUND' AND read_at IS NULL)::int AS unread
           FROM prop_whatsapp_messages
           WHERE owner_id = $1
           UNION ALL
           SELECT contact_phone AS phone, created_at AS last_at, 0 AS unread
           FROM prop_contact_log
           WHERE owner_id = $1
         ),
         keyed AS (
           SELECT right(regexp_replace(phone, '\\D', '', 'g'), 7) AS phone_key,
                  phone, last_at, unread
           FROM thread_summary
           WHERE phone IS NOT NULL
         ),
         ranked AS (
           SELECT phone_key, phone, last_at, unread,
                  row_number() OVER (PARTITION BY phone_key ORDER BY last_at DESC, phone) AS rn,
                  max(last_at)   OVER (PARTITION BY phone_key) AS key_last_at,
                  sum(unread)    OVER (PARTITION BY phone_key) AS key_unread
           FROM keyed
         )
         SELECT phone, key_last_at AS last_at, key_unread AS unread
         FROM ranked
         WHERE rn = 1 AND phone_key IS DISTINCT FROM $2
         ORDER BY key_last_at DESC
         LIMIT 200`,
        [ownerId, businessKey],
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
    const key = phoneKey(phone);
    if (!key) return void res.status(400).json(err('Invalid phone number', 'VALIDATION_ERROR'));

    const data = await withOwnerRLS(propertiesPool, ownerId, async client => {
      // The thread belongs to one person, matched on the last-7 digit key so a
      // message logged under a different formatting of the same number still
      // lands in the same conversation. Every message from or to the customer
      // carries the customer's number on one side or the other.
      const { rows: messages } = await client.query<Record<string, unknown>>(
        `SELECT id, direction, message_type, body, template_name, delivery_status,
                created_at, sent_at, read_at, (media_url IS NOT NULL) AS has_media,
                'WA_MESSAGE' AS entry_type
         FROM prop_whatsapp_messages
         WHERE owner_id = $1
           AND right(regexp_replace(coalesce(from_number,''), '\\D', '', 'g'), 7) = $2
           AND right(regexp_replace(coalesce(to_number,''),   '\\D', '', 'g'), 7) = $2
         ORDER BY created_at DESC LIMIT 200`,
        [ownerId, key],
      );

      const { rows: log } = await client.query<Record<string, unknown>>(
        `SELECT id, log_type, body, duration_mins, enquiry_id, ticket_id,
                created_at, created_by,
                'CONTACT_LOG' AS entry_type
         FROM prop_contact_log
         WHERE owner_id = $1 AND right(regexp_replace(contact_phone, '\\D', '', 'g'), 7) = $2
         ORDER BY created_at DESC LIMIT 200`,
        [ownerId, key],
      );

      const { rows: enquiries } = await client.query<Record<string, unknown>>(
        `SELECT e.id, e.stage, e.prospect_name, e.channel, e.created_at,
                u.unit_number, p.name AS property_name
         FROM prop_enquiries e
         LEFT JOIN prop_units u ON u.id = e.unit_id
         LEFT JOIN prop_properties p ON p.id = e.property_id
         WHERE e.owner_id = $1 AND right(regexp_replace(e.prospect_phone, '\\D', '', 'g'), 7) = $2
         ORDER BY e.created_at DESC LIMIT 10`,
        [ownerId, key],
      );

      // Mark unread inbound messages as read
      await client.query(
        `UPDATE prop_whatsapp_messages SET read_at = NOW()
         WHERE owner_id = $1 AND direction = 'INBOUND' AND read_at IS NULL
           AND right(regexp_replace(coalesce(from_number,''), '\\D', '', 'g'), 7) = $2`,
        [ownerId, key],
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

// ── POST /wa-inbox/:phone/send-media — attach and send a file over WhatsApp ──
// Three-step Meta flow: upload the file to get a media_id, send a message
// referencing that id, then store the same bytes in MinIO so the outbound
// attachment renders in the thread exactly like an inbound one (same
// media_url column, same GET /wa-inbox/media/:id streaming route).
waInboxRouter.post('/:phone/send-media', mediaUpload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { phone } = PhoneParam.parse(req.params);
    const file = req.file;
    if (!file) { err(res, 400, 'NO_FILE', 'No file attached.'); return; }
    const caption = typeof req.body?.caption === 'string' && req.body.caption.trim() ? req.body.caption.trim() : undefined;

    const mediaId = await uploadMedia(file.buffer, file.mimetype);
    if (!mediaId) { err(res, 502, 'WHATSAPP_UPLOAD_FAILED', 'Could not upload file to WhatsApp.'); return; }

    const mediaType = mimeToWaMediaType(file.mimetype);
    await sendMedia({ to: phone, mediaId, mediaType, caption, filename: file.originalname });

    await ensureBucket(BUCKET_DOCUMENTS);
    const key = mediaObjectKey(ownerId, 'wa-outbound', phone, file.originalname);
    await minioClient.putObject(BUCKET_DOCUMENTS, key, file.buffer, file.buffer.length, { 'Content-Type': file.mimetype });

    await withOwnerRLS(propertiesPool, ownerId, async client => {
      await client.query(
        `INSERT INTO prop_whatsapp_messages
           (owner_id, direction, to_number, from_number, message_type, body, media_url, delivery_status, sent_at)
         VALUES ($1,'OUTBOUND',$2,$3,$4,$5,$6,'SENT',NOW())`,
        [ownerId, phone, process.env.WHATSAPP_PHONE_NUMBER_ID ?? 'JAG', mediaType.toUpperCase(), caption ?? null, key],
      );
    });

    logger.info({ entity: 'PROPERTIES', action: 'WA_INBOX_SEND_MEDIA', to: phone, media_type: mediaType, user_id: ownerId });
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
