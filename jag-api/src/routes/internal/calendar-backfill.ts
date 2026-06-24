// POST /internal/calendar/backfill
// Idempotent — creates Google Calendar events for all records that have a
// relevant date set but no calendar_event_id / cal_*_event_id yet.
//
// Targets:
//   vehicles     — next_service_date → cal_service_event_id
//                  insurance_expiry  → cal_insurance_event_id
//                  registration_expiry → cal_registration_event_id
//   inspections  — inspection_date → calendar_event_id
//   insurance    — expiry_date     → calendar_event_id (fin_insurance_policies)
//
// Docker-network-only; no Keycloak auth (same pattern as crm-calendar-backfill).

import { Router, type Request, type Response } from 'express';
import { commercialPool, propertiesPool, familyPool } from '../../db/index';
import { withTenantRLS, withOwnerRLS, type RLSContext } from '../../middleware/rls';
import { createAllDayCalendarEvent } from '../../lib/google-calendar';
import { logger } from '../../lib/logger';

export const calendarBackfillRouter = Router();

const OWNER_CTX: RLSContext = {
  userId:   '95ca3f77-60ba-4a0f-af70-2832b247b525',
  tenantId: '00000000-0000-0000-0001-000000000001',
  isOwner:  true,
  ownerId:  '95ca3f77-60ba-4a0f-af70-2832b247b525',
};

interface SectionResult {
  processed: number;
  failed: number;
  skipped: number;
}

// ── Vehicles ──────────────────────────────────────────────────────────────────

async function backfillVehicles(): Promise<SectionResult> {
  let processed = 0, failed = 0, skipped = 0;

  const client = await commercialPool.connect();
  try {
    const vehicles = await withTenantRLS(client, OWNER_CTX, (c) =>
      c.query<{
        id: string;
        make: string; model: string; registration_number: string; owner_entity: string;
        insurance_expiry: string | null; registration_expiry: string | null;
        next_service_date: string | null; insurance_provider: string | null;
        cal_service_event_id: string | null;
        cal_insurance_event_id: string | null;
        cal_registration_event_id: string | null;
      }>(
        `SELECT id, make, model, registration_number, owner_entity,
                insurance_expiry::text   AS insurance_expiry,
                registration_expiry::text AS registration_expiry,
                next_service_date::text  AS next_service_date,
                insurance_provider,
                cal_service_event_id, cal_insurance_event_id, cal_registration_event_id
         FROM ims_vehicles
         WHERE (
           (next_service_date IS NOT NULL      AND cal_service_event_id IS NULL) OR
           (insurance_expiry IS NOT NULL        AND cal_insurance_event_id IS NULL) OR
           (registration_expiry IS NOT NULL     AND cal_registration_event_id IS NULL)
         )`,
      ).then(r => r.rows),
    );

    for (const v of vehicles) {
      const label = `${v.registration_number} — ${v.make} ${v.model}`;
      const updates: Record<string, string> = {};

      try {
        if (v.next_service_date && !v.cal_service_event_id) {
          const evId = await createAllDayCalendarEvent({
            title: `Vehicle Service Due: ${label}`,
            description: `Next scheduled service for ${label} (${v.owner_entity})`,
            date: v.next_service_date,
          });
          updates['cal_service_event_id'] = evId;
          processed++;
        } else if (v.next_service_date) { skipped++; }

        if (v.insurance_expiry && !v.cal_insurance_event_id) {
          const evId = await createAllDayCalendarEvent({
            title: `Vehicle Insurance Expiry: ${label}`,
            description: `Insurance policy expires for ${label} (${v.insurance_provider ?? v.owner_entity})`,
            date: v.insurance_expiry,
          });
          updates['cal_insurance_event_id'] = evId;
          processed++;
        } else if (v.insurance_expiry) { skipped++; }

        if (v.registration_expiry && !v.cal_registration_event_id) {
          const evId = await createAllDayCalendarEvent({
            title: `Vehicle Registration Expiry: ${label}`,
            description: `Registration expires for ${label} (${v.owner_entity})`,
            date: v.registration_expiry,
          });
          updates['cal_registration_event_id'] = evId;
          processed++;
        } else if (v.registration_expiry) { skipped++; }

        if (Object.keys(updates).length > 0) {
          const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
          const vals = Object.values(updates);
          const c2 = await commercialPool.connect();
          try {
            await withTenantRLS(c2, OWNER_CTX, (c) =>
              c.query(`UPDATE ims_vehicles SET ${sets} WHERE id = $1`, [v.id, ...vals]),
            );
          } finally { c2.release(); }
          logger.info({ entity: 'IMS', action: 'VEHICLE_CAL_BACKFILL_OK', record_id: v.id });
        }
      } catch (e) {
        logger.error({ entity: 'IMS', action: 'VEHICLE_CAL_BACKFILL_ERROR', record_id: v.id, error_message: (e as Error).message });
        failed++;
      }
    }
  } finally { client.release(); }

  return { processed, failed, skipped };
}

// ── Property Inspections ──────────────────────────────────────────────────────

async function backfillInspections(): Promise<SectionResult> {
  let processed = 0, failed = 0, skipped = 0;

  const client = await propertiesPool.connect();
  try {
    const rows = await withOwnerRLS(client, OWNER_CTX, (c) =>
      c.query<{
        id: string; property_id: string;
        inspection_type: string; inspection_date: string;
        inspector_name: string | null; notes: string | null;
      }>(
        `SELECT i.id, i.property_id, i.inspection_type, i.inspection_date::text AS inspection_date,
                i.inspector_name, i.notes
         FROM prop_inspections i
         WHERE i.inspection_date IS NOT NULL
           AND i.calendar_event_id IS NULL`,
      ).then(r => r.rows),
    );

    for (const row of rows) {
      try {
        // Get property address for event title
        const propClient = await propertiesPool.connect();
        let addr = 'Property';
        try {
          addr = await withOwnerRLS(propClient, OWNER_CTX, (c) =>
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
          await withOwnerRLS(c2, OWNER_CTX, (c) =>
            c.query(`UPDATE prop_inspections SET calendar_event_id = $1 WHERE id = $2`, [evId, row.id]),
          );
        } finally { c2.release(); }

        logger.info({ entity: 'Properties', action: 'INSPECTION_CAL_BACKFILL_OK', record_id: row.id });
        processed++;
      } catch (e) {
        logger.error({ entity: 'Properties', action: 'INSPECTION_CAL_BACKFILL_ERROR', record_id: row.id, error_message: (e as Error).message });
        failed++;
      }
    }
  } finally { client.release(); }

  return { processed, failed, skipped };
}

// ── Finance Insurance Policies ────────────────────────────────────────────────

async function backfillInsurance(): Promise<SectionResult> {
  let processed = 0, failed = 0, skipped = 0;

  const client = await familyPool.connect();
  try {
    const rows = await withOwnerRLS(client, OWNER_CTX, (c) =>
      c.query<{
        id: string; policy_number: string; insurer_name: string;
        policy_type: string; insured_asset_type: string;
        expiry_date: string; broker_name: string | null;
      }>(
        `SELECT id, policy_number, insurer_name, policy_type, insured_asset_type, expiry_date::text AS expiry_date, broker_name
         FROM fin_insurance_policies
         WHERE expiry_date IS NOT NULL
           AND calendar_event_id IS NULL
           AND is_active = true`,
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
          await withOwnerRLS(c2, OWNER_CTX, (c) =>
            c.query(`UPDATE fin_insurance_policies SET calendar_event_id = $1 WHERE id = $2`, [evId, row.id]),
          );
        } finally { c2.release(); }

        logger.info({ entity: 'Insurance', action: 'POLICY_CAL_BACKFILL_OK', record_id: row.id });
        processed++;
      } catch (e) {
        logger.error({ entity: 'Insurance', action: 'POLICY_CAL_BACKFILL_ERROR', record_id: row.id, error_message: (e as Error).message });
        failed++;
      }
    }
  } finally { client.release(); }

  return { processed, failed, skipped };
}

// ── Main handler ──────────────────────────────────────────────────────────────

calendarBackfillRouter.post('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [vehicles, inspections, insurance] = await Promise.all([
      backfillVehicles(),
      backfillInspections(),
      backfillInsurance(),
    ]);

    const total = vehicles.processed + inspections.processed + insurance.processed;
    logger.info({
      entity: 'CALENDAR_BACKFILL', action: 'COMPLETE',
      vehicles_processed: vehicles.processed, vehicles_failed: vehicles.failed,
      inspections_processed: inspections.processed, inspections_failed: inspections.failed,
      insurance_processed: insurance.processed, insurance_failed: insurance.failed,
    });

    res.json({
      success: true,
      data: { total_events_created: total, vehicles, inspections, insurance },
    });
  } catch (e) {
    logger.error({ entity: 'CALENDAR_BACKFILL', action: 'ERROR', error_message: (e as Error).message });
    res.status(500).json({ success: false, data: null, error: (e as Error).message });
  }
});
