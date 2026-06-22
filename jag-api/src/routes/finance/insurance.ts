// Insurance module — policies, premiums, claims
//
// GET    /finance/insurance/policies
// GET    /finance/insurance/policies/expiring
// POST   /finance/insurance/policies
// GET    /finance/insurance/policies/:id
// PATCH  /finance/insurance/policies/:id
// DELETE /finance/insurance/policies/:id
// GET    /finance/insurance/policies/:id/history
// POST   /finance/insurance/policies/:id/history — manual backfill
//
// GET    /finance/insurance/policies/:policyId/premiums
// POST   /finance/insurance/policies/:policyId/premiums
// POST   /finance/insurance/premiums/:id/mark-paid
//
// GET    /finance/insurance/policies/:policyId/claims
// POST   /finance/insurance/policies/:policyId/claims
// POST   /finance/insurance/claims/:id/settle
// PATCH  /finance/insurance/claims/:id

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { createAllDayCalendarEvent, deleteCalendarEvent } from '../../lib/google-calendar';

export const insuranceRouter = Router();

// ── Schemas ────────────────────────────────────────────────────────────────────

const POLICY_TYPES   = ['PROPERTY','VEHICLE','LIABILITY','LIFE','HEALTH','BUSINESS_INTERRUPTION','MARINE','PROFESSIONAL_INDEMNITY','OTHER'] as const;
const ASSET_TYPES    = ['VEHICLE','PROPERTY','BUSINESS','PERSON','OTHER'] as const;
const PREM_FREQS     = ['MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL','ONE_OFF'] as const;
const PREM_STATUSES  = ['DUE','PAID','OVERDUE','WAIVED'] as const;
const CLAIM_STATUSES = ['SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','SETTLED','WITHDRAWN'] as const;
const PAY_METHODS    = ['CASH','BANK_TRANSFER','CREDIT_CARD','CHEQUE','DIRECT_DEBIT','OTHER'] as const;

const CreatePolicySchema = z.object({
  owner_entity_id:      z.string().uuid(),
  policy_number:        z.string().min(1).max(100),
  insurer_name:         z.string().min(1).max(200),
  broker_name:          z.string().max(200).optional(),
  policy_type:          z.enum(POLICY_TYPES),
  insured_asset_type:   z.enum(ASSET_TYPES),
  insured_asset_ref:    z.string().uuid().optional(),
  coverage_amount:      z.number().positive(),
  currency:             z.string().length(3).default('TTD'),
  coverage_amount_ttd:  z.number().positive(),
  premium_amount:       z.number().positive(),
  premium_amount_ttd:   z.number().positive(),
  premium_frequency:    z.enum(PREM_FREQS),
  start_date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiry_date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  renewal_alert_days:   z.number().int().min(7).max(365).default(60),
  gl_expense_account_id: z.string().uuid().optional(),
  notes:                z.string().optional(),
}).strict();

const UpdatePolicySchema = z.object({
  policy_number:        z.string().min(1).max(100).optional(),
  insurer_name:         z.string().min(1).max(200).optional(),
  broker_name:          z.string().max(200).optional(),
  coverage_amount:      z.number().positive().optional(),
  coverage_amount_ttd:  z.number().positive().optional(),
  premium_amount:       z.number().positive().optional(),
  premium_amount_ttd:   z.number().positive().optional(),
  expiry_date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  renewal_alert_days:   z.number().int().min(7).max(365).optional(),
  gl_expense_account_id: z.string().uuid().nullable().optional(),
  is_active:            z.boolean().optional(),
  notes:                z.string().optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'At least one field required.' });

const CreatePremiumSchema = z.object({
  due_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount:          z.number().positive(),
  currency:        z.string().length(3).default('TTD'),
  amount_ttd:      z.number().positive(),
  fx_rate_used:    z.number().positive().optional(),
  payment_method:  z.enum(PAY_METHODS).default('BANK_TRANSFER'),
  notes:           z.string().optional(),
  idempotency_key: z.string().min(1).max(500),
}).strict();

const MarkPaidSchema = z.object({
  paid_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gl_entry_id:     z.string().uuid().optional(),
  payment_method:  z.enum(PAY_METHODS).optional(),
  receipt_path:    z.string().max(500).optional(),
  receipt_filename: z.string().max(200).optional(),
}).strict();

const CreateClaimSchema = z.object({
  claim_reference:   z.string().max(100).optional(),
  incident_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  claim_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description:       z.string().min(1),
  claimed_amount_ttd: z.number().positive(),
  notes:             z.string().optional(),
  idempotency_key:   z.string().min(1).max(500),
}).strict();

const SettleClaimSchema = z.object({
  settled_amount_ttd: z.number().positive(),
  settlement_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gl_entry_id:        z.string().uuid().optional(),
  notes:              z.string().optional(),
}).strict();

const UpdateClaimSchema = z.object({
  status:          z.enum(['SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','WITHDRAWN']).optional(),
  claim_reference: z.string().max(100).optional(),
  description:     z.string().min(1).optional(),
  notes:           z.string().optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'At least one field required.' });

// ── Renewal alert outbox helper ───────────────────────────────────────────────
// Idempotent: ON CONFLICT DO NOTHING deduplicates per policy+expiry cycle.

async function enqueueRenewalAlert(ownerId: string, policy: {
  id: string; policy_number: string; insurer_name: string;
  expiry_date: string; renewal_alert_days: number;
}): Promise<void> {
  await familyPool.query(
    `INSERT INTO pending_events (aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [
      'InsurancePolicy',
      policy.id,
      'RENEWAL_ALERT',
      JSON.stringify({
        owner_id:           ownerId,
        policy_id:          policy.id,
        policy_number:      policy.policy_number,
        insurer_name:       policy.insurer_name,
        expiry_date:        policy.expiry_date,
        renewal_alert_days: policy.renewal_alert_days,
        alerted_at:         new Date().toISOString(),
      }),
    ]
  );
}

// ── POST /policies/import (Path 2 — direct JSON from local script) ────────────

const ImportPolicySchema = CreatePolicySchema.extend({
  idempotency_key: z.string().min(1).max(200),
}).omit({ gl_expense_account_id: true });

insuranceRouter.post('/policies/import', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ImportPolicySchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fin_insurance_policies
             (owner_id, owner_entity_id, policy_number, insurer_name, broker_name,
              policy_type, insured_asset_type, coverage_amount, currency,
              coverage_amount_ttd, premium_amount, premium_amount_ttd,
              premium_frequency, start_date, expiry_date, renewal_alert_days, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           RETURNING *`,
          [
            ownerId, b.owner_entity_id, b.policy_number, b.insurer_name, b.broker_name ?? null,
            b.policy_type, b.insured_asset_type, b.coverage_amount, b.currency,
            b.coverage_amount_ttd, b.premium_amount, b.premium_amount_ttd,
            b.premium_frequency, b.start_date, b.expiry_date,
            b.renewal_alert_days ?? 60, b.notes ?? null,
          ],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'FINANCE', action: 'INSURANCE_IMPORTED', user_id: ownerId, record_id: rec.id, source: 'LOCAL_SCRIPT' });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POLICIES ──────────────────────────────────────────────────────────────────

// GET /policies
insuranceRouter.get('/policies', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT * FROM fin_insurance_policies ORDER BY expiry_date ASC`).then(r => r.rows)
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// GET /policies/expiring  — must be declared before /policies/:id
insuranceRouter.get('/policies/expiring', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT * FROM fin_insurance_policies
           WHERE is_active = true
             AND expiry_date <= CURRENT_DATE + (renewal_alert_days * INTERVAL '1 day')
             AND expiry_date >= CURRENT_DATE
           ORDER BY expiry_date ASC`
        ).then(r => r.rows)
      );
      const { ownerId } = req.rlsCtx;
      for (const p of rows) await enqueueRenewalAlert(ownerId, p);
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// GET /policies/:id
insuranceRouter.get('/policies/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const { rows } = await c.query(
          `SELECT p.*,
                  json_agg(DISTINCT prem ORDER BY prem.due_date)  FILTER (WHERE prem.id IS NOT NULL) AS premiums,
                  json_agg(DISTINCT clm  ORDER BY clm.claim_date) FILTER (WHERE clm.id  IS NOT NULL) AS claims
           FROM fin_insurance_policies p
           LEFT JOIN fin_insurance_premiums prem ON prem.policy_id = p.id
           LEFT JOIN fin_insurance_claims   clm  ON clm.policy_id  = p.id
           WHERE p.id = $1
           GROUP BY p.id`,
          [req.params.id]
        );
        return rows[0] ?? null;
      });
      if (!rec) { err(res, 404, 'NOT_FOUND', 'Policy not found'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// POST /policies
insuranceRouter.post('/policies', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreatePolicySchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fin_insurance_policies
             (owner_id, owner_entity_id, policy_number, insurer_name, broker_name,
              policy_type, insured_asset_type, insured_asset_ref,
              coverage_amount, currency, coverage_amount_ttd,
              premium_amount, premium_amount_ttd, premium_frequency,
              start_date, expiry_date, renewal_alert_days,
              gl_expense_account_id, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           RETURNING *`,
          [
            ownerId, b.owner_entity_id, b.policy_number, b.insurer_name, b.broker_name ?? null,
            b.policy_type, b.insured_asset_type, b.insured_asset_ref ?? null,
            b.coverage_amount, b.currency, b.coverage_amount_ttd,
            b.premium_amount, b.premium_amount_ttd, b.premium_frequency,
            b.start_date, b.expiry_date, b.renewal_alert_days,
            b.gl_expense_account_id ?? null, b.notes ?? null,
          ]
        ).then(r => r.rows[0])
      );
      logger.info({ entity: 'Insurance', action: 'POLICY_CREATED', user_id: ownerId, record_id: rec.id });

      // Non-blocking: create calendar event for expiry_date
      const createdRec = rec;
      void (async () => {
        try {
          const evId = await createAllDayCalendarEvent({
            title: `Insurance Policy Expiry: ${b.policy_type} — ${b.insurer_name}`,
            description: `Policy ${b.policy_number} (${b.insurer_name}) expires\nType: ${b.policy_type} / ${b.insured_asset_type}${b.broker_name ? `\nBroker: ${b.broker_name}` : ''}`,
            date: b.expiry_date,
          });
          const c2 = await familyPool.connect();
          try {
            await withOwnerRLS(c2, req.rlsCtx, async (c) => {
              await c.query(`UPDATE fin_insurance_policies SET calendar_event_id = $1 WHERE id = $2`, [evId, createdRec.id]);
            });
          } finally { c2.release(); }
        } catch (calErr) {
          logger.warn({ entity: 'Insurance', action: 'POLICY_CAL_ERROR', error_message: (calErr as Error).message });
        }
      })();

      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// PATCH /policies/:id
insuranceRouter.patch('/policies/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UpdatePolicySchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const fields = Object.keys(b) as (keyof typeof b)[];
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const setClauses = fields.map((k, i) => `${k} = $${i + 2}`).join(', ');
        const { rows } = await c.query(
          `UPDATE fin_insurance_policies SET ${setClauses}, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [req.params.id, ...fields.map(k => b[k])]
        );
        const updated = rows[0] ?? null;
        if (!updated) return null;

        await c.query(
          `INSERT INTO fin_insurance_policy_history
             (policy_id, owner_id, as_of_date, coverage_amount_ttd, premium_amount_ttd, expiry_date)
           VALUES ($1,$2,CURRENT_DATE,$3,$4,$5)`,
          [
            updated.id, ownerId,
            updated.coverage_amount_ttd,
            updated.premium_amount_ttd,
            updated.expiry_date ?? null,
          ],
        );
        return updated;
      });
      if (!rec) { err(res, 404, 'NOT_FOUND', 'Policy not found'); return; }

      // Non-blocking: update calendar event when expiry_date changes
      if (b.expiry_date !== undefined) {
        const patchedRec = rec;
        void (async () => {
          try {
            if (patchedRec.calendar_event_id) {
              try { await deleteCalendarEvent(patchedRec.calendar_event_id); } catch { /* stale */ }
            }
            const evId = await createAllDayCalendarEvent({
              title: `Insurance Policy Expiry: ${patchedRec.policy_type} — ${patchedRec.insurer_name}`,
              description: `Policy ${patchedRec.policy_number} (${patchedRec.insurer_name}) expires\nType: ${patchedRec.policy_type} / ${patchedRec.insured_asset_type}`,
              date: b.expiry_date as string,
            });
            const c2 = await familyPool.connect();
            try {
              await withOwnerRLS(c2, req.rlsCtx, async (c) => {
                await c.query(`UPDATE fin_insurance_policies SET calendar_event_id = $1 WHERE id = $2`, [evId, patchedRec.id]);
              });
            } finally { c2.release(); }
          } catch (calErr) {
            logger.warn({ entity: 'Insurance', action: 'POLICY_CAL_UPDATE_ERROR', error_message: (calErr as Error).message });
          }
        })();
      }

      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /policies/:id/history ─────────────────────────────────────────────────

const PolicyHistoryBackfillSchema = z.object({
  as_of_date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coverage_amount_ttd: z.number().positive(),
  premium_amount_ttd:  z.number().positive(),
  expiry_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:               z.string().max(2000).optional(),
}).strict();

insuranceRouter.get('/policies/:id/history', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT * FROM fin_insurance_policy_history WHERE policy_id = $1 ORDER BY as_of_date DESC, recorded_at DESC`,
          [req.params.id],
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /policies/:id/history (manual backfill) ──────────────────────────────

insuranceRouter.post('/policies/:id/history', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const bodyParsed = PolicyHistoryBackfillSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const b = bodyParsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const { rows: check } = await c.query(
          `SELECT id FROM fin_insurance_policies WHERE id = $1`, [req.params.id]
        );
        if (!check.length) return null;

        return c.query(
          `INSERT INTO fin_insurance_policy_history
             (policy_id, owner_id, as_of_date, coverage_amount_ttd, premium_amount_ttd, expiry_date, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            req.params.id, ownerId, b.as_of_date,
            b.coverage_amount_ttd, b.premium_amount_ttd,
            b.expiry_date ?? null, b.notes ?? null,
          ],
        ).then(r => r.rows[0]);
      });
      if (!row) { err(res, 404, 'NOT_FOUND', 'Policy not found'); return; }
      logger.info({ entity: 'FINANCE', action: 'POLICY_HISTORY_BACKFILL', user_id: ownerId, record_id: req.params.id });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// DELETE /policies/:id  (soft-archive if activity exists; hard delete otherwise)
insuranceRouter.delete('/policies/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await familyPool.connect();
    try {
      const result = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const { rows: check } = await c.query(
          `SELECT
             (SELECT COUNT(*) FROM fin_insurance_premiums WHERE policy_id = $1)::int AS prem_count,
             (SELECT COUNT(*) FROM fin_insurance_claims   WHERE policy_id = $1)::int AS claim_count`,
          [req.params.id]
        );
        if (check[0].prem_count > 0 || check[0].claim_count > 0) {
          const { rows } = await c.query(
            `UPDATE fin_insurance_policies SET is_active = false, updated_at = now()
             WHERE id = $1 RETURNING *`,
            [req.params.id]
          );
          return rows[0] ? { archived: true as const, policy: rows[0] } : null;
        }
        const { rows } = await c.query(
          `DELETE FROM fin_insurance_policies WHERE id = $1 RETURNING id`, [req.params.id]
        );
        return rows[0] ? { deleted: true as const, id: rows[0].id } : null;
      });
      if (!result) { err(res, 404, 'NOT_FOUND', 'Policy not found'); return; }
      ok(res, result);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PREMIUMS ──────────────────────────────────────────────────────────────────

// GET /policies/:policyId/premiums
insuranceRouter.get('/policies/:policyId/premiums', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT * FROM fin_insurance_premiums WHERE policy_id = $1 ORDER BY due_date ASC`,
          [req.params.policyId]
        ).then(r => r.rows)
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// POST /policies/:policyId/premiums
insuranceRouter.post('/policies/:policyId/premiums', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreatePremiumSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const { rows: pol } = await c.query(
          `SELECT id FROM fin_insurance_policies WHERE id = $1`, [req.params.policyId]
        );
        if (!pol.length) return null;

        const { rows } = await c.query(
          `INSERT INTO fin_insurance_premiums
             (owner_id, policy_id, due_date, amount, currency, amount_ttd,
              fx_rate_used, payment_method, notes, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
           RETURNING *`,
          [
            ownerId, req.params.policyId, b.due_date, b.amount, b.currency, b.amount_ttd,
            b.fx_rate_used ?? null, b.payment_method, b.notes ?? null, b.idempotency_key,
          ]
        );
        return rows[0];
      });
      if (!rec) { err(res, 404, 'NOT_FOUND', 'Policy not found'); return; }
      ok(res, rec, 201);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('idempotency_key')) {
        err(res, 409, 'DUPLICATE_REQUEST', 'Duplicate idempotency key.'); return;
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// POST /premiums/:id/mark-paid
insuranceRouter.post('/premiums/:id/mark-paid', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = MarkPaidSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'paid_date is required.'); return; }
    const b = parsed.data;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const { rows: existing } = await c.query(
          `SELECT status FROM fin_insurance_premiums WHERE id = $1`, [req.params.id]
        );
        if (!existing.length) return 'not_found';
        if (existing[0].status === 'PAID') return 'already_paid';

        const { rows } = await c.query(
          `UPDATE fin_insurance_premiums
           SET status           = 'PAID',
               paid_date        = $2,
               gl_entry_id      = COALESCE($3, gl_entry_id),
               payment_method   = COALESCE($4, payment_method),
               receipt_path     = COALESCE($5, receipt_path),
               receipt_filename = COALESCE($6, receipt_filename),
               updated_at       = now()
           WHERE id = $1
           RETURNING *`,
          [req.params.id, b.paid_date, b.gl_entry_id ?? null,
           b.payment_method ?? null, b.receipt_path ?? null, b.receipt_filename ?? null]
        );
        return rows[0];
      });
      if (rec === 'not_found')  { err(res, 404, 'NOT_FOUND', 'Premium not found'); return; }
      if (rec === 'already_paid') { err(res, 409, 'INVALID_STATE', 'Premium is already PAID'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── CLAIMS ────────────────────────────────────────────────────────────────────

// GET /policies/:policyId/claims
insuranceRouter.get('/policies/:policyId/claims', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT * FROM fin_insurance_claims WHERE policy_id = $1 ORDER BY claim_date DESC`,
          [req.params.policyId]
        ).then(r => r.rows)
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// POST /policies/:policyId/claims
insuranceRouter.post('/policies/:policyId/claims', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateClaimSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const { rows: pol } = await c.query(
          `SELECT id FROM fin_insurance_policies WHERE id = $1`, [req.params.policyId]
        );
        if (!pol.length) return null;

        const { rows } = await c.query(
          `INSERT INTO fin_insurance_claims
             (owner_id, policy_id, claim_reference, incident_date, claim_date,
              description, claimed_amount_ttd, notes, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
           RETURNING *`,
          [
            ownerId, req.params.policyId, b.claim_reference ?? null,
            b.incident_date, b.claim_date, b.description, b.claimed_amount_ttd,
            b.notes ?? null, b.idempotency_key,
          ]
        );
        return rows[0];
      });
      if (!rec) { err(res, 404, 'NOT_FOUND', 'Policy not found'); return; }
      ok(res, rec, 201);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('idempotency_key')) {
        err(res, 409, 'DUPLICATE_REQUEST', 'Duplicate idempotency key.'); return;
      }
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// POST /claims/:id/settle
insuranceRouter.post('/claims/:id/settle', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = SettleClaimSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'settled_amount_ttd and settlement_date are required.'); return; }
    const b = parsed.data;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const { rows: existing } = await c.query(
          `SELECT status FROM fin_insurance_claims WHERE id = $1`, [req.params.id]
        );
        if (!existing.length) return 'not_found';
        const terminal = ['SETTLED','REJECTED','WITHDRAWN'];
        if (terminal.includes(existing[0].status)) return `terminal:${existing[0].status}` as const;

        const { rows } = await c.query(
          `UPDATE fin_insurance_claims
           SET status             = 'SETTLED',
               settled_amount_ttd = $2,
               settlement_date    = $3,
               gl_entry_id        = COALESCE($4, gl_entry_id),
               notes              = COALESCE($5, notes),
               updated_at         = now()
           WHERE id = $1
           RETURNING *`,
          [req.params.id, b.settled_amount_ttd, b.settlement_date, b.gl_entry_id ?? null, b.notes ?? null]
        );
        return rows[0];
      });
      if (rec === 'not_found') { err(res, 404, 'NOT_FOUND', 'Claim not found'); return; }
      if (typeof rec === 'string' && rec.startsWith('terminal:')) {
        err(res, 409, 'INVALID_STATE', `Claim is already ${rec.split(':')[1]}`); return;
      }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// PATCH /claims/:id
insuranceRouter.patch('/claims/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UpdateClaimSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const fields = Object.keys(b) as (keyof typeof b)[];

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const setClauses = fields.map((k, i) => `${k} = $${i + 2}`).join(', ');
        const { rows } = await c.query(
          `UPDATE fin_insurance_claims SET ${setClauses}, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [req.params.id, ...fields.map(k => b[k])]
        );
        return rows[0] ?? null;
      });
      if (!rec) { err(res, 404, 'NOT_FOUND', 'Claim not found'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
