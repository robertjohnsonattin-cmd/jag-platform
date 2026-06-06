// GET    /api/v1/finance/investments
// POST   /api/v1/finance/investments
// GET    /api/v1/finance/investments/:id
// PATCH  /api/v1/finance/investments/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const investmentsRouter = Router();

const INVESTMENT_TYPES = [
  'EQUITY','BOND','MUTUAL_FUND','ETF','UNIT_TRUST',
  'REAL_ESTATE','PRIVATE_EQUITY','CASH_EQUIVALENT','OTHER',
] as const;

const UUIDParam = z.object({ id: z.string().uuid() });

const InvestmentQuerySchema = z.object({
  owner_entity_id:  z.string().uuid().optional(),
  investment_type:  z.enum(INVESTMENT_TYPES).optional(),
  currency:         z.string().length(3).optional(),
}).strict();

const CreateInvestmentSchema = z.object({
  owner_entity_id:       z.string().uuid(),
  account_id:            z.string().uuid().optional(),
  investment_type:       z.enum(INVESTMENT_TYPES),
  asset_name:            z.string().min(1).max(200),
  ticker_symbol:         z.string().max(20).optional(),
  units_held:            z.number().min(0).default(0),
  average_cost_per_unit: z.number().positive().optional(),
  current_price:         z.number().positive().optional(),
  currency:              z.string().length(3).default('TTD'),
  current_value_ttd:     z.number().optional(),
  unrealised_gain_ttd:   z.number().optional(),
  institution_name:      z.string().max(200).optional(),
  purchase_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  maturity_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:                 z.string().max(2000).optional(),
}).strict();

const UpdateInvestmentSchema = z.object({
  units_held:            z.number().min(0).optional(),
  average_cost_per_unit: z.number().positive().optional(),
  current_price:         z.number().positive().optional(),
  current_value_ttd:     z.number().optional(),
  unrealised_gain_ttd:   z.number().optional(),
  institution_name:      z.string().max(200).optional(),
  ticker_symbol:         z.string().max(20).optional(),
  maturity_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  last_valued_at:        z.string().datetime().optional(),
  notes:                 z.string().max(2000).optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'At least one field required.' });

// ── GET /investments ──────────────────────────────────────────────────────────

investmentsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = InvestmentQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { owner_entity_id, investment_type, currency } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (owner_entity_id) where.push(`owner_entity_id = ${push(owner_entity_id)}`);
        if (investment_type) where.push(`investment_type = ${push(investment_type)}`);
        if (currency)        where.push(`currency = ${push(currency.toUpperCase())}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return c.query(
          `SELECT id, owner_entity_id, account_id, investment_type, asset_name,
                  ticker_symbol, units_held, average_cost_per_unit, current_price,
                  currency, current_value_ttd, unrealised_gain_ttd, institution_name,
                  purchase_date, maturity_date, last_valued_at, created_at, updated_at
           FROM   fin_investments ${clause}
           ORDER  BY asset_name`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /investments ─────────────────────────────────────────────────────────

investmentsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateInvestmentSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fin_investments
             (owner_id, owner_entity_id, account_id, investment_type, asset_name,
              ticker_symbol, units_held, average_cost_per_unit, current_price,
              currency, current_value_ttd, unrealised_gain_ttd, institution_name,
              purchase_date, maturity_date, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           RETURNING *`,
          [
            ownerId, b.owner_entity_id, b.account_id ?? null, b.investment_type, b.asset_name,
            b.ticker_symbol ?? null, b.units_held, b.average_cost_per_unit ?? null,
            b.current_price ?? null, b.currency, b.current_value_ttd ?? null,
            b.unrealised_gain_ttd ?? null, b.institution_name ?? null,
            b.purchase_date ?? null, b.maturity_date ?? null, b.notes ?? null,
          ],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'FINANCE', action: 'INVESTMENT_CREATED', user_id: ownerId, record_id: rec.id });

      const coreClient = await corePool.connect();
      try {
        await coreClient.query('BEGIN');
        await coreClient.query('SELECT set_config($1,$2,true)', ['app.current_user_id', ownerId]);
        await coreClient.query(
          `INSERT INTO audit_log (user_id, entity, action, record_id, new_values, source)
           VALUES ($1,'FinInvestment','CREATE',$2,$3,'API')`,
          [ownerId, rec.id, JSON.stringify({ asset_name: b.asset_name, investment_type: b.investment_type, owner_entity_id: b.owner_entity_id })],
        );
        await coreClient.query('COMMIT');
      } catch { await coreClient.query('ROLLBACK'); } finally { coreClient.release(); }

      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /investments/:id ──────────────────────────────────────────────────────

investmentsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }

    const client = await familyPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT * FROM fin_investments WHERE id = $1`,
          [parsed.data.id],
        ).then(r => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Investment not found.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /investments/:id ────────────────────────────────────────────────────

investmentsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }

    const bodyParsed = UpdateInvestmentSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const b = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const ALLOWED = [
      'units_held','average_cost_per_unit','current_price','current_value_ttd',
      'unrealised_gain_ttd','institution_name','ticker_symbol','maturity_date',
      'last_valued_at','notes',
    ] as const;

    const setClauses: string[] = [];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

    for (const key of ALLOWED) {
      if (key in b) setClauses.push(`${key} = ${push(b[key])}`);
    }
    setClauses.push(`updated_at = now()`);
    params.push(idParsed.data.id);

    const client = await familyPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE fin_investments SET ${setClauses.join(', ')}
           WHERE  id = $${params.length}
           RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Investment not found.'); return; }
      logger.info({ entity: 'FINANCE', action: 'INVESTMENT_UPDATED', user_id: ownerId, record_id: row.id });
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
