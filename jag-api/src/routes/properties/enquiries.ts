// GET    /api/v1/properties/enquiries
// POST   /api/v1/properties/enquiries
// GET    /api/v1/properties/enquiries/:id
// PATCH  /api/v1/properties/enquiries/:id
// DELETE /api/v1/properties/enquiries/:id
// POST   /api/v1/properties/enquiries/:id/send-reply
// POST   /api/v1/properties/enquiries/:id/send-app-link
// POST   /api/v1/properties/enquiries/:id/screening-decision

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { sendText, sendTemplate } from '../../lib/whatsapp';
import { enqueueNotification } from '../../lib/notifications';

export const enquiriesRouter = Router();

const IdParam = z.object({ id: z.string().uuid() });

const ChannelEnum = z.enum(['WHATSAPP','SMS','EMAIL','PHONE','WALK_IN','FACEBOOK']);
const StageEnum   = z.enum(['NEW_LEAD','VIEWING_SCHEDULED','VIEWED','APPLICATION_SENT','APPLICATION_RECEIVED','SCREENING','APPROVED','REJECTED','WITHDRAWN','CONVERTED']);

const CreateEnquirySchema = z.object({
  unit_id:          z.string().uuid().optional(),
  property_id:      z.string().uuid().optional(),
  prospect_name:    z.string().max(200).optional(),
  prospect_phone:   z.string().max(30).optional(),
  prospect_email:   z.string().email().max(200).optional().or(z.literal('')),
  channel:          ChannelEnum,
  initial_message:  z.string().optional(),
  notes:            z.string().optional(),
}).strict();

const PatchEnquirySchema = z.object({
  stage:            StageEnum.optional(),
  flagged:          z.boolean().optional(),
  flag_reason:      z.string().nullable().optional(),
  notes:            z.string().nullable().optional(),
  last_contact_at:  z.string().optional(),
  wa_thread_id:     z.string().max(100).nullable().optional(),
}).strict();

const SendReplySchema = z.object({
  body: z.string().min(1),
}).strict();

const SendAppLinkSchema = z.object({
  application_link: z.string().url(),
}).strict();

const ScreeningDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
}).strict();

enquiriesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const unitId = req.query['unit_id'] as string | undefined;
    const stage  = req.query['stage'] as string | undefined;
    const phone  = req.query['phone'] as string | undefined;

    // An enquiry predates the tenant record, so it carries no tenant_id -- the
    // prospect's phone number is the only link back. Tenant 360's lifecycle
    // timeline needs it to answer "did this person enquire, and did they view?"
    // Numbers are stored however they were typed ('+1-868-555-1234',
    // '18685551234', '555-1234'), so match on the last 7 digits of each side
    // rather than on equality. 7 digits is the local subscriber number in
    // Trinidad & Tobago -- enough to be specific, short enough to survive a
    // missing country or area code.
    const phoneDigits = phone ? phone.replace(/\D/g, '').slice(-7) : undefined;

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const conds: string[] = [];
      const vals: unknown[] = [ownerId];
      if (unitId) { vals.push(unitId); conds.push(`e.unit_id = $${vals.length}`); }
      if (stage)  { vals.push(stage);  conds.push(`e.stage = $${vals.length}`); }
      if (phoneDigits && phoneDigits.length >= 7) {
        vals.push(phoneDigits);
        conds.push(`right(regexp_replace(e.prospect_phone, '\\D', '', 'g'), 7) = $${vals.length}`);
      } else if (phoneDigits) {
        // Too short to identify anyone -- match nothing rather than everyone.
        conds.push('FALSE');
      }
      const where = conds.length ? ' AND ' + conds.join(' AND ') : '';
      const { rows: r } = await client.query(
        // latest_viewing_at lets a caller answer "has this prospect actually
        // viewed?" without a second round trip; prop_viewings joins to the
        // enquiry, never to a tenant.
        `SELECT e.*, u.unit_number, p.name AS property_name,
                (SELECT max(v.scheduled_at) FROM prop_viewings v WHERE v.enquiry_id = e.id) AS latest_viewing_at
         FROM prop_enquiries e
         LEFT JOIN prop_units u ON u.id = e.unit_id
         LEFT JOIN prop_properties p ON p.id = e.property_id
         WHERE e.owner_id = $1${where}
         ORDER BY e.created_at DESC LIMIT 200`,
        vals,
      );
      return r;
    });
    res.json(ok(rows));
  } catch (e) { next(e); }
});

enquiriesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const body = CreateEnquirySchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `INSERT INTO prop_enquiries (owner_id, unit_id, property_id, prospect_name, prospect_phone,
           prospect_email, channel, initial_message, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [ownerId, body.unit_id ?? null, body.property_id ?? null, body.prospect_name ?? null,
         body.prospect_phone ?? null, body.prospect_email || null, body.channel,
         body.initial_message ?? null, body.notes ?? null],
      );
      return rows[0];
    });
    logger.info({ entity: 'PROPERTIES', action: 'ENQUIRY_CREATED', record_id: row.id, user_id: ownerId });

    // Owner in-app notification — new tenancy lead (non-blocking).
    void enqueueNotification({
      tier: 2,
      title: 'New tenancy enquiry',
      body: `${row.prospect_name ?? 'A prospect'}${row.prospect_phone ? ` (${row.prospect_phone})` : ''} enquired via ${String(body.channel).toLowerCase()}.`,
      payload: { module: 'PROPERTIES', kind: 'ENQUIRY', enquiry_id: row.id },
    });

    // JAG_ENQ_001 — auto-reply when a WhatsApp enquiry is manually logged with a known property/unit
    if (body.channel === 'WHATSAPP' && body.prospect_phone && (body.unit_id || body.property_id)) {
      const ctx = await withOwnerRLS(propertiesPool, ownerId, async client => {
        const { rows: [r] } = await client.query(
          `SELECT u.unit_number, p.name AS property_name, p.city, u.booking_slug
           FROM prop_units u
           LEFT JOIN prop_properties p ON p.id = u.property_id
           WHERE u.id = $1`,
          [body.unit_id ?? '00000000-0000-0000-0000-000000000000'],
        );
        return r ?? null;
      });
      if (ctx) {
        // Pre-screening acknowledgement: town/area only, no full address, no viewing link
        // (booking is only offered after the prospect passes pre-screening).
        sendTemplate({
          to: body.prospect_phone,
          templateName: 'jag_enq_auto_reply',
          components: [
            { type: 'body', parameters: [
              { type: 'text', text: body.prospect_name ?? 'there' },
              { type: 'text', text: (ctx.city as string) || 'Trinidad' },
            ]},
          ],
        }).catch(e => logger.warn({ entity: 'PROPERTIES', action: 'WA_AUTO_REPLY_FAILED', error_message: (e as Error).message }));
      }
    }

    res.status(201).json(ok(row));
  } catch (e) { next(e); }
});

enquiriesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const data = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [enquiry] } = await client.query(
        `SELECT e.*, u.unit_number, p.name AS property_name
         FROM prop_enquiries e
         LEFT JOIN prop_units u ON u.id = e.unit_id
         LEFT JOIN prop_properties p ON p.id = e.property_id
         WHERE e.id = $1 AND e.owner_id = $2`,
        [id, ownerId],
      );
      if (!enquiry) return null;
      const { rows: messages } = await client.query(
        `SELECT * FROM prop_whatsapp_messages WHERE enquiry_id = $1 ORDER BY created_at ASC`,
        [id],
      );
      return { ...enquiry, messages };
    });

    if (!data) return void res.status(404).json(err('Enquiry not found', 'NOT_FOUND'));
    res.json(ok(data));
  } catch (e) { next(e); }
});

enquiriesRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = PatchEnquirySchema.parse(req.body);
    if (Object.keys(body).length === 0) return void res.status(400).json(err('No fields to update', 'VALIDATION_ERROR'));

    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      vals.push(v); sets.push(`${k} = $${vals.length}`);
    }
    vals.push(id); vals.push(ownerId);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_enquiries SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND owner_id = $${vals.length} RETURNING *`,
        vals,
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Enquiry not found', 'NOT_FOUND'));
    res.json(ok(row));
  } catch (e) { next(e); }
});

enquiriesRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    await withOwnerRLS(propertiesPool, ownerId, async client => {
      await client.query(`DELETE FROM prop_enquiries WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
    });
    res.json(ok({ deleted: id }));
  } catch (e) { next(e); }
});

enquiriesRouter.post('/:id/send-reply', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const { body: msgBody } = SendReplySchema.parse(req.body);

    const enquiry = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `SELECT * FROM prop_enquiries WHERE id = $1 AND owner_id = $2`, [id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!enquiry) return void res.status(404).json(err('Enquiry not found', 'NOT_FOUND'));
    if (!enquiry.prospect_phone) return void res.status(400).json(err('No phone number on enquiry', 'VALIDATION_ERROR'));

    await sendText({ to: enquiry.prospect_phone, body: msgBody });
    await withOwnerRLS(propertiesPool, ownerId, async client => {
      await client.query(
        `INSERT INTO prop_whatsapp_messages (owner_id, direction, to_number, enquiry_id, message_type, body, delivery_status, sent_at)
         VALUES ($1,'OUTBOUND',$2,$3,'TEXT',$4,'SENT',NOW())`,
        [ownerId, enquiry.prospect_phone, id, msgBody],
      );
      await client.query(`UPDATE prop_enquiries SET last_contact_at = NOW() WHERE id = $1`, [id]);
    });
    res.json(ok({ sent: true }));
  } catch (e) { next(e); }
});

enquiriesRouter.post('/:id/send-app-link', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const { application_link } = SendAppLinkSchema.parse(req.body);

    const enquiry = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `SELECT * FROM prop_enquiries WHERE id = $1 AND owner_id = $2`, [id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!enquiry) return void res.status(404).json(err('Enquiry not found', 'NOT_FOUND'));
    if (!enquiry.prospect_phone) return void res.status(400).json(err('No phone number on enquiry', 'VALIDATION_ERROR'));

    const name = enquiry.prospect_name ?? 'there';
    await sendTemplate({
      to: enquiry.prospect_phone,
      templateName: 'jag_enq_post_viewing',
      components: [{ type: 'body', parameters: [{ type: 'text', text: name }, { type: 'text', text: application_link }] }],
    });
    await withOwnerRLS(propertiesPool, ownerId, async client => {
      await client.query(
        `UPDATE prop_enquiries SET stage = 'APPLICATION_SENT', last_contact_at = NOW() WHERE id = $1 AND stage = 'VIEWED'`,
        [id],
      );
    });
    res.json(ok({ sent: true }));
  } catch (e) { next(e); }
});

// Owner reviews screening answers submitted on the public booking page and either
// approves (issuing a one-time schedule_token the prospect uses to pick a slot at
// /api/v1/public/schedule/:token) or rejects the request.
enquiriesRouter.post('/:id/screening-decision', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const { decision } = ScreeningDecisionSchema.parse(req.body);

    const enquiry = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(`SELECT * FROM prop_enquiries WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
      return rows[0] ?? null;
    });
    if (!enquiry) return void res.status(404).json(err('Enquiry not found', 'NOT_FOUND'));
    if (enquiry.stage !== 'SCREENING') {
      return void res.status(400).json(err('Enquiry is not awaiting screening review', 'VALIDATION_ERROR'));
    }

    if (decision === 'APPROVE') {
      const token = randomBytes(24).toString('hex');
      const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
        const { rows } = await client.query(
          `UPDATE prop_enquiries
           SET stage = 'APPROVED', schedule_token = $1, schedule_token_expires_at = NOW() + INTERVAL '7 days',
               screening_reviewed_at = NOW(), screening_reviewed_by = $2
           WHERE id = $3 RETURNING *`,
          [token, ownerId, id],
        );
        return rows[0];
      });
      logger.info({ entity: 'PROPERTIES', action: 'SCREENING_APPROVED', record_id: id, user_id: ownerId });

      // Requires a Meta-approved WhatsApp template ("jag_enq_screening_approved" —
      // body param: prospect name; button: URL param carrying the schedule link).
      // Until that template is approved, this call fails silently (logged as a
      // warning) — approve manually via WhatsApp using the schedule_token URL below.
      if (enquiry.prospect_phone) {
        // URL button is https://jagcorporate.com/schedule/{{1}} — send the token only.
        sendTemplate({
          to: enquiry.prospect_phone,
          templateName: 'jag_enq_screening_approved',
          components: [
            { type: 'body', parameters: [{ type: 'text', text: enquiry.prospect_name ?? 'there' }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
          ],
        }).catch(e => logger.warn({ entity: 'PROPERTIES', action: 'WA_SCREENING_APPROVED_FAILED', error_message: (e as Error).message }));
      }
      res.json(ok(row));
    } else {
      const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
        const { rows } = await client.query(
          `UPDATE prop_enquiries SET stage = 'REJECTED', screening_reviewed_at = NOW(), screening_reviewed_by = $1 WHERE id = $2 RETURNING *`,
          [ownerId, id],
        );
        return rows[0];
      });
      logger.info({ entity: 'PROPERTIES', action: 'SCREENING_REJECTED', record_id: id, user_id: ownerId });

      // Requires a Meta-approved WhatsApp template ("jag_enq_screening_declined" — body param: prospect name).
      if (enquiry.prospect_phone) {
        sendTemplate({
          to: enquiry.prospect_phone,
          templateName: 'jag_enq_screening_declined',
          components: [{ type: 'body', parameters: [{ type: 'text', text: enquiry.prospect_name ?? 'there' }] }],
        }).catch(e => logger.warn({ entity: 'PROPERTIES', action: 'WA_SCREENING_DECLINED_FAILED', error_message: (e as Error).message }));
      }
      res.json(ok(row));
    }
  } catch (e) { next(e); }
});
