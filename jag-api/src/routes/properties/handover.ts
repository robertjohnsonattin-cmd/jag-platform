// GET    /api/v1/properties/handover/:unitId
// POST   /api/v1/properties/handover
// PATCH  /api/v1/properties/handover/:id
// GET    /api/v1/properties/handover/:id/compare

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { ok, err } from '../../lib/response';

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
