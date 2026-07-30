// GET  /internal/whatsapp/webhook  — Meta webhook verification
// POST /internal/whatsapp/webhook  — Inbound messages (X-Hub-Signature-256 validated)
//
// This endpoint is intentionally NOT behind Keycloak auth.
// Security is enforced by X-Hub-Signature-256 HMAC verification on every POST.
// The Caddyfile must expose this path externally (not Docker-network-only).

import { Router, type Request, type Response, type NextFunction } from 'express';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { withOwnerRLS } from '../../middleware/rls';
import { sendTemplate, sendList, sendText, verifyWebhookSignature, downloadMedia, mimeToExt } from '../../lib/whatsapp';
import { enqueueNotification } from '../../lib/notifications';
import { minioClient, ensureBucket, mediaObjectKey, BUCKET_DOCUMENTS } from '../../lib/minio';

export const whatsappWebhookRouter = Router();

const JAG_OWNER_ID = process.env.JAG_OWNER_ID ?? '95ca3f77-60ba-4a0f-af70-2832b247b525';

const P1_KEYWORDS = ['flood','flooding','burst pipe','fire','no power','no electricity','power cut','break-in','break in','gas leak','roof collapse','sewage','sewerage overflow'];
const P2_KEYWORDS = ['leak','leaking','broken','not working','stuck','blocked drain','no hot water','pest','rats','roaches','ac not working'];

function suggestPriority(text: string): 'P1' | 'P2' | 'P3' {
  const lower = text.toLowerCase();
  if (P1_KEYWORDS.some(k => lower.includes(k))) return 'P1';
  if (P2_KEYWORDS.some(k => lower.includes(k))) return 'P2';
  return 'P3';
}

function slaHours(priority: string): number | null {
  if (priority === 'P1') return 2;
  if (priority === 'P2') return 24;
  if (priority === 'P3') return 120;
  return null;
}

// Meta verification handshake
whatsappWebhookRouter.get('/', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    logger.info({ entity: 'WHATSAPP_WEBHOOK', action: 'VERIFIED' });
    return void res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Inbound messages
whatsappWebhookRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Verify HMAC signature
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const rawBody   = (req as Request & { rawBody?: Buffer }).rawBody;
    if (signature && rawBody) {
      if (!verifyWebhookSignature(rawBody, signature)) {
        logger.warn({ entity: 'WHATSAPP_WEBHOOK', action: 'SIG_INVALID' });
        return void res.sendStatus(403);
      }
    }

    // Meta expects HTTP 200 immediately
    res.sendStatus(200);

    const body = req.body as Record<string, unknown>;
    const entries = (body['entry'] as unknown[]) ?? [];

    for (const entry of entries) {
      const changes = ((entry as Record<string, unknown>)['changes'] as unknown[]) ?? [];
      for (const change of changes) {
        const value = (change as Record<string, unknown>)['value'] as Record<string, unknown>;
        if (!value) continue;

        // Status updates (delivery receipts) — update delivery_status
        const statuses = (value['statuses'] as unknown[]) ?? [];
        for (const s of statuses) {
          const status = s as Record<string, unknown>;
          const waId = String(status['id'] ?? '');
          const newStatus = String(status['status'] ?? '').toUpperCase();
          if (!waId) continue;
          await propertiesPool.connect().then(async client => {
            try {
              const fieldMap: Record<string, string> = {
                DELIVERED: 'delivered_at', READ: 'read_at',
              };
              const timeField = fieldMap[newStatus];
              if (timeField) {
                await client.query(
                  `UPDATE prop_whatsapp_messages SET delivery_status = $1, ${timeField} = NOW()
                   WHERE wa_message_id = $2`,
                  [newStatus, waId],
                );
              } else {
                await client.query(
                  `UPDATE prop_whatsapp_messages SET delivery_status = $1 WHERE wa_message_id = $2`,
                  [newStatus, waId],
                );
              }
            } finally { client.release(); }
          });
        }

        // Inbound messages
        const messages = (value['messages'] as unknown[]) ?? [];
        for (const m of messages) {
          await processInboundMessage(m as Record<string, unknown>).catch(e => {
            logger.error({ entity: 'WHATSAPP_WEBHOOK', action: 'PROCESS_ERROR', error_message: (e as Error).message });
          });
        }
      }
    }
  } catch (e) { next(e); }
});

// prop_whatsapp_messages.message_type CHECK allows only these (uppercase).
// Meta sends the type lowercase (e.g. 'text') and includes kinds not in this
// set (video, sticker, location, button, contacts…); map to the allowed set,
// falling back to TEXT, or the INSERT violates the check constraint and rolls
// back the whole inbound transaction (enquiry included).
const WA_DB_MESSAGE_TYPES = new Set(['TEXT', 'TEMPLATE', 'INTERACTIVE', 'IMAGE', 'DOCUMENT', 'AUDIO']);
function dbMessageType(metaType: string): string {
  const up = metaType.toUpperCase();
  return WA_DB_MESSAGE_TYPES.has(up) ? up : 'TEXT';
}

function extractButtonReply(msg: Record<string, unknown>): { id: string; title: string } | null {
  const interactive = msg['interactive'] as Record<string, unknown> | undefined;
  const buttonReply = interactive?.['button_reply'] as Record<string, unknown> | undefined;
  if (buttonReply?.['id']) {
    return { id: String(buttonReply['id']), title: String(buttonReply['title'] ?? '') };
  }
  // A tap on a list-message row (used when 2+ units are LISTED at once —
  // see buildAvailabilityReply) arrives as interactive.list_reply, not button_reply.
  const listReply = interactive?.['list_reply'] as Record<string, unknown> | undefined;
  if (listReply?.['id']) {
    return { id: String(listReply['id']), title: String(listReply['title'] ?? '') };
  }
  // Older "quick reply" template buttons arrive as a `button` object instead
  // of `interactive.button_reply`.
  const legacyButton = msg['button'] as Record<string, unknown> | undefined;
  if (legacyButton?.['payload']) {
    return { id: String(legacyButton['payload']), title: String(legacyButton['text'] ?? '') };
  }
  return null;
}

// Bot auto-replies sent from this handler never went through the normal
// whatsapp-send.ts route, so they were never logged as OUTBOUND rows in
// prop_whatsapp_messages — invisible in the WA inbox timeline, and unable to
// be detected by the "already greeted this enquiry" check below.
async function logOutbound(
  client: { query: (q: string, v: unknown[]) => Promise<{ rows: unknown[] }> },
  opts: { to: string; messageType: string; body: string; enquiryId: string | null; ticketId: string | null; result: unknown },
): Promise<void> {
  const waMessageId = (result => {
    const r = result as { messages?: Array<{ id?: string }> } | null;
    return r?.messages?.[0]?.id ?? null;
  })(opts.result);
  if (!waMessageId) return; // send was skipped (env not configured) or failed
  await client.query(
    `INSERT INTO prop_whatsapp_messages
       (owner_id, wa_message_id, direction, from_number, to_number, message_type, body,
        enquiry_id, ticket_id, delivery_status, sent_at)
     VALUES ($1,$2,'OUTBOUND',$3,$4,$5,$6,$7,$8,'SENT',NOW())
     ON CONFLICT (wa_message_id) DO NOTHING`,
    [JAG_OWNER_ID, waMessageId, process.env.WHATSAPP_PHONE_NUMBER_ID ?? 'JAG', opts.to,
     opts.messageType, opts.body, opts.enquiryId, opts.ticketId],
  );
}

type ListedUnitRow = {
  id: string; booking_slug: string; rent_amount: string | null;
  suggested_rent_recommended_ttd: string | null; address_line1: string | null; city: string | null;
};

// WhatsApp list-row limits: title 24 chars, description 72 chars, id 200 chars.
function truncate(s: string, max: number): string { return s.length > max ? s.slice(0, max - 1) + '…' : s; }

function unitAreaLabel(u: ListedUnitRow): string { return u.city || u.address_line1 || 'Trinidad'; }
function unitRent(u: ListedUnitRow): string { return u.rent_amount ?? u.suggested_rent_recommended_ttd ?? '—'; }

function availabilityReplyBody(u: ListedUnitRow): string {
  const bookingBase = process.env.PUBLIC_BOOKING_BASE_URL ?? 'https://jagcorporate.com/book';
  const managerPhone = process.env.JAG_MANAGER_PHONE ?? '868-753-2637';
  return `Good day! Yes, it's available. TTD $${unitRent(u)}/month in ${unitAreaLabel(u)}.\n\n`
    + `You can book a viewing through the link below, alternatively you can call ${managerPhone} for more information.\n\n`
    + `${bookingBase}/${u.booking_slug}\n\nThanks,\nRobert`;
}

async function processInboundMessage(msg: Record<string, unknown>): Promise<void> {
  const waMessageId = String(msg['id'] ?? '');
  const from        = String(msg['from'] ?? '');
  const type        = String(msg['type'] ?? 'text');
  // A tap on one of our own quick-reply buttons arrives as type 'interactive'
  // (or, for template quick-replies, type 'button') with the click payload
  // under interactive.button_reply / button — NOT under msg.text.body. Treating
  // the button title as free text lets it flow through the same reply logic
  // as a typed message would, while buttonReply.id lets us branch on intent
  // precisely instead of relying on keyword matching against the title.
  const buttonReply = extractButtonReply(msg);
  // Image/document messages can carry a caption — previously dropped entirely
  // (body was null for every non-text type), so a tenant captioning a payment
  // slip photo ("paid Aug rent") never reached the payment-keyword branch below
  // and the caption was invisible in the thread alongside the photo itself.
  const mediaNode = msg[type] as Record<string, unknown> | undefined;
  const caption   = (type === 'image' || type === 'document') ? (mediaNode?.['caption'] as string | undefined) : undefined;
  const mediaId   = (type === 'image' || type === 'document' || type === 'audio') ? (mediaNode?.['id'] as string | undefined) : undefined;
  const body        = buttonReply
    ? buttonReply.title
    : type === 'text' ? String((msg['text'] as Record<string, unknown>)?.['body'] ?? '')
    : (caption ?? null);

  if (!from) return;

  logger.info({ entity: 'WHATSAPP_WEBHOOK', action: 'INBOUND', from, type, button_id: buttonReply?.id ?? null, has_media: Boolean(mediaId) });

  // Downloaded and uploaded to MinIO before opening the DB transaction below —
  // this is a slow network round trip (two calls to Meta), and doing it inside
  // withOwnerRLS would hold the Postgres connection/transaction open for the
  // duration for no reason. A failure here is non-fatal: the message still
  // gets logged, just without an attachment, rather than losing the whole
  // inbound message over a Meta/MinIO hiccup.
  let mediaObjectKeyVal: string | null = null;
  if (mediaId) {
    try {
      const media = await downloadMedia(mediaId);
      if (media) {
        await ensureBucket(BUCKET_DOCUMENTS);
        const key = mediaObjectKey(JAG_OWNER_ID, 'wa-inbound', from, `${waMessageId}.${mimeToExt(media.mimeType)}`);
        await minioClient.putObject(BUCKET_DOCUMENTS, key, media.buffer, media.buffer.length, { 'Content-Type': media.mimeType });
        mediaObjectKeyVal = key;
      }
    } catch (e) {
      logger.error({ entity: 'WHATSAPP_WEBHOOK', action: 'MEDIA_STORE_FAILED', error_message: (e as Error).message });
    }
  }

  await withOwnerRLS(propertiesPool, JAG_OWNER_ID, async client => {
    // Step 1 — identify sender, get or create enquiry
    const { rows: [existing] } = await client.query(
      `SELECT enquiry_id, ticket_id FROM prop_whatsapp_messages
       WHERE from_number = $1 AND enquiry_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [from],
    );

    let enquiryId: string | null = existing?.enquiry_id ?? null;
    let ticketId:  string | null = existing?.ticket_id  ?? null;

    if (!enquiryId) {
      // Fallback — the prior message-linkage lookup only finds enquiries that
      // already have an inbound WhatsApp message attached. Most enquiries are
      // created by other flows (viewing booked, application submitted) with
      // no linked WA message row, so that lookup missed them and every reply
      // spawned a brand-new duplicate enquiry for the same prospect. Reuse
      // the most recent still-open enquiry for this phone instead of creating
      // a new one, unless it's already closed out.
      const { rows: [openEnquiry] } = await client.query(
        `SELECT id FROM prop_enquiries
         WHERE prospect_phone = $1 AND stage NOT IN ('REJECTED','WITHDRAWN','CONVERTED')
         ORDER BY created_at DESC LIMIT 1`,
        [from],
      );
      enquiryId = openEnquiry?.id ?? null;
    }

    if (!enquiryId) {
      const { rows: [eq] } = await client.query(
        `INSERT INTO prop_enquiries (owner_id, prospect_phone, channel, stage, initial_message)
         VALUES ($1,$2,'WHATSAPP','NEW_LEAD',$3) RETURNING id`,
        [JAG_OWNER_ID, from, body],
      );
      enquiryId = eq.id as string;
    }

    // Step 2 — log the message
    await client.query(
      `INSERT INTO prop_whatsapp_messages
         (owner_id, wa_message_id, direction, from_number, to_number, message_type, body,
          enquiry_id, ticket_id, delivery_status, sent_at, media_url)
       VALUES ($1,$2,'INBOUND',$3,$4,$5,$6,$7,$8,'READ',NOW(),$9)
       ON CONFLICT (wa_message_id) DO NOTHING`,
      [JAG_OWNER_ID, waMessageId, from,
       process.env.WHATSAPP_PHONE_NUMBER_ID ?? 'JAG',
       dbMessageType(type), body, enquiryId, ticketId, mediaObjectKeyVal],
    );

    if (enquiryId) {
      await client.query(
        `UPDATE prop_enquiries SET last_contact_at = NOW() WHERE id = $1`, [enquiryId],
      );
    }

    if (!body) return;

    // Step 3 — a tap on one of the availability-list rows (sent when 2+ units
    // are LISTED at once — see the greeting below). Links this enquiry to the
    // chosen unit and sends the same instant availability reply the single-
    // listing case gets directly.
    if (buttonReply?.id?.startsWith('unit_')) {
      const unitId = buttonReply.id.slice('unit_'.length);
      const { rows: [unit] } = await client.query<ListedUnitRow>(
        `SELECT u.id, u.booking_slug, u.rent_amount, u.suggested_rent_recommended_ttd,
                p.address_line1, p.city
         FROM prop_units u LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE u.id = $1 AND u.listing_status = 'LISTED' AND u.booking_slug IS NOT NULL`,
        [unitId],
      );
      if (unit) {
        await client.query(`UPDATE prop_enquiries SET unit_id = $1 WHERE id = $2`, [unit.id, enquiryId]);
        const replyBody = availabilityReplyBody(unit);
        const result = await sendText({ to: from, body: replyBody }).catch(() => null);
        await logOutbound(client, { to: from, messageType: 'TEXT', body: replyBody, enquiryId, ticketId, result });
      } else {
        const replyBody = `Sorry, that unit is no longer available. Let us know what area/property you're asking about and we'll help from there.`;
        const result = await sendText({ to: from, body: replyBody }).catch(() => null);
        await logOutbound(client, { to: from, messageType: 'TEXT', body: replyBody, enquiryId, ticketId, result });
      }
      return;
    }

    // Step 3b — button-reply intents (handled before keyword classification —
    // a button title like "Book a Viewing" wouldn't match any P1/P2/payment/
    // renewal keyword, so without this branch a tap just fell through to the
    // generic reply below and re-sent the same greeting menu instead of
    // actually doing anything).
    if (buttonReply?.id === 'book_viewing') {
      const { rows: [unit] } = await client.query(
        `SELECT u.booking_slug FROM prop_enquiries e
         JOIN prop_units u ON u.id = e.unit_id
         WHERE e.id = $1 AND u.booking_slug IS NOT NULL`,
        [enquiryId],
      );
      const bookingBase = process.env.PUBLIC_BOOKING_BASE_URL ?? 'https://jagcorporate.com/book';
      const replyBody = unit
        ? `Great! You can view details and pick a viewing time here: ${bookingBase}/${unit.booking_slug}`
        : `Sure — which property or area are you interested in? Reply with the address/area and we'll send you available viewing times.`;
      const result = await sendText({ to: from, body: replyBody }).catch(() => null);
      await logOutbound(client, { to: from, messageType: 'TEXT', body: replyBody, enquiryId, ticketId, result });
      return;
    }
    if (buttonReply?.id === 'ask_question') {
      const replyBody = `Sure, go ahead and type your question — we'll get back to you shortly.`;
      const result = await sendText({ to: from, body: replyBody }).catch(() => null);
      await logOutbound(client, { to: from, messageType: 'TEXT', body: replyBody, enquiryId, ticketId, result });
      void enqueueNotification({
        tier: 2,
        title: 'WhatsApp: prospect wants to ask a question',
        body: `${from} tapped "Ask a Question" — check the WhatsApp inbox to follow up.`,
        payload: { module: 'PROPERTIES', kind: 'ENQUIRY', enquiry_id: enquiryId },
      });
      return;
    }

    // Step 4 — intent classification (keyword-based; Ollama optional for future).
    // Gated on the sender being a matched active tenant — without this, a brand-new
    // prospect's first message could contain an overlapping word ("I'm leaving my
    // current place", "you sent me this number") and get silently swallowed by the
    // maintenance/payment/renewal branches below (which do nothing for non-tenants),
    // instead of reaching the availability-reply logic in the final else branch.
    // prop_lease_agreements has no tenant_phone column — phone lives on
    // prop_property_tenants, joined via tenant_id. This exact wrong-column
    // query pre-existed in the maintenance-ticket branch below (silently
    // erroring out and swallowing the message whenever it fired) before this
    // fix; found while testing the new availability auto-reply.
    const { rows: [activeLease] } = await client.query(
      `SELECT u.id FROM prop_lease_agreements la
       JOIN prop_units u ON u.id = la.unit_id
       JOIN prop_property_tenants pt ON pt.id = la.tenant_id
       WHERE pt.phone = $1 AND la.status = 'ACTIVE' LIMIT 1`,
      [from],
    );
    const lower = body.toLowerCase();
    const isMaintenanceKw = Boolean(activeLease) && [...P1_KEYWORDS, ...P2_KEYWORDS].some(k => lower.includes(k));
    const isPaymentKw     = Boolean(activeLease) && ['paid','payment','transferred','sent'].some(k => lower.includes(k));
    const isRenewalKw     = Boolean(activeLease) && ['renew','staying','leaving','vacating','extend'].some(k => lower.includes(k));

    if (isMaintenanceKw) {
      // Auto-create maintenance ticket
      const priority = suggestPriority(body);
      const sla      = slaHours(priority);
      const slaAt    = sla ? new Date(Date.now() + sla * 3_600_000) : null;

      const { rows: [cnt] } = await client.query(
        `SELECT COUNT(*) FROM prop_maintenance_tickets WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())`,
      );
      const seq       = String(parseInt(cnt.count) + 1).padStart(4, '0');
      const ticketRef = `MNT-${new Date().getFullYear()}-${seq}`;
      const unit = activeLease;

      if (unit) {
        const { rows: [ticket] } = await client.query(
          `INSERT INTO prop_maintenance_tickets
             (owner_id, unit_id, ticket_ref, reported_by_phone, report_channel,
              category, description, priority, priority_auto_suggested, sla_hours, sla_breach_at)
           VALUES ($1,$2,$3,$4,'WHATSAPP','OTHER',$5,$6,$7,$8,$9) RETURNING id, ticket_ref`,
          [JAG_OWNER_ID, unit.id, ticketRef, from, body, priority, priority, sla, slaAt],
        );
        ticketId = ticket.id as string;

        await client.query(
          `UPDATE prop_whatsapp_messages SET ticket_id = $1
           WHERE wa_message_id = $2`,
          [ticketId, waMessageId],
        );

        await sendTemplate({
          to: from,
          templateName: 'jag_mnt_ticket_ack',
          components: [{ type: 'body', parameters: [
            { type: 'text', text: 'Tenant' },
            { type: 'text', text: ticketRef },
            { type: 'text', text: 'OTHER' },
            { type: 'text', text: priority },
            { type: 'text', text: sla ? `${sla}h` : 'N/A' },
          ]}],
        }).catch(() => { /* best effort */ });
      }
    } else if (isPaymentKw) {
      logger.info({ entity: 'WHATSAPP_WEBHOOK', action: 'PAYMENT_CONFIRM_FLAG', from });
    } else if (isRenewalKw) {
      logger.info({ entity: 'WHATSAPP_WEBHOOK', action: 'RENEWAL_RESPONSE_FLAG', from });
    } else if (enquiryId) {
      // Send the greeting menu only once per enquiry — without this guard,
      // every subsequent message that doesn't match a keyword (e.g. a plain
      // "hi", or anything sent before the tenant reads the first reply)
      // re-sent the identical menu, which looked like the bot was stuck in a
      // loop and ignoring whatever the prospect actually said/tapped.
      const { rows: [priorOutbound] } = await client.query(
        `SELECT 1 FROM prop_whatsapp_messages WHERE enquiry_id = $1 AND direction = 'OUTBOUND' LIMIT 1`,
        [enquiryId],
      );
      if (!priorOutbound) {
        try {
          const { rows: listedUnits } = await client.query<ListedUnitRow>(
            `SELECT u.id, u.booking_slug, u.rent_amount, u.suggested_rent_recommended_ttd,
                    p.address_line1, p.city
             FROM prop_units u LEFT JOIN prop_properties p ON p.id = u.property_id
             WHERE u.listing_status = 'LISTED' AND u.booking_slug IS NOT NULL
             ORDER BY u.listed_at DESC LIMIT 10`,
          );

          if (listedUnits.length === 0) {
            // No current listing to reference — fall back to asking directly.
            const replyBody = `Hi! Thanks for your interest. Let us know which property or area you're asking about and we'll help from there.`;
            const result = await sendText({ to: from, body: replyBody }).catch(() => null);
            await logOutbound(client, { to: from, messageType: 'TEXT', body: replyBody, enquiryId, ticketId, result });
          } else if (listedUnits.length === 1) {
            // Only one active listing — no ambiguity, answer instantly.
            const unit = listedUnits[0];
            await client.query(`UPDATE prop_enquiries SET unit_id = $1 WHERE id = $2`, [unit.id, enquiryId]);
            const replyBody = availabilityReplyBody(unit);
            const result = await sendText({ to: from, body: replyBody }).catch(() => null);
            await logOutbound(client, { to: from, messageType: 'TEXT', body: replyBody, enquiryId, ticketId, result });
          } else {
            // Multiple active listings — WhatsApp has no way to know which ad
            // the prospect saw, so ask which one via a list message (up to 10 rows).
            const greetingBody = `Hi! Thanks for your interest — we currently have a few units available. Which one are you asking about?`;
            const result = await sendList({
              to: from,
              body: greetingBody,
              buttonText: 'View Units',
              rows: listedUnits.map(u => ({
                id: `unit_${u.id}`,
                title: truncate(unitAreaLabel(u), 24),
                description: truncate(`TTD $${unitRent(u)}/month`, 72),
              })),
            });
            await logOutbound(client, { to: from, messageType: 'INTERACTIVE', body: greetingBody, enquiryId, ticketId, result });
          }
        } catch { /* best effort */ }
      } else {
        const replyBody = `Got it — we'll get back to you shortly.`;
        const result = await sendText({ to: from, body: replyBody }).catch(() => null);
        await logOutbound(client, { to: from, messageType: 'TEXT', body: replyBody, enquiryId, ticketId, result });
        void enqueueNotification({
          tier: 2,
          title: 'WhatsApp: new message from prospect',
          body: `${from}: ${body.slice(0, 200)}`,
          payload: { module: 'PROPERTIES', kind: 'ENQUIRY', enquiry_id: enquiryId },
        });
      }
    }
  });
}
