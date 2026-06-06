// GET  /api/v1/ims/locations
// GET  /api/v1/ims/categories
// GET  /api/v1/ims/items
// GET  /api/v1/ims/items/:id
// POST /api/v1/ims/items
// PATCH /api/v1/ims/items/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const imsItemsRouter = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────

const UUIDParam = z.object({ id: z.string().uuid() });

const ItemsQuerySchema = z.object({
  location_id:  z.string().uuid().optional(),
  category_id:  z.string().uuid().optional(),
  tag_id:       z.string().uuid().optional(),
  is_asset:     z.enum(['true', 'false']).optional(),
  is_active:    z.enum(['true', 'false']).default('true'),
  search:       z.string().max(100).optional(),
  page:         z.coerce.number().int().min(1).default(1),
  limit:        z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const ConditionEnum = z.enum(['NEW', 'GOOD', 'FAIR', 'POOR', 'WRITTEN_OFF']);
const VatCodeEnum   = z.enum(['STANDARD', 'ZERO', 'EXEMPT']);

const CreateItemSchema = z.object({
  name:             z.string().min(1).max(200),
  location_id:      z.string().uuid(),
  unit_of_measure:  z.string().min(1).max(20).default('each'),
  description:      z.string().max(1000).optional(),
  sku:              z.string().min(1).max(50).optional(),
  category_id:      z.string().uuid().optional(),
  quantity_on_hand: z.number().min(0).default(0),
  reorder_point:    z.number().min(0).optional(),
  unit_value:       z.number().min(0).optional(),
  serial_number:    z.string().max(100).optional(),
  condition:        ConditionEnum.default('GOOD'),
  is_asset:         z.boolean().default(false),
  vat_code:         VatCodeEnum.default('STANDARD'),
}).strict();

const PatchItemSchema = z.object({
  name:             z.string().min(1).max(200).optional(),
  location_id:      z.string().uuid().optional(),
  description:      z.string().max(1000).optional(),
  unit_of_measure:  z.string().min(1).max(20).optional(),
  quantity_on_hand: z.number().min(0).optional(),
  reorder_point:    z.number().min(0).nullable().optional(),
  unit_value:       z.number().min(0).nullable().optional(),
  serial_number:    z.string().max(100).nullable().optional(),
  condition:        ConditionEnum.optional(),
  is_active:        z.boolean().optional(),
  vat_code:         VatCodeEnum.optional(),
}).strict().refine(obj => Object.keys(obj).length > 0, {
  message: 'At least one field must be provided.',
});

// ── GET /locations ────────────────────────────────────────────────────────────

imsItemsRouter.get('/locations', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, code, name, address, is_active, last_modified_at, created_at
           FROM   ims_locations
           WHERE  is_active = true
           ORDER  BY name ASC`,
        ).then(r => r.rows),
      );
      logger.info({ entity: 'IMS', action: 'LOCATIONS_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /categories ───────────────────────────────────────────────────────────
// Returns flat list; client builds tree using parent_category_id.

imsItemsRouter.get('/categories', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, name, parent_category_id, description, last_modified_at, created_at
           FROM   ims_categories
           ORDER  BY name ASC`,
        ).then(r => r.rows),
      );
      logger.info({ entity: 'IMS', action: 'CATEGORIES_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /items ────────────────────────────────────────────────────────────────

imsItemsRouter.get('/items', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ItemsQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }

    const { location_id, category_id, tag_id, is_asset, is_active, search, page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const client = await commercialPool.connect();
    try {
      const { rows, total } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Build WHERE conditions dynamically
        const conditions: string[] = ['i.is_active = $1'];
        const params: unknown[] = [is_active === 'true'];

        if (location_id)  { conditions.push(`i.location_id = $${params.push(location_id)}`); }
        if (category_id)  { conditions.push(`i.category_id = $${params.push(category_id)}`); }
        if (is_asset !== undefined) { conditions.push(`i.is_asset = $${params.push(is_asset === 'true')}`); }
        if (search)       { conditions.push(`(i.name ILIKE $${params.push(`%${search}%`)} OR i.sku ILIKE $${params.push(`%${search}%`)})`); }

        const tagJoin = tag_id
          ? `JOIN ims_item_tags it ON it.item_id = i.id AND it.tag_id = $${params.push(tag_id)}`
          : '';

        const where = conditions.join(' AND ');

        const countResult = await c.query<{ count: string }>(
          `SELECT count(*) FROM ims_items i ${tagJoin} WHERE ${where}`,
          params,
        );

        const dataParams = [...params, limit, offset];
        const dataResult = await c.query(
          `SELECT i.id, i.name, i.sku, i.description, i.unit_of_measure,
                  i.quantity_on_hand, i.quantity_reserved, i.reorder_point,
                  i.unit_value, i.serial_number, i.condition, i.is_asset,
                  i.is_active, i.last_modified_at, i.created_at,
                  l.name  AS location_name,  l.code AS location_code,
                  cat.name AS category_name,
                  COALESCE(
                    json_agg(DISTINCT jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
                    FILTER (WHERE t.id IS NOT NULL),
                    '[]'
                  ) AS tags
           FROM   ims_items i
           JOIN   ims_locations  l   ON l.id   = i.location_id
           LEFT JOIN ims_categories cat ON cat.id = i.category_id
           LEFT JOIN ims_item_tags   it2 ON it2.item_id = i.id
           LEFT JOIN ims_tags        t   ON t.id = it2.tag_id
           ${tagJoin}
           WHERE ${where}
           GROUP BY i.id, l.name, l.code, cat.name
           ORDER BY i.name ASC
           LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
          dataParams,
        );

        return { rows: dataResult.rows, total: Number(countResult.rows[0].count) };
      });

      logger.info({ entity: 'IMS', action: 'ITEMS_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId, count: rows.length });
      ok(res, { items: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /items/:id ────────────────────────────────────────────────────────────

imsItemsRouter.get('/items/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Item ID must be a valid UUID.'); return; }

    const client = await commercialPool.connect();
    try {
      const item = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const [itemResult, tagsResult, barcodesResult, vehicleResult] = await Promise.all([
          c.query(
            `SELECT i.*, l.name AS location_name, l.code AS location_code,
                    cat.name AS category_name
             FROM   ims_items i
             JOIN   ims_locations  l   ON l.id   = i.location_id
             LEFT JOIN ims_categories cat ON cat.id = i.category_id
             WHERE  i.id = $1`,
            [parsed.data.id],
          ),
          c.query(
            `SELECT t.id, t.name, t.color
             FROM   ims_item_tags it JOIN ims_tags t ON t.id = it.tag_id
             WHERE  it.item_id = $1`,
            [parsed.data.id],
          ),
          c.query(
            `SELECT id, barcode_value, barcode_type, is_primary
             FROM   ims_barcodes WHERE item_id = $1 ORDER BY is_primary DESC`,
            [parsed.data.id],
          ),
          c.query(
            `SELECT * FROM ims_vehicles WHERE item_id = $1 LIMIT 1`,
            [parsed.data.id],
          ),
        ]);

        if (itemResult.rows.length === 0) return null;
        return {
          ...itemResult.rows[0],
          tags:     tagsResult.rows,
          barcodes: barcodesResult.rows,
          vehicle:  vehicleResult.rows[0] ?? null,
        };
      });

      if (!item) { err(res, 404, 'ITEM_NOT_FOUND', 'Item not found.'); return; }
      logger.info({ entity: 'IMS', action: 'ITEM_GET', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId, record_id: parsed.data.id });
      ok(res, item);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /items ───────────────────────────────────────────────────────────────

imsItemsRouter.post('/items', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateItemSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = parsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const commClient = await commercialPool.connect();
    try {
      const newItem = await withTenantRLS(commClient, req.rlsCtx, (c) =>
        c.query<{ id: string }>(
          `INSERT INTO ims_items
             (tenant_id, location_id, category_id, name, description, sku,
              unit_of_measure, quantity_on_hand, reorder_point, unit_value,
              serial_number, condition, is_asset, vat_code, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING id`,
          [
            tenantId,
            body.location_id,
            body.category_id ?? null,
            body.name,
            body.description ?? null,
            body.sku ?? null,
            body.unit_of_measure,
            body.quantity_on_hand,
            body.reorder_point ?? null,
            body.unit_value ?? null,
            body.serial_number ?? null,
            body.condition,
            body.is_asset,
            body.vat_code,
            userId,
          ],
        ).then(r => r.rows[0]),
      );

      logger.info({ entity: 'IMS', action: 'ITEM_CREATED', user_id: userId, tenant_id: tenantId, record_id: newItem.id });

      // Audit log — best-effort via corePool (cross-DB; see Phase 2 outbox uplift).
      const coreClient = await corePool.connect();
      try {
        await coreClient.query('BEGIN');
        await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenantId]);
        await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
        await coreClient.query(
          `INSERT INTO audit_log (tenant_id, user_id, entity, action, record_id, new_values, source)
           VALUES ($1, $2, 'InventoryItem', 'CREATE', $3, $4, 'API')`,
          [tenantId, userId, newItem.id, JSON.stringify(body)],
        );
        await coreClient.query('COMMIT');
      } catch (auditErr) {
        await coreClient.query('ROLLBACK');
        logger.warn({ entity: 'IMS', action: 'AUDIT_LOG_FAILED', error_message: (auditErr as Error).message, record_id: newItem.id });
      } finally { coreClient.release(); }

      ok(res, { id: newItem.id }, 201);
    } finally { commClient.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /items/:id ──────────────────────────────────────────────────────────

imsItemsRouter.patch('/items/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Item ID must be a valid UUID.'); return; }

    const bodyParsed = PatchItemSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = idParsed.data;
    const body   = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    // Build SET clause from provided fields only (partial update).
    const setCols: string[] = ['last_modified_by = $1', 'last_modified_at = now()', 'updated_at = now()'];
    const setParams: unknown[] = [userId];
    const push = (val: unknown) => { setParams.push(val); return `$${setParams.length}`; };

    if (body.name            !== undefined) setCols.push(`name             = ${push(body.name)}`);
    if (body.location_id     !== undefined) setCols.push(`location_id      = ${push(body.location_id)}`);
    if (body.description     !== undefined) setCols.push(`description      = ${push(body.description)}`);
    if (body.unit_of_measure !== undefined) setCols.push(`unit_of_measure  = ${push(body.unit_of_measure)}`);
    if (body.quantity_on_hand!== undefined) setCols.push(`quantity_on_hand = ${push(body.quantity_on_hand)}`);
    if (body.reorder_point   !== undefined) setCols.push(`reorder_point    = ${push(body.reorder_point)}`);
    if (body.unit_value      !== undefined) setCols.push(`unit_value       = ${push(body.unit_value)}`);
    if (body.serial_number   !== undefined) setCols.push(`serial_number    = ${push(body.serial_number)}`);
    if (body.condition       !== undefined) setCols.push(`condition        = ${push(body.condition)}`);
    if (body.is_active       !== undefined) setCols.push(`is_active        = ${push(body.is_active)}`);
    if (body.vat_code        !== undefined) setCols.push(`vat_code         = ${push(body.vat_code)}`);

    setParams.push(id);
    const idPlaceholder = `$${setParams.length}`;

    const commClient = await commercialPool.connect();
    try {
      const updated = await withTenantRLS(commClient, req.rlsCtx, (c) =>
        c.query(
          `UPDATE ims_items SET ${setCols.join(', ')} WHERE id = ${idPlaceholder} RETURNING *`,
          setParams,
        ).then(r => r.rows[0] ?? null),
      );

      if (!updated) { err(res, 404, 'ITEM_NOT_FOUND', 'Item not found.'); return; }

      logger.info({ entity: 'IMS', action: 'ITEM_UPDATED', user_id: userId, tenant_id: tenantId, record_id: id });

      // Audit log — best-effort via corePool.
      const coreClient = await corePool.connect();
      try {
        await coreClient.query('BEGIN');
        await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenantId]);
        await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
        await coreClient.query(
          `INSERT INTO audit_log (tenant_id, user_id, entity, action, record_id, new_values, source)
           VALUES ($1, $2, 'InventoryItem', 'UPDATE', $3, $4, 'API')`,
          [tenantId, userId, id, JSON.stringify(body)],
        );
        await coreClient.query('COMMIT');
      } catch (auditErr) {
        await coreClient.query('ROLLBACK');
        logger.warn({ entity: 'IMS', action: 'AUDIT_LOG_FAILED', error_message: (auditErr as Error).message, record_id: id });
      } finally { coreClient.release(); }

      ok(res, updated);
    } finally { commClient.release(); }
  } catch (e) { next(e); }
});
