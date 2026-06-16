// GET    /api/v1/properties/rent-schedule
// POST   /api/v1/properties/rent-schedule/generate
// GET    /api/v1/properties/rent-schedule/:id
// POST   /api/v1/properties/rent-schedule/:id/record-payment
// GET    /api/v1/properties/rent-schedule/:id/receipt
// POST   /api/v1/properties/rent-schedule/:id/waive

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { sendTemplate } from '../../lib/whatsapp';

export const rentScheduleRouter = Router();

const IdParam = z.object({ id: z.string().uuid() });
const PayMethodEnum = z.enum(['BANK_TRANSFER','CHEQUE','CASH']);

const GenerateScheduleSchema = z.object({
  lease_id: z.string().uuid(),
}).strict();

const RecordPaymentSchema = z.object({
  paid_amount_ttd:   z.number().positive(),
  paid_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_method:    PayMethodEnum,
  payment_reference: z.string().max(200).optional(),
  account_received:  z.string().max(200).optional(),
  idempotency_key:   z.string().min(1).max(100),
}).strict();

const WaiveSchema = z.object({
  reason: z.string().min(1),
}).strict();

export async function generateRentSchedule(ownerId: string, leaseId: string): Promise<number> {
  return withOwnerRLS(propertiesPool, ownerId, async client => {
    const { rows: [lease] } = await client.query(
      `SELECT l.*, u.id AS unit_id_val,
              COALESCE(t.full_name, l.tenant_name) AS t_name,
              COALESCE(t.phone, '') AS t_phone,
              COALESCE(t.email, '') AS t_email
       FROM prop_lease_agreements l
       LEFT JOIN prop_units u ON u.id = l.unit_id
       LEFT JOIN prop_applications t ON t.unit_id = l.unit_id AND t.status = 'APPROVED'
       WHERE l.id = $1 AND l.owner_id = $2`,
      [leaseId, ownerId],
    );
    if (!lease) throw new Error('Lease not found');

    const start = new Date(lease.start_date as string);
    const end   = new Date(lease.end_date as string);
    const rent  = parseFloat(String(lease.rent_amount_ttd ?? 0));
    const dueDay = (lease.rent_due_day as number | undefined) ?? 1;
    let inserted = 0;
    let current = new Date(start.getFullYear(), start.getMonth(), 1);

    while (current <= end) {
      const yr = current.getFullYear();
      const mo = current.getMonth() + 1;
      const dueDate = new Date(yr, current.getMonth(), dueDay);
      const idem = `${leaseId}-${yr}-${mo}`;
      const { rowCount } = await client.query(
        `INSERT INTO prop_rent_schedule
           (owner_id, lease_id, unit_id, tenant_name, tenant_phone, tenant_email,
            period_year, period_month, due_date, amount_due_ttd, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (lease_id, period_year, period_month) DO NOTHING`,
        [ownerId, leaseId, lease.unit_id_val ?? lease.unit_id,
         lease.t_name ?? '', lease.t_phone ?? '', lease.t_email ?? '',
         yr, mo, dueDate.toISOString().slice(0, 10), rent, idem],
      );
      inserted += rowCount ?? 0;
      current.setMonth(current.getMonth() + 1);
    }
    return inserted;
  });
}

rentScheduleRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const unitId  = req.query['unit_id'] as string | undefined;
    const leaseId = req.query['lease_id'] as string | undefined;
    const status  = req.query['status'] as string | undefined;
    const year    = req.query['year'] as string | undefined;

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const conds: string[] = [];
      const vals: unknown[] = [ownerId];
      if (unitId)  { vals.push(unitId);  conds.push(`rs.unit_id = $${vals.length}`); }
      if (leaseId) { vals.push(leaseId); conds.push(`rs.lease_id = $${vals.length}`); }
      if (status)  { vals.push(status);  conds.push(`rs.status = $${vals.length}`); }
      if (year)    { vals.push(parseInt(year, 10)); conds.push(`rs.period_year = $${vals.length}`); }
      const where = conds.length ? ' AND ' + conds.join(' AND ') : '';
      const { rows: r } = await client.query(
        `SELECT rs.*, u.unit_number, p.name AS property_name
         FROM prop_rent_schedule rs
         JOIN prop_units u ON u.id = rs.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE rs.owner_id = $1${where}
         ORDER BY rs.due_date DESC LIMIT 500`,
        vals,
      );
      return r;
    });
    res.json(ok(rows));
  } catch (e) { next(e); }
});

rentScheduleRouter.post('/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { lease_id } = GenerateScheduleSchema.parse(req.body);
    const inserted = await generateRentSchedule(ownerId, lease_id);
    res.json(ok({ generated: inserted }));
  } catch (e) { next(e); }
});

// ── Batch: cron sends reminders for upcoming / late periods ──────────────────
rentScheduleRouter.post('/send-reminders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const sent: string[] = [];
    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query<Record<string, unknown>>(
        `SELECT rs.id, rs.period_year, rs.period_month, rs.amount_due_ttd, rs.due_date,
                la.tenant_phone, la.tenant_name
         FROM prop_rent_schedule rs
         JOIN prop_lease_agreements la ON la.id = rs.lease_id
         WHERE rs.owner_id = $1
           AND rs.status IN ('UPCOMING','REMINDER_SENT','LATE')
           AND (rs.reminder_sent_at IS NULL OR rs.reminder_sent_at < NOW() - INTERVAL '23 hours')
           AND rs.due_date <= CURRENT_DATE + INTERVAL '3 days'`,
        [ownerId],
      );
      return rows;
    });

    for (const row of rows) {
      if (!row['tenant_phone']) continue;
      try {
        await sendTemplate({
          to: String(row['tenant_phone']),
          templateName: 'rent_reminder',
          languageCode: 'en',
          components: [{ type: 'body', parameters: [
            { type: 'text', text: String(row['tenant_name'] ?? '') },
            { type: 'text', text: `${row['period_year']}/${String(row['period_month']).padStart(2,'0')}` },
            { type: 'currency', currency: { fallback_value: `TTD ${parseFloat(String(row['amount_due_ttd'] ?? 0)).toFixed(2)}`, code: 'TTD', amount_1000: Math.round(parseFloat(String(row['amount_due_ttd'] ?? 0)) * 1000) } },
          ]}],
        });
        await withOwnerRLS(propertiesPool, ownerId, async client => {
          await client.query(
            `UPDATE prop_rent_schedule SET reminder_sent_at = NOW(), status = CASE WHEN status = 'UPCOMING' THEN 'REMINDER_SENT' ELSE status END WHERE id = $1`,
            [row['id']],
          );
        });
        sent.push(String(row['id']));
      } catch { /* skip on WA error */ }
    }

    logger.info({ entity: 'RENT_REMINDERS', action: 'batch_complete', sent: sent.length, user_id: ownerId, severity: 'INFO' });
    res.json(ok({ sent: sent.length }));
  } catch (e) { next(e); }
});

rentScheduleRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `SELECT rs.*, u.unit_number, p.name AS property_name
         FROM prop_rent_schedule rs
         JOIN prop_units u ON u.id = rs.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE rs.id = $1 AND rs.owner_id = $2`,
        [id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Rent period not found', 'NOT_FOUND'));
    res.json(ok(row));
  } catch (e) { next(e); }
});

rentScheduleRouter.post('/:id/record-payment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = RecordPaymentSchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [existing] } = await client.query(
        `SELECT * FROM prop_rent_schedule WHERE id = $1 AND owner_id = $2`, [id, ownerId],
      );
      if (!existing) return null;

      const isPartial = parseFloat(String(body.paid_amount_ttd)) < parseFloat(String(existing.amount_due_ttd));
      const newStatus = isPartial ? 'PARTIAL' : 'PAID';

      const { rows: [cnt] } = await client.query(
        `SELECT COUNT(*) FROM prop_rent_schedule WHERE owner_id = $1`, [ownerId],
      );
      const receiptNumber = `RNT-${new Date().getFullYear()}-${String(parseInt(cnt.count)).padStart(6, '0')}`;

      const { rows } = await client.query(
        `UPDATE prop_rent_schedule
         SET status = $1, paid_amount_ttd = $2, paid_date = $3, payment_method = $4,
             payment_reference = $5, account_received = $6, receipt_number = $7
         WHERE id = $8 AND owner_id = $9 RETURNING *`,
        [newStatus, body.paid_amount_ttd, body.paid_date, body.payment_method,
         body.payment_reference ?? null, body.account_received ?? null, receiptNumber,
         id, ownerId],
      );
      return rows[0];
    });
    if (!row) return void res.status(404).json(err('Rent period not found', 'NOT_FOUND'));

    if (row.tenant_phone) {
      try {
        await sendTemplate({
          to: row.tenant_phone,
          templateName: 'prop_rent_receipt',
          components: [{ type: 'body', parameters: [
            { type: 'text', text: row.tenant_name },
            { type: 'text', text: `TTD $${parseFloat(String(row.paid_amount_ttd)).toFixed(2)}` },
            { type: 'text', text: `${row.period_year}-${String(row.period_month).padStart(2, '0')}` },
            { type: 'text', text: row.receipt_number },
          ]}],
        });
      } catch (e) {
        logger.warn({ entity: 'PROPERTIES', action: 'WA_RECEIPT_FAILED', error_message: (e as Error).message });
      }
    }
    res.json(ok(row));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === '23505') {
      return void res.status(409).json(err('Duplicate payment (idempotency key already used)', 'CONFLICT'));
    }
    next(e);
  }
});

rentScheduleRouter.get('/:id/receipt', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `SELECT rs.*, u.unit_number, p.name AS property_name, p.address_line1
         FROM prop_rent_schedule rs
         JOIN prop_units u ON u.id = rs.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE rs.id = $1 AND rs.owner_id = $2 AND rs.status IN ('PAID','PARTIAL')`,
        [id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Rent payment record not found or not yet paid', 'NOT_FOUND'));

    const html = generateRentReceiptHtml(row);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (e) { next(e); }
});

rentScheduleRouter.post('/:id/waive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const { reason } = WaiveSchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_rent_schedule SET status = 'WAIVED', payment_reference = $1
         WHERE id = $2 AND owner_id = $3 AND status IN ('UPCOMING','REMINDER_SENT','LATE') RETURNING *`,
        [`WAIVED: ${reason}`, id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Rent period not found or not waivable', 'NOT_FOUND'));
    res.json(ok(row));
  } catch (e) { next(e); }
});

function generateRentReceiptHtml(r: Record<string, unknown>): string {
  const paid = parseFloat(String(r['paid_amount_ttd'] ?? 0));
  const due  = parseFloat(String(r['amount_due_ttd'] ?? 0));
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Rent Receipt ${r['receipt_number']}</title>
<style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#222}
h1{font-size:20px}table{width:100%;border-collapse:collapse}
td{padding:8px 12px;border-bottom:1px solid #eee}td:first-child{font-weight:bold;width:40%}</style></head>
<body>
<h1>Rent Receipt</h1>
<p><strong>JAG Properties Management Ltd</strong><br>Trinidad & Tobago</p>
<table>
<tr><td>Receipt No.</td><td>${r['receipt_number']}</td></tr>
<tr><td>Date</td><td>${r['paid_date']}</td></tr>
<tr><td>Tenant</td><td>${r['tenant_name']}</td></tr>
<tr><td>Property / Unit</td><td>${r['property_name'] ?? '—'} — Unit ${r['unit_number'] ?? '—'}</td></tr>
<tr><td>Period</td><td>${r['period_year']}-${String(r['period_month']).padStart(2,'0')}</td></tr>
<tr><td>Amount Due</td><td>TTD $${due.toLocaleString('en-TT', { minimumFractionDigits: 2 })}</td></tr>
<tr><td>Amount Paid</td><td>TTD $${paid.toLocaleString('en-TT', { minimumFractionDigits: 2 })}</td></tr>
<tr><td>Balance</td><td>TTD $${(due - paid).toLocaleString('en-TT', { minimumFractionDigits: 2 })}</td></tr>
<tr><td>Payment Method</td><td>${r['payment_method']}</td></tr>
<tr><td>Reference</td><td>${r['payment_reference'] ?? '—'}</td></tr>
</table>
</body></html>`;
}
