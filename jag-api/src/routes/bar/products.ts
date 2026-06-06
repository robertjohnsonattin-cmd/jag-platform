// GET   /api/v1/bar/products          — list products (filterable by category/active)
// POST  /api/v1/bar/products          — create product
// PATCH /api/v1/bar/products/:id      — update product

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { entertainmentPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const barProductsRouter = Router();
barProductsRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });
const CategoryEnum = z.enum(['DRINK', 'FOOD', 'MERCHANDISE', 'OTHER']);

const CreateProductSchema = z.object({
  name:      z.string().min(1).max(200),
  category:  CategoryEnum,
  price:     z.number().min(0),
  cost:      z.number().min(0).optional(),
  sku:       z.string().max(100).optional(),
  stock_qty: z.number().int().min(0).optional(),
}).strict();

const PatchProductSchema = z.object({
  name:      z.string().min(1).max(200).optional(),
  category:  CategoryEnum.optional(),
  price:     z.number().min(0).optional(),
  cost:      z.number().min(0).optional(),
  sku:       z.string().max(100).optional(),
  stock_qty: z.number().int().min(0).nullable().optional(),
  is_active: z.boolean().optional(),
}).strict().refine(o => Object.keys(o).length > 0, { message: 'At least one field required.' });

// ── GET /bar/products ─────────────────────────────────────────────────────────

barProductsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const categoryFilter = req.query.category as string | undefined;
    const activeOnly     = req.query.active !== 'false';

    const client = await entertainmentPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (activeOnly)      conditions.push(`is_active = true`);
        if (categoryFilter)  conditions.push(`category = ${push(categoryFilter)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT id, name, category, price, cost, sku, stock_qty, is_active, created_at, updated_at
           FROM   ent_products ${where}
           ORDER  BY category, name`,
          params,
        ).then(r => r.rows);
      });
      logger.info({ entity: 'BAR', action: 'PRODUCTS_LIST', user_id: req.rlsCtx.userId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /bar/products ────────────────────────────────────────────────────────

barProductsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateProductSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { tenantId } = req.rlsCtx;

    const client = await entertainmentPool.connect();
    try {
      const rec = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO ent_products (tenant_id, name, category, price, cost, sku, stock_qty)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [tenantId, body.name, body.category, body.price,
           body.cost ?? null, body.sku ?? null, body.stock_qty ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'BAR', action: 'PRODUCT_CREATED', user_id: req.rlsCtx.userId, record_id: rec.id });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /bar/products/:id ───────────────────────────────────────────────────

barProductsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = PatchProductSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;

    const setCols: string[] = ['updated_at = now()'];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (body.name      !== undefined) setCols.push(`name      = ${push(body.name)}`);
    if (body.category  !== undefined) setCols.push(`category  = ${push(body.category)}`);
    if (body.price     !== undefined) setCols.push(`price     = ${push(body.price)}`);
    if (body.cost      !== undefined) setCols.push(`cost      = ${push(body.cost)}`);
    if (body.sku       !== undefined) setCols.push(`sku       = ${push(body.sku)}`);
    if (body.stock_qty !== undefined) setCols.push(`stock_qty = ${push(body.stock_qty)}`);
    if (body.is_active !== undefined) setCols.push(`is_active = ${push(body.is_active)}`);
    params.push(idP.data.id);

    const client = await entertainmentPool.connect();
    try {
      const rec = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE ent_products SET ${setCols.join(',')} WHERE id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'PRODUCT_NOT_FOUND', 'Product not found.'); return; }
      logger.info({ entity: 'BAR', action: 'PRODUCT_UPDATED', user_id: req.rlsCtx.userId, record_id: rec.id });
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
