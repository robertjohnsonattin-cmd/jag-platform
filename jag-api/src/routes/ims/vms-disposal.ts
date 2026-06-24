// VMS Increment 4 — Disposal Workflow
//
// Captures financial snapshot at disposal date, optionally posts a balanced
// GL journal entry to jag_family, then marks the vehicle DISPOSED.
//
// GET  /api/v1/ims/vehicles/:id/disposal
// POST /api/v1/ims/vehicles/:id/dispose

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS, withOwnerRLS, type RLSContext } from '../../middleware/rls';
import { commercialPool, familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const vmsDisposalRouter = Router();

const UUIDParam = z.object({ id: z.string().uuid() });

const OWNER_ENTITY_MAP: Record<string, string> = {
  'JAG Holdings':      '00000000-0000-0000-0001-000000000001',
  'JABCO':             '00000000-0000-0000-0001-000000000002',
  'JAG Properties':    '00000000-0000-0000-0001-000000000003',
  'JAG Entertainment': '00000000-0000-0000-0001-000000000004',
  'JAG Finance':       '00000000-0000-0000-0001-000000000005',
  'Personal — Robert': '00000000-0000-0000-0001-000000000008',
  'Personal — Brian':  '00000000-0000-0000-0001-000000000011',
};

const DisposalSchema = z.object({
  disposal_type:         z.enum(['SALE', 'WRITE_OFF', 'TRANSFER']),
  disposal_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sale_price_ttd:        z.number().min(0).optional(),
  buyer_name:            z.string().max(200).optional(),
  final_mileage_km:      z.number().int().min(0).optional(),
  final_engine_hours:    z.number().min(0).optional(),
  notes:                 z.string().max(5000).optional(),
  // Optional GL accounts — if all required fields present, a JE is auto-posted
  vehicle_asset_gl_account_id: z.string().uuid().optional(),
  acc_dep_gl_account_id:       z.string().uuid().optional(),
  proceeds_gl_account_id:      z.string().uuid().optional(), // SALE only
  gain_gl_account_id:          z.string().uuid().optional(), // SALE with gain
  loss_gl_account_id:          z.string().uuid().optional(), // SALE with loss / WRITE_OFF
}).strict().superRefine((d, ctx) => {
  if (d.disposal_type === 'SALE' && (d.sale_price_ttd === undefined || d.sale_price_ttd === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'sale_price_ttd is required for SALE disposals.', path: ['sale_price_ttd'] });
  }
});

// ── GET /vehicles/:id/disposal ────────────────────────────────────────────────

vmsDisposalRouter.get('/:id/disposal', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }

    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT d.*, v.registration_number, i.name AS vehicle_name
           FROM   vms_disposals d
           JOIN   ims_vehicles v ON v.id = d.vehicle_id
           JOIN   ims_items    i ON i.id = v.item_id
           WHERE  d.vehicle_id = $1`,
          [idP.data.id],
        ).then(r => r.rows[0] ?? null),
      );

      if (!row) { res.status(404).json(err('No disposal record found for this vehicle.', 'NOT_FOUND')); return; }
      res.json(ok(row));
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /vehicles/:id/dispose ────────────────────────────────────────────────

vmsDisposalRouter.post('/:id/dispose', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP   = UUIDParam.safeParse(req.params);
    if (!idP.success) { res.status(422).json(err('ID must be a valid UUID.', 'VALIDATION_ERROR')); return; }
    const bodyP = DisposalSchema.safeParse(req.body);
    if (!bodyP.success) { res.status(422).json(err('Request body validation failed.', 'VALIDATION_ERROR')); return; }

    const vehicleId = idP.data.id;
    const b         = bodyP.data;
    const { tenantId, userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const disposal = await withTenantRLS(client, req.rlsCtx, async (c) => {

        // ── 1. Fetch vehicle + item ───────────────────────────────────────────
        const vehRes = await c.query(
          `SELECT v.id, v.item_id, v.owner_entity, v.status,
                  v.current_mileage_km, v.engine_hours,
                  i.name AS vehicle_name, i.location_id
           FROM   ims_vehicles v
           JOIN   ims_items i ON i.id = v.item_id
           WHERE  v.id = $1`,
          [vehicleId],
        );
        if (vehRes.rows.length === 0) throw Object.assign(new Error('Vehicle not found.'), { status: 404, code: 'VEHICLE_NOT_FOUND' });

        const veh = vehRes.rows[0] as {
          id: string; item_id: string; owner_entity: string | null;
          status: string; current_mileage_km: number | null;
          engine_hours: number | null; vehicle_name: string;
          location_id: string | null;
        };

        if (veh.status === 'DISPOSED') throw Object.assign(new Error('Vehicle is already disposed.'), { status: 409, code: 'ALREADY_DISPOSED' });

        // ── 2. Check no existing disposal record ──────────────────────────────
        const existing = await c.query('SELECT id FROM vms_disposals WHERE vehicle_id = $1', [vehicleId]);
        if (existing.rows.length > 0) throw Object.assign(new Error('A disposal record already exists for this vehicle.'), { status: 409, code: 'ALREADY_DISPOSED' });

        // ── 3. Fetch active depreciation schedule (if any) ────────────────────
        const depRes = await c.query(
          `SELECT ds.cost_at_start,
                  COALESCE(SUM(de.depreciation_amount), 0) AS accumulated_dep,
                  ds.acc_dep_gl_account_id
           FROM   ims_depreciation_schedules ds
           LEFT JOIN ims_depreciation_entries de ON de.schedule_id = ds.id
           WHERE  ds.item_id = $1 AND ds.is_active = true
           GROUP  BY ds.id, ds.cost_at_start, ds.acc_dep_gl_account_id
           LIMIT  1`,
          [veh.item_id],
        );

        const costAtDisposal      = depRes.rows.length > 0 ? parseFloat(String(depRes.rows[0].cost_at_start)) : 0;
        const accumulatedDep      = depRes.rows.length > 0 ? parseFloat(String(depRes.rows[0].accumulated_dep)) : 0;
        const depAccDepAccountId  = depRes.rows.length > 0 ? (depRes.rows[0].acc_dep_gl_account_id as string | null) : null;
        const nbvAtDisposal    = costAtDisposal - accumulatedDep;
        const salePrice        = b.sale_price_ttd ?? 0;
        const gainLoss         = b.disposal_type === 'SALE' ? salePrice - nbvAtDisposal : -nbvAtDisposal;

        // ── 4. Build TCO snapshot ─────────────────────────────────────────────
        const tcoRes = await c.query(
          `SELECT
             COALESCE((SELECT SUM(total_labour_cost_ttd + total_parts_cost_ttd)
                       FROM vms_work_orders
                       WHERE vehicle_id = $1 AND status = 'COMPLETE'), 0)       AS maintenance_ttd,
             COALESCE((SELECT SUM(total_cost_ttd) FROM vms_fuel_logs WHERE vehicle_id = $1), 0) AS fuel_ttd,
             COALESCE((SELECT SUM(amount_ttd) FROM vms_operating_costs WHERE vehicle_id = $1), 0) AS operating_ttd`,
          [vehicleId],
        );
        const tco = tcoRes.rows[0] as { maintenance_ttd: string; fuel_ttd: string; operating_ttd: string };
        const tcoSnapshot = {
          cost_at_disposal:   costAtDisposal,
          accumulated_dep:    accumulatedDep,
          nbv_at_disposal:    nbvAtDisposal,
          maintenance_ttd:    parseFloat(String(tco.maintenance_ttd ?? 0)),
          fuel_ttd:           parseFloat(String(tco.fuel_ttd ?? 0)),
          operating_ttd:      parseFloat(String(tco.operating_ttd ?? 0)),
          total_operating_cost: parseFloat(String(tco.maintenance_ttd ?? 0))
                              + parseFloat(String(tco.fuel_ttd ?? 0))
                              + parseFloat(String(tco.operating_ttd ?? 0)),
          sale_price_ttd:     b.disposal_type === 'SALE' ? salePrice : null,
          gain_loss_ttd:      gainLoss,
          snapshotted_at:     new Date().toISOString(),
        };

        // ── 5. Create disposal record ─────────────────────────────────────────
        const dispRow = await c.query(
          `INSERT INTO vms_disposals
             (tenant_id, vehicle_id, disposal_type, disposal_date,
              cost_at_disposal, accumulated_dep, nbv_at_disposal,
              sale_price_ttd, gain_loss_ttd, tco_snapshot,
              buyer_name, final_mileage_km, final_engine_hours,
              notes, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING *`,
          [
            tenantId, vehicleId, b.disposal_type, b.disposal_date,
            costAtDisposal, accumulatedDep, nbvAtDisposal,
            b.disposal_type === 'SALE' ? salePrice : null,
            gainLoss,
            JSON.stringify(tcoSnapshot),
            b.buyer_name ?? null,
            b.final_mileage_km ?? veh.current_mileage_km ?? null,
            b.final_engine_hours ?? veh.engine_hours ?? null,
            b.notes ?? null, userId,
          ],
        ).then(r => r.rows[0]);

        // ── 6. Mark vehicle DISPOSED ──────────────────────────────────────────
        await c.query(
          `UPDATE ims_vehicles SET status = 'DISPOSED', last_modified_by = $1,
           last_modified_at = now() WHERE id = $2`,
          [userId, vehicleId],
        );

        // ── 7. Write stock movement to exit inventory ─────────────────────────
        const movType = b.disposal_type === 'SALE' ? 'SALE' : 'DISPOSAL';
        await c.query(
          `INSERT INTO ims_stock_movements
             (tenant_id, item_id, from_location_id, quantity, movement_type,
              reference_type, reference_id, sale_price, customer_name,
              notes, performed_by, idempotency_key)
           VALUES ($1,$2,$3,1,$4,'VMS_DISPOSAL',$5,$6,$7,$8,$9,gen_random_uuid())`,
          [
            tenantId,
            veh.item_id,
            veh.location_id ?? null,
            movType,
            dispRow.id,
            b.disposal_type === 'SALE' ? (b.sale_price_ttd ?? null) : null,
            b.buyer_name ?? null,
            b.notes ?? null,
            userId,
          ],
        );
        await c.query(
          `UPDATE ims_items
           SET quantity_on_hand = GREATEST(quantity_on_hand - 1, 0),
               last_modified_at = now(), last_modified_by = $1, updated_at = now()
           WHERE id = $2`,
          [userId, veh.item_id],
        );

        return { dispRow, veh, costAtDisposal, accumulatedDep, nbvAtDisposal, salePrice, gainLoss, tcoSnapshot, depAccDepAccountId };
      });

      logger.info({ entity: 'VMS', action: 'VEHICLE_DISPOSED', user_id: userId, tenant_id: tenantId, vehicle_id: vehicleId, disposal_type: b.disposal_type });

      // ── 8. Optional non-blocking GL posting ───────────────────────────────
      const ownerEntityId      = disposal.veh.owner_entity ? OWNER_ENTITY_MAP[disposal.veh.owner_entity] : undefined;
      const resolvedAccDepAcct = b.acc_dep_gl_account_id ?? disposal.depAccDepAccountId ?? undefined;
      const canPostGl = ownerEntityId
        && b.vehicle_asset_gl_account_id
        && resolvedAccDepAcct
        && b.disposal_type !== 'TRANSFER';

      if (canPostGl) {
        void postDisposalGlEntry({
          disposalId:          disposal.dispRow.id,
          disposalType:        b.disposal_type,
          vehicleName:         disposal.veh.vehicle_name,
          disposalDate:        b.disposal_date,
          costAtDisposal:      disposal.costAtDisposal,
          accumulatedDep:      disposal.accumulatedDep,
          nbvAtDisposal:       disposal.nbvAtDisposal,
          salePrice:           disposal.salePrice,
          gainLoss:            disposal.gainLoss,
          ownerEntityId:       ownerEntityId!,
          rlsCtx:              req.rlsCtx,
          vehicleId,
          vehicleAssetAccountId: b.vehicle_asset_gl_account_id!,
          accDepAccountId:       resolvedAccDepAcct!,
          proceedsAccountId:     b.proceeds_gl_account_id,
          gainAccountId:         b.gain_gl_account_id,
          lossAccountId:         b.loss_gl_account_id,
        });
      }

      res.status(201).json(ok(disposal.dispRow));
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    if (ex.status === 409) { res.status(409).json(err(ex.message, ex.code ?? 'CONFLICT')); return; }
    next(e);
  }
});

// ── Disposal GL posting helper ────────────────────────────────────────────────

interface DisposalGlArgs {
  disposalId:            string;
  disposalType:          'SALE' | 'WRITE_OFF' | 'TRANSFER';
  vehicleName:           string;
  disposalDate:          string;
  costAtDisposal:        number;
  accumulatedDep:        number;
  nbvAtDisposal:         number;
  salePrice:             number;
  gainLoss:              number;
  ownerEntityId:         string;
  rlsCtx:                RLSContext;
  vehicleId:             string;
  vehicleAssetAccountId: string;
  accDepAccountId:       string;
  proceedsAccountId?:    string;
  gainAccountId?:        string;
  lossAccountId?:        string;
}

async function postDisposalGlEntry(args: DisposalGlArgs): Promise<void> {
  if (args.disposalType === 'TRANSFER') return; // no GL for internal transfers

  const {
    disposalId, disposalType, vehicleName, disposalDate,
    costAtDisposal, accumulatedDep, nbvAtDisposal, salePrice, gainLoss,
    ownerEntityId, rlsCtx, vehicleId,
    vehicleAssetAccountId, accDepAccountId,
    proceedsAccountId, gainAccountId, lossAccountId,
  } = args;
  const { ownerId, userId } = rlsCtx;

  const familyClient = await familyPool.connect();
  try {
    const jeId = await withOwnerRLS(familyClient, rlsCtx, async (c) => {
      const desc = `Vehicle disposal — ${vehicleName} — ${disposalType} — ${disposalDate}`;
      const idempotencyKey = `disposal_${disposalId}`;

      // Build balanced lines depending on disposal type
      type Line = { accountId: string; debit: number; credit: number; label: string };
      const lines: Line[] = [];

      if (disposalType === 'SALE') {
        // Dr. Cash/Receivable = sale proceeds
        if (proceedsAccountId && salePrice > 0) {
          lines.push({ accountId: proceedsAccountId, debit: salePrice, credit: 0, label: 'Sale proceeds' });
        }
        // Dr. Accumulated Depreciation (remove the accumulated dep contra)
        if (accumulatedDep > 0) {
          lines.push({ accountId: accDepAccountId, debit: accumulatedDep, credit: 0, label: 'Remove accumulated depreciation' });
        }
        // Cr. Vehicle Asset (remove the asset at cost)
        lines.push({ accountId: vehicleAssetAccountId, debit: 0, credit: costAtDisposal, label: 'Remove vehicle asset at cost' });

        // Plug: gain or loss
        if (gainLoss > 0 && gainAccountId) {
          lines.push({ accountId: gainAccountId, debit: 0, credit: gainLoss, label: 'Gain on disposal' });
        } else if (gainLoss < 0 && lossAccountId) {
          lines.push({ accountId: lossAccountId, debit: Math.abs(gainLoss), credit: 0, label: 'Loss on disposal' });
        }
      } else {
        // WRITE_OFF
        if (accumulatedDep > 0) {
          lines.push({ accountId: accDepAccountId, debit: accumulatedDep, credit: 0, label: 'Remove accumulated depreciation' });
        }
        if (nbvAtDisposal > 0 && lossAccountId) {
          lines.push({ accountId: lossAccountId, debit: nbvAtDisposal, credit: 0, label: 'Loss on write-off' });
        }
        lines.push({ accountId: vehicleAssetAccountId, debit: 0, credit: costAtDisposal, label: 'Remove vehicle asset at cost' });
      }

      if (lines.length < 2) {
        logger.warn({ entity: 'VMS', action: 'DISPOSAL_GL_SKIP', reason: 'insufficient_accounts', vehicle_id: vehicleId });
        return null;
      }

      const totalDebit  = lines.reduce((s, l) => s + l.debit,  0);
      const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

      // Verify balance (floating-point safe)
      if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
        logger.warn({ entity: 'VMS', action: 'DISPOSAL_GL_UNBALANCED', total_debit: totalDebit, total_credit: totalCredit, vehicle_id: vehicleId });
        return null;
      }

      const je = await c.query(
        `INSERT INTO fin_journal_entries
           (owner_id, owner_entity_id, entry_date, description,
            status, source, source_id, currency,
            total_debit_ttd, total_credit_ttd,
            idempotency_key, posted_at, posted_by)
         VALUES ($1,$2,$3,$4,'POSTED','VEHICLE_DISPOSAL',$5,'TTD',$6,$7,$8,now(),$9)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [ownerId, ownerEntityId, disposalDate, desc,
         disposalId,
         totalDebit.toFixed(2), totalCredit.toFixed(2),
         idempotencyKey, userId],
      );
      if (je.rows.length === 0) return null;

      const jeId = je.rows[0].id as string;

      await Promise.all(lines.map((l, i) =>
        c.query(
          `INSERT INTO fin_journal_entry_lines
             (owner_id, journal_entry_id, gl_account_id, line_number,
              description, debit_ttd, credit_ttd, currency)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'TTD')`,
          [ownerId, jeId, l.accountId, i + 1, l.label,
           l.debit.toFixed(2), l.credit.toFixed(2)],
        ),
      ));

      return jeId;
    });

    if (!jeId) return;

    // Write JE reference back onto the disposal record (best-effort)
    const updateClient = await commercialPool.connect();
    try {
      await withTenantRLS(updateClient, rlsCtx, (c) =>
        c.query(
          `UPDATE vms_disposals SET journal_entry_id = $1, last_modified_at = now() WHERE id = $2`,
          [jeId, disposalId],
        ),
      );
    } finally { updateClient.release(); }

    logger.info({ entity: 'VMS', action: 'DISPOSAL_GL_POSTED', disposal_id: disposalId, journal_entry_id: jeId, vehicle_id: vehicleId });
  } catch (e: unknown) {
    logger.warn({ entity: 'VMS', action: 'DISPOSAL_GL_POST_FAILED', disposal_id: disposalId, error: (e as Error).message });
  } finally {
    familyClient.release();
  }
}
