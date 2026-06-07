// POST /api/v1/webhooks/wipay
//
// WiPay payment notification webhook. No Bearer JWT — authenticated via
// HMAC-SHA256 of the raw request body, verified against the
// X-WiPay-Signature: sha256=<hex> header.
//
// State machine (locked PRE-5):
//   Non-success payment          → review queue → 202 Accepted
//   Success + no matching record → review queue → 202 Accepted
//   Success + matching record    → update wipay_webhook_payload, write audit → 200 OK
//
// WiPay retries on non-2xx. Always return 202 for review-queue cases so
// WiPay does not retry — we handle resolution manually.
//
// Requires: WIPAY_WEBHOOK_SECRET, WIPAY_DEFAULT_OWNER_ID (= Robert's jag_core user ID)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { createHmac, createHash, timingSafeEqual } from 'crypto';
import { propertiesPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';

export const wipayRouter = Router();

// ── HMAC verification ─────────────────────────────────────────────────────────

function verifyWiPaySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  const secret = process.env['WIPAY_WEBHOOK_SECRET'];
  if (!secret) {
    logger.warn({ entity: 'WIPAY', action: 'HMAC_SECRET_MISSING', error_message: 'WIPAY_WEBHOOK_SECRET not set — rejecting all webhook requests' });
    return false;
  }

  if (!signatureHeader?.startsWith('sha256=')) return false;
  const provided = signatureHeader.slice(7);

  const expected = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // timingSafeEqual prevents timing-based signature inference.
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false; // Buffer lengths differ → invalid signature
  }
}

// ── WiPay payload type ────────────────────────────────────────────────────────

interface WiPayPayload {
  status?: string;            // 'success' | 'failed' | 'pending' | ...
  transaction_id?: string;    // WiPay transaction reference
  order_id?: string;          // Our reference (we set this when creating the payment link)
  amount?: number | string;
  currency?: string;
  [key: string]: unknown;
}

// ── POST /webhooks/wipay ──────────────────────────────────────────────────────

wipayRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // req.body is a Buffer because this router is mounted with express.raw().
    const rawBody = req.body as Buffer;

    // 1. Verify HMAC signature.
    const signatureHeader = req.headers['x-wipay-signature'] as string | undefined;
    if (!verifyWiPaySignature(rawBody, signatureHeader)) {
      logger.warn({ entity: 'WIPAY', action: 'SIGNATURE_REJECTED', error_message: 'Invalid or missing X-WiPay-Signature' });
      res.status(400).json({ success: false, data: null, error: 'Invalid signature.', code: 'INVALID_SIGNATURE' });
      return;
    }

    // 2. Parse payload.
    let payload: WiPayPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as WiPayPayload;
    } catch {
      res.status(400).json({ success: false, data: null, error: 'Invalid JSON payload.', code: 'INVALID_PAYLOAD' });
      return;
    }

    logger.info({ entity: 'WIPAY', action: 'WEBHOOK_RECEIVED', status: payload.status, transaction_id: payload.transaction_id });

    const ownerId = process.env['WIPAY_DEFAULT_OWNER_ID'] ?? process.env['ALERT_USER_ID'] ?? '';

    // 3. Non-success → review queue → 202.
    if (payload.status !== 'success') {
      await insertReviewQueue(ownerId, payload, 'WIPAY_WEBHOOK_NON_SUCCESS');
      res.status(202).json({ success: true, data: { queued: true } });
      return;
    }

    // 4. Success payment — try to match an existing rent payment record.
    const wipayRef = payload.transaction_id ?? payload.order_id;
    if (wipayRef) {
      const client = await propertiesPool.connect();
      try {
        // No RLS context available for webhook — use owner_id directly in WHERE.
        // The prop_rent_payments RLS policy uses owner_id = app.current_owner_id.
        // We set it here so the UPDATE passes RLS.
        const updated = await (async () => {
          await client.query('BEGIN');
          await client.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', ownerId]);
          await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', ownerId]);

          const result = await client.query(
            `UPDATE prop_rent_payments
             SET    wipay_webhook_payload = $1,
                    updated_at            = now()
             WHERE  wipay_reference = $2
             RETURNING id, owner_id`,
            [JSON.stringify(payload), wipayRef],
          );
          await client.query('COMMIT');
          return result.rows[0] ?? null;
        })();

        if (updated) {
          // Matched — write audit, return 200.
          const auditClient = await corePool.connect();
          try {
            await auditClient.query('BEGIN');
            await auditClient.query('SELECT set_config($1, $2, true)', ['app.current_user_id', ownerId]);
            const auditKey = payload.transaction_id ? toUUID(`WIPAY_CONFIRMED:${payload.transaction_id}`) : null;
            await auditClient.query(
              `INSERT INTO audit_log (user_id, entity, action, record_id, new_values, source, idempotency_key)
               VALUES ($1, 'RentPayment', 'WIPAY_CONFIRMED', $2, $3, 'API', $4)
               ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
              [ownerId, updated.id, JSON.stringify(payload), auditKey],
            );
            await auditClient.query('COMMIT');
          } catch (auditErr) {
            await auditClient.query('ROLLBACK');
            logger.warn({ entity: 'WIPAY', action: 'AUDIT_LOG_FAILED', error_message: (auditErr as Error).message });
          } finally { auditClient.release(); }

          logger.info({ entity: 'WIPAY', action: 'PAYMENT_CONFIRMED', record_id: updated.id });
          res.status(200).json({ success: true, data: { confirmed: true, payment_id: updated.id } });
          return;
        }
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        logger.error({ entity: 'WIPAY', action: 'MATCH_QUERY_FAILED', error_message: (e as Error).message });
        // Fall through to review queue.
      } finally { client.release(); }
    }

    // 5. Success but no matching record → review queue → 202.
    await insertReviewQueue(ownerId, payload, 'WIPAY_WEBHOOK_UNMATCHED');
    logger.warn({ entity: 'WIPAY', action: 'PAYMENT_UNMATCHED', transaction_id: payload.transaction_id });
    res.status(202).json({ success: true, data: { queued: true } });
  } catch (e) { next(e); }
});

// ── Deterministic UUID from an arbitrary string ───────────────────────────────
// WiPay transaction IDs are not UUIDs. We derive a stable UUID from the
// transaction_id so the idempotency_key column (type uuid) stays idempotent
// across WiPay webhook retries.

function toUUID(input: string): string {
  const h = createHash('sha256').update(input).digest('hex');
  // Force version 4 and variant bits to produce a valid RFC 4122 UUID.
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${ (['8','9','a','b'] as const)[ parseInt(h[16], 16) % 4 ] }${h.slice(17,20)}-${h.slice(20,32)}`;
}

// ── Insert review queue helper ────────────────────────────────────────────────

async function insertReviewQueue(ownerId: string, payload: WiPayPayload, source: string): Promise<void> {
  if (!ownerId || ownerId === '00000000-0000-0000-0000-000000000000') {
    logger.warn({ entity: 'WIPAY', action: 'REVIEW_QUEUE_SKIPPED', error_message: 'WIPAY_DEFAULT_OWNER_ID not configured with a real user UUID — set it to Robert\'s jag_core.users.id' });
    return;
  }

  const client = await propertiesPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', ownerId]);

    // Derive a stable UUID from the WiPay transaction_id so retries are idempotent.
    const rawKey = payload.transaction_id ?? payload.order_id ?? `${source}-${Date.now()}`;
    const idempotencyKey = toUUID(`${source}:${rawKey}`);

    await client.query(
      `INSERT INTO prop_pending_review_queue (owner_id, idempotency_key, source, raw_payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [ownerId, idempotencyKey, source, JSON.stringify(payload)],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    logger.error({ entity: 'WIPAY', action: 'REVIEW_QUEUE_INSERT_FAILED', error_message: (e as Error).message });
  } finally { client.release(); }
}
