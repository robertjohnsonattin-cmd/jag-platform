// GET   /api/v1/dragonbridge/suppliers      — list suppliers
// POST  /api/v1/dragonbridge/suppliers      — create supplier
// PATCH /api/v1/dragonbridge/suppliers/:id  — update supplier

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const dbSuppliersRouter = Router();
dbSuppliersRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateSupplierSchema = z.object({
  name:          z.string().min(1).max(200),
  contact_name:  z.string().max(100).optional(),
  contact_email: z.string().email().max(200).optional(),
  contact_phone: z.string().max(50).optional(),
  address:       z.string().max(1000).optional(),
  currency:      z.string().length(3).default('CNY'),
  payment_terms: z.string().max(500).optional(),
  notes:         z.string().max(1000).optional(),
}).strict();

const UpdateSupplierSchema = z.object({
  name:          z.string().min(1).max(200).optional(),
  contact_name:  z.string().max(100).optional(),
  contact_email: z.string().email().max(200).optional(),
  contact_phone: z.string().max(50).optional(),
  address:       z.string().max(1000).optional(),
  currency:      z.string().length(3).optional(),
  payment_terms: z.string().max(500).optional(),
  notes:         z.string().max(1000).optional(),
  is_active:     z.boolean().optional(),
}).strict();

// ── GET /dragonbridge/suppliers ───────────────────────────────────────────────

dbSuppliersRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, name, contact_name, contact_email, contact_phone,
                  currency, payment_terms, is_active, created_at, last_modified_at
           FROM db_suppliers ORDER BY name`,
        ).then((r) => r.rows),
      );
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /dragonbridge/suppliers ──────────────────────────────────────────────

dbSuppliersRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateSupplierSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO db_suppliers
             (tenant_id, name, contact_name, contact_email, contact_phone,
              address, currency, payment_terms, notes, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id, name, contact_name, contact_email, contact_phone,
                     currency, payment_terms, is_active, created_at`,
          [tenantId, d.name, d.contact_name ?? null, d.contact_email ?? null,
           d.contact_phone ?? null, d.address ?? null, d.currency,
           d.payment_terms ?? null, d.notes ?? null, userId],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'DRAGONBRIDGE', action: 'SUPPLIER_CREATED', supplier_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── PATCH /dragonbridge/suppliers/:id ────────────────────────────────────────

dbSuppliersRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid supplier id.'); return; }

  const bodyParsed = UpdateSupplierSchema.safeParse(req.body);
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

        if (updates.name          !== undefined) sets.push(`name = ${push(updates.name)}`);
        if (updates.contact_name  !== undefined) sets.push(`contact_name = ${push(updates.contact_name)}`);
        if (updates.contact_email !== undefined) sets.push(`contact_email = ${push(updates.contact_email)}`);
        if (updates.contact_phone !== undefined) sets.push(`contact_phone = ${push(updates.contact_phone)}`);
        if (updates.address       !== undefined) sets.push(`address = ${push(updates.address)}`);
        if (updates.currency      !== undefined) sets.push(`currency = ${push(updates.currency)}`);
        if (updates.payment_terms !== undefined) sets.push(`payment_terms = ${push(updates.payment_terms)}`);
        if (updates.notes         !== undefined) sets.push(`notes = ${push(updates.notes)}`);
        if (updates.is_active     !== undefined) sets.push(`is_active = ${push(updates.is_active)}`);
        sets.push(`updated_at = now()`);
        sets.push(`last_modified_at = now()`);
        sets.push(`last_modified_by = ${push(userId)}`);

        return c.query(
          `UPDATE db_suppliers SET ${sets.join(', ')}
           WHERE id = ${push(id)}
           RETURNING id, name, contact_name, contact_email, contact_phone,
                     currency, payment_terms, is_active, last_modified_at`,
          params,
        ).then((r) => r.rows[0] ?? null);
      });
      if (!row) { err(res, 404, 'NOT_FOUND', 'Supplier not found.'); return; }
      logger.info({ entity: 'DRAGONBRIDGE', action: 'SUPPLIER_UPDATED', supplier_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});
