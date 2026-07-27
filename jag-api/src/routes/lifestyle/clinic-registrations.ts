// GET    /api/v1/lifestyle/clinic-registrations
// POST   /api/v1/lifestyle/clinic-registrations
// PATCH  /api/v1/lifestyle/clinic-registrations/:id
// DELETE /api/v1/lifestyle/clinic-registrations/:id
// POST   /api/v1/lifestyle/clinic-registrations/:id/sync-calendar
//
// Which clinics/facilities a family member is enrolled at, their registration
// number there, and their next appointment. Sync-calendar pushes/updates a
// Google Calendar all-day event from next_appointment_date, same pattern as
// insurance renewal reminders and vehicle service events.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { createAllDayCalendarEvent, deleteCalendarEvent } from '../../lib/google-calendar';

export const clinicRegistrationsRouter = Router();

const UUIDParam = z.object({ id: z.string().uuid() });
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const CreateSchema = z.object({
  family_member_id: z.string().uuid(),
  facility_name: z.string().min(1).max(200),
  department: z.string().max(100).optional(),
  registration_number: z.string().max(50).optional(),
  next_appointment_date: DateStr.optional(),
  notes: z.string().max(2000).optional(),
}).strict();

const PatchSchema = CreateSchema.partial().refine(o => Object.keys(o).length > 0);

// ── GET / ─────────────────────────────────────────────────────────────────

clinicRegistrationsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const memberFilter = req.query.family_member_id as string | undefined;
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const where = memberFilter ? (params.push(memberFilter), `WHERE family_member_id = $1`) : '';
        return c.query(
          `SELECT * FROM fam_clinic_registrations ${where}
           ORDER  BY next_appointment_date ASC NULLS LAST, facility_name`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST / ────────────────────────────────────────────────────────────────

clinicRegistrationsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fam_clinic_registrations
             (owner_id, family_member_id, facility_name, department, registration_number,
              next_appointment_date, notes, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$1) RETURNING *`,
          [ownerId, body.family_member_id, body.facility_name, body.department ?? null,
           body.registration_number ?? null, body.next_appointment_date ?? null, body.notes ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'LIFESTYLE', action: 'CLINIC_REGISTRATION_CREATED', user_id: ownerId, record_id: rec.id });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /:id ────────────────────────────────────────────────────────────

clinicRegistrationsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = PatchSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const { userId: ownerId } = req.rlsCtx;
    const setCols: string[] = ['last_modified_at = now()', `last_modified_by = $1`];
    const params: unknown[] = [ownerId];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (body.family_member_id !== undefined) setCols.push(`family_member_id = ${push(body.family_member_id)}`);
    if (body.facility_name !== undefined) setCols.push(`facility_name = ${push(body.facility_name)}`);
    if (body.department !== undefined) setCols.push(`department = ${push(body.department)}`);
    if (body.registration_number !== undefined) setCols.push(`registration_number = ${push(body.registration_number)}`);
    if (body.next_appointment_date !== undefined) setCols.push(`next_appointment_date = ${push(body.next_appointment_date)}`);
    if (body.notes !== undefined) setCols.push(`notes = ${push(body.notes)}`);
    params.push(idP.data.id);
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE fam_clinic_registrations SET ${setCols.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'RECORD_NOT_FOUND', 'Clinic registration not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────

clinicRegistrationsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const existing = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT calendar_event_id FROM fam_clinic_registrations WHERE id = $1`, [idP.data.id])
          .then(r => r.rows[0] ?? null),
      );
      if (!existing) { err(res, 404, 'RECORD_NOT_FOUND', 'Clinic registration not found.'); return; }
      if (existing.calendar_event_id) {
        try { await deleteCalendarEvent(existing.calendar_event_id); }
        catch (calErr) { logger.warn({ entity: 'LIFESTYLE', action: 'CLINIC_CAL_DELETE_ERROR', error_message: (calErr as Error).message }); }
      }
      await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM fam_clinic_registrations WHERE id = $1`, [idP.data.id]),
      );
      logger.info({ entity: 'LIFESTYLE', action: 'CLINIC_REGISTRATION_DELETED', user_id: ownerId, record_id: idP.data.id });
      ok(res, { deleted: true });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /:id/sync-calendar ───────────────────────────────────────────────
// Creates (or replaces) a Google Calendar all-day event from next_appointment_date.
// Deletes any prior event for this registration first, so re-syncing after a
// rescheduled date doesn't leave a stale duplicate on the calendar.

clinicRegistrationsRouter.post('/:id/sync-calendar', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT r.*, m.first_name, m.last_name
           FROM fam_clinic_registrations r
           JOIN fam_family_members m ON m.id = r.family_member_id
           WHERE r.id = $1`,
          [idP.data.id],
        ).then(res2 => res2.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'RECORD_NOT_FOUND', 'Clinic registration not found.'); return; }
      if (!rec.next_appointment_date) { err(res, 422, 'NO_APPOINTMENT_DATE', 'Set a next appointment date before syncing to calendar.'); return; }

      if (rec.calendar_event_id) {
        try { await deleteCalendarEvent(rec.calendar_event_id); }
        catch (calErr) { logger.warn({ entity: 'LIFESTYLE', action: 'CLINIC_CAL_DELETE_ERROR', error_message: (calErr as Error).message }); }
      }

      const patientName = `${rec.first_name} ${rec.last_name}`;
      const dateStr = new Date(rec.next_appointment_date).toISOString().slice(0, 10);
      const evId = await createAllDayCalendarEvent({
        title: `🩺 ${patientName} — ${rec.department ? `${rec.department}, ` : ''}${rec.facility_name}`,
        description: `Clinic appointment for ${patientName}.\nFacility: ${rec.facility_name}${rec.department ? ` (${rec.department})` : ''}\nRegistration #: ${rec.registration_number ?? 'N/A'}${rec.notes ? `\nNotes: ${rec.notes}` : ''}`,
        date: dateStr,
      });

      const updated = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE fam_clinic_registrations SET calendar_event_id = $1, last_modified_at = now(), last_modified_by = $2 WHERE id = $3 RETURNING *`,
          [evId, ownerId, idP.data.id],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'LIFESTYLE', action: 'CLINIC_REGISTRATION_CAL_SYNCED', user_id: ownerId, record_id: idP.data.id });
      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
