// GET   /api/v1/dragonbridge/clients      — list clients (filter: type, active)
// POST  /api/v1/dragonbridge/clients      — create client
// PATCH /api/v1/dragonbridge/clients/:id  — update client

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const dbClientsRouter = Router();
dbClientsRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateClientSchema = z.object({
  client_type:     z.enum(['B2B', 'B2C']),
  name:            z.string().min(1).max(200),
  company_name:    z.string().max(200).optional(),
  contact_name:    z.string().max(100).optional(),
  contact_email:   z.string().email().max(200).optional(),
  contact_phone:   z.string().max(50).optional(),
  address:         z.string().max(1000).optional(),
  pricing_tier_id: z.string().uuid().optional(),
  notes:           z.string().max(1000).optional(),
  crm_contact_id:  z.string().uuid().nullable().optional(),
}).strict();

const UpdateClientSchema = z.object({
  name:            z.string().min(1).max(200).optional(),
  company_name:    z.string().max(200).optional(),
  contact_name:    z.string().max(100).optional(),
  contact_email:   z.string().email().max(200).optional(),
  contact_phone:   z.string().max(50).optional(),
  address:         z.string().max(1000).optional(),
  pricing_tier_id: z.string().uuid().optional(),
  notes:           z.string().max(1000).optional(),
  is_active:       z.boolean().optional(),
  crm_contact_id:  z.string().uuid().nullable().optional(),
}).strict();

// ── GET /dragonbridge/clients ─────────────────────────────────────────────────

dbClientsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const typeFilter  = req.query.type as string | undefined;
  const activeOnly  = req.query.active !== 'false';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (activeOnly)  conditions.push(`c.is_active = true`);
        if (typeFilter)  conditions.push(`c.client_type = ${push(typeFilter)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT c.id, c.client_type, c.name, c.company_name, c.contact_name,
                  c.contact_email, c.contact_phone, c.is_active,
                  c.pricing_tier_id, t.name AS pricing_tier_name,
                  t.default_margin_pct, c.crm_contact_id, c.created_at
           FROM db_clients c
           LEFT JOIN db_pricing_tiers t ON t.id = c.pricing_tier_id
           ${where}
           ORDER BY c.name`,
          params,
        ).then((r) => r.rows);
      });
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /dragonbridge/clients ────────────────────────────────────────────────

dbClientsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateClientSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        if (d.pricing_tier_id) {
          const tierRes = await c.query(
            `SELECT id FROM db_pricing_tiers WHERE id = $1 AND is_active = true`, [d.pricing_tier_id],
          );
          if (tierRes.rows.length === 0) throw Object.assign(new Error('TIER_NOT_FOUND'), { code: 'TIER_NOT_FOUND' });
        }
        return c.query(
          `INSERT INTO db_clients
             (tenant_id, client_type, name, company_name, contact_name, contact_email,
              contact_phone, address, pricing_tier_id, notes, crm_contact_id, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING id, client_type, name, company_name, contact_name,
                     contact_email, contact_phone, pricing_tier_id, is_active, crm_contact_id, created_at`,
          [tenantId, d.client_type, d.name, d.company_name ?? null,
           d.contact_name ?? null, d.contact_email ?? null, d.contact_phone ?? null,
           d.address ?? null, d.pricing_tier_id ?? null, d.notes ?? null, d.crm_contact_id ?? null, userId],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'CLIENT_CREATED', client_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'TIER_NOT_FOUND') {
      err(res, 404, 'TIER_NOT_FOUND', 'Pricing tier not found or inactive.'); return;
    }
    next(e);
  }
});

// ── PATCH /dragonbridge/clients/:id ──────────────────────────────────────────

dbClientsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid client id.'); return; }

  const bodyParsed = UpdateClientSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const updates = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  if (Object.keys(updates).length === 0) { err(res, 400, 'NO_FIELDS', 'No fields to update.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const sets: string[] = [];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (updates.name            !== undefined) sets.push(`name = ${push(updates.name)}`);
        if (updates.company_name    !== undefined) sets.push(`company_name = ${push(updates.company_name)}`);
        if (updates.contact_name    !== undefined) sets.push(`contact_name = ${push(updates.contact_name)}`);
        if (updates.contact_email   !== undefined) sets.push(`contact_email = ${push(updates.contact_email)}`);
        if (updates.contact_phone   !== undefined) sets.push(`contact_phone = ${push(updates.contact_phone)}`);
        if (updates.address         !== undefined) sets.push(`address = ${push(updates.address)}`);
        if (updates.pricing_tier_id !== undefined) sets.push(`pricing_tier_id = ${push(updates.pricing_tier_id)}`);
        if (updates.notes           !== undefined) sets.push(`notes = ${push(updates.notes)}`);
        if (updates.is_active       !== undefined) sets.push(`is_active = ${push(updates.is_active)}`);
        if (updates.crm_contact_id  !== undefined) sets.push(`crm_contact_id = ${push(updates.crm_contact_id)}`);
        sets.push(`updated_at = now()`);
        sets.push(`last_modified_at = now()`);
        sets.push(`last_modified_by = ${push(userId)}`);

        return c.query(
          `UPDATE db_clients SET ${sets.join(', ')}
           WHERE id = ${push(id)}
           RETURNING id, client_type, name, company_name, contact_name,
                     contact_email, pricing_tier_id, is_active, last_modified_at`,
          params,
        ).then((r) => r.rows[0] ?? null);
      });
      if (!row) { err(res, 404, 'NOT_FOUND', 'Client not found.'); return; }
      logger.info({ entity: 'DRAGONBRIDGE', action: 'CLIENT_UPDATED', client_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});
