// GET   /api/v1/club/visitor-log         — list log entries (filter by date, member_id)
// POST  /api/v1/club/visitor-log         — log visitor in
// PATCH /api/v1/club/visitor-log/:id/checkout — record time out

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { entertainmentPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const clubVisitorLogRouter = Router();
clubVisitorLogRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const LogInSchema = z.object({
  visitor_name: z.string().min(1).max(200),
  id_type:      z.enum(['NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE', 'OTHER']),
  id_number:    z.string().min(1).max(100),
  address:      z.string().min(1).max(500),
  member_id:    z.string().uuid().optional(),
  notes:        z.string().max(500).optional(),
}).strict();

const CheckoutSchema = z.object({
  notes: z.string().max(500).optional(),
}).strict();

// ── GET /club/visitor-log ─────────────────────────────────────────────────────

clubVisitorLogRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const dateFilter   = req.query.date      as string | undefined;
  const memberFilter = req.query.member_id as string | undefined;

  try {
    const client = await entertainmentPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (dateFilter)   conditions.push(`vl.time_in::date = ${push(dateFilter)}`);
        if (memberFilter) conditions.push(`vl.member_id = ${push(memberFilter)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT vl.id, vl.visitor_name, vl.id_type, vl.id_number, vl.address,
                  vl.member_id, m.first_name || ' ' || m.last_name AS member_name,
                  vl.admitted_by, vl.time_in, vl.time_out, vl.notes
           FROM   ent_visitor_log vl
           LEFT JOIN ent_members m ON m.id = vl.member_id
           ${where}
           ORDER  BY vl.time_in DESC`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /club/visitor-log ────────────────────────────────────────────────────

clubVisitorLogRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = LogInSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { tenantId, userId } = req.rlsCtx;

  try {
    const client = await entertainmentPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        if (d.member_id) {
          const memberCheck = await c.query(
            `SELECT id FROM ent_members WHERE id = $1 AND status = 'ACTIVE'`, [d.member_id],
          );
          if (memberCheck.rows.length === 0) throw Object.assign(new Error('MEMBER_NOT_FOUND'), { code: 'MEMBER_NOT_FOUND' });
        }

        return c.query(
          `INSERT INTO ent_visitor_log
             (tenant_id, visitor_name, id_type, id_number, address, member_id, admitted_by, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id, visitor_name, id_type, id_number, address,
                     member_id, admitted_by, time_in, time_out, notes, created_at`,
          [tenantId, d.visitor_name, d.id_type, d.id_number, d.address,
           d.member_id ?? null, userId, d.notes ?? null],
        ).then(r => r.rows[0]);
      });
      logger.info({ entity: 'CLUB', action: 'VISITOR_LOGGED_IN', record_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'MEMBER_NOT_FOUND') {
      err(res, 404, 'MEMBER_NOT_FOUND', 'Sponsoring member not found or not active.'); return;
    }
    next(e);
  }
});

// ── PATCH /club/visitor-log/:id/checkout ─────────────────────────────────────

clubVisitorLogRouter.patch('/:id/checkout', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid id.'); return; }

  const bodyParsed = CheckoutSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await entertainmentPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query(
          `SELECT id, time_out FROM ent_visitor_log WHERE id = $1`, [id],
        );
        if (existing.rows.length === 0) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
        if (existing.rows[0].time_out)  throw Object.assign(new Error('ALREADY_CHECKED_OUT'), { code: 'ALREADY_CHECKED_OUT' });

        const sets = ['time_out = now()', 'updated_at = now()'];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        if (bodyParsed.data.notes !== undefined) sets.push(`notes = ${push(bodyParsed.data.notes)}`);
        params.push(id);

        return c.query(
          `UPDATE ent_visitor_log SET ${sets.join(', ')}
           WHERE id = $${params.length}
           RETURNING id, visitor_name, time_in, time_out, notes`,
          params,
        ).then(r => r.rows[0]);
      });
      logger.info({ entity: 'CLUB', action: 'VISITOR_CHECKED_OUT', record_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally { client.release(); }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'NOT_FOUND')          { err(res, 404, 'NOT_FOUND', 'Visitor log entry not found.'); return; }
      if (e.message === 'ALREADY_CHECKED_OUT') { err(res, 409, 'ALREADY_CHECKED_OUT', 'Visitor has already been checked out.'); return; }
    }
    next(e);
  }
});
