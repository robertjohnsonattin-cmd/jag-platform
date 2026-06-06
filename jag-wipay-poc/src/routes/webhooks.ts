import { Router } from 'express';
import type { Request, Response } from 'express';
import { pool } from '../db';
import { config } from '../config';
import type { WiPayWebhookPayload, ApiResponse, WebhookResult } from '../types';

export const webhooksRouter = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok(res: Response, data: WebhookResult, status = 200): void {
  const body: ApiResponse<WebhookResult> = { success: true, data, error: null, code: null };
  res.status(status).json(body);
}

function err(res: Response, status: number, error: string, code: string): void {
  const body: ApiResponse = { success: false, data: null, error, code };
  res.status(status).json(body);
}

async function queueForReview(
  client: import('pg').PoolClient,
  idempotencyKey: string,
  payload: WiPayWebhookPayload
): Promise<void> {
  await client.query(
    `INSERT INTO prop_pending_review_queue
       (owner_id, idempotency_key, source, raw_payload)
     VALUES ($1, $2, 'WIPAY_WEBHOOK', $3)`,
    [config.ownerId, idempotencyKey, JSON.stringify(payload)]
  );
}

webhooksRouter.post('/wipay', async (req: Request, res: Response): Promise<void> => {
  // --- Idempotency-Key header validation ---
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
  if (!idempotencyKey) {
    err(res, 400, 'Idempotency-Key header is required.', 'VALIDATION_ERROR');
    return;
  }
  if (!UUID_PATTERN.test(idempotencyKey)) {
    err(res, 400, 'Idempotency-Key must be a valid UUID.', 'VALIDATION_ERROR');
    return;
  }

  // --- Payload field validation ---
  const payload = req.body as WiPayWebhookPayload;
  if (!payload.wipay_reference || !payload.status || payload.amount == null || !payload.currency) {
    err(
      res,
      400,
      'Missing required field: wipay_reference, status, amount, and currency are required.',
      'VALIDATION_ERROR'
    );
    return;
  }

  const client = await pool.connect();
  try {
    // --- Duplicate idempotency check: rent_payments ---
    const dupPayment = await client.query<{ id: string }>(
      'SELECT id FROM prop_rent_payments WHERE idempotency_key = $1 LIMIT 1',
      [idempotencyKey]
    );
    if (dupPayment.rows.length > 0) {
      ok(res, { received: true, idempotency_key: idempotencyKey });
      return;
    }

    // --- Duplicate idempotency check: pending_review_queue ---
    const dupQueue = await client.query<{ id: string }>(
      'SELECT id FROM prop_pending_review_queue WHERE idempotency_key = $1 LIMIT 1',
      [idempotencyKey]
    );
    if (dupQueue.rows.length > 0) {
      ok(res, { received: true, idempotency_key: idempotencyKey });
      return;
    }

    // --- Non-success payments: queue for review, return 202 ---
    if (payload.status !== 'success') {
      await queueForReview(client, idempotencyKey, payload);
      ok(res, { received: true, idempotency_key: idempotencyKey }, 202);
      return;
    }

    // --- Success payment: resolve lease via metadata.lease_id (Phase 0 correlation) ---
    // Phase 1 will replace this with a prop_wipay_payment_orders lookup table.
    const leaseId = (payload.metadata as Record<string, unknown> | null | undefined)
      ?.lease_id as string | undefined;

    if (!leaseId || !UUID_PATTERN.test(leaseId)) {
      await queueForReview(client, idempotencyKey, payload);
      ok(res, { received: true, idempotency_key: idempotencyKey }, 202);
      return;
    }

    // --- Verify lease exists, is active, and belongs to owner ---
    const leaseCheck = await client.query<{
      id: string;
      owner_id: string;
      monthly_rent: string;
      currency: string;
    }>(
      `SELECT id, owner_id, monthly_rent, currency
       FROM prop_lease_agreements
       WHERE id = $1 AND owner_id = $2 AND status = 'ACTIVE'
       LIMIT 1`,
      [leaseId, config.ownerId]
    );

    if (leaseCheck.rows.length === 0) {
      await queueForReview(client, idempotencyKey, payload);
      ok(res, { received: true, idempotency_key: idempotencyKey }, 202);
      return;
    }

    const lease = leaseCheck.rows[0];
    const txDate = payload.transaction_date ? new Date(payload.transaction_date) : new Date();
    const paymentDate = txDate.toISOString().split('T')[0];
    const periodMonth = txDate.getMonth() + 1;
    const periodYear = txDate.getFullYear();

    // --- Insert rent payment + outbox event atomically ---
    await client.query('BEGIN');
    try {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO prop_rent_payments
           (owner_id, lease_id, payment_date, period_month, period_year,
            amount_due, amount_paid, payment_method,
            wipay_reference, wipay_webhook_payload, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'WIPAY', $8, $9, $10)
         RETURNING id`,
        [
          lease.owner_id,
          lease.id,
          paymentDate,
          periodMonth,
          periodYear,
          parseFloat(lease.monthly_rent),
          payload.amount,
          payload.wipay_reference,
          JSON.stringify(payload),
          idempotencyKey,
        ]
      );

      const paymentId = inserted.rows[0].id;

      await client.query(
        `INSERT INTO pending_events
           (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('RentPayment', $1, 'rent.payment_received', $2)`,
        [
          paymentId,
          JSON.stringify({
            payment_id: paymentId,
            lease_id: lease.id,
            wipay_reference: payload.wipay_reference,
            amount: payload.amount,
            currency: payload.currency,
            period_month: periodMonth,
            period_year: periodYear,
          }),
        ]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    }

    ok(res, { received: true, idempotency_key: idempotencyKey });
  } finally {
    client.release();
  }
});
