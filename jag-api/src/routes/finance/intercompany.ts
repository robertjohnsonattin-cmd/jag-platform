// Intercompany Charges + Eliminations
//
// GET    /api/v1/finance/intercompany/charges
// POST   /api/v1/finance/intercompany/charges
// GET    /api/v1/finance/intercompany/charges/:id
// POST   /api/v1/finance/intercompany/charges/:id/post        (DRAFT → POSTED, records GL entries)
// POST   /api/v1/finance/intercompany/charges/:id/eliminate   (POSTED → ELIMINATED, Owner only)
//
// GET    /api/v1/finance/intercompany/eliminations
//
// GET    /api/v1/finance/intercompany/consolidated            (period P&L across all entities minus eliminations)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const intercompanyRouter = Router();

// ── Schemas ────────────────────────────────────────────────────────────────────

const UUIDParam = z.object({ id: z.string().uuid() });

const CHARGE_TYPES = [
  'MANAGEMENT_FEE','LOAN_INTEREST','SHARED_SERVICE','DIVIDEND','RENT','RECHARGE','OTHER',
] as const;

const ChargeQuerySchema = z.object({
  from_entity_id: z.string().uuid().optional(),
  to_entity_id:   z.string().uuid().optional(),
  status:         z.enum(['DRAFT','POSTED','ELIMINATED']).optional(),
  charge_type:    z.enum(CHARGE_TYPES).optional(),
  date_from:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit:          z.coerce.number().int().min(1).max(500).default(100),
  offset:         z.coerce.number().int().min(0).default(0),
}).strict();

const CreateChargeSchema = z.object({
  from_entity_id:  z.string().uuid(),
  to_entity_id:    z.string().uuid(),
  charge_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description:     z.string().min(1).max(2000),
  charge_type:     z.enum(CHARGE_TYPES),
  amount_ttd:      z.number().positive(),
  currency:        z.string().length(3).default('TTD'),
  amount_original: z.number().positive().optional(),
  fx_rate_used:    z.number().positive().optional(),
  notes:           z.string().max(2000).optional(),
  idempotency_key: z.string().min(1).max(500),
}).strict().refine(d => d.from_entity_id !== d.to_entity_id, {
  message: 'from_entity_id and to_entity_id must be different entities.',
});

const PostChargeSchema = z.object({
  from_gl_debit_account_id:  z.string().uuid(),  // receivable / asset in billing entity
  from_gl_credit_account_id: z.string().uuid(),  // revenue / income in billing entity
  to_gl_debit_account_id:    z.string().uuid(),  // expense in receiving entity
  to_gl_credit_account_id:   z.string().uuid(),  // payable / liability in receiving entity
  from_idempotency_key:      z.string().min(1).max(500),
  to_idempotency_key:        z.string().min(1).max(500),
}).strict();

const EliminateChargeSchema = z.object({
  elim_debit_account_id:  z.string().uuid(),  // intercompany revenue account to debit
  elim_credit_account_id: z.string().uuid(),  // intercompany expense account to credit
  idempotency_key:        z.string().min(1).max(500),
  notes:                  z.string().max(2000).optional(),
}).strict();

const ConsolidatedQuerySchema = z.object({
  period_year:  z.coerce.number().int(),
  period_month: z.coerce.number().int().min(1).max(12).optional(),
}).strict();

// ── GET /charges ───────────────────────────────────────────────────────────────

intercompanyRouter.get('/charges', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ChargeQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { from_entity_id, to_entity_id, status, charge_type, date_from, date_to, limit, offset } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (from_entity_id) where.push(`from_entity_id = ${push(from_entity_id)}`);
        if (to_entity_id)   where.push(`to_entity_id = ${push(to_entity_id)}`);
        if (status)         where.push(`status = ${push(status)}`);
        if (charge_type)    where.push(`charge_type = ${push(charge_type)}`);
        if (date_from)      where.push(`charge_date >= ${push(date_from)}`);
        if (date_to)        where.push(`charge_date <= ${push(date_to)}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return c.query(
          `SELECT id, from_entity_id, to_entity_id, charge_date, description, charge_type,
                  amount_ttd, currency, amount_original, fx_rate_used, status,
                  from_gl_entry_id, to_gl_entry_id, notes, idempotency_key, created_at, updated_at
           FROM   fin_intercompany_charges ${clause}
           ORDER  BY charge_date DESC, created_at DESC
           LIMIT  ${push(limit)} OFFSET ${push(offset)}`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /charges ──────────────────────────────────────────────────────────────

intercompanyRouter.post('/charges', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateChargeSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fin_intercompany_charges
             (owner_id, from_entity_id, to_entity_id, charge_date, description, charge_type,
              amount_ttd, currency, amount_original, fx_rate_used, notes, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING *`,
          [ownerId, b.from_entity_id, b.to_entity_id, b.charge_date, b.description, b.charge_type,
           b.amount_ttd, b.currency, b.amount_original ?? null, b.fx_rate_used ?? null,
           b.notes ?? null, b.idempotency_key],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'INTERCOMPANY', action: 'CHARGE_CREATED', user_id: ownerId, record_id: rec.id });
      ok(res, rec, 201);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('idempotency_key')) {
        err(res, 409, 'DUPLICATE_CHARGE', 'A charge with this idempotency key already exists.');
        return;
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /charges/:id ──────────────────────────────────────────────────────────

intercompanyRouter.get('/charges/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fin_intercompany_charges WHERE id = $1`, [parsed.data.id]).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'CHARGE_NOT_FOUND', 'Intercompany charge not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /charges/:id/post ─────────────────────────────────────────────────────
// DRAFT → POSTED: records a GL journal entry in each entity's books.

intercompanyRouter.post('/charges/:id/post', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = UUIDParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyParsed = PostChargeSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = paramParsed.data;
    const b = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const charge = await c.query(
          `SELECT * FROM fin_intercompany_charges WHERE id = $1`, [id],
        ).then(r => r.rows[0] ?? null);
        if (!charge) throw Object.assign(new Error('Charge not found.'), { status: 404, code: 'CHARGE_NOT_FOUND' });
        if (charge.status !== 'DRAFT') throw Object.assign(new Error('Only DRAFT charges can be posted.'), { status: 409, code: 'CHARGE_NOT_DRAFT' });

        const amount = Number(charge.amount_ttd).toFixed(2);
        const desc   = `Intercompany: ${charge.description}`;

        // GL entry in from_entity books (debit receivable, credit revenue)
        const fromJe = await c.query(
          `INSERT INTO fin_journal_entries
             (owner_id, owner_entity_id, entry_date, description, status, source, source_id,
              currency, total_debit_ttd, total_credit_ttd, posted_at, posted_by, idempotency_key)
           VALUES ($1,$2,$3,$4,'POSTED','INTERCOMPANY',$5,'TTD',$6,$7,now(),$1,$8)
           RETURNING id`,
          [ownerId, charge.from_entity_id, charge.charge_date, desc, id, amount, amount, b.from_idempotency_key],
        ).then(r => r.rows[0].id);

        await c.query(
          `INSERT INTO fin_journal_entry_lines
             (owner_id, journal_entry_id, gl_account_id, line_number, description, debit_ttd, credit_ttd)
           VALUES ($1,$2,$3,1,$4,$5,0), ($1,$2,$6,2,$4,0,$5)`,
          [ownerId, fromJe, b.from_gl_debit_account_id, desc, amount, b.from_gl_credit_account_id],
        );

        // GL entry in to_entity books (debit expense, credit payable)
        const toJe = await c.query(
          `INSERT INTO fin_journal_entries
             (owner_id, owner_entity_id, entry_date, description, status, source, source_id,
              currency, total_debit_ttd, total_credit_ttd, posted_at, posted_by, idempotency_key)
           VALUES ($1,$2,$3,$4,'POSTED','INTERCOMPANY',$5,'TTD',$6,$7,now(),$1,$8)
           RETURNING id`,
          [ownerId, charge.to_entity_id, charge.charge_date, desc, id, amount, amount, b.to_idempotency_key],
        ).then(r => r.rows[0].id);

        await c.query(
          `INSERT INTO fin_journal_entry_lines
             (owner_id, journal_entry_id, gl_account_id, line_number, description, debit_ttd, credit_ttd)
           VALUES ($1,$2,$3,1,$4,$5,0), ($1,$2,$6,2,$4,0,$5)`,
          [ownerId, toJe, b.to_gl_debit_account_id, desc, amount, b.to_gl_credit_account_id],
        );

        return c.query(
          `UPDATE fin_intercompany_charges
           SET status = 'POSTED', from_gl_entry_id = $1, to_gl_entry_id = $2, updated_at = now()
           WHERE id = $3
           RETURNING *`,
          [fromJe, toJe, id],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'INTERCOMPANY', action: 'CHARGE_POSTED', user_id: ownerId, record_id: id });
      ok(res, rec);
    } catch (e: unknown) {
      if (e instanceof Error) {
        const typed = e as Error & { status?: number; code?: string };
        if (typed.status) { err(res, typed.status, typed.code ?? 'INTERCOMPANY_ERROR', typed.message); return; }
        if (typed.message.includes('idempotency_key')) {
          err(res, 409, 'DUPLICATE_GL_ENTRY', 'GL entries for this charge already exist.');
          return;
        }
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /charges/:id/eliminate ───────────────────────────────────────────────
// POSTED → ELIMINATED  (Owner only)
// Posts a single elimination GL entry that reverses the intercompany charge
// from the consolidated view.

intercompanyRouter.post('/charges/:id/eliminate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = UUIDParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyParsed = EliminateChargeSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    if (!req.rlsCtx.isOwner) { err(res, 403, 'FORBIDDEN', 'Only the Owner can post eliminations.'); return; }

    const { id } = paramParsed.data;
    const b = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const result = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const charge = await c.query(
          `SELECT * FROM fin_intercompany_charges WHERE id = $1`, [id],
        ).then(r => r.rows[0] ?? null);
        if (!charge) throw Object.assign(new Error('Charge not found.'), { status: 404, code: 'CHARGE_NOT_FOUND' });
        if (charge.status !== 'POSTED') throw Object.assign(new Error('Only POSTED charges can be eliminated.'), { status: 409, code: 'CHARGE_NOT_POSTED' });

        const amount = Number(charge.amount_ttd).toFixed(2);
        const desc   = `Elimination: ${charge.description}`;

        // Elimination entry lives in the CONSOLIDATED entity (00000...000)
        const elimJe = await c.query(
          `INSERT INTO fin_journal_entries
             (owner_id, owner_entity_id, entry_date, description, status, source, source_id,
              currency, total_debit_ttd, total_credit_ttd, posted_at, posted_by, idempotency_key)
           VALUES ($1,'00000000-0000-0000-0000-000000000000',CURRENT_DATE,$2,'POSTED','INTERCOMPANY',$3,
                   'TTD',$4,$5,now(),$1,$6)
           RETURNING id`,
          [ownerId, desc, id, amount, amount, b.idempotency_key],
        ).then(r => r.rows[0].id);

        await c.query(
          `INSERT INTO fin_journal_entry_lines
             (owner_id, journal_entry_id, gl_account_id, line_number, description, debit_ttd, credit_ttd)
           VALUES ($1,$2,$3,1,$4,$5,0), ($1,$2,$6,2,$4,0,$5)`,
          [ownerId, elimJe, b.elim_debit_account_id, desc, amount, b.elim_credit_account_id],
        );

        const elimination = await c.query(
          `INSERT INTO fin_intercompany_eliminations
             (owner_id, charge_id, elimination_date, elimination_gl_entry_id, eliminated_by, notes, idempotency_key)
           VALUES ($1,$2,CURRENT_DATE,$3,$1,$4,$5)
           RETURNING *`,
          [ownerId, id, elimJe, b.notes ?? null, b.idempotency_key],
        ).then(r => r.rows[0]);

        await c.query(
          `UPDATE fin_intercompany_charges SET status = 'ELIMINATED', updated_at = now() WHERE id = $1`,
          [id],
        );

        return { elimination, elimination_gl_entry_id: elimJe };
      });

      logger.info({ entity: 'INTERCOMPANY', action: 'ELIMINATED', user_id: ownerId, record_id: id });

      const coreClient = await corePool.connect();
      try {
        await coreClient.query('BEGIN');
        await coreClient.query('SELECT set_config($1,$2,true)', ['app.current_user_id', ownerId]);
        await coreClient.query(
          `INSERT INTO audit_log (user_id, entity, action, record_id, source)
           VALUES ($1,'IntercompanyCharge','ELIMINATE',$2,'API')`,
          [ownerId, id],
        );
        await coreClient.query('COMMIT');
      } catch { await coreClient.query('ROLLBACK'); } finally { coreClient.release(); }

      ok(res, result.elimination);
    } catch (e: unknown) {
      if (e instanceof Error) {
        const typed = e as Error & { status?: number; code?: string };
        if (typed.status) { err(res, typed.status, typed.code ?? 'INTERCOMPANY_ERROR', typed.message); return; }
        if (typed.message.includes('idempotency_key')) {
          err(res, 409, 'DUPLICATE_ELIMINATION', 'This charge has already been eliminated.');
          return;
        }
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /eliminations ──────────────────────────────────────────────────────────

intercompanyRouter.get('/eliminations', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = z.object({
      period_year:  z.coerce.number().int().optional(),
      period_month: z.coerce.number().int().min(1).max(12).optional(),
      limit:        z.coerce.number().int().min(1).max(500).default(100),
      offset:       z.coerce.number().int().min(0).default(0),
    }).strict().safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { period_year, period_month, limit, offset } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (period_year)  where.push(`period_year = ${push(period_year)}`);
        if (period_month) where.push(`period_month = ${push(period_month)}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return c.query(
          `SELECT ice.*, icc.from_entity_id, icc.to_entity_id, icc.charge_type, icc.amount_ttd
           FROM   fin_intercompany_eliminations ice
           JOIN   fin_intercompany_charges icc ON icc.id = ice.charge_id
           ${clause}
           ORDER  BY ice.elimination_date DESC, ice.created_at DESC
           LIMIT  ${push(limit)} OFFSET ${push(offset)}`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /consolidated ──────────────────────────────────────────────────────────
// Consolidated P&L per entity for the requested period, net of eliminations.
// Requires 005b_fdw_setup.sql to have been applied (superuser migration).
// Falls back gracefully if fdw schema is not available.

intercompanyRouter.get('/consolidated', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ConsolidatedQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'period_year is required.'); return; }
    const { period_year, period_month } = parsed.data;

    const client = await familyPool.connect();
    try {
      const result = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        // Check if fdw schema is available
        const fdwCheck = await c.query(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.schemata WHERE schema_name = 'fdw'
           ) AS fdw_available`,
        ).then(r => r.rows[0].fdw_available as boolean);

        let entityRows: Record<string, unknown>[] = [];

        if (fdwCheck) {
          const params: unknown[] = [period_year];
          const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
          const where = [`period_year = $1`];
          if (period_month) where.push(`period_month = ${push(period_month)}`);

          entityRows = await c.query(
            `SELECT entity_id, entity_name, period_year, period_month,
                    SUM(revenue_ttd)::NUMERIC(18,2)  AS revenue_ttd,
                    SUM(expenses_ttd)::NUMERIC(18,2) AS expenses_ttd,
                    (SUM(revenue_ttd) - SUM(expenses_ttd))::NUMERIC(18,2) AS net_income_ttd
             FROM   fdw.consolidated_pl
             WHERE  ${where.join(' AND ')}
             GROUP  BY entity_id, entity_name, period_year, period_month
             ORDER  BY entity_name, period_year, period_month`,
            params,
          ).then(r => r.rows);
        } else {
          // fdw not set up — return Holdings GL data only
          const params: unknown[] = [period_year];
          const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
          const where = [`je.period_year = $1`, `je.status = 'POSTED'`];
          if (period_month) where.push(`je.period_month = ${push(period_month)}`);

          entityRows = await c.query(
            `SELECT
               je.owner_entity_id                                                               AS entity_id,
               je.period_year,
               je.period_month,
               COALESCE(SUM(CASE WHEN ga.account_type = 'REVENUE'
                                 THEN jel.credit_ttd - jel.debit_ttd ELSE 0 END), 0)::NUMERIC(18,2)  AS revenue_ttd,
               COALESCE(SUM(CASE WHEN ga.account_type IN ('EXPENSE','OTHER_EXPENSE')
                                 THEN jel.debit_ttd - jel.credit_ttd ELSE 0 END), 0)::NUMERIC(18,2)  AS expenses_ttd,
               COALESCE(SUM(CASE WHEN ga.account_type = 'REVENUE'
                                 THEN jel.credit_ttd - jel.debit_ttd
                                 WHEN ga.account_type IN ('EXPENSE','OTHER_EXPENSE')
                                 THEN jel.credit_ttd - jel.debit_ttd
                                 ELSE 0 END), 0)::NUMERIC(18,2)                                      AS net_income_ttd
             FROM   fin_journal_entries je
             JOIN   fin_journal_entry_lines jel ON jel.journal_entry_id = je.id
             JOIN   fin_gl_accounts         ga  ON ga.id = jel.gl_account_id
             WHERE  ${where.join(' AND ')}
             GROUP  BY je.owner_entity_id, je.period_year, je.period_month
             ORDER  BY je.owner_entity_id, je.period_year, je.period_month`,
            params,
          ).then(r => r.rows);
        }

        // Deduct eliminations for the period
        const elimParams: unknown[] = [period_year];
        const elimPush = (v: unknown) => { elimParams.push(v); return `$${elimParams.length}`; };
        const elimWhere = [`ice.period_year = $1`];
        if (period_month) elimWhere.push(`ice.period_month = ${elimPush(period_month)}`);

        const elimRows = await c.query(
          `SELECT icc.from_entity_id, icc.to_entity_id, SUM(icc.amount_ttd)::NUMERIC(18,2) AS eliminated_ttd
           FROM   fin_intercompany_eliminations ice
           JOIN   fin_intercompany_charges icc ON icc.id = ice.charge_id
           WHERE  ${elimWhere.join(' AND ')}
           GROUP  BY icc.from_entity_id, icc.to_entity_id`,
          elimParams,
        ).then(r => r.rows);

        return {
          period_year,
          period_month: period_month ?? null,
          fdw_available: fdwCheck,
          entities: entityRows,
          eliminations: elimRows,
          total_eliminated_ttd: elimRows.reduce((s, r) => s + Number(r.eliminated_ttd), 0).toFixed(2),
        };
      });

      ok(res, result);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
