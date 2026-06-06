// GET   /api/v1/dragonbridge/products      — list products (filter: supplier_id, active)
// POST  /api/v1/dragonbridge/products      — create product
// PATCH /api/v1/dragonbridge/products/:id  — update product

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const dbProductsRouter = Router();
dbProductsRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateProductSchema = z.object({
  supplier_id:   z.string().uuid(),
  name:          z.string().min(1).max(200),
  description:   z.string().max(2000).optional(),
  hs_code:       z.string().min(1).max(10),
  unit_cost_cny: z.number().positive(),
  unit:          z.string().min(1).max(20).default('EACH'),
  duty_rate:     z.number().min(0).max(1),
  notes:         z.string().max(1000).optional(),
}).strict();

const UpdateProductSchema = z.object({
  name:          z.string().min(1).max(200).optional(),
  description:   z.string().max(2000).optional(),
  hs_code:       z.string().min(1).max(10).optional(),
  unit_cost_cny: z.number().positive().optional(),
  unit:          z.string().min(1).max(20).optional(),
  duty_rate:     z.number().min(0).max(1).optional(),
  notes:         z.string().max(1000).optional(),
  is_active:     z.boolean().optional(),
}).strict();

// ── GET /dragonbridge/products ────────────────────────────────────────────────

dbProductsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const supplierIdFilter = req.query.supplier_id as string | undefined;
  const activeOnly = req.query.active !== 'false';

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (activeOnly)       conditions.push(`p.is_active = true`);
        if (supplierIdFilter) conditions.push(`p.supplier_id = ${push(supplierIdFilter)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT p.id, p.name, p.description, p.hs_code, p.unit_cost_cny, p.unit,
                  p.duty_rate, p.is_active, p.supplier_id, s.name AS supplier_name,
                  p.created_at, p.last_modified_at
           FROM db_products p
           JOIN db_suppliers s ON s.id = p.supplier_id
           ${where}
           ORDER BY p.name`,
          params,
        ).then((r) => r.rows);
      });
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /dragonbridge/products ───────────────────────────────────────────────

dbProductsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateProductSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const supplierRes = await c.query(
          `SELECT id FROM db_suppliers WHERE id = $1 AND is_active = true`, [d.supplier_id],
        );
        if (supplierRes.rows.length === 0) throw Object.assign(new Error('SUPPLIER_NOT_FOUND'), { code: 'SUPPLIER_NOT_FOUND' });

        return c.query(
          `INSERT INTO db_products
             (tenant_id, supplier_id, name, description, hs_code, unit_cost_cny,
              unit, duty_rate, notes, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id, name, hs_code, unit_cost_cny, unit, duty_rate, is_active, created_at`,
          [tenantId, d.supplier_id, d.name, d.description ?? null, d.hs_code,
           d.unit_cost_cny, d.unit, d.duty_rate, d.notes ?? null, userId],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'PRODUCT_CREATED', product_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'SUPPLIER_NOT_FOUND') {
      err(res, 404, 'SUPPLIER_NOT_FOUND', 'Supplier not found or inactive.'); return;
    }
    next(e);
  }
});

// ── PATCH /dragonbridge/products/:id ─────────────────────────────────────────

dbProductsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid product id.'); return; }

  const bodyParsed = UpdateProductSchema.safeParse(req.body);
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
        if (updates.description   !== undefined) sets.push(`description = ${push(updates.description)}`);
        if (updates.hs_code       !== undefined) sets.push(`hs_code = ${push(updates.hs_code)}`);
        if (updates.unit_cost_cny !== undefined) sets.push(`unit_cost_cny = ${push(updates.unit_cost_cny)}`);
        if (updates.unit          !== undefined) sets.push(`unit = ${push(updates.unit)}`);
        if (updates.duty_rate     !== undefined) sets.push(`duty_rate = ${push(updates.duty_rate)}`);
        if (updates.notes         !== undefined) sets.push(`notes = ${push(updates.notes)}`);
        if (updates.is_active     !== undefined) sets.push(`is_active = ${push(updates.is_active)}`);
        sets.push(`updated_at = now()`);
        sets.push(`last_modified_at = now()`);
        sets.push(`last_modified_by = ${push(userId)}`);

        return c.query(
          `UPDATE db_products SET ${sets.join(', ')}
           WHERE id = ${push(id)}
           RETURNING id, name, hs_code, unit_cost_cny, unit, duty_rate, is_active, last_modified_at`,
          params,
        ).then((r) => r.rows[0] ?? null);
      });
      if (!row) { err(res, 404, 'NOT_FOUND', 'Product not found.'); return; }
      logger.info({ entity: 'DRAGONBRIDGE', action: 'PRODUCT_UPDATED', product_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});
