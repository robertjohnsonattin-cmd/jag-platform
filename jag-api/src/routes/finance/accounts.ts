// GET    /api/v1/finance/accounts
// POST   /api/v1/finance/accounts
// GET    /api/v1/finance/accounts/:id
// PATCH  /api/v1/finance/accounts/:id
// DELETE /api/v1/finance/accounts/:id  (soft-delete: sets is_active = false)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const accountsRouter = Router();

const ACCOUNT_TYPES = [
  'CHEQUING','SAVINGS','CURRENT','CALL_DEPOSIT',
  'CREDIT_CARD','LINE_OF_CREDIT',
  'BROKERAGE','RETIREMENT','MUTUAL_FUND',
  'MORTGAGE','TERM_LOAN','PERSONAL_LOAN',
  'OTHER',
] as const;

const UUIDParam = z.object({ id: z.string().uuid() });

const AccountQuerySchema = z.object({
  owner_entity_id: z.string().uuid().optional(),
  account_type:    z.enum(ACCOUNT_TYPES).optional(),
  currency:        z.string().length(3).optional(),
  is_active:       z.enum(['true','false']).optional(),
}).strict();

const CreateAccountSchema = z.object({
  owner_entity_id:       z.string().uuid(),
  account_name:          z.string().min(1).max(200),
  institution_name:      z.string().min(1).max(200),
  account_type:          z.enum(ACCOUNT_TYPES),
  currency:              z.string().length(3).default('TTD'),
  current_balance:       z.number().default(0),
  credit_limit:          z.number().optional(),
  interest_rate:         z.number().min(0).max(100).optional(),
  account_number_last4:  z.string().length(4).regex(/^\d{4}$/).optional(),
  opened_date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:                 z.string().max(2000).optional(),
}).strict();

const UpdateAccountSchema = z.object({
  account_name:     z.string().min(1).max(200).optional(),
  institution_name: z.string().min(1).max(200).optional(),
  current_balance:  z.number().optional(),
  credit_limit:     z.number().optional(),
  interest_rate:    z.number().min(0).max(100).optional(),
  is_active:        z.boolean().optional(),
  closed_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:            z.string().max(2000).optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'At least one field required.' });

// ── GET /accounts ─────────────────────────────────────────────────────────────

accountsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = AccountQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { owner_entity_id, account_type, currency, is_active } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (owner_entity_id) where.push(`owner_entity_id = ${push(owner_entity_id)}`);
        if (account_type)    where.push(`account_type = ${push(account_type)}`);
        if (currency)        where.push(`currency = ${push(currency.toUpperCase())}`);
        if (is_active !== undefined) where.push(`is_active = ${push(is_active === 'true')}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return c.query(
          `SELECT id, owner_entity_id, account_name, institution_name, account_type,
                  currency, current_balance, credit_limit, interest_rate,
                  account_number_last4, is_active, opened_date, closed_date,
                  last_synced_at, created_at, updated_at
           FROM   fin_accounts ${clause}
           ORDER  BY institution_name, account_name`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /accounts ────────────────────────────────────────────────────────────

accountsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateAccountSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fin_accounts
             (owner_id, owner_entity_id, account_name, institution_name, account_type,
              currency, current_balance, credit_limit, interest_rate,
              account_number_last4, opened_date, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING *`,
          [ownerId, b.owner_entity_id, b.account_name, b.institution_name, b.account_type,
           b.currency, b.current_balance, b.credit_limit ?? null, b.interest_rate ?? null,
           b.account_number_last4 ?? null, b.opened_date ?? null, b.notes ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'FINANCE', action: 'ACCOUNT_CREATED', user_id: ownerId, record_id: rec.id });

      const coreClient = await corePool.connect();
      try {
        await coreClient.query('BEGIN');
        await coreClient.query('SELECT set_config($1,$2,true)', ['app.current_user_id', ownerId]);
        await coreClient.query(
          `INSERT INTO audit_log (user_id, entity, action, record_id, new_values, source)
           VALUES ($1,'FinAccount','CREATE',$2,$3,'API')`,
          [ownerId, rec.id, JSON.stringify({ account_name: b.account_name, institution_name: b.institution_name, account_type: b.account_type, owner_entity_id: b.owner_entity_id })],
        );
        await coreClient.query('COMMIT');
      } catch { await coreClient.query('ROLLBACK'); } finally { coreClient.release(); }

      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /accounts/:id ─────────────────────────────────────────────────────────

accountsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fin_accounts WHERE id = $1`, [parsed.data.id]).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'ACCOUNT_NOT_FOUND', 'Account not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /accounts/:id ───────────────────────────────────────────────────────

accountsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = UUIDParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyParsed = UpdateAccountSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = paramParsed.data;
    const b = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const sets: string[] = ['updated_at = now()'];
        if (b.account_name     !== undefined) sets.push(`account_name = ${push(b.account_name)}`);
        if (b.institution_name !== undefined) sets.push(`institution_name = ${push(b.institution_name)}`);
        if (b.current_balance  !== undefined) sets.push(`current_balance = ${push(b.current_balance)}`);
        if (b.credit_limit     !== undefined) sets.push(`credit_limit = ${push(b.credit_limit)}`);
        if (b.interest_rate    !== undefined) sets.push(`interest_rate = ${push(b.interest_rate)}`);
        if (b.is_active        !== undefined) sets.push(`is_active = ${push(b.is_active)}`);
        if (b.closed_date      !== undefined) sets.push(`closed_date = ${push(b.closed_date)}`);
        if (b.notes            !== undefined) sets.push(`notes = ${push(b.notes)}`);
        params.push(id);
        return c.query(
          `UPDATE fin_accounts SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null);
      });
      if (!rec) { err(res, 404, 'ACCOUNT_NOT_FOUND', 'Account not found.'); return; }
      logger.info({ entity: 'FINANCE', action: 'ACCOUNT_UPDATED', user_id: ownerId, record_id: id });
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /accounts/:id ──────────────────────────────────────────────────────
// Soft-delete only — sets is_active = false. Financial records are never hard-deleted.

accountsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const { ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE fin_accounts SET is_active = false, closed_date = CURRENT_DATE, updated_at = now()
           WHERE id = $1 AND is_active = true
           RETURNING id, account_name`,
          [parsed.data.id],
        ).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'ACCOUNT_NOT_FOUND', 'Account not found or already closed.'); return; }
      logger.info({ entity: 'FINANCE', action: 'ACCOUNT_CLOSED', user_id: ownerId, record_id: parsed.data.id });
      ok(res, { closed: true, id: rec.id, account_name: rec.account_name });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
