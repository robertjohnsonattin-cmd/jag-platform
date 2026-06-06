// GET  /api/v1/properties/pipeline
// POST /api/v1/properties/pipeline
// PATCH /api/v1/properties/pipeline/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const pipelineRouter = Router();

const UUIDParam = z.object({ id: z.string().uuid() });

const PipelineQuerySchema = z.object({
  stage: z.enum(['WATCH','INTERESTED','OFFER_MADE','DUE_DILIGENCE','CONTRACT','ACQUIRED','PASSED']).optional(),
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const PropertyTypeEnum = z.enum(['RESIDENTIAL','COMMERCIAL','LAND','MIXED','AGRICULTURAL']);
const PipelineStageEnum = z.enum(['WATCH','INTERESTED','OFFER_MADE','DUE_DILIGENCE','CONTRACT','ACQUIRED','PASSED']);

const CreatePipelineSchema = z.object({
  name:                    z.string().min(1).max(200),
  address:                 z.string().max(500).optional(),
  property_type:           PropertyTypeEnum,
  asking_price:            z.number().positive().optional(),
  estimated_value:         z.number().positive().optional(),
  currency:                z.string().length(3).default('TTD'),
  lot_size_sqm:            z.number().positive().optional(),
  floor_area_sqm:          z.number().positive().optional(),
  estimated_monthly_rent:  z.number().positive().optional(),
  stage:                   PipelineStageEnum.default('WATCH'),
  source:                  z.enum(['AGENT','PRIVATE_SELLER','AUCTION','ONLINE_LISTING','REFERRAL','OTHER']).optional(),
  agent_name:              z.string().max(100).optional(),
  agent_phone:             z.string().max(30).optional(),
  analysis_notes:          z.string().max(5000).optional(),
}).strict();

const PatchPipelineSchema = z.object({
  stage:                z.enum(['WATCH','INTERESTED','OFFER_MADE','DUE_DILIGENCE','CONTRACT','ACQUIRED','PASSED']).optional(),
  asking_price:         z.number().positive().nullable().optional(),
  estimated_value:      z.number().positive().nullable().optional(),
  estimated_monthly_rent: z.number().positive().nullable().optional(),
  analysis_notes:       z.string().max(5000).nullable().optional(),
  agent_name:           z.string().max(100).nullable().optional(),
  agent_phone:          z.string().max(30).nullable().optional(),
}).strict().refine(o => Object.keys(o).length > 0, { message: 'At least one field required.' });

async function auditLog(ownerId: string, entity: string, action: string, recordId: string, vals: unknown): Promise<void> {
  const client = await corePool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', ownerId]);
    await client.query(
      `INSERT INTO audit_log (user_id, entity, action, record_id, new_values, source) VALUES ($1,$2,$3,$4,$5,'API')`,
      [ownerId, entity, action, recordId, JSON.stringify(vals)],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); } finally { client.release(); }
}

// ── GET /properties/pipeline ──────────────────────────────────────────────────

pipelineRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PipelineQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }

    const { stage, page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const client = await propertiesPool.connect();
    try {
      const { rows, total } = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (stage) conditions.push(`stage = ${push(stage)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await c.query<{ count: string }>(`SELECT count(*) FROM prop_property_pipeline ${where}`, params);
        const dataResult  = await c.query(
          `SELECT id, name, address, property_type, asking_price, estimated_value, currency,
                  lot_size_sqm, floor_area_sqm, estimated_monthly_rent, gross_yield_percent,
                  net_yield_percent, stage, source, agent_name, last_modified_at, created_at
           FROM   prop_property_pipeline ${where}
           ORDER  BY stage ASC, created_at DESC
           LIMIT  ${push(limit)} OFFSET ${push(offset)}`,
          params,
        );
        return { rows: dataResult.rows, total: Number(countResult.rows[0].count) };
      });

      logger.info({ entity: 'PROPERTIES', action: 'PIPELINE_LIST', user_id: req.rlsCtx.userId, count: rows.length });
      ok(res, { pipeline: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /properties/pipeline ─────────────────────────────────────────────────

pipelineRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreatePipelineSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = parsed.data;
    const { userId: ownerId } = req.rlsCtx;

    // Compute gross yield if we have enough data.
    let grossYield: number | null = null;
    if (body.estimated_monthly_rent && body.estimated_value && body.estimated_value > 0) {
      grossYield = ((body.estimated_monthly_rent * 12) / body.estimated_value) * 100;
    }

    const client = await propertiesPool.connect();
    try {
      const newItem = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO prop_property_pipeline
             (owner_id, name, address, property_type, asking_price, estimated_value, currency,
              lot_size_sqm, floor_area_sqm, estimated_monthly_rent, gross_yield_percent,
              stage, source, agent_name, agent_phone, analysis_notes, last_modified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
           RETURNING *`,
          [ownerId, body.name, body.address ?? null, body.property_type,
           body.asking_price ?? null, body.estimated_value ?? null, body.currency,
           body.lot_size_sqm ?? null, body.floor_area_sqm ?? null,
           body.estimated_monthly_rent ?? null, grossYield,
           body.stage, body.source ?? null, body.agent_name ?? null,
           body.agent_phone ?? null, body.analysis_notes ?? null],
        ).then(r => r.rows[0]),
      );

      logger.info({ entity: 'PROPERTIES', action: 'PIPELINE_CREATED', user_id: ownerId, record_id: newItem.id });
      await auditLog(ownerId, 'PropertyPipeline', 'CREATE', newItem.id, body);
      ok(res, newItem, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /properties/pipeline/:id ───────────────────────────────────────────

pipelineRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed   = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }

    const bodyParsed = PatchPipelineSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = idParsed.data;
    const body   = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const setCols: string[] = ['last_modified_at = now()', 'updated_at = now()'];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

    if (body.stage                !== undefined) setCols.push(`stage                 = ${push(body.stage)}`);
    if (body.asking_price         !== undefined) setCols.push(`asking_price          = ${push(body.asking_price)}`);
    if (body.estimated_value      !== undefined) setCols.push(`estimated_value       = ${push(body.estimated_value)}`);
    if (body.estimated_monthly_rent !== undefined) setCols.push(`estimated_monthly_rent = ${push(body.estimated_monthly_rent)}`);
    if (body.analysis_notes       !== undefined) setCols.push(`analysis_notes        = ${push(body.analysis_notes)}`);
    if (body.agent_name           !== undefined) setCols.push(`agent_name            = ${push(body.agent_name)}`);
    if (body.agent_phone          !== undefined) setCols.push(`agent_phone           = ${push(body.agent_phone)}`);

    params.push(id);

    const client = await propertiesPool.connect();
    try {
      const updated = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE prop_property_pipeline SET ${setCols.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null),
      );

      if (!updated) { err(res, 404, 'PIPELINE_ITEM_NOT_FOUND', 'Pipeline item not found.'); return; }

      logger.info({ entity: 'PROPERTIES', action: 'PIPELINE_UPDATED', user_id: ownerId, record_id: id });
      await auditLog(ownerId, 'PropertyPipeline', 'UPDATE', id, body);
      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
