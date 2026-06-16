// GET    /api/v1/properties/renewals
// POST   /api/v1/properties/renewals
// PATCH  /api/v1/properties/renewals/:id
// POST   /api/v1/properties/renewals/:id/renew
// POST   /api/v1/properties/renewals/:id/vacate

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { sendTemplate } from '../../lib/whatsapp';
import { generateRentSchedule } from './rent-schedule';

export const renewalsRouter = Router();

const IdParam = z.object({ id: z.string().uuid() });

const CreateRenewalSchema = z.object({
  lease_id: z.string().uuid(),
  unit_id:  z.string().uuid(),
  notes:    z.string().optional(),
}).strict();

const PatchRenewalSchema = z.object({
  tenant_response:  z.enum(['RENEWING','VACATING','DISCUSSING','NO_RESPONSE']).optional(),
  new_rent_ttd:     z.number().positive().optional(),
  vacating_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:            z.string().nullable().optional(),
}).strict();

const RenewSchema = z.object({
  new_rent_ttd:  z.number().positive(),
  new_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  new_end_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

const VacateSchema = z.object({
  vacating_date:                  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  exit_inspection_scheduled_at:   z.string().optional(),
}).strict();

renewalsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: r } = await client.query(
        `SELECT rn.*, l.end_date AS lease_end_date, l.rent_amount_ttd,
                u.unit_number, p.name AS property_name,
                (l.end_date - CURRENT_DATE) AS days_remaining
         FROM prop_renewal_notices rn
         JOIN prop_lease_agreements l ON l.id = rn.lease_id
         JOIN prop_units u ON u.id = rn.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE rn.owner_id = $1
         ORDER BY l.end_date ASC LIMIT 200`,
        [ownerId],
      );
      return r;
    });
    res.json(ok(rows));
  } catch (e) { next(e); }
});

// ── Batch: send D-60/D-30/D-14 renewal notices ───────────────────────────────
renewalsRouter.post('/send-notices', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const MILESTONES: Record<number, 'd60_sent_at' | 'd30_sent_at' | 'd14_sent_at'> = { 60: 'd60_sent_at', 30: 'd30_sent_at', 14: 'd14_sent_at' };
    const counts: Record<string, number> = { d60: 0, d30: 0, d14: 0 };

    for (const [days, col] of Object.entries(MILESTONES)) {
      const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
        const { rows } = await client.query<Record<string, unknown>>(
          `SELECT rn.id, rn.tenant_phone, rn.tenant_name,
                  EXTRACT(DAY FROM (l.end_date - CURRENT_DATE))::int AS days_remaining
           FROM prop_renewal_notices rn
           JOIN prop_lease_agreements l ON l.id = rn.lease_id
           WHERE rn.owner_id = $1
             AND rn.${col} IS NULL
             AND EXTRACT(DAY FROM (l.end_date - CURRENT_DATE)) BETWEEN $2 - 1 AND $2 + 1`,
          [ownerId, days],
        );
        return rows;
      });

      const key = `d${days}`;
      for (const row of rows) {
        if (!row['tenant_phone']) continue;
        try {
          await sendTemplate({
            to: String(row['tenant_phone']),
            templateName: 'lease_renewal_notice',
            languageCode: 'en',
            components: [{ type: 'body', parameters: [
              { type: 'text', text: String(row['tenant_name'] ?? '') },
              { type: 'text', text: String(days) },
            ]}],
          });
          await withOwnerRLS(propertiesPool, ownerId, async client => {
            await client.query(`UPDATE prop_renewal_notices SET ${col} = NOW() WHERE id = $1`, [row['id']]);
          });
          counts[key] = (counts[key] ?? 0) + 1;
        } catch { /* skip on WA error */ }
      }
    }

    res.json(ok({ d60_sent: counts['d60'] ?? 0, d30_sent: counts['d30'] ?? 0, d14_sent: counts['d14'] ?? 0 }));
  } catch (e) { next(e); }
});

renewalsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const body = CreateRenewalSchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `INSERT INTO prop_renewal_notices (owner_id, lease_id, unit_id, notes, notice_sent_at, d60_sent_at)
         VALUES ($1,$2,$3,$4,NOW(),NOW()) RETURNING *`,
        [ownerId, body.lease_id, body.unit_id, body.notes ?? null],
      );
      return rows[0];
    });
    logger.info({ entity: 'PROPERTIES', action: 'RENEWAL_NOTICE_CREATED', record_id: row.id, user_id: ownerId });
    res.status(201).json(ok(row));
  } catch (e) { next(e); }
});

renewalsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = PatchRenewalSchema.parse(req.body);
    if (Object.keys(body).length === 0) return void res.status(400).json(err('No fields to update', 'VALIDATION_ERROR'));

    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      vals.push(v); sets.push(`${k} = $${vals.length}`);
    }
    if (body.tenant_response !== undefined) {
      sets.push('tenant_responded_at = NOW()');
    }
    vals.push(id); vals.push(ownerId);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_renewal_notices SET ${sets.join(', ')}
         WHERE id = $${vals.length - 1} AND owner_id = $${vals.length} RETURNING *`,
        vals,
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Renewal notice not found', 'NOT_FOUND'));
    res.json(ok(row));
  } catch (e) { next(e); }
});

renewalsRouter.post('/:id/renew', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = RenewSchema.parse(req.body);

    const result = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [notice] } = await client.query(
        `SELECT rn.*, l.unit_id, l.tenant_name, l.tenant_email, l.tenant_phone
         FROM prop_renewal_notices rn
         JOIN prop_lease_agreements l ON l.id = rn.lease_id
         WHERE rn.id = $1 AND rn.owner_id = $2`,
        [id, ownerId],
      );
      if (!notice) return null;

      const { rows: [newLease] } = await client.query(
        `INSERT INTO prop_lease_agreements
           (owner_id, unit_id, property_id, tenant_name, tenant_email, tenant_phone,
            start_date, end_date, rent_amount_ttd, status)
         SELECT owner_id, unit_id, property_id, tenant_name, tenant_email, tenant_phone,
                $1, $2, $3, 'ACTIVE'
         FROM prop_lease_agreements WHERE id = $4
         RETURNING *`,
        [body.new_start_date, body.new_end_date, body.new_rent_ttd, notice.lease_id],
      );

      await client.query(
        `UPDATE prop_renewal_notices SET new_lease_id = $1, tenant_response = 'RENEWING' WHERE id = $2`,
        [newLease.id, id],
      );
      await client.query(
        `UPDATE prop_lease_agreements SET status = 'EXPIRED' WHERE id = $1`, [notice.lease_id],
      );
      return { new_lease: newLease, notice_id: id };
    });

    if (!result) return void res.status(404).json(err('Renewal notice not found', 'NOT_FOUND'));
    await generateRentSchedule(ownerId, result.new_lease.id);
    res.json(ok(result));
  } catch (e) { next(e); }
});

renewalsRouter.post('/:id/vacate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = VacateSchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_renewal_notices
         SET tenant_response = 'VACATING', vacating_date = $1,
             exit_inspection_scheduled_at = $2, tenant_responded_at = NOW()
         WHERE id = $3 AND owner_id = $4 RETURNING *`,
        [body.vacating_date, body.exit_inspection_scheduled_at ?? null, id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Renewal notice not found', 'NOT_FOUND'));
    res.json(ok(row));
  } catch (e) { next(e); }
});
