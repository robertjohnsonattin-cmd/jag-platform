// GET  /api/v1/family/members
// POST /api/v1/family/members
// GET  /api/v1/family/members/:id
// PATCH /api/v1/family/members/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const familyRouter = Router();
familyRouter.use(requireAuth());
familyRouter.use(brianPortalGate('FAMILY'));

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateMemberSchema = z.object({
  relationship:           z.enum(['SELF','WIFE','DAUGHTER','FATHER','BROTHER','OTHER']),
  first_name:             z.string().min(1).max(100),
  last_name:              z.string().min(1).max(100),
  date_of_birth:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  email:                  z.string().email().optional(),
  phone:                  z.string().max(30).optional(),
  preferred_language:     z.enum(['en','zh','es']).default('en'),
  is_emergency_designate: z.boolean().default(false),
  notes:                  z.string().max(2000).optional(),
}).strict();

const PatchMemberSchema = CreateMemberSchema.partial().refine(o => Object.keys(o).length > 0, { message: 'At least one field required.' });

// ── GET /family/members ───────────────────────────────────────────────────────

familyRouter.get('/members', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, relationship, first_name, last_name, date_of_birth, email, phone,
                  preferred_language, is_emergency_designate, keycloak_user_id, created_at
           FROM   fam_family_members ORDER BY relationship, first_name`,
        ).then(r => r.rows),
      );
      logger.info({ entity: 'FAMILY', action: 'MEMBERS_LIST', user_id: req.rlsCtx.userId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /family/members ──────────────────────────────────────────────────────

familyRouter.post('/members', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateMemberSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fam_family_members
             (owner_id, relationship, first_name, last_name, date_of_birth, email, phone,
              preferred_language, is_emergency_designate, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [ownerId, body.relationship, body.first_name, body.last_name,
           body.date_of_birth ?? null, body.email ?? null, body.phone ?? null,
           body.preferred_language, body.is_emergency_designate, body.notes ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'FAMILY', action: 'MEMBER_CREATED', user_id: ownerId, record_id: rec.id });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /family/members/:id ───────────────────────────────────────────────────

familyRouter.get('/members/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fam_family_members WHERE id = $1`, [parsed.data.id]).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'MEMBER_NOT_FOUND', 'Family member not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /family/members/:id ─────────────────────────────────────────────────

familyRouter.patch('/members/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = PatchMemberSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const setCols: string[] = ['updated_at = now()'];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (body.first_name             !== undefined) setCols.push(`first_name             = ${push(body.first_name)}`);
    if (body.last_name              !== undefined) setCols.push(`last_name              = ${push(body.last_name)}`);
    if (body.email                  !== undefined) setCols.push(`email                  = ${push(body.email)}`);
    if (body.phone                  !== undefined) setCols.push(`phone                  = ${push(body.phone)}`);
    if (body.preferred_language     !== undefined) setCols.push(`preferred_language     = ${push(body.preferred_language)}`);
    if (body.is_emergency_designate !== undefined) setCols.push(`is_emergency_designate = ${push(body.is_emergency_designate)}`);
    if (body.notes                  !== undefined) setCols.push(`notes                  = ${push(body.notes)}`);
    params.push(idP.data.id);
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE fam_family_members SET ${setCols.join(',')} WHERE id = $${params.length} RETURNING *`, params).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'MEMBER_NOT_FOUND', 'Family member not found.'); return; }
      logger.info({ entity: 'FAMILY', action: 'MEMBER_UPDATED', user_id: req.rlsCtx.userId, record_id: idP.data.id });
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
