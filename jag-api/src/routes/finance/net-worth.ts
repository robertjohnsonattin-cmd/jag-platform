// GET  /api/v1/finance/net-worth           — latest snapshot per entity + consolidated
// POST /api/v1/finance/net-worth/snapshot  — compute and store a fresh snapshot

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS, withTenantRLS } from '../../middleware/rls';
import { familyPool, commercialPool, entertainmentPool, propertiesPool } from '../../db/index';

// All entity tenant UUIDs — used to query cross-DB physical assets
const ENTITY_TENANT_IDS = [
  '00000000-0000-0000-0001-000000000001', // JAG_HOLDINGS
  '00000000-0000-0000-0001-000000000002', // JABCO
  '00000000-0000-0000-0001-000000000003', // JAG_PROPERTIES
  '00000000-0000-0000-0001-000000000004', // JAG_ENTERTAINMENT
  '00000000-0000-0000-0001-000000000005', // JAG_FINANCE
  '00000000-0000-0000-0001-000000000006', // DRAGONBRIDGE
  '00000000-0000-0000-0001-000000000007', // NLCB
];
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

        // Assets owned directly by an individual (fam_ownership_stakes) are attributed to
        // that person, NOT to the holding entity — exclude them here to avoid double counting.
        const { rows: stakeRows } = await c.query<{ subject_kind: string; subject_id: string }>(
          `SELECT DISTINCT subject_kind, subject_id FROM fam_ownership_stakes
           WHERE subject_kind IN ('PROPERTY','ITEM')`,
        );
        const ownedPropertyIds = stakeRows.filter(r => r.subject_kind === 'PROPERTY').map(r => r.subject_id);
        const ownedItemIds     = stakeRows.filter(r => r.subject_kind === 'ITEM').map(r => r.subject_id);

        // Merge into a per-entity map
        const entities = new Map<string, {
          liquid: number; investment: number; credit_liab: number; loan_liab: number; physical: number;
        }>();

        const getEnt = (id: string) => {
          if (!entities.has(id)) entities.set(id, { liquid: 0, investment: 0, credit_liab: 0, loan_liab: 0, physical: 0 });
          return entities.get(id)!;
        };

        for (const r of acctRows) {
          const e = getEnt(r.owner_entity_id);
          e.liquid       += Number(r.liquid_balance);
          e.credit_liab  += Number(r.credit_balance);
        }
        for (const r of invRows)  { getEnt(r.owner_entity_id).investment += Number(r.investment_value); }
        for (const r of loanRows) { getEnt(r.owner_entity_id).loan_liab  += Number(r.loan_balance); }

        // 4. Physical assets — IMS items + vehicles (jag_commercial) per entity
        // 4b. JABCO accounts receivable — certified but unpaid payment certificates
        const commClient = await commercialPool.connect();
        try {
          for (const tenantId of ENTITY_TENANT_IDS) {
            const synCtx = { ...req.rlsCtx, tenantId };
            // Vehicles are stored as ims_items with is_asset=true — no separate vehicle value column.
            // Summing ims_items.unit_value WHERE is_asset=true captures all fixed assets including vehicles.
            const total = await withTenantRLS(commClient, synCtx, async (cc) => {
              const { rows } = await cc.query<{ total: string }>(
                `SELECT COALESCE(SUM(unit_value), 0) AS total
                 FROM ims_items
                 WHERE is_asset = true AND is_active = true
                   AND NOT (id = ANY($1::uuid[]))`,
                [ownedItemIds]);
              return Number(rows[0].total);
            });
            if (total > 0) getEnt(tenantId).physical += total;
          }

          // 4b. JABCO A/R — gross_certified on unpaid payment certificates
          for (const tenantId of ENTITY_TENANT_IDS) {
            const synCtx = { ...req.rlsCtx, tenantId };
            const ar = await withTenantRLS(commClient, synCtx, async (cc) => {
              const { rows } = await cc.query<{ total: string }>(
                `SELECT COALESCE(SUM(gross_certified), 0) AS total
                 FROM jabco_payment_certificates
                 WHERE paid_date IS NULL`,
              );
              return Number(rows[0].total);
            });
            if (ar > 0) getEnt(tenantId).liquid += ar;
          }
        } finally { commClient.release(); }

        // 5. Entertainment — chip float cash + chips on hand, and unsettled tab A/R
        const entClient = await entertainmentPool.connect();
        try {
          const JAG_ENT_TENANT = '00000000-0000-0000-0001-000000000004';
          const synCtx = { ...req.rlsCtx, tenantId: JAG_ENT_TENANT };
          const { floatCash, tabAR } = await withTenantRLS(entClient, synCtx, async (ec) => {
            const [{ rows: floatRows }, { rows: tabRows }] = await Promise.all([
              // Cash + chips in open float sessions (physical assets not yet banked)
              ec.query<{ total: string }>(
                `SELECT COALESCE(SUM(opening_cash + opening_chips), 0) AS total
                 FROM ent_chip_float WHERE status = 'OPEN'`),
              // Closed but unsettled tabs = A/R from customers
              ec.query<{ total: string }>(
                `SELECT COALESCE(SUM(total), 0) AS total
                 FROM ent_tabs WHERE status = 'CLOSED'`),
            ]);
            return { floatCash: Number(floatRows[0].total), tabAR: Number(tabRows[0].total) };
          });
          if (floatCash > 0) getEnt(JAG_ENT_TENANT).physical += floatCash;
          if (tabAR > 0)     getEnt(JAG_ENT_TENANT).liquid  += tabAR;
        } finally { entClient.release(); }

        // 7. Property valuations (jag_properties)
        // prop_properties has no entity/tenant column — owner-scoped only.
        // All valuations are attributed to the JAG_PROPERTIES entity.
        const JAG_PROPERTIES_TENANT = '00000000-0000-0000-0001-000000000003';
        const propClient = await propertiesPool.connect();
        try {
          const propertyTotal = await withOwnerRLS(propClient, req.rlsCtx, async (pc) => {
            const { rows } = await pc.query<{ total: string }>(
              `SELECT COALESCE(SUM(current_valuation), 0) AS total
               FROM prop_properties
               WHERE is_active = true
                 AND NOT (id = ANY($1::uuid[]))`,
              [ownedPropertyIds]);
            return Number(rows[0].total);
          });
          if (propertyTotal > 0) getEnt(JAG_PROPERTIES_TENANT).physical += propertyTotal;
        } finally { propClient.release(); }

        // 8. Upsert per-entity snapshots
        const upserted: unknown[] = [];
        for (const [entityId, e] of entities.entries()) {
          const totalAssets = e.liquid + e.investment + e.physical;
          const totalLiab   = e.credit_liab + e.loan_liab;
          const { rows } = await c.query(
            `INSERT INTO fin_net_worth_snapshots
               (owner_id, snapshot_date, owner_entity_id,
                total_assets_ttd, total_liabilities_ttd,
                liquid_assets_ttd, investment_assets_ttd, property_assets_ttd)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (owner_id, owner_entity_id, snapshot_date)
             DO UPDATE SET
               total_assets_ttd      = EXCLUDED.total_assets_ttd,
               total_liabilities_ttd = EXCLUDED.total_liabilities_ttd,
               liquid_assets_ttd     = EXCLUDED.liquid_assets_ttd,
               investment_assets_ttd = EXCLUDED.investment_assets_ttd,
               property_assets_ttd   = EXCLUDED.property_assets_ttd
             RETURNING *`,
            [ownerId, snapshotDate, entityId, totalAssets, totalLiab, e.liquid, e.investment, e.physical],
          );
          upserted.push(rows[0]);
        }

        // 9. CONSOLIDATED row — sum across all entities
        if (entities.size > 0) {
          let totalAssets = 0, totalLiab = 0, liquid = 0, investment = 0, physical = 0;
          for (const e of entities.values()) {
            totalAssets += e.liquid + e.investment + e.physical;
            totalLiab   += e.credit_liab + e.loan_liab;
            liquid      += e.liquid;
            investment  += e.investment;
            physical    += e.physical;
          }
          const { rows } = await c.query(
            `INSERT INTO fin_net_worth_snapshots
               (owner_id, snapshot_date, owner_entity_id,
                total_assets_ttd, total_liabilities_ttd,
                liquid_assets_ttd, investment_assets_ttd, property_assets_ttd)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (owner_id, owner_entity_id, snapshot_date)
             DO UPDATE SET
               total_assets_ttd      = EXCLUDED.total_assets_ttd,
               total_liabilities_ttd = EXCLUDED.total_liabilities_ttd,
               liquid_assets_ttd     = EXCLUDED.liquid_assets_ttd,
               investment_assets_ttd = EXCLUDED.investment_assets_ttd,
               property_assets_ttd   = EXCLUDED.property_assets_ttd
             RETURNING *`,
            [ownerId, snapshotDate, CONSOLIDATED_ENTITY_ID, totalAssets, totalLiab, liquid, investment, physical],
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
