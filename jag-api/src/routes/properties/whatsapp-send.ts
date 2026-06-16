// POST   /api/v1/properties/whatsapp/send-template
// POST   /api/v1/properties/whatsapp/send-text
// POST   /api/v1/properties/whatsapp/send-interactive
// GET    /api/v1/properties/whatsapp/conversations
// GET    /api/v1/properties/whatsapp/conversations/:phone

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { ok, err } from '../../lib/response';
import { sendText, sendTemplate, sendInteractive } from '../../lib/whatsapp';
import { logger } from '../../lib/logger';

export const whatsappSendRouter = Router();

const SendTextSchema = z.object({
  to:         z.string().min(7).max(30),
  body:       z.string().min(1),
  enquiry_id: z.string().uuid().optional(),
  ticket_id:  z.string().uuid().optional(),
}).strict();

const SendTemplateSchema = z.object({
  to:            z.string().min(7).max(30),
  template_name: z.string().min(1),
  language_code: z.string().optional(),
  components:    z.array(z.unknown()).optional(),
  enquiry_id:    z.string().uuid().optional(),
  ticket_id:     z.string().uuid().optional(),
}).strict();

const SendInteractiveSchema = z.object({
  to:         z.string().min(7).max(30),
  body:       z.string().min(1),
  buttons:    z.array(z.object({ id: z.string(), title: z.string() })).min(1).max(3),
  enquiry_id: z.string().uuid().optional(),
  ticket_id:  z.string().uuid().optional(),
}).strict();

const PhoneParam = z.object({ phone: z.string().min(7) });

async function logMessage(
  ownerId: string,
  direction: 'INBOUND' | 'OUTBOUND',
  from: string,
  to: string,
  msgType: string,
  body: string | null,
  templateName: string | null,
  enquiryId: string | null,
  ticketId: string | null,
): Promise<void> {
  await withOwnerRLS(propertiesPool, ownerId, async client => {
    await client.query(
      `INSERT INTO prop_whatsapp_messages
         (owner_id, direction, from_number, to_number, message_type, body, template_name,
          enquiry_id, ticket_id, delivery_status, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'SENT',NOW())`,
      [ownerId, direction, from, to, msgType, body, templateName, enquiryId, ticketId],
    );
    if (enquiryId) {
      await client.query(
        `UPDATE prop_enquiries SET last_contact_at = NOW() WHERE id = $1`, [enquiryId],
      );
    }
  });
}

whatsappSendRouter.post('/send-text', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const body = SendTextSchema.parse(req.body);

    await sendText({ to: body.to, body: body.body });
    await logMessage(ownerId, 'OUTBOUND', process.env.WHATSAPP_PHONE_NUMBER_ID ?? 'JAG',
      body.to, 'TEXT', body.body, null, body.enquiry_id ?? null, body.ticket_id ?? null);
    res.json(ok({ sent: true }));
  } catch (e) { next(e); }
});

whatsappSendRouter.post('/send-template', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const body = SendTemplateSchema.parse(req.body);

    await sendTemplate({ to: body.to, templateName: body.template_name,
      languageCode: body.language_code, components: body.components as unknown[] });
    await logMessage(ownerId, 'OUTBOUND', process.env.WHATSAPP_PHONE_NUMBER_ID ?? 'JAG',
      body.to, 'TEMPLATE', null, body.template_name, body.enquiry_id ?? null, body.ticket_id ?? null);
    res.json(ok({ sent: true }));
  } catch (e) { next(e); }
});

whatsappSendRouter.post('/send-interactive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const body = SendInteractiveSchema.parse(req.body);

    await sendInteractive({ to: body.to, body: body.body, buttons: body.buttons });
    await logMessage(ownerId, 'OUTBOUND', process.env.WHATSAPP_PHONE_NUMBER_ID ?? 'JAG',
      body.to, 'INTERACTIVE', body.body, null, body.enquiry_id ?? null, body.ticket_id ?? null);
    res.json(ok({ sent: true }));
  } catch (e) { next(e); }
});

whatsappSendRouter.get('/conversations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: r } = await client.query(
        `SELECT from_number AS phone, COUNT(*) AS message_count,
                MAX(created_at) AS last_message_at,
                MAX(CASE WHEN direction='INBOUND' THEN body END) AS last_inbound,
                MIN(enquiry_id) AS enquiry_id
         FROM prop_whatsapp_messages
         WHERE owner_id = $1 AND from_number IS NOT NULL
         GROUP BY from_number
         ORDER BY last_message_at DESC LIMIT 100`,
        [ownerId],
      );
      return r;
    });
    res.json(ok(rows));
  } catch (e) { next(e); }
});

whatsappSendRouter.get('/conversations/:phone', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { phone } = PhoneParam.parse(req.params);

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: r } = await client.query(
        `SELECT * FROM prop_whatsapp_messages
         WHERE owner_id = $1 AND (from_number = $2 OR to_number = $2)
         ORDER BY created_at ASC LIMIT 500`,
        [ownerId, phone],
      );
      return r;
    });
    res.json(ok(rows));
  } catch (e) { next(e); }
});
