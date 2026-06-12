// GET    /api/v1/properties/:propertyId/utility-accounts
// POST   /api/v1/properties/:propertyId/utility-accounts
// PATCH  /api/v1/properties/:propertyId/utility-accounts/:id
// DELETE /api/v1/properties/:propertyId/utility-accounts/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const utilityAccountsRouter = Router({ mergeParams: true });

const PropertyParam  = z.object({ propertyId: z.string().uuid() });
const RecordParam    = z.object({ propertyId: z.string().uuid(), id: z.string().uuid() });
const UtilityTypeEnum = z.enum(['ELECTRICITY','WATER','GAS','INTERNET','OTHER']);

const PatchSchema = z.object({
  utility_type:   UtilityTypeEnum.optional(),
  provider:       z.string().min(1).max(200).optional(),
  account_number: z.string().max(100).nullable().optional(),
  account_name:   z.string().max(200).nullable().optional(),
  notes:          z.string().max(2000).nullable().optional(),
}).strict();

const CreateSchema = z.object({
  utility_type:   UtilityTypeEnum,
  provider:       z.string().min(1).max(200),
  account_number: z.string().max(100).optional(),
  account_name:   z.string().max(200).optional(),
  notes:          z.string().max(2000).optional(),
}).strict();

// ── GET ───────────────────────────────────────────────────────────────────────

utilityAccountsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PropertyParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, utility_type, provider, account_number, account_name, is_active, notes, created_at
           FROM   prop_utility_accounts
           WHERE  property_id = $1 AND is_active = true
           ORDER  BY utility_type, provider`,
          [parsed.data.propertyId],
        ).then(r => r.rows),
      );
      logger.info({ entity: 'PROPERTIES', action: 'UTILITY_ACCOUNTS_LIST', user_id: req.rlsCtx.userId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST ──────────────────────────────────────────────────────────────────────

utilityAccountsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = PropertyParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const bodyParsed = CreateSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { propertyId } = paramParsed.data;
    const b = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const account = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const prop = await c.query(`SELECT id FROM prop_properties WHERE id = $1 AND is_active = true`, [propertyId]);
        if (prop.rows.length === 0) throw Object.assign(new Error('Property not found.'), { status: 404, code: 'PROPERTY_NOT_FOUND' });

        const result = await c.query(
          `INSERT INTO prop_utility_accounts
             (owner_id, property_id, utility_type, provider, account_number, account_name, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [ownerId, propertyId, b.utility_type, b.provider, b.account_number ?? null, b.account_name ?? null, b.notes ?? null],
        );
        return result.rows[0];
      });

      logger.info({ entity: 'PROPERTIES', action: 'UTILITY_ACCOUNT_CREATED', user_id: ownerId, record_id: account.id });
      ok(res, account, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH ─────────────────────────────────────────────────────────────────────

utilityAccountsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = RecordParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid path parameters.'); return; }

    const bodyParsed = PatchSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    if (Object.keys(bodyParsed.data).length === 0) { err(res, 422, 'VALIDATION_ERROR', 'No fields to update.'); return; }

    const { propertyId, id } = parsed.data;
    const b = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const account = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const sets: string[] = ['last_modified_at = now()'];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (b.utility_type   !== undefined) sets.push(`utility_type = ${push(b.utility_type)}`);
        if (b.provider       !== undefined) sets.push(`provider = ${push(b.provider)}`);
        if (b.account_number !== undefined) sets.push(`account_number = ${push(b.account_number)}`);
        if (b.account_name   !== undefined) sets.push(`account_name = ${push(b.account_name)}`);
        if (b.notes          !== undefined) sets.push(`notes = ${push(b.notes)}`);

        params.push(id, propertyId);
        const idxId   = params.length - 1;
        const idxProp = params.length;

        const result = await c.query(
          `UPDATE prop_utility_accounts SET ${sets.join(', ')} WHERE id = $${idxId} AND property_id = $${idxProp} AND is_active = true RETURNING *`,
          params,
        );
        return result.rows[0] ?? null;
      });

      if (!account) { err(res, 404, 'ACCOUNT_NOT_FOUND', 'Utility account not found.'); return; }
      logger.info({ entity: 'PROPERTIES', action: 'UTILITY_ACCOUNT_UPDATED', user_id: ownerId, record_id: id });
      ok(res, account);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE ────────────────────────────────────────────────────────────────────

utilityAccountsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = RecordParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid path parameters.'); return; }

    const { propertyId, id } = parsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const deleted = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE prop_utility_accounts SET is_active = false, last_modified_at = now()
           WHERE id = $1 AND property_id = $2 AND is_active = true RETURNING id`,
          [id, propertyId],
        ).then(r => r.rows[0] ?? null),
      );

      if (!deleted) { err(res, 404, 'ACCOUNT_NOT_FOUND', 'Utility account not found.'); return; }
      logger.info({ entity: 'PROPERTIES', action: 'UTILITY_ACCOUNT_DELETED', user_id: ownerId, record_id: id });
      ok(res, { id });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
