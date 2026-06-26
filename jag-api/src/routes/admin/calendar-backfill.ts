// POST /api/v1/admin/calendar/backfill
// Owner-only authenticated endpoint that creates Google Calendar events for all
// records that have a relevant date set but no calendar_event_id yet.
// Idempotent — safe to re-run; records that already have event IDs are skipped.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requireOwner } from '../../middleware/owner';
import { commercialPool, propertiesPool, familyPool } from '../../db/index';
import { withTenantRLS, withOwnerRLS } from '../../middleware/rls';
import { createAllDayCalendarEvent } from '../../lib/google-calendar';
import { logger } from '../../lib/logger';
import { ok } from '../../lib/response';

export const adminCalendarBackfillRouter = Router();
adminCalendarBackfillRouter.use(requireAuth());
adminCalendarBackfillRouter.use(requireOwner());

adminCalendarBackfillRouter.post('/backfill', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rlsCtx = req.rlsCtx;
    let vehicleEvents = 0, inspectionEvents = 0, insuranceEvents = 0, failed = 0;

    // ── Vehicles ────────────────────────────────────────────────────────────────
    {
      const client = await commercialPool.connect();
      try {
        const vehicles = await withTenantRLS(client, rlsCtx, (c) =>
          c.query<{
            id: string; make: string; model: string;
            registration_number: string; owner_entity: string;
            registration_expiry: string | null;
            next_service_date: string | null;
            cal_service_event_id: string | null;
            cal_registration_event_id: string | null;
          }>(
            `SELECT id, make, model, registration_number, owner_entity,
                    registration_expiry::text AS registration_expiry,
                    next_service_date::text  AS next_service_date,
                    cal_service_event_id, cal_registration_event_id
             FROM ims_vehicles
             WHERE (
               (next_service_date IS NOT NULL    AND cal_service_event_id IS NULL) OR
               (registration_expiry IS NOT NULL   AND cal_registration_event_id IS NULL)
             )`,
          ).then(r => r.rows),
        );

        for (const v of vehicles) {
          const label = `${v.registration_number} — ${v.make} ${v.model}`;
          const updates: Record<string, string> = {};
          try {
            if (v.next_service_date && !v.cal_service_event_id) {
              updates['cal_service_event_id'] = await createAllDayCalendarEvent({
                title: `Vehicle Service Due: ${label}`,
                description: `Next scheduled service for ${label} (${v.owner_entity})`,
                date: v.next_service_date,
              });
              vehicleEvents++;
            }
            if (v.registration_expiry && !v.cal_registration_event_id) {
              updates['cal_registration_event_id'] = await createAllDayCalendarEvent({
                title: `Vehicle Registration Expiry: ${label}`,
                description: `Registration expires for ${label} (${v.owner_entity})`,
                date: v.registration_expiry,
              });
              vehicleEvents++;
            }
            if (Object.keys(updates).length > 0) {
              const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
              const c2 = await commercialPool.connect();
              try {
                await withTenantRLS(c2, rlsCtx, (c) =>
                  c.query(`UPDATE ims_vehicles SET ${sets} WHERE id = $1`, [v.id, ...Object.values(updates)]),
                );
              } finally { c2.release(); }
            }
          } catch (e) {
            logger.warn({ entity: 'IMS', action: 'VEHICLE_CAL_BACKFILL_FAIL', record_id: v.id, error_message: (e as Error).message });
            failed++;
          }
        }
      } finally { client.release(); }
    }

    // ── Property Inspections ────────────────────────────────────────────────────
    {
      const client = await propertiesPool.connect();
      try {
        const rows = await withOwnerRLS(client, rlsCtx, (c) =>
          c.query<{
            id: string; property_id: string;
            inspection_type: string; inspection_date: string;
            inspector_name: string | null; notes: string | null;
          }>(
            `SELECT id, property_id, inspection_type, inspection_date::text AS inspection_date, inspector_name, notes
             FROM prop_inspections
             WHERE inspection_date IS NOT NULL AND calendar_event_id IS NULL`,
          ).then(r => r.rows),
        );

        for (const row of rows) {
          try {
            const propClient = await propertiesPool.connect();
            let addr = 'Property';
            try {
              addr = await withOwnerRLS(propClient, rlsCtx, (c) =>
                c.query<{ address: string }>(
                  `SELECT COALESCE(address_line1, 'Property') AS address FROM prop_properties WHERE id = $1`,
                  [row.property_id],
                ).then(r => r.rows[0]?.address ?? 'Property'),
              );
            } finally { propClient.release(); }

            const evId = await createAllDayCalendarEvent({
              title: `Property Inspection: ${addr} — ${row.inspection_type}`,
              description: `${row.inspection_type} inspection${row.inspector_name ? `\nInspector: ${row.inspector_name}` : ''}${row.notes ? `\nNotes: ${row.notes}` : ''}`,
              date: row.inspection_date,
            });
            const c2 = await propertiesPool.connect();
            try {
              await withOwnerRLS(c2, rlsCtx, (c) =>
                c.query(`UPDATE prop_inspections SET calendar_event_id = $1 WHERE id = $2`, [evId, row.id]),
              );
            } finally { c2.release(); }
            inspectionEvents++;
          } catch (e) {
            logger.warn({ entity: 'Properties', action: 'INSPECTION_CAL_BACKFILL_FAIL', record_id: row.id, error_message: (e as Error).message });
            failed++;
          }
        }
      } finally { client.release(); }
    }

    // ── Finance Insurance Policies ──────────────────────────────────────────────
    {
      const client = await familyPool.connect();
      try {
        const rows = await withOwnerRLS(client, rlsCtx, (c) =>
          c.query<{
            id: string; policy_number: string; insurer_name: string;
            policy_type: string; insured_asset_type: string;
            expiry_date: string; broker_name: string | null;
          }>(
            `SELECT id, policy_number, insurer_name, policy_type, insured_asset_type, expiry_date::text AS expiry_date, broker_name
             FROM fin_insurance_policies
             WHERE expiry_date IS NOT NULL AND calendar_event_id IS NULL AND is_active = true`,
          ).then(r => r.rows),
        );

        for (const row of rows) {
          try {
            const evId = await createAllDayCalendarEvent({
              title: `Insurance Policy Expiry: ${row.policy_type} — ${row.insurer_name}`,
              description: `Policy ${row.policy_number} (${row.insurer_name}) expires\nType: ${row.policy_type} / ${row.insured_asset_type}${row.broker_name ? `\nBroker: ${row.broker_name}` : ''}`,
              date: row.expiry_date,
            });
            const c2 = await familyPool.connect();
            try {
              await withOwnerRLS(c2, rlsCtx, (c) =>
                c.query(`UPDATE fin_insurance_policies SET calendar_event_id = $1 WHERE id = $2`, [evId, row.id]),
              );
            } finally { c2.release(); }
            insuranceEvents++;
          } catch (e) {
            logger.warn({ entity: 'Insurance', action: 'POLICY_CAL_BACKFILL_FAIL', record_id: row.id, error_message: (e as Error).message });
            failed++;
          }
        }
      } finally { client.release(); }
    }

    const total = vehicleEvents + inspectionEvents + insuranceEvents;
    logger.info({
      entity: 'CALENDAR_BACKFILL', action: 'COMPLETE', user_id: rlsCtx.userId,
      vehicle_events: vehicleEvents, inspection_events: inspectionEvents,
      insurance_events: insuranceEvents, failed,
    });

    ok(res, { total_events_created: total, vehicle_events: vehicleEvents, inspection_events: inspectionEvents, insurance_events: insuranceEvents, failed });
  } catch (e) { next(e); }
});
