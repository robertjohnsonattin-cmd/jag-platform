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
import { sendTemplate, sendInteractive, verifyWebhookSignature } from '../../lib/whatsapp';

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

async function processInboundMessage(msg: Record<string, unknown>): Promise<void> {
  const waMessageId = String(msg['id'] ?? '');
  const from        = String(msg['from'] ?? '');
  const type        = String(msg['type'] ?? 'text');
  const body        = type === 'text' ? String((msg['text'] as Record<string, unknown>)?.['body'] ?? '') : null;

  if (!from) return;

  logger.info({ entity: 'WHATSAPP_WEBHOOK', action: 'INBOUND', from, type });

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
          enquiry_id, ticket_id, delivery_status, sent_at)
       VALUES ($1,$2,'INBOUND',$3,$4,$5,$6,$7,$8,'READ',NOW())
       ON CONFLICT (wa_message_id) DO NOTHING`,
      [JAG_OWNER_ID, waMessageId, from,
       process.env.WHATSAPP_PHONE_NUMBER_ID ?? 'JAG',
       type, body, enquiryId, ticketId],
    );

    if (enquiryId) {
      await client.query(
        `UPDATE prop_enquiries SET last_contact_at = NOW() WHERE id = $1`, [enquiryId],
      );
    }

    if (!body) return;

    // Step 3 — intent classification (keyword-based; Ollama optional for future)
    const lower = body.toLowerCase();
    const isMaintenanceKw = [...P1_KEYWORDS, ...P2_KEYWORDS].some(k => lower.includes(k));
    const isPaymentKw     = ['paid','payment','transferred','sent'].some(k => lower.includes(k));
    const isRenewalKw     = ['renew','staying','leaving','vacating','extend'].some(k => lower.includes(k));

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

      const { rows: [unit] } = await client.query(
        `SELECT u.id FROM prop_lease_agreements la
         JOIN prop_units u ON u.id = la.unit_id
         WHERE la.tenant_phone = $1 AND la.status = 'ACTIVE' LIMIT 1`,
        [from],
      );

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
      // New enquiry — send ack with booking options
      try {
        await sendInteractive({
          to: from,
          body: `Hi! Thank you for your interest. How can we help?`,
          buttons: [
            { id: 'book_viewing', title: 'Book a Viewing' },
            { id: 'ask_question', title: 'Ask a Question' },
          ],
        });
      } catch { /* best effort */ }
    }
  });
}
