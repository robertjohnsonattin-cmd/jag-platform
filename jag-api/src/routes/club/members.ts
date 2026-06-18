// GET   /api/v1/club/members         — list members (filter by status)
// POST  /api/v1/club/members         — create member (auto-generates member_number)
// GET   /api/v1/club/members/:id     — member detail with active membership + credit balance
// PATCH /api/v1/club/members/:id     — update member

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { entertainmentPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const clubMembersRouter = Router();
clubMembersRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateMemberSchema = z.object({
  first_name:        z.string().min(1).max(100),
  last_name:         z.string().min(1).max(100),
  email:             z.string().email().optional(),
  phone:             z.string().max(30).optional(),
  date_of_birth:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  photo_url:         z.string().url().optional(),
  emergency_contact: z.record(z.unknown()).optional(),
  notes:             z.string().max(2000).optional(),
  crm_contact_id:    z.string().uuid().nullable().optional(),
}).strict();

const PatchMemberSchema = z.object({
  first_name:        z.string().min(1).max(100).optional(),
  last_name:         z.string().min(1).max(100).optional(),
  email:             z.string().email().optional(),
  phone:             z.string().max(30).optional(),
  date_of_birth:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  photo_url:         z.string().url().optional(),
  emergency_contact: z.record(z.unknown()).optional(),
  notes:             z.string().max(2000).optional(),
  status:            z.enum(['ACTIVE', 'SUSPENDED', 'EXPIRED']).optional(),
  crm_contact_id:    z.string().uuid().nullable().optional(),
}).strict().refine(o => Object.keys(o).length > 0, { message: 'At least one field required.' });

// ── GET /club/members ─────────────────────────────────────────────────────────

clubMembersRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const statusFilter = req.query.status as string | undefined;
    const search       = req.query.search as string | undefined;

    const client = await entertainmentPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (statusFilter) conditions.push(`status = ${push(statusFilter)}`);
        if (search) {
          const like = push(`%${search}%`);
          conditions.push(`(first_name ILIKE ${like} OR last_name ILIKE ${like} OR email ILIKE ${like} OR member_number ILIKE ${like})`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT id, member_number, first_name, last_name, email, phone,
                  credit_balance, status, crm_contact_id, created_at, updated_at
           FROM   ent_members ${where}
           ORDER  BY last_name, first_name`,
          params,
        ).then(r => r.rows);
      });
      logger.info({ entity: 'CLUB', action: 'MEMBERS_LIST', user_id: req.rlsCtx.userId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /club/members ────────────────────────────────────────────────────────

clubMembersRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateMemberSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { tenantId, userId } = req.rlsCtx;

    const client = await entertainmentPool.connect();
    try {
      const rec = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO ent_members
             (tenant_id, member_number, first_name, last_name, email, phone,
              date_of_birth, photo_url, emergency_contact, notes, crm_contact_id)
           VALUES ($1, 'M-' || LPAD(nextval('ent_member_number_seq')::text, 4, '0'),
                   $2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [tenantId, body.first_name, body.last_name,
           body.email ?? null, body.phone ?? null,
           body.date_of_birth ?? null, body.photo_url ?? null,
           body.emergency_contact ? JSON.stringify(body.emergency_contact) : null,
           body.notes ?? null, body.crm_contact_id ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'CLUB', action: 'MEMBER_CREATED', user_id: userId, record_id: rec.id, member_number: rec.member_number });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /club/members/:id ─────────────────────────────────────────────────────

clubMembersRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }

    const client = await entertainmentPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const member = await c.query(
          `SELECT * FROM ent_members WHERE id = $1`, [idP.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!member) return null;

        const membership = await c.query(
          `SELECT ms.id, ms.started_at, ms.expires_at, ms.status,
                  t.id AS tier_id, t.name AS tier_name, t.bar_discount_pct,
                  t.guest_passes_per_month, t.monthly_fee
           FROM   ent_memberships ms
           JOIN   ent_membership_tiers t ON t.id = ms.tier_id
           WHERE  ms.member_id = $1 AND ms.status = 'ACTIVE'
           ORDER  BY ms.started_at DESC LIMIT 1`,
          [idP.data.id],
        ).then(r => r.rows[0] ?? null);

        return { ...member, active_membership: membership };
      });
      if (!result) { err(res, 404, 'MEMBER_NOT_FOUND', 'Member not found.'); return; }
      ok(res, result);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /club/members/:id ───────────────────────────────────────────────────

clubMembersRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = PatchMemberSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;

    const setCols: string[] = ['updated_at = now()'];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (body.first_name        !== undefined) setCols.push(`first_name        = ${push(body.first_name)}`);
    if (body.last_name         !== undefined) setCols.push(`last_name         = ${push(body.last_name)}`);
    if (body.email             !== undefined) setCols.push(`email             = ${push(body.email)}`);
    if (body.phone             !== undefined) setCols.push(`phone             = ${push(body.phone)}`);
    if (body.date_of_birth     !== undefined) setCols.push(`date_of_birth     = ${push(body.date_of_birth)}`);
    if (body.photo_url         !== undefined) setCols.push(`photo_url         = ${push(body.photo_url)}`);
    if (body.emergency_contact !== undefined) setCols.push(`emergency_contact = ${push(JSON.stringify(body.emergency_contact))}`);
    if (body.notes             !== undefined) setCols.push(`notes             = ${push(body.notes)}`);
    if (body.status            !== undefined) setCols.push(`status            = ${push(body.status)}`);
    if (body.crm_contact_id    !== undefined) setCols.push(`crm_contact_id    = ${push(body.crm_contact_id)}`);
    params.push(idP.data.id);

    const client = await entertainmentPool.connect();
    try {
      const rec = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE ent_members SET ${setCols.join(',')} WHERE id = $${params.length} RETURNING *`, params)
          .then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'MEMBER_NOT_FOUND', 'Member not found.'); return; }
      logger.info({ entity: 'CLUB', action: 'MEMBER_UPDATED', user_id: req.rlsCtx.userId, record_id: rec.id });
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
