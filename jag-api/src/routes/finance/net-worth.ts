// GET  /api/v1/finance/net-worth           — latest snapshot per entity + consolidated
// POST /api/v1/finance/net-worth/snapshot  — compute and store a fresh snapshot

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const netWorthRouter = Router();

const SnapshotQuerySchema = z.object({
  owner_entity_id: z.string().uuid().optional(),
  date_from:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

// Pseudo-UUID used for the CONSOLIDATED row (all entities summed)
const CONSOLIDATED_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

// ── GET /net-worth ────────────────────────────────────────────────────────────
// Returns the most recent snapshot for each entity, plus the CONSOLIDATED row.
// Optionally filter by entity or date range for historical trend data.

netWorthRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = SnapshotQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { owner_entity_id, date_from, date_to } = parsed.data;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        if (date_from || date_to || owner_entity_id) {
          // Historical or filtered query — return all matching rows
          const params: unknown[] = [];
          const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
          const where: string[] = [];
          if (owner_entity_id) where.push(`owner_entity_id = ${push(owner_entity_id)}`);
          if (date_from)       where.push(`snapshot_date >= ${push(date_from)}`);
          if (date_to)         where.push(`snapshot_date <= ${push(date_to)}`);
          const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
          return c.query(
            `SELECT id, owner_entity_id, snapshot_date,
                    total_assets_ttd, total_liabilities_ttd, net_worth_ttd,
                    liquid_assets_ttd, investment_assets_ttd, property_assets_ttd,
                    notes, created_at
             FROM   fin_net_worth_snapshots ${clause}
             ORDER  BY snapshot_date DESC, owner_entity_id`,
            params,
          ).then(r => r.rows);
        }

        // Default: latest snapshot per entity
        return c.query(
          `SELECT DISTINCT ON (owner_entity_id)
                  id, owner_entity_id, snapshot_date,
                  total_assets_ttd, total_liabilities_ttd, net_worth_ttd,
                  liquid_assets_ttd, investment_assets_ttd, property_assets_ttd,
                  notes, created_at
           FROM   fin_net_worth_snapshots
           ORDER  BY owner_entity_id, snapshot_date DESC`,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /net-worth/snapshot ──────────────────────────────────────────────────
// Computes a fresh net worth snapshot from live account/investment/loan balances.
// One row per entity + one CONSOLIDATED row. Idempotent on snapshot_date per entity
// (upserts on the unique constraint).

netWorthRouter.post('/snapshot', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { ownerId } = req.rlsCtx;
    const snapshotDate = new Date().toISOString().slice(0, 10);

    const client = await familyPool.connect();
    try {
      const snapshots = await withOwnerRLS(client, req.rlsCtx, async (c) => {

        // 1. Sum liquid assets (CHEQUING, SAVINGS, CURRENT, CALL_DEPOSIT, CREDIT_CARD, LINE_OF_CREDIT)
        //    by entity. Negative balances (credit cards) count as liabilities below.
        const { rows: acctRows } = await c.query<{
          owner_entity_id: string;
          liquid_balance: string;
          credit_balance: string;
        }>(`
          SELECT owner_entity_id,
                 SUM(CASE WHEN account_type IN ('CHEQUING','SAVINGS','CURRENT','CALL_DEPOSIT')
                           AND current_balance > 0 THEN current_balance ELSE 0 END) AS liquid_balance,
                 SUM(CASE WHEN account_type IN ('CREDIT_CARD','LINE_OF_CREDIT')
                           AND current_balance < 0 THEN ABS(current_balance) ELSE 0 END) AS credit_balance
          FROM  fin_accounts
          WHERE is_active = true
          GROUP BY owner_entity_id
        `);

        // 2. Investment assets by entity
        const { rows: invRows } = await c.query<{
          owner_entity_id: string;
          investment_value: string;
        }>(`
          SELECT owner_entity_id,
                 COALESCE(SUM(current_value_ttd), 0) AS investment_value
          FROM   fin_investments
          GROUP  BY owner_entity_id
        `);

        // 3. Mortgage / loan outstanding balances by entity (liabilities)
        const { rows: loanRows } = await c.query<{
          owner_entity_id: string;
          loan_balance: string;
        }>(`
          SELECT owner_entity_id,
                 COALESCE(SUM(outstanding_balance), 0) AS loan_balance
          FROM   fin_mortgages_loans
          GROUP  BY owner_entity_id
        `);

        // Merge into a per-entity map
        const entities = new Map<string, {
          liquid: number; investment: number; credit_liab: number; loan_liab: number;
        }>();

        const getEnt = (id: string) => {
          if (!entities.has(id)) entities.set(id, { liquid: 0, investment: 0, credit_liab: 0, loan_liab: 0 });
          return entities.get(id)!;
        };

        for (const r of acctRows) {
          const e = getEnt(r.owner_entity_id);
          e.liquid       += Number(r.liquid_balance);
          e.credit_liab  += Number(r.credit_balance);
        }
        for (const r of invRows)  { getEnt(r.owner_entity_id).investment += Number(r.investment_value); }
        for (const r of loanRows) { getEnt(r.owner_entity_id).loan_liab  += Number(r.loan_balance); }

        // 4. Upsert per-entity snapshots
        const upserted: unknown[] = [];
        for (const [entityId, e] of entities.entries()) {
          const totalAssets = e.liquid + e.investment;
          const totalLiab   = e.credit_liab + e.loan_liab;
          const { rows } = await c.query(
            `INSERT INTO fin_net_worth_snapshots
               (owner_id, snapshot_date, owner_entity_id,
                total_assets_ttd, total_liabilities_ttd,
                liquid_assets_ttd, investment_assets_ttd, property_assets_ttd)
             VALUES ($1,$2,$3,$4,$5,$6,$7,0)
             ON CONFLICT (owner_id, owner_entity_id, snapshot_date)
             DO UPDATE SET
               total_assets_ttd      = EXCLUDED.total_assets_ttd,
               total_liabilities_ttd = EXCLUDED.total_liabilities_ttd,
               liquid_assets_ttd     = EXCLUDED.liquid_assets_ttd,
               investment_assets_ttd = EXCLUDED.investment_assets_ttd
             RETURNING *`,
            [ownerId, snapshotDate, entityId, totalAssets, totalLiab, e.liquid, e.investment],
          );
          upserted.push(rows[0]);
        }

        // 5. CONSOLIDATED row — sum across all entities
        if (entities.size > 0) {
          let totalAssets = 0, totalLiab = 0, liquid = 0, investment = 0;
          for (const e of entities.values()) {
            totalAssets += e.liquid + e.investment;
            totalLiab   += e.credit_liab + e.loan_liab;
            liquid      += e.liquid;
            investment  += e.investment;
          }
          const { rows } = await c.query(
            `INSERT INTO fin_net_worth_snapshots
               (owner_id, snapshot_date, owner_entity_id,
                total_assets_ttd, total_liabilities_ttd,
                liquid_assets_ttd, investment_assets_ttd, property_assets_ttd)
             VALUES ($1,$2,$3,$4,$5,$6,$7,0)
             ON CONFLICT (owner_id, owner_entity_id, snapshot_date)
             DO UPDATE SET
               total_assets_ttd      = EXCLUDED.total_assets_ttd,
               total_liabilities_ttd = EXCLUDED.total_liabilities_ttd,
               liquid_assets_ttd     = EXCLUDED.liquid_assets_ttd,
               investment_assets_ttd = EXCLUDED.investment_assets_ttd
             RETURNING *`,
            [ownerId, snapshotDate, CONSOLIDATED_ENTITY_ID, totalAssets, totalLiab, liquid, investment],
          );
          upserted.push(rows[0]);
        }

        return upserted;
      });

      logger.info({ entity: 'FINANCE', action: 'NET_WORTH_SNAPSHOT', user_id: ownerId, snapshot_date: snapshotDate, entity_count: snapshots.length });
      ok(res, { snapshot_date: snapshotDate, snapshots }, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
