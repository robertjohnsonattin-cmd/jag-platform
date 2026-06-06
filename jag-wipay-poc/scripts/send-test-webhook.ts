/**
 * WiPay sandbox test harness — sends mock webhook payloads against the running POC server.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 \
 *   WIPAY_WEBHOOK_SECRET=your-secret \
 *   TEST_LEASE_ID=<uuid-of-active-lease> \
 *   npm run test-webhook
 *
 * All six scenarios are printed with status code + response body.
 */

import 'dotenv/config';
import { createHmac, randomUUID } from 'crypto';
import type { WiPayWebhookPayload } from '../src/types';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const SECRET = process.env.WIPAY_WEBHOOK_SECRET;
const TEST_LEASE_ID = process.env.TEST_LEASE_ID ?? '00000000-0000-0000-0000-000000000000';

if (!SECRET) {
  console.error('WIPAY_WEBHOOK_SECRET env var is required');
  process.exit(1);
}

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET!).update(body).digest('hex');
}

async function send(
  scenario: string,
  payload: WiPayWebhookPayload,
  idempotencyKey: string,
  overrideSig?: string
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = overrideSig ?? sign(body);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Scenario: ${scenario}`);
  console.log(`Idempotency-Key: ${idempotencyKey}`);

  try {
    const response = await fetch(`${BASE_URL}/webhooks/wipay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WiPay-Signature': signature,
        'Idempotency-Key': idempotencyKey,
      },
      body,
    });

    const result = await response.json();
    console.log(`HTTP ${response.status}`);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Request failed:', err);
  }
}

async function main(): Promise<void> {
  console.log(`Target: ${BASE_URL}`);
  console.log(`Test lease: ${TEST_LEASE_ID}`);

  // Scenario 1 — Valid success payment (new idempotency key)
  const successKey = randomUUID();
  await send(
    '1. Valid success payment → 200, inserts prop_rent_payments + outbox event',
    {
      wipay_reference: 'WP-2026-00001',
      status: 'success',
      amount: 3500.00,
      currency: 'TTD',
      payer_name: 'Test Tenant',
      payer_email: 'tenant@example.com',
      transaction_date: new Date().toISOString(),
      metadata: { lease_id: TEST_LEASE_ID },
    },
    successKey
  );

  // Scenario 2 — Duplicate (same idempotency key as scenario 1) → 200, no double-insert
  await send(
    '2. Duplicate idempotency key → 200, no re-processing',
    {
      wipay_reference: 'WP-2026-00001',
      status: 'success',
      amount: 3500.00,
      currency: 'TTD',
      metadata: { lease_id: TEST_LEASE_ID },
    },
    successKey
  );

  // Scenario 3 — Bad HMAC signature → 401
  await send(
    '3. Bad HMAC signature → 401 INVALID_SIGNATURE',
    {
      wipay_reference: 'WP-2026-00002',
      status: 'success',
      amount: 3500.00,
      currency: 'TTD',
      metadata: { lease_id: TEST_LEASE_ID },
    },
    randomUUID(),
    'sha256=' + '0'.repeat(64)
  );

  // Scenario 4 — Missing required field → 400
  await send(
    '4. Missing wipay_reference → 400 VALIDATION_ERROR',
    {
      wipay_reference: '',
      status: 'success',
      amount: 3500.00,
      currency: 'TTD',
    },
    randomUUID()
  );

  // Scenario 5 — Failed payment → 202, inserts prop_pending_review_queue
  await send(
    '5. Failed payment status → 202, queued for review',
    {
      wipay_reference: 'WP-2026-00003',
      status: 'failed',
      amount: 3500.00,
      currency: 'TTD',
      payer_name: 'Test Tenant',
    },
    randomUUID()
  );

  // Scenario 6 — Success but no lease correlation → 202, inserts prop_pending_review_queue
  await send(
    '6. Success with no lease_id in metadata → 202, queued for review',
    {
      wipay_reference: 'WP-2026-00004',
      status: 'success',
      amount: 3500.00,
      currency: 'TTD',
      payer_name: 'Test Tenant',
    },
    randomUUID()
  );

  console.log(`\n${'─'.repeat(60)}`);
  console.log('All scenarios complete.');
}

main().catch(console.error);
