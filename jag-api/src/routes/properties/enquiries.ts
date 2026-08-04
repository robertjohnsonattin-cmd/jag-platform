// GET    /api/v1/properties/enquiries
// POST   /api/v1/properties/enquiries
// GET    /api/v1/properties/enquiries/:id
// PATCH  /api/v1/properties/enquiries/:id
// DELETE /api/v1/properties/enquiries/:id
// POST   /api/v1/properties/enquiries/:id/send-reply
// POST   /api/v1/properties/enquiries/:id/send-app-link
// POST   /api/v1/properties/enquiries/:id/screening-decision
// POST   /api/v1/properties/enquiries/merge — merge duplicate enquiries for one person

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { sendText, sendTemplate } from '../../lib/whatsapp';
import { enqueueNotification } from '../../lib/notifications';
import { phoneKey } from '../../lib/phone';
import type { PoolClient } from 'pg';

export const enquiriesRouter = Router();

const IdParam = z.object({ id: z.string().uuid() });

const ChannelEnum = z.enum(['WHATSAPP','SMS','EMAIL','PHONE','WALK_IN','FACEBOOK']);
const StageEnum   = z.enum(['NEW_LEAD','VIEWING_SCHEDULED','VIEWED','APPLICATION_SENT','APPLICATION_RECEIVED','SCREENING','APPROVED','REJECTED','WITHDRAWN','CONVERTED','MERGED']);

const MergeEnquiriesSchema = z.object({
  keeper_id: z.string().uuid(),
  merge_ids: z.array(z.string().uuid()).min(1).max(50),
}).strict();

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
        // prop_viewings joins to the enquiry, never to a tenant, so both of
        // these save a round trip. They are NOT interchangeable:
        //   latest_viewing_at    — the newest *scheduled* slot, past or future,
        //                          whatever its status. "A viewing is on the books."
        //   completed_viewing_at — the newest slot actually marked COMPLETED.
        //                          "This prospect has actually seen the unit."
        // The timeline originally used latest_viewing_at for "has viewed", which
        // marked the step done for a viewing booked next week — and for
        // CANCELLED and NO_SHOW rows too. Anything asserting that a viewing
        // *happened* must read completed_viewing_at.
        `SELECT e.*, u.unit_number, p.name AS property_name,
                (SELECT max(v.scheduled_at) FROM prop_viewings v WHERE v.enquiry_id = e.id) AS latest_viewing_at,
                (SELECT max(v.scheduled_at) FROM prop_viewings v
                  WHERE v.enquiry_id = e.id AND v.status = 'COMPLETED')            AS completed_viewing_at
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

    // The same prospect can already have an enquiry whose phone was typed in a
    // different format ('18687871973' vs '8687871973'). Creating a second
    // record splits their thread across two enquiries, so look up an open
    // enquiry by the last-7 digit key and merge the new input into it instead.
    const result = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const key = phoneKey(body.prospect_phone);
      if (key) {
        const { rows } = await client.query<Record<string, unknown>>(
          `SELECT id FROM prop_enquiries
           WHERE owner_id = $1 AND right(regexp_replace(prospect_phone, '\\D', '', 'g'), 7) = $2
             AND stage NOT IN ('REJECTED','WITHDRAWN','CONVERTED')
           ORDER BY created_at DESC LIMIT 1`,
          [ownerId, key],
        );
        const existing = rows[0];
        if (existing) {
          const { rows: merged } = await client.query(
            `UPDATE prop_enquiries SET
               prospect_name   = COALESCE($1, prospect_name),
               prospect_email  = COALESCE(NULLIF($2,''), prospect_email),
               unit_id         = COALESCE($3, unit_id),
               property_id     = COALESCE($4, property_id),
               initial_message = COALESCE($5, initial_message),
               notes           = COALESCE($6, notes),
               last_contact_at = NOW()
             WHERE id = $7 AND owner_id = $8 RETURNING *`,
            [body.prospect_name ?? null, body.prospect_email || null,
             body.unit_id ?? null, body.property_id ?? null,
             body.initial_message ?? null, body.notes ?? null,
             existing.id, ownerId],
          );
          return { row: merged[0], merged: true };
        }
      }
      const { rows } = await client.query(
        `INSERT INTO prop_enquiries (owner_id, unit_id, property_id, prospect_name, prospect_phone,
           prospect_email, channel, initial_message, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [ownerId, body.unit_id ?? null, body.property_id ?? null, body.prospect_name ?? null,
         body.prospect_phone ?? null, body.prospect_email || null, body.channel,
         body.initial_message ?? null, body.notes ?? null],
      );
      return { row: rows[0], merged: false };
    });

    const row = result.row;
    if (result.merged) {
      logger.info({ entity: 'PROPERTIES', action: 'ENQUIRY_MERGED', record_id: row.id, user_id: ownerId });
      return void res.status(200).json(ok({ ...row, merged: true }));
    }

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

// ── Merge duplicate enquiries for the same prospect ──────────────────────────
// The phone-key fix (session 2026-08-03) stopped NEW splits, but enquiries that
// already existed when the number was typed two different ways (Brijhan ×2,
// Hugh Smith ×3, etc.) still list separately. This merges a group into one
// "keeper": every child record (WA messages, contact log, viewings, applications)
// is repointed to the keeper, blank fields on the keeper are filled from the
// merged rows, and the merged-away rows are KEPT and marked stage='MERGED' with
// merged_into_id = keeper — nothing is deleted, so the audit trail survives.
// Guard rails: all rows must share the same last-7 phone key AND the same unit
// (all-NULL counts as equal), and none may already be merged. This is deliberately
// conservative — merging across units would collapse two genuinely different leads.
class MergeError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
    this.name = 'MergeError';
  }
}

export async function mergeEnquiriesTx(
  client: PoolClient,
  ownerId: string,
  keeperId: string,
  mergeIds: string[],
): Promise<{
  keeper_id: string;
  messages_moved: number;
  logs_moved: number;
  viewings_moved: number;
  applications_moved: number;
  merged_rows: number;
}> {
  const mergeSet = [...new Set(mergeIds)].filter(id => id !== keeperId);
  if (mergeSet.length === 0) {
    throw new MergeError('Nothing to merge — no duplicates selected.', 'VALIDATION_ERROR', 400);
  }

  const allIds = [keeperId, ...mergeSet];
  const { rows: found } = await client.query<Record<string, unknown>>(
    `SELECT * FROM prop_enquiries WHERE id = ANY($1::uuid[]) AND owner_id = $2`,
    [allIds, ownerId],
  );
  if (found.length !== allIds.length) {
    const got = new Set(found.map(r => String(r.id)));
    const missing = allIds.filter(id => !got.has(id));
    throw new MergeError(`Enquiry not found or not yours: ${missing.join(', ')}`, 'NOT_FOUND', 404);
  }

  const byId = new Map(found.map(r => [String(r.id), r]));
  const keeper = byId.get(keeperId);
  if (!keeper) throw new MergeError('Keeper enquiry not found.', 'NOT_FOUND', 404);
  if (keeper['stage'] === 'MERGED' || keeper['merged_into_id'] != null) {
    throw new MergeError('The keeper enquiry is itself already merged.', 'VALIDATION_ERROR', 400);
  }

  for (const id of mergeSet) {
    const r = byId.get(id);
    if (!r) throw new MergeError(`Enquiry not found: ${id}`, 'NOT_FOUND', 404);
    if (r['stage'] === 'MERGED' || r['merged_into_id'] != null) {
      throw new MergeError('One of the selected enquiries is already merged.', 'VALIDATION_ERROR', 400);
    }
  }

  // Same person: identical last-7 phone key, and every row must carry a phone.
  const key = phoneKey(String(keeper['prospect_phone'] ?? ''));
  if (!key) {
    throw new MergeError('Keeper enquiry has no phone number — cannot verify it is the same person.', 'VALIDATION_ERROR', 400);
  }
  for (const id of mergeSet) {
    const k = phoneKey(String(byId.get(id)!.prospect_phone ?? ''));
    if (!k || k !== key) {
      throw new MergeError('Selected enquiries have different phone numbers (or one has none). Only same-number enquiries can be merged.', 'VALIDATION_ERROR', 400);
    }
  }

  // Same lead: identical unit (all-NULL counts as equal). Refuse cross-unit merges.
  const unit = keeper['unit_id'] ?? null;
  for (const id of mergeSet) {
    if ((byId.get(id)!['unit_id'] ?? null) !== unit) {
      throw new MergeError('Selected enquiries are for different units. Only same-unit duplicates should be merged — set the unit on the duplicates first, or merge manually.', 'VALIDATION_ERROR', 400);
    }
  }

  // Coalesce: keep the keeper's own value where present, else fill from the
  // merged rows in order (never overwrite the keeper's real data).
  const fill = (field: string, current: unknown): unknown => {
    if (current !== null && current !== undefined && current !== '') return current;
    for (const id of mergeSet) {
      const v = byId.get(id)![field];
      if (v !== null && v !== undefined && v !== '') return v;
    }
    return current;
  };

  const lastContact = [keeper, ...mergeSet.map(id => byId.get(id)!)]
    .map(r => new Date(String(r['last_contact_at'] ?? r['created_at'])))
    .filter(d => !isNaN(d.getTime()))
    .map(d => d.getTime())
    .sort((a, b) => b - a)[0];
  const lastContactIso = lastContact ? new Date(lastContact).toISOString() : null;

  await client.query(
    `UPDATE prop_enquiries SET
       prospect_name = $1, prospect_email = $2, initial_message = $3, notes = $4,
       screening_answers = $5, last_contact_at = $6
     WHERE id = $7 AND owner_id = $8`,
    [fill('prospect_name', keeper['prospect_name']),
     fill('prospect_email', keeper['prospect_email']),
     fill('initial_message', keeper['initial_message']),
     fill('notes', keeper['notes']),
     fill('screening_answers', keeper['screening_answers']),
     lastContactIso ?? keeper['last_contact_at'], keeperId, ownerId],
  );

  // Reassign every child record to the keeper. RLS (withOwnerRLS transaction)
  // scopes all four by owner; the explicit owner filter is belt-and-braces.
  const moved = async (sql: string): Promise<number> => {
    const { rows: [r] } = await client.query<{ n: string }>(sql, [keeperId, mergeSet, ownerId]);
    return Number(r?.n ?? 0);
  };

  const messages_moved  = await moved(
    `WITH m AS (UPDATE prop_whatsapp_messages SET enquiry_id = $1
                WHERE enquiry_id = ANY($2::uuid[]) AND owner_id = $3 RETURNING id)
     SELECT count(*)::int AS n FROM m`);
  const logs_moved      = await moved(
    `WITH m AS (UPDATE prop_contact_log SET enquiry_id = $1
                WHERE enquiry_id = ANY($2::uuid[]) AND owner_id = $3 RETURNING id)
     SELECT count(*)::int AS n FROM m`);
  const viewings_moved  = await moved(
    `WITH m AS (UPDATE prop_viewings SET enquiry_id = $1
                WHERE enquiry_id = ANY($2::uuid[]) AND owner_id = $3 RETURNING id)
     SELECT count(*)::int AS n FROM m`);
  const applications_moved = await moved(
    `WITH m AS (UPDATE prop_applications SET enquiry_id = $1
                WHERE enquiry_id = ANY($2::uuid[]) AND owner_id = $3 RETURNING id)
     SELECT count(*)::int AS n FROM m`);

  // Keep the merged-away rows, marked MERGED with a pointer to the keeper.
  const { rows: [merged] } = await client.query<{ n: string }>(
    `WITH m AS (UPDATE prop_enquiries SET stage = 'MERGED', merged_into_id = $1, last_contact_at = NOW()
                WHERE id = ANY($2::uuid[]) AND owner_id = $3 RETURNING id)
     SELECT count(*)::int AS n FROM m`,
    [keeperId, mergeSet, ownerId],
  );

  return {
    keeper_id: keeperId,
    messages_moved,
    logs_moved,
    viewings_moved,
    applications_moved,
    merged_rows: Number(merged?.n ?? 0),
  };
}

enquiriesRouter.post('/merge', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const body = MergeEnquiriesSchema.parse(req.body);

    const result = await withOwnerRLS(propertiesPool, ownerId, client =>
      mergeEnquiriesTx(client, ownerId, body.keeper_id, body.merge_ids));

    logger.info({
      entity: 'PROPERTIES', action: 'ENQUIRIES_MERGED', keeper_id: body.keeper_id,
      merged_rows: result.merged_rows, messages_moved: result.messages_moved, user_id: ownerId,
    });
    res.json(ok(result));
  } catch (e) {
    if (e instanceof MergeError) return void res.status(e.status).json(err(e.message, e.code));
    next(e);
  }
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
      // The thread belongs to the *person*, not the row: the WA inbox groups
      // messages by the last-7 phone key (from_number OR to_number), and some
      // messages were sent from the inbox panel or predate the enquiry, so they
      // carry no enquiry_id. Match the same way here or the Leasing thread
      // silently drops messages the Inbox shows — e.g. Brijhan's "Yes.
      // Confirmed. i tried calling you..." (2026-07-28) had enquiry_id = NULL
      // and was invisible in Enquiries. Fall back to enquiry_id only when the
      // enquiry has no phone to key on.
      const key = phoneKey(String(enquiry.prospect_phone ?? ''));
      const { rows: messages } = key
        ? await client.query(
            `SELECT * FROM prop_whatsapp_messages
             WHERE right(regexp_replace(coalesce(from_number, ''), '\D', '', 'g'), 7) = $1
                OR right(regexp_replace(coalesce(to_number, ''),   '\D', '', 'g'), 7) = $1
             ORDER BY created_at ASC`,
            [key],
          )
        : await client.query(
            `SELECT * FROM prop_whatsapp_messages WHERE enquiry_id = $1 ORDER BY created_at ASC`,
            [id],
          );
      logger.info({
        entity: 'PROPERTIES', action: 'ENQUIRY_DETAIL_DEBUG',
        enquiry_id: id, owner_id: ownerId, phone_key: key ?? null,
        messages_returned: messages.length, enquiry_stage: enquiry.stage,
      });
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
