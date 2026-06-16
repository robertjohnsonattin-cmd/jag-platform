// GET    /api/v1/properties/deposits
// POST   /api/v1/properties/deposits
// GET    /api/v1/properties/deposits/:id
// PATCH  /api/v1/properties/deposits/:id/reconcile
// GET    /api/v1/properties/deposits/:id/receipt

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const depositsRouter = Router();

const IdParam = z.object({ id: z.string().uuid() });
const PayMethodEnum = z.enum(['BANK_TRANSFER','CHEQUE','CASH']);

const CreateDepositSchema = z.object({
  unit_id:           z.string().uuid(),
  lease_id:          z.string().uuid().optional(),
  tenant_name:       z.string().min(1).max(200),
  amount_ttd:        z.number().positive(),
  months_equivalent: z.number().positive().optional(),
  payment_method:    PayMethodEnum.optional(),
  received_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reference_bank:    z.string().max(100).optional(),
  reference_number:  z.string().max(100).optional(),
  held_in_account:   z.string().max(200).optional(),
  idempotency_key:   z.string().min(1).max(100),
}).strict();

const ReconcileSchema = z.object({
  deductions_ttd:   z.number().min(0),
  deduction_notes:  z.string().optional(),
  refund_amount_ttd: z.number().min(0),
  refund_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status:           z.enum(['PARTIALLY_RETURNED','RETURNED','FORFEITED']),
  tenant_signed_off: z.boolean().optional(),
}).strict();

function padSeq(n: number) { return String(n).padStart(6, '0'); }

depositsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const unitId = req.query['unit_id'] as string | undefined;
    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const conds: string[] = [];
      const vals: unknown[] = [ownerId];
      if (unitId) { vals.push(unitId); conds.push(`d.unit_id = $${vals.length}`); }
      const where = conds.length ? ' AND ' + conds.join(' AND ') : '';
      const { rows: r } = await client.query(
        `SELECT d.*, u.unit_number, p.name AS property_name
         FROM prop_deposits d
         JOIN prop_units u ON u.id = d.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE d.owner_id = $1${where}
         ORDER BY d.received_date DESC LIMIT 200`,
        vals,
      );
      return r;
    });
    res.json(ok(rows));
  } catch (e) { next(e); }
});

depositsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const body = CreateDepositSchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [cnt] } = await client.query(
        `SELECT COUNT(*) FROM prop_deposits WHERE owner_id = $1`, [ownerId],
      );
      const receiptNumber = `DEP-${new Date().getFullYear()}-${padSeq(parseInt(cnt.count) + 1)}`;

      const { rows } = await client.query(
        `INSERT INTO prop_deposits (owner_id, unit_id, lease_id, tenant_name, amount_ttd, months_equivalent,
           payment_method, received_date, reference_bank, reference_number, held_in_account,
           receipt_number, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [ownerId, body.unit_id, body.lease_id ?? null, body.tenant_name, body.amount_ttd,
         body.months_equivalent ?? null, body.payment_method ?? null, body.received_date,
         body.reference_bank ?? null, body.reference_number ?? null, body.held_in_account ?? null,
         receiptNumber, body.idempotency_key],
      );
      return rows[0];
    });
    logger.info({ entity: 'PROPERTIES', action: 'DEPOSIT_RECORDED', record_id: row.id, user_id: ownerId });
    res.status(201).json(ok(row));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === '23505') {
      return void res.status(409).json(err('Duplicate deposit (idempotency key already used)', 'CONFLICT'));
    }
    next(e);
  }
});

depositsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `SELECT d.*, u.unit_number, p.name AS property_name, p.address_line1
         FROM prop_deposits d
         JOIN prop_units u ON u.id = d.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE d.id = $1 AND d.owner_id = $2`,
        [id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Deposit not found', 'NOT_FOUND'));
    res.json(ok(row));
  } catch (e) { next(e); }
});

depositsRouter.patch('/:id/reconcile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = ReconcileSchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_deposits
         SET status = $1, deductions_ttd = $2, deduction_notes = $3,
             refund_amount_ttd = $4, refund_date = $5, tenant_signed_off = $6
         WHERE id = $7 AND owner_id = $8 AND status = 'HELD' RETURNING *`,
        [body.status, body.deductions_ttd, body.deduction_notes ?? null,
         body.refund_amount_ttd, body.refund_date ?? null, body.tenant_signed_off ?? false,
         id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Deposit not found or not in HELD status', 'NOT_FOUND'));
    res.json(ok(row));
  } catch (e) { next(e); }
});

depositsRouter.get('/:id/receipt', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `SELECT d.*, u.unit_number, p.name AS property_name, p.address_line1
         FROM prop_deposits d
         JOIN prop_units u ON u.id = d.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE d.id = $1 AND d.owner_id = $2`,
        [id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Deposit not found', 'NOT_FOUND'));

    const html = generateDepositReceiptHtml(row);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (e) { next(e); }
});

function generateDepositReceiptHtml(d: Record<string, unknown>): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Security Deposit Receipt ${d['receipt_number']}</title>
<style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#222}
h1{font-size:20px}table{width:100%;border-collapse:collapse}
td{padding:8px 12px;border-bottom:1px solid #eee}td:first-child{font-weight:bold;width:40%}
.notice{background:#f5f5f5;padding:12px;margin-top:20px;font-size:13px}</style></head>
<body>
<h1>Security Deposit Receipt</h1>
<p><strong>JAG Properties Management Ltd</strong><br>Trinidad & Tobago</p>
<table>
<tr><td>Receipt No.</td><td>${d['receipt_number']}</td></tr>
<tr><td>Date</td><td>${d['received_date']}</td></tr>
<tr><td>Tenant</td><td>${d['tenant_name']}</td></tr>
<tr><td>Property</td><td>${d['property_name'] ?? '—'} — Unit ${d['unit_number'] ?? '—'}</td></tr>
<tr><td>Amount</td><td>TTD $${parseFloat(String(d['amount_ttd'] ?? 0)).toLocaleString('en-TT', { minimumFractionDigits: 2 })}</td></tr>
<tr><td>Months Equivalent</td><td>${d['months_equivalent'] ?? '—'}</td></tr>
<tr><td>Payment Method</td><td>${d['payment_method'] ?? '—'}</td></tr>
<tr><td>Bank Reference</td><td>${d['reference_number'] ?? '—'}</td></tr>
<tr><td>Held In Account</td><td>${d['held_in_account'] ?? '—'}</td></tr>
</table>
<div class="notice">This deposit is held as security and will be returned within 30 days of tenancy end, less any deductions for damage or outstanding rent.</div>
</body></html>`;
}
