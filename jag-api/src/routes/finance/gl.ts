// General Ledger — Chart of Accounts + Journal Entries
//
// GET    /api/v1/finance/gl/accounts
// POST   /api/v1/finance/gl/accounts
// GET    /api/v1/finance/gl/accounts/:id
// PATCH  /api/v1/finance/gl/accounts/:id
//
// GET    /api/v1/finance/gl/entries
// POST   /api/v1/finance/gl/entries          (creates DRAFT with balanced lines)
// GET    /api/v1/finance/gl/entries/:id
// POST   /api/v1/finance/gl/entries/:id/post (DRAFT → POSTED, validates debit=credit)
// POST   /api/v1/finance/gl/entries/:id/void
//
// GET    /api/v1/finance/gl/entries/:id/lines
//
// GET    /api/v1/finance/gl/trial-balance     (current period debit/credit totals per account)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const glRouter = Router();

// ── Shared schemas ─────────────────────────────────────────────────────────────

const UUIDParam = z.object({ id: z.string().uuid() });

const ACCOUNT_TYPES = ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','OTHER_INCOME','OTHER_EXPENSE'] as const;
const NORMAL_BALANCES = ['DEBIT','CREDIT'] as const;
const ENTRY_STATUSES  = ['DRAFT','POSTED','VOID'] as const;
const ENTRY_SOURCES   = ['MANUAL','BANK_IMPORT','TRANSACTION_SYNC','INTERCOMPANY','PERIOD_CLOSE','ADJUSTMENT'] as const;

// ── Chart of Accounts ──────────────────────────────────────────────────────────

const CreateGlAccountSchema = z.object({
  owner_entity_id:      z.string().uuid(),
  account_code:         z.string().min(1).max(20),
  account_name:         z.string().min(1).max(200),
  account_type:         z.enum(ACCOUNT_TYPES),
  normal_balance:       z.enum(NORMAL_BALANCES),
  parent_id:            z.string().uuid().optional(),
  currency:             z.string().length(3).default('TTD'),
  description:          z.string().max(2000).optional(),
  allow_direct_posting: z.boolean().default(true),
}).strict();

const UpdateGlAccountSchema = z.object({
  account_name:         z.string().min(1).max(200).optional(),
  description:          z.string().max(2000).optional(),
  is_active:            z.boolean().optional(),
  allow_direct_posting: z.boolean().optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'At least one field required.' });

const GlAccountQuerySchema = z.object({
  owner_entity_id: z.string().uuid().optional(),
  account_type:    z.enum(ACCOUNT_TYPES).optional(),
  is_active:       z.enum(['true','false']).optional(),
  parent_id:       z.string().uuid().optional(),
}).strict();

// GET /gl/accounts
glRouter.get('/accounts', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = GlAccountQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { owner_entity_id, account_type, is_active, parent_id } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (owner_entity_id) where.push(`owner_entity_id = ${push(owner_entity_id)}`);
        if (account_type)    where.push(`account_type = ${push(account_type)}`);
        if (is_active !== undefined) where.push(`is_active = ${push(is_active === 'true')}`);
        if (parent_id !== undefined) where.push(`parent_id = ${push(parent_id)}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return c.query(
          `SELECT id, owner_entity_id, account_code, account_name, account_type,
                  normal_balance, parent_id, currency, description, is_active,
                  allow_direct_posting, created_at, updated_at
           FROM   fin_gl_accounts ${clause}
           ORDER  BY account_code`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// POST /gl/accounts
glRouter.post('/accounts', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateGlAccountSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fin_gl_accounts
             (owner_id, owner_entity_id, account_code, account_name, account_type,
              normal_balance, parent_id, currency, description, allow_direct_posting)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [ownerId, b.owner_entity_id, b.account_code, b.account_name, b.account_type,
           b.normal_balance, b.parent_id ?? null, b.currency, b.description ?? null,
           b.allow_direct_posting],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'GL', action: 'ACCOUNT_CREATED', user_id: ownerId, record_id: rec.id });
      ok(res, rec, 201);
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505') {
        err(res, 409, 'DUPLICATE_ACCOUNT_CODE', 'An account with this code already exists for this entity.');
        return;
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// GET /gl/accounts/:id
glRouter.get('/accounts/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fin_gl_accounts WHERE id = $1`, [parsed.data.id]).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'GL_ACCOUNT_NOT_FOUND', 'GL account not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// PATCH /gl/accounts/:id
glRouter.patch('/accounts/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = UUIDParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyParsed = UpdateGlAccountSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = paramParsed.data;
    const b = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const sets = ['updated_at = now()'];
        if (b.account_name         !== undefined) sets.push(`account_name = ${push(b.account_name)}`);
        if (b.description          !== undefined) sets.push(`description = ${push(b.description)}`);
        if (b.is_active            !== undefined) sets.push(`is_active = ${push(b.is_active)}`);
        if (b.allow_direct_posting !== undefined) sets.push(`allow_direct_posting = ${push(b.allow_direct_posting)}`);
        params.push(id);
        return c.query(
          `UPDATE fin_gl_accounts SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null);
      });
      if (!rec) { err(res, 404, 'GL_ACCOUNT_NOT_FOUND', 'GL account not found.'); return; }
      logger.info({ entity: 'GL', action: 'ACCOUNT_UPDATED', user_id: ownerId, record_id: id });
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Journal Entries ────────────────────────────────────────────────────────────

const JournalEntryLineSchema = z.object({
  gl_account_id:   z.string().uuid(),
  line_number:     z.number().int().min(1),
  description:     z.string().max(1000).optional(),
  debit_ttd:       z.number().min(0).default(0),
  credit_ttd:      z.number().min(0).default(0),
  currency:        z.string().length(3).default('TTD'),
  amount_original: z.number().optional(),
  fx_rate_used:    z.number().positive().optional(),
}).strict().refine(
  d => (d.debit_ttd > 0) !== (d.credit_ttd > 0),
  { message: 'Each line must have exactly one of debit_ttd or credit_ttd non-zero.' },
);

const CreateJournalEntrySchema = z.object({
  owner_entity_id: z.string().uuid(),
  entry_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reference:       z.string().max(100).optional(),
  description:     z.string().min(1).max(2000),
  source:          z.enum(ENTRY_SOURCES).default('MANUAL'),
  source_id:       z.string().uuid().optional(),
  currency:        z.string().length(3).default('TTD'),
  idempotency_key: z.string().min(1).max(500),
  lines:           z.array(JournalEntryLineSchema).min(2),
}).strict();

const JeQuerySchema = z.object({
  owner_entity_id: z.string().uuid().optional(),
  status:          z.enum(ENTRY_STATUSES).optional(),
  source:          z.enum(ENTRY_SOURCES).optional(),
  date_from:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period_year:     z.coerce.number().int().optional(),
  period_month:    z.coerce.number().int().min(1).max(12).optional(),
  limit:           z.coerce.number().int().min(1).max(500).default(100),
  offset:          z.coerce.number().int().min(0).default(0),
}).strict();

function assertBalanced(lines: z.infer<typeof JournalEntryLineSchema>[]): void {
  const totalDebit  = lines.reduce((s, l) => s + l.debit_ttd,  0);
  const totalCredit = lines.reduce((s, l) => s + l.credit_ttd, 0);
  // Use integer arithmetic (cents) to avoid floating-point comparison issues
  const debitCents  = Math.round(totalDebit  * 100);
  const creditCents = Math.round(totalCredit * 100);
  if (debitCents !== creditCents) {
    throw Object.assign(
      new Error(`Journal entry is not balanced: debits=${totalDebit.toFixed(2)}, credits=${totalCredit.toFixed(2)}`),
      { status: 422, code: 'ENTRY_NOT_BALANCED' },
    );
  }
}

// GET /gl/entries
glRouter.get('/entries', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = JeQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { owner_entity_id, status, source, date_from, date_to, period_year, period_month, limit, offset } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = [];
        if (owner_entity_id) where.push(`owner_entity_id = ${push(owner_entity_id)}`);
        if (status)          where.push(`status = ${push(status)}`);
        if (source)          where.push(`source = ${push(source)}`);
        if (date_from)       where.push(`entry_date >= ${push(date_from)}`);
        if (date_to)         where.push(`entry_date <= ${push(date_to)}`);
        if (period_year)     where.push(`period_year = ${push(period_year)}`);
        if (period_month)    where.push(`period_month = ${push(period_month)}`);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return c.query(
          `SELECT id, owner_entity_id, entry_date, period_year, period_month,
                  reference, description, status, source, source_id,
                  currency, total_debit_ttd, total_credit_ttd,
                  posted_at, posted_by, idempotency_key, created_at, updated_at
           FROM   fin_journal_entries ${clause}
           ORDER  BY entry_date DESC, created_at DESC
           LIMIT  ${push(limit)} OFFSET ${push(offset)}`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// POST /gl/entries  — creates a DRAFT entry with lines
glRouter.post('/entries', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateJournalEntrySchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const { ownerId } = req.rlsCtx;

    try {
      assertBalanced(b.lines);
    } catch (e: unknown) {
      if (e instanceof Error) {
        const typed = e as Error & { status?: number; code?: string };
        err(res, typed.status ?? 422, typed.code ?? 'ENTRY_NOT_BALANCED', typed.message);
        return;
      }
      throw e;
    }

    const totalDebit  = b.lines.reduce((s, l) => s + l.debit_ttd,  0);
    const totalCredit = b.lines.reduce((s, l) => s + l.credit_ttd, 0);

    const client = await familyPool.connect();
    try {
      const { entry, lines } = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        // Validate all GL accounts exist and belong to this owner
        const accountIds = [...new Set(b.lines.map(l => l.gl_account_id))];
        const acctCheck = await c.query(
          `SELECT id, allow_direct_posting FROM fin_gl_accounts WHERE id = ANY($1::uuid[])`,
          [accountIds],
        );
        if (acctCheck.rows.length !== accountIds.length) {
          throw Object.assign(new Error('One or more GL accounts not found.'), { status: 404, code: 'GL_ACCOUNT_NOT_FOUND' });
        }
        const noPost = acctCheck.rows.filter(r => !r.allow_direct_posting);
        if (noPost.length > 0) {
          throw Object.assign(new Error('One or more accounts do not allow direct posting (summary accounts).'), { status: 422, code: 'ACCOUNT_NO_DIRECT_POSTING' });
        }

        const jeRow = await c.query(
          `INSERT INTO fin_journal_entries
             (owner_id, owner_entity_id, entry_date, reference, description,
              status, source, source_id, currency, total_debit_ttd, total_credit_ttd, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [ownerId, b.owner_entity_id, b.entry_date, b.reference ?? null,
           b.description, b.source, b.source_id ?? null, b.currency,
           totalDebit.toFixed(2), totalCredit.toFixed(2), b.idempotency_key],
        ).then(r => r.rows[0]);

        const lineRows = await Promise.all(b.lines.map(l =>
          c.query(
            `INSERT INTO fin_journal_entry_lines
               (owner_id, journal_entry_id, gl_account_id, line_number, description,
                debit_ttd, credit_ttd, currency, amount_original, fx_rate_used)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING *`,
            [ownerId, jeRow.id, l.gl_account_id, l.line_number, l.description ?? null,
             l.debit_ttd.toFixed(2), l.credit_ttd.toFixed(2), l.currency,
             l.amount_original ?? null, l.fx_rate_used ?? null],
          ).then(r => r.rows[0]),
        ));

        return { entry: jeRow, lines: lineRows };
      });

      logger.info({ entity: 'GL', action: 'ENTRY_CREATED', user_id: ownerId, record_id: entry.id, line_count: lines.length });
      ok(res, { ...entry, lines }, 201);
    } catch (e: unknown) {
      if (e instanceof Error) {
        const typed = e as Error & { status?: number; code?: string };
        if (typed.status) {
          err(res, typed.status, typed.code ?? 'GL_ERROR', typed.message);
          return;
        }
        if (typed.message.includes('idempotency_key')) {
          err(res, 409, 'DUPLICATE_ENTRY', 'A journal entry with this idempotency key already exists.');
          return;
        }
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// GET /gl/entries/:id
glRouter.get('/entries/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const entry = await c.query(
          `SELECT * FROM fin_journal_entries WHERE id = $1`, [parsed.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!entry) return null;
        const lines = await c.query(
          `SELECT * FROM fin_journal_entry_lines WHERE journal_entry_id = $1 ORDER BY line_number`,
          [parsed.data.id],
        ).then(r => r.rows);
        return { ...entry, lines };
      });
      if (!rec) { err(res, 404, 'GL_ENTRY_NOT_FOUND', 'Journal entry not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// POST /gl/entries/:id/post — transitions DRAFT → POSTED
glRouter.post('/entries/:id/post', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const entry = await c.query(
          `SELECT * FROM fin_journal_entries WHERE id = $1`, [parsed.data.id],
        ).then(r => r.rows[0] ?? null);

        if (!entry) throw Object.assign(new Error('Journal entry not found.'), { status: 404, code: 'GL_ENTRY_NOT_FOUND' });
        if (entry.status !== 'DRAFT') throw Object.assign(new Error('Only DRAFT entries can be posted.'), { status: 409, code: 'ENTRY_NOT_DRAFT' });

        // Re-verify balance using stored totals
        const debitCents  = Math.round(Number(entry.total_debit_ttd)  * 100);
        const creditCents = Math.round(Number(entry.total_credit_ttd) * 100);
        if (debitCents !== creditCents) {
          throw Object.assign(
            new Error(`Entry is not balanced: debits=${entry.total_debit_ttd}, credits=${entry.total_credit_ttd}`),
            { status: 422, code: 'ENTRY_NOT_BALANCED' },
          );
        }

        return c.query(
          `UPDATE fin_journal_entries
           SET status = 'POSTED', posted_at = now(), posted_by = $1, updated_at = now()
           WHERE id = $2
           RETURNING *`,
          [ownerId, parsed.data.id],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'GL', action: 'ENTRY_POSTED', user_id: ownerId, record_id: parsed.data.id });

      // Audit trail
      const coreClient = await corePool.connect();
      try {
        await coreClient.query('BEGIN');
        await coreClient.query('SELECT set_config($1,$2,true)', ['app.current_user_id', ownerId]);
        await coreClient.query(
          `INSERT INTO audit_log (user_id, entity, action, record_id, source)
           VALUES ($1,'JournalEntry','POST',$2,'API')`,
          [ownerId, parsed.data.id],
        );
        await coreClient.query('COMMIT');
      } catch { await coreClient.query('ROLLBACK'); } finally { coreClient.release(); }

      ok(res, rec);
    } catch (e: unknown) {
      if (e instanceof Error) {
        const typed = e as Error & { status?: number; code?: string };
        if (typed.status) { err(res, typed.status, typed.code ?? 'GL_ERROR', typed.message); return; }
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// POST /gl/entries/:id/void
glRouter.post('/entries/:id/void', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = UUIDParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyParsed = z.object({ void_reason: z.string().min(1).max(500) }).strict().safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'void_reason is required.'); return; }
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const entry = await c.query(
          `SELECT status FROM fin_journal_entries WHERE id = $1`, [paramParsed.data.id],
        ).then(r => r.rows[0] ?? null);

        if (!entry) throw Object.assign(new Error('Journal entry not found.'), { status: 404, code: 'GL_ENTRY_NOT_FOUND' });
        if (entry.status === 'VOID') throw Object.assign(new Error('Entry is already voided.'), { status: 409, code: 'ENTRY_ALREADY_VOID' });

        return c.query(
          `UPDATE fin_journal_entries
           SET status = 'VOID', void_reason = $1, updated_at = now()
           WHERE id = $2
           RETURNING *`,
          [bodyParsed.data.void_reason, paramParsed.data.id],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'GL', action: 'ENTRY_VOIDED', user_id: ownerId, record_id: paramParsed.data.id });
      ok(res, rec);
    } catch (e: unknown) {
      if (e instanceof Error) {
        const typed = e as Error & { status?: number; code?: string };
        if (typed.status) { err(res, typed.status, typed.code ?? 'GL_ERROR', typed.message); return; }
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// GET /gl/entries/:id/lines
glRouter.get('/entries/:id/lines', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const entry = await c.query(
          `SELECT id FROM fin_journal_entries WHERE id = $1`, [parsed.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!entry) throw Object.assign(new Error('Journal entry not found.'), { status: 404, code: 'GL_ENTRY_NOT_FOUND' });

        return c.query(
          `SELECT jel.*, ga.account_code, ga.account_name, ga.account_type
           FROM   fin_journal_entry_lines jel
           JOIN   fin_gl_accounts ga ON ga.id = jel.gl_account_id
           WHERE  jel.journal_entry_id = $1
           ORDER  BY jel.line_number`,
          [parsed.data.id],
        ).then(r => r.rows);
      });
      ok(res, rows);
    } catch (e: unknown) {
      if (e instanceof Error) {
        const typed = e as Error & { status?: number; code?: string };
        if (typed.status) { err(res, typed.status, typed.code ?? 'GL_ERROR', typed.message); return; }
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── Trial Balance ──────────────────────────────────────────────────────────────

const TrialBalanceQuerySchema = z.object({
  owner_entity_id: z.string().uuid().optional(),
  period_year:     z.coerce.number().int(),
  period_month:    z.coerce.number().int().min(1).max(12).optional(),
}).strict();

// GET /gl/trial-balance?period_year=2026&period_month=6&owner_entity_id=...
glRouter.get('/trial-balance', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = TrialBalanceQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'period_year is required.'); return; }
    const { owner_entity_id, period_year, period_month } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [period_year];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const periodWhere = [`je.period_year = $1`];
        if (period_month) periodWhere.push(`je.period_month = ${push(period_month)}`);
        if (owner_entity_id) periodWhere.push(`je.owner_entity_id = ${push(owner_entity_id)}`);
        const clause = periodWhere.join(' AND ');

        return c.query(
          `SELECT
             ga.id                 AS account_id,
             ga.account_code,
             ga.account_name,
             ga.account_type,
             ga.normal_balance,
             COALESCE(SUM(jel.debit_ttd),  0)::NUMERIC(18,2) AS total_debit,
             COALESCE(SUM(jel.credit_ttd), 0)::NUMERIC(18,2) AS total_credit,
             (COALESCE(SUM(jel.debit_ttd), 0) - COALESCE(SUM(jel.credit_ttd), 0))::NUMERIC(18,2) AS net_debit,
             (COALESCE(SUM(jel.credit_ttd), 0) - COALESCE(SUM(jel.debit_ttd), 0))::NUMERIC(18,2) AS net_credit
           FROM   fin_gl_accounts ga
           LEFT JOIN fin_journal_entry_lines jel ON jel.gl_account_id = ga.id
           LEFT JOIN fin_journal_entries     je  ON je.id = jel.journal_entry_id
                                                AND je.status = 'POSTED'
                                                AND ${clause}
           WHERE  ga.is_active = true
           GROUP  BY ga.id, ga.account_code, ga.account_name, ga.account_type, ga.normal_balance
           ORDER  BY ga.account_code`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
