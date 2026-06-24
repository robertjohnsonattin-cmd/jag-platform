// Beneficial-ownership cap table + per-person estate rollup (succession).
//
// GET    /api/v1/family/ownership                 — all stakes
// POST   /api/v1/family/ownership                 — create a stake
// PATCH  /api/v1/family/ownership/:id             — edit percent / label / notes
// DELETE /api/v1/family/ownership/:id             — remove a stake
// GET    /api/v1/family/ownership/allocation      — Σ percent per subject (flag ≠100%)
// GET    /api/v1/family/ownership/subjects        — assignable subjects (entities + properties + items)
// GET    /api/v1/family/members/:id/holdings       — one person's estate rollup
//
// Ownership is a cap table: each row = a family member owns N% of an ENTITY, PROPERTY or ITEM.
// A person's estate share of an ENTITY = percent × that entity's net_worth_ttd (latest snapshot).
// PROPERTY/ITEM stakes are valued by the asset's own value × percent and are excluded from their
// entity's net-worth total (see routes/finance/net-worth.ts) to avoid double counting.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { withOwnerRLS, withTenantRLS } from '../../middleware/rls';
import { familyPool, propertiesPool, commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const ownershipRouter = Router();
ownershipRouter.use(requireAuth());
ownershipRouter.use(brianPortalGate('FAMILY'));

// ── Known owner-entities (business tenants 001-007 + personal finance entities 008-013) ──────────
const OWNER_ENTITIES: { id: string; label: string; group: 'BUSINESS' | 'PERSONAL' }[] = [
  { id: '00000000-0000-0000-0001-000000000001', label: 'JAG Holdings',       group: 'BUSINESS' },
  { id: '00000000-0000-0000-0001-000000000002', label: 'JABCO',              group: 'BUSINESS' },
  { id: '00000000-0000-0000-0001-000000000003', label: 'JAG Properties',     group: 'BUSINESS' },
  { id: '00000000-0000-0000-0001-000000000004', label: 'JAG Entertainment',  group: 'BUSINESS' },
  { id: '00000000-0000-0000-0001-000000000005', label: 'JAG Finance',        group: 'BUSINESS' },
  { id: '00000000-0000-0000-0001-000000000006', label: 'DragonBridge',       group: 'BUSINESS' },
  { id: '00000000-0000-0000-0001-000000000007', label: 'NLCB',               group: 'BUSINESS' },
  { id: '00000000-0000-0000-0001-000000000008', label: 'Personal — Robert',  group: 'PERSONAL' },
  { id: '00000000-0000-0000-0001-000000000009', label: 'Isabella Johnson-Attin', group: 'PERSONAL' },
  { id: '00000000-0000-0000-0001-000000000010', label: 'Phillip Ajack Johnson-Attin', group: 'PERSONAL' },
  { id: '00000000-0000-0000-0001-000000000011', label: 'Brian Johnson-Attin', group: 'PERSONAL' },
  { id: '00000000-0000-0000-0001-000000000012', label: 'Zhanghua Chang',     group: 'PERSONAL' },
  { id: '00000000-0000-0000-0001-000000000013', label: 'Theresa Johnson-Attin', group: 'PERSONAL' },
];

// Business tenants — used to enumerate IMS items across tenant RLS contexts.
const ENTITY_TENANT_IDS = OWNER_ENTITIES.filter(e => e.group === 'BUSINESS').map(e => e.id);

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateStakeSchema = z.object({
  family_member_id:  z.string().uuid(),
  subject_kind:      z.enum(['ENTITY', 'PROPERTY', 'ITEM']),
  subject_id:        z.string().min(1).max(100),
  subject_label:     z.string().min(1).max(200),
  ownership_percent: z.number().gt(0).max(100),
  notes:             z.string().max(2000).optional(),
}).strict();

const PatchStakeSchema = z.object({
  ownership_percent: z.number().gt(0).max(100).optional(),
  subject_label:     z.string().min(1).max(200).optional(),
  notes:             z.string().max(2000).nullable().optional(),
}).strict().refine(o => Object.keys(o).length > 0, { message: 'At least one field required.' });

const num = (v: unknown) => parseFloat(String(v ?? 0));

// ── GET /ownership ──────────────────────────────────────────────────────────────
ownershipRouter.get('/ownership', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, family_member_id, subject_kind, subject_id, subject_label,
                  ownership_percent, notes, created_at
           FROM   fam_ownership_stakes
           ORDER  BY subject_kind, subject_label`,
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /ownership/allocation ─────────────────────────────────────────────────
// Σ percent per subject — lets the UI flag subjects whose owners don't sum to 100%.
ownershipRouter.get('/ownership/allocation', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT subject_kind, subject_id, MAX(subject_label) AS subject_label,
                  SUM(ownership_percent) AS allocated_percent, COUNT(*) AS owner_count
           FROM   fam_ownership_stakes
           GROUP  BY subject_kind, subject_id`,
        ).then(r => r.rows),
      );
      ok(res, rows.map(r => ({
        subject_kind:      r.subject_kind,
        subject_id:        r.subject_id,
        subject_label:     r.subject_label,
        allocated_percent: num(r.allocated_percent),
        owner_count:       Number(r.owner_count),
      })));
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /ownership/subjects ───────────────────────────────────────────────────
// Assignable subjects for the picker: known entities + properties + fixed-asset items.
ownershipRouter.get('/ownership/subjects', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const entities = OWNER_ENTITIES.map(e => ({
      kind: 'ENTITY' as const, id: e.id, label: e.label, group: e.group,
    }));

    // Properties (jag_properties)
    const propClient = await propertiesPool.connect();
    let properties: { kind: 'PROPERTY'; id: string; label: string; value: number }[] = [];
    try {
      properties = await withOwnerRLS(propClient, req.rlsCtx, async (pc) => {
        const { rows } = await pc.query<{ id: string; name: string; current_valuation: string }>(
          `SELECT id, name, current_valuation FROM prop_properties WHERE is_active = true ORDER BY name`,
        );
        return rows.map(r => ({ kind: 'PROPERTY' as const, id: r.id, label: r.name, value: num(r.current_valuation) }));
      });
    } finally { propClient.release(); }

    // Fixed-asset items incl. vehicles (jag_commercial) — per-tenant RLS, same pattern as net-worth.
    const commClient = await commercialPool.connect();
    const items: { kind: 'ITEM'; id: string; label: string; value: number }[] = [];
    try {
      for (const tenantId of ENTITY_TENANT_IDS) {
        const synCtx = { ...req.rlsCtx, tenantId };
        const rows = await withTenantRLS(commClient, synCtx, async (cc) => {
          const r = await cc.query<{ id: string; item_name: string; unit_value: string }>(
            `SELECT id, item_name, unit_value FROM ims_items WHERE is_asset = true AND is_active = true`,
          );
          return r.rows;
        });
        for (const r of rows) items.push({ kind: 'ITEM', id: r.id, label: r.item_name, value: num(r.unit_value) });
      }
    } finally { commClient.release(); }

    ok(res, { entities, properties, items });
  } catch (e) { next(e); }
});

// ── POST /ownership ─────────────────────────────────────────────────────────────
ownershipRouter.post('/ownership', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateStakeSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const { userId: ownerId } = req.rlsCtx;
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fam_ownership_stakes
             (owner_id, family_member_id, subject_kind, subject_id, subject_label, ownership_percent, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [ownerId, b.family_member_id, b.subject_kind, b.subject_id, b.subject_label, b.ownership_percent, b.notes ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'OWNERSHIP', action: 'STAKE_CREATED', user_id: ownerId, record_id: rec.id });
      ok(res, rec, 201);
    } catch (e: unknown) {
      // Unique violation = same person already holds a stake in this subject.
      if ((e as { code?: string }).code === '23505') { err(res, 409, 'STAKE_EXISTS', 'This person already has a stake in that subject — edit it instead.'); return; }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /ownership/:id ─────────────────────────────────────────────────────────
ownershipRouter.patch('/ownership/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = PatchStakeSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = bodyP.data;
    const setCols: string[] = ['updated_at = now()'];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (b.ownership_percent !== undefined) setCols.push(`ownership_percent = ${push(b.ownership_percent)}`);
    if (b.subject_label     !== undefined) setCols.push(`subject_label     = ${push(b.subject_label)}`);
    if (b.notes             !== undefined) setCols.push(`notes             = ${push(b.notes)}`);
    params.push(idP.data.id);
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE fam_ownership_stakes SET ${setCols.join(', ')} WHERE id = $${params.length} RETURNING *`, params)
          .then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'STAKE_NOT_FOUND', 'Ownership stake not found.'); return; }
      logger.info({ entity: 'OWNERSHIP', action: 'STAKE_UPDATED', user_id: req.rlsCtx.userId, record_id: idP.data.id });
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /ownership/:id ─────────────────────────────────────────────────────────
ownershipRouter.delete('/ownership/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`DELETE FROM fam_ownership_stakes WHERE id = $1 RETURNING id`, [idP.data.id]).then(r => r.rows[0] ?? null),
      );
      if (!rec) { err(res, 404, 'STAKE_NOT_FOUND', 'Ownership stake not found.'); return; }
      logger.info({ entity: 'OWNERSHIP', action: 'STAKE_DELETED', user_id: req.rlsCtx.userId, record_id: idP.data.id });
      ok(res, { deleted: true, id: rec.id });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /members/:id/holdings ─────────────────────────────────────────────────
// One person's estate rollup: entity shares (percent × entity net worth) + directly-held assets.
ownershipRouter.get('/members/:id/holdings', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const memberId = idP.data.id;

    const client = await familyPool.connect();
    try {
      // 1. The person's stakes + latest net worth per owned entity (both in familyPool).
      const { stakes, nwByEntity } = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const { rows: stakes } = await c.query<{
          subject_kind: string; subject_id: string; subject_label: string; ownership_percent: string;
        }>(
          `SELECT subject_kind, subject_id, subject_label, ownership_percent
           FROM   fam_ownership_stakes WHERE family_member_id = $1`,
          [memberId],
        );
        const entityIds = stakes.filter(s => s.subject_kind === 'ENTITY').map(s => s.subject_id);
        const nwByEntity = new Map<string, number>();
        if (entityIds.length > 0) {
          const { rows } = await c.query<{ owner_entity_id: string; net_worth_ttd: string }>(
            `SELECT DISTINCT ON (owner_entity_id) owner_entity_id, net_worth_ttd
             FROM   fin_net_worth_snapshots
             WHERE  owner_entity_id = ANY($1)
             ORDER  BY owner_entity_id, snapshot_date DESC`,
            [entityIds],
          );
          for (const r of rows) nwByEntity.set(r.owner_entity_id, num(r.net_worth_ttd));
        }
        return { stakes, nwByEntity };
      });

      // 2. Asset values for directly-held PROPERTY / ITEM stakes (cross-DB).
      const propIds = stakes.filter(s => s.subject_kind === 'PROPERTY').map(s => s.subject_id);
      const itemIds = stakes.filter(s => s.subject_kind === 'ITEM').map(s => s.subject_id);
      const valById = new Map<string, number>();

      if (propIds.length > 0) {
        const propClient = await propertiesPool.connect();
        try {
          await withOwnerRLS(propClient, req.rlsCtx, async (pc) => {
            const { rows } = await pc.query<{ id: string; current_valuation: string }>(
              `SELECT id, current_valuation FROM prop_properties WHERE id = ANY($1)`, [propIds],
            );
            for (const r of rows) valById.set(r.id, num(r.current_valuation));
          });
        } finally { propClient.release(); }
      }

      if (itemIds.length > 0) {
        const commClient = await commercialPool.connect();
        try {
          for (const tenantId of ENTITY_TENANT_IDS) {
            const synCtx = { ...req.rlsCtx, tenantId };
            await withTenantRLS(commClient, synCtx, async (cc) => {
              const { rows } = await cc.query<{ id: string; unit_value: string }>(
                `SELECT id, unit_value FROM ims_items WHERE id = ANY($1)`, [itemIds],
              );
              for (const r of rows) valById.set(r.id, num(r.unit_value));
            });
          }
        } finally { commClient.release(); }
      }

      // 3. Build the rollup.
      const entities: unknown[] = [];
      const assets: unknown[] = [];
      let total = 0;
      for (const s of stakes) {
        const pct = num(s.ownership_percent);
        if (s.subject_kind === 'ENTITY') {
          const nw = nwByEntity.get(s.subject_id) ?? 0;
          const attributed = nw * pct / 100;
          total += attributed;
          entities.push({ subject_id: s.subject_id, label: s.subject_label, percent: pct, entity_net_worth: nw, attributed_value: attributed });
        } else {
          const val = valById.get(s.subject_id) ?? 0;
          const attributed = val * pct / 100;
          total += attributed;
          assets.push({ subject_kind: s.subject_kind, subject_id: s.subject_id, label: s.subject_label, percent: pct, asset_value: val, attributed_value: attributed });
        }
      }

      ok(res, { member_id: memberId, entities, assets, total_attributed_ttd: total });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
