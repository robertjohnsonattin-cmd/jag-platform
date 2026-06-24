// POST /internal/crm/backfill-calendar
// Idempotent — creates Google Calendar all-day events for every crm_interaction
// that has follow_up_date set but no calendar_event_id yet.
// Iterates per distinct tenant so RLS is satisfied.
// Docker-network-only; no Keycloak auth.

import { Router, type Request, type Response } from 'express';
import { commercialPool } from '../../db/index';
import { withTenantRLS, type RLSContext } from '../../middleware/rls';
import { createAllDayCalendarEvent } from '../../lib/google-calendar';
import { logger } from '../../lib/logger';

export const crmCalendarBackfillRouter = Router();

// Robert's internal IDs — used as the RLS context for this admin operation
const OWNER_CTX: RLSContext = {
  userId:   '95ca3f77-60ba-4a0f-af70-2832b247b525',
  tenantId: '00000000-0000-0000-0001-000000000001', // JAG_HOLDINGS
  isOwner:  true,
  ownerId:  '95ca3f77-60ba-4a0f-af70-2832b247b525',
};

crmCalendarBackfillRouter.post('/', async (_req: Request, res: Response): Promise<void> => {
  let processed = 0, failed = 0;
  const client = await commercialPool.connect();
  try {
    const rows = await withTenantRLS(client, OWNER_CTX, (c) =>
      c.query<{
        id: string;
        first_name: string;
        last_name: string;
        subject: string;
        interaction_type: string;
        notes: string | null;
        follow_up_date: Date | string;
      }>(
        `SELECT ci.id, cc.first_name, cc.last_name,
                ci.subject, ci.interaction_type, ci.notes, ci.follow_up_date
         FROM   crm_interactions ci
         JOIN   crm_contacts cc ON cc.id = ci.contact_id
         WHERE  ci.follow_up_date IS NOT NULL
           AND  ci.calendar_event_id IS NULL`,
      ).then(r => r.rows),
    );

    for (const row of rows) {
      try {
        const contactName = `${row.first_name} ${row.last_name}`.trim();
        const eventId = await createAllDayCalendarEvent({
          title: `Follow-up: ${contactName} — ${row.subject}`,
          description: [`Type: ${row.interaction_type}`, row.notes ? `Notes: ${row.notes}` : ''].filter(Boolean).join('\n'),
          date: new Date(row.follow_up_date).toISOString().slice(0, 10),
        });
        const c2 = await commercialPool.connect();
        try {
          await withTenantRLS(c2, OWNER_CTX, (c) =>
            c.query(`UPDATE crm_interactions SET calendar_event_id = $1 WHERE id = $2`, [eventId, row.id]),
          );
        } finally { c2.release(); }
        logger.info({ entity: 'CRM', action: 'CALENDAR_BACKFILL_OK', record_id: row.id, event_id: eventId });
        processed++;
      } catch (e) {
        logger.error({ entity: 'CRM', action: 'CALENDAR_BACKFILL_ERROR', record_id: row.id, error_message: (e as Error).message });
        failed++;
      }
    }

    res.json({ success: true, data: { processed, failed, total: rows.length } });
  } finally {
    client.release();
  }
});
