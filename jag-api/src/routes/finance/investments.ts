// GET    /api/v1/finance/investments
// POST   /api/v1/finance/investments
// POST   /api/v1/finance/investments/import   — Path 2: direct JSON intake (array of holdings)
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
  'REAL_ESTATE','PRIVATE_EQUITY','CASH_EQUIVALENT','ANNUITY','OTHER',
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
  investment_type:       z.enum(INVESTMENT_TYPES).optional(),
  asset_name:            z.string().min(1).max(200).optional(),
  institution_name:      z.string().max(200).optional(),
  ticker_symbol:         z.string().max(20).optional(),
  units_held:            z.number().min(0).optional(),
  average_cost_per_unit: z.number().positive().optional(),
  current_price:         z.number().positive().optional(),
  current_value_ttd:     z.number().optional(),
  unrealised_gain_ttd:   z.number().optional(),
  maturity_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  last_valued_at:        z.string().datetime().optional(),
  notes:                 z.string().max(2000).optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'At least one field required.' });

// ── POST /investments/import (Path 2 — direct JSON from local script) ─────────
// Accepts an array of holdings so a single investment statement (e.g. JMMB portfolio
// with multiple funds) can be imported in one call.

const ImportInvestmentItemSchema = CreateInvestmentSchema.extend({
  idempotency_key: z.string().min(1).max(200),
});
const ImportInvestmentsSchema = z.object({
  items: z.array(ImportInvestmentItemSchema).min(1).max(100),
}).strict();

investmentsRouter.post('/import', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ImportInvestmentsSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'items array is required (at least 1 holding).'); return; }
    const { items } = parsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    const created: unknown[] = [];
    try {
      for (const b of items) {
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
              ownerId, b.owner_entity_id, b.account_id ?? null,
              b.investment_type, b.asset_name, b.ticker_symbol ?? null,
              b.units_held ?? 0, b.average_cost_per_unit ?? null, b.current_price ?? null,
              b.currency, b.current_value_ttd ?? null, b.unrealised_gain_ttd ?? null,
              b.institution_name ?? null, b.purchase_date ?? null, b.maturity_date ?? null,
              b.notes ?? null,
            ],
          ).then(r => r.rows[0]),
        );
        created.push(rec);
      }
      logger.info({ entity: 'FINANCE', action: 'INVESTMENTS_IMPORTED', user_id: ownerId, count: created.length, source: 'LOCAL_SCRIPT' });
      ok(res, created, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

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
    if (!bodyParsed.success) {
      logger.warn({ entity: 'FINANCE', action: 'INVESTMENT_UPDATE_VALIDATION_FAIL', issues: bodyParsed.error.issues });
      err(res, 422, 'VALIDATION_ERROR', bodyParsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }

    const b = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const ALLOWED = [
      'investment_type','asset_name','institution_name','ticker_symbol',
      'units_held','average_cost_per_unit','current_price','current_value_ttd',
      'unrealised_gain_ttd','maturity_date','last_valued_at','notes',
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
      const row = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const updated = await c.query(
          `UPDATE fin_investments SET ${setClauses.join(', ')}
           WHERE  id = $${params.length}
           RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null);

        if (updated) {
          const asOfDate = updated.last_valued_at
            ? updated.last_valued_at.toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10);
          await c.query(
            `INSERT INTO fin_investment_valuations
               (investment_id, owner_id, as_of_date, units_held, price_per_unit,
                current_value_ttd, unrealised_gain_ttd)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              updated.id, updated.owner_id, asOfDate,
              updated.units_held ?? null,
              updated.current_price ?? null,
              updated.current_value_ttd,
              updated.unrealised_gain_ttd ?? null,
            ],
          );
        }
        return updated;
      });
      if (!row) { err(res, 404, 'NOT_FOUND', 'Investment not found.'); return; }
      logger.info({ entity: 'FINANCE', action: 'INVESTMENT_UPDATED', user_id: ownerId, record_id: row.id });
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /investments/:id/valuations ─────────────────────────────────────────

const AddValuationSchema = z.object({
  as_of_date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  units_held:          z.number().min(0).optional(),
  price_per_unit:      z.number().min(0).optional(),
  current_value_ttd:   z.number(),
  unrealised_gain_ttd: z.number().optional(),
  notes:               z.string().max(2000).optional(),
}).strict();

investmentsRouter.post('/:id/valuations', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }

    const bodyParsed = AddValuationSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      err(res, 422, 'VALIDATION_ERROR', bodyParsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    const b = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        // Verify the investment belongs to this owner
        const inv = await c.query(
          `SELECT id FROM fin_investments WHERE id = $1`,
          [idParsed.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!inv) return null;

        return c.query(
          `INSERT INTO fin_investment_valuations
             (investment_id, owner_id, as_of_date, units_held, price_per_unit,
              current_value_ttd, unrealised_gain_ttd, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING *`,
          [
            idParsed.data.id, ownerId, b.as_of_date,
            b.units_held ?? null, b.price_per_unit ?? null,
            b.current_value_ttd, b.unrealised_gain_ttd ?? null, b.notes ?? null,
          ],
        ).then(r => r.rows[0]);
      });

      if (!row) { err(res, 404, 'NOT_FOUND', 'Investment not found.'); return; }
      logger.info({ entity: 'FINANCE', action: 'VALUATION_ADDED', user_id: ownerId, investment_id: idParsed.data.id, as_of_date: b.as_of_date });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /investments/:id/valuations ──────────────────────────────────────────

investmentsRouter.get('/:id/valuations', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, investment_id, as_of_date, units_held, price_per_unit,
                  current_value_ttd, unrealised_gain_ttd, notes, recorded_at
           FROM   fin_investment_valuations
           WHERE  investment_id = $1
           ORDER  BY as_of_date DESC, recorded_at DESC`,
          [parsed.data.id],
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
