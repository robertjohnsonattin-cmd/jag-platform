// GET    /api/v1/properties/handover/:unitId
// POST   /api/v1/properties/handover
// PATCH  /api/v1/properties/handover/:id
// GET    /api/v1/properties/handover/:id/compare

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { ok, err } from '../../lib/response';
import { logger } from '../../lib/logger';
import { sendTemplate } from '../../lib/whatsapp';
import { triggerAutoListing } from './listing';

export const handoverRouter = Router();

const IdParam     = z.object({ id: z.string().uuid() });
const UnitIdParam = z.object({ unitId: z.string().uuid() });

const ConditionItemSchema = z.object({
  item:       z.string(),
  condition:  z.string(),
  notes:      z.string().optional(),
  photo_urls: z.array(z.string()).optional(),
});

const InventoryItemSchema = z.object({
  item:      z.string(),
  qty:       z.number().int().min(0),
  condition: z.string().optional(),
  serial:    z.string().optional(),
});

const CreateHandoverSchema = z.object({
  unit_id:              z.string().uuid(),
  lease_id:             z.string().uuid().optional(),
  type:                 z.enum(['ENTRY','EXIT']),
  tec_meter_reading:    z.string().max(50).optional(),
  tec_account_number:   z.string().max(50).optional(),
  wasa_meter_reading:   z.string().max(50).optional(),
  wasa_account_number:  z.string().max(50).optional(),
  condition_items:      z.array(ConditionItemSchema).optional(),
  inventory_items:      z.array(InventoryItemSchema).optional(),
  keys_issued:          z.number().int().min(0).optional(),
  keys_returned:        z.number().int().min(0).optional(),
  gate_remotes_issued:  z.number().int().min(0).optional(),
  gate_remotes_returned: z.number().int().min(0).optional(),
  photo_urls:           z.array(z.string()).optional(),
  notes:                z.string().optional(),
}).strict();

const PatchHandoverSchema = z.object({
  tec_meter_reading:     z.string().max(50).nullable().optional(),
  wasa_meter_reading:    z.string().max(50).nullable().optional(),
  condition_items:       z.array(ConditionItemSchema).optional(),
  inventory_items:       z.array(InventoryItemSchema).optional(),
  keys_returned:         z.number().int().min(0).nullable().optional(),
  gate_remotes_returned: z.number().int().min(0).nullable().optional(),
  photo_urls:            z.array(z.string()).optional(),
  tenant_signed:         z.boolean().optional(),
  manager_signed:        z.boolean().optional(),
  notes:                 z.string().nullable().optional(),
  completed_at:          z.string().optional(),
}).strict();

handoverRouter.get('/unit/:unitId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { unitId } = UnitIdParam.parse(req.params);

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: r } = await client.query(
        `SELECT * FROM prop_handover_checklists WHERE unit_id = $1 AND owner_id = $2 ORDER BY created_at DESC`,
        [unitId, ownerId],
      );
      return r;
    });
    res.json(ok(rows));
  } catch (e) { next(e); }
});

handoverRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const body = CreateHandoverSchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `INSERT INTO prop_handover_checklists
           (owner_id, unit_id, lease_id, type,
            tec_meter_reading, tec_account_number, wasa_meter_reading, wasa_account_number,
            condition_items, inventory_items,
            keys_issued, keys_returned, gate_remotes_issued, gate_remotes_returned,
            photo_urls, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [ownerId, body.unit_id, body.lease_id ?? null, body.type,
         body.tec_meter_reading ?? null, body.tec_account_number ?? null,
         body.wasa_meter_reading ?? null, body.wasa_account_number ?? null,
         JSON.stringify(body.condition_items ?? []),
         JSON.stringify(body.inventory_items ?? []),
         body.keys_issued ?? 0, body.keys_returned ?? null,
         body.gate_remotes_issued ?? 0, body.gate_remotes_returned ?? null,
         JSON.stringify(body.photo_urls ?? []),
         body.notes ?? null],
      );
      return rows[0];
    });
    res.status(201).json(ok(row));
  } catch (e) { next(e); }
});

handoverRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = PatchHandoverSchema.parse(req.body);
    if (Object.keys(body).length === 0) return void res.status(400).json(err('No fields to update', 'VALIDATION_ERROR'));

    const sets: string[] = [];
    const vals: unknown[] = [];
    const jsonFields = new Set(['condition_items', 'inventory_items', 'photo_urls']);

    for (const [k, v] of Object.entries(body)) {
      const val = jsonFields.has(k) ? JSON.stringify(v) : v;
      if (k === 'tenant_signed' && v === true) {
        vals.push(val); sets.push(`${k} = $${vals.length}`);
        sets.push(`tenant_signed_at = NOW()`);
      } else if (k === 'manager_signed' && v === true) {
        vals.push(val); sets.push(`${k} = $${vals.length}`);
        sets.push(`manager_signed_at = NOW()`);
      } else {
        vals.push(val); sets.push(`${k} = $${vals.length}`);
      }
    }
    vals.push(id); vals.push(ownerId);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_handover_checklists SET ${sets.join(', ')}
         WHERE id = $${vals.length - 1} AND owner_id = $${vals.length} RETURNING *`,
        vals,
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Checklist not found', 'NOT_FOUND'));

    // Auto-list unit when EXIT handover is signed off — fires jag_adv_new_listing to past enquirers
    if (body.completed_at && row.type === 'EXIT') {
      triggerAutoListing(ownerId, String(row.unit_id)).catch(e =>
        logger.warn({ entity: 'PROPERTIES', action: 'AUTO_LIST_FAILED', unit_id: row.unit_id, error_message: (e as Error).message }),
      );
    }

    // JAG_ONB_003 — welcome pack on ENTRY handover completion
    if (body.completed_at && row.type === 'ENTRY') {
      const lease = await withOwnerRLS(propertiesPool, ownerId, async client => {
        const { rows: [la] } = await client.query(
          `SELECT la.tenant_phone, la.tenant_name, la.rent_amount_ttd,
                  u.unit_number, p.name AS property_name
           FROM prop_lease_agreements la
           JOIN prop_units u ON u.id = la.unit_id
           LEFT JOIN prop_properties p ON p.id = u.property_id
           WHERE la.unit_id = $1 AND la.status = 'ACTIVE' LIMIT 1`,
          [row.unit_id],
        );
        return la ?? null;
      });
      if (lease?.tenant_phone) {
        const mgr   = process.env.JAG_MANAGER_NAME ?? 'Robert';
        const phone = process.env.JAG_MANAGER_PHONE ?? process.env.JAG_OWNER_PHONE ?? '';
        const bank  = process.env.JAG_BANK_NAME ?? 'First Citizens Bank';
        const acct  = process.env.JAG_BANK_ACCOUNT_NO ?? '';
        sendTemplate({
          to: lease.tenant_phone,
          templateName: 'jag_onb_welcome_pack',
          components: [{ type: 'body', parameters: [
            { type: 'text', text: lease.tenant_name ?? 'Tenant' },
            { type: 'text', text: lease.property_name ?? '' },
            { type: 'text', text: lease.unit_number ?? '' },
            { type: 'text', text: `TTD $${parseFloat(String(lease.rent_amount_ttd ?? 0)).toFixed(2)}` },
            { type: 'text', text: bank },
            { type: 'text', text: acct },
            { type: 'text', text: lease.unit_number ?? '' },
            { type: 'text', text: mgr },
            { type: 'text', text: phone },
          ]}],
        }).catch(e => logger.warn({ entity: 'PROPERTIES', action: 'WA_WELCOME_PACK_FAILED', error_message: (e as Error).message }));
      }
    }

    res.json(ok(row));
  } catch (e) { next(e); }
});

handoverRouter.get('/:id/compare', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const data = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [exit_checklist] } = await client.query(
        `SELECT * FROM prop_handover_checklists WHERE id = $1 AND owner_id = $2 AND type = 'EXIT'`,
        [id, ownerId],
      );
      if (!exit_checklist) return null;
      const { rows: [entry_checklist] } = await client.query(
        `SELECT * FROM prop_handover_checklists
         WHERE unit_id = $1 AND owner_id = $2 AND type = 'ENTRY' AND lease_id = $3
         ORDER BY created_at ASC LIMIT 1`,
        [exit_checklist.unit_id, ownerId, exit_checklist.lease_id],
      );
      return { entry: entry_checklist ?? null, exit: exit_checklist };
    });
    if (!data) return void res.status(404).json(err('Exit checklist not found', 'NOT_FOUND'));
    res.json(ok(data));
  } catch (e) { next(e); }
});
