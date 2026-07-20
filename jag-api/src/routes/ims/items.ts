// GET    /api/v1/ims/locations
// GET    /api/v1/ims/categories
// GET    /api/v1/ims/items
// GET    /api/v1/ims/items/:id
// POST   /api/v1/ims/items
// PATCH  /api/v1/ims/items/:id
// POST   /api/v1/ims/items/:id/dispose  (assets only — marks inactive, writes stock movement, optional GL)
// DELETE /api/v1/ims/items/:id  (Owner only — hard delete if no movements/depreciation)

import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { withTenantRLS, withOwnerRLS, type RLSContext } from '../../middleware/rls';
import { commercialPool, corePool, familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import {
  minioClient, ensureBucket, mediaObjectKey,
  getObjectStream, getObjectStat, deleteObject,
  BUCKET_PHOTOS,
} from '../../lib/minio';

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
});

export const imsItemsRouter = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────

const UUIDParam = z.object({ id: z.string().uuid() });

const ItemsQuerySchema = z.object({
  location_id:  z.string().uuid().optional(),
  category_id:  z.string().uuid().optional(),
  tag_id:       z.string().uuid().optional(),
  is_asset:     z.enum(['true', 'false']).optional(),
  is_active:    z.enum(['true', 'false', 'all']).default('true'),
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
  manufacturer:     z.string().max(100).optional(),
  model_number:     z.string().max(100).optional(),
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
  manufacturer:     z.string().max(100).nullable().optional(),
  model_number:     z.string().max(100).nullable().optional(),
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

// ── POST /locations ───────────────────────────────────────────────────────────

const CreateLocationSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(50).regex(/^[A-Z0-9_]+$/, 'Code must be uppercase letters, digits, underscores'),
  address: z.string().max(500).optional(),
}).strict();

imsItemsRouter.post('/locations', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateLocationSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const { name, code, address } = parsed.data;
    const { tenantId, userId } = req.rlsCtx;
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO ims_locations (tenant_id, code, name, address, last_modified_by)
           VALUES ($1,$2,$3,$4,$5) RETURNING id, code, name, address, is_active, created_at`,
          [tenantId, code, name, address ?? null, userId],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'IMS', action: 'LOCATION_CREATED', user_id: userId, tenant_id: tenantId, record_id: row.id });
      ok(res, row, 201);
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
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (is_active !== 'all') {
          conditions.push(`i.is_active = $${params.push(is_active === 'true')}`);
        }

        if (location_id)  { conditions.push(`i.location_id = $${params.push(location_id)}`); }
        if (category_id)  { conditions.push(`i.category_id = $${params.push(category_id)}`); }
        if (is_asset !== undefined) { conditions.push(`i.is_asset = $${params.push(is_asset === 'true')}`); }
        if (search)       { conditions.push(`(i.name ILIKE $${params.push(`%${search}%`)} OR i.sku ILIKE $${params.push(`%${search}%`)})`); }

        const tagJoin = tag_id
          ? `JOIN ims_item_tags it ON it.item_id = i.id AND it.tag_id = $${params.push(tag_id)}`
          : '';

        const where = conditions.length > 0 ? conditions.join(' AND ') : 'true';

        const countResult = await c.query<{ count: string }>(
          `SELECT count(*) FROM ims_items i ${tagJoin} WHERE ${where}`,
          params,
        );

        const dataParams = [...params, limit, offset];
        const dataResult = await c.query(
          `SELECT i.id, i.name, i.sku, i.description, i.unit_of_measure,
                  i.quantity_on_hand, i.quantity_reserved, i.reorder_point,
                  i.unit_value, i.serial_number, i.manufacturer, i.model_number,
                  i.condition, i.is_asset,
                  i.is_active, i.disposed_at, i.disposal_type, i.disposal_notes,
                  i.sale_price_ttd, i.buyer_name, i.disposal_gl_entry_id,
                  i.last_modified_at, i.created_at,
                  l.name  AS location_name,  l.code AS location_code,
                  cat.name AS category_name,
                  COALESCE(
                    json_agg(DISTINCT jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
                    FILTER (WHERE t.id IS NOT NULL),
                    '[]'
                  ) AS tags,
                  EXISTS(SELECT 1 FROM ims_vehicles v WHERE v.item_id = i.id) AS is_vehicle
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
              serial_number, manufacturer, model_number, condition, is_asset, vat_code, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
            body.manufacturer ?? null,
            body.model_number ?? null,
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

// ── GET /items/low-stock ─────────────────────────────────────────────────────

imsItemsRouter.get('/items/low-stock', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT i.id, i.name, i.sku, i.unit_of_measure,
                  i.quantity_on_hand, i.reorder_point, i.unit_value,
                  i.condition, i.is_asset, i.last_modified_at,
                  l.name  AS location_name, l.code AS location_code,
                  cat.name AS category_name,
                  COALESCE(
                    json_agg(DISTINCT jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
                    FILTER (WHERE t.id IS NOT NULL),
                    '[]'
                  ) AS tags
           FROM   ims_items i
           JOIN   ims_locations  l   ON l.id   = i.location_id
           LEFT JOIN ims_categories cat ON cat.id = i.category_id
           LEFT JOIN ims_item_tags   it ON it.item_id = i.id
           LEFT JOIN ims_tags        t  ON t.id = it.tag_id
           WHERE  i.is_active = true
             AND  i.reorder_point IS NOT NULL
             AND  i.quantity_on_hand <= i.reorder_point
           GROUP BY i.id, l.name, l.code, cat.name
           ORDER BY (i.quantity_on_hand - i.reorder_point) ASC, i.name ASC`,
        ).then(r => r.rows),
      );
      logger.info({ entity: 'IMS', action: 'LOW_STOCK_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId, count: rows.length });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /items/:id/barcodes ──────────────────────────────────────────────────

const AddBarcodeSchema = z.object({
  barcode_value: z.string().min(1).max(100),
  barcode_type:  z.enum(['EAN13', 'EAN8', 'UPC_A', 'CODE128', 'QR', 'CUSTOM']).default('CODE128'),
  is_primary:    z.boolean().default(false),
}).strict();

imsItemsRouter.post('/items/:id/barcodes', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Item ID must be a valid UUID.'); return; }

    const bodyParsed = AddBarcodeSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = idParsed.data;
    const body   = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const barcode = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const item = await c.query('SELECT id FROM ims_items WHERE id = $1 AND is_active = true', [id]);
        if (item.rows.length === 0) return null;

        if (body.is_primary) {
          await c.query('UPDATE ims_barcodes SET is_primary = false WHERE item_id = $1', [id]);
        }

        return c.query(
          `INSERT INTO ims_barcodes (tenant_id, item_id, barcode_value, barcode_type, is_primary)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, barcode_value, barcode_type, is_primary`,
          [tenantId, id, body.barcode_value, body.barcode_type, body.is_primary],
        ).then(r => r.rows[0]);
      });

      if (!barcode) { err(res, 404, 'ITEM_NOT_FOUND', 'Item not found.'); return; }
      logger.info({ entity: 'IMS', action: 'BARCODE_ADDED', user_id: userId, tenant_id: tenantId, record_id: id });
      ok(res, barcode, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /items/:id/barcodes/:barcodeId ─────────────────────────────────────

const BarcodeParams = z.object({ id: z.string().uuid(), barcodeId: z.string().uuid() });

imsItemsRouter.delete('/items/:id/barcodes/:barcodeId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = BarcodeParams.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid parameters.'); return; }

    const { id, barcodeId } = parsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const deleted = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          'DELETE FROM ims_barcodes WHERE id = $1 AND item_id = $2 RETURNING id',
          [barcodeId, id],
        ).then(r => r.rows[0] ?? null),
      );
      if (!deleted) { err(res, 404, 'BARCODE_NOT_FOUND', 'Barcode not found.'); return; }
      logger.info({ entity: 'IMS', action: 'BARCODE_DELETED', user_id: userId, tenant_id: tenantId, record_id: barcodeId });
      ok(res, { deleted: true });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /items/:id/photos ─────────────────────────────────────────────────────

imsItemsRouter.get('/items/:id/photos', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid item ID.'); return; }

    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, storage_path, is_primary, created_at
           FROM   ims_photos WHERE item_id = $1 ORDER BY is_primary DESC, created_at ASC`,
          [parsed.data.id],
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /items/:id/photos ────────────────────────────────────────────────────

imsItemsRouter.post(
  '/items/:id/photos',
  photoUpload.single('photo'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = UUIDParam.safeParse(req.params);
      if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid item ID.'); return; }
      if (!req.file) { err(res, 422, 'NO_FILE', 'No photo attached. Use field name "photo".'); return; }

      const { id } = parsed.data;
      const { userId, tenantId, ownerId } = req.rlsCtx;
      const isPrimary = req.body?.is_primary === 'true';

      const key = mediaObjectKey(ownerId, 'ims', id, req.file.originalname);

      await ensureBucket(BUCKET_PHOTOS);
      await minioClient.putObject(
        BUCKET_PHOTOS, key, req.file.buffer, req.file.size,
        { 'Content-Type': req.file.mimetype },
      );

      const client = await commercialPool.connect();
      try {
        const photo = await withTenantRLS(client, req.rlsCtx, async (c) => {
          const item = await c.query('SELECT id FROM ims_items WHERE id = $1', [id]);
          if (item.rows.length === 0) return null;

          if (isPrimary) {
            await c.query('UPDATE ims_photos SET is_primary = false WHERE item_id = $1', [id]);
          }

          return c.query(
            `INSERT INTO ims_photos (tenant_id, item_id, storage_path, is_primary, uploaded_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id, storage_path, is_primary, created_at`,
            [tenantId, id, key, isPrimary, userId],
          ).then(r => r.rows[0]);
        });

        if (!photo) {
          await deleteObject(BUCKET_PHOTOS, key).catch(() => {});
          err(res, 404, 'ITEM_NOT_FOUND', 'Item not found.'); return;
        }

        logger.info({ entity: 'IMS', action: 'PHOTO_UPLOADED', user_id: userId, tenant_id: tenantId, record_id: id });
        ok(res, photo, 201);
      } finally { client.release(); }
    } catch (e) { next(e); }
  },
);

// ── GET /items/:id/photos/:photoId/download ───────────────────────────────────

const PhotoParams = z.object({ id: z.string().uuid(), photoId: z.string().uuid() });

imsItemsRouter.get('/items/:id/photos/:photoId/download', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PhotoParams.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid parameters.'); return; }

    const { id, photoId } = parsed.data;

    const client = await commercialPool.connect();
    try {
      const photo = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query('SELECT storage_path FROM ims_photos WHERE id = $1 AND item_id = $2', [photoId, id])
          .then(r => r.rows[0] ?? null),
      );

      if (!photo) { err(res, 404, 'PHOTO_NOT_FOUND', 'Photo not found.'); return; }

      let stat: { size: number; contentType: string };
      try { stat = await getObjectStat(BUCKET_PHOTOS, photo.storage_path); }
      catch { err(res, 404, 'FILE_NOT_FOUND', 'File not found in storage.'); return; }

      res.setHeader('Content-Type', stat.contentType);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'private, max-age=3600');

      const stream = await getObjectStream(BUCKET_PHOTOS, photo.storage_path);
      stream.on('error', () => { if (!res.headersSent) res.status(500).end(); });
      stream.pipe(res);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /items/:id/photos/:photoId ─────────────────────────────────────────

imsItemsRouter.delete('/items/:id/photos/:photoId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PhotoParams.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid parameters.'); return; }

    const { id, photoId } = parsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const photo = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          'DELETE FROM ims_photos WHERE id = $1 AND item_id = $2 RETURNING storage_path',
          [photoId, id],
        ).then(r => r.rows[0] ?? null),
      );

      if (!photo) { err(res, 404, 'PHOTO_NOT_FOUND', 'Photo not found.'); return; }

      await deleteObject(BUCKET_PHOTOS, photo.storage_path).catch((e) => {
        logger.warn({ entity: 'IMS', action: 'PHOTO_MINIO_DELETE_FAILED', storage_path: photo.storage_path, error: (e as Error).message });
      });

      logger.info({ entity: 'IMS', action: 'PHOTO_DELETED', user_id: userId, tenant_id: tenantId, record_id: photoId });
      ok(res, { deleted: true });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /valuation ────────────────────────────────────────────────────────────

imsItemsRouter.get('/valuation', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const [byLocation, byCategory, summary] = await withTenantRLS(client, req.rlsCtx, (c) =>
        Promise.all([
          c.query(
            `SELECT l.name AS location_name, l.code AS location_code,
                    COUNT(i.id)::int                            AS item_count,
                    COALESCE(SUM(i.quantity_on_hand * i.unit_value) FILTER (WHERE i.unit_value IS NOT NULL), 0) AS total_value
             FROM   ims_items i JOIN ims_locations l ON l.id = i.location_id
             WHERE  i.is_active = true
             GROUP  BY l.id, l.name, l.code
             ORDER  BY total_value DESC`,
          ).then(r => r.rows),
          c.query(
            `SELECT COALESCE(cat.name, 'Uncategorised') AS category_name,
                    COUNT(i.id)::int                            AS item_count,
                    COALESCE(SUM(i.quantity_on_hand * i.unit_value) FILTER (WHERE i.unit_value IS NOT NULL), 0) AS total_value
             FROM   ims_items i LEFT JOIN ims_categories cat ON cat.id = i.category_id
             WHERE  i.is_active = true
             GROUP  BY cat.name
             ORDER  BY total_value DESC`,
          ).then(r => r.rows),
          c.query(
            `SELECT COUNT(*)::int                                                                             AS total_items,
                    COUNT(*) FILTER (WHERE reorder_point IS NOT NULL AND quantity_on_hand <= reorder_point)::int AS low_stock_count,
                    COUNT(*) FILTER (WHERE quantity_on_hand = 0)::int                                        AS out_of_stock_count,
                    COALESCE(SUM(quantity_on_hand * unit_value) FILTER (WHERE unit_value IS NOT NULL AND is_asset IS NOT TRUE), 0) AS total_stock_value,
                    COALESCE(SUM(quantity_on_hand * unit_value) FILTER (WHERE is_asset = true AND unit_value IS NOT NULL), 0)     AS total_asset_value
             FROM   ims_items WHERE is_active = true`,
          ).then(r => r.rows[0]),
        ]),
      );
      logger.info({ entity: 'IMS', action: 'VALUATION', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId });
      ok(res, { summary, by_location: byLocation, by_category: byCategory });
    } finally { client.release(); }
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
    if (body.manufacturer    !== undefined) setCols.push(`manufacturer     = ${push(body.manufacturer)}`);
    if (body.model_number    !== undefined) setCols.push(`model_number     = ${push(body.model_number)}`);
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

// ── POST /items/:id/dispose ───────────────────────────────────────────────────
// Marks any is_asset=true (non-vehicle) item as disposed:
//   • Sets is_active = false + disposal columns on ims_items
//   • Writes an ims_stock_movements row (SALE or DISPOSAL)
//   • Optionally posts a balanced GL entry to jag_family (non-blocking)

const DisposeItemSchema = z.object({
  disposal_type:          z.enum(['SALE', 'WRITE_OFF', 'TRANSFER']),
  disposal_date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  disposal_notes:         z.string().max(2000).optional(),
  sale_price_ttd:         z.number().min(0).optional(),
  buyer_name:             z.string().max(200).optional(),
  // Optional GL fields — all required together if GL posting is desired
  owner_entity_id:        z.string().uuid().optional(),
  asset_gl_account_id:    z.string().uuid().optional(),
  acc_dep_gl_account_id:  z.string().uuid().optional(),
  proceeds_gl_account_id: z.string().uuid().optional(),
  gain_gl_account_id:     z.string().uuid().optional(),
  loss_gl_account_id:     z.string().uuid().optional(),
}).strict();

imsItemsRouter.post('/items/:id/dispose', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Item ID must be a valid UUID.'); return; }
    const bodyParsed = DisposeItemSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const itemId = idParsed.data.id;
    const b      = bodyParsed.data;
    const { tenantId, userId } = req.rlsCtx;
    const rlsCtx = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // 1. Fetch and validate item
        const itemRow = await c.query(
          `SELECT i.id, i.name, i.is_asset, i.is_active, i.unit_value,
                  i.quantity_on_hand, i.location_id,
                  EXISTS(SELECT 1 FROM ims_vehicles v WHERE v.item_id = i.id) AS is_vehicle
           FROM ims_items i WHERE i.id = $1`,
          [itemId],
        ).then(r => r.rows[0] as {
          id: string; name: string; is_asset: boolean; is_active: boolean;
          unit_value: string | null; quantity_on_hand: number; location_id: string | null;
          is_vehicle: boolean;
        } | undefined);

        if (!itemRow)           throw Object.assign(new Error('Item not found.'), { status: 404, code: 'NOT_FOUND' });
        if (!itemRow.is_asset)  throw Object.assign(new Error('Only capital assets can be disposed through this endpoint.'), { status: 422, code: 'NOT_AN_ASSET' });
        if (itemRow.is_vehicle) throw Object.assign(new Error('Use the vehicle disposal endpoint for vehicles.'), { status: 422, code: 'USE_VMS_DISPOSE' });
        if (!itemRow.is_active) throw Object.assign(new Error('Item is already disposed.'), { status: 409, code: 'ALREADY_DISPOSED' });

        // 2. Fetch depreciation schedule if exists (for accumulated dep + acc_dep GL account)
        const depRow = await c.query(
          `SELECT id, cost_at_start, accumulated_depreciation, net_book_value, acc_dep_gl_account_id
           FROM ims_depreciation_schedules WHERE item_id = $1 AND is_active = true LIMIT 1`,
          [itemId],
        ).then(r => r.rows[0] as {
          id: string; cost_at_start: string; accumulated_depreciation: string;
          net_book_value: string; acc_dep_gl_account_id: string | null;
        } | undefined);

        const costAtDisposal  = parseFloat(String(depRow?.cost_at_start ?? itemRow.unit_value ?? 0));
        const accumulatedDep  = parseFloat(String(depRow?.accumulated_depreciation ?? 0));
        const nbvAtDisposal   = parseFloat(String(depRow?.net_book_value ?? costAtDisposal));
        const salePrice       = b.sale_price_ttd ?? 0;
        const gainLoss        = salePrice - nbvAtDisposal;

        // 3. Mark item disposed
        await c.query(
          `UPDATE ims_items SET
             is_active       = false,
             disposed_at     = now(),
             disposal_type   = $1,
             disposal_notes  = $2,
             sale_price_ttd  = $3,
             buyer_name      = $4,
             quantity_on_hand = GREATEST(quantity_on_hand - 1, 0),
             last_modified_at = now(),
             last_modified_by = $5
           WHERE id = $6`,
          [b.disposal_type, b.disposal_notes ?? null,
           b.disposal_type === 'SALE' ? salePrice : null,
           b.buyer_name ?? null, userId, itemId],
        );

        // 4. Write stock movement
        const movType = b.disposal_type === 'SALE' ? 'SALE' : 'DISPOSAL';
        await c.query(
          `INSERT INTO ims_stock_movements
             (tenant_id, item_id, from_location_id, quantity, movement_type,
              reference_type, sale_price, customer_name, notes, performed_by, idempotency_key)
           VALUES ($1,$2,$3,1,$4,'ASSET_DISPOSAL',$5,$6,$7,$8,gen_random_uuid())`,
          [tenantId, itemId, itemRow.location_id ?? null, movType,
           b.disposal_type === 'SALE' ? salePrice : null,
           b.buyer_name ?? null,
           b.disposal_notes ?? null,
           userId],
        );

        return {
          itemId, itemName: itemRow.name, costAtDisposal, accumulatedDep,
          nbvAtDisposal, salePrice, gainLoss,
          depAccDepAccountId: depRow?.acc_dep_gl_account_id ?? null,
        };
      });

      logger.info({ entity: 'IMS', action: 'ASSET_DISPOSED', user_id: userId, tenant_id: tenantId, item_id: itemId, disposal_type: b.disposal_type });

      // 5. Optional non-blocking GL posting
      const resolvedAccDepAcct = b.acc_dep_gl_account_id ?? result.depAccDepAccountId ?? undefined;
      const canPostGl = b.owner_entity_id && b.asset_gl_account_id && resolvedAccDepAcct && b.disposal_type !== 'TRANSFER';

      if (canPostGl) {
        void postItemDisposalGlEntry({
          itemId,
          itemName: result.itemName,
          disposalDate: b.disposal_date,
          disposalType: b.disposal_type as 'SALE' | 'WRITE_OFF',
          costAtDisposal: result.costAtDisposal,
          accumulatedDep: result.accumulatedDep,
          nbvAtDisposal: result.nbvAtDisposal,
          salePrice: result.salePrice,
          gainLoss: result.gainLoss,
          ownerEntityId: b.owner_entity_id!,
          rlsCtx,
          assetAccountId: b.asset_gl_account_id!,
          accDepAccountId: resolvedAccDepAcct,
          proceedsAccountId: b.proceeds_gl_account_id,
          gainAccountId: b.gain_gl_account_id,
          lossAccountId: b.loss_gl_account_id,
        });
      }

      ok(res, { disposed: true, item_id: itemId, ...result }, 200);
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { res.status(404).json(err(ex.message, ex.code ?? 'NOT_FOUND')); return; }
    if (ex.status === 409) { res.status(409).json(err(ex.message, ex.code ?? 'CONFLICT')); return; }
    if (ex.status === 422) { res.status(422).json(err(ex.message, ex.code ?? 'VALIDATION_ERROR')); return; }
    next(e);
  }
});

// ── Asset disposal GL posting helper ─────────────────────────────────────────

interface ItemDisposalGlArgs {
  itemId:           string;
  itemName:         string;
  disposalDate:     string;
  disposalType:     'SALE' | 'WRITE_OFF';
  costAtDisposal:   number;
  accumulatedDep:   number;
  nbvAtDisposal:    number;
  salePrice:        number;
  gainLoss:         number;
  ownerEntityId:    string;
  rlsCtx:           RLSContext;
  assetAccountId:   string;
  accDepAccountId:  string;
  proceedsAccountId?: string;
  gainAccountId?:   string;
  lossAccountId?:   string;
}

async function postItemDisposalGlEntry(args: ItemDisposalGlArgs): Promise<void> {
  const {
    itemId, itemName, disposalDate, disposalType,
    costAtDisposal, accumulatedDep, nbvAtDisposal, salePrice, gainLoss,
    ownerEntityId, rlsCtx, assetAccountId, accDepAccountId,
    proceedsAccountId, gainAccountId, lossAccountId,
  } = args;
  const { ownerId, userId } = rlsCtx;

  const familyClient = await familyPool.connect();
  try {
    const jeId = await withOwnerRLS(familyClient, rlsCtx, async (c) => {
      const desc = `Asset disposal — ${itemName} — ${disposalType} — ${disposalDate}`;
      const idempotencyKey = `asset_disposal_${itemId}_${disposalDate}`;

      type Line = { accountId: string; debit: number; credit: number; label: string };
      const lines: Line[] = [];

      if (disposalType === 'SALE') {
        if (proceedsAccountId && salePrice > 0)
          lines.push({ accountId: proceedsAccountId, debit: salePrice, credit: 0, label: 'Sale proceeds' });
        if (accumulatedDep > 0)
          lines.push({ accountId: accDepAccountId, debit: accumulatedDep, credit: 0, label: 'Remove accumulated depreciation' });
        lines.push({ accountId: assetAccountId, debit: 0, credit: costAtDisposal, label: 'Remove asset at cost' });
        if (gainLoss > 0 && gainAccountId)
          lines.push({ accountId: gainAccountId, debit: 0, credit: gainLoss, label: 'Gain on disposal' });
        else if (gainLoss < 0 && lossAccountId)
          lines.push({ accountId: lossAccountId, debit: Math.abs(gainLoss), credit: 0, label: 'Loss on disposal' });
      } else {
        // WRITE_OFF
        if (accumulatedDep > 0)
          lines.push({ accountId: accDepAccountId, debit: accumulatedDep, credit: 0, label: 'Remove accumulated depreciation' });
        if (nbvAtDisposal > 0 && lossAccountId)
          lines.push({ accountId: lossAccountId, debit: nbvAtDisposal, credit: 0, label: 'Loss on write-off' });
        lines.push({ accountId: assetAccountId, debit: 0, credit: costAtDisposal, label: 'Remove asset at cost' });
      }

      if (lines.length < 2) {
        logger.warn({ entity: 'IMS', action: 'ASSET_DISPOSAL_GL_SKIP', reason: 'insufficient_accounts', item_id: itemId });
        return null;
      }

      const totalDebit  = lines.reduce((s, l) => s + l.debit,  0);
      const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
      if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
        logger.warn({ entity: 'IMS', action: 'ASSET_DISPOSAL_GL_UNBALANCED', total_debit: totalDebit, total_credit: totalCredit, item_id: itemId });
        return null;
      }

      const je = await c.query(
        `INSERT INTO fin_journal_entries
           (owner_id, owner_entity_id, entry_date, description,
            status, source, source_id, currency,
            total_debit_ttd, total_credit_ttd, idempotency_key, posted_at, posted_by)
         VALUES ($1,$2,$3,$4,'POSTED','ASSET_DISPOSAL',$5,'TTD',$6,$7,$8,now(),$9)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [ownerId, ownerEntityId, disposalDate, desc,
         itemId, totalDebit.toFixed(2), totalCredit.toFixed(2), idempotencyKey, userId],
      );
      if (je.rows.length === 0) return null;

      const jeId = je.rows[0].id as string;
      await Promise.all(lines.map((l, i) =>
        c.query(
          `INSERT INTO fin_journal_entry_lines
             (owner_id, journal_entry_id, gl_account_id, line_number,
              description, debit_ttd, credit_ttd, currency)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'TTD')`,
          [ownerId, jeId, l.accountId, i + 1, l.label, l.debit.toFixed(2), l.credit.toFixed(2)],
        ),
      ));
      return jeId;
    });

    if (!jeId) return;

    // Write JE reference back onto the item (best-effort)
    const updateClient = await commercialPool.connect();
    try {
      await withTenantRLS(updateClient, rlsCtx, (c) =>
        c.query(
          `UPDATE ims_items SET disposal_gl_entry_id = $1, last_modified_at = now() WHERE id = $2`,
          [jeId, itemId],
        ),
      );
    } finally { updateClient.release(); }

    logger.info({ entity: 'IMS', action: 'ASSET_DISPOSAL_GL_POSTED', item_id: itemId, journal_entry_id: jeId });
  } catch (glErr) {
    logger.error({ entity: 'IMS', action: 'ASSET_DISPOSAL_GL_FAILED', item_id: itemId, error: String(glErr) });
  } finally {
    familyClient.release();
  }
}

// ── DELETE /items/:id ─────────────────────────────────────────────────────────
// Owner only. Hard deletes if no movements, stock-take lines, or depreciation exist.
// Also removes any MinIO photos for the item.

imsItemsRouter.delete('/items/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.rlsCtx.isOwner) { err(res, 403, 'FORBIDDEN', 'This action requires Owner role.'); return; }

    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Item ID must be a valid UUID.'); return; }

    const { id } = idParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const commClient = await commercialPool.connect();
    try {
      const photoPaths = await withTenantRLS(commClient, req.rlsCtx, async (c) => {
        const item = await c.query(
          `SELECT id, name FROM ims_items WHERE id = $1`, [id],
        ).then(r => r.rows[0] ?? null);
        if (!item) throw Object.assign(new Error('Item not found.'), { status: 404, code: 'ITEM_NOT_FOUND' });

        const deps = await c.query<{ movements: string; stock_take_lines: string; depreciation: string }>(
          `SELECT
             (SELECT count(*) FROM ims_stock_movements       WHERE item_id = $1) AS movements,
             (SELECT count(*) FROM ims_stock_take_lines      WHERE item_id = $1) AS stock_take_lines,
             (SELECT count(*) FROM ims_depreciation_schedules WHERE item_id = $1) AS depreciation`,
          [id],
        ).then(r => r.rows[0]);

        const blocking: Record<string, number> = {};
        for (const [k, v] of Object.entries(deps)) {
          const n = Number(v);
          if (n > 0) blocking[k] = n;
        }
        if (Object.keys(blocking).length > 0) {
          throw Object.assign(
            new Error('Item has dependent records and cannot be deleted.'),
            { status: 409, code: 'DEPENDENCY_EXISTS', blocking },
          );
        }

        const photos = await c.query<{ storage_path: string }>(
          `SELECT storage_path FROM ims_photos WHERE item_id = $1`, [id],
        ).then(r => r.rows.map(p => p.storage_path));

        await c.query(`DELETE FROM ims_photos   WHERE item_id = $1`, [id]);
        await c.query(`DELETE FROM ims_barcodes WHERE item_id = $1`, [id]);
        await c.query(`DELETE FROM ims_items    WHERE id = $1`, [id]);
        return photos;
      });

      // Remove MinIO photos outside the transaction — best-effort, non-fatal.
      for (const path of photoPaths) {
        try { await deleteObject(BUCKET_PHOTOS, path); } catch { /* ignore */ }
      }

      const coreClient = await corePool.connect();
      try {
        await coreClient.query('BEGIN');
        await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenantId]);
        await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
        await coreClient.query(
          `INSERT INTO audit_log (tenant_id, user_id, entity, action, record_id, new_values, source)
           VALUES ($1, $2, 'InventoryItem', 'DELETE', $3, $4, 'API')`,
          [tenantId, userId, id, JSON.stringify({ id })],
        );
        await coreClient.query('COMMIT');
      } catch { await coreClient.query('ROLLBACK'); } finally { coreClient.release(); }

      logger.info({ entity: 'IMS', action: 'ITEM_DELETED', user_id: userId, tenant_id: tenantId, record_id: id });
      ok(res, { deleted: true, id });
    } finally { commClient.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; blocking?: Record<string, number>; message: string };
    if (ex.status === 404) { err(res, 404, 'ITEM_NOT_FOUND', ex.message); return; }
    if (ex.status === 409) { res.status(409).json({ success: false, data: null, error: ex.message, code: ex.code, blocking: ex.blocking }); return; }
    next(e);
  }
});
