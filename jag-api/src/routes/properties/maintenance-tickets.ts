// GET    /api/v1/properties/maintenance          — list tickets
// POST   /api/v1/properties/maintenance          — create ticket
// GET    /api/v1/properties/maintenance/:id      — get ticket + updates
// PATCH  /api/v1/properties/maintenance/:id      — update status/contractor/notes
// POST   /api/v1/properties/maintenance/:id/resolve
// POST   /api/v1/properties/maintenance/:id/satisfaction
// GET    /api/v1/properties/contractors
// POST   /api/v1/properties/contractors
// PATCH  /api/v1/properties/contractors/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { sendTemplate } from '../../lib/whatsapp';
import { enqueueNotification } from '../../lib/notifications';

export const maintenanceTicketsRouter = Router();
export const contractorsRouter        = Router();

const IdParam = z.object({ id: z.string().uuid() });

const CategoryEnum  = z.enum(['PLUMBING','ELECTRICAL','STRUCTURAL','PEST','APPLIANCE','OTHER']);
const PriorityEnum  = z.enum(['P1','P2','P3','P4']);
const TicketStatusEnum = z.enum(['OPEN','ASSIGNED','IN_PROGRESS','PENDING_PARTS','RESOLVED','CLOSED','CANCELLED']);
const ChannelEnum   = z.enum(['WHATSAPP','SMS','PORTAL','PHONE','EMAIL']);
const TradeEnum     = z.enum(['PLUMBING','ELECTRICAL','STRUCTURAL','PEST_CONTROL','APPLIANCE','PAINTING','GENERAL','OTHER']);

const P1_KEYWORDS = ['flood','flooding','burst pipe','fire','no power','no electricity','power cut','break-in','break in','gas leak','roof collapse','no water','sewage','sewerage overflow'];
const P2_KEYWORDS = ['leak','leaking','broken','not working','stuck','blocked drain','no hot water','pest','rats','roaches','ac not working'];

function suggestPriority(description: string): 'P1' | 'P2' | 'P3' {
  const lower = description.toLowerCase();
  if (P1_KEYWORDS.some(k => lower.includes(k))) return 'P1';
  if (P2_KEYWORDS.some(k => lower.includes(k))) return 'P2';
  return 'P3';
}

function slaHours(priority: string): number | null {
  switch (priority) {
    case 'P1': return 2;
    case 'P2': return 24;
    case 'P3': return 120;
    default:   return null;
  }
}

const CreateTicketSchema = z.object({
  unit_id:            z.string().uuid(),
  property_id:        z.string().uuid().optional(),
  lease_id:           z.string().uuid().optional(),
  reported_by_name:   z.string().max(200).optional(),
  reported_by_phone:  z.string().max(30).optional(),
  report_channel:     ChannelEnum.optional(),
  category:           CategoryEnum,
  description:        z.string().min(1),
  photo_urls:         z.array(z.string()).optional(),
  priority:           PriorityEnum.optional(),
}).strict();

const PatchTicketSchema = z.object({
  status:               TicketStatusEnum.optional(),
  priority:             PriorityEnum.optional(),
  contractor_id:        z.string().uuid().nullable().optional(),
  estimated_visit_at:   z.string().nullable().optional(),
  notes:                z.string().nullable().optional(),
}).strict();

const ResolveSchema = z.object({
  resolution_notes:       z.string().min(1),
  completion_photo_urls:  z.array(z.string()).optional(),
  cost_ttd:               z.number().positive().optional(),
}).strict();

const SatisfactionSchema = z.object({
  tenant_satisfied: z.boolean(),
  tenant_feedback:  z.string().optional(),
}).strict();

const CreateContractorSchema = z.object({
  name:             z.string().min(1).max(200),
  trade:            TradeEnum,
  phone:            z.string().max(30).optional(),
  whatsapp:         z.string().max(30).optional(),
  email:            z.string().email().optional(),
  rate_description: z.string().optional(),
  notes:            z.string().optional(),
  crm_contact_id:   z.string().uuid().nullable().optional(),
}).strict();

const PatchContractorSchema = z.object({
  name:             z.string().min(1).max(200).optional(),
  trade:            TradeEnum.optional(),
  phone:            z.string().max(30).nullable().optional(),
  whatsapp:         z.string().max(30).nullable().optional(),
  email:            z.string().email().nullable().optional(),
  rate_description: z.string().nullable().optional(),
  is_active:        z.boolean().optional(),
  notes:            z.string().nullable().optional(),
  crm_contact_id:   z.string().uuid().nullable().optional(),
}).strict();

// ── Batch: SLA breach detector ────────────────────────────────────────────────
maintenanceTicketsRouter.post('/check-sla', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const SLA_HOURS: Record<string, number> = { P1: 2, P2: 24, P3: 120 };

    const { newlyBreached, totalBreached } = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: tickets } = await client.query<Record<string, unknown>>(
        `SELECT t.id, t.priority, t.created_at, t.sla_breached, t.ticket_ref, u.unit_number
         FROM prop_maintenance_tickets t
         JOIN prop_units u ON u.id = t.unit_id
         WHERE t.owner_id = $1 AND t.status IN ('OPEN','ASSIGNED','IN_PROGRESS','PENDING_PARTS')
           AND t.priority IN ('P1','P2','P3')`,
        [ownerId],
      );

      let newlyBreached = 0;
      let totalBreached = 0;

      for (const tk of tickets) {
        const slaHours = SLA_HOURS[String(tk['priority'] ?? '')] ?? null;
        if (!slaHours) continue;
        const createdAt = new Date(String(tk['created_at']));
        const elapsedHours = (Date.now() - createdAt.getTime()) / 3_600_000;
        if (elapsedHours >= slaHours) {
          totalBreached++;
          if (!tk['sla_breached']) {
            await client.query(`UPDATE prop_maintenance_tickets SET sla_breached = true WHERE id = $1`, [tk['id']]);
            await client.query(
              `INSERT INTO prop_ticket_updates (ticket_id, owner_id, note) VALUES ($1,$2,'SLA breach auto-detected')`,
              [tk['id'], ownerId],
            );
            // JAG_MNT_005 — SLA breach owner notification
            const ownerPhone = process.env.JAG_OWNER_PHONE;
            if (ownerPhone) {
              sendTemplate({
                to: ownerPhone,
                templateName: 'jag_mnt_sla_breach',
                components: [{ type: 'body', parameters: [
                  { type: 'text', text: String(tk['ticket_ref'] ?? tk['id']) },
                  { type: 'text', text: String(tk['priority'] ?? '') },
                  { type: 'text', text: `${Math.round(elapsedHours)}h` },
                  { type: 'text', text: String(SLA_HOURS[String(tk['priority'])] ?? '?') + 'h' },
                  { type: 'text', text: String(tk['unit_number'] ?? '') },
                ]}],
              }).catch(() => { /* non-fatal */ });
            }
            // Owner in-app notification — SLA breach (non-blocking).
            void enqueueNotification({
              tier: 1,
              title: 'Maintenance SLA breach',
              body: `Ticket ${String(tk['ticket_ref'] ?? tk['id'])} (${String(tk['priority'] ?? '')}) at unit ${String(tk['unit_number'] ?? '—')} has breached its SLA.`,
              payload: { module: 'PROPERTIES', kind: 'MAINTENANCE_SLA', ticket_id: tk['id'] },
            });
            newlyBreached++;
          }
        }
      }
      return { newlyBreached, totalBreached };
    });

    res.json(ok({ newly_breached: newlyBreached, total_breached: totalBreached }));
  } catch (e) { next(e); }
});

// ── Tickets ───────────────────────────────────────────────────────────────────

maintenanceTicketsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const unitId   = req.query['unit_id'] as string | undefined;
    const status   = req.query['status'] as string | undefined;
    const priority = req.query['priority'] as string | undefined;

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const conds: string[] = [];
      const vals: unknown[] = [ownerId];
      if (unitId)   { vals.push(unitId);   conds.push(`t.unit_id = $${vals.length}`); }
      if (status)   { vals.push(status);   conds.push(`t.status = $${vals.length}`); }
      if (priority) { vals.push(priority); conds.push(`t.priority = $${vals.length}`); }
      const where = conds.length ? ' AND ' + conds.join(' AND ') : '';
      const { rows: r } = await client.query(
        `SELECT t.*, u.unit_number, p.name AS property_name, c.name AS contractor_name
         FROM prop_maintenance_tickets t
         JOIN prop_units u ON u.id = t.unit_id
         LEFT JOIN prop_properties p ON p.id = t.property_id
         LEFT JOIN prop_contractors c ON c.id = t.contractor_id
         WHERE t.owner_id = $1${where}
         ORDER BY t.created_at DESC LIMIT 500`,
        vals,
      );
      return r;
    });
    res.json(ok(rows));
  } catch (e) { next(e); }
});

maintenanceTicketsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const body = CreateTicketSchema.parse(req.body);

    const autoSuggested = suggestPriority(body.description);
    const priority = body.priority ?? autoSuggested;
    const sla = slaHours(priority);
    const slaBreachAt = sla ? new Date(Date.now() + sla * 3_600_000) : null;

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [cnt] } = await client.query(
        `SELECT COUNT(*) FROM prop_maintenance_tickets WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())`,
      );
      const seq = String(parseInt(cnt.count) + 1).padStart(4, '0');
      const ticketRef = `MNT-${new Date().getFullYear()}-${seq}`;

      const { rows } = await client.query(
        `INSERT INTO prop_maintenance_tickets
           (owner_id, unit_id, property_id, lease_id, ticket_ref,
            reported_by_name, reported_by_phone, report_channel,
            category, description, photo_urls,
            priority, priority_auto_suggested, sla_hours, sla_breach_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [ownerId, body.unit_id, body.property_id ?? null, body.lease_id ?? null, ticketRef,
         body.reported_by_name ?? null, body.reported_by_phone ?? null, body.report_channel ?? null,
         body.category, body.description, JSON.stringify(body.photo_urls ?? []),
         priority, autoSuggested, sla, slaBreachAt],
      );
      return rows[0];
    });

    if (body.reported_by_phone) {
      try {
        await sendTemplate({
          to: body.reported_by_phone,
          templateName: 'jag_mnt_ticket_ack',
          components: [{ type: 'body', parameters: [
            { type: 'text', text: body.reported_by_name ?? 'Tenant' },
            { type: 'text', text: row.ticket_ref },
            { type: 'text', text: body.category },
            { type: 'text', text: priority },
            { type: 'text', text: sla ? `${sla}h` : 'N/A' },
          ]}],
        });
        await withOwnerRLS(propertiesPool, ownerId, async client => {
          await client.query(
            `UPDATE prop_maintenance_tickets SET ack_sent_at = NOW() WHERE id = $1`, [row.id],
          );
        });
      } catch (e) {
        logger.warn({ entity: 'PROPERTIES', action: 'TICKET_ACK_FAILED', error_message: (e as Error).message });
      }
    }

    logger.info({ entity: 'PROPERTIES', action: 'TICKET_CREATED', record_id: row.id, ticket_ref: row.ticket_ref, user_id: ownerId });

    // Owner in-app notification — urgent (P1/P2) tickets only (non-blocking).
    if (priority === 'P1' || priority === 'P2') {
      void enqueueNotification({
        tier: 1,
        title: 'Urgent maintenance ticket',
        body: `${priority} — ${body.category}: ${body.description} (${row.ticket_ref})`,
        payload: { module: 'PROPERTIES', kind: 'MAINTENANCE', ticket_id: row.id },
      });
    }

    res.status(201).json(ok(row));
  } catch (e) { next(e); }
});

maintenanceTicketsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const data = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [ticket] } = await client.query(
        `SELECT t.*, u.unit_number, p.name AS property_name, c.name AS contractor_name, c.phone AS contractor_phone
         FROM prop_maintenance_tickets t
         JOIN prop_units u ON u.id = t.unit_id
         LEFT JOIN prop_properties p ON p.id = t.property_id
         LEFT JOIN prop_contractors c ON c.id = t.contractor_id
         WHERE t.id = $1 AND t.owner_id = $2`,
        [id, ownerId],
      );
      if (!ticket) return null;
      const { rows: updates } = await client.query(
        `SELECT * FROM prop_ticket_updates WHERE ticket_id = $1 ORDER BY created_at ASC`,
        [id],
      );
      return { ...ticket, updates };
    });
    if (!data) return void res.status(404).json(err('Ticket not found', 'NOT_FOUND'));
    res.json(ok(data));
  } catch (e) { next(e); }
});

maintenanceTicketsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = PatchTicketSchema.parse(req.body);
    if (Object.keys(body).length === 0) return void res.status(400).json(err('No fields to update', 'VALIDATION_ERROR'));

    let prevStatus: string | undefined;
    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [existing] } = await client.query(
        `SELECT status FROM prop_maintenance_tickets WHERE id = $1 AND owner_id = $2`, [id, ownerId],
      );
      if (!existing) return null;
      prevStatus = String(existing.status);

      const sets: string[] = ['last_updated_at = NOW()'];
      const vals: unknown[] = [];
      for (const [k, v] of Object.entries(body)) {
        vals.push(v); sets.push(`${k} = $${vals.length}`);
      }
      if (body.contractor_id !== undefined) {
        sets.push(`contractor_notified_at = NOW()`);
        if (body.status === undefined || body.status === 'OPEN') {
          sets.push(`status = 'ASSIGNED'`);
        }
      }
      vals.push(id); vals.push(ownerId);

      const { rows } = await client.query(
        `UPDATE prop_maintenance_tickets SET ${sets.join(', ')}
         WHERE id = $${vals.length - 1} AND owner_id = $${vals.length} RETURNING *`,
        vals,
      );
      const updated = rows[0];
      if (body.status && body.status !== existing.status) {
        await client.query(
          `INSERT INTO prop_ticket_updates (owner_id, ticket_id, status_from, status_to, updated_by)
           VALUES ($1,$2,$3,$4,$5)`,
          [ownerId, id, existing.status, body.status, ownerId],
        );
      }
      return updated;
    });
    if (!row) return void res.status(404).json(err('Ticket not found', 'NOT_FOUND'));

    // JAG_MNT_002 — contractor assigned notification to tenant
    if (body.contractor_id && row.reported_by_phone) {
      const contractor = await withOwnerRLS(propertiesPool, ownerId, async client => {
        const { rows: [c] } = await client.query(
          `SELECT name, phone FROM prop_contractors WHERE id = $1 AND owner_id = $2`, [body.contractor_id, ownerId],
        );
        return c ?? null;
      });
      if (contractor) {
        const visitTime = body.estimated_visit_at
          ? new Date(String(body.estimated_visit_at)).toLocaleString('en-TT')
          : 'To be confirmed';
        sendTemplate({
          to: String(row.reported_by_phone),
          templateName: 'jag_mnt_contractor_assigned',
          components: [{ type: 'body', parameters: [
            { type: 'text', text: String(row.reported_by_name ?? 'Tenant') },
            { type: 'text', text: String(row.ticket_ref) },
            { type: 'text', text: String(contractor.name) },
            { type: 'text', text: visitTime },
            { type: 'text', text: process.env.JAG_MANAGER_PHONE ?? '' },
          ]}],
        }).catch(e => logger.warn({ entity: 'PROPERTIES', action: 'WA_CONTRACTOR_NOTIF_FAILED', error_message: (e as Error).message }));
      }
    }

    // JAG_MNT_003 — status update notification to tenant (fires on every status change except RESOLVED, which has its own /resolve endpoint)
    if (body.status && prevStatus && body.status !== prevStatus && body.status !== 'RESOLVED' && row.reported_by_phone) {
      const STATUS_MAP: Record<string, [string, string]> = {
        ASSIGNED:      ['Assigned', 'A technician has been assigned to your request.'],
        IN_PROGRESS:   ['In Progress', 'Work on your issue is now underway.'],
        PENDING_PARTS: ['Pending Parts', 'We are waiting on parts or materials and will update you once they arrive.'],
        ON_HOLD:       ['On Hold', 'Your request is currently on hold. We will contact you shortly.'],
      };
      const [statusLabel, updateText] = STATUS_MAP[String(body.status)] ?? [String(body.status).replace(/_/g, ' '), 'Your ticket has been updated.'];
      const unitNum = await withOwnerRLS(propertiesPool, ownerId, async client => {
        const { rows: [u] } = await client.query(
          `SELECT unit_number FROM prop_units WHERE id = $1 AND owner_id = $2`, [row.unit_id, ownerId],
        );
        return u?.unit_number ?? '';
      }).catch(() => '');
      sendTemplate({
        to: String(row.reported_by_phone),
        templateName: 'jag_mnt_status_update',
        components: [{ type: 'body', parameters: [
          { type: 'text', text: String(row.reported_by_name ?? 'Tenant') },
          { type: 'text', text: String(row.ticket_ref) },
          { type: 'text', text: String(row.category ?? '') },
          { type: 'text', text: String(unitNum) },
          { type: 'text', text: statusLabel },
          { type: 'text', text: updateText },
          { type: 'text', text: process.env.JAG_MANAGER_PHONE ?? '' },
        ]}],
      }).catch(e => logger.warn({ entity: 'PROPERTIES', action: 'WA_STATUS_UPDATE_FAILED', error_message: (e as Error).message }));
    }

    res.json(ok(row));
  } catch (e) { next(e); }
});

maintenanceTicketsRouter.post('/:id/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = ResolveSchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_maintenance_tickets
         SET status = 'RESOLVED', resolution_notes = $1, completion_photo_urls = $2,
             cost_ttd = $3, resolved_at = NOW(), last_updated_at = NOW()
         WHERE id = $4 AND owner_id = $5 RETURNING *`,
        [body.resolution_notes, JSON.stringify(body.completion_photo_urls ?? []),
         body.cost_ttd ?? null, id, ownerId],
      );
      if (rows[0]) {
        await client.query(
          `INSERT INTO prop_ticket_updates (owner_id, ticket_id, status_from, status_to, note, updated_by)
           VALUES ($1,$2,'IN_PROGRESS','RESOLVED',$3,$4)`,
          [ownerId, id, body.resolution_notes, ownerId],
        );
      }
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Ticket not found', 'NOT_FOUND'));

    if (row.reported_by_phone) {
      try {
        await sendTemplate({ to: row.reported_by_phone, templateName: 'jag_mnt_resolved_check',
          components: [{ type: 'body', parameters: [
            { type: 'text', text: row.reported_by_name ?? 'Tenant' },
            { type: 'text', text: row.ticket_ref },
          ]}] });
      } catch { /* non-fatal */ }
    }
    res.json(ok(row));
  } catch (e) { next(e); }
});

maintenanceTicketsRouter.post('/:id/satisfaction', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = SatisfactionSchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_maintenance_tickets SET tenant_satisfied = $1, tenant_feedback = $2
         WHERE id = $3 AND owner_id = $4 RETURNING *`,
        [body.tenant_satisfied, body.tenant_feedback ?? null, id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Ticket not found', 'NOT_FOUND'));
    res.json(ok(row));
  } catch (e) { next(e); }
});

// ── Contractors ───────────────────────────────────────────────────────────────

contractorsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: r } = await client.query(
        `SELECT * FROM prop_contractors WHERE owner_id = $1 ORDER BY name ASC`, [ownerId],
      );
      return r;
    });
    res.json(ok(rows));
  } catch (e) { next(e); }
});

contractorsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const body = CreateContractorSchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `INSERT INTO prop_contractors (owner_id, name, trade, phone, whatsapp, email, rate_description, notes, crm_contact_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [ownerId, body.name, body.trade, body.phone ?? null, body.whatsapp ?? null,
         body.email ?? null, body.rate_description ?? null, body.notes ?? null, body.crm_contact_id ?? null],
      );
      return rows[0];
    });
    res.status(201).json(ok(row));
  } catch (e) { next(e); }
});

contractorsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = PatchContractorSchema.parse(req.body);
    if (Object.keys(body).length === 0) return void res.status(400).json(err('No fields to update', 'VALIDATION_ERROR'));

    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      vals.push(v); sets.push(`${k} = $${vals.length}`);
    }
    vals.push(id); vals.push(ownerId);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_contractors SET ${sets.join(', ')}
         WHERE id = $${vals.length - 1} AND owner_id = $${vals.length} RETURNING *`,
        vals,
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Contractor not found', 'NOT_FOUND'));
    res.json(ok(row));
  } catch (e) { next(e); }
});
